import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, Upload, FileSpreadsheet, Trash2, Loader2, AlertCircle, CheckCircle2, LogOut,
  AlertTriangle, GitMerge, Mic, Square, Archive, GraduationCap, X, Film,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster, toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { extractScript } from "@/lib/ocr.functions";
import { downloadScoresWorkbook, saveExportVersion, type ExportRow } from "@/lib/exportVersions";
import { extractFromAudio } from "@/lib/audio.functions";
import { extractVideoFrames } from "@/lib/videoFrames";
import { DEFAULT_MATRIC_SAMPLE, patternToRegex, describePattern } from "@/lib/matric";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { course?: string } =>
    typeof search.course === "string" && search.course ? { course: search.course } : {},
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
  const [roleChecked, setRoleChecked] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
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
  const CONCURRENCY = 2;

  // ---- video sweep state
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoAbort = useRef<{ aborted: boolean }>({ aborted: false });
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoStage, setVideoStage] = useState("");
  const [videoFound, setVideoFound] = useState(0);
  const VIDEO_STEP = 0.6;
  const VIDEO_RECHECK_STEP = 0.25;
  const videoStart = useRef(0);
  const [videoEta, setVideoEta] = useState("");
  const reportVideo = useCallback((pct: number, stage: string) => {
    const clamped = Math.min(100, Math.max(0, Math.round(pct)));
    setVideoProgress(clamped);
    setVideoStage(stage);
    const elapsed = (Date.now() - videoStart.current) / 1000;
    if (clamped >= 4 && clamped < 100 && elapsed > 1) {
      const remaining = Math.max(0, Math.round((elapsed / clamped) * (100 - clamped)));
      setVideoEta(remaining >= 60 ? `~${Math.floor(remaining / 60)}m ${remaining % 60}s left` : `~${remaining}s left`);
    } else {
      setVideoEta("");
    }
  }, []);
  const [maxScore, setMaxScore] = useState("");

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
            setRoleChecked(true);
          });
        }, 0);
      } else { setIsStaff(false); setRoleChecked(true); }
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthChecked(true);
      if (!data.session) navigate({ to: "/auth" });
      else {
        supabase.from("user_roles").select("role").eq("user_id", data.session.user.id).then(({ data: roles }) => {
          setIsStaff((roles ?? []).some((r) => r.role === "staff" || r.role === "admin"));
          setRoleChecked(true);
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
    const fallbackTotal = maxScore.trim() && Number.isFinite(Number(maxScore)) ? Number(maxScore) : null;
    const totalNum = parsed.total ?? (r.total !== "" && Number.isFinite(Number(r.total)) ? Number(r.total) : fallbackTotal);
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
        }, { onConflict: "user_id,course,matric" }).select().single();
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

  // ================= VIDEO SWEEP =================
  const confRank = (c?: string) => (c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0);

  const handleVideo = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!course.trim()) { toast.error("Enter a course code first"); return; }
    videoAbort.current = { aborted: false };
    setVideoBusy(true);
    videoStart.current = Date.now();
    reportVideo(0, "Reading video…");
    setVideoFound(0);

    const capTotal = maxScore.trim() && Number.isFinite(Number(maxScore)) ? Number(maxScore) : null;

    type Det = {
      recId: string;
      matric: string;
      score: number;
      total: number | null;
      confidence?: string;
      notes?: string;
      votes: Map<number, number>;
      preview: string;
      fileName: string;
    };
    const dets = new Map<string, Det>(); // matric -> best detection

    /** Smart dedup: repeated sightings of the same matric collapse into one row. */
    const ingest = (
      matric: string,
      result: { score: number; total: number | null; confidence?: string; notes?: string },
      frame: { time: number; blob: Blob; preview: string },
    ) => {
      const existing = dets.get(matric);
      const stamp = new Date(frame.time * 1000).toISOString().slice(14, 19);
      const fileName = `video-${stamp}.jpg`;
      const plausible = (s: number, t: number | null) => {
        const cap = t ?? capTotal;
        return s >= 0 && (cap == null || s <= cap);
      };

      if (!existing) {
        const recId = crypto.randomUUID();
        const det: Det = {
          recId, matric, score: result.score, total: result.total ?? capTotal,
          confidence: result.confidence, notes: result.notes,
          votes: new Map([[result.score, 1]]), preview: frame.preview, fileName,
        };
        dets.set(matric, det);
        fileMap.current.set(recId, new File([frame.blob], fileName, { type: "image/jpeg" }));
        setRecords((rs) => [...rs, {
          id: recId, fileName, preview: frame.preview, status: "done", matric,
          score: String(det.score), total: det.total != null ? String(det.total) : "",
          confidence: det.confidence, notes: det.notes,
        }]);
        setVideoFound((n) => n + 1);
        return;
      }

      existing.votes.set(result.score, (existing.votes.get(result.score) ?? 0) + 1);
      const better =
        (plausible(result.score, result.total) && !plausible(existing.score, existing.total)) ||
        (plausible(result.score, result.total) === plausible(existing.score, existing.total) &&
          (confRank(result.confidence) > confRank(existing.confidence) ||
            (confRank(result.confidence) === confRank(existing.confidence) &&
              (existing.votes.get(result.score) ?? 0) > (existing.votes.get(existing.score) ?? 0))));

      if (better) {
        existing.score = result.score;
        existing.total = result.total ?? existing.total ?? capTotal;
        existing.confidence = result.confidence;
        existing.notes = result.notes;
        existing.preview = frame.preview;
        fileMap.current.set(existing.recId, new File([frame.blob], existing.fileName, { type: "image/jpeg" }));
        updateRecord(existing.recId, {
          score: String(existing.score),
          total: existing.total != null ? String(existing.total) : "",
          confidence: existing.confidence,
          notes: existing.notes,
          preview: frame.preview,
        });
      }
    };

    const readFrames = async (
      frames: { time: number; blob: Blob; preview: string }[],
      onTick: (done: number) => void,
    ) => {
      let done = 0;
      const queue = frames.map((_, i) => i);
      const readFrame = async (i: number) => {
        const frame = frames[i];
        try {
          const { base64, mime } = await fileToBase64(frame.blob);
          const result = await extractScript({ data: { imageBase64: base64, mimeType: mime } });
          const matric = (result.matric_no ?? "").toUpperCase().replace(/\s+/g, "");
          const valid = !!matric && matricRegex.test(matric);
          if (!valid || result.score == null) return;
          ingest(matric, {
            score: Number(result.score),
            total: result.total != null ? Number(result.total) : null,
            confidence: result.confidence,
            notes: result.notes,
          }, frame);
        } catch {
          /* skip unreadable frame, keep the sweep moving */
        } finally {
          done++;
          onTick(done);
        }
      };
      const workers = Array.from({ length: Math.min(CONCURRENCY, frames.length) }, async () => {
        while (queue.length && !videoAbort.current?.aborted) {
          const i = queue.shift();
          if (i === undefined) break;
          await readFrame(i);
        }
      });
      await Promise.all(workers);
    };

    try {
      // ---- Pass 1: standard sweep at a fixed 1.0s sampling interval
      const frames = await extractVideoFrames(file, {
        step: VIDEO_STEP,
        onProgress: (pct) => reportVideo(pct * 0.25, `Sweeping footage… ${pct}%`),
        signal: videoAbort.current,
      });

      if (videoAbort.current.aborted) { toast.info("Video sweep cancelled"); return; }
      if (!frames.length) { toast.error("No readable frames found in that video"); return; }

      setVideoStage(`Reading ${frames.length} frame(s)…`);
      await readFrames(frames, (done) =>
        reportVideo(25 + (done / frames.length) * 40, `Reading frame ${done} of ${frames.length}…`),
      );

      // ---- Pass 2: automatic reconfirmation — finer, more sensitive sweep so no
      // script slipped through and every score is double-checked.
      if (!videoAbort.current.aborted) {
        setVideoStage("Reconfirming — second pass over the footage…");
        const recheck = await extractVideoFrames(file, {
          step: VIDEO_RECHECK_STEP,
          diffThreshold: 2,
          minSharpness: 2,
          onProgress: (pct) => reportVideo(65 + pct * 0.1, `Reconfirming footage… ${pct}%`),
          signal: videoAbort.current,
        });
        setVideoStage(`Reconfirming ${recheck.length} frame(s)…`);
        await readFrames(recheck, (done) =>
          reportVideo(75 + (done / Math.max(1, recheck.length)) * 25, `Reconfirming frame ${done} of ${recheck.length}…`),
        );
      }

      // ---- File every deduplicated row once
      setVideoStage("Filing records…");
      for (const det of dets.values()) {
        const rec: Rec = {
          id: det.recId, fileName: det.fileName, preview: det.preview, status: "done",
          matric: det.matric, score: String(det.score),
          total: det.total != null ? String(det.total) : "",
          confidence: det.confidence, notes: det.notes,
        };
        applyPersistResult(det.recId, await persistRecord(rec));
      }

      reportVideo(100, "Complete");
      toast.success("Video sweep complete", {
        description: `${dets.size} matric number(s) confirmed after two passes`,
      });
      refreshReviewCount();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not process that video");
    } finally {
      setVideoBusy(false);
      setVideoStage("");
      setVideoEta("");
    }
  }, [course, user, matricRegex, refreshReviewCount, maxScore, reportVideo]);

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

  /**
   * Exports EXACTLY the entries currently on this page — nothing else from the
   * archive — then wipes the console so the next batch starts from scratch.
   */
  const exportScores = async () => {
    if (!course.trim()) { toast.error("Enter course code"); return; }
    setExportingScores(true);
    try {
      const byMatric = new Map<string, ExportRow>();
      for (const r of records) {
        const m = r.matric.toUpperCase().trim();
        const parsed = parseScore(r.score);
        if (!m || !matricRegex.test(m) || parsed.score == null || !parsed.ok) continue;
        byMatric.set(m, { matric: m, score: parsed.score, confidence: r.confidence ?? "", error: r.error ?? r.notes ?? "" });
      }
      const entries = [...byMatric.values()].sort((a, b) => a.matric.localeCompare(b.matric));
      if (!entries.length) { toast.error("Nothing complete to export on this page"); return; }

      const saved = await saveExportVersion(course.trim(), entries);
      const filename = saved?.filename ?? `${course.replace(/\s+/g, "_")}_scores.xlsx`;
      downloadScoresWorkbook(entries, filename);
      toast.success(`Exported ${entries.length} record(s)${saved?.version ? ` — version ${saved.version}` : ""}`, { description: filename });

      // Fresh slate — this batch is closed.
      setRecords([]);
      fileMap.current.clear();
      setTranscript("");
      setProgress(0);
      setCourse("");
      setReviewCount(null);
      openedRef.current = true;
    } finally { setExportingScores(false); }
  };

  const signOut = async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); };

  if (!authChecked || (user && !roleChecked))
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!user) return null;
  if (!isStaff) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="panel max-w-md px-6 py-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-[color:var(--color-warning)]" />
          <h2 className="mt-3 text-[18px] font-semibold">Access pending</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This account does not yet have examination officer access. Contact your administrator.
          </p>
          <Button onClick={signOut} variant="outline" className="mt-4 h-10">Sign out</Button>
        </div>
      </div>
    );
  }

  const savedCount = records.filter((r) => r.status === "saved").length;
  const tabTrigger =
    "flex-1 gap-2 rounded-[6px] text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none sm:flex-none sm:px-4";

  return (
    <AppShell
      title="Examination Capture"
      description="Digitise marked scripts by photograph, recorded video sweep or dictation, then issue a verified result workbook."
      session={course.trim() ? `${course.trim()} · ${records.length} script(s) in register` : undefined}
      actions={
        <Button
          onClick={() => setConfirmExport(true)}
          disabled={!course.trim() || exportingScores}
          className="h-10 gap-2"
        >
          {exportingScores ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Export Scores .xlsx
        </Button>
      }
    >
      <Toaster richColors position="top-center" />

      <AlertDialog open={confirmExport} onOpenChange={setConfirmExport}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Export and clear this page?</AlertDialogTitle>
            <AlertDialogDescription>
              A new numbered version of <strong>{course}</strong> will be saved to the examination record and downloaded.
              The capture register on this page will then be cleared so the next examination starts fresh. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmExport(false); exportScores(); }}>Export &amp; clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-6">
        {/* Step 1 — examination details */}
        <Panel
          title="1. Examination details"
          description="Recorded against every script captured in this session."
          actions={
            course.trim() && reviewCount !== null ? (
              reviewCount > 0
                ? <StatusPill tone="warning">{reviewCount} incomplete entr{reviewCount === 1 ? "y" : "ies"}</StatusPill>
                : <StatusPill tone="success">All entries complete</StatusPill>
            ) : null
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="course" className="field-label">Course code *</Label>
              <Input id="course" className="h-10" placeholder="e.g. CSC 301" value={course} onChange={(e) => setCourse(e.target.value)} />
              <p className="text-[12px] text-muted-foreground">Required before scripts can be filed.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pattern" className="field-label">Matric number sample</Label>
              <Input id="pattern" className="h-10 font-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={DEFAULT_MATRIC_SAMPLE} />
              <p className="text-[12px] text-muted-foreground">{describePattern(pattern)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="maxscore" className="field-label">Graded over (maximum)</Label>
              <Input id="maxscore" className="h-10 font-mono" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} inputMode="numeric" placeholder="e.g. 60" />
              <p className="text-[12px] text-muted-foreground">
                {maxScore.trim() ? `Scores checked against a maximum of ${maxScore.trim()}.` : "Optional — used to validate detected scores."}
              </p>
            </div>
          </div>
        </Panel>

        {/* Step 2 — capture method */}
        <Panel title="2. Capture method" description="All three methods file into the same verification register.">
          <Tabs defaultValue="upload">
            <TabsList className="mb-5 h-11 w-full justify-start gap-1 rounded-md bg-muted p-1 sm:w-auto">
              <TabsTrigger value="upload" className={tabTrigger}><Upload className="h-4 w-4" />Photographs</TabsTrigger>
              <TabsTrigger value="video" className={tabTrigger}><Film className="h-4 w-4" />Video sweep</TabsTrigger>
              <TabsTrigger value="voice" className={tabTrigger}><Mic className="h-4 w-4" />Dictation</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-0">
              <div className="rounded-md border border-dashed border-border bg-muted/40 px-5 py-8 text-center">
                <h3 className="section-title">Upload marked scripts</h3>
                <p className="mx-auto mt-1.5 max-w-lg text-[14px] text-muted-foreground">
                  Select any number of photographs. Everything is filed under{" "}
                  <span className="font-medium text-foreground">{course || "(set course code)"}</span>, and repeated matric
                  numbers are flagged for merge.
                </p>
                <div className="mt-5 flex flex-col justify-center gap-2.5 sm:flex-row">
                  <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                  <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                  <Button onClick={() => cameraRef.current?.click()} disabled={busy} className="h-10 gap-2">
                    <Camera className="h-4 w-4" /> Take photo
                  </Button>
                  <Button onClick={() => galleryRef.current?.click()} disabled={busy} variant="outline" className="h-10 gap-2">
                    <Upload className="h-4 w-4" /> Choose images
                  </Button>
                </div>
                {busy && (
                  <div className="mx-auto mt-6 grid max-w-md gap-2">
                    <div className="flex items-center gap-3">
                      <Progress value={progress} className="h-1.5 flex-1" />
                      <span className="w-12 text-right text-[13px] font-semibold tabular-nums">{progress}%</span>
                    </div>
                    <p className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading scripts…
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="video" className="mt-0">
              <div className="rounded-md border border-dashed border-border bg-muted/40 px-5 py-8 text-center">
                <h3 className="section-title">Recorded video sweep</h3>
                <p className="mx-auto mt-1.5 max-w-xl text-[14px] text-muted-foreground">
                  Upload a video of the scripts being turned over. The footage is walked frame by frame — blurred and
                  repeated frames are discarded — and every matric number matching{" "}
                  <span className="font-mono text-foreground">{pattern}</span> with a score is filed once, automatically.
                </p>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={(e) => { handleVideo(e.target.files?.[0]); e.target.value = ""; }} />
                  <Button onClick={() => videoInputRef.current?.click()} disabled={videoBusy} className="h-10 gap-2">
                    <Film className="h-4 w-4" /> Upload video
                  </Button>
                  {videoBusy && (
                    <Button variant="outline" className="h-10 gap-2" onClick={() => { videoAbort.current.aborted = true; }}>
                      <X className="h-4 w-4" /> Stop sweep
                    </Button>
                  )}
                </div>

                <p className="mt-4 text-[12px] text-muted-foreground">
                  {VIDEO_STEP.toFixed(1)}s primary sampling · {VIDEO_RECHECK_STEP}s reconfirmation pass · maximum digit precision
                </p>

                {videoBusy && (
                  <div className="mx-auto mt-5 grid max-w-md gap-2">
                    <div className="flex items-center gap-3">
                      <Progress value={videoProgress} className="h-1.5 flex-1" />
                      <span className="w-12 text-right text-[13px] font-semibold tabular-nums">{videoProgress}%</span>
                    </div>
                    <p className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {videoStage} · {videoFound} record(s) filed
                      {videoEta && <span className="font-medium text-foreground">· {videoEta}</span>}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="voice" className="mt-0">
              <div className="rounded-md border border-dashed border-border bg-muted/40 px-5 py-8 text-center">
                <h3 className="section-title">Spoken dictation</h3>
                <p className="mx-auto mt-1.5 max-w-xl text-[14px] text-muted-foreground">
                  Press record and read out entries one after another — “{DEFAULT_MATRIC_SAMPLE}, score 45” — then press
                  Done. Every entry is filed and added to the register below.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  {!recording ? (
                    <Button onClick={startRecording} disabled={transcribing} className="h-10 gap-2">
                      <Mic className="h-4 w-4" /> Start dictation
                    </Button>
                  ) : (
                    <Button onClick={stopRecording} variant="destructive" className="h-10 gap-2">
                      <Square className="h-4 w-4" /> Done
                    </Button>
                  )}
                  {recording && <StatusPill tone="error">Recording</StatusPill>}
                  {transcribing && (
                    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Interpreting recording…
                    </span>
                  )}
                </div>
                {transcript && (
                  <div className="mx-auto mt-5 max-w-2xl rounded-md border border-border bg-card px-3.5 py-3 text-left">
                    <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">TRANSCRIPT</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{transcript}</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </Panel>

        {/* Step 3 — verification register */}
        {records.length > 0 && (() => {
          const sorted = [...records].sort((a, b) => (a.matric || "~").toUpperCase().localeCompare((b.matric || "~").toUpperCase()));
          const matricCounts = new Map<string, number>();
          sorted.forEach((r) => {
            const m = r.matric.toUpperCase();
            if (m) matricCounts.set(m, (matricCounts.get(m) ?? 0) + 1);
          });
          return (
            <Panel
              title="3. Verification register"
              description={`${records.length} record(s) captured · ${savedCount} filed`}
              actions={
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={clearAll}>
                  <Trash2 className="h-4 w-4" /> Clear register
                </Button>
              }
            >
              <ul className="grid gap-2.5">
                {sorted.map((r) => {
                  const matricUpper = r.matric.toUpperCase();
                  const matricValid = !!matricUpper && matricRegex.test(matricUpper);
                  const parsed = parseScore(r.score);
                  const capNum = maxScore.trim() && Number.isFinite(Number(maxScore)) ? Number(maxScore) : null;
                  const overCap = parsed.ok && parsed.score != null && capNum != null && parsed.score > capNum;
                  const scoreValid = parsed.ok && !overCap;
                  const isDup = matricUpper && (matricCounts.get(matricUpper) ?? 0) > 1;
                  const incomplete = r.status !== "scanning" && r.status !== "queued" && (!matricValid || !scoreValid);
                  return (
                    <li
                      key={r.id}
                      className={`flex items-start gap-3 rounded-md border px-3.5 py-3 ${
                        incomplete
                          ? "border-destructive/40 border-l-[3px] border-l-destructive bg-destructive/[0.04]"
                          : isDup || r.status === "pending-merge"
                            ? "border-border border-l-[3px] border-l-[color:var(--color-warning)]"
                            : "border-border"
                      }`}
                    >
                      {r.preview ? (
                        <a href={r.preview} target="_blank" rel="noopener noreferrer" className="shrink-0">
                          <img
                            src={r.preview}
                            alt={`Captured script ${r.fileName}`}
                            className="h-20 w-20 rounded-md border border-border object-cover transition hover:opacity-85 sm:h-24 sm:w-24"
                          />
                        </a>
                      ) : (
                        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md border border-border text-[11px] font-medium text-muted-foreground sm:h-24 sm:w-24">
                          {r.fileName === "dictated" ? "Dictation" : "Filed"}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {incomplete && (
                            <StatusPill tone="error">
                              Incomplete — {!matricValid && !scoreValid ? "matric & score" : !matricValid ? "matric" : "score"}
                            </StatusPill>
                          )}
                          {r.status === "scanning" && <StatusPill tone="info"><Loader2 className="h-3 w-3 animate-spin" />Reading</StatusPill>}
                          {r.status === "queued" && <StatusPill tone="neutral">Queued</StatusPill>}
                          {r.status === "error" && <StatusPill tone="error"><AlertCircle className="h-3 w-3" />Error</StatusPill>}
                          {r.status === "saved" && <StatusPill tone="success"><CheckCircle2 className="h-3 w-3" />Filed</StatusPill>}
                          {r.status === "pending-merge" && <StatusPill tone="warning"><GitMerge className="h-3 w-3" />Merge required</StatusPill>}
                          {isDup && <StatusPill tone="warning">Duplicate ({matricCounts.get(matricUpper)})</StatusPill>}
                          {r.confidence && <StatusPill tone="neutral">Confidence: {r.confidence}</StatusPill>}
                          <span className="truncate text-[12px] text-muted-foreground">{r.fileName}</span>
                        </div>

                        {r.status === "pending-merge" && r.pendingMerge && (
                          <div className="mt-2.5 rounded-md border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning)]/[0.08] px-3 py-2.5 text-[13px]">
                            <p>
                              A filed record already exists for <strong>{matricUpper}</strong> in <strong>{course}</strong>.
                              {" "}Existing score:{" "}
                              <strong>{r.pendingMerge.existingScore ?? "—"}{r.pendingMerge.existingTotal != null ? `/${r.pendingMerge.existingTotal}` : ""}</strong>
                              {r.pendingMerge.existingConfidence ? ` (confidence: ${r.pendingMerge.existingConfidence})` : ""}.
                              {" "}This capture would write:{" "}
                              <strong>{parsed.score ?? "—"}{parsed.total != null ? `/${parsed.total}` : ""}</strong>.
                            </p>
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <Button size="sm" variant="destructive" className="h-9 gap-1.5" onClick={() => confirmMerge(r)}>
                                <GitMerge className="h-4 w-4" /> Overwrite filed record
                              </Button>
                              <Button size="sm" variant="outline" className="h-9" onClick={() => keepExisting(r)}>Keep existing</Button>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto_auto]">
                          <div className="grid gap-1.5">
                            <Label className="field-label" htmlFor={`matric-${r.id}`}>Matric No.</Label>
                            <Input
                              id={`matric-${r.id}`}
                              value={r.matric}
                              onChange={(e) => updateRecord(r.id, { matric: e.target.value.toUpperCase() })}
                              onBlur={() => saveEdited({ ...r, matric: r.matric.toUpperCase() })}
                              className={`h-10 font-mono ${r.matric && !matricValid ? "border-destructive" : ""}`}
                              placeholder="Not detected"
                            />
                            {r.matric && !matricValid && (
                              <p className="text-[12px] text-destructive">Does not match the {pattern} pattern</p>
                            )}
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="field-label" htmlFor={`score-${r.id}`}>Score</Label>
                            <Input
                              id={`score-${r.id}`}
                              value={r.score}
                              onChange={(e) => updateRecord(r.id, { score: e.target.value })}
                              onBlur={() => saveEdited(r)}
                              inputMode="decimal"
                              className={`h-10 font-mono ${r.score && !scoreValid ? "border-destructive" : ""}`}
                              placeholder="45 or 45/60"
                            />
                            {r.score && !parsed.ok && <p className="text-[12px] text-destructive">Invalid: {parsed.reason}</p>}
                            {r.score && parsed.ok && overCap && (
                              <p className="text-[12px] text-destructive">Above the {maxScore.trim()} maximum</p>
                            )}
                          </div>
                          <Button className="h-10" onClick={() => saveEdited(r)}>Save</Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 text-destructive"
                            onClick={() => removeRecord(r.id)}
                            aria-label={r.dbId ? "Delete record permanently" : "Remove record"}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {r.error && <p className="mt-2 text-[13px] text-destructive">{r.error}</p>}
                        {r.notes && <p className="mt-1 text-[13px] text-muted-foreground">{r.notes}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })()}
      </div>
    </AppShell>
  );
}

