// Physical layer (Cable & panels tab): positions and paths seeded from the advance, default segments
// and stock rounding, labels, the setup trunk plan, byPath / inventory rollups and PHY- checks.
import { addAt, removeAt, replaceAt } from "../../store/pointer";
import type {
  Cable, CableType, CheckDraft, Confirmed, Derived, Device, IdPrefix, Jack, Patch, PhysPath, Position, PortType, Segment, ShowRecord,
} from "../../store/types";
import { buildGraph, type Graph, type Resolved, resolveFormats, specResolver, type SpecOf } from "./graph";
import { CABLE_LABEL_PREFIX, describeFormat, labelColour, reachFt, roundStock, stockList } from "./portRules";

type NewId = (prefix: IdPrefix) => string;

export const POS = {
  stageUS: "pos_stage_us", stageSL: "pos_stage_sl", stageSR: "pos_stage_sr", videoWorld: "pos_video_world",
  foh: "pos_foh", dimmer: "pos_dimmer_beach", village: "pos_video_village", truck: "pos_truck",
} as const;

const POS_CODE: Record<string, string> = {
  [POS.stageUS]: "US", [POS.stageSL]: "SL", [POS.stageSR]: "SR", [POS.videoWorld]: "VW", [POS.foh]: "FOH",
  [POS.dimmer]: "DB", [POS.village]: "VV", [POS.truck]: "TRK",
};
export function positionCode(posId: string | null | undefined): string {
  if (!posId) return "X";
  if (POS_CODE[posId]) return POS_CODE[posId];
  if (posId.startsWith("pos_cam_")) return "CAM";
  if (posId.startsWith("pos_house_feed_")) return "HF";
  return posId.replace(/^pos_/, "").toUpperCase().slice(0, 4);
}

const slugId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Local, pure patch application (planning on a draft; the store re-applies for real). */
export function applyLocal(record: ShowRecord, patches: Patch[]): ShowRecord {
  const r = structuredClone(record) as ShowRecord;
  for (const p of patches) {
    if (p.op === "add") addAt(r, p.path, structuredClone(p.value));
    else if (p.op === "replace") replaceAt(r, p.path, structuredClone(p.value));
    else if (p.op === "remove") removeAt(r, p.path);
    else { const v = removeAt(r, p.from); if (v !== undefined) addAt(r, p.path, v); }
  }
  return r;
}

// ---------------- seeding positions and paths ----------------
function mirror<T>(src: Confirmed<T> | undefined, pick: (v: T) => number | null | undefined): Confirmed<number> {
  const v = src?.value != null ? pick(src.value) : null;
  if (v == null || !Number.isFinite(v)) return { value: null, state: src?.state === "waived" ? "waived" : "unknown" };
  const out: Confirmed<number> = { value: Number(v), state: src!.state };
  if (src!.by) out.by = src!.by;
  if (src!.at) out.at = src!.at;
  if (src!.source) out.source = src!.source;
  return out;
}

interface PathSeed { id: string; from: string; to: string; length_ft: Confirmed<number>; route: PhysPath["route"]; protection?: string }

/**
 * Seeds /physical positions and paths from event.* (the signal module is the writer). Idempotent: adds what
 * is missing and re-mirrors a path's length when its advance field changed.
 */
