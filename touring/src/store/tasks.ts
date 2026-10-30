// Store-level task evaluation (Task handoff tab): seeded chains, condition evaluation, status derivation,
// "Go to blocker" routes and the TSK-001 Changed-after-handoff check.
import { routeFor } from "./ownership";
import { parsePointer } from "./pointer";
import type {
  CheckDraft, Condition, Derived, IdPrefix, Lane, ModuleId, ShowRecord, ShowStatus, SystemProfile, Task, TaskStatus,
} from "./types";

// ---------------------------------------------------------------- path reading

function isConfirmed(v: unknown): v is { value: unknown; state: string } {
  return !!v && typeof v === "object" && !Array.isArray(v) && "state" in (v as object) && "value" in (v as object);
}

function step(cur: unknown, seg: string): unknown {
  if (cur == null) return undefined;
  if (Array.isArray(cur)) {
    if (/^\d+$/.test(seg)) return cur[Number(seg)];
    return cur.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === seg);
  }
  if (typeof cur === "object") return (cur as Record<string, unknown>)[seg];
  return undefined;
}

/** Splits `/devices?class=camera` into the pointer and an item filter. */
function splitQuery(path: string): { pointer: string; filter?: (x: unknown) => boolean } {
  const q = path.indexOf("?");
  if (q < 0) return { pointer: path };
  const pointer = path.slice(0, q);
  const m = /^([A-Za-z0-9_]+)\s*(=|!=|>=|<=|>|<)\s*(.*)$/.exec(path.slice(q + 1));
  if (!m) return { pointer };
  const [, field, op, raw] = m;
  const filter = (x: unknown) => {
    const v = x && typeof x === "object" ? (x as Record<string, unknown>)[field] : undefined;
    const n = Number(raw);
    switch (op) {
      case "=": return String(v) === raw;
      case "!=": return String(v) !== raw;
      case ">": return Number(v) > n;
      case "<": return Number(v) < n;
      case ">=": return Number(v) >= n;
      default: return Number(v) <= n;
    }
  };
  return { pointer, filter };
}

/** Every value a (possibly wildcarded / filtered) path addresses. `wild` is true when `*` was used. */
export function selectPath(record: unknown, path: string): { values: unknown[]; wild: boolean } {
  const { pointer, filter } = splitQuery(path);
  let cur: unknown[] = [record];
  let wild = false;
  for (const seg of parsePointer(pointer)) {
    if (seg === "*") {
      wild = true;
      cur = cur.flatMap((c) => (Array.isArray(c) ? c : c && typeof c === "object" ? Object.values(c as object) : []));
    } else cur = cur.map((c) => step(c, seg));
  }
  if (filter) cur = cur.map((c) => (Array.isArray(c) ? c.filter(filter) : isConfirmed(c) && Array.isArray(c.value) ? c.value.filter(filter) : c));
  return { values: cur, wild };
}

/** The usable value of a field: Confirmed leaves count only when confirmed or assumed. */
export function usable(v: unknown): unknown {
  if (isConfirmed(v)) return v.state === "confirmed" || v.state === "assumed" ? v.value : null;
  return v;
}

export function isSet(v: unknown): boolean {
  const u = usable(v);
  if (u === null || u === undefined) return false;
  if (typeof u === "string") return u.trim().length > 0;
  if (typeof u === "number") return Number.isFinite(u) && u !== 0;
  if (Array.isArray(u)) return u.length > 0;
  return true;
}

const STATUS_RANK: Record<ShowStatus, number> = { draft: 0, issued: 1, locked: 2, archived: 3 };

