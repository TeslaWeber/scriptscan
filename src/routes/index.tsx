import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "ScriptScan Dashboard" },
      { name: "description", content: "Open the ScriptScan examination management dashboard." },
      { property: "og:title", content: "ScriptScan Dashboard" },
      { property: "og:description", content: "Open the ScriptScan examination management dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});