export function seedPhysical(record: ShowRecord, newId: NewId): Patch[] {
  const ev = record.event;
  const positions: Position[] = [
    { id: POS.stageUS, label: "Stage · upstage", kind: "stage", x_ft: 0, y_ft: 0, sourcePath: "/event/access/stageDims" },
    { id: POS.stageSL, label: "Stage left", kind: "stage", x_ft: -30, y_ft: 15, sourcePath: "/event/access/stageDims" },
    { id: POS.stageSR, label: "Stage right", kind: "stage", x_ft: 30, y_ft: 15, sourcePath: "/event/access/stageDims" },
    { id: POS.videoWorld, label: ev.access.videoWorld?.value?.location || "Video world", kind: "video-world", x_ft: -60, y_ft: 30, sourcePath: "/event/access/videoWorld" },
    { id: POS.foh, label: ev.foh?.value?.location || "FOH", kind: "foh", x_ft: 0, y_ft: 120, sourcePath: "/event/foh" },
    { id: POS.dimmer, label: ev.power.services?.value?.[0]?.location || "Dimmer beach", kind: "power", x_ft: -60, y_ft: 0, sourcePath: "/event/power/services" },
  ];
  const svc = ev.power.services;
  const vw = ev.access.videoWorld;
  const dims = ev.access.stageDims;
  const s2f = ev.signalPath.stageToFOH;
  const paths: PathSeed[] = [
    { id: "path_vw_stage_sl", from: POS.videoWorld, to: POS.stageSL, length_ft: mirror(vw, (v) => v.toStage_ft), route: "floor" },
    { id: "path_stage_sl_us", from: POS.stageSL, to: POS.stageUS, length_ft: mirror(dims, (v) => (v.width_ft ? v.width_ft / 2 : null)), route: "floor" },
    { id: "path_stage_sl_sr", from: POS.stageSL, to: POS.stageSR, length_ft: mirror(dims, (v) => v.width_ft), route: "floor" },
    { id: "path_vw_foh", from: POS.videoWorld, to: POS.foh, length_ft: mirror(vw, (v) => v.toFOH_ft), route: "floor" },
    s2f?.value
      ? { id: "path_stage_sl_foh", from: POS.stageSL, to: POS.foh, length_ft: mirror(s2f, (v) => v.length_ft), route: s2f.value.route, protection: s2f.value.protection }
      : { id: "path_stage_sl_foh", from: POS.stageSL, to: POS.foh, length_ft: mirror(ev.foh, (v) => v.toStage_ft), route: "floor" },
    { id: "path_vw_dimmer", from: POS.videoWorld, to: POS.dimmer,
      length_ft: vw?.value?.toDistro_ft != null ? mirror(vw, (v) => v.toDistro_ft) : mirror(svc, (v) => v[0]?.toVideoWorld_ft), route: "floor" },
  ];
  if (svc?.value?.[0]?.toUpstage_ft != null) paths.push({ id: "path_dimmer_stage_us", from: POS.dimmer, to: POS.stageUS, length_ft: mirror(svc, (v) => v[0]?.toUpstage_ft), route: "floor" });

  const village = ev.signalPath.videoVillage;
  if (village?.value?.location) {
    positions.push({ id: POS.village, label: village.value.location, kind: "village", x_ft: -80, y_ft: 50, sourcePath: "/event/signalPath/videoVillage" });
    paths.push({ id: "path_vw_village", from: POS.videoWorld, to: POS.village, length_ft: mirror(village, (v) => v.toVideoWorld_ft), route: "floor" });
  }
  const cams = ev.cameras.positions;
  (cams?.value ?? []).forEach((c, i) => {
    const key = slugId((c.id || "").replace(/^cam_/, "")) || slugId(newId("cam").replace(/^cam_/, ""));
    const id = `pos_cam_${key}`;
    positions.push({ id, label: c.label || `Camera ${i + 1}`, kind: "camera", x_ft: -40 + i * 20, y_ft: 90, sourcePath: `/event/cameras/positions` });
    paths.push({ id: `path_vw_cam_${key}`, from: POS.videoWorld, to: id, length_ft: mirror(cams, () => c.toVideoWorld_ft), route: "floor" });
  });
  const feeds = ev.signalPath.houseFeeds;
  const fibre = ev.signalPath.houseFibre?.value?.available;
  let n = 0;
  for (const f of feeds?.value ?? []) {
    const truck = /truck|broadcast/i.test(`${f.destination} ${f.location}`);
    const id = truck ? POS.truck : `pos_house_feed_${++n}`;
    if (positions.some((p) => p.id === id)) continue;
    positions.push({ id, label: truck ? f.location || "Broadcast truck" : f.destination || `House feed ${n}`, kind: "external", x_ft: -100, y_ft: 10 * n, sourcePath: "/event/signalPath/houseFeeds" });
    paths.push({ id: `path_vw_${id.replace(/^pos_/, "")}`, from: POS.videoWorld, to: id, length_ft: { value: null, state: "unknown" }, route: fibre ? "house-fibre" : "floor" });
  }

  const ops: Patch[] = [];
  const havePos = new Set(record.physical.positions.map((p) => p.id));
  for (const p of positions) if (!havePos.has(p.id)) ops.push({ op: "add", path: "/physical/positions/-", value: p });
  const havePath = new Map(record.physical.paths.map((p) => [p.id, p]));
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const havePair = new Set(record.physical.paths.map((p) => pairKey(p.from, p.to)));
  for (const p of paths) {
    const cur = havePath.get(p.id);
    if (!cur) {
      if (havePair.has(pairKey(p.from, p.to))) continue; // user drew their own path between the pair
      const value: PhysPath = { id: p.id, from: p.from, to: p.to, length_ft: p.length_ft, route: p.route, viaPanels: [] };
      if (p.protection) value.protection = p.protection;
      ops.push({ op: "add", path: "/physical/paths/-", value });
    } else if (JSON.stringify(cur.length_ft) !== JSON.stringify(p.length_ft) && (p.length_ft.value != null || cur.length_ft.value == null)) {
      ops.push({ op: "replace", path: `/physical/paths/${p.id}/length_ft`, value: p.length_ft });
    }
  }
  return ops;
}

// ---------------- positions of devices, shortest chains ----------------
const LOCATION_POS: [RegExp, string][] = [
  [/video\s*world|\bvw\b/i, POS.videoWorld], [/dimmer|beach/i, POS.dimmer], [/stage\s*left|\bsl\b/i, POS.stageSL],
  [/stage\s*right|\bsr\b/i, POS.stageSR], [/up\s*stage|\bus\b/i, POS.stageUS], [/foh|front of house/i, POS.foh], [/village/i, POS.village],
];

/** A device's position: its own positionId, then its rack's, then the rack's free-text location. */
export function positionOf(record: ShowRecord, d: Device | undefined): string | null {
  if (!d) return null;
  if (d.positionId) return d.positionId;
  const rack = d.rackId ? record.racks.find((k) => k.id === d.rackId) : undefined;
  if (rack?.positionId) return rack.positionId;
  if (rack?.location) {
    const hit = LOCATION_POS.find(([re]) => re.test(rack.location));
    if (hit && record.physical.positions.some((p) => p.id === hit[1])) return hit[1];
  }
  return null;
}

const UNKNOWN_PATH_WEIGHT = 100;
export const pathLen = (p: PhysPath) => (p.length_ft?.value ?? null);

/** Shortest chain of path ids between two positions (Dijkstra; unmeasured paths weigh 100 ft). */
export function shortestPathChain(record: ShowRecord, fromPos: string, toPos: string): string[] | null {
  if (fromPos === toPos) return [];
  const dist = new Map<string, number>([[fromPos, 0]]);
  const prev = new Map<string, { node: string; path: string }>();
  const done = new Set<string>();
  const adj = new Map<string, { to: string; path: PhysPath }[]>();
  for (const p of record.physical.paths) {
    adj.set(p.from, [...(adj.get(p.from) ?? []), { to: p.to, path: p }]);
    adj.set(p.to, [...(adj.get(p.to) ?? []), { to: p.from, path: p }]);
  }
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; cur = k; }
    if (cur === null) return null;
    if (cur === toPos) break;
    done.add(cur);
    for (const { to, path } of adj.get(cur) ?? []) {
      const w = pathLen(path) ?? UNKNOWN_PATH_WEIGHT;
      const nd = best + w;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, { node: cur, path: path.id }); }
    }
  }
  const chain: string[] = [];
  let at = toPos;
  while (at !== fromPos) { const p = prev.get(at)!; chain.unshift(p.path); at = p.node; }
  return chain;
}

// ---------------- labels ----------------
const STD_LABEL = /^([A-Z]{2,4})-(\d{3})/;

