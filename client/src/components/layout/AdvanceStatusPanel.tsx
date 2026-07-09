import { NavLink } from "react-router-dom";
import { useShow } from "../../context/ShowContext";
import { documentsCompletion, missingCriticalItems, overallCompletion, requirementsByDepartment, scheduleCompletion } from "../../utils/completion";
import { STATUS_CLASSES, DEPARTMENT_LABEL } from "../../utils/status";
import { StatusDot } from "../ui/StatusBadge";
import { ProgressBar } from "../ui/ProgressBar";
import { Icon } from "../ui/icons";
import type { Department } from "../../types";

export function AdvanceStatusPanel() {
  const { selectedShow } = useShow();

  if (!selectedShow) {
    return <aside className="hidden w-80 shrink-0 border-l border-surface-border bg-surface-panel/40 lg:block" />;
  }

  const overall = overallCompletion(selectedShow);
  const missing = missingCriticalItems(selectedShow);
  const departments = requirementsByDepartment(selectedShow.requirements);
  const schedule = scheduleCompletion(selectedShow.scheduleItems);
  const docs = documentsCompletion(selectedShow.documents);
  const openIssueCount = selectedShow.issues.filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS").length;

  return (
    <aside className="oc-scrollbar hidden w-80 shrink-0 overflow-y-auto border-l border-surface-border bg-surface-panel/40 p-4 lg:block">
      <div className="mb-4">
        <p className="oc-label">Advance Status</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-neutral-50">{overall}%</span>
          <span className="text-xs text-neutral-500">complete</span>
        </div>
        <ProgressBar percent={overall} className="mt-2" />
        {selectedShow.riskScore !== null && (
          <p className="mt-2 text-xs text-neutral-500">
            Last AI risk score: <span className="font-medium text-neutral-300">{selectedShow.riskScore}/100</span>
          </p>
        )}
      </div>

      <div className="oc-card p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">By Department</p>
        <ul className="space-y-1">
          {departments.length === 0 && <li className="px-1.5 py-1 text-xs text-neutral-600">No requirements yet</li>}
          {departments.map((d) => (
            <li key={d.department}>
              <NavLink to="/requirements" className="flex items-center justify-between rounded px-1.5 py-1.5 text-sm text-neutral-300 hover:bg-surface-raised">
                <span className="flex items-center gap-2">
                  <StatusDot status={d.status} />
                  {DEPARTMENT_LABEL[d.department as Department]}
                </span>
                <span className="text-xs text-neutral-500">{d.percent}%</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t border-surface-border pt-2">
          <NavLink to="/schedule" className="flex items-center justify-between rounded px-1.5 py-1.5 text-sm text-neutral-300 hover:bg-surface-raised">
            <span className="flex items-center gap-2">
              <StatusDot status={schedule.status} />
              Schedule
            </span>
            <span className="text-xs text-neutral-500">{schedule.percent}%</span>
          </NavLink>
          <NavLink to="/documents" className="flex items-center justify-between rounded px-1.5 py-1.5 text-sm text-neutral-300 hover:bg-surface-raised">
            <span className="flex items-center gap-2">
              <StatusDot status={docs.status} />
              Documents
            </span>
            <span className="text-xs text-neutral-500">{docs.percent}%</span>
          </NavLink>
          <NavLink to="/issues" className="flex items-center justify-between rounded px-1.5 py-1.5 text-sm text-neutral-300 hover:bg-surface-raised">
            <span className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${openIssueCount > 0 ? STATUS_CLASSES.MISSING.dot : STATUS_CLASSES.CONFIRMED.dot}`} />
              Open Issues
            </span>
            <span className="text-xs text-neutral-500">{openIssueCount}</span>
          </NavLink>
        </div>
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
