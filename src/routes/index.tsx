import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Upload, FileSpreadsheet, Trash2, Loader2, ScanLine, AlertCircle, CheckCircle2, LogOut, AlertTriangle, RefreshCw, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Toaster, toast } from "sonner";
import { extractScript } from "@/server/ocr.functions";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/")({ component: Index });

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
  score: string;   // raw user-entered or "score/total"
  total: string;   // parsed total
  confidence?: string;
  notes?: string;
  error?: string;
  pendingMerge?: PendingMerge;
};

const DEFAULT_PATTERN = "^[A-Z0-9/\\-]{4,20}$";

function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const [meta, b64] = result.split(",");
      const mime = meta.match(/data:(.*?);/)?.[1] ?? file.type;
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
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [course, setCourse] = useState("");
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);
  const [records, setRecords] = useState<Rec[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [exportingScores, setExportingScores] = useState(false);
  const [exportingReview, setExportingReview] = useState(false);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Holds original File for re-scan; cleared when record removed.
  const fileMap = useRef<Map<string, File>>(new Map());
  const CONCURRENCY = 4;

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

  const matricRegex = useMemo(() => {
    try { return new RegExp(pattern); } catch { return /.*/; }
  }, [pattern]);

  const updateRecord = (id: string, patch: Partial<Rec>) =>
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** Look up an existing DB row for (course, matric). */
  const findExisting = async (matric: string) => {
    const { data } = await supabase
      .from("scripts")
      .select("id,score,total,confidence")
      .eq("course", course.trim())
      .eq("matric", matric)
      .maybeSingle();
    return data;
  };

  /**
   * Persist a record. If a saved row already exists for the same (course,matric)
   * and this local record doesn't already point to it, returns pendingMerge so
   * the user can confirm before overwriting.
   */
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

    // Duplicate-detection before insert when we have a matric.
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

  /** OCR a single file and merge results into an existing record id. */
  const runOcr = useCallback(async (recId: string, file: File) => {
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
      return { ...next, fileName: file.name } as Partial<Rec>;
    } catch (e: any) {
      updateRecord(recId, { status: "error", error: e?.message ?? "OCR failed" });
      throw e;
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    if (!course.trim()) { toast.error("Enter a course name first"); return; }
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
        const res = await persistRecord(merged);
        if (res.pendingMerge) {
          updateRecord(rec.id, { status: "pending-merge", pendingMerge: res.pendingMerge, error: "Duplicate — confirm merge" });
        } else if (res.ok) {
          updateRecord(rec.id, { status: "saved", dbId: res.dbId, error: undefined });
        } else if (res.dbId) {
          updateRecord(rec.id, { dbId: res.dbId });
        }
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

  /** User confirmed: overwrite the existing DB row with this local OCR row. */
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

  /** User chose to keep the saved DB row instead — drop the local record. */
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
      const merged: Rec = { ...r, ...next } as Rec;
      const res = await persistRecord(merged);
      if (res.pendingMerge) {
        updateRecord(r.id, { status: "pending-merge", pendingMerge: res.pendingMerge, error: "Duplicate — confirm merge" });
      } else if (res.ok) {
        updateRecord(r.id, { status: "saved", dbId: res.dbId, error: undefined });
        toast.success("Re-scanned & saved");
      } else if (res.dbId) {
        updateRecord(r.id, { dbId: res.dbId });
        toast.warning(res.msg ?? "Re-scanned (needs review)");
      }
    } catch (e: any) {
      toast.error(`Re-scan failed`, { description: e?.message });
    }
    refreshReviewCount();
  };

  const removeRecord = async (id: string) => {
    const r = records.find((x) => x.id === id);
    if (r?.dbId) {
      const { error } = await supabase.from("scripts").delete().eq("id", r.dbId);
      if (error) { toast.error(`Delete failed: ${error.message}`); return; }
      toast.success("Deleted from database");
    }
    setRecords((rs) => rs.filter((x) => x.id !== id));
    fileMap.current.delete(id);
    refreshReviewCount();
  };

  const clearAll = () => { setRecords([]); fileMap.current.clear(); };

  const loadSaved = async () => {
    if (!course.trim()) { toast.error("Enter a course name first"); return; }
    setLoadingSaved(true);
    const { data, error } = await supabase
      .from("scripts").select("*").eq("course", course.trim())
      .order("matric", { ascending: true });
    setLoadingSaved(false);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.info("No saved scans for this course yet"); return; }
    const loaded: Rec[] = data.map((d: any) => {
      const matricValid = d.matric && matricRegex.test(d.matric);
      const scoreValid = d.score != null;
      const ok = matricValid && scoreValid;
      return {
        id: crypto.randomUUID(), dbId: d.id,
        fileName: d.file_name || "(saved)", preview: "",
        status: ok ? "saved" : "done",
        matric: d.matric ?? "",
        score: d.score != null ? String(d.score) : "",
        total: d.total != null ? String(d.total) : "",
        confidence: d.confidence ?? undefined, notes: d.notes ?? undefined,
        error: d.error ?? (!ok ? "Needs review" : undefined),
      };
    });
    setRecords((rs) => {
      const existingDbIds = new Set(rs.map((x) => x.dbId).filter(Boolean));
      return [...rs, ...loaded.filter((x) => !existingDbIds.has(x.dbId))];
    });
    toast.success(`Loaded ${loaded.length} saved record(s)`);
    refreshReviewCount();
  };

  const exportScores = async () => {
    if (!course.trim()) { toast.error("Enter course name"); return; }
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

  const exportReview = async () => {
    if (!course.trim()) { toast.error("Enter course name"); return; }
    setExportingReview(true);
    try {
      const { data, error } = await supabase
        .from("scripts").select("file_name,matric,score,total,confidence,notes,error,status,created_at")
        .eq("course", course.trim())
        .or("matric.is.null,score.is.null")
        .order("created_at");
      if (error) { toast.error(error.message); return; }
      if (!data?.length) { toast.info("No items need review"); return; }
      const rows: (string | number)[][] = [
        ["FILE", "MATRIC NO.", "SCORE", "TOTAL", "CONFIDENCE", "OCR ERROR / NOTES"],
        ...data.map((r: any) => [
          r.file_name || "", r.matric || "", r.score ?? "", r.total ?? "",
          r.confidence || "", [r.error, r.notes].filter(Boolean).join(" | "),
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 40 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Review");
      const filename = `${course.replace(/\s+/g, "_")}_needs_review.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Exported ${data.length} item(s) for review`, { description: filename });
    } finally { setExportingReview(false); }
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
  const reviewExportDisabled = !course.trim() || exportingReview || !reviewCount || reviewCount === 0;

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="border-b border-border/60 bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center text-primary-foreground flex-shrink-0" style={{ background: "var(--gradient-brand)" }}>
              <ScanLine className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight truncate">ScriptScan</h1>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
          <Button onClick={signOut} variant="ghost" size="sm" className="gap-1">
            <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="course">Course name *</Label>
            <Input id="course" placeholder="e.g. CSC301" value={course} onChange={(e) => setCourse(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pattern">Matric pattern (regex)</Label>
            <Input id="pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} className="font-mono text-xs" />
          </div>
        </section>

        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={exportScores} disabled={!course.trim() || exportingScores} className="gap-2">
            {exportingScores ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Export Scores .xlsx
          </Button>
          <Button
            onClick={exportReview}
            disabled={reviewExportDisabled}
            variant="outline"
            className="gap-2"
            title={reviewCount === 0 ? "No rows currently need review" : undefined}
          >
            {exportingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
            Export Review Excel{reviewCount ? ` (${reviewCount})` : ""}
          </Button>
          <Button onClick={loadSaved} disabled={!course.trim() || loadingSaved} variant="secondary" className="gap-2">
            {loadingSaved ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Load saved
          </Button>
          {course.trim() && reviewCount !== null && (
            <Badge variant={reviewCount > 0 ? "destructive" : "secondary"} className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {reviewCount} need{reviewCount === 1 ? "s" : ""} review
            </Badge>
          )}
        </div>

        <Card className="p-6 border-dashed border-2 bg-card/60" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}>
              <Upload className="h-7 w-7 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Upload marked scripts</h2>
              <p className="text-sm text-muted-foreground mt-1">Upload as many photos as you like — all save to <strong>{course || "(set course)"}</strong>. Duplicates by matric are flagged for merge.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
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
                  <Loader2 className="h-3 w-3 animate-spin" /> Scanning… {progress}%
                </p>
              </div>
            )}
          </div>
        </Card>

        {records.length > 0 && (() => {
          const sorted = [...records].sort((a, b) => {
            const am = (a.matric || "~").toUpperCase();
            const bm = (b.matric || "~").toUpperCase();
            return am.localeCompare(bm);
          });
          const matricCounts = new Map<string, number>();
          sorted.forEach((r) => {
            const m = r.matric.toUpperCase();
            if (m) matricCounts.set(m, (matricCounts.get(m) ?? 0) + 1);
          });
          return (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {records.length} record(s) · {savedCount} saved
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
                          <img src={r.preview} alt={r.fileName} className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-md border border-border hover:opacity-80 transition" />
                        </a>
                      ) : (
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-md border border-border flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">Saved</div>
                      )}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.status === "scanning" && <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Scanning</Badge>}
                          {r.status === "queued" && <Badge variant="outline">Queued</Badge>}
                          {r.status === "error" && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Error</Badge>}
                          {r.status === "saved" && <Badge className="gap-1 bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)]"><CheckCircle2 className="h-3 w-3" />Saved</Badge>}
                          {r.status === "pending-merge" && <Badge variant="destructive" className="gap-1"><GitMerge className="h-3 w-3" />Merge needed</Badge>}
                          {isDup && <Badge variant="outline" className="gap-1 border-[color:var(--color-warning)] text-[color:var(--color-warning)]">Duplicate ({matricCounts.get(matricUpper)})</Badge>}
                          {r.confidence && <Badge variant="outline" className="text-xs">conf: {r.confidence}</Badge>}
                          <span className="text-xs text-muted-foreground truncate">{r.fileName}</span>
                        </div>

                        {r.status === "pending-merge" && r.pendingMerge && (
                          <div className="rounded-md border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 p-2 text-xs space-y-2">
                            <p>
                              A saved row already exists for <strong>{matricUpper}</strong> in <strong>{course}</strong>.
                              {" "}Existing score: <strong>{r.pendingMerge.existingScore ?? "—"}{r.pendingMerge.existingTotal != null ? `/${r.pendingMerge.existingTotal}` : ""}</strong>
                              {r.pendingMerge.existingConfidence ? ` (conf: ${r.pendingMerge.existingConfidence})` : ""}.
                              {" "}This OCR row would write: <strong>{parsed.score ?? "—"}{parsed.total != null ? `/${parsed.total}` : ""}</strong>.
                            </p>
                            <div className="flex gap-2">
                              <Button size="sm" variant="destructive" onClick={() => confirmMerge(r)} className="gap-1">
                                <GitMerge className="h-3 w-3" /> Overwrite saved row
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => keepExisting(r)}>Keep existing</Button>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto_auto_auto] gap-2 items-end">
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
                              <p className="text-[11px] text-destructive mt-1">Doesn't match pattern</p>
                            )}
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Score (or score/total)</Label>
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
                                Score: <strong>{parsed.score}</strong>{parsed.total != null ? <> · Total: <strong>{parsed.total}</strong></> : null}
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
                            title={hasFile ? "Re-run OCR on the original image" : "Original image not in this session"}
                            className="gap-1"
                          >
                            <RefreshCw className={`h-3 w-3 ${r.status === "scanning" ? "animate-spin" : ""}`} /> Re-scan
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => removeRecord(r.id)} title={r.dbId ? "Delete from database" : "Remove"}>
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