/** Evaluates one Condition against the record. */
export function evalCondition(record: ShowRecord, cond: Condition): boolean {
  switch (cond.kind) {
    case "path-set": {
      const { values, wild } = selectPath(record, cond.path);
      return wild ? values.every(isSet) : isSet(values[0]);
    }
    case "path-equals": {
      const { values } = selectPath(record, cond.path);
      return values.length > 0 && values.every((v) => JSON.stringify(usable(v)) === JSON.stringify(cond.value));
    }
    case "count-min": {
      const { values, wild } = selectPath(record, cond.path);
      const count = wild ? values.filter(isSet).length : (() => { const u = usable(values[0]); return Array.isArray(u) ? u.length : isSet(u) ? 1 : 0; })();
      return count >= cond.min;
    }
    case "check-clear":
      return !record.binder.checks.some((c) => !c.resolved && codeMatches(cond.code, c.code, c.severity) && (!cond.target || c.target === cond.target));
    case "status":
      return cond.status === "draft" ? record.meta.status === "draft" : STATUS_RANK[record.meta.status] >= STATUS_RANK[cond.status];
    case "all":
      return cond.of.every((c) => evalCondition(record, c));
  }
}

/** `*` = any open block check; `SIG-*` = prefix; otherwise exact code. */
function codeMatches(pattern: string, code: string, severity: string): boolean {
  if (pattern === "*") return severity === "block";
  if (pattern.endsWith("*")) return code.startsWith(pattern.slice(0, -1));
  return pattern === code;
}

/** Leaf conditions of a (possibly nested) condition. */
function leaves(cond: Condition): Exclude<Condition, { kind: "all" }>[] {
  return cond.kind === "all" ? cond.of.flatMap(leaves) : [cond];
}

/** Record paths a condition reads (check-clear and status conditions read none). */
export function conditionPaths(cond: Condition): string[] {
  return leaves(cond).flatMap((c) => ("path" in c ? [c.path] : []));
}

/** A produces-condition made only of check-clear terms holds vacuously before anything is built. */
function negativeOnly(cond: Condition): boolean {
  return leaves(cond).every((c) => c.kind === "check-clear");
}

const CODE_ROUTE: Record<string, string> = { SIG: "signal", PHY: "signal", LED: "led", SRV: "servers", RCK: "rack", BND: "binder", TSK: "advance", IMP: "advance" };
const LANE_ROUTE: Record<Lane, string> = { advance: "advance", crew: "crew", prep: "advance", led: "led", signal: "signal", servers: "servers", rack: "rack" };

/** "Go to blocker": the view that owns the first record fact a condition waits on. */
export function blockerRoute(cond: Condition): string | undefined {
  const first = leaves(cond)[0];
  if (!first) return undefined;
  if (first.kind === "check-clear") return first.code === "*" ? "binder" : CODE_ROUTE[first.code.slice(0, 3)];
  if (first.kind === "status") return "binder";
  return routeFor(splitQuery(first.path).pointer) ?? undefined;
}

function pathLabel(path: string): string {
  const { pointer } = splitQuery(path);
  const q = path.includes("?") ? ` (${path.slice(path.indexOf("?") + 1)})` : "";
  return parsePointer(pointer).filter((s) => s !== "*").join(".") + q;
}

function conditionLabel(c: Exclude<Condition, { kind: "all" }>): string {
  switch (c.kind) {
    case "path-set": return pathLabel(c.path);
    case "path-equals": return `${pathLabel(c.path)} = ${JSON.stringify(c.value)}`;
    case "count-min": return `${pathLabel(c.path)} ≥ ${c.min}`;
    case "check-clear": return c.code === "*" ? "all block checks clear" : `${c.code} clear${c.target ? ` on ${c.target}` : ""}`;
    case "status": return `show ${c.status}`;
  }
}

// ---------------------------------------------------------------- seeding

interface Seed {
  key: string; lane: Lane; title: string; owner: string;
  produces?: Condition; consumes?: Condition[]; after: string[]; due: number | null; about?: string[];
}

const set = (path: string): Condition => ({ kind: "path-set", path });
const clear = (code: string): Condition => ({ kind: "check-clear", code });
const all = (...of: Condition[]): Condition => (of.length === 1 ? of[0] : { kind: "all", of });

/**
 * The seeded handoff chain (A1–A6, C1–C5, L1–L3, S1–S6, V1–V2, R1–R2, P1) with profile variations.
 * `blockedBy` is resolved to task ids; due dates hang off the load-in schedule entry (`dueFrom`).
 */
