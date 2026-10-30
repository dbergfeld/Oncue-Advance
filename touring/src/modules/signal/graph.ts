// Typed port graph over devices / cables / links, format propagation, chains, cycles and
// single points of failure per redundancy group (Signal graph tab).
import type { Cable, Device, LibraryLookup, Port, PortType, RedundancyGroup, ShowRecord, SignalLink } from "../../store/types";
import { CHAIN_CABLE_TYPES, isVideoPort, normalizeFormat, parseFormat } from "./portRules";

export type SpecOf = (d: Device) => Record<string, unknown>;

/** device.spec first, then the library template's spec. */
export function specResolver(library?: LibraryLookup | null): SpecOf {
  return (d) => {
    let lib: Record<string, unknown> = {};
    if (library && d.templateId) {
      try { lib = library.get(d.templateId)?.spec ?? {}; } catch { lib = {}; }
    }
    return { ...lib, ...(d.spec ?? {}) };
  };
}

export interface PortRef { port: Port; device: Device }
export interface Edge { cable: Cable; link?: SignalLink; from: PortRef; to: PortRef }

export interface Graph {
  record: ShowRecord;
  specOf: SpecOf;
  devices: Map<string, Device>;
  ports: Map<string, PortRef>;
  cables: Map<string, Cable>;
  links: Map<string, SignalLink>;
  linkByCable: Map<string, SignalLink>;
  cablesByPort: Map<string, Cable[]>;
  /** Cables whose two ends resolve. */
  edges: Edge[];
  edgeByCable: Map<string, Edge>;
  inbound: Map<string, Edge[]>;   // by device id
  outbound: Map<string, Edge[]>;  // by device id
}

export function buildGraph(record: ShowRecord, specOf: SpecOf = specResolver(null)): Graph {
  const devices = new Map<string, Device>();
  const ports = new Map<string, PortRef>();
  for (const d of record.devices) {
    devices.set(d.id, d);
    for (const p of d.ports ?? []) ports.set(p.id, { port: p, device: d });
  }
  const cables = new Map(record.cables.map((c) => [c.id, c]));
  const links = new Map(record.signal.links.map((l) => [l.id, l]));
  const linkByCable = new Map<string, SignalLink>();
  for (const l of record.signal.links) if (!linkByCable.has(l.cableId)) linkByCable.set(l.cableId, l);
  const cablesByPort = new Map<string, Cable[]>();
  const edges: Edge[] = [];
  const edgeByCable = new Map<string, Edge>();
  const inbound = new Map<string, Edge[]>();
  const outbound = new Map<string, Edge[]>();
  for (const c of record.cables) {
    for (const p of [c.fromPort, c.toPort]) if (p) cablesByPort.set(p, [...(cablesByPort.get(p) ?? []), c]);
    const from = c.fromPort ? ports.get(c.fromPort) : undefined;
    const to = c.toPort ? ports.get(c.toPort) : undefined;
    if (!from || !to) continue;
    const e: Edge = { cable: c, link: linkByCable.get(c.id), from, to };
    edges.push(e);
    edgeByCable.set(c.id, e);
    outbound.set(from.device.id, [...(outbound.get(from.device.id) ?? []), e]);
    inbound.set(to.device.id, [...(inbound.get(to.device.id) ?? []), e]);
  }
  return { record, specOf, devices, ports, cables, links, linkByCable, cablesByPort, edges, edgeByCable, inbound, outbound };
}

export const portLabel = (r: PortRef | undefined, fallback = "?") => (r ? `${r.device.label} ${r.port.name}` : fallback);
export const edgeLabel = (e: Edge) => `${portLabel(e.from)} → ${portLabel(e.to)}`;

// ---------------- device format rule ----------------
export type FormatRule = "pass" | "convert" | "terminal";

/**
 * Pass-through (DA, fibre converter, router, patch panel), converting (switcher, scaler, processor, server,
 * CCU, camera as a source) or terminal (monitor, recorder, tiles). `spec.formatRule` overrides.
 */
