import type { DocumentItem, Requirement, RecordStatus, ScheduleItem, Show } from "../types";

/**
 * Deterministic completion math — the same category of calculation the
 * server's RiskEngine does for departmentHealth (see server/src/services/ai/RiskEngine.ts),
 * duplicated here so pages that don't need a live AI call (Requirement
 * Matrix, Dashboard summary cards) don't have to wait on one just to render
 * a percentage. The AI Risk Analysis panel adds judgment on top of these
 * exact numbers — it doesn't replace them.
 */

function percentToStatus(percent: number): RecordStatus {
  if (percent >= 100) return "CONFIRMED";
  if (percent <= 0) return "NOT_STARTED";
  return "NEEDS_REVIEW";
}

export interface DepartmentBucket {
  department: string;
  total: number;
  confirmed: number;
  missing: number;
  percent: number;
  status: RecordStatus;
}

export function requirementsByDepartment(requirements: Requirement[]): DepartmentBucket[] {
  const map = new Map<string, Requirement[]>();
  for (const req of requirements) {
    const list = map.get(req.department) ?? [];
    list.push(req);
    map.set(req.department, list);
  }
  return Array.from(map.entries())
    .map(([department, reqs]) => {
      const confirmed = reqs.filter((r) => r.status === "CONFIRMED").length;
      const missing = reqs.filter((r) => r.status === "MISSING").length;
      const percent = reqs.length === 0 ? 0 : Math.round((confirmed / reqs.length) * 100);
      return { department, total: reqs.length, confirmed, missing, percent, status: missing > 0 ? "MISSING" : percentToStatus(percent) } as DepartmentBucket;
    })
    .sort((a, b) => a.department.localeCompare(b.department));
}

export function requirementsCompletion(requirements: Requirement[]): { percent: number; status: RecordStatus } {
  if (requirements.length === 0) return { percent: 0, status: "NOT_STARTED" };
  const confirmed = requirements.filter((r) => r.status === "CONFIRMED").length;
  const percent = Math.round((confirmed / requirements.length) * 100);
  return { percent, status: percentToStatus(percent) };
}

export function scheduleCompletion(items: ScheduleItem[]): { percent: number; status: RecordStatus } {
  if (items.length === 0) return { percent: 0, status: "NOT_STARTED" };
  const confirmed = items.filter((i) => i.status === "CONFIRMED").length;
  const percent = Math.round((confirmed / items.length) * 100);
  const hasMissing = items.some((i) => i.status === "MISSING");
  return { percent, status: hasMissing ? "MISSING" : percentToStatus(percent) };
}

export function documentsCompletion(documents: DocumentItem[]): { percent: number; status: RecordStatus } {
  if (documents.length === 0) return { percent: 0, status: "NOT_STARTED" };
  const uploaded = documents.filter((d) => d.status === "UPLOADED").length;
  const percent = Math.round((uploaded / documents.length) * 100);
  return { percent, status: percentToStatus(percent) };
}

/** Equal-weighted average across Requirements, Schedule, and Documents. */
export function overallCompletion(show: Show): number {
  const sections = [requirementsCompletion(show.requirements), scheduleCompletion(show.scheduleItems), documentsCompletion(show.documents)];
  return Math.round(sections.reduce((sum, s) => sum + s.percent, 0) / sections.length);
}

export const CRITICAL_DOCUMENTS = ["Venue Packet", "Rigging Plot", "Stage Plot", "Power Plot", "Labor Sheet"];

/** Human-readable blockers — the deterministic counterpart to the AI Risk Engine's missingCriticalItems. */
export function missingCriticalItems(show: Show): string[] {
  const items: string[] = [];

  for (const req of show.requirements) {
    if (req.required && req.status === "MISSING") items.push(`${req.department}: ${req.name} missing`);
  }
  for (const item of show.scheduleItems) {
    if (item.status === "MISSING") items.push(`Schedule: ${item.label} unresolved`);
  }
  for (const doc of show.documents) {
    if (CRITICAL_DOCUMENTS.includes(doc.name) && doc.status !== "UPLOADED") items.push(`Documents: ${doc.name} not uploaded`);
  }
  for (const issue of show.issues) {
    if ((issue.severity === "CRITICAL" || issue.severity === "MAJOR") && (issue.status === "OPEN" || issue.status === "IN_PROGRESS")) {
      items.push(`Issue: ${issue.title} (${issue.severity.toLowerCase()})`);
    }
  }

  return items;
}
