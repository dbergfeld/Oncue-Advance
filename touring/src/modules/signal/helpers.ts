// Patch builders for the Signal Flow UI. Every function is pure: it returns Patch[] that the caller applies
// as the 'signal' writer. Signal never writes /servers or /led — it only reads them to decide what to wire.
import { instantiate, library as defaultLibrary } from "../../library/library";
import { cableOwner } from "../../store/ownership";
import type {
  Cable, CableType, Device, DeviceClass, DeviceTemplate, IdPrefix, LibraryLookup, Patch, Port, PortType, RedundancyGroup, ShowRecord, SignalLink, SignalNode,
} from "../../store/types";
import { buildGraph, deviceOutputFormat, formatRule, resolveFormats, specResolver } from "./graph";
import { jumperLength, nextCableLabel, positionOf, shortestPathChain } from "./physical";
import { canSink, canSource, compatible, isVideoPort, roundStock } from "./portRules";

type NewId = (prefix: IdPrefix) => string;

export const SIGNAL_CLASSES: DeviceClass[] = ["camera", "ccu", "switcher", "router", "converter", "recorder", "monitor", "fiber", "patchPanel"];

export interface ConnectOpts { format?: string; path?: "A" | "B"; label?: string; length_ft?: number; cableType?: CableType }

function portIndex(record: ShowRecord): Map<string, { port: Port; device: Device }> {
  const m = new Map<string, { port: Port; device: Device }>();
  for (const d of record.devices) for (const p of d.ports ?? []) m.set(p.id, { port: p, device: d });
  return m;
}

const ROLE: Partial<Record<DeviceClass, SignalNode["role"]>> = {
  camera: "source", ccu: "source", server: "source", capture: "source", switcher: "switcher", router: "router", converter: "router",
  fiber: "router", patchPanel: "router", processor: "processor", recorder: "record", monitor: "monitor", tile: "sink",
};
const COLUMN_X: Record<SignalNode["role"], number> = { source: 100, switcher: 300, router: 500, processor: 700, record: 900, monitor: 900, sink: 1100 };

/** Node patches for devices that have no node yet (placed in role columns). */
export function nodePatches(record: ShowRecord, devices: Device[], newId: NewId, pending: SignalNode[] = []): Patch[] {
  const ops: Patch[] = [];
  const have = new Set([...record.signal.nodes, ...pending].map((n) => n.deviceId));
  const all = [...record.signal.nodes, ...pending];
  for (const d of devices) {
    if (have.has(d.id)) continue;
    const role = ROLE[d.class] ?? "sink";
    const inCol = all.filter((n) => n.role === role).length;
    const node: SignalNode = { id: newId("sig"), deviceId: d.id, role, x: COLUMN_X[role], y: 100 + inCol * 120 };
    all.push(node);
    have.add(d.id);
    ops.push({ op: "add", path: "/signal/nodes/-", value: node });
  }
  return ops;
}

const FALLBACK_CABLE: [RegExp, CableType][] = [[/fiberLED/, "fiberLED"], [/etherCon/, "etherCon"], [/AC-|DC-/, "power"], [/SDI/, "SDI"], [/HDMI|DVI/, "HDMI"], [/DP/, "DP"], [/SMPTE/, "SMPTE-311"], [/fiber/, "fiber"], [/cat6/, "cat6"], [/genlock/, "BNC-ref"], [/LTC/, "audio-TRS"], [/tally/, "tally"], [/intercom/, "comms"]];
function pickCableType(from: PortType, to: PortType): CableType {
  const c = compatible(from, to);
  if (c) return c.cableType;
  return FALLBACK_CABLE.find(([re]) => re.test(from))?.[1] ?? "SDI";
}

/** Default planned length: path run or in-position jumper, rounded to stock; 10 ft when positions are unknown. */
export function defaultLength(record: ShowRecord, a: Device, b: Device, type: CableType): number {
  const pa = positionOf(record, a);
  const pb = positionOf(record, b);
  let derived = 10;
  if (pa && pb && pa === pb) derived = jumperLength(a, b);
  else if (pa && pb) {
    const chain = shortestPathChain(record, pa, pb);
    const len = chain?.reduce((s, id) => s + (record.physical.paths.find((p) => p.id === id)?.length_ft.value ?? NaN), 0);
    if (len != null && Number.isFinite(len)) derived = len * 1.15 + 10;
  } else if (a.rackId && a.rackId === b.rackId) derived = 6;
  return roundStock(type, derived, record.physical.stock).stock;
}

