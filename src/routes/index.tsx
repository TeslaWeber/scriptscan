import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Upload, FileSpreadsheet, Trash2, Loader2, ScanLine, AlertCircle, CheckCircle2, Pencil, LogOut, AlertTriangle } from "lucide-react";
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

type Status = "queued" | "scanning" | "done" | "saved" | "error";
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
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Auth bootstrap
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => {
          supabase.from("user_roles").select("role").eq("user_id", session.user.id).then(({ data }) => {
            setIsStaff((data ?? []).some((r) => r.role === "staff" || r.role === "admin"));
          });
        }, 0);
      } else {
        setIsStaff(false);
      }
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

  // Save a fully-validated record to DB (dedupe via unique index)
  const persistRecord = async (r: Rec) => {
    if (!course.trim()) return { ok: false, msg: "Set a course name first" };
    if (!user) return { ok: false, msg: "Not signed in" };
    const score = Number(r.score);
    if (!r.matric || !matricRegex.test(r.matric) || !Number.isFinite(score)) {
      return { ok: false, msg: "Invalid matric or score" };
    }
    const { data, error } = await supabase
      .from("scripts")
      .upsert(
        {
          user_id: user.id,
          course: course.trim(),
          matric: r.matric.toUpperCase(),
          score,
          total: r.total ? Number(r.total) : null,
          confidence: r.confidence ?? null,
          notes: r.notes ?? null,
          status: "done",
        },
        { onConflict: "course,matric", ignoreDuplicates: false }
      )
      .select()
      .single();
    if (error) return { ok: false, msg: error.message };
    return { ok: true, dbId: data.id };
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    if (!course.trim()) { toast.error("Enter a course name first"); return; }
    const list = Array.from(files);
    const newRecs: Rec[] = list.map((f) => ({
      id: crypto.randomUUID(),
      fileName: f.name,
      preview: URL.createObjectURL(f),
      status: "queued",
      matric: "",
      score: "",
      total: "",
    }));
    setRecords((rs) => [...rs, ...newRecs]);
    setBusy(true);
    setProgress(0);

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const rec = newRecs[i];
      updateRecord(rec.id, { status: "scanning" });
      try {
        const { base64, mime } = await fileToBase64(file);
        const result = await extractScript({ data: { imageBase64: base64, mimeType: mime } });
        const matric = (result.matric_no ?? "").toUpperCase().replace(/\s+/g, "");
        const score = result.score != null ? String(result.score) : "";
        const total = result.total != null ? String(result.total) : "";
        const next: Partial<Rec> = {
          status: "done",
          matric, score, total,
          confidence: result.confidence,
          notes: result.notes,
          error: !matric || result.score == null ? "Review needed" : undefined,
        };
        updateRecord(rec.id, next);
        // Auto-save if valid
        const merged: Rec = { ...rec, ...next } as Rec;
        if (merged.matric && matricRegex.test(merged.matric) && Number.isFinite(Number(merged.score))) {
          const res = await persistRecord(merged);
          if (res.ok) updateRecord(rec.id, { status: "saved", dbId: res.dbId });
          else updateRecord(rec.id, { error: res.msg });
        }
      } catch (e: any) {
        updateRecord(rec.id, { status: "error", error: e?.message ?? "OCR failed" });
        toast.error(`Failed: ${file.name}`, { description: e?.message });
      }
      setProgress(Math.round(((i + 1) / list.length) * 100));
    }
    setBusy(false);
    toast.success("Scan complete");
  }, [course, user, matricRegex]);

  const saveEdited = async (r: Rec) => {
    const res = await persistRecord(r);
    if (res.ok) {
      updateRecord(r.id, { status: "saved", dbId: res.dbId, error: undefined });
      toast.success("Saved");
    } else {
      toast.error(res.msg);
    }
  };

  const removeRecord = async (id: string) => {
    const r = records.find((x) => x.id === id);
    if (r?.dbId) await supabase.from("scripts").delete().eq("id", r.dbId);
    setRecords((rs) => rs.filter((x) => x.id !== id));
  };

  const clearAll = () => setRecords([]);

  // Export READY scores from DB (full course history, deduplicated)
  const exportScores = async () => {
    if (!course.trim()) { toast.error("Enter course name"); return; }
    const { data, error } = await supabase
      .from("scripts")
      .select("matric,score")
      .eq("course", course.trim())
      .not("score", "is", null)
      .order("matric");
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error("No saved scores for this course"); return; }
    const rows: (string | number)[][] = [["MATRIC NO.", "SCORE"], ...data.map((r) => [r.matric, Number(r.score)])];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 22 }, { wch: 10 }];
    for (let i = 2; i <= rows.length; i++) { const c = ws[`B${i}`]; if (c) c.t = "n"; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Scores");
    XLSX.writeFile(wb, `${course.replace(/\s+/g, "_")}_scores.xlsx`);
    toast.success(`Exported ${data.length} record(s)`);
  };

  // Export REVIEW list from current session (unsaved/needs-attention)
  const exportReview = () => {
    const rows = records.filter((r) => r.status !== "saved");
    if (!rows.length) { toast.error("Nothing to review"); return; }
    const data: (string | number)[][] = [
      ["FILE", "MATRIC NO.", "SCORE", "TOTAL", "CONFIDENCE", "STATUS", "ERROR / NOTES"],
      ...rows.map((r) => [
        r.fileName,
        r.matric || "",
        r.score || "",
        r.total || "",
        r.confidence || "",
        r.status,
        [r.error, r.notes].filter(Boolean).join(" | "),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Review");
    XLSX.writeFile(wb, `${(course || "scripts").replace(/\s+/g, "_")}_review.xlsx`);
    toast.success(`Exported ${rows.length} item(s) for review`);
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

  const reviewCount = records.filter((r) => r.status !== "saved").length;
  const savedCount = records.filter((r) => r.status === "saved").length;

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

        <div className="flex flex-wrap gap-2">
          <Button onClick={exportScores} disabled={!course.trim()} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Export Scores .xlsx
          </Button>
          <Button onClick={exportReview} disabled={!reviewCount} variant="outline" className="gap-2">
            <AlertTriangle className="h-4 w-4" /> Export Review .xlsx {reviewCount > 0 && <Badge variant="secondary">{reviewCount}</Badge>}
          </Button>
        </div>

        <Card className="p-6 border-dashed border-2 bg-card/60" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}>
              <Upload className="h-7 w-7 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Upload marked scripts</h2>
              <p className="text-sm text-muted-foreground mt-1">Valid scans auto-save to <strong>{course || "(set course)"}</strong>. Duplicates are merged.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFiles(e.target.files)} />
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

        {records.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Session · {savedCount} saved · {reviewCount} need review
              </h3>
              <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1"><Trash2 className="h-3 w-3" /> Clear</Button>
            </div>
            <div className="grid gap-3">
              {records.map((r) => {
                const matricValid = r.matric && matricRegex.test(r.matric);
                const scoreValid = r.score && Number.isFinite(Number(r.score));
                const ok = r.status === "saved";
                return (
                  <Card key={r.id} className="p-3 flex gap-3 items-start" style={{ boxShadow: "var(--shadow-card)" }}>
                    <img src={r.preview} alt={r.fileName} className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-md border border-border flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.status === "scanning" && <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Scanning</Badge>}
                        {r.status === "queued" && <Badge variant="outline">Queued</Badge>}
                        {r.status === "error" && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Error</Badge>}
                        {ok && <Badge className="gap-1 bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)]"><CheckCircle2 className="h-3 w-3" />Saved</Badge>}
                        {r.status === "done" && !ok && <Badge className="gap-1 bg-[color:var(--color-warning)] text-[color:var(--color-warning-foreground)]"><Pencil className="h-3 w-3" />Review</Badge>}
                        {r.confidence && <Badge variant="outline" className="text-xs">{r.confidence}</Badge>}
                        <span className="text-xs text-muted-foreground truncate">{r.fileName}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px_100px_auto_auto] gap-2 items-end">
                        <div>
                          <Label className="text-xs text-muted-foreground">Matric No.</Label>
                          <Input value={r.matric} onChange={(e) => updateRecord(r.id, { matric: e.target.value.toUpperCase(), status: "done" })} className={`font-mono ${r.matric && !matricValid ? "border-destructive" : ""}`} placeholder="—" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Score</Label>
                          <Input value={r.score} onChange={(e) => updateRecord(r.id, { score: e.target.value, status: "done" })} type="number" placeholder="—" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Total</Label>
                          <Input value={r.total} onChange={(e) => updateRecord(r.id, { total: e.target.value })} type="number" placeholder="—" />
                        </div>
                        <Button size="sm" onClick={() => saveEdited(r)} disabled={!matricValid || !scoreValid}>Save</Button>
                        <Button variant="ghost" size="icon" onClick={() => removeRecord(r.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                      {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
