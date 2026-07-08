import type { Status } from "../types";

export const STATUS_LABEL: Record<Status, string> = {
  confirmed: "Confirmed",
  "needs-review": "Needs Review",
  missing: "Missing",
  "not-started": "Not Started",
};

/** Tailwind class groups keyed by status — dot, text, and badge (bg + border + text). */
export const STATUS_CLASSES: Record<Status, { dot: string; text: string; badge: string }> = {
  confirmed: {
    dot: "bg-status-confirmed",
    text: "text-status-confirmed",
    badge: "bg-status-confirmed/10 text-status-confirmed border-status-confirmed/30",
  },
  "needs-review": {
    dot: "bg-status-review",
    text: "text-status-review",
    badge: "bg-status-review/10 text-status-review border-status-review/30",
  },
  missing: {
    dot: "bg-status-missing",
    text: "text-status-missing",
    badge: "bg-status-missing/10 text-status-missing border-status-missing/30",
  },
  "not-started": {
    dot: "bg-status-idle",
    text: "text-status-idle",
    badge: "bg-status-idle/10 text-status-idle border-status-idle/30",
  },
};

/** Ordering used when reducing many statuses into one worst-case rollup status. */
const SEVERITY: Record<Status, number> = {
  missing: 3,
  "needs-review": 2,
  "not-started": 1,
  confirmed: 0,
};

/** Reduce a list of statuses to the single most urgent one (missing beats review beats not-started beats confirmed). */
export function rollupStatus(statuses: Status[]): Status {
  if (statuses.length === 0) return "not-started";
  return statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), statuses[0]);
}
