import { useShow } from "../context/ShowContext";
import { PageHeader } from "../components/ui/PageHeader";
import { scheduleCompletion } from "../utils/completion";
import { StatusSelect } from "../components/ui/StatusSelect";
import { api } from "../api/client";
import type { RecordStatus, ScheduleItem } from "../types";

export function Schedule() {
  const { selectedShow, refreshSelectedShow } = useShow();

  if (!selectedShow) return <p className="text-sm text-neutral-500">No show selected.</p>;

  const completion = scheduleCompletion(selectedShow.scheduleItems);

  async function updateItem(id: string, data: Partial<Pick<ScheduleItem, "time" | "notes" | "status">>) {
    await api.updateScheduleItem(id, data);
    await refreshSelectedShow();
  }

  return (
    <div>
      <PageHeader title="Schedule" description="Day-of-show run of show for load-in through load-out." status={completion.status} percent={completion.percent} />

      <div className="oc-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-raised/40 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2.5 font-medium">Item</th>
              <th className="px-3 py-2.5 font-medium w-24">Time</th>
              <th className="px-3 py-2.5 font-medium w-36">Department</th>
              <th className="px-3 py-2.5 font-medium w-36">Owner</th>
              <th className="px-3 py-2.5 font-medium">Notes</th>
              <th className="px-3 py-2.5 font-medium w-40">Status</th>
            </tr>
          </thead>
          <tbody>
            {selectedShow.scheduleItems.map((item) => (
              <tr key={item.id} className="border-b border-surface-border last:border-0">
                <td className="px-3 py-2 font-medium text-neutral-200 whitespace-nowrap">{item.label}</td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className="oc-input py-1"
                    defaultValue={item.time}
                    placeholder="--:--"
                    onBlur={(e) => (e.target.value !== item.time ? updateItem(item.id, { time: e.target.value }) : undefined)}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">{item.department ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-neutral-500">{item.owner?.name ?? "—"}</td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className="oc-input py-1"
                    defaultValue={item.notes}
                    placeholder="Notes"
                    onBlur={(e) => (e.target.value !== item.notes ? updateItem(item.id, { notes: e.target.value }) : undefined)}
                  />
                </td>
                <td className="px-3 py-2">
                  <StatusSelect value={item.status} onChange={(v: RecordStatus) => updateItem(item.id, { status: v })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
