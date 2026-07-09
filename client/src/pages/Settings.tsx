import { useEffect, useState } from "react";
import { useShow } from "../context/ShowContext";
import { useUsers } from "../context/UserContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { StatusDot } from "../components/ui/StatusBadge";
import { api } from "../api/client";

const DEFERRED = [
  { name: "Supabase Auth", note: "Real login/session — currently a dev-mode \"acting as\" picker in the header (see UserContext)." },
  { name: "File Uploads", note: "Attach real venue packets, plots, and photos to Documents/Requirements/Issues." },
  { name: "Rules Engine (admin UI)", note: "Configurable dependency rules (e.g. rigging approval blocks LED approval) with an editable admin interface." },
  { name: "Node-Based Signal/Routing Graph", note: "SignalLine-equivalent routing view — not modeled this pass; Requirement Matrix covers signal readiness at a checklist level." },
  { name: "Drawing Manager", note: "CAD/Vectorworks parsing and revision comparison — drawings are plain Attachments today, typed by mimeType." },
  { name: "Vendor / Travel / Communication Hub UI", note: "Vendor, TravelLeg, HotelBooking, Communication, Approval, Deliverable, CrewMember tables exist and are relationally wired, but have no dedicated pages yet." },
  { name: "Document Generator", note: "PDF/Excel/Markdown export of advance packets, summaries, and risk reports." },
  { name: "Redis / real-time updates", note: "Currently a manual refetch-after-write model, not websocket push." },
];

export function Settings() {
  const { selectedShow } = useShow();
  const { users, activeUser, setActiveUser } = useUsers();
  const [aiStatus, setAiStatus] = useState<{ configured: boolean } | null>(null);

  useEffect(() => {
    api.health().then((h) => setAiStatus({ configured: h.aiConfigured }));
  }, []);

  return (
    <div>
      <PageHeader title="Settings" description="Tour configuration, acting-as identity, and platform status." />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Tour" subtitle="Read-only this pass — edit via the database or a future admin page" />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-surface-border pb-2">
              <dt className="text-neutral-500">Artist</dt>
              <dd className="text-neutral-200">{selectedShow?.tour?.artist ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-surface-border pb-2">
              <dt className="text-neutral-500">Tour Name</dt>
              <dd className="text-neutral-200">{selectedShow?.tour?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between pb-1">
              <dt className="text-neutral-500">Season</dt>
              <dd className="text-neutral-200">{selectedShow?.tour?.season ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Acting As" subtitle="No real auth yet — every write is attributed to this user (see README)" />
          <select
            className="oc-select"
            value={activeUser?.id ?? ""}
            onChange={(e) => {
              const user = users.find((u) => u.id === e.target.value);
              if (user) setActiveUser(user);
            }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.role}
              </option>
            ))}
          </select>
        </Card>

        <Card>
          <CardHeader title="AI Risk Engine" subtitle="Live status of the Anthropic API connection" />
          <div className="flex items-center gap-2 text-sm">
            {aiStatus === null ? (
              <span className="text-neutral-500">Checking…</span>
            ) : aiStatus.configured ? (
              <>
                <StatusDot status="CONFIRMED" />
                <span className="text-neutral-200">Configured — risk analysis available on the Dashboard</span>
              </>
            ) : (
              <>
                <StatusDot status="MISSING" />
                <span className="text-neutral-400">
                  Not configured. Set <code className="text-neutral-300">ANTHROPIC_API_KEY</code> in <code className="text-neutral-300">server/.env</code> and restart the API server.
                </span>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Appearance" subtitle="Dark theme, highlighter green accent" />
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 rounded border border-surface-border bg-surface" />
            <span className="h-8 w-8 rounded border border-surface-border bg-surface-panel" />
            <span className="h-8 w-8 rounded border border-surface-border bg-accent" />
            <p className="text-xs text-neutral-500">Fixed this pass — theming options land in a later phase.</p>
          </div>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Demo Data" subtitle="Postgres via Prisma — see server/prisma/seed.ts" />
          <p className="text-sm text-neutral-400">
            To reset to seed data, run <code className="rounded bg-surface-raised px-1.5 py-0.5 text-xs text-neutral-300">npm run db:reset</code> in{" "}
            <code className="rounded bg-surface-raised px-1.5 py-0.5 text-xs text-neutral-300">/server</code>. This re-applies migrations and re-seeds
            from scratch — unlike Phase 1's in-app reset button, it's a deliberate CLI step since it now drops real relational data.
          </p>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Deferred to a Later Pass" subtitle="Modeled or scoped, not yet built — see README “Phase 2 Architecture”" />
          <ul className="grid grid-cols-2 gap-3">
            {DEFERRED.map((item) => (
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
