import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, Panel } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — ScriptScan" },
      { name: "description", content: "Terms governing authorised staff use of ScriptScan for examination processing." },
      { property: "og:title", content: "Terms of Service — ScriptScan" },
      { property: "og:description", content: "Terms governing authorised staff use of ScriptScan for examination processing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <AppShell title="Terms of Service" description="Conditions for authorised use of ScriptScan." actions={<Button asChild variant="outline"><Link to="/settings">Back to settings</Link></Button>}>
      <Panel>
        <article className="mx-auto max-w-3xl space-y-7 text-sm leading-7 text-muted-foreground">
          <p className="text-xs font-medium uppercase text-foreground">Effective 4 October 2026</p>
          <section><h2 className="section-title text-foreground">Authorised use</h2><p className="mt-2">ScriptScan is provided for authorised university staff to digitise marked examination scripts, verify extracted results and create administrative workbooks. You must use it only for lawful institutional purposes.</p></section>
          <section><h2 className="section-title text-foreground">Accounts</h2><p className="mt-2">You are responsible for safeguarding your account and for activity performed through it. Do not share access credentials or use another person’s account.</p></section>
          <section><h2 className="section-title text-foreground">Accuracy and review</h2><p className="mt-2">Automated recognition can make mistakes. You remain responsible for checking matriculation numbers, scores and course details against the original marked scripts before saving or exporting a result.</p></section>
          <section><h2 className="section-title text-foreground">Acceptable conduct</h2><p className="mt-2">You must not attempt to bypass access controls, interfere with the service, upload unlawful or unrelated content, misuse student information, or alter official results without authority.</p></section>
          <section><h2 className="section-title text-foreground">Availability</h2><p className="mt-2">The service may occasionally be unavailable because of maintenance, connectivity or third-party services. Keep original scripts and follow institutional record-management procedures; ScriptScan is not a substitute for required source records.</p></section>
          <section><h2 className="section-title text-foreground">Changes and termination</h2><p className="mt-2">Access may be suspended when these terms are breached or when institutional authority ends. These terms may be updated as the service or applicable requirements change.</p></section>
        </article>
      </Panel>
    </AppShell>
  );
}