/** `<TYPE>-<nnn>` per cable (kept when the stored label already follows the pattern), with -A / -B for redundant pairs. */
export function cableLabels(record: ShowRecord): Map<string, string> {
  const used = new Map<string, Set<number>>();
  for (const c of record.cables) {
    const m = STD_LABEL.exec(c.label ?? "");
    if (m) used.set(m[1], (used.get(m[1]) ?? new Set()).add(Number(m[2])));
  }
  const inGroup = new Set(record.signal.redundancy.flatMap((g) => [...g.primary, ...g.backup]));
  const linkOf = new Map(record.signal.links.map((l) => [l.cableId, l]));
  const out = new Map<string, string>();
  for (const c of record.cables) {
    const m = STD_LABEL.exec(c.label ?? "");
    let base: string;
    if (m) base = c.label.replace(/-[AB]$/, "");
    else {
      const pfx = CABLE_LABEL_PREFIX[c.type] ?? "CAB";
      const set = used.get(pfx) ?? new Set<number>();
      let n = 1;
      while (set.has(n)) n++;
      set.add(n);
      used.set(pfx, set);
      base = `${pfx}-${String(n).padStart(3, "0")}`;
    }
    const l = linkOf.get(c.id);
    const ab = c.redundancyGroup ?? (l && inGroup.has(l.id) ? l.path : null);
    out.set(c.id, ab ? `${base}-${ab}` : base);
  }
  return out;
}

/** Next unused `<PREFIX>-<nnn>` for a new cable of `type`. */
export function nextCableLabel(record: ShowRecord, type: CableType, extraUsed: string[] = []): string {
  const pfx = CABLE_LABEL_PREFIX[type] ?? "CAB";
  let max = 0;
  for (const l of [...record.cables.map((c) => c.label ?? ""), ...extraUsed]) {
    const m = STD_LABEL.exec(l);
    if (m && m[1] === pfx) max = Math.max(max, Number(m[2]));
  }
  return `${pfx}-${String(max + 1).padStart(3, "0")}`;
}

export const PANEL_KIND_CODE: Record<string, string> = { "stage-box": "SB", "fibre-breakout": "FO", bulkhead: "SM", "rack-panel": "PP", "wall-plate": "WP" };

/** `<POSITION>-<KIND>-<n>` for a new panel. */
export function nextPanelLabel(record: ShowRecord, posId: string, panelKind: string, jackTypes: PortType[] = [], extraUsed: string[] = []): string {
  let kind = PANEL_KIND_CODE[panelKind] ?? "PP";
  if (panelKind === "rack-panel" && jackTypes.length && jackTypes.every((t) => t === "cat6")) kind = "NW";
  if (panelKind === "bulkhead" && jackTypes.length && !jackTypes.includes("fiber-SMPTE")) kind = "PP";
  const pfx = `${positionCode(posId)}-${kind}`;
  const used = new Set([...record.devices.map((d) => d.label.toLowerCase()), ...extraUsed.map((l) => l.toLowerCase())]);
  for (let i = 1; ; i++) if (!used.has(`${pfx}-${i}`.toLowerCase())) return `${pfx}-${i}`;
}

export const jackLabel = (panel: Device, jack: Jack) => `${panel.label}:${String(jack.number).padStart(2, "0")}`;

export function jacksOf(d: Device, specOf?: SpecOf): Jack[] {
  const j = (d.spec?.jacks ?? (specOf ? specOf(d).jacks : undefined)) as unknown;
  return Array.isArray(j) ? (j as Jack[]).filter((x) => x && typeof x === "object" && "id" in x) : [];
}

export function jackIndex(record: ShowRecord): Map<string, { panel: Device; jack: Jack }> {
  const m = new Map<string, { panel: Device; jack: Jack }>();
  for (const d of record.devices) for (const j of jacksOf(d)) m.set(j.id, { panel: d, jack: j });
  return m;
}

// ---------------- segment derivation ----------------
export interface CableBuild {
  cableId: string;
  type: CableType;
  label: string;
  segments: Segment[];
  /** Σ segments stock — the Physical-layer total. */
  total_ft: number;
  pathChain: string[];
  fromPos: string | null;
  toPos: string | null;
  derivedDefault: boolean;
  overStock: { segmentLabel: string; derived: number; longest: number }[];
  unmeasuredPaths: string[];
  approximate: boolean;
}

const RUN_ALLOWANCE = 1.15;
const RUN_DROPS = 10;

function runLength(record: ShowRecord, chain: string[]): { len: number | null; unmeasured: string[]; approximate: boolean } {
  let sum = 0;
  const unmeasured: string[] = [];
  let approx = false;
  const steel = record.event.rigging.steelHeight_ft;
  for (const id of chain) {
    const p = record.physical.paths.find((x) => x.id === id);
    const v = p ? pathLen(p) : null;
    if (!p || v == null) { unmeasured.push(id); continue; }
    if (p.length_ft.state !== "confirmed") approx = true;
    sum += v;
    if (p.route === "overhead" && steel?.state === "confirmed" && steel.value) sum += 2 * steel.value;
  }
  if (unmeasured.length) return { len: null, unmeasured, approximate: true };
  return { len: sum * RUN_ALLOWANCE + RUN_DROPS, unmeasured, approximate: approx };
}

/** Jumper inside one position: 10 in a rack, 25 rack↔rack or rack↔panel, 50 to a floor device. */
export function jumperLength(a: Device | undefined, b: Device | undefined): number {
  if (a?.rackId && b?.rackId && a.rackId === b.rackId) return 10;
  const racked = (d?: Device) => !!d?.rackId || d?.class === "patchPanel" && (d.spec?.panelKind === "rack-panel" || d.spec?.panelKind === "fibre-breakout");
  if (racked(a) && racked(b)) return 25;
  return 50;
}

function seg(id: string, kind: Segment["kind"], from: Segment["from"], to: Segment["to"], derived: number, stock: number, label: string, pathId?: string): Segment {
  const s: Segment = { id, kind, from, to, length_ft: { derived: Math.round(derived * 10) / 10, stock }, label };
  if (pathId) s.pathId = pathId;
  return s;
}

/**
 * Default segments per cable: one segment when the cable has none (a run along the shortest path chain, or a
 * jumper inside one position, or the planned length when positions are unknown); stored segments keep their
 * shape and get derived / stock lengths recomputed unless pinned. Over-stock runs split into runs + coupler.
 */
