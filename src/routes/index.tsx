import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, Upload, FileSpreadsheet, Trash2, Loader2, AlertCircle, CheckCircle2, LogOut,
  AlertTriangle, RefreshCw, GitMerge, Mic, Square, Video, Archive, GraduationCap, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster, toast } from "sonner";
import { extractScript } from "@/lib/ocr.functions";
import { extractFromAudio } from "@/lib/audio.functions";
import { DEFAULT_MATRIC_SAMPLE, patternToRegex, describePattern } from "@/lib/matric";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    course: typeof search.course === "string" ? search.course : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Examination Console — ScriptScan" },
      { name: "description", content: "Capture marked exam scripts by photo, live camera, or voice and compile matric numbers and scores into Excel." },
      { property: "og:title", content: "Examination Console — ScriptScan" },
      { property: "og:description", content: "Capture marked exam scripts by photo, live camera, or voice and compile results into Excel." },
    ],
  }),
  component: Index,
});

type Status = "queued" | "scanning" | "done" | "saved" | "error" | "pending-merge";
type PendingMerge = {
  existingId: string;
  existingScore: number | null;
  existingTotal: number | null;
  existingConfidence: string | null;
};
type Rec = {
  id: string;
  dbId?: string;
  fileName: string;
  preview: string;
  status: Status;
  matric: string;
  score: string;
  total: string;
  confidence?: string;
  notes?: string;
  error?: string;
  pendingMerge?: PendingMerge;
};

function fileToBase64(file: Blob): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const [meta, b64] = result.split(",");
      const mime = meta.match(/data:(.*?);/)?.[1] ?? (file as File).type;
      resolve({ base64: b64, mime });
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Parse a score input that may be "45", "45/60", "45 / 60". */
function parseScore(raw: string): { score: number | null; total: number | null; ok: boolean; reason?: string } {
  const s = raw.trim();
  if (!s) return { score: null, total: null, ok: false, reason: "empty" };
  if (s.includes("/")) {
    const [a, b] = s.split("/").map((x) => x.trim());
    const sc = Number(a), tot = Number(b);
    if (!Number.isFinite(sc)) return { score: null, total: Number.isFinite(tot) ? tot : null, ok: false, reason: "score part not a number" };
    if (!Number.isFinite(tot)) return { score: sc, total: null, ok: false, reason: "total part not a number" };
    if (tot <= 0) return { score: sc, total: tot, ok: false, reason: "total must be > 0" };
    if (sc < 0 || sc > tot) return { score: sc, total: tot, ok: false, reason: "score out of 0..total range" };
    return { score: sc, total: tot, ok: true };
  }
  const sc = Number(s);
  if (!Number.isFinite(sc)) return { score: null, total: null, ok: false, reason: "not a number" };
  if (sc < 0) return { score: sc, total: null, ok: false, reason: "must be ≥ 0" };
  return { score: sc, total: null, ok: true };
}

