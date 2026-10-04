import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppShell, Panel, StatusPill } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Toaster } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSessionGuard } from "@/hooks/use-session";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ScriptScan Office of Examinations" },
      { name: "description", content: "Overview of examination script capture, processed results, pending reviews and exported workbooks." },
      { property: "og:title", content: "Dashboard — ScriptScan Office of Examinations" },
      { property: "og:description", content: "Overview of examination capture and result processing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type ExamRow = {
  course: string;
  scripts: number;
  processed: number;
  review: number;
  lastAt: string;
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel px-4 py-4">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function Dashboard() {
  const { ready } = useSessionGuard();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [exports, setExports] = useState(0);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [{ data: scripts }, { count: exportCount }] = await Promise.all([
        supabase.from("scripts").select("course,matric,score,created_at").order("created_at", { ascending: false }),
        supabase.from("export_versions").select("id", { count: "exact", head: true }),
      ]);
      const map = new Map<string, ExamRow>();
      for (const r of scripts ?? []) {
        const cur = map.get(r.course) ?? { course: r.course, scripts: 0, processed: 0, review: 0, lastAt: r.created_at };
        cur.scripts += 1;
        if (r.matric && r.score != null) cur.processed += 1;
        else cur.review += 1;
        if (r.created_at > cur.lastAt) cur.lastAt = r.created_at;
        map.set(r.course, cur);
      }
      setExams([...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)));
      setExports(exportCount ?? 0);
      setLoading(false);
    })();
  }, [ready]);

  const totals = exams.reduce(
    (acc, e) => ({ scripts: acc.scripts + e.scripts, review: acc.review + e.review }),
    { scripts: 0, review: 0 },
  );

  return (
    <AppShell
      title="Dashboard"
      description="Overview of examination capture and result processing."
      actions={
        <Link to="/capture" search={{}}>
          <Button className="h-10">Start capture</Button>
        </Link>
      }
    >
      <Toaster richColors position="top-center" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Scripts processed" value={totals.scripts - totals.review} />
        <Metric label="Examinations" value={exams.length} />
        <Metric label="Pending review" value={totals.review} />
        <Metric label="Exports" value={exports} />
      </div>

      <div className="mt-6">
        <Panel title="Recent examinations" description="Capture sessions recorded under your account.">
          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading examination records…
            </p>
          ) : exams.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No examination scripts have been captured yet.
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="-mx-4 hidden overflow-x-auto sm:-mx-5 md:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/60 text-left">
                      <th scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">Course</th>
                      <th scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">Last activity</th>
                      <th scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">Scripts</th>
                      <th scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">Processed</th>
                      <th scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">Review required</th>
                      <th scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">Status</th>
                      <th scope="col" className="px-5 py-2.5 text-right text-[12px] font-semibold text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exams.map((e) => (
                      <tr key={e.course} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-5 py-3 font-medium text-foreground">{e.course}</td>
                        <td className="px-5 py-3 text-muted-foreground">{new Date(e.lastAt).toLocaleDateString()}</td>
                        <td className="px-5 py-3 tabular-nums">{e.scripts}</td>
                        <td className="px-5 py-3 tabular-nums">{e.processed}</td>
                        <td className="px-5 py-3 tabular-nums">{e.review}</td>
                        <td className="px-5 py-3">
                          {e.review > 0
                            ? <StatusPill tone="warning">Review required</StatusPill>
                            : <StatusPill tone="success">Complete</StatusPill>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link to="/history/$course" params={{ course: e.course }} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="grid gap-3 md:hidden">
                {exams.map((e) => (
                  <li key={e.course} className="rounded-md border border-border px-3.5 py-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <p className="truncate font-medium text-foreground">{e.course}</p>
                      {e.review > 0
                        ? <StatusPill tone="warning">{e.review} to review</StatusPill>
                        : <StatusPill tone="success">Complete</StatusPill>}
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {e.processed} of {e.scripts} processed · {new Date(e.lastAt).toLocaleDateString()}
                    </p>
                    <Link
                      to="/history/$course"
                      params={{ course: e.course }}
                      className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Open examination
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