export function seedTasks(record: ShowRecord, profile: SystemProfile, newId: (prefix: IdPrefix) => string): Task[] {
  const walls = record.led.walls.map((w) => w.id);
  const hosts = record.servers.hosts.map((h) => h.id);
  const racks = record.racks.map((k) => k.id);
  const fly = profile.type === "fly-date";
  const rehearsal = profile.type === "rehearsal";
  const hasWalls = !fly && (profile.walls.length > 0 || walls.length > 0);

  const seeds: Seed[] = [
    { key: "A1", lane: "advance", title: "Confirm show date and venue", owner: "pm", produces: all(set("/event/dates/0"), set("/event/venueName")), after: [], due: null },
    { key: "A2", lane: "advance", title: "Confirm vendor order ref", owner: "pm", produces: set("/vendor/orderRef"), after: [], due: -21 },
    { key: "A3", lane: "advance", title: "Get venue power service (amps, phase, location)", owner: "eic", produces: set("/event/power/amps"), after: ["A1"], due: -14 },
    { key: "A4", lane: "advance", title: "Get rigging plot and trim limits", owner: "ledLead", produces: set("/event/rigging/maxTrim_ft"), after: ["A1"], due: -14 },
    { key: "A5", lane: "advance", title: "Confirm house LED / IMAG", owner: "videoDirector", produces: set("/event/houseVideo"), after: ["A1"], due: -14 },
    { key: "A6", lane: "advance", title: "Issue advance Rev 1", owner: "videoDirector", produces: { kind: "status", status: "issued" }, consumes: [clear("*")], after: [], due: -7 },
    { key: "C1", lane: "crew", title: "Name Crew Chief and EIC", owner: "pm", produces: all(set("/crew/crewChief"), set("/crew/eic")), after: [], due: -21, about: ["crewChief", "eic"] },
    { key: "C2", lane: "crew", title: "Name LED Lead, Camera Lead, Server Op", owner: "crewChief", produces: all(set("/crew/ledLead"), set("/crew/cameraLead"), set("/crew/serverOp")), after: ["C1"], due: -14, about: ["ledLead", "cameraLead", "serverOp"] },
    { key: "C3", lane: "crew", title: "Confirm call times", owner: "crewChief", produces: { kind: "count-min", path: "/binder/schedule", min: 2 }, after: ["A1"], due: -10 },
    { key: "C4", lane: "crew", title: "Book local labor count", owner: "crewChief", produces: set("/crew/localLabor"), after: ["A3", "L1"], due: -7, about: ["localLabor"] },
    { key: "C5", lane: "crew", title: "Issue crew sheet", owner: "crewChief", after: ["C2", "C3", "C4"], due: -5 },
    { key: "L1", lane: "led", title: "Size every wall", owner: "ledLead", produces: all({ kind: "count-min", path: "/led/walls", min: 1 }, set("/led/walls/*/cols"), set("/led/walls/*/rows"), clear("LED-006")), after: ["A4"], due: -14, about: walls },
    { key: "L2", lane: "led", title: "Assign processors and split data runs", owner: "ledLead", produces: clear("LED-001"), after: ["L1"], due: -10, about: walls },
    { key: "L3", lane: "led", title: "Assign distro and circuits", owner: "eic", produces: all(clear("LED-002"), clear("LED-003")), after: ["A3", "L1"], due: -10, about: walls },
    { key: "S1", lane: "signal", title: "Set house and LED input formats", owner: "eic", produces: set("/signal/formats/house"), after: [], due: null },
    { key: "S2", lane: "signal", title: "Patch program path A to every processor", owner: "eic", produces: clear("SIG-006"), after: ["L2", "V1"], due: -10 },
    { key: "S3", lane: "signal", title: "Patch path B and define redundancy groups", owner: "eic", produces: clear("SIG-009"), after: ["S2"], due: -7 },
    { key: "S4", lane: "signal", title: "Confirm camera and CCU count, fibre plan", owner: "cameraLead", produces: { kind: "count-min", path: "/devices?class=camera", min: profile.cameras }, after: ["C2"], due: -10 },
    { key: "S5", lane: "signal", title: "Clear single points of failure or accept risk", owner: "eic", produces: clear("SIG-008"), after: ["S3"], due: -5 },
    { key: "S6", lane: "signal", title: "Confirm truck handoff formats", owner: "eic", produces: set("/signal/formats/truck"), after: [], due: -10 },
    { key: "V1", lane: "servers", title: "Set server outputs to wall canvas", owner: "serverOp", produces: all(clear("SRV-001"), clear("SRV-002")), after: ["L1"], due: -10, about: hosts },
    { key: "V2", lane: "servers", title: "Pair failover", owner: "serverOp", produces: clear("SRV-003"), after: ["V1"], due: -7, about: hosts },
    { key: "R1", lane: "rack", title: "Place every device, no RU conflicts", owner: "eic", produces: all(clear("RCK-001"), clear("RCK-002"), clear("RCK-004")), after: ["L2", "S2", "V1"], due: -7, about: racks },
    { key: "R2", lane: "rack", title: "PDU and inlet per rack", owner: "eic", produces: all(clear("RCK-003"), clear("RCK-005")), after: ["R1"], due: -7, about: racks },
    { key: "P1", lane: "prep", title: "Review pull sheet against record", owner: "crewChief", after: ["A2", "R1"], due: -5 },
  ];

  const drop = new Set<string>();
  if (fly) ["A4", "L1", "L2", "L3"].forEach((k) => drop.add(k)); else drop.add("A5");
  if (!hasWalls) ["L1", "L2", "L3"].forEach((k) => drop.add(k));
  if (rehearsal) ["C4", "C5", "S4", "V2", "P1"].forEach((k) => drop.add(k));
  if (profile.type !== "broadcast") drop.add("S6");
  if (profile.cameras <= 0) drop.add("S4");
  if (profile.servers === 0) { drop.add("V1"); drop.add("V2"); }
  if (profile.servers === 1) drop.add("V2");

  const kept = seeds.filter((s) => !drop.has(s.key));
  const ids = new Map(kept.map((s) => [s.key, newId("task")]));
  const loadIn = record.binder.schedule.find((s) => s.key === "load-in" || /load-in/i.test(s.item));
  const at = record.meta.updatedAt || new Date().toISOString();

  return kept.map((s) => {
    const t: Task = {
      id: ids.get(s.key)!, key: s.key, lane: s.lane, title: s.title, status: "todo", owner: s.owner,
      about: s.about ?? [], blockedBy: s.after.filter((k) => ids.has(k)).map((k) => ids.get(k)!),
      source: "setup", history: [{ at, by: "store", from: "todo", to: "todo", note: "seeded at setup" }],
    };
    if (s.produces) t.produces = s.produces;
    if (s.consumes) t.consumes = s.consumes;
    // Offsets are from the load-in entry; until one exists the key resolves it later.
    if (s.due !== null) t.dueFrom = { scheduleId: loadIn?.id ?? "load-in", offsetDays: s.due };
    return t;
  });
}

