// The six-step New-show wizard as plain functions over a Workspace. Every step writes through patch() with
// reason `setup:<step>` and the writer that owns each slice, so the changelog shows what was seeded.
import { addWall, autoCircuits, autoProcessors, autoSplitRuns, setCanvas, sizeWall } from "../modules/led";
import { addRack, autoRack } from "../modules/rack";
import { addServerPair, assignOutputs, syncContentSpecs } from "../modules/servers";
import { addSignalDevice, autoPatchProgram, connect } from "../modules/signal/helpers";
import { seedPhysical } from "../modules/signal/physical";
import { newId } from "../store/ids";
import { profileFor, profilePhase, scheduleTemplate } from "../store/profiles";
import { firstIncompleteStep, readiness, setupCompleted } from "../store/readiness";
import { slug, StoreFailure, type Workspace } from "../store/store";
import { seedTasks } from "../store/tasks";
import type {
  Check, Contact, Crew, Device, EventType, Lane, ModuleId, Patch, ScheduleEntry, ShowRecord, SystemProfile, Wall, WriterId,
} from "../store/types";
import { loadExample } from "./example";

export { firstIncompleteStep, setupCompleted };

function apply(ws: Workspace, showId: string, by: WriterId, ops: Patch[], step: string, cascade = false): void {
  if (!ops.length) return;
  const res = ws.patch(showId, by, ops, `setup:${step}`, cascade ? { cascade: true } : {});
  if (!res.ok) throw new StoreFailure(res.errors!);
}

// ---------------------------------------------------------------- step 1 · Identify

export interface Step1 {
  source: "blank" | "template" | "example" | "copy";
  copyFrom?: string;
  artist: string; name?: string; type: EventType; dates: string[];
  venueName: string; city: string; state?: string; room?: string; orderRef?: string;
}

/** Creates (or copies) the show and writes identity + vendor. Example starts return the read-only example. */
export function newShowFromWizard(ws: Workspace, s: Step1): string {
  if (s.source === "example") return loadExample(ws).showId;
  const year = Number((s.dates[0] ?? "").slice(0, 4)) || new Date().getFullYear();
  const r = (s.source === "copy" || s.source === "template") && s.copyFrom
    ? ws.copyShow(s.copyFrom)
    : ws.createShow({ source: "blank", artist: s.artist, year });
  const id = r.showId;
  const name = s.name?.trim() || [s.artist, s.venueName].filter(Boolean).join(" · ");
  const ops: Patch[] = [
    { op: "replace", path: "/name", value: name },
    { op: "replace", path: "/client/artist", value: s.artist },
    { op: "replace", path: "/event/type", value: s.type },
    { op: "replace", path: "/event/dates", value: [...s.dates] },
    { op: "replace", path: "/event/venueName", value: s.venueName },
    { op: "replace", path: "/event/venueId", value: s.venueName ? slug(`${s.venueName}-${s.city}`) : null },
    { op: "replace", path: "/event/city", value: s.city },
    { op: "replace", path: "/event/state", value: s.state ?? "" },
    { op: "replace", path: "/event/room", value: s.room ?? "" },
    { op: "replace", path: "/vendor/orderRef", value: s.orderRef ?? "" },
  ];
  if (!r.vendor.company) ops.push({ op: "replace", path: "/vendor/company", value: "Fuse Operations" });
  if (!r.vendor.orderSystem) ops.push({ op: "replace", path: "/vendor/orderSystem", value: "RentalWorks" });
  apply(ws, id, "shell", ops, "identify");
  return id;
}

// ---------------------------------------------------------------- step 2 · Profile

export interface Step2 { walls?: number; cameras?: number; servers?: 0 | 1 | 2; imag?: boolean; record?: boolean; redundantPgm?: boolean }

const EXTRA_WALLS = [{ name: "SL Wall", position: "stage left" }, { name: "SR Wall", position: "stage right" }, { name: "DS Wall", position: "downstage" }];

/** The profile with the step-2 counts and toggles folded in. */
export function effectiveProfile(type: EventType, o: Step2 = {}): SystemProfile {
  const base = profileFor(type);
  let walls = base.walls.filter((w) => o.imag !== false || !/IMAG/.test(w.name));
  if (o.imag && !walls.some((w) => /IMAG/.test(w.name)) && (o.walls ?? 0) > walls.length) walls = [...walls, { name: "IMAG L", position: "stage left" }, { name: "IMAG R", position: "stage right" }];
  const n = Math.max(0, Math.min(6, o.walls ?? walls.length));
  const pool = [...walls, ...EXTRA_WALLS.filter((x) => !walls.some((w) => w.name === x.name))];
  while (pool.length < n) pool.push({ name: `Wall ${pool.length + 1}`, position: "upstage" });
  return {
    ...base, walls: pool.slice(0, n),
    cameras: Math.max(0, Math.min(12, o.cameras ?? base.cameras)),
    servers: o.servers ?? base.servers,
    redundancyExpected: o.redundantPgm ?? base.redundancyExpected,
    record: o.record === false ? "None" : base.record,
    tileTemplate: base.tileTemplate ?? "tpl_roe_cb5",
  };
}

