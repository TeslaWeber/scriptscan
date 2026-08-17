import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Archive, ArrowLeft, FileSpreadsheet, FolderOpen, Loader2, AlertTriangle, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Toaster, toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/history/")({
  head: () => ({
    meta: [
      { title: "History File — ScriptScan" },
      { name: "description", content: "Browse every past exam capture session by course, reopen it for review, or re-export the Excel sheet." },
      { property: "og:title", content: "History File — ScriptScan" },
      { property: "og:description", content: "Browse past exam capture sessions by course and re-export results." },
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
        .from("scripts").select("matric,score").eq("course", course)
        .not("matric", "is", null).not("score", "is", null).order("matric");
      if (error) { toast.error(error.message); return; }
      if (!data?.length) { toast.error("No complete records in this course"); return; }
      const aoa: (string | number)[][] = [["MATRIC NO.", "SCORE"], ...data.map((r) => [r.matric as string, Number(r.score)])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 22 }, { wch: 10 }];
      for (let i = 2; i <= aoa.length; i++) { const c = ws[`B${i}`]; if (c) c.t = "n"; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scores");
      const filename = `${course.replace(/\s+/g, "_")}_scores.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Exported ${data.length} record(s)`, { description: filename });
    } finally { setExporting(null); }
  };

  const filtered = rows.filter((r) => r.course.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="border-b-2 border-primary/80 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-sm border border-[color:var(--color-brass)]/70 flex items-center justify-center">
              <GraduationCap className="h-6 w-6 text-[color:var(--color-brass)]" />
            </div>
            <div>
              <p className="font-display text-xl leading-tight">History File</p>
              <p className="text-[11px] uppercase tracking-[0.22em] opacity-70">Archived capture sessions</p>
            </div>
          </div>
          <Link to="/" search={{}}>
            <Button variant="ghost" size="sm" className="gap-1 text-primary-foreground hover:bg-primary-foreground/10">
              <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Console</span>
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Archive className="h-5 w-5 text-muted-foreground" />
          <Input placeholder="Search course code…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Retrieving archive…</div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">No archived work yet. Capture a course from the console.</Card>
        ) : (
          <div className="grid gap-3">
            {filtered.map((r) => (
              <Card key={r.course} className="p-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-[color:var(--color-brass)]" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="min-w-0">
                  <p className="font-display text-xl">{r.course}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.total} record(s) · {r.complete} complete · last activity {new Date(r.lastAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.incomplete > 0 && (
                    <Badge variant="destructive" className="rounded-sm gap-1"><AlertTriangle className="h-3 w-3" />{r.incomplete} incomplete</Badge>
                  )}
                  <Link to="/history/$course" params={{ course: r.course }}>
                    <Button variant="secondary" size="sm" className="gap-1"><FolderOpen className="h-4 w-4" /> Edit</Button>
                  </Link>
                  <Button size="sm" className="gap-1" onClick={() => exportCourse(r.course)} disabled={exporting === r.course}>
                    {exporting === r.course ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
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