// ---------------------------------------------------------------- derivation

type Blocker = Derived["tasks"][string]["blockers"][number];

function addDays(date: string, days: number): string | undefined {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolveDue(record: ShowRecord, t: Task): string | undefined {
  if (t.dueFrom) {
    const id = t.dueFrom.scheduleId;
    const e = record.binder.schedule.find((s) => s.id === id) ??
      record.binder.schedule.find((s) => s.key === id || (id === "load-in" && /load-in/i.test(s.item)));
    if (e?.date) return addDays(e.date, t.dueFrom.offsetDays);
  }
  return t.due;
}

function waivedLeaf(record: ShowRecord, cond: Condition | undefined): string | null {
  if (!cond) return null;
  for (const p of conditionPaths(cond)) {
    if (!p.startsWith("/event/")) continue;
    const { values } = selectPath(record, p);
    if (values.some((v) => isConfirmed(v) && v.state === "waived")) return p;
  }
  return null;
}

const ROLE_KEYS = new Set(["videoDirector", "crewChief", "eic", "ledLead", "cameraLead", "serverOp", "pm", "localLabor"]);

/** Comparable snapshot of a field (Confirmed leaves compare by value only). */
function snapshot(record: ShowRecord, path: string): string {
  const { values } = selectPath(record, path);
  return JSON.stringify(values.map((v) => (isConfirmed(v) ? v.value : v)));
}

function walkLeaves(obj: unknown, base: string, cb: (path: string, leaf: { value: unknown; state: string }) => void) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isConfirmed(v)) cb(`${base}/${k}`, v);
    else walkLeaves(v, `${base}/${k}`, cb);
  }
}

