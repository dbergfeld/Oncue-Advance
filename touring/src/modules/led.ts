// LED Map & Power module (`led`). Owns /led, devices of class tile/processor/distro/ledPdu and the
// etherCon / fiberLED / tilePower cables. Pure: every write is returned as Patch[] for the caller to apply as 'led'.
import type {
  Cable, CheckDraft, Circuit, DataRun, Derived, Device, ModuleContract, Patch, PatchBox, SeedContext, ShowRecord, ValidateContext, Wall,
} from "../store/types";
import { instantiate, library, nextLabel, type NewId } from "../library/library";
import {
  MM_TO_FT, PORTS_PER_10G, deviceById, portCapacity, portOwner, snakeOrder, tileSpecForWall, wallGeometry, type WallGeometry,
} from "../library/wall";
import { fmt, toCsv } from "../util/csv";

export { wallGeometry, snakeOrder } from "../library/wall";

export const CIRCUIT_AMPS = 20;
export const CIRCUIT_LIMIT = 0.8;
/** Tile circuits are 208 V line-to-line on a 3Ø service and 120 V on 1Ø. */
export function circuitVolts(phase: Wall["power"]["phase"]): number {
  return phase === "1Ø" ? 120 : 208;
}
const SQRT3 = Math.sqrt(3);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const tkey = (t: [number, number]) => `${t[0]},${t[1]}`;
const inBounds = (w: Wall, t: [number, number]) => t[0] >= 0 && t[1] >= 0 && t[0] < w.cols && t[1] < w.rows;
const wallPath = (w: Wall) => `/led/walls/${w.id}`;

function findWall(r: ShowRecord, wallId: string): Wall {
  const w = r.led.walls.find((x) => x.id === wallId);
  if (!w) throw new Error(`no wall ${wallId}`);
  return w;
}

function uniqueTiles(w: Wall, chains: [number, number][][]): Set<string> {
  const s = new Set<string>();
  for (const c of chains) for (const t of c) if (inBounds(w, t)) s.add(tkey(t));
  return s;
}

/** `<distro>-<leg>-<n>` circuit label (contract naming); legs rotate A/B/C on 3Ø. */
export function circuitLabel(r: ShowRecord, w: Wall, circuitId: string): string {
  const i = w.power.circuits.findIndex((c) => c.id === circuitId);
  const distro = deviceById(r, w.power.distroId)?.label ?? `${w.name} distro`;
  if (i < 0) return circuitId;
  if (w.power.phase === "1Ø") return `${distro}-${i + 1}`;
  return `${distro}-${"ABC"[i % 3]}-${Math.floor(i / 3) + 1}`;
}

function portLabel(r: ShowRecord, portId: string): string {
  const o = portOwner(r, portId);
  return o ? `${o.device.label} ${o.port.name}` : "an unknown port";
}

// ---------------- derive ----------------
export function deriveLed(r: ShowRecord): Pick<Derived, "led" | "power"> {
  const perWall: Derived["led"]["perWall"] = {};
  const totals = { tiles: 0, maxW: 0, avgW: 0, weightLb: 0 };
  const byCircuit: Derived["power"]["byCircuit"] = {};
  const byDistro: Derived["power"]["byDistro"] = {};
  let wallW = 0;
  for (const w of r.led.walls) {
    const g = wallGeometry(r, w);
    perWall[w.id] = { tiles: g.tiles, w_px: g.w_px, h_px: g.h_px, w_ft: g.w_ft, h_ft: g.h_ft, maxW: g.maxW, avgW: g.avgW, weightLb: g.weightLb, portsNeeded: g.portsNeeded, approximate: g.approximate };
    totals.tiles += g.tiles; totals.maxW += g.maxW; totals.avgW += g.avgW; totals.weightLb = round(totals.weightLb + g.weightLb);
    wallW += g.maxW;
    const volts = circuitVolts(w.power.phase);
    for (const c of w.power.circuits) {
      const n = uniqueTiles(w, [c.tiles]).size;
      const loadW = n * g.tile.maxW;
      const loadA = round(loadW / volts);
      byCircuit[c.id] = { amps: c.amps, loadW, loadA, pct: c.amps > 0 ? round((loadA / c.amps) * 100, 1) : 0 };
    }
    if (w.power.distroId) byDistro[w.power.distroId] = { loadW: (byDistro[w.power.distroId]?.loadW ?? 0) + g.maxW };
  }
  const deviceW = r.devices.filter((d) => d.class !== "tile").reduce((s, d) => s + (d.powerW || 0) * (d.qty || 1), 0);
  const totalW = wallW + deviceW;
  return {
    led: { perWall, totals },
    power: { byCircuit, byDistro, totalW, totalA_perLeg: round(totalW / (208 * SQRT3)) },
  };
}

// ---------------- canvas ----------------
/** Lays walls out side by side (record order) at y = 0; the canvas is their bounding box. */
export function canvasFor(r: ShowRecord): ShowRecord["led"]["canvas"] {
  let x = 0;
  let h = 0;
  const mappings: { wallId: string; x: number; y: number }[] = [];
  for (const w of r.led.walls) {
    const g = wallGeometry(r, w);
    mappings.push({ wallId: w.id, x, y: 0 });
    x += g.w_px;
    h = Math.max(h, g.h_px);
  }
  return { w_px: x, h_px: h, mappings };
}

export function setCanvas(r: ShowRecord): Patch[] {
  return [{ op: "replace", path: "/led/canvas", value: canvasFor(r) }];
}

// ---------------- processors ----------------
interface PortSlot { portId: string; type: "etherCon" | "fiberLED"; px: number }

function usedRunPorts(r: ShowRecord, exceptWall?: string): Set<string> {
  const s = new Set<string>();
  for (const w of r.led.walls) if (w.id !== exceptWall) for (const d of w.dataRuns) s.add(d.portId);
  return s;
}

/** Tile-facing output ports on a set of processors: etherCon 1G outs, or 10G fiberLED outs when a processor has no 1G outs (non-Brompton). */
function tilePorts(r: ShowRecord, devices: Device[], exclude: Set<string>): PortSlot[] {
  const eth: PortSlot[] = [];
  const fib: PortSlot[] = [];
  const view = { ...r, devices: [...r.devices, ...devices.filter((d) => !r.devices.some((x) => x.id === d.id))] } as ShowRecord;
  for (const d of devices) for (const p of d.ports) {
    if (p.dir !== "out" || exclude.has(p.id)) continue;
    if (p.type === "etherCon") eth.push({ portId: p.id, type: "etherCon", px: portCapacity(view, p.id).px });
    else if (p.type === "fiberLED") fib.push({ portId: p.id, type: "fiberLED", px: portCapacity(view, p.id).px });
  }
  return eth.length ? eth : fib;
}

const isSX40 = (d: Device) => d.templateId === "tpl_brompton_sx40" || /sx-?40/i.test(d.model);
const isXD = (d: Device) => d.templateId === "tpl_brompton_xd" || /\bxd\b/i.test(d.model);

