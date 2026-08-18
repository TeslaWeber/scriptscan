import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileSpreadsheet, Loader2, Trash2, GraduationCap, Save, History as HistoryIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster, toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadScoresWorkbook, saveExportVersion, type ExportRow, type ExportVersion } from "@/lib/exportVersions";

export const Route = createFileRoute("/history/$course")({
  head: ({ params }) => ({
    meta: [
      { title: `Edit ${params.course} — ScriptScan History` },
      { name: "description", content: `Review, correct and re-export the archived exam capture session for ${params.course}.` },
      { property: "og:title", content: `Edit ${params.course} — ScriptScan History` },
      { property: "og:description", content: `Review, correct and re-export archived results for ${params.course}.` },
    ],
  }),
  component: HistoryCourse,
});

type Row = { id: string; matric: string; score: string; confidence?: string | null; error?: string | null; dirty?: boolean };

function HistoryCourse() {
  const { course } = Route.useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [versions, setVersions] = useState<ExportVersion[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scripts").select("id,matric,score,confidence,error").eq("course", course).order("matric");
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []).map((d: any) => ({
      id: d.id,
      matric: d.matric ?? "",
      score: d.score != null ? String(d.score) : "",
      confidence: d.confidence ?? "",
      error: d.error ?? "",
    })));
  }, [course]);

  const loadVersions = useCallback(async () => {
    const { data } = await supabase
      .from("export_versions").select("*").eq("course", course).order("version", { ascending: false });
    setVersions((data ?? []) as unknown as ExportVersion[]);
  }, [course]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate({ to: "/auth" }); return; }
      load();
      loadVersions();
    });
  }, [navigate, load, loadVersions]);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)));

  const save = async (r: Row) => {
    setSavingId(r.id);
    const score = r.score.trim() === "" ? null : Number(r.score);
    if (score !== null && !Number.isFinite(score)) { toast.error("Score must be a number"); setSavingId(null); return; }
    const { error } = await supabase.from("scripts")
      .update({ matric: r.matric.trim().toUpperCase() || null, score })
      .eq("id", r.id);
    setSavingId(null);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, dirty: false } : x)));
    toast.success("Updated");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("scripts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.filter((r) => r.id !== id));
    toast.success("Deleted");
  };

  const reExport = async () => {
    setExporting(true);
    try {
      const byMatric = new Map<string, ExportRow>();
      for (const r of rows) {
        const m = r.matric.trim().toUpperCase();
        const s = Number(r.score);
        if (!m || r.score.trim() === "" || !Number.isFinite(s)) continue;
        byMatric.set(m, { matric: m, score: s, confidence: r.confidence ?? "", error: r.error ?? "" });
      }
      const entries = [...byMatric.values()].sort((a, b) => a.matric.localeCompare(b.matric));
      if (!entries.length) { toast.error("No complete records to export"); return; }
      const saved = await saveExportVersion(course, entries);
      const filename = saved?.filename ?? `${course.replace(/\s+/g, "_")}_scores.xlsx`;
      downloadScoresWorkbook(entries, filename);
      await loadVersions();
      toast.success(`Exported ${entries.length} record(s)${saved?.version ? ` — version ${saved.version}` : ""}`, { description: filename });
    } finally { setExporting(false); }
  };

  const openVersion = (v: ExportVersion) => {
    const rowsIn = (v.rows ?? []) as ExportRow[];
    if (!rowsIn.length) { toast.error("This saved version has no rows"); return; }
    downloadScoresWorkbook(rowsIn, v.filename);
    toast.success(`Opened version ${v.version}`, { description: v.filename });
  };

  const deleteVersion = async (v: ExportVersion) => {
    const { error } = await supabase.from("export_versions").delete().eq("id", v.id);
    if (error) { toast.error(error.message); return; }
    setVersions((vs) => vs.filter((x) => x.id !== v.id));
    toast.success(`Version ${v.version} removed`);
  };

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="border-b-2 border-primary/80 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-sm border border-[color:var(--color-brass)]/70 flex items-center justify-center flex-shrink-0">
              <GraduationCap className="h-6 w-6 text-[color:var(--color-brass)]" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-xl leading-tight truncate">{course}</p>
              <p className="text-[11px] uppercase tracking-[0.22em] opacity-70">Archived session · edit &amp; re-export</p>
            </div>
          </div>
          <Link to="/history">
            <Button variant="ghost" size="sm" className="gap-1 text-primary-foreground hover:bg-primary-foreground/10">
              <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">History</span>
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl">Edit archived records</h1>
          <Button onClick={reExport} disabled={exporting || !rows.length} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Re-export .xlsx
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Retrieving records…</div>
        ) : rows.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">No records archived for this course.</Card>
        ) : (
          <div className="grid gap-3">
            {rows.map((r) => (
              <Card key={r.id} className="p-3" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_auto_auto] gap-2 items-end">
                  <div>
                    <Label className="text-xs text-muted-foreground">Matric No.</Label>
                    <Input value={r.matric} className="font-mono" placeholder="—"
                      onChange={(e) => update(r.id, { matric: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Score</Label>
                    <Input value={r.score} inputMode="decimal" className="font-mono" placeholder="—"
                      onChange={(e) => update(r.id, { score: e.target.value })} />
                  </div>
                  <Button size="sm" onClick={() => save(r)} disabled={!r.dirty || savingId === r.id} className="gap-1">
                    {savingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(r.id)} title="Delete permanently">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
        <section className="space-y-3 pt-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <HistoryIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-display text-xl">Saved export versions</h2>
            <span className="text-xs text-muted-foreground">{versions.length} saved</span>
          </div>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exports saved yet — each re-export creates a new version here.</p>
          ) : (
            <div className="grid gap-2">
              {versions.map((v) => (
                <Card key={v.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">Version {v.version} · {v.record_count} record(s)</p>
                    <p className="text-xs text-muted-foreground truncate">{v.filename} · {new Date(v.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" className="gap-1" onClick={() => openVersion(v)}>
                      <Download className="h-4 w-4" /> Open
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteVersion(v)} title="Delete version">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
