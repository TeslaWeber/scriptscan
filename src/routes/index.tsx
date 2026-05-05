import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Camera, Upload, FileSpreadsheet, Trash2, Loader2, ScanLine, AlertCircle, CheckCircle2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Toaster, toast } from "sonner";
import { extractScript } from "@/server/ocr.functions";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/")({ component: Index });

type Status = "queued" | "scanning" | "done" | "error";
type Record = {
  id: string;
  fileName: string;
  preview: string;
  status: Status;
  matric: string;
  score: string; // numeric string
  total: string;
  confidence?: "high" | "medium" | "low";
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
  const [course, setCourse] = useState("");
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);
  const [records, setRecords] = useState<Record[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const matricRegex = useMemo(() => {
    try { return new RegExp(pattern); } catch { return /.*/; }
  }, [pattern]);

  const updateRecord = (id: string, patch: Partial<Record>) =>
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    const newRecs: Record[] = list.map((f) => ({
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
        updateRecord(rec.id, {
          status: "done",
          matric,
          score: result.score != null ? String(result.score) : "",
          total: result.total != null ? String(result.total) : "",
          confidence: result.confidence,
          error: !matric || result.score == null ? "Review needed" : undefined,
        });
      } catch (e: any) {
        updateRecord(rec.id, { status: "error", error: e?.message ?? "OCR failed" });
        toast.error(`Failed: ${file.name}`, { description: e?.message });
      }
      setProgress(Math.round(((i + 1) / list.length) * 100));
    }

    setBusy(false);
    toast.success("Scan complete", { description: `${list.length} script(s) processed.` });
  }, []);

  const removeRecord = (id: string) => setRecords((rs) => rs.filter((r) => r.id !== id));
  const clearAll = () => setRecords([]);

  const validRecords = records.filter(
    (r) => r.status === "done" && r.matric && r.score && matricRegex.test(r.matric),
  );
  // dedupe by matric
  const exportRows = useMemo(() => {
    const map = new Map<string, { matric: string; score: number }>();
    for (const r of validRecords) {
      const score = Number(r.score);
      if (Number.isFinite(score)) map.set(r.matric, { matric: r.matric, score });
    }
    return Array.from(map.values()).sort((a, b) => a.matric.localeCompare(b.matric));
  }, [validRecords]);

  const exportXlsx = () => {
    if (!exportRows.length) {
      toast.error("Nothing to export", { description: "Add valid scanned records first." });
      return;
    }
    const data = [
      ["MATRIC NO.", "SCORE"],
      ...exportRows.map((r) => [r.matric, r.score]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 22 }, { wch: 10 }];
    // type SCORE column as number
    for (let i = 2; i <= data.length; i++) {
      const cell = ws[`B${i}`];
      if (cell) cell.t = "n";
    }
    const wb = XLSX.utils.book_new();
    const sheetName = (course || "Scores").slice(0, 28).replace(/[^A-Za-z0-9 _-]/g, "");
    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Scores");
    const fname = `${(course || "scores").replace(/\s+/g, "_")}_scores.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success("Exported", { description: fname });
  };

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />

      <header className="border-b border-border/60 bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center text-primary-foreground" style={{ background: "var(--gradient-brand)" }}>
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">ScriptScan</h1>
              <p className="text-xs text-muted-foreground">Marked scripts → Excel, in minutes</p>
            </div>
          </div>
          <Button onClick={exportXlsx} disabled={!exportRows.length} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
            <span>.xlsx</span>
            {exportRows.length > 0 && <Badge variant="secondary" className="ml-1">{exportRows.length}</Badge>}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="course">Course / Sheet name</Label>
            <Input id="course" placeholder="e.g. CSC301 — Algorithms" value={course} onChange={(e) => setCourse(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pattern">Matric number pattern (regex)</Label>
            <Input id="pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} className="font-mono text-xs" />
          </div>
        </section>

        <Card className="p-6 border-dashed border-2 bg-card/60" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}>
              <Upload className="h-7 w-7 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Upload marked scripts</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Use camera or pick from gallery. We detect matric number and score automatically.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFiles(e.target.files)} />
              <Button onClick={() => cameraRef.current?.click()} disabled={busy} className="gap-2" size="lg">
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
                Records · {records.length} · {exportRows.length} ready
              </h3>
              <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground gap-1">
                <Trash2 className="h-3 w-3" /> Clear
              </Button>
            </div>

            <div className="grid gap-3">
              {records.map((r) => {
                const matricValid = r.matric && matricRegex.test(r.matric);
                const scoreValid = r.score && Number.isFinite(Number(r.score));
                const ok = r.status === "done" && matricValid && scoreValid;
                return (
                  <Card key={r.id} className="p-3 flex gap-3 items-start" style={{ boxShadow: "var(--shadow-card)" }}>
                    <img src={r.preview} alt={r.fileName} className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-md border border-border flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.status === "scanning" && <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Scanning</Badge>}
                        {r.status === "queued" && <Badge variant="outline">Queued</Badge>}
                        {r.status === "error" && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Error</Badge>}
                        {r.status === "done" && ok && <Badge className="gap-1 bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)] hover:bg-[color:var(--color-success)]/90"><CheckCircle2 className="h-3 w-3" />Ready</Badge>}
                        {r.status === "done" && !ok && <Badge className="gap-1 bg-[color:var(--color-warning)] text-[color:var(--color-warning-foreground)] hover:bg-[color:var(--color-warning)]/90"><Pencil className="h-3 w-3" />Review</Badge>}
                        {r.confidence && <Badge variant="outline" className="text-xs">conf: {r.confidence}</Badge>}
                        <span className="text-xs text-muted-foreground truncate">{r.fileName}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_auto] gap-2 items-end">
                        <div>
                          <Label className="text-xs text-muted-foreground">Matric No.</Label>
                          <Input value={r.matric} onChange={(e) => updateRecord(r.id, { matric: e.target.value.toUpperCase() })} className={`font-mono ${r.matric && !matricValid ? "border-destructive" : ""}`} placeholder="—" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Score</Label>
                          <Input value={r.score} onChange={(e) => updateRecord(r.id, { score: e.target.value })} type="number" placeholder="—" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Total</Label>
                          <Input value={r.total} onChange={(e) => updateRecord(r.id, { total: e.target.value })} type="number" placeholder="—" />
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeRecord(r.id)} aria-label="Remove">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {!records.length && (
          <p className="text-center text-sm text-muted-foreground py-8">
            No scripts yet. Take a photo or upload to get started.
          </p>
        )}
      </main>
    </div>
  );
}
