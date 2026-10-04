import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, Panel } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — ScriptScan" },
      { name: "description", content: "How ScriptScan handles examination records, account information and uploaded media." },
      { property: "og:title", content: "Privacy Policy — ScriptScan" },
      { property: "og:description", content: "How ScriptScan handles examination records, account information and uploaded media." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <AppShell title="Privacy Policy" description="How information is handled when you use ScriptScan." actions={<Button asChild variant="outline"><Link to="/settings">Back to settings</Link></Button>}>
      <Panel>
        <article className="mx-auto max-w-3xl space-y-7 text-sm leading-7 text-muted-foreground">
          <p className="text-xs font-medium uppercase text-foreground">Effective 4 October 2026</p>
          <section><h2 className="section-title text-foreground">Information we process</h2><p className="mt-2">ScriptScan processes account details, examination course information, matriculation numbers, scores, uploaded script images, video frames, voice recordings and technical information needed to operate the service.</p></section>
          <section><h2 className="section-title text-foreground">How information is used</h2><p className="mt-2">Information is used to authenticate authorised staff, extract and verify examination results, prevent duplicate records, maintain work history and prepare Excel files requested by users.</p></section>
          <section><h2 className="section-title text-foreground">AI processing</h2><p className="mt-2">Uploaded images, selected video frames and voice recordings may be sent securely to Google Gemini for recognition and structured extraction. Users should review extracted details before saving or exporting them.</p></section>
          <section><h2 className="section-title text-foreground">Storage and access</h2><p className="mt-2">Saved examination records are associated with the signed-in staff account. Access controls are used so staff can view records belonging to their own account. Temporary media may be processed without being retained as a permanent record.</p></section>
          <section><h2 className="section-title text-foreground">Security and retention</h2><p className="mt-2">Reasonable safeguards are used to protect account and examination information. Records remain available for operational history until they are deleted through the service or removed under the institution’s retention requirements.</p></section>
          <section><h2 className="section-title text-foreground">Your responsibilities and choices</h2><p className="mt-2">Use ScriptScan only with institutional authority, protect your sign-in details and avoid uploading information unrelated to examination processing. Requests concerning access, correction or deletion should be directed to the institution responsible for the examination records.</p></section>
        </article>
      </Panel>
    </AppShell>
  );
}