const SEED_ORDER: ModuleId[] = ["led", "rack", "servers", "signal", "binder"];
const LANE_ORDER: Lane[] = ["advance", "led", "crew", "servers", "signal", "rack", "prep"];
const LANE_WRITER: Record<Lane, WriterId> = { advance: "shell", crew: "shell", prep: "shell", led: "led", signal: "signal", servers: "servers", rack: "rack" };

/**
 * Step 2: every module's seed() as that module, then the profile on top — formats, VLANs, racks, placeholder
 * walls (0×0), cameras and server hosts, binder sections — then the seeded task chain and physical positions.
 */
export function applyProfile(ws: Workspace, showId: string, o: Step2 = {}): SystemProfile {
  const type = ws.get(showId).event.type;
  const profile = effectiveProfile(type, o);
  const phase = profilePhase(profile);

  // Module seeds, each as its own writer.
  const ledSeeded = new Set<string>();
  for (const id of SEED_ORDER) {
    const m = ws.engine.modules.find((x) => x.id === id);
    if (!m) continue;
    const ops = m.seed(ws.get(showId), { newId, profile: type });
    if (id === "led") ops.forEach((p) => p.op === "add" && p.path === "/devices/-" && ledSeeded.add((p.value as Device).id));
    apply(ws, showId, id, ops, "profile");
  }

  // Signal: formats and network from the profile.
  let r = ws.get(showId);
  apply(ws, showId, "signal", [
    { op: "replace", path: "/signal/formats", value: { ...r.signal.formats, ...profile.formats } },
    { op: "replace", path: "/signal/network/vlans", value: profile.vlans },
  ], "profile");

  // Racks named by the profile.
  for (const name of profile.racks) {
    r = ws.get(showId);
    if (!r.racks.some((k) => k.name === name)) apply(ws, showId, "rack", addRack(r, name, newId), "profile");
  }

  // Walls: placeholders (0×0) by name; the LED seed's US Wall is reused, extra walls removed.
  const tpl = profile.tileTemplate ?? "tpl_roe_cb5";
  for (const want of profile.walls) {
    r = ws.get(showId);
    const have = r.led.walls.find((w) => w.name === want.name);
    if (have) apply(ws, showId, "led", sizeWall(r, have.id, { templateId: tpl, position: want.position, phase }), "profile");
    else apply(ws, showId, "led", addWall(r, { name: want.name, templateId: tpl, position: want.position, phase }, newId), "profile");
  }
  r = ws.get(showId);
  const extra = r.led.walls.filter((w) => !profile.walls.some((x) => x.name === w.name));
  if (extra.length) {
    apply(ws, showId, "led", extra.map((w) => ({ op: "remove" as const, path: `/led/walls/${w.id}` })), "profile", true);
    r = ws.get(showId);
    apply(ws, showId, "led", setCanvas(r), "profile");
  }
  if (!profile.walls.length) {
    // House LED / no walls: drop the processors and distro the LED seed placed for its default wall.
    r = ws.get(showId);
    const drop = r.devices.filter((d) => ledSeeded.has(d.id));
    const cables = r.cables.filter((c) => drop.some((d) => d.ports.some((p) => p.id === c.fromPort || p.id === c.toPort)));
    apply(ws, showId, "led", [...cables.map((c) => ({ op: "remove" as const, path: `/cables/${c.id}` })), ...drop.map((d) => ({ op: "remove" as const, path: `/devices/${d.id}` }))], "profile", true);
  }

  // Servers: 0 / 1 / A+B.
  r = ws.get(showId);
  const hosts = r.servers.hosts;
  if (profile.servers === 2 && hosts.length === 0) apply(ws, showId, "servers", addServerPair(r, newId), "profile");
  if (profile.servers < hosts.length) {
    const keep = [...hosts].sort((a, b) => Number(a.role !== "master") - Number(b.role !== "master")).slice(0, profile.servers);
    const gone = hosts.filter((h) => !keep.includes(h));
    const ops: Patch[] = gone.map((h) => ({ op: "remove", path: `/servers/hosts/${h.id}` }));
    for (const h of gone) ops.push({ op: "remove", path: `/devices/${h.deviceId}` });
    apply(ws, showId, "servers", ops, "profile", true);
  }
  if (profile.servers >= 1 && ws.get(showId).servers.hosts.length === 0) {
    // One host: add the pair and keep the master.
    apply(ws, showId, "servers", addServerPair(ws.get(showId), newId), "profile");
    const h = ws.get(showId).servers.hosts.find((x) => x.role === "backup");
    if (h && profile.servers === 1) apply(ws, showId, "servers", [{ op: "remove", path: `/servers/hosts/${h.id}` }, { op: "remove", path: `/devices/${h.deviceId}` }], "profile", true);
  }

  // Cameras: placeholders with labels only.
  r = ws.get(showId);
  const cams = r.devices.filter((d) => d.class === "camera").length;
  const camOps: Patch[] = [];
  const labels = new Set(r.devices.map((d) => d.label.toLowerCase()));
  for (let i = cams, n = 1; i < profile.cameras; i++) {
    while (labels.has(`cam ${n}`)) n++;
    labels.add(`cam ${n}`);
    camOps.push({ op: "add", path: "/devices/-", value: { id: newId("dev"), class: "camera", make: "", model: "TBD", label: `CAM ${n}`, qty: 1, rackId: null, ru: 0, powerW: 0, weightLb: 0, ports: [], inventoryRef: {} } satisfies Device });
  }
  apply(ws, showId, "signal", camOps, "profile");

  // Record: one recorder for program when the profile records.
  r = ws.get(showId);
  if (profile.record !== "None" && o.record !== false && !r.devices.some((d) => d.class === "recorder")) {
    try { apply(ws, showId, "signal", addSignalDevice(r, "tpl_bmd_hyperdeck_4kpro", "REC-1", newId), "profile"); } catch { /* template missing: leave for Signal Flow */ }
  }

  // Seeded handoff chain, each lane by its writer (upstream lanes first so blockedBy resolves).
  r = ws.get(showId);
  if (!r.tasks.some((t) => t.source === "setup")) {
    const tasks = seedTasks(r, profile, newId);
    for (const lane of LANE_ORDER) apply(ws, showId, LANE_WRITER[lane], tasks.filter((t) => t.lane === lane).map((t) => ({ op: "add" as const, path: "/tasks/-", value: t })), "profile");
  }
  apply(ws, showId, "signal", seedPhysical(ws.get(showId), newId), "profile");
  return profile;
}