export function deriveSegments(record: ShowRecord): Map<string, CableBuild> {
  const portDev = new Map<string, Device>();
  for (const d of record.devices) for (const p of d.ports ?? []) portDev.set(p.id, d);
  const labels = cableLabels(record);
  const overlay = record.physical.stock;
  const out = new Map<string, CableBuild>();
  const cableById = new Map(record.cables.map((c) => [c.id, c]));
  for (const c of record.cables) {
    const label = labels.get(c.id) ?? c.label;
    const fromDev = c.fromPort ? portDev.get(c.fromPort) : undefined;
    const toDev = c.toPort ? portDev.get(c.toPort) : undefined;
    const fromPos = positionOf(record, fromDev);
    const toPos = positionOf(record, toDev);
    const build: CableBuild = { cableId: c.id, type: c.type, label, segments: [], total_ft: 0, pathChain: [], fromPos, toPos, derivedDefault: false, overStock: [], unmeasuredPaths: [], approximate: false };

    if (c.segments?.length) {
      build.segments = c.segments.map((s0) => {
        const s = structuredClone(s0) as Segment;
        if (s.kind === "trunk-strand") {
          const trunk = s.reelRef ? cableById.get(s.reelRef.split("/")[0]) : undefined;
          const len = trunk?.length_ft ?? s.length_ft.stock;
          s.length_ft = { ...s.length_ft, derived: len, stock: len };
          if (trunk?.pathChain?.length && !s.pathId) s.pathId = trunk.pathChain[0];
          return s;
        }
        if (s.kind === "run" && s.pathId) {
          const r = runLength(record, [s.pathId]);
          if (r.len != null) s.length_ft = { ...s.length_ft, derived: Math.round(r.len * 10) / 10 };
          else build.unmeasuredPaths.push(...r.unmeasured);
          if (r.approximate) build.approximate = true;
        }
        const basis = s.length_ft.pinned ?? s.length_ft.derived;
        const st = roundStock(c.type, basis, overlay);
        if (st.over) build.overStock.push({ segmentLabel: s.label, derived: basis, longest: st.longest! });
        s.length_ft = { ...s.length_ft, stock: st.stock };
        return s;
      });
      build.pathChain = c.pathChain?.length ? [...c.pathChain] : [...new Set(build.segments.map((s) => s.pathId).filter((x): x is string => !!x))];
    } else {
      build.derivedDefault = true;
      let chain: string[] | null = c.pathChain?.length ? [...c.pathChain] : null;
      if (!chain && fromPos && toPos) chain = shortestPathChain(record, fromPos, toPos);
      const from: Segment["from"] = c.fromPort ? { port: c.fromPort } : { port: "" };
      const to: Segment["to"] = c.toPort ? { port: c.toPort } : { port: "" };
      let derived: number;
      let kind: Segment["kind"] = "run";
      if (chain && chain.length) {
        const r = runLength(record, chain);
        build.pathChain = chain;
        build.unmeasuredPaths = r.unmeasured;
        build.approximate = r.approximate;
        derived = r.len ?? c.length_ft;
      } else if (fromPos && toPos && fromPos === toPos) {
        kind = "jumper";
        derived = jumperLength(fromDev, toDev);
      } else {
        derived = c.length_ft || 0;
        kind = fromDev && toDev && fromDev.rackId && fromDev.rackId === toDev.rackId ? "jumper" : "run";
      }
      const pathId = build.pathChain.length === 1 ? build.pathChain[0] : build.pathChain.length ? longestPath(record, build.pathChain) : undefined;
      const st = roundStock(c.type, derived, overlay);
      if (!st.over) {
        build.segments = [seg(`seg_${c.id.replace(/^cab_/, "")}_1`, kind, from, to, derived, st.stock, label, pathId)];
      } else {
        // Two (or more) runs with a coupler: longest stock first, remainder rounded.
        build.overStock.push({ segmentLabel: label, derived, longest: st.longest! });
        const longest = st.longest!;
        let left = derived;
        let k = 1;
        while (left > 1e-9 && k < 20) {
          const piece = Math.min(left, longest);
          const ps = roundStock(c.type, piece, overlay).stock;
          const isLast = left - piece <= 1e-9;
          build.segments.push(seg(`seg_${c.id.replace(/^cab_/, "")}_${k}`, kind, k === 1 ? from : { port: "" }, isLast ? to : { port: "" }, piece, ps, `${label}.${k}`, pathId));
          left -= piece;
          k++;
        }
      }
    }
    if (build.segments.length > 1) build.segments.forEach((s, i) => { if (!s.label || s.label === label) s.label = `${label}.${i + 1}`; });
    build.total_ft = build.segments.reduce((a, s) => a + s.length_ft.stock, 0);
    out.set(c.id, build);
  }
  return out;
}

function longestPath(record: ShowRecord, chain: string[]): string | undefined {
  let best: string | undefined;
  let len = -1;
  for (const id of chain) {
    const p = record.physical.paths.find((x) => x.id === id);
    const v = p ? pathLen(p) ?? 0 : 0;
    if (v > len) { len = v; best = id; }
  }
  return best;
}

