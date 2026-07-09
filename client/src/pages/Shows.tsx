import { useNavigate } from "react-router-dom";
import { useShow } from "../context/ShowContext";
import { StatusBadge } from "../components/ui/StatusBadge";
import { PageHeader } from "../components/ui/PageHeader";
import { formatDate, formatDateTime } from "../utils/format";
import { ProgressBar } from "../components/ui/ProgressBar";
import { requirementsCompletion, documentsCompletion } from "../utils/completion";
import { rollupStatus } from "../utils/status";
import type { ShowSummary } from "../types";

function showPercent(show: ShowSummary): number {
  const sections = [requirementsCompletion(show.requirements), documentsCompletion(show.documents)];
  return Math.round(sections.reduce((sum, s) => sum + s.percent, 0) / sections.length);
}

function showStatus(show: ShowSummary) {
  const sections = [requirementsCompletion(show.requirements).status, documentsCompletion(show.documents).status];
  return rollupStatus(sections);
}

export function Shows() {
  const { shows, selectedShowId, selectShow } = useShow();
  const navigate = useNavigate();

  const sorted = [...shows].sort((a, b) => a.date.localeCompare(b.date));
  const tour = sorted[0]?.tour;

  return (
    <div>
      <PageHeader title="Shows" description={tour ? `${tour.artist} — ${tour.name}, ${tour.season}` : undefined} />

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
              <th className="px-4 py-2.5 font-medium">Open Issues</th>
              <th className="px-4 py-2.5 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((show) => {
              const status = showStatus(show);
              const percent = showPercent(show);
              const isSelected = show.id === selectedShowId;
              const openIssues = show.issues.length;
              return (
                <tr
                  key={show.id}
                  onClick={() => {
                    selectShow(show.id);
                    navigate("/");
                  }}
                  className={`cursor-pointer border-b border-surface-border last:border-0 transition-colors hover:bg-surface-raised/60 ${isSelected ? "bg-accent/[0.06]" : ""}`}
                >
                  <td className="px-4 py-3 text-neutral-300">{formatDate(show.date)}</td>
                  <td className="px-4 py-3 text-neutral-300">{show.city}, {show.state}</td>
                  <td className="px-4 py-3 font-medium text-neutral-100">
                    {show.venue?.name || <span className="text-neutral-600">Not set</span>}
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
                  <td className="px-4 py-3 text-neutral-300">{show.advanceOwner?.name ?? "Unassigned"}</td>
                  <td className="px-4 py-3">
                    <span className={openIssues > 0 ? "text-status-missing" : "text-status-confirmed"}>{openIssues}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{formatDateTime(show.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
