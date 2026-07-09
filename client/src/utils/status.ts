import type { Department, IssueSeverity, IssueStatus, Priority, RecordStatus, RiskLevel, TimelineEntryStatus } from "../types";

export const STATUS_LABEL: Record<RecordStatus, string> = {
  CONFIRMED: "Confirmed",
  NEEDS_REVIEW: "Needs Review",
  MISSING: "Missing",
  NOT_STARTED: "Not Started",
};

export const STATUS_CLASSES: Record<RecordStatus, { dot: string; text: string; badge: string }> = {
  CONFIRMED: {
    dot: "bg-status-confirmed",
    text: "text-status-confirmed",
    badge: "bg-status-confirmed/10 text-status-confirmed border-status-confirmed/30",
  },
  NEEDS_REVIEW: {
    dot: "bg-status-review",
    text: "text-status-review",
    badge: "bg-status-review/10 text-status-review border-status-review/30",
  },
  MISSING: {
    dot: "bg-status-missing",
    text: "text-status-missing",
    badge: "bg-status-missing/10 text-status-missing border-status-missing/30",
  },
  NOT_STARTED: {
    dot: "bg-status-idle",
    text: "text-status-idle",
    badge: "bg-status-idle/10 text-status-idle border-status-idle/30",
  },
};

const SEVERITY: Record<RecordStatus, number> = { MISSING: 3, NEEDS_REVIEW: 2, NOT_STARTED: 1, CONFIRMED: 0 };

export function rollupStatus(statuses: RecordStatus[]): RecordStatus {
  if (statuses.length === 0) return "NOT_STARTED";
  return statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), statuses[0]);
}

export const DEPARTMENT_LABEL: Record<Department, string> = {
  VIDEO: "Video",
  LIGHTING: "Lighting",
  AUDIO: "Audio",
  RIGGING: "Rigging",
  AUTOMATION: "Automation",
  BACKLINE: "Backline",
  PRODUCTION: "Production",
  MERCH: "Merch",
  TRANSPORTATION: "Transportation",
};

export const PRIORITY_LABEL: Record<Priority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };
export const PRIORITY_CLASSES: Record<Priority, string> = {
  LOW: "text-neutral-500 border-neutral-700",
  MEDIUM: "text-status-review border-status-review/30",
  HIGH: "text-orange-400 border-orange-400/30",
  CRITICAL: "text-status-missing border-status-missing/30",
};

export const RISK_LABEL: Record<RiskLevel, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export const ISSUE_SEVERITY_LABEL: Record<IssueSeverity, string> = { MINOR: "Minor", MODERATE: "Moderate", MAJOR: "Major", CRITICAL: "Critical" };
export const ISSUE_SEVERITY_CLASSES: Record<IssueSeverity, string> = {
  MINOR: "text-neutral-400 border-neutral-700 bg-neutral-800/40",
  MODERATE: "text-status-review border-status-review/30 bg-status-review/10",
  MAJOR: "text-orange-400 border-orange-400/30 bg-orange-400/10",
  CRITICAL: "text-status-missing border-status-missing/30 bg-status-missing/10",
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { OPEN: "Open", IN_PROGRESS: "In Progress", RESOLVED: "Resolved", CLOSED: "Closed" };
export const ISSUE_STATUS_DOT: Record<IssueStatus, string> = {
  OPEN: "bg-status-missing",
  IN_PROGRESS: "bg-status-review",
  RESOLVED: "bg-status-confirmed",
  CLOSED: "bg-status-idle",
};

export const TIMELINE_STATUS_LABEL: Record<TimelineEntryStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  BLOCKED: "Blocked",
  SKIPPED: "Skipped",
};
export const TIMELINE_STATUS_CLASSES: Record<TimelineEntryStatus, { dot: string; badge: string }> = {
  NOT_STARTED: { dot: "bg-status-idle", badge: "bg-status-idle/10 text-status-idle border-status-idle/30" },
  IN_PROGRESS: { dot: "bg-status-review", badge: "bg-status-review/10 text-status-review border-status-review/30" },
  COMPLETE: { dot: "bg-status-confirmed", badge: "bg-status-confirmed/10 text-status-confirmed border-status-confirmed/30" },
  BLOCKED: { dot: "bg-status-missing", badge: "bg-status-missing/10 text-status-missing border-status-missing/30" },
  SKIPPED: { dot: "bg-neutral-600", badge: "bg-neutral-700/30 text-neutral-500 border-neutral-700" },
};