// ---------------- rollups ----------------
export function physicalDerived(record: ShowRecord, builds = deriveSegments(record)): { physical: NonNullable<Derived["physical"]>; cableCountByType: Record<string, number> } {
  const byPath: NonNullable<Derived["physical"]>["byPath"] = {};
  for (const p of record.physical.paths) byPath[p.id] = { cables: 0, byType: {}, totalFt: 0 };
  const counts: Record<string, number> = {};
  for (const b of builds.values()) {
    for (const s of b.segments) {
      if (s.kind === "trunk-strand") continue;
      const key = `${b.type} ${s.length_ft.stock}ft`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const runs = b.segments.filter((s) => s.kind === "run");
    const runFt = runs.reduce((a, s) => a + s.length_ft.stock, 0);
    const chainLen = b.pathChain.reduce((a, id) => a + (pathLen(record.physical.paths.find((p) => p.id === id) ?? ({} as PhysPath)) ?? 0), 0);
    for (const id of b.pathChain) {
      const slot = byPath[id];
      if (!slot || !runs.length) continue;
      slot.cables += 1;
      slot.byType[b.type] = (slot.byType[b.type] ?? 0) + 1;
      const p = record.physical.paths.find((x) => x.id === id);
      const share = chainLen > 0 && p ? (pathLen(p) ?? 0) / chainLen : 1 / b.pathChain.length;
      slot.totalFt += Math.round(runFt * share);
    }
  }
  return { physical: { byPath }, cableCountByType: counts };
}

// ---------------- trunk plan ----------------
const TRUNK_CABLES: CableType[] = ["SDI", "cat6", "comms"];
const JACK_FOR: Partial<Record<CableType, PortType[]>> = { SDI: ["12G-SDI", "3G-SDI", "HD-SDI"], cat6: ["cat6", "etherCon"], comms: ["intercom"] };

function panelDevice(id: string, label: string, templateId: string, model: string, kind: string, posId: string, ru: number, lb: number, jacks: Jack[], strands: number): Device {
  return {
    id, templateId, class: "patchPanel", make: "Generic", model, label, qty: 1, rackId: null, ru, powerW: 0, weightLb: lb, ports: [],
    positionId: posId, source: "approximate", inventoryRef: { system: "RentalWorks", iCode: "", barcode: "" },
    spec: { panelKind: kind, jacks, ru, formatRule: "pass-through", trunkPort: { type: "fiber-LC", strands },
      notes: kind === "fibre-breakout" ? "Channels presented per signal type; FiDO / SFP conversion implied at both ends of the trunk" : "Lands on a tactical fibre trunk" },
  };
}

function channelJacks(newId: NewId): Jack[] {
  const out: Jack[] = [];
  let n = 1;
  const add = (type: PortType, count: number, group: string) => { for (let i = 0; i < count; i++) out.push({ id: newId("jack"), number: n++, type, front: { cableId: null }, rear: { cableId: null }, group }); };
  add("12G-SDI", 12, "SDI");
  add("cat6", 4, "NET");
  add("intercom", 2, "COMMS");
  return out;
}

/**
 * Setup trunk plan: for every stage ↔ video-world SDI / cat6 / comms cable, a stage box at pos_stage_sl (or _sr),
 * a fibre breakout at pos_video_world, one tactical fibre trunk, and each cable re-segmented as
 * jumper → trunk strand → jumper (three segments). Seeds positions / paths first when missing. Accepting writes
 * everything in one patch; an empty array means nothing to route.
 */
export function proposeTrunkPlan(record: ShowRecord, newId: NewId): Patch[] {
  const seedOps = seedPhysical(record, newId);
  const work = seedOps.length ? applyLocal(record, seedOps) : record;
  const posKind = new Map(work.physical.positions.map((p) => [p.id, p.kind]));
  const portDev = new Map<string, Device>();
  for (const d of work.devices) for (const p of d.ports ?? []) portDev.set(p.id, d);

  const candidates: { cable: Cable; stageDev: Device; vwDev: Device; stagePos: string; fromIsStage: boolean }[] = [];
  for (const c of work.cables) {
    if (!TRUNK_CABLES.includes(c.type) || !c.fromPort || !c.toPort) continue;
    if ((c.segments ?? []).some((s) => "jack" in s.from || "jack" in s.to || s.kind === "trunk-strand")) continue;
    const a = portDev.get(c.fromPort);
    const b = portDev.get(c.toPort);
    const pa = positionOf(work, a);
    const pb = positionOf(work, b);
    if (!a || !b || !pa || !pb) continue;
    const ka = posKind.get(pa);
    const kb = posKind.get(pb);
    if (ka === "stage" && kb === "video-world") candidates.push({ cable: c, stageDev: a, vwDev: b, stagePos: pa, fromIsStage: true });
    else if (kb === "stage" && ka === "video-world") candidates.push({ cable: c, stageDev: b, vwDev: a, stagePos: pb, fromIsStage: false });
  }
  if (!candidates.length) return [];

  const sr = candidates.filter((x) => x.stagePos === POS.stageSR).length;
  const sl = candidates.filter((x) => x.stagePos === POS.stageSL).length;
  const boxPos = sr > sl ? POS.stageSR : POS.stageSL;
  const vwPos = work.physical.positions.find((p) => p.kind === "video-world")?.id ?? POS.videoWorld;

  const ops: Patch[] = [...seedOps];
  const usedLabels: string[] = [];
  // Reuse an existing stage box / breakout pair with free jacks; otherwise create them.
  const findPanel = (kind: string, pos: string) => work.devices.find((d) => d.class === "patchPanel" && d.spec?.panelKind === kind && positionOf(work, d) === pos);
  let box = findPanel("stage-box", boxPos);
  let fo = findPanel("fibre-breakout", vwPos);
  const newPanels: Device[] = [];
  const strands = Math.max(24, Math.ceil((candidates.length * 2) / 12) * 12);
  if (!box) {
    const label = nextPanelLabel(work, boxPos, "stage-box", [], usedLabels);
    usedLabels.push(label);
    box = panelDevice(newId("dev"), label, "tpl_panel_stagebox_12sdi", "Stage box 12× SDI", "stage-box", boxPos, 0, 25, channelJacks(newId), strands);
    newPanels.push(box);
  }
  if (!fo) {
    const label = nextPanelLabel(work, vwPos, "fibre-breakout", [], usedLabels);
    usedLabels.push(label);
    fo = panelDevice(newId("dev"), label, "tpl_panel_fibre_12lc", "Fibre breakout 12× LC", "fibre-breakout", vwPos, 1, 5, channelJacks(newId), strands);
    newPanels.push(fo);
  }
  const boxJacks = structuredClone(jacksOf(box)) as Jack[];
  const foJacks = structuredClone(jacksOf(fo)) as Jack[];

  // Trunk: reuse one already listed in /physical/trunks, else a new fibre cable sized to the count.
  const chain = shortestPathChain(work, vwPos, boxPos) ?? [];
  let trunk = work.cables.find((c) => work.physical.trunks.includes(c.id) && c.type === "fiber");
  let newTrunk: Cable | null = null;
  if (!trunk) {
    const r = runLength(work, chain);
    const len = roundStock("fiber", r.len ?? 250, work.physical.stock).stock;
    newTrunk = { id: newId("cab"), type: "fiber", length_ft: len, fromPort: null, toPort: null, label: nextCableLabel(work, "fiber"), redundancyGroup: null, strands, pathChain: chain, segments: [] };
    trunk = newTrunk;
  }
  const usedStrands = new Set<number>();
  for (const c of work.cables) for (const s of c.segments ?? []) if (s.kind === "trunk-strand" && s.reelRef?.startsWith(`${trunk.id}/`)) usedStrands.add(Number(s.reelRef.split("/")[1]));

  const labels = cableLabels(work);
  const cableOps: Patch[] = [];
  const overlay = work.physical.stock;
  for (const cand of candidates) {
    const types = JACK_FOR[cand.cable.type] ?? [];
    const bj = boxJacks.find((j) => types.includes(j.type) && !j.front.cableId && !j.rear.cableId);
    const fj = bj ? foJacks.find((j) => j.number === bj.number && !j.front.cableId && !j.rear.cableId) ?? foJacks.find((j) => types.includes(j.type) && !j.front.cableId && !j.rear.cableId) : undefined;
    if (!bj || !fj) continue; // out of jacks: leave as a direct run
    let strand = 1;
    while (usedStrands.has(strand)) strand++;
    usedStrands.add(strand);
    bj.front.cableId = cand.cable.id; bj.rear.cableId = cand.cable.id;
    fj.front.cableId = cand.cable.id; fj.rear.cableId = cand.cable.id;
    const label = labels.get(cand.cable.id) ?? cand.cable.label;
    const stageJ = jumperLength(cand.stageDev, box);
    const vwJ = jumperLength(cand.vwDev, fo);
    const sStage = roundStock(cand.cable.type, stageJ, overlay).stock;
    const sVw = roundStock(cand.cable.type, vwJ, overlay).stock;
    const stagePort = cand.fromIsStage ? cand.cable.fromPort! : cand.cable.toPort!;
    const vwPort = cand.fromIsStage ? cand.cable.toPort! : cand.cable.fromPort!;
    const base = cand.cable.id.replace(/^cab_/, "");
    const stageSeg = (k: number, outbound: boolean) => seg(`seg_${base}_${k}`, "jumper",
      outbound ? { port: stagePort } : { jack: bj.id, side: "front" }, outbound ? { jack: bj.id, side: "front" } : { port: stagePort }, stageJ, sStage, `${label}.${k}`);
    const vwSeg = (k: number, outbound: boolean) => seg(`seg_${base}_${k}`, "jumper",
      outbound ? { port: vwPort } : { jack: fj.id, side: "front" }, outbound ? { jack: fj.id, side: "front" } : { port: vwPort }, vwJ, sVw, `${label}.${k}`);
    const strandSeg = (k: number, fromBox: boolean) => {
      const s = seg(`seg_${base}_${k}`, "trunk-strand",
        { jack: fromBox ? bj.id : fj.id, side: "rear" }, { jack: fromBox ? fj.id : bj.id, side: "rear" }, trunk!.length_ft, trunk!.length_ft, `${label}.${k}`, chain[0]);
      s.reelRef = `${trunk!.id}/${String(strand).padStart(2, "0")}`;
      return s;
    };
    const segments = cand.fromIsStage ? [stageSeg(1, true), strandSeg(2, true), vwSeg(3, false)] : [vwSeg(1, true), strandSeg(2, false), stageSeg(3, false)];
    const total = segments.reduce((a, s) => a + s.length_ft.stock, 0);
    cableOps.push({ op: "add", path: `/cables/${cand.cable.id}/segments`, value: segments });
    cableOps.push({ op: "replace", path: `/cables/${cand.cable.id}/length_ft`, value: total });
  }
  if (!cableOps.length) return seedOps;

  for (const p of newPanels) {
    const jacks = p.id === box.id ? boxJacks : foJacks;
    ops.push({ op: "add", path: "/devices/-", value: { ...p, spec: { ...p.spec, jacks } } });
  }
  for (const [panel, jacks] of [[box, boxJacks], [fo, foJacks]] as const) {
    if (newPanels.includes(panel)) continue;
    const before = jacksOf(panel);
    jacks.forEach((j, i) => { if (JSON.stringify(before[i]) !== JSON.stringify(j)) ops.push({ op: "replace", path: `/devices/${panel.id}/spec/jacks/${j.id}`, value: j }); });
  }
  if (newTrunk) {
    ops.push({ op: "add", path: "/cables/-", value: newTrunk });
    ops.push({ op: "add", path: "/physical/trunks/-", value: newTrunk.id });
  }
  // Panels sit on the trunk's path, in order from video world.
  for (const pid of chain) {
    const p = work.physical.paths.find((x) => x.id === pid);
    if (!p) continue;
    const via = [...new Set([...p.viaPanels, fo.id, box.id])];
    if (JSON.stringify(via) !== JSON.stringify(p.viaPanels)) ops.push({ op: "replace", path: `/physical/paths/${pid}/viaPanels`, value: via });
  }
  ops.push(...cableOps);
  return ops;
}

// ---------------- tags ----------------
export function bothEndsTag(record: ShowRecord, c: Cable, jacks = jackIndex(record)): string {
  const portRef = (pid: string | null) => {
    if (!pid) return "(open)";
    for (const d of record.devices) { const p = d.ports.find((x) => x.id === pid); if (p) return `${d.label}:${p.name}`; }
    return "(missing port)";
  };
  const via = [...new Set((c.segments ?? []).flatMap((s) => [s.from, s.to]).filter((e): e is { jack: string; side: "front" | "rear" } => "jack" in e).map((e) => {
    const j = jacks.get(e.jack);
    return j ? jackLabel(j.panel, j.jack) : e.jack;
  }))];
  return `${portRef(c.fromPort)} → ${portRef(c.toPort)}${via.length ? ` via ${via.join(", ")}` : ""}`;
}

export const colourFor = (record: ShowRecord, c: Cable) => {
  const l = record.signal.links.find((x) => x.cableId === c.id);
  return labelColour(c.type, c.redundancyGroup ?? l?.path ?? null);
};

// ---------------- PHY checks ----------------
export function physicalChecks(record: ShowRecord, g: Graph = buildGraph(record, specResolver(null)), resolved: Map<string, Resolved> = resolveFormats(g), builds = deriveSegments(record)): CheckDraft[] {
  const out: CheckDraft[] = [];
  if (!record.physical.positions.length) return out; // physical layer not set up: lengths are planned values only
  const jacks = jackIndex(record);
  const pathById = new Map(record.physical.paths.map((p) => [p.id, p]));
  const posLabel = (id: string | null | undefined) => record.physical.positions.find((p) => p.id === id)?.label ?? id ?? "?";
  const pathName = (p: PhysPath) => `${posLabel(p.from)} ↔ ${posLabel(p.to)}`;

  // PHY-001 jack unterminated
  for (const { panel, jack } of jacks.values()) {
    const f = jack.front.cableId;
    const r = jack.rear.cableId;
    if (!!f === !!r) continue;
    const label = jackLabel(panel, jack);
    const side = f ? "front" : "rear";
    const missing = f ? "rear" : "front";
    const cab = record.cables.find((c) => c.id === (f ?? r));
    const candidates = record.cables.filter((c) => c.id !== cab?.id && (JACK_FOR[c.type] ?? []).includes(jack.type) && !(c.segments ?? []).length).slice(0, 3);
    out.push({
      code: "PHY-001", severity: "warn", title: "Jack unterminated", target: jack.id, involved: [jack.id, panel.id, ...(cab ? [cab.id] : [])],
      message: `${label} has ${cab?.label ?? "a cable"} on the ${side} and nothing on the ${missing}.`,
      rule: `A panel jack is a pass-through: front and rear must both carry the cable; ${side} = ${cab?.label ?? "set"}, ${missing} = empty.`,
      evidence: [
        { label: `${label} ${missing}`, value: "empty", path: `/devices/${panel.id}/spec/jacks/${jack.id}/${missing}` },
        { label: `${label} ${side}`, value: cab?.label ?? String(f ?? r), path: `/devices/${panel.id}/spec/jacks/${jack.id}/${side}` },
        { label: "jack type", value: jack.type, path: `/devices/${panel.id}/spec/jacks/${jack.id}/type` },
      ],
      fixes: [
        { label: candidates.length ? `Land one of ${candidates.map((c) => c.label).join(", ")} on the ${missing} of ${label}` : `Land a ${jack.type} cable on the ${missing} of ${label}`, module: "signal" },
        { label: `Remove ${panel.label} from the path`, module: "signal" },
      ],
    });
  }

  // PHY-002 trunk over capacity
  for (const tid of record.physical.trunks) {
    const t = record.cables.find((c) => c.id === tid);
    if (!t) continue;
    const riding = record.cables.filter((c) => (c.segments ?? []).some((s) => s.kind === "trunk-strand" && s.reelRef?.startsWith(`${tid}/`)));
    const channels = Math.floor((t.strands ?? 0) / 2);
    if (riding.length <= channels) continue;
    const second: Cable = { ...t, id: `cab_${tid.replace(/^cab_/, "")}b`, label: nextCableLabel(record, "fiber"), segments: [] };
    out.push({
      code: "PHY-002", severity: "block", title: "Trunk over capacity", target: tid, involved: [tid, ...riding.map((c) => c.id)],
      message: `${t.label} carries ${riding.length} cables but its ${t.strands ?? 0} strands give ${channels} channels.`,
      rule: `Cables routed through a trunk must be ≤ strands ÷ 2; ${riding.length} > ${channels}.`,
      evidence: [
        { label: "cables routed", value: String(riding.length), path: `/cables` },
        { label: `${t.label} strands`, value: String(t.strands ?? 0), path: `/cables/${tid}/strands` },
      ],
      fixes: [
        { label: `Add a second trunk beside ${t.label}`, module: "signal", patch: [{ op: "add", path: "/cables/-", value: second }, { op: "add", path: "/physical/trunks/-", value: second.id }] },
        { label: "Move the extra cables to a direct run", module: "signal" },
      ],
    });
  }

  for (const b of builds.values()) {
    const c = record.cables.find((x) => x.id === b.cableId)!;
    // PHY-003 segment over stock
    for (const o of b.overStock) {
      out.push({
        code: "PHY-003", severity: "info", title: "Segment over stock", target: c.id, involved: [c.id, ...b.pathChain],
        message: `${o.segmentLabel} needs ${Math.round(o.derived)} ft, longer than the longest ${c.type} stock (${o.longest} ft); two runs and a coupler are assumed.`,
        rule: `Derived length must be ≤ longest stock; ${Math.round(o.derived)} ft > ${o.longest} ft.`,
        evidence: [
          { label: "derived length", value: `${Math.round(o.derived)} ft`, path: `/cables/${c.id}/segments` },
          { label: `${c.type} longest stock`, value: `${o.longest} ft`, path: `/physical/stock/${c.type}` },
          { label: "stock list", value: stockList(c.type, record.physical.stock).join(", "), path: `/physical/stock/${c.type}` },
        ],
        fixes: [{ label: "Pin a measured length on the segment", module: "signal" }, { label: "Change the route", module: "signal" }],
      });
    }
    // PHY-004 reach exceeded on a copper segment
    const link = g.linkByCable.get(c.id);
    const fmt = link ? resolved.get(link.id)?.format ?? link.format : null;
    const reach = reachFt(c.type, fmt);
    if (reach) for (const s of b.segments) {
      if (s.kind === "trunk-strand") continue;
      const len = s.length_ft.pinned ?? s.length_ft.stock;
      if (len <= reach.reach) continue;
      out.push({
        code: "PHY-004", severity: "block", title: "Reach exceeded on segment", target: s.id, involved: [c.id, s.id],
        message: `${s.label} is ${len} ft of ${c.type}${fmt ? ` carrying ${normalizeShort(fmt)}` : ""}, beyond copper reach of ${reach.reach} ft.`,
        rule: `${reach.basis}; segment is ${len} ft.`,
        evidence: [
          { label: `${s.label} length`, value: `${len} ft`, path: `/cables/${c.id}/segments/${s.id}` },
          { label: "reach", value: `${reach.reach} ft`, path: "port-rules" },
          ...(fmt ? [{ label: "format", value: describeFormat(fmt), path: link ? `/signal/links/${link.id}/format` : "" }] : []),
        ],
        fixes: [{ label: "Insert a fibre pair (AJA FiDO-4T / 4R) at the panel", module: "signal" }, { label: "Insert a reclocking DA (AJA 12GDA) midway", module: "signal" }],
      });
    }
  }

  // PHY-005 path unmeasured (one per path, listing cables)
  const unmeasured = new Map<string, string[]>();
  for (const b of builds.values()) for (const pid of b.pathChain) {
    const p = pathById.get(pid);
    if (p && (p.length_ft.state === "unknown" || p.length_ft.value == null)) unmeasured.set(pid, [...(unmeasured.get(pid) ?? []), b.cableId]);
  }
  for (const [pid, cabs] of unmeasured) {
    const p = pathById.get(pid)!;
    const src = record.physical.positions.find((x) => x.id === p.to)?.sourcePath ?? record.physical.positions.find((x) => x.id === p.from)?.sourcePath ?? "/event";
    out.push({
      code: "PHY-005", severity: "warn", title: "Path unmeasured", target: pid, involved: [pid, ...cabs],
      message: `${cabs.length} cable${cabs.length === 1 ? "" : "s"} run over ${pathName(p)}, which has no measured length.`,
      rule: `A path's length must be confirmed or assumed before cable lengths are firm; state is ${p.length_ft.state}.`,
      evidence: [
        { label: `${pathName(p)} length`, value: p.length_ft.value == null ? "unknown" : `${p.length_ft.value} ft (${p.length_ft.state})`, path: `/physical/paths/${pid}/length_ft` },
        { label: "advance source", value: src, path: src },
      ],
      fixes: [{ label: `Answer the advance question at ${src}`, module: "shell" }],
    });
  }

  // PHY-006 A/B share a path or trunk
  for (const grp of record.signal.redundancy) {
    const sideOf = (ids: string[]) => {
      const s = new Set<string>();
      for (const lid of ids) {
        const l = record.signal.links.find((x) => x.id === lid);
        const b = l ? builds.get(l.cableId) : undefined;
        if (!b) continue;
        b.pathChain.forEach((p) => s.add(p));
        b.segments.forEach((sg) => { if (sg.kind === "trunk-strand" && sg.reelRef) s.add(sg.reelRef.split("/")[0]); });
      }
      return s;
    };
    const A = sideOf(grp.primary);
    const B = sideOf(grp.backup);
    const shared = [...A].filter((x) => B.has(x));
    if (!shared.length) continue;
    const names = shared.map((id) => { const p = pathById.get(id); return p ? pathName(p) : record.cables.find((c) => c.id === id)?.label ?? id; });
    out.push({
      code: "PHY-006", severity: "warn", title: "A/B share a path", target: grp.id, involved: [grp.id, ...shared],
      message: `Redundancy group ${grp.name} runs its A and B cables over the same route: ${names.join(", ")}.`,
      rule: `A and B cables of one group may not share a path or trunk; shared: ${names.join(", ")}.`,
      evidence: [
        { label: "shared route", value: names.join(", "), path: shared[0].startsWith("path_") ? `/physical/paths/${shared[0]}` : `/cables/${shared[0]}` },
        { label: "group", value: grp.name, path: `/signal/redundancy/${grp.id}` },
      ],
      fixes: [{ label: "Re-route the B cables over another path", module: "signal" }, { label: "Accept risk with annotation", module: "binder" }],
    });
  }

  // PHY-007 panel in wrong position / PHY-008 device has no position
  const kindOfPos = new Map(record.physical.positions.map((p) => [p.id, p.kind]));
  const cabled = new Set<string>();
  for (const c of record.cables) for (const p of [c.fromPort, c.toPort]) if (p && g.ports.get(p)) cabled.add(g.ports.get(p)!.device.id);
  for (const d of record.devices) {
    if (d.class === "patchPanel") {
      const kind = String(d.spec?.panelKind ?? g.specOf(d).panelKind ?? "");
      const pos = positionOf(record, d);
      const wrong = kind === "stage-box" && pos && kindOfPos.get(pos) === "video-world" ? `a stage box placed at ${posLabel(pos)}`
        : kind === "rack-panel" && !d.rackId ? "a rack panel with no rack" : null;
      if (wrong) out.push({
        code: "PHY-007", severity: "warn", title: "Panel in wrong position", target: d.id, involved: [d.id],
        message: `${d.label} is ${wrong}.`,
        rule: kind === "stage-box" ? `Stage boxes stand on stage; position kind is video-world.` : `Rack panels mount in a rack; rackId is empty.`,
        evidence: [
          { label: kind === "stage-box" ? `${d.label} position` : `${d.label} rack`, value: kind === "stage-box" ? posLabel(pos) : "none", path: kind === "stage-box" ? `/devices/${d.id}/positionId` : `/devices/${d.id}/rackId` },
          { label: "panel kind", value: kind, path: `/devices/${d.id}/spec/panelKind` },
        ],
        fixes: [{ label: kind === "stage-box" ? `Move ${d.label} to stage left or stage right` : `Place ${d.label} in a rack`, module: kind === "stage-box" ? "signal" : "rack" }],
      });
    }
    if (cabled.has(d.id) && !positionOf(record, d)) {
      const owner = d.rackId ? "rack" : ["tile", "processor", "distro", "ledPdu"].includes(d.class) ? "led" : ["server", "kvm", "capture", "tcGen"].includes(d.class) ? "rack" : "signal";
      out.push({
        code: "PHY-008", severity: "info", title: "Device has no position", target: d.id, involved: [d.id],
        message: `${d.label} has cables but no position, so its cable lengths are defaults.`,
        rule: "A cabled device needs a positionId (own, or through its rack) for path-based lengths; it has none.",
        evidence: [
          { label: `${d.label} position`, value: "none", path: `/devices/${d.id}/positionId` },
          { label: `${d.label} rack`, value: d.rackId ? record.racks.find((k) => k.id === d.rackId)?.name ?? d.rackId : "none", path: `/devices/${d.id}/rackId` },
        ],
        fixes: [{ label: `Set ${d.label}'s position`, module: owner as "rack" | "led" | "signal" }],
      });
    }
  }
  return out;
}

function normalizeShort(f: string) {
  return describeFormat(f);
}