/** Engine.deriveTasks — status derivation in the order the Task handoff tab specifies. */
export function deriveTasks(record: ShowRecord, prev: ShowRecord | null, at: string): {
  tasks: Task[]; derived: Derived["tasks"]; checks: (CheckDraft & { module?: ModuleId | "store" })[];
} {
  const tasks = record.tasks.map((t) => ({ ...t, history: [...t.history] }));
  const base = new Map(tasks.map((t) => [t.id, t.status]));
  const cur = new Map(base);
  const notes = new Map<string, string>();
  const blockersOf = new Map<string, Blocker[]>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const by = record.meta.updatedBy ?? "store";
  const draft = record.meta.status === "draft";
  const issuingNow = !!prev && prev.meta.status === "draft" && record.meta.status !== "draft";

  const computeBlockers = (t: Task): Blocker[] => {
    const out: Blocker[] = [];
    for (const id of t.blockedBy) {
      const s = cur.get(id);
      if (s === "done" || s === "na") continue;
      const u = byId.get(id);
      out.push({ kind: "task", label: `waiting on ${u ? `${u.key ? u.key + " · " : ""}${u.title}` : id}`, route: u ? LANE_ROUTE[u.lane] : undefined });
    }
    for (const c of t.consumes ?? []) {
      for (const leaf of leaves(c)) {
        if (evalCondition(record, leaf)) continue;
        out.push({ kind: leaf.kind === "check-clear" ? "check" : leaf.kind === "status" ? "status" : "field", label: `waiting on ${conditionLabel(leaf)}`, route: blockerRoute(leaf) });
      }
    }
    return out;
  };

  const decide = (t: Task): { status: TaskStatus; note?: string } => {
    const s0 = base.get(t.id)!;
    const blockers = computeBlockers(t);
    blockersOf.set(t.id, blockers);
    if (t.source === "check") {
      // Opened / closed by the store from its check; only blocker derivation happens here.
      if (s0 === "done" || s0 === "na") return { status: s0 };
      if (blockers.length) return { status: "blocked" };
      return { status: s0 === "blocked" ? "todo" : s0 };
    }
    if (s0 === "na") return { status: "na" };
    const waived = waivedLeaf(record, t.produces) ?? (t.consumes ?? []).map((c) => waivedLeaf(record, c)).find(Boolean) ?? null;
    if (waived) return { status: "na", note: `field waived: ${pathLabel(waived)}` };
    if (s0 === "done" && t.userDone && !t.produces) return { status: "done" };
    if (t.produces) {
      const holds = evalCondition(record, t.produces);
      // A purely negative condition (no open check) only closes a task once its inputs are in;
      // once closed it stays closed while it holds — nothing downstream is auto-changed.
      if (holds && (!negativeOnly(t.produces) || blockers.length === 0 || s0 === "done")) {
        return { status: "done", note: s0 === "done" ? undefined : `auto: ${leaves(t.produces).map(conditionLabel).join(" and ")} (by ${by})` };
      }
      if (s0 === "done") {
        const what = conditionPaths(t.produces).map(pathLabel).join(", ") || leaves(t.produces).map(conditionLabel).join(", ");
        if (t.userDone) {
          if (issuingNow) return { status: "doing", note: `reopened at issue: ${what} not met` };
          return { status: "done" };
        }
        if (draft) return { status: "doing", note: `reopened: ${what} changed by ${by}` };
        return { status: "done" };
      }
    }
    if (s0 === "done") return { status: "done" };
    if (blockers.length) return { status: "blocked" };
    return { status: s0 === "blocked" ? "todo" : s0 };
  };

  // Fixed point: a task closing in this pass can unblock its dependants in the same patch cycle.
  for (let pass = 0; pass <= tasks.length; pass++) {
    let changed = false;
    for (const t of tasks) {
      const d = decide(t);
      if (cur.get(t.id) !== d.status) { cur.set(t.id, d.status); changed = true; }
      if (d.note) notes.set(t.id, d.note); else notes.delete(t.id);
    }
    if (!changed) break;
  }

  const derived: Derived["tasks"] = {};
  for (const t of tasks) {
    const s = cur.get(t.id)!;
    if (s !== t.status) {
      t.history.push({ at, by: t.source === "check" ? "store" : by, from: t.status, to: s, note: notes.get(t.id) });
      t.status = s;
      if (s !== "done") t.userDone = false;
    }
    // Owner follows the role: the task moves with whoever holds it.
    if (prev && t.owner && ROLE_KEYS.has(t.owner)) {
      const was = (prev.crew as unknown as Record<string, string | undefined>)[t.owner] ?? "";
      const now = (record.crew as unknown as Record<string, string | undefined>)[t.owner] ?? "";
      if (was !== now) t.history.push({ at, by: "store", from: t.status, to: t.status, note: `owner ${t.owner}: ${was || "—"} → ${now || "—"}` });
    }
    derived[t.id] = { status: t.status, blockers: t.status === "blocked" ? blockersOf.get(t.id) ?? [] : [], dueResolved: resolveDue(record, t) };
  }

  return { tasks, derived, checks: prev ? changedAfterHandoff(prev, record, tasks) : [] };
}

