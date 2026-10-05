import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
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

function LedgerMetric({
  label,
  value,
  tone = "navy",
}: {
  label: string;
  value: string | number;
  tone?: "navy" | "gold" | "danger";
}) {
  const valueTone =
    tone === "gold"
      ? "text-[color:var(--color-gold)]"
      : tone === "danger"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="bg-card px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 font-registry text-[28px] font-semibold leading-none tabular-nums sm:text-[32px] ${valueTone}`}>
        {value}
      </p>
    </div>
  );
}

function RegistryStamp({ tone, children }: { tone: "complete" | "review"; children: string }) {
  return tone === "complete" ? (
    <span className="inline-flex items-center whitespace-nowrap rounded-sm border border-[color:var(--color-success)]/50 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-success)]">
      {children}
    </span>
  ) : (
    <span className="inline-flex items-center whitespace-nowrap rounded-sm bg-[color:var(--color-gold)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-white">
      {children}
    </span>
  );
}

function Dashboard() {
  const { ready } = useSessionGuard();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [exports, setExports] = useState(0);
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase(),
    );
  }, []);

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
    <AppShell title="" description="">
      <Toaster richColors position="top-center" />

      {/* Registry masthead */}
      <section className="overflow-hidden rounded-md border-b-4 border-[color:var(--color-gold)] bg-[color:var(--color-navy)] text-white">
        <div className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[color:var(--color-gold)]">
              Institutional Registry
            </p>
            <h1 className="mt-1 font-registry text-[28px] font-semibold italic leading-tight sm:text-[34px]">
              Examination Register
            </h1>
            <p className="mt-1.5 max-w-xl text-[13px] text-white/65">
              Live overview of examination capture and result processing for the Office of Examinations.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70 sm:text-right">
              <p className="text-[color:var(--color-gold)]/90">Record date: {today || "—"}</p>
              <p className="mt-0.5 flex items-center gap-1.5 sm:justify-end">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--color-gold)]" aria-hidden />
                Status: Active
              </p>
            </div>
            <Link to="/capture" search={{}}>
              <Button className="h-9 bg-[color:var(--color-gold)] text-[color:var(--color-navy-dark)] hover:bg-[color:var(--color-gold)]/85">
                Start capture
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Ledger metrics */}
      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border xl:grid-cols-4">
        <LedgerMetric label="Scripts processed" value={totals.scripts - totals.review} />
        <LedgerMetric label="Examinations" value={exams.length} />
        <LedgerMetric label="Pending review" value={totals.review} tone={totals.review > 0 ? "gold" : "navy"} />
        <LedgerMetric label="Exports" value={exports} />
      </div>

      {/* Recent examinations register */}
      <section className="mt-6 overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-3 bg-[color:var(--color-navy-dark)] px-4 py-3 sm:px-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-gold)]">
            Recent examinations
          </h2>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--color-gold)]" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
              {loading ? "Reading register" : `${exams.length} recorded`}
            </span>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5 sm:py-5">
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
              {/* Desktop ledger table */}
              <div className="-mx-4 hidden overflow-x-auto sm:-mx-5 md:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-[color:var(--color-gold)]/40 text-left">
                      <th scope="col" className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Course</th>
                      <th scope="col" className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Last activity</th>
                      <th scope="col" className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Scripts</th>
                      <th scope="col" className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Processed</th>
                      <th scope="col" className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Review required</th>
                      <th scope="col" className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</th>
                      <th scope="col" className="px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exams.map((e) => (
                      <tr key={e.course} className="border-b border-border/70 transition-colors last:border-0 hover:bg-[#F7F7F4]">
                        <td className="px-5 py-3 font-registry text-[17px] font-semibold text-foreground">{e.course}</td>
                        <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{new Date(e.lastAt).toLocaleDateString()}</td>
                        <td className="px-5 py-3 tabular-nums text-foreground">{e.scripts}</td>
                        <td className="px-5 py-3 tabular-nums text-foreground">{e.processed}</td>
                        <td className="px-5 py-3 tabular-nums text-foreground">{e.review}</td>
                        <td className="px-5 py-3">
                          {e.review > 0
                            ? <RegistryStamp tone="review">Review required</RegistryStamp>
                            : <RegistryStamp tone="complete">Complete</RegistryStamp>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link to="/history/$course" params={{ course: e.course }} className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary underline-offset-4 hover:underline">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile ledger entries */}
              <ul className="grid gap-3 md:hidden">
                {exams.map((e) => (
                  <li
                    key={e.course}
                    className={`border-l-4 bg-white px-3.5 py-3 shadow-sm ${
                      e.review > 0 ? "border-[color:var(--color-gold)]" : "border-[color:var(--color-navy)]"
                    }`}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <p className="min-w-0 truncate font-registry text-[17px] font-semibold text-foreground">{e.course}</p>
                      {e.review > 0
                        ? <RegistryStamp tone="review">Review</RegistryStamp>
                        : <RegistryStamp tone="complete">Complete</RegistryStamp>}
                    </div>
                    <div className="mt-2 border-t border-dashed border-[color:var(--color-gold)]/30 pt-2">
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {e.processed} of {e.scripts} processed · {new Date(e.lastAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Link
                      to="/history/$course"
                      params={{ course: e.course }}
                      className="mt-2 inline-block font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-primary underline-offset-4 hover:underline"
                    >
                      Open examination
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </AppShell>
  );
}