/** Format a new link off `fromPortId` would carry: pass-through devices inherit, converting devices emit their own. */
export function sourceFormat(record: ShowRecord, fromPortId: string, lib: LibraryLookup | null = defaultLibrary): { format: string; inherited: boolean } {
  const g = buildGraph(record, specResolver(lib));
  const ref = g.ports.get(fromPortId);
  if (!ref) return { format: record.signal.formats.house || "", inherited: false };
  const d = ref.device;
  const rule = formatRule(d, g.specOf(d));
  if (rule === "pass") {
    const resolved = resolveFormats(g);
    const up = (g.inbound.get(d.id) ?? []).map((e) => (e.link ? resolved.get(e.link.id)?.format : undefined)).find(Boolean);
    if (up) return { format: up, inherited: true };
  }
  return { format: deviceOutputFormat(g, d, fromPortId) ?? record.signal.formats.house ?? "", inherited: false };
}

/**
 * Cable `fromPortId → toPortId` with the cable type picked from the port matrix, plus its link and a node
 * for each device that has none. A reversed pair (in → out) is swapped. Throws when a port is missing,
 * neither direction is valid, or the cable type is LED-owned (Signal cannot create it).
 */
export function connect(record: ShowRecord, fromPortId: string, toPortId: string, opts: ConnectOpts = {}, newId: NewId, pending: { cables?: Cable[]; nodes?: SignalNode[] } = {}): Patch[] {
  const idx = portIndex(record);
  let from = idx.get(fromPortId);
  let to = idx.get(toPortId);
  if (!from || !to) throw new Error(`connect: port ${!from ? fromPortId : toPortId} not found`);
  if (!(canSource(from.port.dir) && canSink(to.port.dir))) {
    if (canSource(to.port.dir) && canSink(from.port.dir)) [from, to] = [to, from];
    else throw new Error(`connect: ${from.device.label} ${from.port.name} (${from.port.dir}) cannot feed ${to.device.label} ${to.port.name} (${to.port.dir})`);
  }
  const type = opts.cableType ?? pickCableType(from.port.type, to.port.type);
  if (cableOwner(type) !== "signal") throw new Error(`connect: ${type} cables belong to LED Map & Power`);
  const extraLabels = (pending.cables ?? []).map((c) => c.label);
  const label = `${nextCableLabel(record, type, extraLabels)}${opts.path ? `-${opts.path}` : ""}`;
  const cable: Cable = {
    id: newId("cab"), type, length_ft: opts.length_ft ?? defaultLength(record, from.device, to.device, type),
    fromPort: from.port.id, toPort: to.port.id, label, redundancyGroup: opts.path ?? null,
  };
  const src = opts.format ? { format: opts.format, inherited: false } : sourceFormat(record, from.port.id);
  const link: SignalLink = {
    id: newId("lnk"), cableId: cable.id, format: src.format, path: opts.path ?? "A",
    label: opts.label ?? (/PGM/i.test(from.port.name) ? "PGM" : `${from.device.label} → ${to.device.label}`),
  };
  if (src.inherited) link.inherited = true;
  pending.cables?.push(cable);
  return [
    { op: "add", path: "/cables/-", value: cable },
    { op: "add", path: "/signal/links/-", value: link },
    ...nodePatches(record, [from.device, to.device], newId, pending.nodes),
  ];
}

