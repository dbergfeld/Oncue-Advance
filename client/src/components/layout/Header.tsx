import { useTour } from "../../context/TourContext";
import { formatDate } from "../../utils/format";
import { Icon } from "../ui/icons";

export function Header() {
  const { tour, tourStops, selectedStop, selectStop } = useTour();

  const sortedStops = [...tourStops].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-border bg-surface-panel/60 px-6">
      <div className="flex items-center gap-4">
        <div>
          <p className="text-xs text-neutral-500">
            {tour ? `${tour.artist} — ${tour.name}` : "Loading tour…"}
          </p>
          {selectedStop && (
            <p className="text-sm font-medium text-neutral-100">
              {selectedStop.venue.name || "Untitled Venue"}
              <span className="text-neutral-500"> · {selectedStop.city}, {selectedStop.state}</span>
            </p>
          )}
        </div>
      </div>

      {selectedStop && (
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-neutral-500 sm:inline">{formatDate(selectedStop.date)}</span>
          <div className="relative">
            <select
              className="oc-select w-64 py-1.5 text-sm"
              value={selectedStop.id}
              onChange={(e) => selectStop(e.target.value)}
            >
              {sortedStops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {formatDate(stop.date)} — {stop.city}, {stop.state}
                </option>
              ))}
            </select>
          </div>
          <Icon name="map" className="h-4 w-4 text-neutral-600" />
        </div>
      )}
    </header>
  );
}
