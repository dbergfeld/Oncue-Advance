import { useShow } from "../context/ShowContext";
import { useUsers } from "../context/UserContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Icon } from "../components/ui/icons";
import { TIMELINE_STATUS_CLASSES, TIMELINE_STATUS_LABEL } from "../utils/status";
import { formatDateTime } from "../utils/format";
import { api } from "../api/client";
import type { TimelineEntry, TimelineEntryStatus } from "../types";

const STATUS_OPTIONS: TimelineEntryStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "BLOCKED", "SKIPPED"];

export function Timeline() {
  const { selectedShow, refreshSelectedShow } = useShow();
  const { users } = useUsers();

  if (!selectedShow) return <p className="text-sm text-neutral-500">No show selected.</p>;

  const entries = [...selectedShow.timelineEntries].sort((a, b) => a.stage.order - b.stage.order);
  const completeCount = entries.filter((e) => e.status === "COMPLETE").length;
  const percent = entries.length === 0 ? 0 : Math.round((completeCount / entries.length) * 100);

  async function patch(id: string, data: Partial<TimelineEntry>) {
    await api.updateTimelineEntry(id, data);
    await refreshSelectedShow();
  }

  return (
    <div>
      <PageHeader title="Advance Timeline" description="Show Confirmed through Archived — the advance workflow for this show." percent={percent} />

      <div className="relative">
        <div className="absolute bottom-4 left-[15px] top-4 w-px bg-surface-border" />
        <ul className="space-y-3">
          {entries.map((entry, i) => {
            const classes = TIMELINE_STATUS_CLASSES[entry.status];
            const blockedByIncomplete =
              i > 0 && entries[i - 1].status !== "COMPLETE" && entries[i - 1].status !== "SKIPPED" && entry.status !== "NOT_STARTED";
            return (
              <li key={entry.id} className="relative pl-9">
                <span className={`absolute left-0 top-1.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-surface-panel ${classes.dot.replace("bg-", "ring-2 ring-")}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${classes.dot}`} />
                </span>
                <div className="oc-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-100">{entry.stage.label}</p>
                      {blockedByIncomplete && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-status-review">
                          <Icon name="warning" className="h-3 w-3" />
                          Previous stage ({entries[i - 1].stage.label}) isn't complete yet
                        </p>
                      )}
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${classes.badge}`}>
                      {TIMELINE_STATUS_LABEL[entry.status]}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2">
                    <select className="oc-select py-1 text-xs" value={entry.status} onChange={(e) => patch(entry.id, { status: e.target.value as TimelineEntryStatus })}>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {TIMELINE_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <select className="oc-select py-1 text-xs" value={entry.ownerId ?? ""} onChange={(e) => patch(entry.id, { ownerId: e.target.value || null })}>
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <div className="col-span-2 flex items-center gap-2 text-[11px] text-neutral-500">
                      {entry.startedAt && <span>Started {formatDateTime(entry.startedAt)}</span>}
                      {entry.completedAt && <span>· Completed {formatDateTime(entry.completedAt)}</span>}
                    </div>
                  </div>

                  <input
                    className="oc-input mt-2 py-1 text-xs"
                    defaultValue={entry.notes}
                    placeholder="Notes"
                    onBlur={(e) => e.target.value !== entry.notes && patch(entry.id, { notes: e.target.value })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
