import { useState } from "react";
import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { api } from "../api/client";

const COMING_SOON = [
  { name: "Supabase Database Sync", note: "Replace flat-file JSON storage with a managed Postgres backend." },
  { name: "File Uploads", note: "Attach real venue packets, plots, and photos to Documents." },
  { name: "PDF Advance Export", note: "Generate a print-ready advance packet from this workspace." },
  { name: "AI Advance Assistant", note: "Draft venue emails and flag advance risks automatically." },
  { name: "Node-Based Signal Routing", note: "Visual signal graph built on today's SignalLine records." },
  { name: "Slack / Email Integration", note: "Push status changes and blockers to the crew channel." },
];

export function Settings() {
  const { tour } = useTour();
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    if (!confirm("Reset all tour stops back to the original seed data? Session edits will be lost.")) return;
    setResetting(true);
    try {
      await api.reset();
      window.location.reload();
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Tour configuration and workspace preferences." />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Tour" subtitle="Read-only for Phase 1" />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-surface-border pb-2">
              <dt className="text-neutral-500">Artist</dt>
              <dd className="text-neutral-200">{tour?.artist ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-surface-border pb-2">
              <dt className="text-neutral-500">Tour Name</dt>
              <dd className="text-neutral-200">{tour?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between pb-1">
              <dt className="text-neutral-500">Season</dt>
              <dd className="text-neutral-200">{tour?.season ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Appearance" subtitle="Dark theme, highlighter green accent" />
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 rounded border border-surface-border bg-surface" />
            <span className="h-8 w-8 rounded border border-surface-border bg-surface-panel" />
            <span className="h-8 w-8 rounded border border-surface-border bg-accent" />
            <p className="text-xs text-neutral-500">Fixed for Phase 1 — theming options land in a later phase.</p>
          </div>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Demo Data" subtitle="This prototype stores edits in a local JSON file on the API server" />
          <button
            onClick={handleReset}
            disabled={resetting}
            className="rounded-md border border-surface-border px-3 py-1.5 text-xs text-neutral-300 hover:border-status-missing/50 hover:text-status-missing disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Reset to Seed Data"}
          </button>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Planned for Later Phases" />
          <ul className="grid grid-cols-2 gap-3">
            {COMING_SOON.map((item) => (
              <li key={item.name} className="rounded-md border border-surface-border p-3">
                <p className="text-sm font-medium text-neutral-200">{item.name}</p>
                <p className="mt-1 text-xs text-neutral-500">{item.note}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