/** Remove a link, its cable, and the link from any redundancy group. */
export function disconnect(record: ShowRecord, linkId: string): Patch[] {
  const l = record.signal.links.find((x) => x.id === linkId);
  if (!l) return [];
  const ops: Patch[] = [];
  for (const g of record.signal.redundancy) {
    if (g.primary.includes(linkId) || g.backup.includes(linkId))
      ops.push({ op: "replace", path: `/signal/redundancy/${g.id}`, value: { ...g, primary: g.primary.filter((x) => x !== linkId), backup: g.backup.filter((x) => x !== linkId) } });
  }
  ops.push({ op: "remove", path: `/signal/links/${linkId}` });
  const c = record.cables.find((x) => x.id === l.cableId);
  if (c && cableOwner(c.type) === "signal") ops.push(...removeCablePatches(record, c, new Set([linkId])));
  return ops;
}

/** Remove a cable plus anything that would dangle: other links on it, trunk listing, jack landings. */
export function removeCablePatches(record: ShowRecord, c: Cable, alreadyRemovedLinks = new Set<string>()): Patch[] {
  const ops: Patch[] = [];
  for (const l of record.signal.links) {
    if (l.cableId !== c.id || alreadyRemovedLinks.has(l.id)) continue;
    for (const g of record.signal.redundancy) if (g.primary.includes(l.id) || g.backup.includes(l.id))
      ops.push({ op: "replace", path: `/signal/redundancy/${g.id}`, value: { ...g, primary: g.primary.filter((x) => x !== l.id), backup: g.backup.filter((x) => x !== l.id) } });
    ops.push({ op: "remove", path: `/signal/links/${l.id}` });
  }
  for (const d of record.devices) {
    if (d.class !== "patchPanel") continue;
    const jacks = (d.spec?.jacks as { id: string; front: { cableId: string | null }; rear: { cableId: string | null } }[] | undefined) ?? [];
    for (const j of jacks) if (j.front?.cableId === c.id || j.rear?.cableId === c.id)
      ops.push({ op: "replace", path: `/devices/${d.id}/spec/jacks/${j.id}`, value: { ...j, front: { cableId: j.front.cableId === c.id ? null : j.front.cableId }, rear: { cableId: j.rear.cableId === c.id ? null : j.rear.cableId } } });
  }
  const ti = record.physical.trunks.indexOf(c.id);
  if (ti >= 0) ops.push({ op: "remove", path: `/physical/trunks/${ti}` });
  ops.push({ op: "remove", path: `/cables/${c.id}` });
  return ops;
}

function uniqueLabel(record: ShowRecord, wanted: string, pending: string[] = []): string {
  const used = new Set([...record.devices.map((d) => d.label.toLowerCase()), ...pending.map((l) => l.toLowerCase())]);
  if (!used.has(wanted.toLowerCase())) return wanted;
  for (let i = 2; ; i++) if (!used.has(`${wanted} ${i}`.toLowerCase())) return `${wanted} ${i}`;
}

/**
 * Instantiate a signal-class template as a new device with a node. A camera whose spec says `ccuRequired`
 * also gets its CCU (spec.ccuTemplateId) and the SMPTE-311 cable + link joining them, in the same patch.
 */
export function addSignalDevice(record: ShowRecord, templateId: string, label: string, newId: NewId, lib: LibraryLookup = defaultLibrary): Patch[] {
  const t = lib.get(templateId);
  if (!t) throw new Error(`addSignalDevice: no template ${templateId}`);
  if (!SIGNAL_CLASSES.includes(t.class)) throw new Error(`addSignalDevice: ${t.class} devices belong to another module`);
  const dev = instantiate(t, label, newId);
  const ops: Patch[] = [{ op: "add", path: "/devices/-", value: dev }];
  const devices = [dev];
  const spec = (t.spec ?? {}) as Record<string, unknown>;
  const ccuId = typeof spec.ccuTemplateId === "string" ? spec.ccuTemplateId : typeof spec.ccuRequired === "string" ? spec.ccuRequired : typeof spec.ccu === "string" ? spec.ccu : null;
  if (t.class === "camera" && spec.ccuRequired && ccuId) {
    const ct = lib.get(ccuId);
    if (ct) {
      const ccu = instantiate(ct, uniqueLabel(record, `${label} CCU`, [label]), newId);
      devices.push(ccu);
      ops.push({ op: "add", path: "/devices/-", value: ccu });
      const camPort = dev.ports.find((p) => p.type === "fiber-SMPTE");
      const ccuPort = ccu.ports.find((p) => p.type === "fiber-SMPTE");
      if (camPort && ccuPort) {
        const cable: Cable = { id: newId("cab"), type: "SMPTE-311", length_ft: 328, fromPort: camPort.id, toPort: ccuPort.id, label: nextCableLabel(record, "SMPTE-311"), redundancyGroup: null };
        const fmt = Array.isArray(spec.formats) && typeof spec.formats[0] === "string" ? (spec.formats[0] as string) : record.signal.formats.house || "1080p59.94";
        ops.push({ op: "add", path: "/cables/-", value: cable });
        ops.push({ op: "add", path: "/signal/links/-", value: { id: newId("lnk"), cableId: cable.id, format: fmt, path: "A", label: `${label} SMPTE` } satisfies SignalLink });
      }
    }
  }
  ops.push(...nodePatches(record, devices, newId));
  return ops;
}

