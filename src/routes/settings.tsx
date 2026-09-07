import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { AppShell, Panel, StatusPill } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Toaster } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSessionGuard } from "@/hooks/use-session";
import { useNavigate } from "@tanstack/react-router";
import { DEFAULT_MATRIC_SAMPLE } from "@/lib/matric";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ScriptScan Office of Examinations" },
      { name: "description", content: "Review your examination officer account, capture defaults and data handling for ScriptScan." },
      { property: "og:title", content: "Settings — ScriptScan Office of Examinations" },
      { property: "og:description", content: "Account details, capture defaults and data handling." },
    ],
  }),
  component: SettingsPage;
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
      <p className="field-label">{label}</p>
      <div className="text-[14px] text-muted-foreground">{value}</div>
    </div>
  );
}

function SettingsPage() {
  const { ready } = useSessionGuard();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");

  useEffect(() => {
    if (!ready) return;
    supabase.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? "");
      if (!data.user) return;
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      setRole((roles ?? []).map((r) => r.role).join(", "));
    });
  }, [ready]);

  return (
    <AppShell title="Settings" description="Account details and capture defaults for this workstation.">
      <Toaster richColors position="top-center" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Account">
          <Row label="Signed-in address" value={email || "—"} />
          <Row label="Access level" value={role ? <StatusPill tone="info">{role}</StatusPill> : "—"} />
          <Row label="Record visibility" value="Only scripts captured under this account are visible." />
          <div className="pt-4">
            <Button
              variant="outline"
              className="h-10 gap-2"
              onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </Panel>

        <Panel title="Capture defaults">
          <Row label="Matric number sample" value={<span className="font-mono">{DEFAULT_MATRIC_SAMPLE}</span>} />
          <Row label="Video sampling interval" value="0.60 s primary sweep" />
          <Row label="Reconfirmation sweep" value="0.25 s verification pass" />
          <Row label="Duplicate handling" value="Repeated matric numbers merge into the highest-confidence record." />
          <p className="pt-4 text-[13px] text-muted-foreground">
            Capture defaults are tuned for accuracy on handwritten scripts and are applied automatically on the
            Capture screen.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
