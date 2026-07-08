import { NavLink } from "react-router-dom";
import { useTour } from "../../context/TourContext";
import { allSectionCompletions, missingCriticalItems, overallCompletion } from "../../utils/completion";
import { StatusDot } from "../ui/StatusBadge";
import { ProgressBar } from "../ui/ProgressBar";
import { Icon } from "../ui/icons";

const SECTION_ROUTES: Record<string, string> = {
  venue: "/venue",
  schedule: "/schedule",
  videoPackage: "/video-package",
  labor: "/labor",
  power: "/power",
  rigging: "/rigging",
  signal: "/signal",
  documents: "/documents",
};

export function AdvanceStatusPanel() {
  const { selectedStop } = useTour();

  if (!selectedStop) {
    return (
      <aside className="hidden w-80 shrink-0 border-l border-surface-border bg-surface-panel/40 lg:block" />
    );
  }

  const sections = allSectionCompletions(selectedStop);
  const overall = overallCompletion(selectedStop);
  const missing = missingCriticalItems(selectedStop);

  return (
    <aside className="oc-scrollbar hidden w-80 shrink-0 overflow-y-auto border-l border-surface-border bg-surface-panel/40 p-4 lg:block">
      <div className="mb-4">
        <p className="oc-label">Advance Status</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-neutral-50">{overall}%</span>
          <span className="text-xs text-neutral-500">complete</span>
        </div>
        <ProgressBar percent={overall} className="mt-2" />
      </div>

      <div className="oc-card p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">By Section</p>
        <ul className="space-y-1">
          {sections.map((section) => (
            <li key={section.key}>
              <NavLink
                to={SECTION_ROUTES[section.key]}
                className="flex items-center justify-between rounded px-1.5 py-1.5 text-sm text-neutral-300 hover:bg-surface-raised"
              >
                <span className="flex items-center gap-2">
                  <StatusDot status={section.status} />
                  {section.label}
                </span>
                <span className="text-xs text-neutral-500">{section.percent}%</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 oc-card p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          <Icon name="warning" className="h-3.5 w-3.5 text-status-missing" />
          Missing Critical Items {missing.length > 0 && `(${missing.length})`}
        </p>
        {missing.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-status-confirmed">
            <Icon name="check" className="h-4 w-4" />
            Nothing outstanding
          </p>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto oc-scrollbar pr-1">
            {missing.map((item, i) => (
              <li key={i} className="text-xs leading-snug text-neutral-400">
                <span className="mr-1 text-status-missing">•</span>
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