/** Name a redundancy group; primary links go on path A and backup on B (links and signal-owned cables). */
export function addRedundancyGroup(record: ShowRecord, name: string, primary: string[], backup: string[], newId: NewId): Patch[] {
  const grp: RedundancyGroup = { id: newId("rg"), name, primary: [...primary], backup: [...backup] };
  const ops: Patch[] = [{ op: "add", path: "/signal/redundancy/-", value: grp }];
  const mark = (ids: string[], ab: "A" | "B") => {
    for (const id of ids) {
      const l = record.signal.links.find((x) => x.id === id);
      if (!l) continue;
      if (l.path !== ab) ops.push({ op: "replace", path: `/signal/links/${id}/path`, value: ab });
      const c = record.cables.find((x) => x.id === l.cableId);
      if (c && cableOwner(c.type) === "signal" && c.redundancyGroup !== ab) ops.push({ op: "replace", path: `/cables/${c.id}/redundancyGroup`, value: ab });
    }
  };
  mark(primary, "A");
  mark(backup, "B");
  return ops;
}

// ---------------- auto-patch ----------------
/** DP → HDMI active adapter (Port rules: "instantiated as a converter with ru: 0"); not in the library. */
export const DP_HDMI_ADAPTER: DeviceTemplate = {
  templateId: "tpl_generic_dp_hdmi_adapter", class: "converter", make: "Generic", model: "DP 1.4 to HDMI 2.0 active adapter", aliases: ["DP-HDMI"],
  ru: 0, powerW: 2, weightLb: 0.2, source: "approximate",
  ports: [{ name: "DP IN", type: "DP1.4", dir: "in", count: 1 }, { name: "HDMI OUT", type: "HDMI2.0", dir: "out", count: 1 }, { name: "USB PWR", type: "DC-in", dir: "in", count: 1 }],
  spec: { from: "DP1.4", to: "HDMI2.0", scaler: false, frameSync: false, poweredBy: "USB", formatRule: "pass-through", maxFormat: "2160p60" },
};

interface Hop { template: DeviceTemplate; inType: PortType; outType: PortType }

function converterTemplates(lib: LibraryLookup): DeviceTemplate[] {
  let found: DeviceTemplate[] = [];
  try { found = lib.find({ class: "converter" }); } catch { found = []; }
  const usable = found.filter((t) => !t.deprecated && t.ports.some((p) => p.dir === "in" && isVideoPort(p.type)) && t.ports.some((p) => p.dir === "out" && isVideoPort(p.type)));
  usable.sort((a, b) => Number(!!a.spec?.scaler) - Number(!!b.spec?.scaler) || a.powerW - b.powerW);
  return [DP_HDMI_ADAPTER, ...usable];
}

