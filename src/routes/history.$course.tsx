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

  const incomplete = rows.filter((r) => !r.matric.trim() || r.score.trim() === "").length;

  return (
    <AppShell
      title={course}
      description="Review, correct and re-issue the result workbook for this examination."
      session={course}
      actions={
        <>
          <Link to="/history">
            <Button variant="outline" className="h-10 gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Examinations
            </Button>
          </Link>
          <Button onClick={reExport} disabled={exporting || !rows.length} className="h-10 gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Re-export .xlsx
          </Button>
        </>
      }
    >
      <Toaster richColors position="top-center" />

      <div className="grid gap-6">
        <Panel
          title="Recorded scripts"
          description={`${rows.length} record${rows.length === 1 ? "" : "s"}${incomplete ? ` · ${incomplete} require attention` : ""}`}
        >
          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Retrieving records…
            </p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No records stored for this examination.</p>
          ) : (
            <ul className="grid gap-2.5">
              {rows.map((r) => {
                const bad = !r.matric.trim() || r.score.trim() === "";
                return (
                  <li
                    key={r.id}
                    className={`rounded-md border px-3.5 py-3 ${bad ? "border-destructive/40 bg-destructive/[0.04]" : "border-border"}`}
                  >
                    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto_auto]">
                      <div className="grid gap-1.5">
                        <Label className="field-label" htmlFor={`m-${r.id}`}>Matric No.</Label>
                        <Input
                          id={`m-${r.id}`}
                          value={r.matric}
                          className="h-10 font-mono"
                          placeholder="Not detected"
                          onChange={(e) => update(r.id, { matric: e.target.value.toUpperCase() })}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="field-label" htmlFor={`s-${r.id}`}>Score</Label>
                        <Input
                          id={`s-${r.id}`}
                          value={r.score}
                          inputMode="decimal"
                          className="h-10 font-mono"
                          placeholder="—"
                          onChange={(e) => update(r.id, { score: e.target.value })}
                        />
                      </div>
                      <Button className="h-10 gap-1.5" onClick={() => save(r)} disabled={!r.dirty || savingId === r.id}>
                        {savingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 text-destructive"
                        onClick={() => remove(r.id)}
                        aria-label="Delete record permanently"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {bad
                        ? <StatusPill tone="error">Incomplete record</StatusPill>
                        : <StatusPill tone="success">Verified</StatusPill>}
                      {r.confidence && <StatusPill tone="neutral">Confidence: {r.confidence}</StatusPill>}
                      {r.error && <span className="text-[13px] text-muted-foreground">{r.error}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Saved export versions"
          description={`${versions.length} workbook${versions.length === 1 ? "" : "s"} issued for this examination`}
        >
          {versions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No workbooks issued yet — each re-export is stored here as a new version.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {versions.map((v) => (
                <li key={v.id} className="grid gap-2 rounded-md border border-border px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">Version {v.version} · {v.record_count} record(s)</p>
                    <p className="truncate text-[13px] text-muted-foreground">
                      {v.filename} · {new Date(v.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => openVersion(v)}>
                      <Download className="h-4 w-4" /> Download
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 text-destructive"
                      onClick={() => deleteVersion(v)}
                      aria-label={`Delete version ${v.version}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

