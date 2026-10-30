// Show Binder (`binder`): composer of sections, cover page and crew-facing exports; validates BND-001..006.
import { profileFor, sectionVisible } from "../store/profiles";
import { BINDER_KEYS, hasLoadIn, hasShow, readiness } from "../store/readiness";
import { conditionPaths } from "../store/tasks";
import type {
  BinderSection, BinderSectionKey, Check, CheckDraft, ModuleContract, Patch, ScheduleEntry, ShowRecord, SystemProfile,
} from "../store/types";

export const REQUIRED_SECTIONS: BinderSectionKey[] = ["front-view", "video-system", "led", "power", "schedule", "contacts"];

const TITLES: Record<BinderSectionKey, string> = {
  "front-view": "Front view", rigging: "Rigging", "video-system": "Video system", led: "LED", cameras: "Cameras", network: "Network",
  foh: "FOH", power: "Power", schedule: "Schedule", contacts: "Contacts", notes: "Notes",
};

/** `auto` blocks bind to `<module>.<exportKey>`; the Binder renders them live from that module's exports[]. */
export const AUTO_REFS: Record<BinderSectionKey, string[]> = {
  "front-view": ["binder.cover"],
  rigging: ["led.rigging"],
  "video-system": ["signal.signal-flow", "racks.elevations", "servers.outputs"],
  led: ["led.walls"],
  cameras: ["signal.cameras"],
  network: ["signal.network"],
  foh: [],
  power: ["led.power", "binder.power-request"],
  schedule: ["binder.schedule"],
  contacts: ["binder.crew-sheet"],
  notes: [],
};

/** Sections for a profile: 11 in default order, visibility per profile, required unless hidden by profile. */
export function sectionsFor(profile: SystemProfile, newId: (p: "sec") => string): BinderSection[] {
  return BINDER_KEYS.map((key, i) => {
    const visible = sectionVisible(profile, key);
    return {
      id: newId("sec"), key, order: i + 1, visible, required: visible && REQUIRED_SECTIONS.includes(key),
      blocks: [...AUTO_REFS[key].map((ref) => ({ type: "auto" as const, ref, body: "" })), { type: "text" as const, ref: null, body: "" }],
    };
  });
}

// ---------------------------------------------------------------- helpers

function footer(r: ShowRecord): string {
  const rev = r.meta.status === "draft" ? `REV ${r.meta.revision}-draft` : `REV ${r.meta.revision}`;
  return `${r.showCode} · ${rev} · ${r.meta.status} · ${r.meta.updatedAt}${r.meta.status === "draft" ? " · DRAFT" : ""}`;
}

function isConfirmed(v: unknown): v is { value: unknown; state: string } {
  return !!v && typeof v === "object" && !Array.isArray(v) && "state" in (v as object) && "value" in (v as object);
}
function eventLeaves(r: ShowRecord): { path: string; state: string; value: unknown }[] {
  const out: { path: string; state: string; value: unknown }[] = [];
  const walk = (o: unknown, base: string) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (isConfirmed(v)) out.push({ path: `${base}/${k}`, state: v.state, value: v.value });
      else walk(v, `${base}/${k}`);
    }
  };
  walk(r.event, "/event");
  return out;
}

/** "12 confirmed · 3 assumed · 2 waiting" */
export function confirmationSummary(r: ShowRecord): string {
  const l = eventLeaves(r);
  const n = (s: string) => l.filter((x) => x.state === s).length;
  return `${n("confirmed")} confirmed · ${n("assumed")} assumed · ${n("asked")} waiting`;
}

