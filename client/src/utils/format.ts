/** Parses either a plain date ("2026-07-14") or a full ISO datetime ("2026-07-14T00:00:00.000Z") as UTC, so the calendar date shown never shifts with the viewer's timezone. */
function parseDateUTC(iso: string): Date {
  const datePart = iso.slice(0, 10);
  return new Date(`${datePart}T00:00:00Z`);
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = parseDateUTC(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatDateShort(iso: string): string {
  if (!iso) return "—";
  const d = parseDateUTC(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function displayOrDash(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "—";
  return String(value);
}

let localIdCounter = 0;
export function makeLocalId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-local-${Date.now().toString(36)}-${localIdCounter}`;
}