/** TSK-001: a field whose producing task was already done (or a confirmed advance leaf) changed. */
function changedAfterHandoff(prev: ShowRecord, record: ShowRecord, tasks: Task[]): (CheckDraft & { module?: ModuleId | "store" })[] {
  const fired = new Map<string, { producer?: Task }>();
  for (const t of prev.tasks) {
    if (t.status !== "done" || !t.produces) continue;
    for (const leaf of leaves(t.produces)) {
      if (!("path" in leaf)) continue;
      const was = selectPath(prev, leaf.path).values;
      if (!was.some(isSet)) continue;
      if (snapshot(prev, leaf.path) !== snapshot(record, leaf.path)) fired.set(leaf.path, { producer: t });
    }
  }
  walkLeaves(prev.event, "/event", (path, leaf) => {
    if (leaf.state !== "confirmed" || fired.has(path)) return;
    if (snapshot(prev, path) !== snapshot(record, path)) fired.set(path, {});
  });

  const out: (CheckDraft & { module?: ModuleId | "store" })[] = [];
  for (const [path, { producer }] of fired) {
    const downstream = tasks.filter((t) =>
      (t.consumes ?? []).some((c) => conditionPaths(c).some((p) => p === path || p.startsWith(path + "/") || path.startsWith(p + "/"))) ||
      (producer && t.blockedBy.includes(producer.id)));
    const names = downstream.map((t) => (t.key ? `${t.key} ${t.title}` : t.title));
    const label = pathLabel(path);
    out.push({
      code: "TSK-001", severity: "info", module: "store", title: "Changed after handoff", target: path,
      message: `${label} changed after ${producer ? `${producer.key ?? producer.title} was done` : "it was confirmed"}${names.length ? `; check ${names.join(", ")}` : ""}.`,
      rule: `A field whose producing task is done (or that the venue confirmed) should not change silently; was ${snapshot(prev, path)}, now ${snapshot(record, path)}.`,
      involved: [path, ...(producer ? [producer.id] : []), ...downstream.map((t) => t.id)],
      evidence: [
        { label: "Now", value: snapshot(record, path), path },
        { label: "Before", value: snapshot(prev, path), path },
        ...(producer ? [{ label: "Producing task", value: `${producer.key ?? ""} ${producer.title}`.trim(), path: `/tasks/${producer.id}` }] : []),
      ],
      fixes: [{ label: "Review the downstream tasks and re-send anything already issued", module: "shell" }],
    });
  }
  return out;
}