// ---------------------------------------------------------------- step 3 · Size the walls

export interface WallSize {
  wallId: string; templateId?: string; cols: number; rows: number; position?: string;
  rigging?: Wall["rigging"]["type"] | Partial<Wall["rigging"]>; trimHeight_ft?: number;
}

/**
 * Sizes each wall, then lets each module finish its slice: processors / data runs / circuits / canvas (LED),
 * content specs and outputs (Servers), rack placement (Rack), program patch A/B (Signal).
 */
export function sizeWalls(ws: Workspace, showId: string, walls: WallSize[], opts: { pickProcessor?: boolean } = { pickProcessor: true }): void {
  const profile = profileFor(ws.get(showId).event.type);
  const redundant = profile.redundancyExpected;
  for (const w of walls) {
    apply(ws, showId, "led", sizeWall(ws.get(showId), w.wallId, { templateId: w.templateId, cols: w.cols, rows: w.rows, position: w.position, rigging: w.rigging, trimHeight_ft: w.trimHeight_ft }), "walls");
    const cur = ws.get(showId).led.walls.find((x) => x.id === w.wallId)!;
    if (cur.rigging.headers === 0 && cur.cols > 0) apply(ws, showId, "led", [{ op: "replace", path: `/led/walls/${w.wallId}/rigging/headers`, value: Math.max(1, Math.ceil((cur.cols * cur.tileW_mm) / 3000)) }], "walls");
    if (opts.pickProcessor !== false) apply(ws, showId, "led", autoProcessors(ws.get(showId), w.wallId, newId, { redundant }), "walls");
    apply(ws, showId, "led", autoSplitRuns(ws.get(showId), w.wallId, newId, { redundant }), "walls");
    apply(ws, showId, "led", autoCircuits(ws.get(showId), w.wallId, newId), "walls");
  }
  apply(ws, showId, "led", setCanvas(ws.get(showId)), "walls");
  apply(ws, showId, "servers", syncContentSpecs(ws.get(showId)), "walls");
  apply(ws, showId, "servers", assignOutputs(ws.get(showId)), "walls");
  apply(ws, showId, "signal", autoPatchProgram(ws.get(showId), newId), "walls");
  patchRecorders(ws, showId);
  apply(ws, showId, "rack", autoRack(ws.get(showId), newId), "walls");
}

