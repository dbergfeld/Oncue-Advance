import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { scheduleCompletion } from "../utils/completion";
import { StatusSelect } from "../components/ui/StatusSelect";
import type { ScheduleItem } from "../types";

export function Schedule() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = scheduleCompletion(stop);

  function setItem<K extends keyof ScheduleItem>(id: string, key: K, value: ScheduleItem[K]) {
    updateStop(stop.id, (s) => ({
      ...s,
      schedule: s.schedule.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    }));
  }

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Day-of-show run of show for load-in through load-out."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

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
            {stop.schedule.map((item) => (
              <tr key={item.id} className="border-b border-surface-border last:border-0">
                <td className="px-3 py-2 font-medium text-neutral-200 whitespace-nowrap">{item.label}</td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className="oc-input py-1"
                    value={item.time}
                    placeholder="--:--"
                    onChange={(e) => setItem(item.id, "time", e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className="oc-input py-1"
                    value={item.department}
                    placeholder="Dept"
                    onChange={(e) => setItem(item.id, "department", e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className="oc-input py-1"
                    value={item.owner}
                    placeholder="Owner"
                    onChange={(e) => setItem(item.id, "owner", e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className="oc-input py-1"
                    value={item.notes}
                    placeholder="Notes"
                    onChange={(e) => setItem(item.id, "notes", e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <StatusSelect value={item.status} onChange={(v) => setItem(item.id, "status", v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