export function formatRule(d: Device, spec: Record<string, unknown>): FormatRule {
  const explicit = spec.formatRule;
  if (explicit === "pass" || explicit === "pass-through") return "pass";
  if (explicit === "convert" || explicit === "converting") return "convert";
  if (explicit === "terminal") return "terminal";
  switch (d.class) {
    case "router": case "fiber": case "patchPanel": return "pass";
    case "converter": return spec.scaler === true || spec.outputFormat ? "convert" : "pass";
    case "switcher": case "processor": case "server": case "ccu": case "camera": case "capture": return "convert";
    default: return "terminal";
  }
}

/** Output format a converting device produces on `portId`. */
export function deviceOutputFormat(g: Graph, d: Device, portId: string): string | null {
  const spec = g.specOf(d);
  const r = g.record;
  if (d.class === "server") {
    for (const h of r.servers.hosts) {
      if (h.deviceId !== d.id) continue;
      const o = h.outputs.find((x) => x.portId === portId);
      if (o?.resolution) return `${o.resolution}${/[pi]\d/.test(o.resolution) ? "" : `p${o.refresh || 60}`}`;
    }
  }
  if (typeof spec.outputFormat === "string" && spec.outputFormat) return spec.outputFormat;
  if (d.class === "switcher" || d.class === "camera" || d.class === "ccu") return r.signal.formats.house || null;
  return null;
}

// ---------------- format propagation ----------------
export interface Resolved { format: string; inherited: boolean; via: string }

/**
 * derived.signal.resolvedFormat[linkId]. Starts at source links, applies each device's class rule,
 * and records where the value came from for evidence.
 */
export function resolveFormats(g: Graph): Map<string, Resolved> {
  const out = new Map<string, Resolved>();
  const visiting = new Set<string>();
  const resolveEdge = (e: Edge): Resolved | null => {
    const link = e.link;
    if (!link) return null;
    if (out.has(link.id)) return out.get(link.id)!;
    if (visiting.has(link.id)) return link.format ? { format: link.format, inherited: false, via: "link" } : null;
    visiting.add(link.id);
    const d = e.from.device;
    const rule = formatRule(d, g.specOf(d));
    let res: Resolved | null = null;
    if (rule === "pass") {
      const ins = (g.inbound.get(d.id) ?? []).filter((x) => x.link && isVideoOrFibre(x.to.port.type));
      const upstream = ins.map(resolveEdge).filter((x): x is Resolved => !!x);
      const distinct = new Set(upstream.map((u) => normalizeFormat(u.format)));
      if (upstream.length && (distinct.size === 1 || !link.format || link.inherited))
        res = { format: upstream[0].format, inherited: true, via: `${d.label} (pass-through)` };
      else if (link.format) res = { format: link.format, inherited: false, via: "link" };
    } else if (rule === "convert") {
      const devFmt = d.class === "server" ? deviceOutputFormat(g, d, e.from.port.id) : null;
      if (devFmt) res = { format: devFmt, inherited: false, via: `${d.label} output` };
      else if (link.format) res = { format: link.format, inherited: false, via: "link" };
      else {
        const f = deviceOutputFormat(g, d, e.from.port.id);
        if (f) res = { format: f, inherited: false, via: `${d.label} program format` };
      }
    } else if (link.format) res = { format: link.format, inherited: false, via: "link" };
    visiting.delete(link.id);
    if (res) out.set(link.id, res);
    return res;
  };
  for (const e of g.edges) resolveEdge(e);
  return out;
}

function isVideoOrFibre(t: PortType) {
  return isVideoPort(t) || t === "fiber-LC" || t === "fiber-ST" || t === "fiber-SMPTE";
}

// ---------------- chains and cycles ----------------
const chainEdge = (e: Edge) => CHAIN_CABLE_TYPES.includes(e.cable.type);