const VIDEO = /SDI|HDMI/;

/** Feeds each unfed recorder from a free switcher program output (SIG-013 recorder on program). */
function patchRecorders(ws: Workspace, showId: string): void {
  for (;;) {
    const r = ws.get(showId);
    const busy = new Set(r.cables.flatMap((c) => [c.fromPort, c.toPort]).filter(Boolean));
    const rec = r.devices.find((d) => d.class === "recorder" && !d.ports.some((p) => p.dir === "in" && busy.has(p.id)));
    const sw = r.devices.find((d) => d.class === "switcher");
    if (!rec || !sw) return;
    const inP = rec.ports.find((p) => p.dir === "in" && VIDEO.test(p.type));
    const outP = sw.ports.filter((p) => p.dir === "out" && !busy.has(p.id)).find((p) => inP && p.type === inP.type) ?? sw.ports.find((p) => p.dir === "out" && !busy.has(p.id) && VIDEO.test(p.type));
    if (!inP || !outP) return;
    apply(ws, showId, "signal", connect(r, outP.id, inP.id, { label: "PGM", path: "A", format: r.signal.formats.record || r.signal.formats.house }, newId), "walls");
  }
}

// ---------------------------------------------------------------- steps 4 & 5

export function setCrew(ws: Workspace, showId: string, crew: Partial<Crew>, contacts: Omit<Contact, "id">[] = []): void {
  const ops: Patch[] = Object.entries(crew).filter(([, v]) => v !== undefined).map(([k, v]) => ({ op: "replace", path: `/crew/${k}`, value: v }));
  for (const c of contacts) ops.push({ op: "add", path: "/binder/contacts/-", value: { id: newId("con"), ...c } });
  apply(ws, showId, "shell", ops, "crew");
}

/** Adds schedule entries, or the profile template on every show date (existing keys on a date are kept). */
export function setSchedule(ws: Workspace, showId: string, entries: (Omit<ScheduleEntry, "id"> & { id?: string })[] | "template"): void {
  const r = ws.get(showId);
  let list: ScheduleEntry[];
  if (entries === "template") {
    if (!r.event.dates.length) throw new Error("Set at least one show date before applying the schedule template");
    list = r.event.dates.flatMap((d) => scheduleTemplate(r.event.type, d))
      .filter((e) => !r.binder.schedule.some((s) => s.date === e.date && (s.key === e.key || s.item === e.item)));
  } else list = entries.map((e) => ({ ...e, id: e.id ?? newId("sch") }));
  apply(ws, showId, "shell", list.map((e) => ({ op: "add", path: "/binder/schedule/-", value: e })), "schedule");
}

// ---------------------------------------------------------------- step 6 · Review

const ROUTE: Record<string, string> = { led: "led", signal: "signal", rack: "rack", servers: "servers", binder: "binder", store: "advance" };

export interface Review {
  counts: { walls: number; tiles: number; processors: number; cameras: number; servers: number; racks: number; devices: number; cables: number; links: number; tasks: number };
  formats: ShowRecord["signal"]["formats"];
  readiness: ShowRecord["derived"]["readiness"];
  openChecks: Record<string, Check[]>;
  routes: Record<string, string>;
  setup: Record<number, boolean>;
  nextStep: number;
}

/** Writes nothing: reads derived + checks and routes each open item to the module that owns it. */
export function review(r: ShowRecord): Review {
  const open = r.binder.checks.filter((c) => !c.resolved);
  const openChecks: Record<string, Check[]> = {};
  for (const c of open) (openChecks[c.module] ??= []).push(c);
  const routes: Record<string, string> = {};
  for (const m of Object.keys(openChecks)) routes[m] = ROUTE[m] ?? "advance";
  return {
    counts: {
      walls: r.led.walls.length, tiles: r.derived.led?.totals?.tiles ?? r.led.walls.reduce((s, w) => s + w.cols * w.rows, 0),
      processors: r.devices.filter((d) => d.class === "processor").length, cameras: r.devices.filter((d) => d.class === "camera").length,
      servers: r.servers.hosts.length, racks: r.racks.length, devices: r.devices.length, cables: r.cables.length, links: r.signal.links.length,
      tasks: r.tasks.filter((t) => t.status !== "done" && t.status !== "na").length,
    },
    formats: r.signal.formats,
    readiness: r.derived.readiness?.criteria?.length ? r.derived.readiness : readiness(r),
    openChecks, routes, setup: setupCompleted(r), nextStep: firstIncompleteStep(r),
  };
}