const csv = (cells: unknown[]) => cells.map((c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",");

/** Advance leaves modules read directly (besides the ones task conditions read). */
const MODULE_EVENT_READS = [
  "/event/power/services", "/event/power/dedicated", "/event/rigging/maxTrim_ft", "/event/rigging/points", "/event/rigging/pointCapacity_lb",
  "/event/rigging/groundSupport", "/event/access/videoWorld", "/event/access/stageDims", "/event/signalPath/stageToFOH",
  "/event/signalPath/houseFibre", "/event/signalPath/houseFeeds", "/event/cameras/positions",
];

const ORDER: { key: string; re: RegExp; label: string }[] = [
  { key: "power-tie-in", re: /power tie-?in/i, label: "Power tie-in" },
  { key: "led-trim", re: /led trim/i, label: "LED trim" },
  { key: "line-check", re: /line check/i, label: "Line check" },
  { key: "rehearsal", re: /rehearsal/i, label: "Rehearsal" },
];

function stageOf(s: ScheduleEntry): number {
  return ORDER.findIndex((o) => s.key === o.key || (!s.key && o.re.test(s.item)));
}

// ---------------------------------------------------------------- validate

export function validateBinder(r: ShowRecord): CheckDraft[] {
  const out: CheckDraft[] = [];
  for (const s of r.binder.sections) {
    if (s.required && !s.visible) out.push({
      code: "BND-001", severity: "block", title: "Required section hidden", target: s.id,
      message: `The ${TITLES[s.key]} section is required for this show but is hidden.`,
      rule: `A section marked required must be visible at issue; ${TITLES[s.key]} has required = true and visible = false.`,
      involved: [s.id], evidence: [{ label: "Visible", value: "false", path: `/binder/sections/${s.id}/visible` }, { label: "Required", value: "true", path: `/binder/sections/${s.id}/required` }],
      fixes: [{ label: `Show the ${TITLES[s.key]} section`, module: "binder", patch: [{ op: "replace", path: `/binder/sections/${s.id}/visible`, value: true }] }],
    });
  }
  const missing = (["crewChief", "eic"] as const).filter((k) => !r.crew[k]?.trim());
  if (missing.length) {
    const names = missing.map((k) => (k === "eic" ? "EIC" : "Crew Chief"));
    out.push({
      code: "BND-002", severity: "warn", title: "Missing key crew", target: "crew",
      message: `${names.join(" and ")} ${missing.length > 1 ? "are" : "is"} not named yet.`,
      rule: "Every advance names an EIC and a Crew Chief; empty roles print as known gaps on the cover page.",
      involved: missing.map((k) => `crew.${k}`), evidence: missing.map((k) => ({ label: k === "eic" ? "EIC" : "Crew Chief", value: "(empty)", path: `/crew/${k}` })),
      fixes: [{ label: `Name the ${names.join(" and ")} in the Crew view`, module: "shell" }],
    });
  }
  if (!hasLoadIn(r) || !hasShow(r)) {
    const what = [!hasLoadIn(r) && "load-in", !hasShow(r) && "show"].filter(Boolean).join(" and ");
    out.push({
      code: "BND-003", severity: "warn", title: "Schedule incomplete", target: "schedule",
      message: `The schedule has no ${what} entry.`, rule: "A schedule needs at least a load-in and a show entry so tasks can be dated.",
      involved: r.binder.schedule.map((s) => s.id), evidence: [{ label: "Entries", value: String(r.binder.schedule.length), path: "/binder/schedule" }],
      fixes: [{ label: "Apply the profile schedule template", module: "shell" }],
    });
  }
  const approx = r.devices.filter((d) => d.source === "approximate" && (d.powerW > 0 || d.weightLb > 0 || d.class === "tile"));
  if (approx.length) out.push({
    code: "BND-004", severity: "info", title: "Approximate specs in totals", target: "devices",
    message: `${approx.length} device${approx.length > 1 ? "s" : ""} in the printed totals use approximate specs (${approx.slice(0, 4).map((d) => d.label).join(", ")}${approx.length > 4 ? "…" : ""}).`,
    rule: "Totals built on devices with source = approximate carry an ≈ badge until the specs are verified.",
    involved: approx.map((d) => d.id), evidence: approx.slice(0, 8).map((d) => ({ label: d.label, value: `${d.make} ${d.model} (approximate)`, path: `/devices/${d.id}/source` })),
    fixes: [{ label: "Verify the template against the current datasheet in the device library", module: "shell" }],
  });

  // BND-005: built on assumed advance values (only leaves a task or module actually reads).
  const read = new Set(MODULE_EVENT_READS);
  for (const t of r.tasks) for (const c of [t.produces, ...(t.consumes ?? [])]) if (c) conditionPaths(c).forEach((p) => p.startsWith("/event/") && read.add(p));
  const assumed = eventLeaves(r).filter((l) => l.state === "assumed" && [...read].some((p) => p === l.path || p.startsWith(l.path + "/") || l.path.startsWith(p + "/")));
  if (assumed.length) out.push({
    code: "BND-005", severity: "info", title: "Built on assumed advance values", target: "event",
    message: `${assumed.length} advance answer${assumed.length > 1 ? "s are" : " is"} assumed, not confirmed: ${assumed.slice(0, 4).map((a) => a.path.slice(7).replace(/\//g, ".")).join(", ")}${assumed.length > 4 ? "…" : ""}.`,
    rule: "Assumed values unblock downstream work but every derived number that uses them carries an ≈ badge until the venue confirms.",
    involved: assumed.map((a) => a.path), evidence: assumed.map((a) => ({ label: a.path.slice(7).replace(/\//g, "."), value: JSON.stringify(a.value), path: a.path })),
    fixes: [{ label: "Confirm these answers with the venue in the Advance view", module: "shell" }],
  });

  // BND-006: power tie-in < LED trim < line check < rehearsal, per day.
  const days = new Map<string, ScheduleEntry[]>();
  for (const s of r.binder.schedule) if (s.time && stageOf(s) >= 0) days.set(s.date, [...(days.get(s.date) ?? []), s]);
  for (const entries of days.values()) {
    for (const a of entries) for (const b of entries) {
      const sa = stageOf(a), sb = stageOf(b);
      if (sa < sb && a.time > b.time) out.push({
        code: "BND-006", severity: "warn", title: "Schedule order violation", target: b.id,
        message: `${ORDER[sb].label} is scheduled before ${ORDER[sa].label.toLowerCase()} on ${b.date} (${b.time} vs ${a.time}).`,
        rule: `Video dependencies run power tie-in → LED trim → line check → rehearsal; ${ORDER[sb].label} at ${b.time} precedes ${ORDER[sa].label} at ${a.time}.`,
        involved: [a.id, b.id], evidence: [{ label: ORDER[sb].label, value: `${b.date} ${b.time}`, path: `/binder/schedule/${b.id}/time` }, { label: ORDER[sa].label, value: `${a.date} ${a.time}`, path: `/binder/schedule/${a.id}/time` }],
        fixes: [{ label: `Move ${ORDER[sb].label} after ${ORDER[sa].label}`, module: "shell" }],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- exports

function openChecks(r: ShowRecord, sev?: Check["severity"]) {
  return r.binder.checks.filter((c) => !c.resolved && (!sev || c.severity === sev));
}

export function renderCover(r: ShowRecord): string {
  const rd = readiness(r);
  const lines: string[] = [];
  const rev = r.meta.status === "draft" ? `REV ${r.meta.revision}-draft` : `REV ${r.meta.revision}`;
  lines.push(`# ${r.name || "(untitled show)"}`, "", `**${r.showCode} · ${rev} · ${r.meta.status.toUpperCase()}**${r.meta.status === "draft" ? " — DRAFT" : ""}`, "");
  lines.push(`- Artist: ${r.client.artist || "—"}`, `- Event: ${r.event.type} · ${r.event.dates.join(", ") || "date TBD"}`,
    `- Venue: ${[r.event.venueName, r.event.room, r.event.city, r.event.state].filter(Boolean).join(", ") || "TBD"}`,
    `- Vendor: ${r.vendor.company}${r.vendor.orderRef ? ` · ${r.vendor.orderSystem} ${r.vendor.orderRef}` : ""}`,
    `- Advance answers: ${confirmationSummary(r)}`, "");
  lines.push(`## Readiness — ${rd.advance ? "advance-ready" : "not ready"}`);
  for (const c of rd.criteria) lines.push(`- [${c.ok ? "x" : " "}] ${c.label}${!c.ok && c.blocks ? " (blocks issue)" : ""}`);
  lines.push("", `## Known gaps at Rev ${r.meta.revision}`);
  const gaps = openChecks(r, "warn");
  if (!gaps.length) lines.push("- None");
  for (const c of gaps) lines.push(`- ${c.code} · ${c.message}`);
  const blocks = openChecks(r, "block");
  if (blocks.length) { lines.push("", "## Blocking"); for (const c of blocks) lines.push(`- ${c.code} · ${c.message}`); }
  lines.push("", `## Open items at Rev ${r.meta.revision}`);
  const open = r.tasks.filter((t) => t.status !== "done" && t.status !== "na")
    .sort((a, b) => a.lane.localeCompare(b.lane) || Number(b.status === "blocked") - Number(a.status === "blocked"));
  if (!open.length) lines.push("- None");
  for (const t of open) {
    const d = r.derived?.tasks?.[t.id];
    lines.push(`- [${t.lane}] ${t.key ? t.key + " · " : ""}${t.title} — ${t.status}${t.owner ? ` · ${t.owner}` : ""}${d?.dueResolved ? ` · due ${d.dueResolved}` : ""}${t.status === "blocked" && d?.blockers.length ? ` (${d.blockers.map((b) => b.label).join("; ")})` : ""}`);
  }
  lines.push("", "---", footer(r));
  return lines.join("\n");
}

export function renderChecksCsv(r: ShowRecord): string {
  const rows = [csv(["code", "module", "severity", "title", "target", "message", "resolved", "resolution", "firstSeen", "lastSeen"])];
  const rank = { block: 0, warn: 1, info: 2 } as const;
  for (const c of [...r.binder.checks].sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code)))
    rows.push(csv([c.code, c.module, c.severity, c.title, c.target, c.message, c.resolved, c.resolution ?? "", c.firstSeen, c.lastSeen]));
  return rows.join("\n") + "\n";
}

const ROLE_LABEL: [keyof ShowRecord["crew"], string][] = [
  ["videoDirector", "Video Director"], ["crewChief", "Crew Chief"], ["eic", "EIC"], ["ledLead", "LED Lead"], ["cameraLead", "Camera Lead"],
  ["serverOp", "Server Op"], ["pm", "PM"], ["localLabor", "Local labor"],
];

export function renderCrewSheet(r: ShowRecord): string {
  const lines = [`# Crew sheet — ${r.name || r.showCode}`, "", `${r.event.venueName || "Venue TBD"} · ${r.event.dates.join(", ") || "date TBD"}`, "", "## Roles", "| Role | Name |", "| --- | --- |"];
  for (const [k, label] of ROLE_LABEL) lines.push(`| ${label} | ${r.crew[k] || "TBD"} |`);
  lines.push("", "## Calls", "| Date | Time | Item | Owner |", "| --- | --- | --- | --- |");
  for (const s of [...r.binder.schedule].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) lines.push(`| ${s.date} | ${s.time || "—"} | ${s.item} | ${s.owner || ""} |`);
  lines.push("", "## Contacts", "| Name | Role | Phone | Email |", "| --- | --- | --- | --- |");
  for (const c of r.binder.contacts) lines.push(`| ${c.name} | ${c.role} | ${c.phone} | ${c.email} |`);
  const cred = r.event.access.credentials;
  lines.push("", `Credentials: ${cred.value ?? "TBD"} (${cred.state})`, "", "---", footer(r));
  return lines.join("\n");
}

function leafLine(label: string, v: { value: unknown; state: string }): string {
  const val = v.value === null || v.value === undefined ? "—" : typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value);
  return `- ${label}: ${val} _(${v.state})_`;
}

export function renderAdvancePacket(r: ShowRecord): string {
  const e = r.event;
  const L: string[] = [`# Video advance packet — ${r.showCode} REV ${r.meta.revision}${r.meta.status === "draft" ? "-draft" : ""}`, "",
    `${r.name} · ${e.venueName}, ${e.city} ${e.state} · ${e.dates.join(", ")}`, "", `Field confirmation: ${confirmationSummary(r)}`, ""];
  L.push("## Video system", `- House format ${r.signal.formats.house || "—"}, LED input ${r.signal.formats.ledInput || "—"}, record ${r.signal.formats.record || "—"}`);
  for (const w of r.led.walls) {
    const d = r.derived?.led?.perWall?.[w.id];
    L.push(`- ${w.name}: ${w.cols}×${w.rows} ${w.tileModel}${d ? ` · ${d.w_px}×${d.h_px} px · ${d.w_ft.toFixed(1)}×${d.h_ft.toFixed(1)} ft · ${Math.round(d.weightLb)} lb` : ""} · ${w.rigging.type}, trim ${w.trimHeight_ft} ft`);
  }
  L.push(`- Racks: ${r.racks.map((k) => `${k.name} (${k.ruTotal}RU, ${k.location})`).join(", ") || "—"}`, "");
  L.push("## Power request");
  L.push(leafLine("Services", e.power.services), leafLine("Dedicated", e.power.dedicated), leafLine("Electrician", e.power.electrician), leafLine("Generator", e.power.generator));
  L.push(`- Demand: ${Math.round(r.derived?.power?.totalW ?? 0)} W max, ${(r.derived?.power?.totalA_perLeg ?? 0).toFixed(1)} A per leg`, "");
  L.push("## Rigging request");
  L.push(leafLine("Max trim (ft)", e.rigging.maxTrim_ft), leafLine("Points", e.rigging.points), leafLine("Point capacity (lb)", e.rigging.pointCapacity_lb), leafLine("Motors", e.rigging.motors), leafLine("Ground support", e.rigging.groundSupport));
  for (const w of r.led.walls) L.push(`- ${w.name}: ${w.rigging.headers} headers, ${Math.round(r.derived?.led?.perWall?.[w.id]?.weightLb ?? 0)} lb`);
  L.push("", "## FOH and camera footprint", leafLine("FOH", e.foh), leafLine("Stage to FOH", e.signalPath.stageToFOH), leafLine("Camera positions", e.cameras.positions), leafLine("House feeds", e.signalPath.houseFeeds), "");
  L.push("## Schedule asks");
  for (const s of [...r.binder.schedule].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) L.push(`- ${s.date} ${s.time || "--:--"} ${s.item}${s.confirmed ? "" : " (to confirm)"}`);
  L.push("", "---", `${footer(r)} · ${confirmationSummary(r)}`);
  return L.join("\n");
}

export function renderPowerRequest(r: ShowRecord): string {
  const p = r.event.power;
  const services = (p.services.value ?? []) as NonNullable<typeof p.services.value>;
  const L = [`# Power request — ${r.showCode}`, "", `${r.event.venueName} · ${r.event.dates.join(", ")}`, "", "| Service | Amps | Phase | Volts | Connector | Location | State |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const s of services) L.push(`| ${s.id} | ${s.amps} | ${s.phase} | ${s.volts} | ${s.connector} | ${s.location} | ${p.services.state} |`);
  if (!services.length) L.push(`| ${p.service || "—"} | ${p.amps ?? "—"} | — | — | — | ${p.location || "—"} | ${p.amps ? "entered" : "unknown"} |`);
  L.push("", "## Demand", "| Wall / circuit | Rated A | Load A | % |", "| --- | --- | --- | --- |");
  for (const w of r.led.walls) for (const c of w.power.circuits) {
    const d = r.derived?.power?.byCircuit?.[c.id];
    L.push(`| ${w.name} ${c.id} | ${c.amps} | ${(d?.loadA ?? 0).toFixed(1)} | ${Math.round(d && c.amps ? (100 * d.loadA) / c.amps : 0)} |`);
  }
  for (const k of r.racks) { const d = r.derived?.racks?.byRack?.[k.id]; L.push(`| ${k.name} (${k.power.inlet}) | — | ${(d?.amps ?? 0).toFixed(1)} | — |`); }
  L.push("", `Total ${Math.round(r.derived?.power?.totalW ?? 0)} W · ${(r.derived?.power?.totalA_perLeg ?? 0).toFixed(1)} A per leg`, leafLine("Electrician", p.electrician), leafLine("Constraints", p.constraints), "", "---", footer(r));
  return L.join("\n");
}

export function renderSchedule(r: ShowRecord): string {
  const L = ["| Date | Time | Item | Owner | Confirmed |", "| --- | --- | --- | --- | --- |"];
  for (const s of [...r.binder.schedule].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) L.push(`| ${s.date} | ${s.time} | ${s.item} | ${s.owner} | ${s.confirmed ? "yes" : "no"} |`);
  return L.join("\n");
}

// ---------------------------------------------------------------- contract

export const binderModule: ModuleContract = {
  id: "binder",
  version: "1.0.0",
  owns: ["/binder"],
  reads: ["/"],
  deviceClasses: [],
  cableTypes: [],
  seed(record, ctx): Patch[] {
    if (record.binder.sections.length) return [];
    return sectionsFor(profileFor(ctx.profile), (p) => ctx.newId(p)).map((s) => ({ op: "add" as const, path: "/binder/sections/-", value: s }));
  },
  derive() { return {}; },
  validate(record) { return validateBinder(record); },
  exports: [
    { key: "cover", label: "Cover page", mime: "text/markdown", render: renderCover },
    { key: "checks-csv", label: "Checks report", mime: "text/csv", render: renderChecksCsv },
    { key: "crew-sheet", label: "Crew sheet", mime: "text/markdown", render: renderCrewSheet },
    { key: "advance-packet", label: "Advance packet", mime: "text/markdown", render: renderAdvancePacket },
    { key: "power-request", label: "Power request", mime: "text/markdown", render: renderPowerRequest },
    { key: "schedule", label: "Schedule", mime: "text/markdown", render: renderSchedule },
  ],
};