/** Video edges into / out of a device (LED data included so processors reach XDs and tiles). */
export function inEdges(g: Graph, deviceId: string): Edge[] { return (g.inbound.get(deviceId) ?? []).filter(chainEdge); }
export function outEdges(g: Graph, deviceId: string): Edge[] { return (g.outbound.get(deviceId) ?? []).filter(chainEdge); }

/** Signal-layer cycle detection (LED data loops back to processors are excluded by design). */
export function findCycles(g: Graph): { closing: Edge; devices: string[] }[] {
  const sigEdge = (e: Edge) => chainEdge(e) && e.cable.type !== "etherCon" && e.cable.type !== "fiberLED";
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const found: { closing: Edge; devices: string[] }[] = [];
  const seenClosing = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    const d = g.devices.get(id);
    const terminal = d ? formatRule(d, g.specOf(d)) === "terminal" : true;
    if (!terminal) for (const e of (g.outbound.get(id) ?? []).filter(sigEdge)) {
      const next = e.to.device.id;
      const s = state.get(next) ?? 0;
      if (s === 1) {
        if (!seenClosing.has(e.cable.id)) {
          seenClosing.add(e.cable.id);
          found.push({ closing: e, devices: stack.slice(stack.indexOf(next)) });
        }
      } else if (s === 0) visit(next);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of g.devices.keys()) if (!state.get(id)) visit(id);
  return found;
}

/** Every chain (ordered edges, source first) ending at a sink device; capped to stay cheap. */
export function chainsTo(g: Graph, sinkDeviceId: string, cap = 64): Edge[][] {
  const out: Edge[][] = [];
  const walk = (devId: string, acc: Edge[], seen: Set<string>) => {
    if (out.length >= cap) return;
    const ins = inEdges(g, devId).filter((e) => e.link);
    if (!ins.length) { if (acc.length) out.push([...acc].reverse()); return; }
    for (const e of ins) {
      const up = e.from.device.id;
      if (seen.has(up)) { out.push([...acc, e].reverse()); continue; }
      seen.add(up);
      walk(up, [...acc, e], seen);
      seen.delete(up);
    }
  };
  walk(sinkDeviceId, [], new Set([sinkDeviceId]));
  return out;
}

/** Sinks: terminal devices, or devices with an inbound link and no outbound video link. */
export function sinks(g: Graph): string[] {
  const out: string[] = [];
  for (const d of g.devices.values()) {
    const ins = inEdges(g, d.id).filter((e) => e.link);
    if (!ins.length) continue;
    if (formatRule(d, g.specOf(d)) === "terminal" || !outEdges(g, d.id).some((e) => e.link)) out.push(d.id);
  }
  return out;
}

export function allChains(g: Graph): Map<string, Edge[][]> {
  return new Map(sinks(g).map((s) => [s, chainsTo(g, s)]));
}

/** Upstream links reached through pass-through devices only (what an input "resolves to"). */
export function resolvesTo(g: Graph, e: Edge, seen = new Set<string>()): Edge[] {
  const out = [e];
  const d = e.from.device;
  if (seen.has(d.id)) return out;
  seen.add(d.id);
  if (formatRule(d, g.specOf(d)) !== "pass") return out;
  for (const up of inEdges(g, d.id)) if (up.link) out.push(...resolvesTo(g, up, seen));
  return out;
}

// ---------------- single points of failure ----------------
export interface SharedElement { id: string; kind: "device" | "cable" | "panel" | "trunk"; label: string; via: string }
export interface GroupSPOF { group: RedundancyGroup; shared: SharedElement[]; terminal: string[]; chainA: string[]; chainB: string[] }

function linkEdge(g: Graph, linkId: string): Edge | undefined {
  const l = g.links.get(linkId);
  return l ? g.edgeByCable.get(l.cableId) : undefined;
}

/**
 * Elements a side of a group depends on: the listed links' cables and devices (and any panels / trunks
 * their segments pass), then everything downstream of the common terminal device on that side
 * (cables with redundancyGroup matching the side or null). The common terminal itself is exempt —
 * both paths are meant to land on it (e.g. a processor's A and B inputs).
 */
