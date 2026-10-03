import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { AppShell, Panel } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toaster, toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSessionGuard } from "@/hooks/use-session";

export const Route = createFileRoute("/lookup")({
  head: () => ({
    meta: [
      { title: "Matric Lookup — ScriptScan" },
      { name: "description", content: "Look up a student's score, course and capture date by matric number." },
      { property: "og:title", content: "Matric Lookup — ScriptScan" },
      { property: "og:description", content: "Find a student's score, course and date by matric number." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Lookup,
});

type Row = { id: string; course: string; matric: string | null; score: number | null; created_at: string };

function Lookup() {
  const { ready } = useSessionGuard();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("scripts")
      .select("id,course,matric,score,created_at")
      .ilike("matric", term)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as Row[]);
  };

  return (
    <AppShell title="Matric Lookup" description="Enter a matric number to see its score, course and date.">
      <Toaster richColors position="top-center" />
      <Panel title="Find a student">
        <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 2016/0001" className="sm:max-w-xs" />
          <Button type="submit" disabled={!ready || loading || !q.trim()}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Look up
          </Button>
        </form>
        {rows && (
          <div className="mt-4">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No record found for that matric number.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2">Matric No.</th><th className="px-3 py-2">Course</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Date</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono">{r.matric}</td>
                        <td className="px-3 py-2">{r.course}</td>
                        <td className="px-3 py-2 font-semibold">{r.score ?? "—"}</td>
                        <td className="px-3 py-2">{new Date(r.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
