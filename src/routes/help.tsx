import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, Panel } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help & Support — ScriptScan Office of Examinations" },
      { name: "description", content: "Guidance on capturing exam scripts, resolving flagged records and exporting verified result workbooks." },
      { property: "og:title", content: "Help & Support — ScriptScan Office of Examinations" },
      { property: "og:description", content: "Guidance on capture, review and export procedures." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Help,
});

const STEPS = [
  {
    title: "1. Record the examination details",
    body: "Enter the course code, a sample matric number in the format used on the scripts, and the maximum obtainable score before capturing.",
  },
  {
    title: "2. Capture the scripts",
    body: "Upload photographs of marked scripts, upload a recorded video sweep of the pile, or dictate results aloud. Each method feeds the same verification register.",
  },
  {
    title: "3. Resolve flagged records",
    body: "Rows marked for review are missing a matric number or a score. Correct them in place; each edit is re-validated and saved automatically.",
  },
  {
    title: "4. Export the workbook",
    body: "Exporting produces a versioned .xlsx containing matric number and score, then clears the capture register for the next examination.",
  },
];

function Help() {
  return (
    <AppShell
      title="Help & Support"
      description="Standard operating procedure for examination script digitisation."
      actions={
        <Link to="/capture" search={{}}>
          <Button className="h-10">Go to capture</Button>
        </Link>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Capture procedure">
          <ol className="grid gap-5">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3 className="text-[15px] font-semibold text-foreground">{s.title}</h3>
                <p className="mt-1 text-[14px] leading-6 text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Accuracy notes">
          <ul className="grid gap-3 text-[14px] leading-6 text-muted-foreground">
            <li>Photograph scripts in even lighting with the matric number and score fully visible.</li>
            <li>Video sweeps run a second verification pass to catch skipped or misread scripts.</li>
            <li>Repeated detections of the same matric number are merged into one record.</li>
            <li>Records are private to the signed-in examination officer.</li>
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}
