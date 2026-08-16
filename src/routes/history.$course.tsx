import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileSpreadsheet, Loader2, Trash2, GraduationCap, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster, toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

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

type Row = { id: string; matric: string; score: string; dirty?: boolean };

function HistoryCourse() {
  const { course } = Route.useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scripts").select("id,matric,score").eq("course", course).order("matric");
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []).map((d) => ({
      id: d.id,
      matric: d.matric ?? "",
      score: d.score != null ? String(d.score) : "",
    })));
  }, [course]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate({ to: "/auth" }); return; }
      load();
    });
  }, [navigate, load]);

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
      const byMatric = new Map<string, number>();
      for (const r of rows) {
        const m = r.matric.trim().toUpperCase();
        const s = Number(r.score);
        if (!m || r.score.trim() === "" || !Number.isFinite(s)) continue;
        byMatric.set(m, s);
      }
      const entries = [...byMatric.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      if (!entries.length) { toast.error("No complete records to export"); return; }
      const aoa: (string | number)[][] = [["MATRIC NO.", "SCORE"], ...entries.map(([m, s]) => [m, s])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 22 }, { wch: 10 }];
      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: 1 } });
      for (let i = 2; i <= aoa.length; i++) { const c = ws[`B${i}`]; if (c) c.t = "n"; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scores");
      const filename = `${course.replace(/\s+/g, "_")}_scores.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Exported ${entries.length} record(s)`, { description: filename });
    } finally { setExporting(false); }
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
      </main>
    </div>
  );
}
