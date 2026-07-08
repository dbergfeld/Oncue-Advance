import { useTour } from "../context/TourContext";
import { StatCard } from "../components/ui/StatCard";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Card, CardHeader } from "../components/ui/Card";
import { Icon } from "../components/ui/icons";
import { formatDate } from "../utils/format";
import { missingCriticalItems, overallCompletion } from "../utils/completion";
import type { Status } from "../types";
import { Link } from "react-router-dom";

function fieldStatus(value: string): Status {
  return value.trim().length > 0 ? "confirmed" : "missing";
}

export function Dashboard() {
  const { selectedStop } = useTour();

  if (!selectedStop) {
    return <p className="text-sm text-neutral-500">No tour stop selected.</p>;
  }

  const stop = selectedStop;
  const completion = overallCompletion(stop);
  const missing = missingCriticalItems(stop);
  const localLaborCount = stop.labor.roles.reduce((sum, r) => sum + r.localCount, 0);
  const touringLaborCount = stop.labor.roles.reduce((sum, r) => sum + r.touringCount, 0);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Tour Stop Dashboard</p>
          <h1 className="mt-1 text-xl font-semibold text-neutral-50">
            {stop.venue.name || "Untitled Venue"} — {stop.city}, {stop.state}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">{formatDate(stop.date)}</p>
        </div>
        <Link
          to="/tour-stops"
          className="rounded-md border border-surface-border px-3 py-1.5 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent"
        >
          Switch Tour Stop
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Venue" value={stop.venue.name || "—"} sublabel="Venue name" />
        <StatCard label="City / State" value={`${stop.city}, ${stop.state}`} />
        <StatCard label="Show Date" value={formatDate(stop.date)} />
        <StatCard label="Advance Complete" value={`${completion}%`} status={completion >= 100 ? "confirmed" : completion > 0 ? "needs-review" : "not-started"} />

        <StatCard label="Load-In" value={stop.loadIn || "TBD"} />
        <StatCard label="Doors" value={stop.doors || "TBD"} />
        <StatCard label="Show Time" value={stop.showTime || "TBD"} />
        <StatCard label="Curfew" value={stop.curfew || "TBD"} />

        <StatCard label="Crew Count" value={stop.crewCount} sublabel="Touring roster" />
        <StatCard label="Local Labor" value={localLaborCount} sublabel={`${touringLaborCount} touring on this stop`} />
        <StatCard label="Truck Access" value={<StatusBadge status={stop.truckAccessStatus} />} />
        <StatCard label="FOH Cable Path" value={<StatusBadge status={fieldStatus(stop.venue.fohCablePath)} />} />

        <StatCard label="Power Confirmation" value={<StatusBadge status={stop.power.status} />} />
        <StatCard label="Rigging Confirmation" value={<StatusBadge status={stop.rigging.status} />} />
        <StatCard
          label="Missing Critical Items"
          value={missing.length}
          status={missing.length > 0 ? "missing" : "confirmed"}
        />
        <StatCard label="Advance Owner" value={stop.advanceOwner || "Unassigned"} />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader
            title="Missing Critical Items"
            subtitle={missing.length === 0 ? "Advance is fully clean for this stop" : `${missing.length} item(s) blocking a clean advance`}
          />
          {missing.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-status-confirmed">
              <Icon name="check" className="h-4 w-4" />
              Nothing outstanding — this stop is ready to travel.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {missing.slice(0, 8).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                  <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-missing" />
                  {item}
                </li>
              ))}
              {missing.length > 8 && (
                <li className="pl-5 text-xs text-neutral-500">+{missing.length - 8} more — see right panel</li>
              )}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Today's Notes" subtitle="Most recent advance notes" />
          {stop.notes.length === 0 ? (
            <p className="text-sm text-neutral-500">No notes logged for this stop.</p>
          ) : (
            <ul className="space-y-3">
              {[...stop.notes]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 3)
                .map((note) => (
                  <li key={note.id} className="border-l-2 border-accent/40 pl-3">
                    <p className="text-[11px] uppercase tracking-wide text-neutral-500">{note.category}</p>
                    <p className="text-sm text-neutral-300">{note.text}</p>
                    <p className="mt-0.5 text-xs text-neutral-600">{note.owner}</p>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