function Index() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [course, setCourse] = useState(search.course ?? "");
  const [pattern, setPattern] = useState(DEFAULT_MATRIC_SAMPLE);
  const [records, setRecords] = useState<Rec[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportingScores, setExportingScores] = useState(false);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileMap = useRef<Map<string, File>>(new Map());
  const CONCURRENCY = 4;

  // ---- live scan state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [liveCaptured, setLiveCaptured] = useState(0);
  const liveBusy = useRef(false);
  const seenMatrics = useRef<Set<string>>(new Set());

  // ---- voice state
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");

  const refreshReviewCount = useCallback(async (courseName?: string) => {
    const c = (courseName ?? course).trim();
    if (!c) { setReviewCount(null); return; }
    const { count } = await supabase
      .from("scripts")
      .select("id", { count: "exact", head: true })
      .eq("course", c)
      .or("matric.is.null,score.is.null");
    setReviewCount(count ?? 0);
  }, [course]);

  useEffect(() => {
    const t = setTimeout(() => { refreshReviewCount(); }, 300);
    return () => clearTimeout(t);
  }, [course, refreshReviewCount]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => {
          supabase.from("user_roles").select("role").eq("user_id", session.user.id).then(({ data }) => {
            setIsStaff((data ?? []).some((r) => r.role === "staff" || r.role === "admin"));
          });
        }, 0);
      } else setIsStaff(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthChecked(true);
      if (!data.session) navigate({ to: "/auth" });
      else {
        supabase.from("user_roles").select("role").eq("user_id", data.session.user.id).then(({ data: roles }) => {
          setIsStaff((roles ?? []).some((r) => r.role === "staff" || r.role === "admin"));
        });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const matricRegex = useMemo(() => patternToRegex(pattern), [pattern]);

  const updateRecord = (id: string, patch: Partial<Rec>) =>
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const findExisting = async (matric: string) => {
    const { data } = await supabase
      .from("scripts")
      .select("id,score,total,confidence")
      .eq("course", course.trim())
      .eq("matric", matric)
      .maybeSingle();
    return data;
  };

  const persistRecord = async (
    r: Rec,
    opts: { force?: boolean } = {},
  ): Promise<{ ok: boolean; msg?: string; dbId?: string; pendingMerge?: PendingMerge }> => {
    if (!course.trim()) return { ok: false, msg: "Set a course name first" };
    if (!user) return { ok: false, msg: "Not signed in" };
    const matric = r.matric ? r.matric.toUpperCase().trim() : null;
    const parsed = parseScore(r.score);
    const scoreNum = parsed.score;
    const totalNum = parsed.total ?? (r.total !== "" && Number.isFinite(Number(r.total)) ? Number(r.total) : null);
    const matricValid = !!matric && matricRegex.test(matric);
    const scoreValid = scoreNum !== null && parsed.ok;
    const needsReview = !matricValid || !scoreValid;
    const status = needsReview ? "review" : "done";

    if (r.dbId) {
      const { data, error } = await supabase
        .from("scripts")
        .update({
          matric, score: scoreNum, total: totalNum, confidence: r.confidence ?? null,
          notes: r.notes ?? null, status, file_name: r.fileName, error: r.error ?? null,
        })
        .eq("id", r.dbId).select().single();
      if (error) return { ok: false, msg: error.message };
      return { ok: !needsReview, msg: needsReview ? "Saved (needs review)" : undefined, dbId: data.id };
    }

    if (matric && !opts.force) {
      const existing = await findExisting(matric);
      if (existing) {
        return {
          ok: false,
          pendingMerge: {
            existingId: existing.id,
            existingScore: existing.score != null ? Number(existing.score) : null,
            existingTotal: existing.total != null ? Number(existing.total) : null,
            existingConfidence: existing.confidence ?? null,
          },
        };
      }
    }

    if (matric) {
      const { data, error } = await supabase
        .from("scripts")
        .upsert({
          user_id: user.id, course: course.trim(), matric, score: scoreNum, total: totalNum,
          confidence: r.confidence ?? null, notes: r.notes ?? null, status,
          file_name: r.fileName, error: r.error ?? null,
        }, { onConflict: "course,matric" }).select().single();
      if (error) return { ok: false, msg: error.message };
      return { ok: !needsReview, msg: needsReview ? "Saved (needs review)" : undefined, dbId: data.id };
    }

    const { data, error } = await supabase.from("scripts").insert({
      user_id: user.id, course: course.trim(), matric: null, score: scoreNum, total: totalNum,
      confidence: r.confidence ?? null, notes: r.notes ?? null, status,
      file_name: r.fileName, error: r.error ?? null,
    }).select().single();
    if (error) return { ok: false, msg: error.message };
    return { ok: false, msg: "Saved (needs review)", dbId: data.id };
  };

  const runOcr = useCallback(async (recId: string, file: Blob) => {
    updateRecord(recId, { status: "scanning", error: undefined });
    try {
      const { base64, mime } = await fileToBase64(file);
      const result = await extractScript({ data: { imageBase64: base64, mimeType: mime } });
      const matric = (result.matric_no ?? "").toUpperCase().replace(/\s+/g, "");
      const score = result.score != null ? String(result.score) : "";
      const total = result.total != null ? String(result.total) : "";
      const next: Partial<Rec> = {
        status: "done", matric, score, total,
        confidence: result.confidence, notes: result.notes,
        error: !matric || result.score == null ? "Missing data — please correct" : undefined,
      };
      updateRecord(recId, next);
      return next;
    } catch (e: any) {
      updateRecord(recId, { status: "error", error: e?.message ?? "OCR failed" });
      throw e;
    }
  }, []);

  const applyPersistResult = (
    recId: string,
    res: { ok: boolean; msg?: string; dbId?: string; pendingMerge?: PendingMerge },
  ) => {
    if (res.pendingMerge) {
      updateRecord(recId, { status: "pending-merge", pendingMerge: res.pendingMerge, error: "Duplicate — confirm merge" });
    } else if (res.ok) {
      updateRecord(recId, { status: "saved", dbId: res.dbId, error: undefined });
    } else if (res.dbId) {
      updateRecord(recId, { dbId: res.dbId });
    }
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    if (!course.trim()) { toast.error("Enter a course code first"); return; }
    const list = Array.from(files);
    const newRecs: Rec[] = list.map((f) => ({
      id: crypto.randomUUID(), fileName: f.name, preview: URL.createObjectURL(f),
      status: "queued", matric: "", score: "", total: "",
    }));
    newRecs.forEach((r, i) => fileMap.current.set(r.id, list[i]));
    setRecords((rs) => [...rs, ...newRecs]);
    setBusy(true); setProgress(0);

    let done = 0;
    const processOne = async (i: number) => {
      const file = list[i];
      const rec = newRecs[i];
      try {
        const next = await runOcr(rec.id, file);
        const merged: Rec = { ...rec, ...next } as Rec;
        applyPersistResult(rec.id, await persistRecord(merged));
      } catch (e: any) {
        toast.error(`Failed: ${file.name}`, { description: e?.message });
      } finally {
        done++;
        setProgress(Math.round((done / list.length) * 100));
      }
    };

    const indices = list.map((_, i) => i);
    const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
      while (indices.length) {
        const i = indices.shift();
        if (i === undefined) break;
        await processOne(i);
      }
    });
    await Promise.all(workers);

    setBusy(false);
    toast.success("Scan complete");
    refreshReviewCount();
  }, [course, user, matricRegex, refreshReviewCount, runOcr]);

  // ================= LIVE SCAN =================
  const stopLive = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLiveOn(false);
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const startLive = async () => {
    if (!course.trim()) { toast.error("Enter a course code first"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setLiveOn(true);
      setLiveCaptured(0);
      seenMatrics.current = new Set();
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (e: any) {
      toast.error("Camera unavailable", { description: e?.message });
    }
  };

  const grabFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || liveBusy.current) return;
    liveBusy.current = true;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (!blob) return;
      const preview = canvas.toDataURL("image/jpeg", 0.6);
      const recId = crypto.randomUUID();
      const rec: Rec = {
        id: recId, fileName: `live-${new Date().toISOString().slice(11, 19)}.jpg`,
        preview, status: "scanning", matric: "", score: "", total: "",
      };
      fileMap.current.set(recId, new File([blob], rec.fileName, { type: "image/jpeg" }));
      setRecords((rs) => [...rs, rec]);
      const next = await runOcr(recId, blob);
      const matric = (next.matric ?? "").toUpperCase();
      if (matric && seenMatrics.current.has(matric)) {
        // same script still in frame — discard the duplicate capture silently
        setRecords((rs) => rs.filter((x) => x.id !== recId));
        fileMap.current.delete(recId);
        return;
      }
      if (matric) seenMatrics.current.add(matric);
      applyPersistResult(recId, await persistRecord({ ...rec, ...next } as Rec));
      setLiveCaptured((n) => n + 1);
      refreshReviewCount();
    } catch {
      /* keep the live loop alive on a failed frame */
    } finally {
      liveBusy.current = false;
    }
  }, [course, user, matricRegex, runOcr, refreshReviewCount]);

  useEffect(() => {
    if (!liveOn || !autoCapture) return;
    const id = setInterval(() => { grabFrame(); }, 4000);
    return () => clearInterval(id);
  }, [liveOn, autoCapture, grabFrame]);

  // ================= VOICE CAPTURE =================
  const startRecording = async () => {
    if (!course.trim()) { toast.error("Enter a course code first"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        await processDictation(blob, mime);
      };
      recorderRef.current = rec;
      rec.start(); // single complete recording, no timeslice
      setRecording(true);
      setTranscript("");
    } catch (e: any) {
      toast.error("Microphone unavailable", { description: e?.message });
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const processDictation = async (blob: Blob, mime: string) => {
    setTranscribing(true);
    try {
      const { base64 } = await fileToBase64(blob);
      const format = mime.includes("webm") ? "webm" : "m4a";
      const out = await extractFromAudio({ data: { audioBase64: base64, format, sample: pattern } });
      setTranscript(out.transcript ?? "");
      if (!out.entries.length) { toast.warning("No results detected in the recording"); return; }
      for (const e of out.entries) {
        const rec: Rec = {
          id: crypto.randomUUID(),
          fileName: "dictated",
          preview: "",
          status: "done",
          matric: (e.matric_no ?? "").toUpperCase().replace(/\s+/g, ""),
          score: e.score != null ? String(e.score) : "",
          total: e.total != null ? String(e.total) : "",
          confidence: e.confidence,
          notes: e.notes,
          error: !e.matric_no || e.score == null ? "Missing data — please correct" : undefined,
        };
        setRecords((rs) => [...rs, rec]);
        applyPersistResult(rec.id, await persistRecord(rec));
      }
      toast.success(`Captured ${out.entries.length} dictated record(s)`);
      refreshReviewCount();
    } catch (e: any) {
      toast.error("Voice capture failed", { description: e?.message });
    } finally {
      setTranscribing(false);
    }
  };

  // ================= RECORD ACTIONS =================
  const saveEdited = async (r: Rec) => {
    const res = await persistRecord(r);
    if (res.pendingMerge) {
      updateRecord(r.id, { status: "pending-merge", pendingMerge: res.pendingMerge, error: "Duplicate — confirm merge" });
      toast.warning("Existing record found — confirm merge");
    } else if (res.ok) {
      updateRecord(r.id, { status: "saved", dbId: res.dbId, error: undefined, pendingMerge: undefined });
      toast.success("Saved");
    } else if (res.dbId) {
      updateRecord(r.id, { dbId: res.dbId, status: "done", pendingMerge: undefined });
      toast.warning(res.msg ?? "Saved (needs review)");
    } else if (res.msg) {
      toast.error(res.msg);
    }
    refreshReviewCount();
  };

  const confirmMerge = async (r: Rec) => {
    if (!r.pendingMerge) return;
    const merged: Rec = { ...r, dbId: r.pendingMerge.existingId };
    updateRecord(r.id, { dbId: r.pendingMerge.existingId, pendingMerge: undefined });
    const res = await persistRecord(merged, { force: true });
    if (res.ok) {
      updateRecord(r.id, { status: "saved", dbId: res.dbId, error: undefined });
      toast.success("Merged — existing row overwritten");
    } else {
      toast.error(res.msg ?? "Merge failed");
    }
    refreshReviewCount();
  };

  const keepExisting = (r: Rec) => {
    setRecords((rs) => rs.filter((x) => x.id !== r.id));
    fileMap.current.delete(r.id);
    toast.info("Kept existing saved row");
  };

  const rescan = async (r: Rec) => {
    const file = fileMap.current.get(r.id);
    if (!file) { toast.error("Original image unavailable for this record"); return; }
    try {
      const next = await runOcr(r.id, file);
      const res = await persistRecord({ ...r, ...next } as Rec);
      applyPersistResult(r.id, res);
      if (res.ok) toast.success("Re-scanned & saved");
      else if (res.dbId) toast.warning(res.msg ?? "Re-scanned (needs review)");
    } catch (e: any) {
      toast.error("Re-scan failed", { description: e?.message });
    }
    refreshReviewCount();
  };

  const removeRecord = async (id: string) => {
    const r = records.find((x) => x.id === id);
    if (r?.dbId) {
      const { error } = await supabase.from("scripts").delete().eq("id", r.dbId);
      if (error) { toast.error(`Delete failed: ${error.message}`); return; }
      toast.success("Deleted from records");
    }
    setRecords((rs) => rs.filter((x) => x.id !== id));
    fileMap.current.delete(id);
    refreshReviewCount();
  };

  const clearAll = () => { setRecords([]); fileMap.current.clear(); };

  const loadSaved = useCallback(async (courseName: string) => {
    const { data, error } = await supabase
      .from("scripts").select("*").eq("course", courseName.trim())
      .order("matric", { ascending: true });
    if (error) { toast.error(error.message); return; }
    if (!data?.length) return;
    const loaded: Rec[] = data.map((d: any) => {
      const ok = d.matric && matricRegex.test(d.matric) && d.score != null;
      return {
        id: crypto.randomUUID(), dbId: d.id,
        fileName: d.file_name || "(archived)", preview: "",
        status: ok ? ("saved" as Status) : ("done" as Status),
        matric: d.matric ?? "",
        score: d.score != null ? String(d.score) : "",
        total: d.total != null ? String(d.total) : "",
        confidence: d.confidence ?? undefined, notes: d.notes ?? undefined,
        error: d.error ?? (!ok ? "Needs review" : undefined),
      };
    });
    setRecords((rs) => {
      const ids = new Set(rs.map((x) => x.dbId).filter(Boolean));
      return [...rs, ...loaded.filter((x) => !ids.has(x.dbId))];
    });
    toast.success(`Opened ${loaded.length} archived record(s)`);
  }, [matricRegex]);

  // Auto-open a course arriving from the History file.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    if (!user || !isStaff || !search.course) return;
    openedRef.current = true;
    loadSaved(search.course);
  }, [user, isStaff, search.course, loadSaved]);

  const exportScores = async () => {
    if (!course.trim()) { toast.error("Enter course code"); return; }
    setExportingScores(true);
    try {
      const { data, error } = await supabase
        .from("scripts").select("matric,score").eq("course", course.trim())
        .not("matric", "is", null).not("score", "is", null).order("matric");
      if (error) { toast.error(error.message); return; }
      if (!data?.length) { toast.error("No saved scores for this course"); return; }
      const rows: (string | number)[][] = [["MATRIC NO.", "SCORE"], ...data.map((r) => [r.matric as string, Number(r.score)])];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 22 }, { wch: 10 }];
      for (let i = 2; i <= rows.length; i++) { const c = ws[`B${i}`]; if (c) c.t = "n"; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scores");
      const filename = `${course.replace(/\s+/g, "_")}_scores.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Exported ${data.length} record(s)`, { description: filename });
    } finally { setExportingScores(false); }
  };

  const signOut = async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); };

  if (!authChecked) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!user) return null;
  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="p-6 max-w-md text-center space-y-3">
          <AlertTriangle className="h-10 w-10 mx-auto text-[color:var(--color-warning)]" />
          <h2 className="font-semibold">Access pending</h2>
          <p className="text-sm text-muted-foreground">Your account does not yet have staff access. Contact your administrator.</p>
          <Button onClick={signOut} variant="outline">Sign out</Button>
        </Card>
      </div>
    );
  }

  const savedCount = records.filter((r) => r.status === "saved").length;

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />

      <header className="border-b-2 border-primary/80 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-sm border border-[color:var(--color-brass)]/70 flex items-center justify-center flex-shrink-0">
              <GraduationCap className="h-6 w-6 text-[color:var(--color-brass)]" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-xl leading-tight tracking-tight">ScriptScan</p>
              <p className="text-[11px] uppercase tracking-[0.22em] opacity-70 truncate">Office of Examinations · {user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link to="/history">
              <Button variant="ghost" size="sm" className="gap-1 text-primary-foreground hover:bg-primary-foreground/10">
                <Archive className="h-4 w-4" /><span className="hidden sm:inline">History file</span>
              </Button>
            </Link>
            <Button onClick={signOut} variant="ghost" size="sm" className="gap-1 text-primary-foreground hover:bg-primary-foreground/10">
              <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <section>
          <h1 className="font-display text-3xl sm:text-4xl">Examination Capture Console</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Digitize marked scripts through photographs, a live camera sweep, or spoken dictation — then compile a clean
            <span className="font-medium text-foreground"> MATRIC NO. / SCORE </span> spreadsheet.
          </p>
        </section>

        <Card className="p-5 border-t-4 border-t-[color:var(--color-brass)]" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="course" className="text-xs uppercase tracking-widest text-muted-foreground">Course code *</Label>
              <Input id="course" placeholder="e.g. CSC 301" value={course} onChange={(e) => setCourse(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pattern" className="text-xs uppercase tracking-widest text-muted-foreground">Matric pattern (sample)</Label>
              <Input id="pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} className="font-mono" placeholder={DEFAULT_MATRIC_SAMPLE} />
              <p className="text-[11px] text-muted-foreground">{describePattern(pattern)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 items-center mt-5 pt-4 border-t border-border">
            <Button onClick={exportScores} disabled={!course.trim() || exportingScores} className="gap-2">
              {exportingScores ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Export Scores .xlsx
            </Button>
            {course.trim() && reviewCount !== null && (
              <Badge variant={reviewCount > 0 ? "destructive" : "secondary"} className="gap-1 rounded-sm">
                <AlertTriangle className="h-3 w-3" />
                {reviewCount} incomplete entr{reviewCount === 1 ? "y" : "ies"}
              </Badge>
            )}
          </div>
        </Card>

        <Tabs defaultValue="upload">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="upload" className="gap-2"><Upload className="h-4 w-4" />Photographs</TabsTrigger>
            <TabsTrigger value="live" className="gap-2"><Video className="h-4 w-4" />Live scan</TabsTrigger>
            <TabsTrigger value="voice" className="gap-2"><Mic className="h-4 w-4" />Dictation</TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <Card className="p-6" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex flex-col items-center text-center gap-4">
                <h2 className="font-display text-2xl">Upload marked scripts</h2>
                <p className="text-sm text-muted-foreground max-w-lg">
                  Select any number of photographs. Everything is filed under <strong>{course || "(set course)"}</strong>, and repeated matric numbers are flagged for merge.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                  <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                  <Button onClick={() => cameraRef.current?.click()} disabled={busy} size="lg" className="gap-2">
                    <Camera className="h-4 w-4" /> Take photo
                  </Button>
                  <Button onClick={() => galleryRef.current?.click()} disabled={busy} variant="outline" size="lg" className="gap-2">
                    <Upload className="h-4 w-4" /> Choose images
                  </Button>
                </div>
                {busy && (
                  <div className="w-full max-w-md space-y-2 pt-2">
                    <Progress value={progress} />
                    <p className="text-xs text-muted-foreground flex items-center gap-2 justify-center">
                      <Loader2 className="h-3 w-3 animate-spin" /> Reading scripts… {progress}%
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="live">
            <Card className="p-6 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="text-center space-y-1">
                <h2 className="font-display text-2xl">Live camera sweep</h2>
                <p className="text-sm text-muted-foreground">
                  Hold each script in front of the camera. A frame is read automatically every few seconds and duplicate matric numbers are ignored.
                </p>
              </div>

              <div className="relative mx-auto w-full max-w-2xl aspect-video overflow-hidden rounded-sm border border-border bg-secondary">
                <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                {!liveOn && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    Camera off
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                {!liveOn ? (
                  <Button onClick={startLive} className="gap-2"><Play className="h-4 w-4" /> Start live scan</Button>
                ) : (
                  <>
                    <Button onClick={grabFrame} variant="secondary" className="gap-2"><Camera className="h-4 w-4" /> Capture now</Button>
                    <Button onClick={() => setAutoCapture((a) => !a)} variant="outline" className="gap-2">
                      {autoCapture ? "Pause auto-capture" : "Resume auto-capture"}
                    </Button>
                    <Button onClick={stopLive} variant="destructive" className="gap-2"><Square className="h-4 w-4" /> Stop</Button>
                  </>
                )}
                {liveOn && <Badge variant="secondary" className="rounded-sm">{liveCaptured} captured</Badge>}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="voice">
            <Card className="p-6 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="text-center space-y-1">
                <h2 className="font-display text-2xl">Spoken dictation</h2>
                <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                  Press record and read out entries one after another — “{DEFAULT_MATRIC_SAMPLE}, score 45” — then press Done. Every entry is filed and added below.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {!recording ? (
                  <Button onClick={startRecording} disabled={transcribing} size="lg" className="gap-2">
                    <Mic className="h-4 w-4" /> Start dictation
                  </Button>
                ) : (
                  <Button onClick={stopRecording} size="lg" variant="destructive" className="gap-2">
                    <Square className="h-4 w-4" /> Done
                  </Button>
                )}
                {recording && <Badge variant="destructive" className="rounded-sm gap-1 self-center">Recording…</Badge>}
                {transcribing && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground self-center">
                    <Loader2 className="h-4 w-4 animate-spin" /> Interpreting recording…
                  </span>
                )}
              </div>
              {transcript && (
                <div className="rounded-sm border border-border bg-secondary/60 p-3 text-xs text-muted-foreground max-w-2xl mx-auto">
                  <span className="font-semibold uppercase tracking-widest text-[10px]">Transcript</span>
                  <p className="mt-1 whitespace-pre-wrap">{transcript}</p>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>

        {records.length > 0 && (() => {
          const sorted = [...records].sort((a, b) => (a.matric || "~").toUpperCase().localeCompare((b.matric || "~").toUpperCase()));
          const matricCounts = new Map<string, number>();
          sorted.forEach((r) => {
            const m = r.matric.toUpperCase();
            if (m) matricCounts.set(m, (matricCounts.get(m) ?? 0) + 1);
          });
          return (
            <section className="space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h3 className="font-display text-xl">
                  Entry register <span className="text-sm text-muted-foreground font-sans">· {records.length} record(s), {savedCount} filed</span>
                </h3>
                <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1"><Trash2 className="h-3 w-3" /> Clear list</Button>
              </div>
              <div className="grid gap-3">
                {sorted.map((r) => {
                  const matricUpper = r.matric.toUpperCase();
                  const matricValid = !!matricUpper && matricRegex.test(matricUpper);
                  const parsed = parseScore(r.score);
                  const scoreValid = parsed.ok;
                  const isDup = matricUpper && (matricCounts.get(matricUpper) ?? 0) > 1;
                  const hasFile = fileMap.current.has(r.id);
                  return (
                    <Card
                      key={r.id}
                      className={`p-3 flex gap-3 items-start ${isDup || r.status === "pending-merge" ? "border-l-4 border-l-[color:var(--color-warning)]" : ""}`}
                      style={{ boxShadow: "var(--shadow-card)" }}
                    >
                      {r.preview ? (
                        <a href={r.preview} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                          <img src={r.preview} alt={r.fileName} className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-sm border border-border hover:opacity-80 transition" />
                        </a>
                      ) : (
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-sm border border-border flex items-center justify-center text-[10px] uppercase tracking-widest text-muted-foreground flex-shrink-0">
                          {r.fileName === "dictated" ? "Voice" : "Filed"}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.status === "scanning" && <Badge variant="secondary" className="gap-1 rounded-sm"><Loader2 className="h-3 w-3 animate-spin" />Reading</Badge>}
                          {r.status === "queued" && <Badge variant="outline" className="rounded-sm">Queued</Badge>}
                          {r.status === "error" && <Badge variant="destructive" className="gap-1 rounded-sm"><AlertCircle className="h-3 w-3" />Error</Badge>}
                          {r.status === "saved" && <Badge className="gap-1 rounded-sm bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)]"><CheckCircle2 className="h-3 w-3" />Filed</Badge>}
                          {r.status === "pending-merge" && <Badge variant="destructive" className="gap-1 rounded-sm"><GitMerge className="h-3 w-3" />Merge needed</Badge>}
                          {isDup && <Badge variant="outline" className="gap-1 rounded-sm border-[color:var(--color-warning)] text-[color:var(--color-warning)]">Duplicate ({matricCounts.get(matricUpper)})</Badge>}
                          {r.confidence && <Badge variant="outline" className="text-xs rounded-sm">conf: {r.confidence}</Badge>}
                          <span className="text-xs text-muted-foreground truncate">{r.fileName}</span>
                        </div>

                        {r.status === "pending-merge" && r.pendingMerge && (
                          <div className="rounded-sm border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 p-2 text-xs space-y-2">
                            <p>
                              A filed row already exists for <strong>{matricUpper}</strong> in <strong>{course}</strong>.
                              {" "}Existing score: <strong>{r.pendingMerge.existingScore ?? "—"}{r.pendingMerge.existingTotal != null ? `/${r.pendingMerge.existingTotal}` : ""}</strong>
                              {r.pendingMerge.existingConfidence ? ` (conf: ${r.pendingMerge.existingConfidence})` : ""}.
                              {" "}This capture would write: <strong>{parsed.score ?? "—"}{parsed.total != null ? `/${parsed.total}` : ""}</strong>.
                            </p>
                            <div className="flex gap-2">
                              <Button size="sm" variant="destructive" onClick={() => confirmMerge(r)} className="gap-1">
                                <GitMerge className="h-3 w-3" /> Overwrite filed row
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => keepExisting(r)}>Keep existing</Button>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_auto_auto_auto] gap-2 items-end">
                          <div>
                            <Label className="text-xs text-muted-foreground">Matric No.</Label>
                            <Input
                              value={r.matric}
                              onChange={(e) => updateRecord(r.id, { matric: e.target.value.toUpperCase() })}
                              onBlur={() => saveEdited({ ...r, matric: r.matric.toUpperCase() })}
                              className={`font-mono ${r.matric && !matricValid ? "border-destructive" : ""}`}
                              placeholder="—"
                            />
                            {r.matric && !matricValid && (
                              <p className="text-[11px] text-destructive mt-1">Doesn't match the {pattern} pattern</p>
                            )}
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Score</Label>
                            <Input
                              value={r.score}
                              onChange={(e) => updateRecord(r.id, { score: e.target.value })}
                              onBlur={() => saveEdited(r)}
                              inputMode="decimal"
                              className={`font-mono ${r.score && !scoreValid ? "border-destructive" : ""}`}
                              placeholder="e.g. 45 or 45/60"
                            />
                            {r.score && parsed.ok && (
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Score: <strong>{parsed.score}</strong>{parsed.total != null ? <> · out of <strong>{parsed.total}</strong></> : null}
                              </p>
                            )}
                            {r.score && !parsed.ok && (
                              <p className="text-[11px] text-destructive mt-1">Invalid: {parsed.reason}</p>
                            )}
                          </div>
                          <Button size="sm" onClick={() => saveEdited(r)}>Save</Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rescan(r)}
                            disabled={!hasFile || r.status === "scanning"}
                            title={hasFile ? "Re-read the original image" : "Original image not in this session"}
                            className="gap-1"
                          >
                            <RefreshCw className={`h-3 w-3 ${r.status === "scanning" ? "animate-spin" : ""}`} /> Re-scan
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => removeRecord(r.id)} title={r.dbId ? "Delete permanently" : "Remove"}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                        {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })()}
      </main>
    </div>
  );
}
