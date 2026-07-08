import type { Status, TourStop } from "../types";
import { rollupStatus } from "./status";

export interface SectionCompletion {
  key:
    | "venue"
    | "schedule"
    | "videoPackage"
    | "labor"
    | "power"
    | "rigging"
    | "signal"
    | "documents";
  label: string;
  percent: number;
  status: Status;
}

function percentToStatus(percent: number): Status {
  if (percent >= 100) return "confirmed";
  if (percent <= 0) return "not-started";
  return "needs-review";
}

function fractionComplete(filled: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((filled / total) * 100);
}

const CRITICAL_VENUE_FIELDS: Array<[string, (stop: TourStop) => string]> = [
  ["Venue name", (s) => s.venue.name],
  ["Venue address", (s) => s.venue.address],
  ["Production contact name", (s) => s.venue.productionContact.name],
  ["Production contact email or phone", (s) => s.venue.productionContact.email || s.venue.productionContact.phone || ""],
  ["Dock access", (s) => s.venue.dockAccess],
  ["Truck parking", (s) => s.venue.truckParking],
  ["Bus parking", (s) => s.venue.busParking],
  ["Stage dimensions", (s) => s.venue.stageDimensions],
  ["FOH location", (s) => s.venue.fohLocation],
  ["FOH cable path", (s) => s.venue.fohCablePath],
  ["Internet availability", (s) => s.venue.internetAvailability],
  ["Venue curfew", (s) => s.venue.curfew],
];

export function venueCompletion(stop: TourStop): SectionCompletion {
  const filled = CRITICAL_VENUE_FIELDS.filter(([, get]) => get(stop).trim().length > 0).length;
  const percent = fractionComplete(filled, CRITICAL_VENUE_FIELDS.length);
  return { key: "venue", label: "Venue Info", percent, status: percentToStatus(percent) };
}

export function scheduleCompletion(stop: TourStop): SectionCompletion {
  const items = stop.schedule;
  const confirmed = items.filter((i) => i.status === "confirmed").length;
  const percent = fractionComplete(confirmed, items.length);
  const status = items.some((i) => i.status === "missing") ? "missing" : percentToStatus(percent);
  return { key: "schedule", label: "Schedule", percent, status };
}

export function videoPackageCompletion(stop: TourStop): SectionCompletion {
  const items = stop.videoPackage;
  const confirmed = items.filter((i) => i.status === "confirmed").length;
  const percent = fractionComplete(confirmed, items.length);
  const status = items.some((i) => i.status === "missing") ? "missing" : percentToStatus(percent);
  return { key: "videoPackage", label: "Video Package", percent, status };
}

export function laborCompletion(stop: TourStop): SectionCompletion {
  const roles = stop.labor.roles;
  const confirmed = roles.filter((r) => r.confirmed).length;
  const percent = roles.length === 0 ? 0 : fractionComplete(confirmed, roles.length);
  const status = roles.length === 0 ? "not-started" : rollupStatus([stop.labor.status, percentToStatus(percent)]);
  return { key: "labor", label: "Labor", percent, status };
}

export function powerCompletion(stop: TourStop): SectionCompletion {
  const checklist = stop.power.checklist;
  const confirmed = checklist.filter((c) => c.status === "confirmed").length;
  const percent = fractionComplete(confirmed, checklist.length);
  const status = rollupStatus([stop.power.status, percentToStatus(percent)]);
  return { key: "power", label: "Power", percent, status };
}

const RIGGING_FIELDS: Array<(stop: TourStop) => string> = [
  (s) => s.rigging.ledWallPoints,
  (s) => s.rigging.motorCount,
  (s) => s.rigging.motorSize,
  (s) => s.rigging.cablePickPoints,
  (s) => s.rigging.trimHeight,
  (s) => s.rigging.weightNotes,
  (s) => s.rigging.houseRiggerContact.name,
  (s) => s.rigging.restrictions,
];

export function riggingCompletion(stop: TourStop): SectionCompletion {
  const filledFields = RIGGING_FIELDS.filter((get) => get(stop).trim().length > 0).length;
  const total = RIGGING_FIELDS.length + 1; // +1 for riggingPlotReceived
  const filled = filledFields + (stop.rigging.riggingPlotReceived ? 1 : 0);
  const percent = fractionComplete(filled, total);
  const status = rollupStatus([stop.rigging.status, percentToStatus(percent)]);
  return { key: "rigging", label: "Rigging", percent, status };
}

export function signalCompletion(stop: TourStop): SectionCompletion {
  const lines = stop.signal.lines;
  const confirmed = lines.filter((l) => l.status === "confirmed").length;
  const percent = lines.length === 0 ? 0 : fractionComplete(confirmed, lines.length);
  const status = lines.length === 0 ? "not-started" : percentToStatus(percent);
  return { key: "signal", label: "Signal", percent, status };
}

export const CRITICAL_DOCUMENTS = [
  "Venue Packet",
  "Rigging Plot",
  "Stage Plot",
  "Power Plot",
  "Labor Sheet",
];

export function documentsCompletion(stop: TourStop): SectionCompletion {
  const docs = stop.documents;
  const uploaded = docs.filter((d) => d.status === "uploaded").length;
  const percent = fractionComplete(uploaded, docs.length);
  return { key: "documents", label: "Documents", percent, status: percentToStatus(percent) };
}

export function allSectionCompletions(stop: TourStop): SectionCompletion[] {
  return [
    venueCompletion(stop),
    scheduleCompletion(stop),
    videoPackageCompletion(stop),
    laborCompletion(stop),
    powerCompletion(stop),
    riggingCompletion(stop),
    signalCompletion(stop),
    documentsCompletion(stop),
  ];
}

/** Overall advance completion percentage — equal-weighted average across all sections. */
export function overallCompletion(stop: TourStop): number {
  const sections = allSectionCompletions(stop);
  const sum = sections.reduce((acc, s) => acc + s.percent, 0);
  return Math.round(sum / sections.length);
}

/** Human-readable list of missing/blocking items surfaced on the dashboard. */
export function missingCriticalItems(stop: TourStop): string[] {
  const items: string[] = [];

  for (const [label, get] of CRITICAL_VENUE_FIELDS) {
    if (get(stop).trim().length === 0) items.push(`Venue: ${label} missing`);
  }

  for (const item of stop.schedule) {
    if (item.status === "missing") items.push(`Schedule: ${item.label} unresolved`);
  }

  for (const item of stop.videoPackage) {
    if (item.status === "missing") items.push(`Video Package: ${item.category} not confirmed`);
  }

  if (stop.labor.roles.length === 0) {
    items.push("Labor: no labor plan started");
  } else {
    for (const role of stop.labor.roles) {
      if (!role.confirmed) items.push(`Labor: ${role.role} not confirmed`);
    }
  }

  if (stop.power.status === "missing") items.push("Power: advance not started");
  for (const check of stop.power.checklist) {
    if (check.status === "missing") items.push(`Power: ${check.label} unresolved`);
  }

  if (stop.rigging.status === "missing") items.push("Rigging: advance not started");
  if (!stop.rigging.riggingPlotReceived) items.push("Rigging: plot not received");

  if (stop.signal.lines.length === 0) {
    items.push("Signal: no signal plan started");
  } else {
    for (const line of stop.signal.lines) {
      if (line.status === "missing") items.push(`Signal: ${line.source} → ${line.destination} not confirmed`);
    }
  }

  for (const doc of stop.documents) {
    if (CRITICAL_DOCUMENTS.includes(doc.name) && doc.status !== "uploaded") {
      items.push(`Documents: ${doc.name} not uploaded`);
    }
  }

  return items;
}
