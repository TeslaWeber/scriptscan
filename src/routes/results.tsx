import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { AppShell, Panel, StatusPill } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Toaster, toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSessionGuard } from "@/hooks/use-session";

export const Route = createFileRoute("/results")({
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === "string" && s.q ? { q: s.q } : {},
  head: () => ({
    meta: [
      { title: "Results — ScriptScan Office of Examinations" },
      { name: "description", content: "Search, filter and verify captured examination results with matric numbers, scores and recognition confidence." },
      { property: "og:title", content: "Results — ScriptScan Office of Examinations" },
      { property: "og:description", content: "Search and verify captured examination results." },
    ],
  }),
  component: Results,
});

type Row = {
  id: string;
  course: string;
  matric: string | null;
  score: number | null;
  total: number | null;
  confidence: string | null;
  created_at: string;
};

const CONF_PCT: Record<string, string> = { high: "98%", medium: "84%", low: "62%" };

function Results() {
  const { ready } = useSessionGuard();
  const search = Route.useSearch();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(search.q ?? "");
  const [filter, setFilter] = useState<"all" | "verified" | "review">("all");

  useEffect(() => {
    if (!ready) return;
    supabase
      .from("scripts")
      .select("id,course,matric,score,total,confidence,created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { toast.error(error.message); return; }
        setRows((data ?? []) as Row[]);
      });
  }, [ready]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const verified = !!r.matric && r.score != null;
      if (filter === "verified" && !verified) return false;
      if (filter === "review" && verified) return false;
      if (!term) return true;
      return (r.course + " " + (r.matric ?? "")).toLowerCase().includes(term);
    });
  }, [rows, q, filter]);

  const verifiedCount = rows.filter((r) => r.matric && r.score != null).length;

  return (
    <AppShell
      title="Results"
      description="Every captured script record, with recognition confidence and review status."
    >
      <Toaster richColors position="top-center" />

      <Panel
        title="Captured scripts"
        description={`${rows.length} scripts · ${verifiedCount} verified · ${rows.length - verifiedCount} require review`}
        actions={
          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Search results"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search course or matric"
                className="h-10 w-full pl-9 sm:w-56"
              />
            </div>
            <div role="group" aria-label="Filter results" className="grid grid-cols-3 rounded-md border border-border p-0.5">
              {(["all", "verified", "review"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`rounded-[6px] px-3 py-1.5 text-[13px] font-medium capitalize transition-colors ${
                    filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading result records…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No examination scripts match this view.
          </p>
        ) : (
          <>
            <div className="-mx-4 hidden overflow-x-auto sm:-mx-5 md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/60 text-left">
                    {["Status", "Course", "Matric No.", "Score", "Maximum", "Confidence", "Captured", "Action"].map((h) => (
                      <th key={h} scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const verified = !!r.matric && r.score != null;
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-5 py-3">
                          {verified ? <StatusPill tone="success">Verified</StatusPill> : <StatusPill tone="warning">Review required</StatusPill>}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{r.course}</td>
                        <td className="px-5 py-3 font-mono text-foreground">{r.matric ?? "—"}</td>
                        <td className="px-5 py-3 tabular-nums">{r.score ?? "—"}</td>
                        <td className="px-5 py-3 tabular-nums text-muted-foreground">{r.total ?? "—"}</td>
                        <td className="px-5 py-3 text-muted-foreground">{r.confidence ? CONF_PCT[r.confidence] ?? r.confidence : "—"}</td>
                        <td className="px-5 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td className="px-5 py-3">
                          <Link to="/history/$course" params={{ course: r.course }} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                            {verified ? "View" : "Review"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="grid gap-3 md:hidden">
              {filtered.map((r) => {
                const verified = !!r.matric && r.score != null;
                return (
                  <li key={r.id} className="rounded-md border border-border px-3.5 py-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <p className="truncate font-mono font-medium text-foreground">{r.matric ?? "No matric detected"}</p>
                      {verified ? <StatusPill tone="success">Verified</StatusPill> : <StatusPill tone="warning">Review</StatusPill>}
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {r.course} · Score {r.score ?? "—"}{r.total != null ? ` / ${r.total}` : ""}
                      {r.confidence ? ` · ${CONF_PCT[r.confidence] ?? r.confidence}` : ""}
                    </p>
                    <Link to="/history/$course" params={{ course: r.course }} className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
                      {verified ? "View record" : "Review record"}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
    </AppShell>
  );
}
