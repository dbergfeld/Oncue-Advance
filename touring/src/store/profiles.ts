// System profiles — "Defaults by show type" (New-show path tab).
// A profile is a starting point, not a constraint: every value is editable in its owning module afterwards.
import { newId } from "./ids";
import type { BinderSectionKey, EventType, ScheduleEntry, SystemProfile } from "./types";

export const TILE_CB5 = "tpl_roe_cb5";
export const TILE_V8T = "tpl_roe_v8t";

const VLANS_FULL = [
  { id: 10, name: "Control", subnet: "10.10.0.0/24" },
  { id: 20, name: "Media", subnet: "10.20.0.0/24" },
  { id: 30, name: "Comms", subnet: "10.30.0.0/24" },
];
const VLANS_CONTROL = [VLANS_FULL[0]];

const UHD = "3840x2160p59.94";
const HD = "1080p59.94";

const US = { name: "US Wall", position: "upstage" };
const IMAG_L = { name: "IMAG L", position: "stage left" };
const IMAG_R = { name: "IMAG R", position: "stage right" };

export const PROFILES: Record<EventType, SystemProfile> = {
  arena: {
    type: "arena", formats: { house: HD, ledInput: UHD, record: HD }, walls: [US, IMAG_L, IMAG_R], tileTemplate: TILE_CB5,
    cameras: 6, servers: 2, racks: ["VIDEO 1", "VIDEO 2"], distro: "3Ø 400A", redundancyExpected: true, dualServerExpected: true,
    record: "PGM + ISO 2", vlans: VLANS_FULL, binderHidden: [],
  },
  amphitheater: {
    type: "amphitheater", formats: { house: HD, ledInput: UHD, record: HD }, walls: [US, IMAG_L, IMAG_R], tileTemplate: TILE_CB5,
    cameras: 5, servers: 2, racks: ["VIDEO 1", "VIDEO 2"], distro: "3Ø 400A", redundancyExpected: true, dualServerExpected: false,
    record: "PGM", vlans: VLANS_FULL, binderHidden: [],
  },
  festival: {
    type: "festival", formats: { house: HD, ledInput: UHD, record: HD }, walls: [IMAG_L, IMAG_R], tileTemplate: TILE_V8T,
    cameras: 4, servers: 2, racks: ["VIDEO 1"], distro: "3Ø 200A", redundancyExpected: true, dualServerExpected: false,
    record: "PGM", vlans: VLANS_FULL, binderHidden: ["rigging", "foh"],
  },
  "fly-date": {
    type: "fly-date", formats: { house: HD, ledInput: HD, record: HD }, walls: [], tileTemplate: null,
    cameras: 3, servers: 1, racks: ["VIDEO 1"], distro: "1Ø 20A × 2", redundancyExpected: false, dualServerExpected: false,
    record: "PGM", vlans: VLANS_CONTROL, binderHidden: ["rigging", "foh"],
  },
  rehearsal: {
    type: "rehearsal", formats: { house: HD, ledInput: UHD, record: HD }, walls: [US], tileTemplate: TILE_CB5,
    cameras: 0, servers: 1, racks: ["VIDEO 1"], distro: "3Ø 200A", redundancyExpected: false, dualServerExpected: false,
    record: "None", vlans: VLANS_CONTROL, binderHidden: [],
    binderOnly: ["led", "power", "network", "schedule", "contacts"],
  },
  corporate: {
    type: "corporate", formats: { house: HD, ledInput: UHD, record: HD }, walls: [US], tileTemplate: TILE_CB5,
    cameras: 2, servers: 2, racks: ["VIDEO 1"], distro: "3Ø 200A", redundancyExpected: false, dualServerExpected: true,
    record: "PGM", vlans: VLANS_FULL, binderHidden: [],
  },
  broadcast: {
    type: "broadcast", formats: { house: HD, ledInput: HD, record: HD }, walls: [], tileTemplate: null,
    cameras: 8, servers: 1, racks: ["VIDEO 1", "VIDEO 2"], distro: "3Ø 200A", redundancyExpected: true, dualServerExpected: false,
    record: "PGM + ISO 4", vlans: VLANS_FULL, binderHidden: [],
  },
};

export function profileFor(type: EventType): SystemProfile {
  return PROFILES[type] ?? PROFILES.arena;
}

/** Distro phase implied by the profile's distro string. */
export function profilePhase(p: SystemProfile): "3Ø" | "1Ø" {
  return p.distro.startsWith("1Ø") ? "1Ø" : "3Ø";
}

/** Binder section visibility for a profile (hidden-by-profile sections can be re-enabled in the Binder). */
export function sectionVisible(p: SystemProfile, key: BinderSectionKey): boolean {
  if (p.binderOnly) return p.binderOnly.includes(key);
  return !p.binderHidden.includes(key);
}

type Slot = { key: string; time: string; item: string; owner: string };

const LOAD_IN_TEMPLATE: Slot[] = [
  { key: "load-in", time: "08:00", item: "Load-in", owner: "crewChief" },
  { key: "power-tie-in", time: "11:00", item: "Power tie-in", owner: "eic" },
  { key: "led-trim", time: "13:00", item: "LED trim", owner: "ledLead" },
  { key: "line-check", time: "16:00", item: "Video line check", owner: "eic" },
  { key: "rehearsal", time: "17:00", item: "Rehearsal / soundcheck", owner: "videoDirector" },
  { key: "doors", time: "18:30", item: "Doors", owner: "pm" },
  { key: "show", time: "20:00", item: "Show", owner: "videoDirector" },
  { key: "strike", time: "23:00", item: "Strike", owner: "crewChief" },
];

const TEMPLATES: Record<EventType, Slot[]> = {
  arena: LOAD_IN_TEMPLATE,
  amphitheater: LOAD_IN_TEMPLATE,
  corporate: LOAD_IN_TEMPLATE,
  broadcast: LOAD_IN_TEMPLATE,
  festival: [
    { key: "set", time: "14:00", item: "Changeover / set", owner: "crewChief" },
    { key: "line-check", time: "14:30", item: "Video line check", owner: "eic" },
    { key: "show", time: "15:00", item: "Show", owner: "videoDirector" },
  ],
  rehearsal: [{ key: "wall-up", time: "10:00", item: "Wall up", owner: "ledLead" }],
  "fly-date": [
    { key: "load-in", time: "08:00", item: "Load-in", owner: "crewChief" },
    { key: "show", time: "20:00", item: "Show", owner: "videoDirector" },
  ],
};

/** Profile schedule template, times on `date`. Ids are minted fresh (sch_). */
export function scheduleTemplate(type: EventType, date: string): ScheduleEntry[] {
  return (TEMPLATES[type] ?? LOAD_IN_TEMPLATE).map((s) => ({ id: newId("sch"), key: s.key, date, time: s.time, item: s.item, owner: s.owner, confirmed: false }));
}