function wallProtocol(r: ShowRecord, w: Wall): string {
  const t = tileSpecForWall(w).protocol;
  if (t) return t;
  const p = deviceById(r, w.processorIds[0]);
  if (p && /novastar/i.test(p.make)) return "Novastar";
  if (p && /megapixel/i.test(p.make)) return "Megapixel";
  return "Brompton";
}

interface ProcessorPlan { patches: Patch[]; added: Device[]; processorIds: string[] }

/**
 * Plans the processors a wall needs for `portsNeeded` 1G tile ports: Brompton adds XDs (10× 1G each) and an SX40 per four XDs
 * (SX40 always pairs an XD); NovaStar adds MX40 Pro (20× 1G); Megapixel adds HELIOS (4× 10G ≈ 40× 1G).
 */
function planProcessors(r: ShowRecord, w: Wall, portsNeeded: number, newId: NewId): ProcessorPlan {
  const existing = w.processorIds.map((id) => deviceById(r, id)).filter((d): d is Device => !!d);
  const used = new Set(r.devices.map((d) => d.label));
  const added: Device[] = [];
  const patches: Patch[] = [];
  const cables: Cable[] = [];
  const add = (tplId: string, prefix: string) => {
    const t = library.get(tplId)!;
    const label = nextLabel(used, prefix);
    used.add(label);
    const d = instantiate(t, label, newId);
    added.push(d);
    patches.push({ op: "add", path: "/devices/-", value: d });
    return d;
  };
  const exclude = usedRunPorts(r, w.id);
  const protocol = wallProtocol(r, w);
  if (protocol === "Brompton") {
    const have = tilePorts(r, existing, exclude).filter((p) => p.type === "etherCon").length;
    const sx = existing.filter(isSX40);
    const xd = existing.filter(isXD);
    const direct = existing.filter((d) => !isSX40(d) && !isXD(d));
    let xdAdd = Math.max(0, Math.ceil((portsNeeded - have) / 10));
    if (!existing.length || (sx.length && !xd.length)) xdAdd = Math.max(xdAdd, 1);
    const needSx = direct.length && !xdAdd && !xd.length ? 0 : Math.ceil((xd.length + xdAdd) / 4);
    const sxAdded: Device[] = [];
    for (let i = sx.length; i < needSx; i++) sxAdded.push(add("tpl_brompton_sx40", "PROC"));
    const xdAdded: Device[] = [];
    for (let i = 0; i < xdAdd; i++) xdAdded.push(add("tpl_brompton_xd", "XD"));
    // Land each new XD's 10G IN 1 on a free SX40 10G OUT with a fiberLED jumper.
    const busy = new Set(r.cables.flatMap((c) => [c.fromPort, c.toPort]).filter(Boolean) as string[]);
    const freeOuts = [...sx, ...sxAdded].flatMap((d) => d.ports.filter((p) => p.type === "fiberLED" && p.dir === "out" && !busy.has(p.id)).map((p) => ({ d, p })));
    const cabLabels = new Set(r.cables.map((c) => c.label));
    for (const x of xdAdded) {
      const out = freeOuts.shift();
      const inp = x.ports.find((p) => p.type === "fiberLED" && p.dir === "in");
      if (!out || !inp) continue;
      const label = nextLabel(cabLabels, "LED", 1, { pad: 3 });
      cabLabels.add(label);
      cables.push({ id: newId("cab"), type: "fiberLED", length_ft: 10, fromPort: out.p.id, toPort: inp.id, label, redundancyGroup: null });
    }
  } else {
    const tpl = protocol === "Novastar" ? "tpl_novastar_mx40pro" : "tpl_megapixel_helios";
    const t = library.get(tpl)!;
    const per = Number(t.spec.outputs1G) || Number(t.spec.outputs10G) * PORTS_PER_10G || 1;
    const have = tilePorts(r, existing, exclude).reduce((s, p) => s + (p.type === "fiberLED" ? PORTS_PER_10G : 1), 0);
    let n = Math.max(0, Math.ceil((portsNeeded - have) / per));
    if (!existing.length) n = Math.max(n, 1);
    for (let i = 0; i < n; i++) add(tpl, "PROC");
  }
  for (const c of cables) patches.push({ op: "add", path: "/cables/-", value: c });
  const processorIds = [...w.processorIds, ...added.map((d) => d.id)];
  if (added.length) patches.push({ op: "replace", path: `${wallPath(w)}/processorIds`, value: processorIds });
  return { patches, added, processorIds };
}

/** Processor count from tiles ÷ port capacity (redundant runs double it); adds only the shortfall. */
export function autoProcessors(r: ShowRecord, wallId: string, newId: NewId, opts: { redundant?: boolean } = {}): Patch[] {
  const w = findWall(r, wallId);
  const g = wallGeometry(r, w);
  const redundant = opts.redundant ?? g.redundant;
  const base = g.redundant ? g.portsNeeded / 2 : g.portsNeeded;
  return planProcessors(r, w, redundant ? base * 2 : base, newId).patches;
}

// ---------------- data runs ----------------
/**
 * Splits the wall's tiles into data runs no larger than each port's pixel capacity, in column-snake order, and lands
 * them on the wall's processor/XD output ports. Redundant walls get a matching backup run (`redundant: true`) per run.
 * With `newId`, adds processors/XDs for any port shortfall; without it returns [] when the existing ports cannot hold the wall.
 */
export function autoSplitRuns(r: ShowRecord, wallId: string, newId?: NewId, opts: { redundant?: boolean } = {}): Patch[] {
  const w = findWall(r, wallId);
  const g = wallGeometry(r, w);
  const redundant = opts.redundant ?? g.redundant;
  const order = snakeOrder(w.cols, w.rows);
  const tilePx = g.tile.px_w * g.tile.px_h;
  const runsPath = `${wallPath(w)}/dataRuns`;
  if (!order.length || tilePx <= 0) return [{ op: "replace", path: runsPath, value: [] }];

  const exclude = usedRunPorts(r, w.id);
  let devices = w.processorIds.map((id) => deviceById(r, id)).filter((d): d is Device => !!d);
  let pool = tilePorts(r, devices, exclude);
  const extra: Patch[] = [];
  const plan = (slots: PortSlot[]) => {
    const per = Math.max(1, Math.floor((slots[0]?.px ?? g.pxPerPort) / tilePx));
    const chunks = Math.ceil(order.length / per);
    return { per, chunks, need: chunks * (redundant ? 2 : 1) };
  };
  let p = plan(pool);
  if (pool.length < p.need) {
    if (!newId) return [];
    const pp = planProcessors(r, w, plan(pool.filter((s) => s.type === "etherCon")).need, newId);
    extra.push(...pp.patches);
    devices = [...devices, ...pp.added];
    pool = tilePorts({ ...r, devices: [...r.devices, ...pp.added] }, devices, exclude);
    p = plan(pool);
    if (pool.length < p.need) return [];
  }
  // Uniform capacity per run = the smallest port in the pool, so every run fits wherever it lands.
  const minPx = Math.min(...pool.map((s) => s.px));
  const per = Math.max(1, Math.floor(minPx / tilePx));
  const chunks = Math.ceil(order.length / per);
  const runs: DataRun[] = [];
  for (let i = 0; i < chunks; i++) runs.push({ portId: pool[i].portId, tileChain: order.slice(i * per, (i + 1) * per), redundant: false });
  if (redundant) for (let i = 0; i < chunks; i++) runs.push({ portId: pool[chunks + i].portId, tileChain: order.slice(i * per, (i + 1) * per), redundant: true });
  return [...extra, { op: "replace", path: runsPath, value: runs }];
}

