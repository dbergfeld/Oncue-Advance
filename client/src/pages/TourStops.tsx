import { useNavigate } from "react-router-dom";
import { useTour } from "../context/TourContext";
import { allSectionCompletions, missingCriticalItems, overallCompletion } from "../utils/completion";
import { rollupStatus } from "../utils/status";
import { StatusBadge } from "../components/ui/StatusBadge";
import { PageHeader } from "../components/ui/PageHeader";
import { formatDate, formatDateTime } from "../utils/format";
import { ProgressBar } from "../components/ui/ProgressBar";

export function TourStops() {
  const { tourStops, selectedStopId, selectStop, tour } = useTour();
  const navigate = useNavigate();

  const sorted = [...tourStops].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div>
      <PageHeader title="Tour Stops" description={tour ? `${tour.artist} — ${tour.name}, ${tour.season}` : undefined} />

      <div className="oc-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-raised/40 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">City</th>
              <th className="px-4 py-2.5 font-medium">Venue</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Completion</th>
              <th className="px-4 py-2.5 font-medium">Advance Owner</th>
              <th className="px-4 py-2.5 font-medium">Missing Items</th>
              <th className="px-4 py-2.5 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((stop) => {
              const status = rollupStatus(allSectionCompletions(stop).map((s) => s.status));
              const missingCount = missingCriticalItems(stop).length;
              const percent = overallCompletion(stop);
              const isSelected = stop.id === selectedStopId;
              return (
                <tr
                  key={stop.id}
                  onClick={() => {
                    selectStop(stop.id);
                    navigate("/");
                  }}
                  className={`cursor-pointer border-b border-surface-border last:border-0 transition-colors hover:bg-surface-raised/60 ${
                    isSelected ? "bg-accent/[0.06]" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-neutral-300">{formatDate(stop.date)}</td>
                  <td className="px-4 py-3 text-neutral-300">
                    {stop.city}, {stop.state}
                  </td>
                  <td className="px-4 py-3 font-medium text-neutral-100">
                    {stop.venue.name || <span className="text-neutral-600">Not set</span>}
                    {isSelected && <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">Selected</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar percent={percent} className="w-20" />
                      <span className="text-xs text-neutral-400">{percent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-300">{stop.advanceOwner || "Unassigned"}</td>
                  <td className="px-4 py-3">
                    <span className={missingCount > 0 ? "text-status-missing" : "text-status-confirmed"}>
                      {missingCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{formatDateTime(stop.lastUpdated)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