export function singlePoints(g: Graph): GroupSPOF[] {
  const res: GroupSPOF[] = [];
  for (const grp of g.record.signal.redundancy) {
    const ea = grp.primary.map((id) => linkEdge(g, id)).filter((e): e is Edge => !!e);
    const eb = grp.backup.map((id) => linkEdge(g, id)).filter((e): e is Edge => !!e);
    if (!ea.length || !eb.length) { res.push({ group: grp, shared: [], terminal: [], chainA: [], chainB: [] }); continue; }
    const termOf = (es: Edge[]) => {
      const froms = new Set(es.map((e) => e.from.device.id));
      return new Set(es.map((e) => e.to.device.id).filter((id) => !froms.has(id)));
    };
    const ta = termOf(ea);
    const tb = termOf(eb);
    const terminal = [...ta].filter((id) => tb.has(id));
    const side = (es: Edge[], ab: "A" | "B") => {
      const m = new Map<string, SharedElement>();
      const order: string[] = [];
      const put = (el: SharedElement) => { if (!m.has(el.id)) { m.set(el.id, el); order.push(el.label); } };
      for (const e of es) {
        put({ id: e.from.device.id, kind: "device", label: e.from.device.label, via: edgeLabel(e) });
        put({ id: e.cable.id, kind: "cable", label: e.cable.label || e.cable.id, via: edgeLabel(e) });
        for (const el of segmentElements(g, e.cable)) put(el);
        put({ id: e.to.device.id, kind: "device", label: e.to.device.label, via: edgeLabel(e) });
      }
      // Downstream of the terminal toward the wall.
      const queue = [...terminal];
      const seen = new Set(queue);
      while (queue.length) {
        const id = queue.shift()!;
        for (const e of outEdges(g, id)) {
          if (e.cable.redundancyGroup && e.cable.redundancyGroup !== ab) continue;
          put({ id: e.cable.id, kind: "cable", label: e.cable.label || e.cable.id, via: edgeLabel(e) });
          const next = e.to.device;
          put({ id: next.id, kind: "device", label: next.label, via: edgeLabel(e) });
          if (!seen.has(next.id)) { seen.add(next.id); queue.push(next.id); }
        }
      }
      return { m, order };
    };
    const A = side(ea, "A");
    const B = side(eb, "B");
    const shared = [...A.m.values()].filter((el) => B.m.has(el.id) && !terminal.includes(el.id));
    res.push({ group: grp, shared, terminal, chainA: A.order, chainB: B.order });
  }
  return res;
}

/** Panels and trunks a cable's stored segments pass through. */
export function segmentElements(g: Graph, c: Cable): SharedElement[] {
  const out: SharedElement[] = [];
  const jackPanel = new Map<string, Device>();
  for (const d of g.devices.values()) for (const j of ((g.specOf(d).jacks ?? d.spec?.jacks) as { id: string }[] | undefined) ?? []) jackPanel.set(j.id, d);
  for (const s of c.segments ?? []) {
    if (s.kind === "trunk-strand" && s.reelRef) {
      const t = g.cables.get(s.reelRef.split("/")[0]);
      if (t) out.push({ id: t.id, kind: "trunk", label: t.label || t.id, via: c.label });
    }
  }
  for (const s of c.segments ?? []) for (const end of [s.from, s.to]) {
    if ("jack" in end) {
      const p = jackPanel.get(end.jack);
      if (p) out.push({ id: p.id, kind: "panel", label: p.label, via: c.label });
    } else if ("strand" in end) {
      const trunkId = end.strand.split("/")[0];
      const t = g.cables.get(trunkId);
      if (t) out.push({ id: t.id, kind: "trunk", label: t.label || t.id, via: c.label });
    }
  }
  return out;
}

export function formatOrNull(s: string | null | undefined): string | null {
  return parseFormat(s) ? normalizeFormat(s) : s || null;
}