/** Splits one over-capacity run into consecutive runs on free ports of the same type (LED-001 auto-split). */
export function splitRun(r: ShowRecord, wallId: string, runIndex: number): Patch[] {
  const w = findWall(r, wallId);
  const run = w.dataRuns[runIndex];
  if (!run) return [];
  const g = wallGeometry(r, w);
  const tilePx = g.tile.px_w * g.tile.px_h;
  const cap = portCapacity(r, run.portId);
  const chain = run.tileChain.filter((t) => inBounds(w, t));
  const per = Math.max(1, Math.floor(cap.px / Math.max(1, tilePx)));
  const k = Math.ceil(chain.length / per);
  if (k <= 1) return [];
  const devices = w.processorIds.map((id) => deviceById(r, id)).filter((d): d is Device => !!d);
  const busy = usedRunPorts(r);
  const free = tilePorts(r, devices, busy).filter((s) => s.type === cap.port?.type && s.px >= per * tilePx);
  if (free.length < k - 1) return [];
  const pieces: DataRun[] = [];
  for (let i = 0; i < k; i++) pieces.push({ portId: i === 0 ? run.portId : free[i - 1].portId, tileChain: chain.slice(i * per, (i + 1) * per), redundant: run.redundant });
  const runs = [...w.dataRuns.slice(0, runIndex), ...pieces, ...w.dataRuns.slice(runIndex + 1)];
  return [{ op: "replace", path: `${wallPath(w)}/dataRuns`, value: runs }];
}

// ---------------- circuits ----------------
/**
 * Splits the wall's tiles onto 20 A circuits so each stays ≤ 80 % of rated (Σ tile max W ≤ 0.8 × 20 A × V).
 * Adds a distro if the wall has none (reusing an existing LED distro first). Existing circuit ids are reused in order
 * so rack references stay valid; extra existing circuits are kept empty. Without `newId`, returns [] when new ids are needed.
 */
export function autoCircuits(r: ShowRecord, wallId: string, newId?: NewId): Patch[] {
  const w = findWall(r, wallId);
  const g = wallGeometry(r, w);
  const volts = circuitVolts(w.power.phase);
  const order = snakeOrder(w.cols, w.rows);
  const per = g.tile.maxW > 0 ? Math.max(1, Math.floor((CIRCUIT_LIMIT * CIRCUIT_AMPS * volts) / g.tile.maxW)) : Math.max(1, order.length);
  const count = order.length ? Math.ceil(order.length / per) : 0;
  const patches: Patch[] = [];
  let distroId = w.power.distroId && deviceById(r, w.power.distroId) ? w.power.distroId : null;
  if (!distroId) {
    const existing = r.devices.find((d) => d.class === "distro");
    if (existing) distroId = existing.id;
    else if (newId) {
      const d = instantiate(library.get("tpl_motionlabs_200a")!, nextLabel(r.devices.map((x) => x.label), "LED DISTRO", 1, { sep: " " }), newId);
      patches.push({ op: "add", path: "/devices/-", value: d });
      distroId = d.id;
    } else return [];
  }
  if (count > w.power.circuits.length && !newId) return [];
  const circuits: Circuit[] = [];
  for (let i = 0; i < Math.max(count, w.power.circuits.length); i++) {
    const id = w.power.circuits[i]?.id ?? newId!("ckt");
    circuits.push({ id, amps: i < count ? CIRCUIT_AMPS : w.power.circuits[i].amps, tiles: i < count ? order.slice(i * per, (i + 1) * per) : [] });
  }
  patches.push({ op: "replace", path: `${wallPath(w)}/power`, value: { phase: w.power.phase, circuits, distroId } });
  return patches;
}

// ---------------- walls ----------------
export interface AddWallOpts {
  name: string; templateId?: string; cols?: number; rows?: number; position?: string;
  /** Rigging object, or just its type ("flown" | "ground" | "hybrid"). */
  rigging?: Partial<Wall["rigging"]> | Wall["rigging"]["type"]; trimHeight_ft?: number; phase?: Wall["power"]["phase"];
}

function rig(x: AddWallOpts["rigging"]): Partial<Wall["rigging"]> {
  return typeof x === "string" ? { type: x } : x ?? {};
}

function defaultHeaders(cols: number, w_mm: number): number {
  return cols > 0 ? Math.max(1, Math.ceil((cols * w_mm) / 3000)) : 0;
}

/** Adds a wall from a tile template (default ROE CB5) and re-lays the canvas side by side. */
export function addWall(r: ShowRecord, opts: AddWallOpts, newId: NewId): Patch[] {
  const t = library.get(opts.templateId ?? "tpl_roe_cb5") ?? library.get("tpl_roe_cb5")!;
  const s = t.spec as Record<string, number>;
  const cols = opts.cols ?? 0;
  const rows = opts.rows ?? 0;
  const rg = rig(opts.rigging);
  const wall: Wall = {
    id: newId("wall"), name: opts.name, tileModel: `${t.make.replace(/ Visual$/, "")} ${t.aliases?.[0] ?? t.model}`, templateId: t.templateId,
    cols, rows, tileW_mm: s.w_mm, tileH_mm: s.h_mm, pitch_mm: s.pitch_mm, trimHeight_ft: opts.trimHeight_ft ?? 0,
    rigging: { type: rg.type ?? "flown", headers: rg.headers ?? defaultHeaders(cols, s.w_mm), points: rg.points ?? [] },
    processorIds: [], dataRuns: [], power: { phase: opts.phase ?? "3Ø", circuits: [], distroId: null },
  };
  if (opts.position) wall.position = opts.position;
  const next = { ...r, led: { ...r.led, walls: [...r.led.walls, wall] } } as ShowRecord;
  return [{ op: "add", path: "/led/walls/-", value: wall }, ...setCanvas(next)];
}

export interface SizeWallOpts {
  cols?: number; rows?: number; templateId?: string; trimHeight_ft?: number; name?: string; position?: string;
  rigging?: Partial<Wall["rigging"]> | Wall["rigging"]["type"]; phase?: Wall["power"]["phase"];
}

