import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, Loader2, Search } from "lucide-react";
import { AppShell, Panel, StatusPill } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster, toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadScoresWorkbook, saveExportVersion, type ExportRow } from "@/lib/exportVersions";

export const Route = createFileRoute("/history/")({
  head: () => ({
    meta: [
      { title: "Examinations — ScriptScan Office of Examinations" },
      { name: "description", content: "Browse every recorded examination capture session by course, reopen it for review, or re-issue the result workbook." },
      { property: "og:title", content: "Examinations — ScriptScan Office of Examinations" },
      { property: "og:description", content: "Browse recorded examination sessions and re-issue result workbooks." },
    ],
  }),
  component: History,
});


type CourseSummary = {
  course: string;
  total: number;
  complete: number;
  incomplete: number;
  lastAt: string;
};

function History() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CourseSummary[]>([]);
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scripts")
      .select("course,matric,score,created_at")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const map = new Map<string, CourseSummary>();
    for (const r of data ?? []) {
      const key = r.course;
      const cur = map.get(key) ?? { course: key, total: 0, complete: 0, incomplete: 0, lastAt: r.created_at };
      cur.total += 1;
      if (r.matric && r.score != null) cur.complete += 1; else cur.incomplete += 1;
      if (r.created_at > cur.lastAt) cur.lastAt = r.created_at;
      map.set(key, cur);
    }
    setRows([...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate({ to: "/auth" }); return; }
      load();
    });
  }, [navigate, load]);

  const exportCourse = async (course: string) => {
    setExporting(course);
    try {
      const { data, error } = await supabase
        .from("scripts").select("matric,score,confidence,error").eq("course", course)
        .not("matric", "is", null).not("score", "is", null).order("matric");
      if (error) { toast.error(error.message); return; }
      if (!data?.length) { toast.error("No complete records in this course"); return; }
      const entries: ExportRow[] = data.map((r: any) => ({
        matric: String(r.matric), score: Number(r.score), confidence: r.confidence ?? "", error: r.error ?? "",
      }));
      const saved = await saveExportVersion(course, entries);
      const filename = saved?.filename ?? `${course.replace(/\s+/g, "_")}_scores.xlsx`;
      downloadScoresWorkbook(entries, filename);
      toast.success(`Exported ${entries.length} record(s)${saved?.version ? ` — version ${saved.version}` : ""}`, { description: filename });
    } finally { setExporting(null); }
  };

  const filtered = rows.filter((r) => r.course.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <AppShell
      title="Examinations"
      description="All recorded capture sessions, grouped by course."
      actions={
        <Link to="/capture" search={{}}>
          <Button className="h-10">New capture</Button>
        </Link>
      }
    >
      <Toaster richColors position="top-center" />

      <Panel
        title="Examination register"
        description={`${rows.length} examination${rows.length === 1 ? "" : "s"} recorded under your account`}
        actions={
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search course code"
              placeholder="Search course code"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 w-full pl-9 sm:w-56"
            />
          </div>
        }
      >
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Retrieving examination records…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No examinations recorded yet. Begin a capture session to create one.
          </p>
        ) : (
          <>
            <div className="-mx-4 hidden overflow-x-auto sm:-mx-5 md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/60 text-left">
                    {["Course", "Records", "Complete", "Status", "Last activity", "Actions"].map((h) => (
                      <th key={h} scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.course} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-5 py-3 font-medium text-foreground">{r.course}</td>
                      <td className="px-5 py-3 tabular-nums">{r.total}</td>
                      <td className="px-5 py-3 tabular-nums">{r.complete}</td>
                      <td className="px-5 py-3">
                        {r.incomplete > 0
                          ? <StatusPill tone="warning">{r.incomplete} incomplete</StatusPill>
                          : <StatusPill tone="success">Complete</StatusPill>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{new Date(r.lastAt).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Link to="/history/$course" params={{ course: r.course }}>
                            <Button variant="outline" size="sm" className="h-9">Open</Button>
                          </Link>
                          <Button
                            size="sm"
                            className="h-9 gap-1.5"
                            onClick={() => exportCourse(r.course)}
                            disabled={exporting === r.course}
                          >
                            {exporting === r.course
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <FileSpreadsheet className="h-4 w-4" />}
                            Export
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="grid gap-3 md:hidden">
              {filtered.map((r) => (
                <li key={r.course} className="rounded-md border border-border px-3.5 py-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <p className="truncate font-medium text-foreground">{r.course}</p>
                    {r.incomplete > 0
                      ? <StatusPill tone="warning">{r.incomplete} incomplete</StatusPill>
                      : <StatusPill tone="success">Complete</StatusPill>}
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {r.complete} of {r.total} complete · {new Date(r.lastAt).toLocaleDateString()}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to="/history/$course" params={{ course: r.course }}>
                      <Button variant="outline" size="sm" className="h-9">Open</Button>
                    </Link>
                    <Button size="sm" className="h-9 gap-1.5" onClick={() => exportCourse(r.course)} disabled={exporting === r.course}>
                      {exporting === r.course ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                      Export
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </AppShell>

  );
}