/** Shortest converter chain (≤ 2 hops) from an output port type to an input port type. [] = direct. */
export function converterChain(outType: PortType, inType: PortType, lib: LibraryLookup = defaultLibrary): Hop[] | null {
  const direct = compatible(outType, inType);
  if (direct && direct.cableType !== "DP-HDMI") return [];
  const convs = converterTemplates(lib);
  const hops = (state: PortType): Hop[] => {
    const out: Hop[] = [];
    for (const t of convs) {
      const ins = t.ports.filter((p) => p.dir === "in" && isVideoPort(p.type)).map((p) => p.type);
      const outs = t.ports.filter((p) => p.dir === "out" && isVideoPort(p.type)).map((p) => p.type);
      const inType2 = ins.find((i) => { const c = compatible(state, i); return c && c.cableType !== "DP-HDMI"; });
      if (!inType2) continue;
      for (const o of outs) out.push({ template: t, inType: inType2, outType: o });
    }
    return out;
  };
  const ok = (t: PortType) => { const c = compatible(t, inType); return !!c && c.cableType !== "DP-HDMI"; };
  for (const h of hops(outType)) if (ok(h.outType)) return [h];
  for (const h1 of hops(outType)) for (const h2 of hops(h1.outType)) if (ok(h2.outType)) return [h1, h2];
  return null;
}

/**
 * Wires the program path for the wizard: SW-1 PGM (then free SDI outs) → each server's input, and each server
 * output with feedsWallId → a free input on its wall's processor (A for master, B for backup / understudy),
 * inserting DP→HDMI adapters or library converters when the port types need them, and naming a
 * "PGM to <wall>" redundancy group when both sides land. Reads /servers and /led; writes only signal paths.
 */