/** Changes a wall's size / tile / trim; drops data-run and circuit tiles that fall outside the new bounds. Canvas is left as-is (call setCanvas). */
export function sizeWall(r: ShowRecord, wallId: string, o: SizeWallOpts): Patch[] {
  const w = findWall(r, wallId);
  const p = wallPath(w);
  const out: Patch[] = [];
  const set = (k: string, v: unknown) => out.push({ op: "replace", path: `${p}/${k}`, value: v });
  if (o.name !== undefined && o.name !== w.name) set("name", o.name);
  if (o.position !== undefined) out.push({ op: w.position === undefined ? "add" : "replace", path: `${p}/position`, value: o.position });
  if (o.trimHeight_ft !== undefined) set("trimHeight_ft", o.trimHeight_ft);
  if (o.templateId && o.templateId !== w.templateId) {
    const t = library.get(o.templateId);
    if (!t || t.class !== "tile") throw new Error(`${o.templateId} is not a tile template`);
    const s = t.spec as Record<string, number>;
    out.push({ op: w.templateId === undefined ? "add" : "replace", path: `${p}/templateId`, value: t.templateId });
    set("tileModel", `${t.make.replace(/ Visual$/, "")} ${t.aliases?.[0] ?? t.model}`);
    set("tileW_mm", s.w_mm); set("tileH_mm", s.h_mm); set("pitch_mm", s.pitch_mm);
  }
  const cols = o.cols ?? w.cols;
  const rows = o.rows ?? w.rows;
  if (cols !== w.cols) set("cols", cols);
  if (rows !== w.rows) set("rows", rows);
  if (o.rigging) set("rigging", { ...w.rigging, ...rig(o.rigging) });
  if (o.phase && o.phase !== w.power.phase) set("power/phase", o.phase);
  if (cols < w.cols || rows < w.rows) {
    const nw = { ...w, cols, rows };
    set("dataRuns", w.dataRuns.map((d) => ({ ...d, tileChain: d.tileChain.filter((t) => inBounds(nw, t)) })));
    set("power/circuits", w.power.circuits.map((c) => ({ ...c, tiles: c.tiles.filter((t) => inBounds(nw, t)) })));
  }
  return out;
}

// ---------------- pixel & patch (manual tile mapping) ----------------
/** Letters an XD box can carry on a wall, in drop order. A, B, C, D fill one SX40 (four 10G outs); E onward pair a second SX40. */
export const PATCH_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function patchBoxes(w: Wall): PatchBox[] {
  return w.patchBoxes ?? [];
}

/** Next free box letter on a wall: the first of A, B, C, D, … no box carries yet. */
export function nextPatchLetter(w: Wall): string {
  const used = new Set(patchBoxes(w).map((b) => b.letter));
  return PATCH_LETTERS.find((l) => !used.has(l)) ?? `X${patchBoxes(w).length + 1}`;
}

/** Tile-facing 1G outputs of an XD, in port order (1G OUT 1 … 10). */
export function xdOutPorts(d: Device): Device["ports"] {
  return d.ports.filter((p) => p.type === "etherCon" && p.dir === "out");
}

/** "A3" for the third 1G output of box A; falls back to "<device> <port>" for ports that are not on a patch box. */
export function portPatchLabel(r: ShowRecord, w: Wall, portId: string): string {
  const o = portOwner(r, portId);
  if (!o) return "unassigned";
  const box = patchBoxes(w).find((b) => b.deviceId === o.device.id);
  if (box) {
    const i = xdOutPorts(o.device).findIndex((p) => p.id === portId);
    if (i >= 0) return `${box.letter}${i + 1}`;
  }
  return `${o.device.label} ${o.port.name}`;
}

/** The ports of every XD box on a wall as "A1" … "D10" with the device that holds them. */
export function patchPorts(r: ShowRecord, w: Wall): { box: PatchBox; device: Device; port: Device["ports"][number]; label: string }[] {
  const out: { box: PatchBox; device: Device; port: Device["ports"][number]; label: string }[] = [];
  for (const box of patchBoxes(w)) {
    const d = deviceById(r, box.deviceId);
    if (!d) continue;
    xdOutPorts(d).forEach((port, i) => out.push({ box, device: d, port, label: `${box.letter}${i + 1}` }));
  }
  return out;
}

function busyPorts(r: ShowRecord, extraCables: Cable[] = []): Set<string> {
  return new Set([...r.cables, ...extraCables].flatMap((c) => [c.fromPort, c.toPort]).filter(Boolean) as string[]);
}

function uniqueDeviceLabel(r: ShowRecord, want: string, taken: Set<string>): string {
  const used = new Set([...r.devices.map((d) => d.label.toLowerCase()), ...[...taken].map((l) => l.toLowerCase())]);
  if (!used.has(want.toLowerCase())) return want;
  for (let i = 2; ; i++) if (!used.has(`${want}-${i}`.toLowerCase())) return `${want}-${i}`;
}

export interface DropXdOpts { letter?: string; x?: number; y?: number }

/**
 * Drops an XD box on a wall's tile map: adds a Brompton Tessera XD labelled `XD-<letter>`, appends it to the wall's processors,
 * records the box at (x, y) tile units, and lands its 10G IN 1 on a free SX40 10G OUT with a fiberLED jumper — adding an SX40
 * (`PROC-n`) when no output is free. Every box therefore arrives with its upstream connection point made.
 */
export function dropXd(r: ShowRecord, wallId: string, newId: NewId, opts: DropXdOpts = {}): Patch[] {
  const w = findWall(r, wallId);
  const letter = opts.letter ?? nextPatchLetter(w);
  if (patchBoxes(w).some((b) => b.letter === letter)) throw new Error(`${w.name} already has XD box ${letter}`);
  const patches: Patch[] = [];
  const taken = new Set<string>();
  const added: Device[] = [];
  const add = (tplId: string, label: string) => {
    const d = instantiate(library.get(tplId)!, label, newId);
    taken.add(label);
    added.push(d);
    patches.push({ op: "add", path: "/devices/-", value: d });
    return d;
  };
  const xd = add("tpl_brompton_xd", uniqueDeviceLabel(r, `XD-${letter}`, taken));
  // Upstream: a free SX40 10G OUT, preferring the wall's own processors, else a new SX40.
  const busy = busyPorts(r);
  const sxs = [...w.processorIds.map((id) => deviceById(r, id)).filter((d): d is Device => !!d && isSX40(d)), ...r.devices.filter((d) => isSX40(d) && !w.processorIds.includes(d.id))];
  let out = sxs.flatMap((d) => d.ports.filter((p) => p.type === "fiberLED" && p.dir === "out" && !busy.has(p.id)).map((p) => ({ d, p })))[0];
  if (!out) {
    const sx = add("tpl_brompton_sx40", nextLabel([...r.devices.map((d) => d.label), ...taken], "PROC"));
    const p = sx.ports.find((q) => q.type === "fiberLED" && q.dir === "out")!;
    out = { d: sx, p };
  }
  const inp = xd.ports.find((p) => p.type === "fiberLED" && p.dir === "in");
  if (inp) {
    const label = nextLabel(r.cables.map((c) => c.label), "LED", 1, { pad: 3 });
    const cable: Cable = { id: newId("cab"), type: "fiberLED", length_ft: 10, fromPort: out.p.id, toPort: inp.id, label, redundancyGroup: null };
    patches.push({ op: "add", path: "/cables/-", value: cable });
  }
  const procIds = [...w.processorIds, ...added.map((d) => d.id).filter((id) => !w.processorIds.includes(id))];
  patches.push({ op: "replace", path: `${wallPath(w)}/processorIds`, value: procIds });
  const n = patchBoxes(w).length;
  const box: PatchBox = { deviceId: xd.id, letter, x: Math.max(0, opts.x ?? 0), y: Math.max(0, opts.y ?? w.rows + 0.5 + n * 1.6) };
  if (w.patchBoxes) patches.push({ op: "add", path: `${wallPath(w)}/patchBoxes/-`, value: box });
  else patches.push({ op: "add", path: `${wallPath(w)}/patchBoxes`, value: [box] });
  return patches;
}

