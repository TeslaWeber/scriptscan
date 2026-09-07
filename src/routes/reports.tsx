import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { AppShell, Panel } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Toaster, toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadScoresWorkbook, type ExportRow } from "@/lib/exportVersions";
import { useSessionGuard } from "@/hooks/use-session";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — ScriptScan Office of Examinations" },
      { name: "description", content: "Every generated examination workbook, versioned by course, ready to download again at any time." },
      { property: "og:title", content: "Reports — ScriptScan Office of Examinations" },
      { property: "og:description", content: "Versioned examination workbooks ready to download again." },
    ],
  }),
  component: Reports,
});

type Version = {
  id: string;
  course: string;
  version: number;
  filename: string;
  record_count: number;
  rows: ExportRow[];
  created_at: string;
};

function Reports() {
  const { ready } = useSessionGuard();
  const [rows, setRows] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    supabase
      .from("export_versions")
      .select("id,course,version,filename,record_count,rows,created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { toast.error(error.message); return; }
        setRows((data ?? []) as unknown as Version[]);
      });
  }, [ready]);

  const download = (v: Version) => {
    downloadScoresWorkbook(v.rows ?? [], v.filename);
    toast.success("Workbook downloaded", { description: v.filename });
  };

  return (
    <AppShell
      title="Reports"
      description="Generated result workbooks, versioned per examination."
    >
      <Toaster richColors position="top-center" />
      <Panel title="Export history" description="Each edit and re-export is stored as a new version.">
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading export history…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No workbooks have been generated yet.
          </p>
        ) : (
          <>
            <div className="-mx-4 hidden overflow-x-auto sm:-mx-5 md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/60 text-left">
                    {["Course", "Version", "File name", "Records", "Generated", ""].map((h, i) => (
                      <th key={i} scope="col" className="px-5 py-2.5 text-[12px] font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-5 py-3 font-medium text-foreground">{v.course}</td>
                      <td className="px-5 py-3 tabular-nums text-muted-foreground">v{v.version}</td>
                      <td className="px-5 py-3 font-mono text-[13px] text-muted-foreground">{v.filename}</td>
                      <td className="px-5 py-3 tabular-nums">{v.record_count}</td>
                      <td className="px-5 py-3 text-muted-foreground">{new Date(v.created_at).toLocaleString()}</td>
                      <td className="px-5 py-3 text-right">
                        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => download(v)}>
                          <Download className="h-4 w-4" /> Download
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="grid gap-3 md:hidden">
              {rows.map((v) => (
                <li key={v.id} className="rounded-md border border-border px-3.5 py-3">
                  <p className="font-medium text-foreground">{v.course} · v{v.version}</p>
                  <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">{v.filename}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {v.record_count} records · {new Date(v.created_at).toLocaleDateString()}
                  </p>
                  <Button variant="outline" size="sm" className="mt-2 h-9 gap-1.5" onClick={() => download(v)}>
                    <Download className="h-4 w-4" /> Download
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </AppShell>
  );
}