export function autoPatchProgram(record: ShowRecord, newId: NewId, lib: LibraryLookup = defaultLibrary): Patch[] {
  const ops: Patch[] = [];
  const busy = new Set(record.cables.flatMap((c) => [c.fromPort, c.toPort]).filter((x): x is string => !!x));
  const devs = new Map(record.devices.map((d) => [d.id, d]));
  const pendingCables: Cable[] = [];
  const pendingNodes: SignalNode[] = [];
  const newDevices: Device[] = [];
  const pendingLabels: string[] = [];
  const recordWith = () => ({ ...record, devices: [...record.devices, ...newDevices], cables: [...record.cables, ...pendingCables] } as ShowRecord);
  const addOps = (o: Patch[]) => {
    for (const p of o) {
      ops.push(p);
      if (p.op === "add" && p.path === "/signal/nodes/-") pendingNodes.push(p.value as SignalNode);
      if (p.op === "add" && p.path === "/cables/-") { const c = p.value as Cable; if (c.fromPort) busy.add(c.fromPort); if (c.toPort) busy.add(c.toPort); }
    }
  };
  const linkIdsOf = (o: Patch[]) => o.flatMap((p) => (p.op === "add" && p.path === "/signal/links/-" ? [(p.value as SignalLink).id] : []));

  /** Cable from → to, inserting converters as needed. Returns the link ids created, or null. */
  const wire = (fromPort: Port, toPort: Port, opts: ConnectOpts): string[] | null => {
    const chain = converterChain(fromPort.type, toPort.type, lib);
    if (!chain) return null;
    const links: string[] = [];
    let curPort = fromPort;
    const fmt = opts.format ?? sourceFormat(record, fromPort.id, lib).format;
    for (const hop of chain) {
      const prefix = hop.template.templateId === DP_HDMI_ADAPTER.templateId ? "DPH" : "CNV";
      let n = 1;
      const used = new Set([...record.devices, ...newDevices].map((d) => d.label.toLowerCase()).concat(pendingLabels.map((l) => l.toLowerCase())));
      while (used.has(`${prefix}-${n}`.toLowerCase())) n++;
      const label = `${prefix}-${n}`;
      pendingLabels.push(label);
      const conv = instantiate(hop.template, label, newId);
      newDevices.push(conv);
      addOps([{ op: "add", path: "/devices/-", value: conv }]);
      const inP = conv.ports.find((p) => p.dir === "in" && p.type === hop.inType)!;
      const o = connect(recordWith(), curPort.id, inP.id, { ...opts, format: fmt, length_ft: opts.length_ft ?? 6 }, newId, { cables: pendingCables, nodes: pendingNodes });
      // connect() computed the label against recordWith(); keep it.
      addOps(o);
      links.push(...linkIdsOf(o));
      curPort = conv.ports.find((p) => p.dir === "out" && p.type === hop.outType)!;
    }
    const last = connect(recordWith(), curPort.id, toPort.id, { ...opts, format: fmt }, newId, { cables: pendingCables, nodes: pendingNodes });
    // A link leaving a converter is inherited from the converter's input.
    for (const p of last) if (p.op === "add" && p.path === "/signal/links/-" && chain.length) (p.value as SignalLink).inherited = true;
    addOps(last);
    links.push(...linkIdsOf(last));
    return links;
  };

  // 1. SW-1 PGM → each server input.
  const sw = record.devices.find((d) => d.class === "switcher" && d.label === "SW-1") ?? record.devices.find((d) => d.class === "switcher");
  if (sw) {
    const outs = sw.ports.filter((p) => p.dir === "out" && isVideoPort(p.type));
    const rank = (p: Port) => (/PGM/i.test(p.name) ? 0 : /AUX/i.test(p.name) ? 1 : 2);
    outs.sort((a, b) => rank(a) - rank(b));
    for (const h of record.servers.hosts) {
      const dev = devs.get(h.deviceId);
      if (!dev) continue;
      const declared = h.inputs.map((i) => dev.ports.find((p) => p.id === i.portId)).filter((p): p is Port => !!p);
      const candidates = declared.length ? declared : dev.ports.filter((p) => p.dir === "in" && isVideoPort(p.type));
      if (candidates.some((p) => busy.has(p.id))) continue; // already fed
      const inPort = candidates[0];
      if (!inPort) continue;
      const out = outs.find((p) => !busy.has(p.id) && compatible(p.type, inPort.type));
      if (!out) continue;
      wire(out, inPort, { label: "PGM", path: "A" });
    }
  }

  // 2. Each server output with feedsWallId → its wall's processor.
  const byWall = new Map<string, { A: string[]; B: string[] }>();
  for (const h of record.servers.hosts) {
    const dev = devs.get(h.deviceId);
    if (!dev) continue;
    const ab: "A" | "B" = h.role === "master" ? "A" : "B";
    for (const o of h.outputs) {
      if (!o.feedsWallId || busy.has(o.portId)) continue;
      const outPort = dev.ports.find((p) => p.id === o.portId);
      const wall = record.led.walls.find((w) => w.id === o.feedsWallId);
      if (!outPort || !wall) continue;
      let done: string[] | null = null;
      for (const pid of wall.processorIds) {
        const proc = devs.get(pid);
        if (!proc) continue;
        const ins = proc.ports.filter((p) => p.dir === "in" && isVideoPort(p.type) && !busy.has(p.id));
        // Prefer an input reachable directly, then via fewest converters.
        const scored = ins.map((p) => ({ p, chain: converterChain(outPort.type, p.type, lib) })).filter((x) => x.chain).sort((a, b) => a.chain!.length - b.chain!.length);
        if (!scored.length) continue;
        done = wire(outPort, scored[0].p, { path: ab, label: `${wall.name} ${ab}` });
        if (done) break;
      }
      if (done) {
        const slot = byWall.get(wall.id) ?? { A: [], B: [] };
        slot[ab].push(...done);
        byWall.set(wall.id, slot);
      }
    }
  }

  // 3. Name the redundancy group when both sides exist (existing A links into the wall's processors count).
  for (const [wallId, slot] of byWall) {
    const wall = record.led.walls.find((w) => w.id === wallId)!;
    const name = `PGM to ${wall.name}`;
    if (record.signal.redundancy.some((g) => g.name === name)) continue;
    const procPorts = new Set(wall.processorIds.flatMap((id) => devs.get(id)?.ports.map((p) => p.id) ?? []));
    const existing = (ab: "A" | "B") => record.signal.links.filter((l) => {
      const c = record.cables.find((x) => x.id === l.cableId);
      return c?.toPort && procPorts.has(c.toPort) && (l.path === ab);
    }).map((l) => l.id);
    const A = slot.A.length ? slot.A : existing("A");
    const B = slot.B.length ? slot.B : existing("B");
    if (A.length && B.length) ops.push({ op: "add", path: "/signal/redundancy/-", value: { id: newId("rg"), name, primary: A, backup: B } satisfies RedundancyGroup });
  }
  return ops;
}