/** Moves an XD box on the map (tile units, clamped to ≥ 0). */
export function moveXd(r: ShowRecord, wallId: string, deviceId: string, at: { x: number; y: number }): Patch[] {
  const w = findWall(r, wallId);
  const i = patchBoxes(w).findIndex((b) => b.deviceId === deviceId);
  if (i < 0) return [];
  const b = patchBoxes(w)[i];
  const x = Math.max(0, Math.round(at.x * 100) / 100), y = Math.max(0, Math.round(at.y * 100) / 100);
  if (x === b.x && y === b.y) return [];
  return [{ op: "replace", path: `${wallPath(w)}/patchBoxes/${i}`, value: { ...b, x, y } }];
}

/** Removes an XD box: its data runs, its place in the wall's processors, its jumper cables and the device itself. */
export function removeXd(r: ShowRecord, wallId: string, deviceId: string): Patch[] {
  const w = findWall(r, wallId);
  const d = deviceById(r, deviceId);
  if (!d || !patchBoxes(w).some((b) => b.deviceId === deviceId)) return [];
  const ports = new Set(d.ports.map((p) => p.id));
  const out: Patch[] = [
    { op: "replace", path: `${wallPath(w)}/dataRuns`, value: w.dataRuns.filter((run) => !ports.has(run.portId)) },
    { op: "replace", path: `${wallPath(w)}/processorIds`, value: w.processorIds.filter((id) => id !== deviceId) },
    { op: "replace", path: `${wallPath(w)}/patchBoxes`, value: patchBoxes(w).filter((b) => b.deviceId !== deviceId) },
  ];
  for (const c of r.cables) if ((c.fromPort && ports.has(c.fromPort)) || (c.toPort && ports.has(c.toPort))) out.push({ op: "remove", path: `/cables/${c.id}` });
  out.push({ op: "remove", path: `/devices/${deviceId}` });
  return out;
}

export type PaintMode = "add" | "remove" | "set";

/**
 * Paints tiles onto a port's data run. `add` appends the stroke to the chain (in stroke order), `remove` takes the tiles out,
 * `set` replaces the chain. A tile belongs to one primary run (and one backup run) at a time, so painting it moves it off any
 * other run of the same kind. A port whose chain empties loses its run.
 */
export function paintTiles(r: ShowRecord, wallId: string, portId: string, tiles: [number, number][], mode: PaintMode = "add", opts: { redundant?: boolean } = {}): Patch[] {
  const w = findWall(r, wallId);
  if (!portOwner(r, portId)) throw new Error(`no port ${portId}`);
  const redundant = opts.redundant ?? false;
  const stroke = tiles.filter((t) => inBounds(w, t));
  const keys = new Set(stroke.map(tkey));
  const idx = w.dataRuns.findIndex((d) => d.portId === portId && d.redundant === redundant);
  const cur = idx >= 0 ? w.dataRuns[idx].tileChain : [];
  let chain: [number, number][];
  if (mode === "remove") chain = cur.filter((t) => !keys.has(tkey(t)));
  else if (mode === "set") chain = dedupe(stroke);
  else chain = dedupe([...cur, ...stroke]);
  const mine = new Set(chain.map(tkey));
  const runs: DataRun[] = w.dataRuns
    .map((d, i) => (i === idx ? null : d.redundant === redundant ? { ...d, tileChain: d.tileChain.filter((t) => !mine.has(tkey(t))) } : d))
    .filter((d): d is DataRun => !!d && (d.tileChain.length > 0 || d.redundant !== redundant));
  if (chain.length) {
    const run: DataRun = { portId, tileChain: chain, redundant };
    if (idx >= 0) runs.splice(Math.min(idx, runs.length), 0, run); else runs.push(run);
  }
  const same = runs.length === w.dataRuns.length && runs.every((d, i) => d.portId === w.dataRuns[i].portId && d.redundant === w.dataRuns[i].redundant && d.tileChain.length === w.dataRuns[i].tileChain.length && d.tileChain.every((t, j) => tkey(t) === tkey(w.dataRuns[i].tileChain[j])));
  return same ? [] : [{ op: "replace", path: `${wallPath(w)}/dataRuns`, value: runs }];
}

function dedupe(ts: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const t of ts) { const k = tkey(t); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

/** Drops every run (primary and backup) on a port. */
export function clearPort(r: ShowRecord, wallId: string, portId: string): Patch[] {
  const w = findWall(r, wallId);
  const runs = w.dataRuns.filter((d) => d.portId !== portId);
  return runs.length === w.dataRuns.length ? [] : [{ op: "replace", path: `${wallPath(w)}/dataRuns`, value: runs }];
}

/** Data flow a wall's runs imply: SX40 → XD jumpers and XD port → tile counts, for the Pixel & Patch flow strip and Signal Flow legs. */
export interface LedLeg { fromDeviceId: string; toDeviceId: string | null; toWallId: string | null; label: string; short: string; ports: string[]; tiles: number; px: number; cableId?: string }
export function ledLegs(r: ShowRecord, w: Wall): LedLeg[] {
  const g = wallGeometry(r, w);
  const tilePx = g.tile.px_w * g.tile.px_h;
  const legs: LedLeg[] = [];
  const byDevice = new Map<string, { ports: string[]; tiles: number }>();
  for (const run of w.dataRuns) {
    if (run.redundant) continue;
    const o = portOwner(r, run.portId);
    if (!o) continue;
    const e = byDevice.get(o.device.id) ?? { ports: [], tiles: 0 };
    e.ports.push(portPatchLabel(r, w, run.portId));
    e.tiles += run.tileChain.filter((t) => inBounds(w, t)).length;
    byDevice.set(o.device.id, e);
  }
  for (const [devId, e] of byDevice) {
    const label = `${e.ports.length} run${e.ports.length === 1 ? "" : "s"} · ${fmt(e.tiles)} tiles`;
    legs.push({ fromDeviceId: devId, toDeviceId: null, toWallId: w.id, label, short: `${e.ports.join(" ")} · ${fmt(e.tiles)} tiles`, ports: e.ports, tiles: e.tiles, px: e.tiles * tilePx });
  }
  const procs = new Set(w.processorIds);
  for (const c of r.cables) {
    if (c.type !== "fiberLED" || !c.fromPort || !c.toPort) continue;
    const a = portOwner(r, c.fromPort), b = portOwner(r, c.toPort);
    if (!a || !b || (!procs.has(a.device.id) && !procs.has(b.device.id))) continue;
    legs.push({ fromDeviceId: a.device.id, toDeviceId: b.device.id, toWallId: null, label: `${c.label} · ${a.port.name} → ${b.port.name}`, short: c.label, ports: [a.port.name], tiles: 0, px: 0, cableId: c.id });
  }
  return legs;
}

// ---------------- validate ----------------
function confirmedNumber(c: { value: number | null; state: string } | undefined): number | null {
  return c && c.value != null && (c.state === "confirmed" || c.state === "assumed") ? Number(c.value) : null;
}

function tplPath(g: WallGeometry, w: Wall): string {
  return g.tile.templateId ? `library:${g.tile.templateId}.spec` : `${wallPath(w)}/tileModel`;
}

export function validateLed(r: ShowRecord, ctx?: Partial<ValidateContext>): CheckDraft[] {
  const out: CheckDraft[] = [];
  const canvas = r.led.canvas;
  const rects: { w: Wall; x: number; y: number; wpx: number; hpx: number; mi: number }[] = [];
  const geo = new Map(r.led.walls.map((w) => [w.id, wallGeometry(r, w)]));

  for (const w of r.led.walls) {
    const g = geo.get(w.id)!;
    const tn = g.tile.label;
    const wp = wallPath(w);
    const tilePx = g.tile.px_w * g.tile.px_h;

    // LED-006 processor unassigned
    if (g.tiles > 0 && w.processorIds.length === 0) {
      out.push({
        code: "LED-006", severity: "block", title: "Processor unassigned", target: w.id, involved: [w.id],
        message: `${w.name} has ${fmt(g.tiles)} ${tn} tiles but no processor driving it.`,
        rule: `A wall with tiles needs at least one processor; ${w.name} has ${fmt(g.tiles)} tiles and 0 processors (needs ${g.portsNeeded} data ports at ${fmt(g.pxPerPort)} px per port).`,
        evidence: [
          { label: `${w.name} processors`, value: "none", path: `${wp}/processorIds` },
          { label: `${w.name} tiles`, value: `${w.cols} × ${w.rows} = ${fmt(g.tiles)}`, path: `${wp}/cols` },
          { label: "Data ports needed", value: String(g.portsNeeded), path: `/derived/led/perWall/${w.id}/portsNeeded` },
        ],
        fixes: [
          { label: `Add processors for ${w.name} (auto: ${g.portsNeeded} data ports)`, module: "led" },
          ...(r.devices.some((d) => d.class === "processor") ? [{ label: `Assign an existing processor to ${w.name}`, module: "led" as const }] : []),
        ],
      });
    }

    // LED-001 port capacity, per data run
    w.dataRuns.forEach((run, i) => {
      const n = run.tileChain.filter((t) => inBounds(w, t)).length;
      const px = n * tilePx;
      const cap = portCapacity(r, run.portId);
      if (!n || px <= cap.px) return;
      const per = Math.max(1, Math.floor(cap.px / Math.max(1, tilePx)));
      const k = Math.ceil(n / per);
      const split = splitRun(r, w.id, i);
      const rebalance = autoSplitRuns(r, w.id);
      const capPath = cap.device ? (cap.device.spec?.pxPerPort8bit != null ? `/devices/${cap.device.id}/spec/pxPerPort8bit` : `library:${cap.device.templateId ?? "processor"}.spec.pxPerPort8bit`) : "default";
      out.push({
        code: "LED-001", severity: "block", title: "Port capacity", target: run.portId || w.id,
        involved: [w.id, run.portId, ...(cap.device ? [cap.device.id] : [])].filter(Boolean),
        message: `${w.name} data run ${i + 1} drives ${fmt(n)} ${tn} tiles (${fmt(px)} px) on ${portLabel(r, run.portId)}, rated for ${fmt(cap.px)} px.`,
        rule: `tiles × ${g.tile.px_w} × ${g.tile.px_h} must be ≤ the port's pixel capacity; ${fmt(px)} > ${fmt(cap.px)}.`,
        evidence: [
          { label: `Run ${i + 1} tile chain`, value: `${fmt(n)} tiles`, path: `${wp}/dataRuns/${i}` },
          { label: `${tn} pixels per tile`, value: `${g.tile.px_w}×${g.tile.px_h} px`, path: tplPath(g, w) },
          { label: `${portLabel(r, run.portId)} capacity`, value: `${fmt(cap.px)} px${cap.port?.type === "fiberLED" ? ` (10G = ${PORTS_PER_10G}× 1G)` : ""}`, path: capPath },
        ],
        fixes: [
          { label: `Split run ${i + 1} into ${k} runs of ≤ ${per} tiles (auto-split)`, module: "led", ...(split.length ? { patch: split } : {}) },
          { label: `Re-balance all ${w.name} runs to ≤ ${per} tiles each`, module: "led", ...(rebalance.length ? { patch: rebalance } : {}) },
        ],
      });
    });

    // LED-003 unmapped tiles
    if (g.tiles > 0) {
      const data = uniqueTiles(w, w.dataRuns.map((d) => d.tileChain)).size;
      const power = uniqueTiles(w, w.power.circuits.map((c) => c.tiles)).size;
      const noData = g.tiles - data;
      const noPower = g.tiles - power;
      if (noData > 0 || noPower > 0) {
        const parts = [noData > 0 ? `${fmt(noData)} of ${fmt(g.tiles)} tiles have no data run` : "", noPower > 0 ? `${fmt(noPower)} of ${fmt(g.tiles)} have no circuit` : ""].filter(Boolean);
        const runs = autoSplitRuns(r, w.id);
        const ckts = autoCircuits(r, w.id);
        out.push({
          code: "LED-003", severity: "info", title: "Unmapped tiles", target: w.id, involved: [w.id],
          message: `${w.name}: ${parts.join(" and ")}.`,
          rule: `Every tile needs a data run and a circuit; mapped to data ${fmt(data)} / ${fmt(g.tiles)}, to power ${fmt(power)} / ${fmt(g.tiles)}.`,
          evidence: [
            { label: `${w.name} data runs`, value: `${w.dataRuns.length} runs, ${fmt(data)} tiles mapped`, path: `${wp}/dataRuns` },
            { label: `${w.name} circuits`, value: `${w.power.circuits.length} circuits, ${fmt(power)} tiles mapped`, path: `${wp}/power/circuits` },
            { label: `${w.name} tiles`, value: `${w.cols} × ${w.rows} = ${fmt(g.tiles)}`, path: `${wp}/cols` },
          ],
          fixes: [
            ...(noData > 0 ? [{ label: `Auto-map ${w.name} data runs in snake order`, module: "led" as const, ...(runs.length ? { patch: runs } : {}) }] : []),
            ...(noPower > 0 ? [{ label: `Auto-split ${w.name} tiles onto ${CIRCUIT_AMPS} A circuits`, module: "led" as const, ...(ckts.length ? { patch: ckts } : {}) }] : []),
          ],
        });
      }
    }

    // LED-002 circuit over 80 %
    const volts = circuitVolts(w.power.phase);
    for (const c of w.power.circuits) {
      const n = uniqueTiles(w, [c.tiles]).size;
      const loadW = n * g.tile.maxW;
      const limit = CIRCUIT_LIMIT * c.amps * volts;
      if (loadW <= limit) continue;
      const label = circuitLabel(r, w, c.id);
      const pct = round((loadW / (c.amps * volts)) * 100, 0);
      const fit = g.tile.maxW > 0 ? Math.floor(limit / g.tile.maxW) : 0;
      out.push({
        code: "LED-002", severity: "warn", title: "Circuit over 80%", target: c.id, involved: [c.id, w.id],
        message: `Circuit ${label} on ${w.name} carries ${n} ${tn} tiles at ${fmt(loadW)} W max — ${pct}% of a ${c.amps} A circuit.`,
        rule: `Σ tile max W must be ≤ 80% of rated: ${n} × ${g.tile.maxW} W = ${fmt(loadW)} W > 0.8 × ${c.amps} A × ${volts} V = ${fmt(limit)} W.`,
        evidence: [
          { label: `${label} load`, value: `${fmt(loadW)} W (${n} tiles)`, path: `${wp}/power/circuits/${c.id}` },
          { label: `${label} rating`, value: `${c.amps} A × ${volts} V × 0.8 = ${fmt(limit)} W`, path: `${wp}/power/circuits/${c.id}/amps` },
          { label: `${tn} max W`, value: `${g.tile.maxW} W`, path: tplPath(g, w) },
        ],
        fixes: [
          { label: `Move tiles so ${label} holds ≤ ${fit} tiles`, module: "led" },
          { label: `Re-split ${w.name} onto ${CIRCUIT_AMPS} A circuits (auto)`, module: "led" },
        ],
      });
    }

    // LED-005 missing redundant run
    if (ctx?.profile?.redundancyExpected && g.tiles > 0 && !w.dataRuns.some((d) => d.redundant)) {
      const red = autoSplitRuns(r, w.id, undefined, { redundant: true });
      out.push({
        code: "LED-005", severity: "warn", title: "Missing redundant run", target: w.id, involved: [w.id],
        message: `${w.name} has no redundant data run, but this ${ctx.profile.type} show expects redundant LED data.`,
        rule: `Profile expects redundant data; ${w.name} has ${w.dataRuns.length} runs and 0 marked redundant (needs ${g.portsNeeded * 2} ports with backup).`,
        evidence: [
          { label: `${w.name} redundant runs`, value: "0", path: `${wp}/dataRuns` },
          { label: "Profile redundancy expected", value: "yes", path: `profile:${ctx.profile.type}.redundancyExpected` },
        ],
        fixes: [{ label: `Add a backup run for every ${w.name} run`, module: "led", ...(red.length ? { patch: red } : {}) }],
      });
    }

    // LED-007 design trim above venue max
    const maxTrim = confirmedNumber(r.event.rigging?.maxTrim_ft as { value: number | null; state: string });
    if (maxTrim != null && w.trimHeight_ft > maxTrim) {
      out.push({
        code: "LED-007", severity: "warn", title: "Trim above venue max", target: w.id, involved: [w.id],
        message: `${w.name} is designed to trim at ${w.trimHeight_ft} ft, above the venue's ${maxTrim} ft maximum.`,
        rule: `Design trim must be ≤ venue max trim; ${w.trimHeight_ft} ft > ${maxTrim} ft (${r.event.rigging.maxTrim_ft.state}).`,
        evidence: [
          { label: `${w.name} trim`, value: `${w.trimHeight_ft} ft`, path: `${wp}/trimHeight_ft` },
          { label: "Venue max trim", value: `${maxTrim} ft (${r.event.rigging.maxTrim_ft.state})`, path: "/event/rigging/maxTrim_ft" },
        ],
        fixes: [
          { label: `Lower ${w.name} trim to ${maxTrim} ft`, module: "led", patch: [{ op: "replace", path: `${wp}/trimHeight_ft`, value: maxTrim }] },
          { label: "Re-confirm max trim with the venue", module: "shell" },
        ],
      });
    }

    // LED-008 point capacity exceeded
    if (w.rigging.type !== "ground" && g.tiles > 0) {
      const pc = r.event.rigging?.pointCapacity_lb;
      let cap = pc && pc.value != null ? Number(pc.value) : null;
      let capPath = "/event/rigging/pointCapacity_lb";
      const pts = r.event.rigging?.points?.value;
      if (cap == null && Array.isArray(pts) && pts.length) {
        cap = Math.min(...pts.map((p) => p.capacity_lb));
        capPath = "/event/rigging/points";
      }
      if (cap != null && cap > 0) {
        const points = Math.max(1, w.rigging.headers);
        const total = cap * points;
        if (g.weightLb > total) {
          out.push({
            code: "LED-008", severity: "block", title: "Point capacity exceeded", target: w.id, involved: [w.id],
            message: `${w.name} weighs ${fmt(g.weightLb)} lb with headers, more than its ${points} points can hold at ${fmt(cap)} lb each.`,
            rule: `Wall + headers must be ≤ point capacity × points; ${fmt(g.panelWeightLb)} lb + ${fmt(g.headerWeightLb)} lb headers = ${fmt(g.weightLb)} lb > ${fmt(cap)} lb × ${points} = ${fmt(total)} lb.`,
            evidence: [
              { label: `${w.name} weight with headers`, value: `${fmt(g.weightLb)} lb`, path: `/derived/led/perWall/${w.id}/weightLb` },
              { label: "Point capacity", value: `${fmt(cap)} lb`, path: capPath },
              { label: `${w.name} headers`, value: String(w.rigging.headers), path: `${wp}/rigging/headers` },
            ],
            fixes: [
              { label: `Add headers / points so each carries ≤ ${fmt(cap)} lb (${Math.ceil(g.weightLb / cap)} needed)`, module: "led" },
              { label: `Ground-stack ${w.name} or reduce its size`, module: "led" },
            ],
          });
        }
      }
    }

    const mi = canvas.mappings.findIndex((m) => m.wallId === w.id);
    if (mi >= 0) rects.push({ w, x: canvas.mappings[mi].x, y: canvas.mappings[mi].y, wpx: g.w_px, hpx: g.h_px, mi });
    else if (g.tiles > 0) {
      out.push({
        code: "LED-004", severity: "warn", title: "Canvas gap", target: w.id, involved: [w.id],
        message: `${w.name} is not placed on the LED canvas.`,
        rule: `Every wall with tiles needs a canvas mapping; ${w.name} (${fmt(g.w_px)}×${fmt(g.h_px)} px) has none.`,
        evidence: [{ label: "Canvas mappings", value: `${canvas.mappings.length} walls mapped`, path: "/led/canvas/mappings" }],
        fixes: [{ label: "Lay walls out side by side on the canvas", module: "led", patch: setCanvas(r) }],
      });
    }
  }

  // LED-004 off canvas / overlap
  for (const a of rects) {
    if (a.wpx === 0 || a.hpx === 0) continue;
    const reasons: string[] = [];
    const ev: CheckDraft["evidence"] = [
      { label: `${a.w.name} mapping`, value: `${fmt(a.wpx)}×${fmt(a.hpx)} px at (${a.x}, ${a.y})`, path: `/led/canvas/mappings/${a.mi}` },
      { label: "Canvas", value: `${fmt(canvas.w_px)}×${fmt(canvas.h_px)} px`, path: "/led/canvas" },
    ];
    if (a.x < 0 || a.y < 0 || a.x + a.wpx > canvas.w_px || a.y + a.hpx > canvas.h_px)
      reasons.push(`extends to (${fmt(a.x + a.wpx)}, ${fmt(a.y + a.hpx)}) on a ${fmt(canvas.w_px)}×${fmt(canvas.h_px)} canvas`);
    for (const b of rects) {
      if (b === a || b.wpx === 0 || b.hpx === 0) continue;
      if (a.x < b.x + b.wpx && b.x < a.x + a.wpx && a.y < b.y + b.hpx && b.y < a.y + a.hpx) {
        reasons.push(`overlaps ${b.w.name}`);
        ev.push({ label: `${b.w.name} mapping`, value: `${fmt(b.wpx)}×${fmt(b.hpx)} px at (${b.x}, ${b.y})`, path: `/led/canvas/mappings/${b.mi}` });
      }
    }
    if (!reasons.length) continue;
    out.push({
      code: "LED-004", severity: "warn", title: "Canvas gap", target: a.w.id, involved: [a.w.id, ...rects.filter((b) => b !== a).map((b) => b.w.id)],
      message: `${a.w.name} ${reasons.join(" and ")}.`,
      rule: `A wall's ${fmt(a.wpx)}×${fmt(a.hpx)} px must sit inside the canvas without overlapping another wall.`,
      evidence: ev,
      fixes: [{ label: "Lay walls out side by side and resize the canvas", module: "led", patch: setCanvas(r) }],
    });
  }
  return out;
}

// ---------------- seed ----------------
/** Blank-show defaults: one wall (US Wall, ROE CB5, 0×0), PROC-1 (SX40) + XD-1, one 3Ø distro. Idempotent. */
export function seedLed(r: ShowRecord, ctx: Pick<SeedContext, "newId">): Patch[] {
  const out: Patch[] = [];
  const labels = new Set(r.devices.map((d) => d.label));
  const mk = (tplId: string, prefix: string, sep = "-") => {
    const d = instantiate(library.get(tplId)!, nextLabel(labels, prefix, 1, { sep }), ctx.newId);
    labels.add(d.label);
    out.push({ op: "add", path: "/devices/-", value: d });
    return d;
  };
  let procIds: string[] = [];
  if (!r.devices.some((d) => d.class === "processor")) {
    const p = mk("tpl_brompton_sx40", "PROC");
    const x = mk("tpl_brompton_xd", "XD");
    procIds = [p.id, x.id];
    const out10 = p.ports.find((q) => q.type === "fiberLED" && q.dir === "out");
    const in10 = x.ports.find((q) => q.type === "fiberLED" && q.dir === "in");
    if (out10 && in10) {
      const cable: Cable = { id: ctx.newId("cab"), type: "fiberLED", length_ft: 10, fromPort: out10.id, toPort: in10.id, label: nextLabel(r.cables.map((c) => c.label), "LED", 1, { pad: 3 }), redundancyGroup: null };
      out.push({ op: "add", path: "/cables/-", value: cable });
    }
  }
  let distroId: string | null = null;
  if (!r.devices.some((d) => d.class === "distro")) distroId = mk("tpl_motionlabs_200a", "LED DISTRO", " ").id;
  if (!r.led.walls.length) {
    const t = library.get("tpl_roe_cb5")!;
    const s = t.spec as Record<string, number>;
    const wall: Wall = {
      id: ctx.newId("wall"), name: "US Wall", tileModel: "ROE CB5", templateId: t.templateId, cols: 0, rows: 0,
      tileW_mm: s.w_mm, tileH_mm: s.h_mm, pitch_mm: s.pitch_mm, trimHeight_ft: 0, position: "upstage",
      rigging: { type: "flown", headers: 0, points: [] }, processorIds: procIds, dataRuns: [],
      power: { phase: "3Ø", circuits: [], distroId },
    };
    out.push({ op: "add", path: "/led/walls/-", value: wall });
    out.push({ op: "replace", path: "/led/canvas", value: { w_px: 0, h_px: 0, mappings: [...r.led.canvas.mappings, { wallId: wall.id, x: 0, y: 0 }] } });
  }
  return out;
}

// ---------------- exports ----------------
export function renderLedSummary(r: ShowRecord): string {
  const rows = r.led.walls.map((w) => {
    const g = wallGeometry(r, w);
    return [w.name, g.tile.label, w.cols, w.rows, g.tiles, g.w_px, g.h_px, g.w_ft, g.h_ft, g.maxW, g.avgW, g.weightLb, g.portsNeeded,
      w.processorIds.map((id) => deviceById(r, id)?.label ?? id).join(" "), g.approximate ? "≈" : ""];
  });
  return toCsv(["Wall", "Tile", "Cols", "Rows", "Tiles", "W px", "H px", "W ft", "H ft", "Max W", "Avg W", "Weight lb", "Data ports", "Processors", "Approx"], rows);
}

export function renderPowerByCircuit(r: ShowRecord): string {
  const rows: unknown[][] = [];
  for (const w of r.led.walls) {
    const g = wallGeometry(r, w);
    const v = circuitVolts(w.power.phase);
    for (const c of w.power.circuits) {
      const n = uniqueTiles(w, [c.tiles]).size;
      const loadW = n * g.tile.maxW;
      rows.push([w.name, circuitLabel(r, w, c.id), deviceById(r, w.power.distroId)?.label ?? "", c.amps, v, n, loadW, round(loadW / v), c.amps ? round((loadW / v / c.amps) * 100, 1) : 0]);
    }
  }
  return toCsv(["Wall", "Circuit", "Distro", "Amps", "Volts", "Tiles", "Load W", "Load A", "% of rated"], rows);
}

export const ledModule: ModuleContract = {
  id: "led",
  version: "1.0.0",
  owns: ["/led"],
  reads: ["/led", "/devices", "/racks", "/servers/content", "/event/rigging", "/event/power"],
  deviceClasses: ["tile", "processor", "distro", "ledPdu"],
  cableTypes: ["etherCon", "fiberLED", "tilePower"],
  seed: (record, ctx) => seedLed(record, ctx),
  derive: (record) => deriveLed(record),
  validate: (record, ctx) => validateLed(record, ctx),
  exports: [
    { key: "led-summary", label: "LED summary", mime: "text/csv", render: renderLedSummary },
    { key: "power-by-circuit", label: "Power by circuit", mime: "text/csv", render: renderPowerByCircuit },
  ],
};

export { MM_TO_FT };
