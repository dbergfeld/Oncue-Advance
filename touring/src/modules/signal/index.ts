// Show Signal Flow module (`signal`): owns /signal and /physical, signal device classes and every non-LED cable.
import { instantiate, library as defaultLibrary } from "../../library/library";
import { cableOwner } from "../../store/ownership";
import type {
  CableType, CheckDraft, Derived, Device, DeviceClass, DeviceTemplate, LibraryLookup, ModuleContract, ModuleId, Patch, PortType, SeedContext, ShowRecord, ValidateContext,
} from "../../store/types";
import {
  allChains, buildGraph, edgeLabel, findCycles, formatRule, type Graph, portLabel, type Resolved, resolveFormats, resolvesTo, singlePoints, specResolver, inEdges,
} from "./graph";
import { nodePatches, removeCablePatches, SIGNAL_CLASSES } from "./helpers";
import {
  bothEndsTag, cableLabels, colourFor, deriveSegments, jackIndex, jackLabel, jacksOf, physicalChecks, physicalDerived, seedPhysical,
} from "./physical";
import {
  canSink, canSource, compatible, describeFormat, formatFits, isVideoPort, normalizeFormat, parseFormat, PORT_MAX_FORMAT, reachFt, sameFormat,
} from "./portRules";

export const SIGNAL_CABLE_TYPES: CableType[] = ["SDI", "HDMI", "DP", "DP-HDMI", "SMPTE-311", "fiber", "cat6", "tally", "comms", "BNC-ref", "audio-TRS", "BNC", "power"];
const SIGNAL_DEVICE_CLASSES: DeviceClass[] = ["camera", "ccu", "switcher", "router", "converter", "recorder", "monitor", "fiber"];

export const DEFAULT_FORMATS = { house: "1080p59.94", ledInput: "3840x2160p59.94", record: "1080p59.94" };
export const DEFAULT_VLANS = [
  { id: 10, name: "Control", subnet: "10.10.0.0/24" },
  { id: 20, name: "Media", subnet: "10.20.0.0/24" },
  { id: 30, name: "Comms", subnet: "10.30.0.0/24" },
];

type Fix = NonNullable<CheckDraft["fixes"]>[number];
type Ev = NonNullable<CheckDraft["evidence"]>[number];
const ev = (label: string, value: string, path: string): Ev => ({ label, value, path });

function ownerOf(cls: DeviceClass): ModuleId | "shell" {
  if (["tile", "processor", "distro", "ledPdu"].includes(cls)) return "led";
  if (["rackPdu", "ups", "shelf"].includes(cls)) return "rack";
  if (["server", "kvm", "capture", "tcGen"].includes(cls)) return "servers";
  if (cls === "unknown") return "shell";
  return "signal";
}

const portPath = (d: Device, portId: string) => `/devices/${d.id}/ports/${portId}`;
const fmtShort = (f: string | null | undefined) => (parseFormat(f) ? normalizeFormat(f) : f || "(none)");

function serverOutputPath(r: ShowRecord, portId: string): string | null {
  for (const h of r.servers.hosts) {
    const i = h.outputs.findIndex((o) => o.portId === portId);
    if (i >= 0) return `/servers/hosts/${h.id}/outputs/${i}`;
  }
  return null;
}

function formatPath(r: ShowRecord, g: Graph, linkId: string, res: Resolved | undefined): string {
  const l = g.links.get(linkId)!;
  const e = g.edgeByCable.get(l.cableId);
  if (res && e && res.via.endsWith("output") && e.from.device.class === "server") return serverOutputPath(r, e.from.port.id) ?? `/signal/links/${linkId}/format`;
  return `/signal/links/${linkId}/format`;
}

/** Converter templates that would bridge two port types (for fix text). */
function bridgeSuggestions(lib: LibraryLookup, from: PortType, to: PortType): string[] {
  let list: DeviceTemplate[] = [];
  try { list = lib.find({ class: "converter" }); } catch { list = []; }
  return list.filter((t) =>
    t.ports.some((p) => p.dir !== "out" && compatible(from, p.type)) && t.ports.some((p) => p.dir !== "in" && compatible(p.type, to)),
  ).slice(0, 2).map((t) => `${t.make} ${t.model}`);
}

// ---------------- validate ----------------
export function validateSignal(r: ShowRecord, ctx: ValidateContext): CheckDraft[] {
  const g = buildGraph(r, specResolver(ctx.library));
  const resolved = resolveFormats(g);
  const out: CheckDraft[] = [];
  const labels = cableLabels(r);
  const cabLabel = (id: string) => g.cables.get(id)?.label || labels.get(id) || "cable";

  // SIG-001 dangling cable
  for (const c of r.cables) {
    for (const end of ["fromPort", "toPort"] as const) {
      const pid = c[end];
      if (!pid || g.ports.has(pid)) continue;
      const other = end === "fromPort" ? c.toPort : c.fromPort;
      const otherRef = other ? g.ports.get(other) : undefined;
      const mine = cableOwner(c.type) === "signal";
      const fixes: Fix[] = [];
      if (mine) fixes.push({ label: `Delete ${cabLabel(c.id)} and its link`, module: "signal", patch: removeCablePatches(r, c) });
      else fixes.push({ label: `Delete ${cabLabel(c.id)}`, module: "led" });
      fixes.push({ label: `Re-land ${cabLabel(c.id)} on an existing ${c.type} port`, module: mine ? "signal" : "led" });
      out.push({
        code: "SIG-001", severity: "block", title: "Dangling cable", target: c.id, involved: [c.id, ...(otherRef ? [otherRef.device.id, otherRef.port.id] : [])],
        message: `${cabLabel(c.id)} ${end === "toPort" ? "ends" : "starts"} on a port that no longer exists${otherRef ? ` (other end ${portLabel(otherRef)})` : ""}.`,
        rule: `Both ends of a cable must resolve to an existing port; ${end} points at a port that is not on any device.`,
        evidence: [
          ev(`${cabLabel(c.id)} ${end}`, "port not found", `/cables/${c.id}/${end}`),
          ev(`${cabLabel(c.id)} other end`, otherRef ? portLabel(otherRef) : other ? "port not found" : "open", `/cables/${c.id}/${end === "fromPort" ? "toPort" : "fromPort"}`),
          ev("cable", `${c.type} ${c.length_ft} ft`, `/cables/${c.id}`),
        ],
        fixes,
      });
    }
  }

  for (const e of g.edges) {
    const c = e.cable;
    const lab = cabLabel(c.id);
    // SIG-002 port direction
    const badFrom = !canSource(e.from.port.dir);
    const badTo = !canSink(e.to.port.dir);
    if (badFrom || badTo) {
      const reversible = canSource(e.to.port.dir) && canSink(e.from.port.dir);
      const fixes: Fix[] = [];
      if (reversible) fixes.push({ label: `Reverse ${lab}: ${portLabel(e.to)} → ${portLabel(e.from)}`, module: cableOwner(c.type) === "signal" ? "signal" : "led",
        ...(cableOwner(c.type) === "signal" ? { patch: [{ op: "replace", path: `/cables/${c.id}/fromPort`, value: e.to.port.id }, { op: "replace", path: `/cables/${c.id}/toPort`, value: e.from.port.id }] as Patch[] } : {}) });
      fixes.push({ label: `Land ${lab} on ${badFrom ? `an output of ${e.from.device.label}` : `an input of ${e.to.device.label}`}`, module: cableOwner(c.type) === "signal" ? "signal" : "led" });
      out.push({
        code: "SIG-002", severity: "block", title: "Port direction", target: c.id, involved: [c.id, e.from.port.id, e.to.port.id, e.from.device.id, e.to.device.id],
        message: badFrom ? `${lab} leaves ${portLabel(e.from)}, which is an input.` : `${lab} enters ${portLabel(e.to)}, which is an output.`,
        rule: `A cable leaves an out or bidir port and enters an in or bidir port; from is ${e.from.port.dir}, to is ${e.to.port.dir}.`,
        evidence: [
          badFrom ? ev(`${portLabel(e.from)} direction`, e.from.port.dir, portPath(e.from.device, e.from.port.id)) : ev(`${portLabel(e.to)} direction`, e.to.port.dir, portPath(e.to.device, e.to.port.id)),
          badFrom ? ev(`${portLabel(e.to)} direction`, e.to.port.dir, portPath(e.to.device, e.to.port.id)) : ev(`${portLabel(e.from)} direction`, e.from.port.dir, portPath(e.from.device, e.from.port.id)),
          ev("cable", `${c.type} ${c.length_ft} ft`, `/cables/${c.id}`),
        ],
        fixes,
      });
    }
    // SIG-003 incompatible ports
    const compat = compatible(e.from.port.type, e.to.port.type);
    if (!compat) {
      const bridges = bridgeSuggestions(ctx.library, e.from.port.type, e.to.port.type);
      const alt = e.to.device.ports.filter((p) => canSink(p.dir) && p.id !== e.to.port.id && compatible(e.from.port.type, p.type)).map((p) => p.name);
      const fixes: Fix[] = [];
      if (alt.length) fixes.push({ label: `Land ${lab} on ${e.to.device.label} ${alt[0]} instead`, module: "signal" });
      if (bridges.length) fixes.push({ label: `Insert a ${bridges.join(" or ")} between ${portLabel(e.from)} and ${portLabel(e.to)}`, module: "signal" });
      fixes.push({ label: `Feed ${portLabel(e.to)} from a ${e.to.port.type} output`, module: "signal" });
      out.push({
        code: "SIG-003", severity: "block", title: "Incompatible ports", target: c.id, involved: [c.id, e.from.port.id, e.to.port.id, e.from.device.id, e.to.device.id],
        message: `${lab} joins ${portLabel(e.from)} (${e.from.port.type}) to ${portLabel(e.to)} (${e.to.port.type}); no cable in the port rules connects those two.`,
        rule: `A cable may join two ports only if the pair is in the compatibility matrix; ${e.from.port.type} → ${e.to.port.type} is not.`,
        evidence: [
          ev(`${portLabel(e.to)} type`, e.to.port.type, portPath(e.to.device, e.to.port.id)),
          ev(`${portLabel(e.from)} type`, e.from.port.type, portPath(e.from.device, e.from.port.id)),
          ev("cable", `${c.type} ${c.length_ft} ft`, `/cables/${c.id}`),
        ],
        fixes,
      });
    } else if (!compat.cableTypes.includes(c.type)) {
      const mine = cableOwner(c.type) === "signal" && cableOwner(compat.cableType) === "signal";
      out.push({
        code: "SIG-003", severity: "info", title: "Cable type differs from port rule", target: c.id, involved: [c.id, e.from.port.id, e.to.port.id],
        message: `${lab} is listed as ${c.type}, but ${portLabel(e.from)} → ${portLabel(e.to)} is a ${compat.cableType} run.`,
        rule: `${e.from.port.type} → ${e.to.port.type} takes ${compat.cableTypes.join(" / ")}; the cable is ${c.type}.`,
        evidence: [ev(`${lab} type`, c.type, `/cables/${c.id}/type`), ev("port rule cable", compat.cableTypes.join(" / "), "port-rules"), ev("ports", `${e.from.port.type} → ${e.to.port.type}`, portPath(e.to.device, e.to.port.id))],
        fixes: [{ label: `Change ${lab} to ${compat.cableType}`, module: mine ? "signal" : "led", ...(mine ? { patch: [{ op: "replace", path: `/cables/${c.id}/type`, value: compat.cableType }] as Patch[] } : {}) }],
      });
    }
    // SIG-012 protocol mismatch
    if (c.type === "fiberLED" || c.type === "etherCon") {
      const pa = g.specOf(e.from.device).protocol;
      const pb = g.specOf(e.to.device).protocol;
      if (typeof pa === "string" && typeof pb === "string" && pa.toLowerCase() !== pb.toLowerCase()) {
        out.push({
          code: "SIG-012", severity: "block", title: "Protocol mismatch", target: c.id, involved: [c.id, e.from.device.id, e.to.device.id],
          message: `${lab} joins ${e.from.device.label} (${pa}) to ${e.to.device.label} (${pb}); LED data only runs between devices that speak the same protocol.`,
          rule: `${c.type} links need the same spec.protocol on both devices; ${pa} ≠ ${pb}.`,
          evidence: [ev(`${e.to.device.label} protocol`, pb, `/devices/${e.to.device.id}/spec/protocol`), ev(`${e.from.device.label} protocol`, pa, `/devices/${e.from.device.id}/spec/protocol`)],
          fixes: [{ label: `Use ${pa} tiles / XDs on this run, or a ${pb} processor`, module: "led" }],
        });
      }
    }
  }

  // SIG-004 / SIG-005 format checks on links
  const ledInput = r.signal.formats.ledInput;
  for (const l of r.signal.links) {
    const e = g.edgeByCable.get(l.cableId);
    const res = resolved.get(l.id);
    if (!e || !res?.format) continue;
    const compat = compatible(e.from.port.type, e.to.port.type);
    const fmt = res.format;
    const fpath = formatPath(r, g, l.id, res);
    const lab = edgeLabel(e);
    const origin = res.inherited || res.via !== "link" ? `inherited from ${res.via}` : "set on the link";
    if (compat) {
      const max = compat.maxFormat ?? PORT_MAX_FORMAT[e.to.port.type] ?? null;
      const fit = formatFits(fmt, e.to.port.type, max);
      if (!fit.ok && max) {
        const fromServer = e.from.device.class === "server";
        const fixes: Fix[] = [];
        const sw = r.devices.find((d) => d.class === "switcher");
        const swOut = sw?.ports.find((p) => p.dir === "out" && /PGM/i.test(p.name)) ?? sw?.ports.find((p) => p.dir === "out" && isVideoPort(p.type));
        if (sw && swOut && sw.id !== e.from.device.id) fixes.push({ label: `Feed ${e.to.device.label} from ${sw.label} ${swOut.name} instead`, module: "signal" });
        const walls = fromServer ? r.servers.hosts.flatMap((h) => h.outputs.filter((o) => o.portId === e.from.port.id && o.feedsWallId)).map((o) => r.led.walls.find((w) => w.id === o.feedsWallId)?.name).filter(Boolean) : [];
        fixes.push({ label: `Change ${e.from.device.label} ${e.from.port.name} to ${fmtShort(r.signal.formats.house || max)}${walls.length ? `; also affects ${walls.join(", ")} feed` : ""}`, module: fromServer ? "servers" : "signal" });
        fixes.push({ label: `Replace ${e.to.device.label} with a device whose input accepts ${fmtShort(fmt)} (e.g. 12G-SDI)`, module: ownerOf(e.to.device.class) });
        out.push({
          code: "SIG-004", severity: compat.severity, title: "Format exceeds sink", target: l.id, involved: [l.id, e.cable.id, e.from.port.id, e.to.port.id, e.from.device.id, e.to.device.id],
          message: `${lab} is carrying ${fmtShort(fmt)} into a ${e.to.port.type} input that accepts up to ${fmtShort(max)}.`,
          rule: `${e.to.port.type} accepts ≤ ${fmtShort(max)}; arriving format ${fmtShort(fmt)} (${origin}).`,
          evidence: [
            ev(`${e.from.device.label} ${e.from.port.name} format`, describeFormat(fmt), fpath),
            ev(`${portLabel(e.to)} type`, `${e.to.port.type} (≤ ${fmtShort(max)})`, portPath(e.to.device, e.to.port.id)),
            ev("cable", `${e.cable.type} ${e.cable.length_ft} ft`, `/cables/${e.cable.id}`),
          ],
          fixes,
        });
      }
    }
    // SIG-005 processor input format
    if (e.to.device.class === "processor" && isVideoPort(e.to.port.type)) {
      const spec = g.specOf(e.to.device);
      const accepted = Array.isArray(spec.acceptedFormats) ? (spec.acceptedFormats as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const notAccepted = accepted.length > 0 && !accepted.some((a) => sameFormat(a, fmt));
      const notLed = !!ledInput && !sameFormat(ledInput, fmt);
      if (notAccepted || notLed) {
        const evid: Ev[] = [ev(`${lab} format`, describeFormat(fmt), fpath)];
        if (notLed) evid.push(ev("show LED input format", describeFormat(ledInput), "/signal/formats/ledInput"));
        if (accepted.length) evid.push(ev(`${e.to.device.label} accepted formats`, accepted.map(fmtShort).join(", "), `/devices/${e.to.device.id}/spec/acceptedFormats`));
        out.push({
          code: "SIG-005", severity: "block", title: "Format mismatch at processor", target: l.id, involved: [l.id, e.cable.id, e.to.device.id, e.to.port.id],
          message: `${portLabel(e.to)} receives ${fmtShort(fmt)}, but ${notAccepted ? `${e.to.device.label} does not accept it` : `the show's LED input format is ${fmtShort(ledInput)}`}.`,
          rule: notAccepted
            ? `An LED processor input must receive one of spec.acceptedFormats (${accepted.map(fmtShort).join(", ")}); arriving ${fmtShort(fmt)}.`
            : `LED processor inputs carry signal.formats.ledInput = ${fmtShort(ledInput)}; arriving ${fmtShort(fmt)}.`,
          evidence: evid,
          fixes: [
            { label: `Set ${e.from.device.label} ${e.from.port.name} to ${fmtShort(ledInput || accepted[0])}`, module: e.from.device.class === "server" ? "servers" : "signal" },
            { label: `Insert a scaler (e.g. Blackmagic Teranex AV) before ${e.to.device.label}`, module: "signal" },
            ...(notLed && !notAccepted ? [{ label: `Change the show LED input format to ${fmtShort(fmt)}`, module: "signal" as const }] : []),
          ],
        });
      }
    }
  }

  // SIG-006 unfed input on an in-use processor / recorder / CCU
  const wallsByProc = new Map<string, string[]>();
  for (const w of r.led.walls) for (const pid of w.processorIds) wallsByProc.set(pid, [...(wallsByProc.get(pid) ?? []), w.name]);
  const linkedDevices = new Set<string>();
  for (const e of g.edges) if (e.link) { linkedDevices.add(e.from.device.id); linkedDevices.add(e.to.device.id); }
  for (const d of r.devices) {
    const inUse = d.class === "processor" ? wallsByProc.has(d.id) && formatRule(d, g.specOf(d)) !== "pass" : (d.class === "recorder" || d.class === "ccu") && linkedDevices.has(d.id);
    if (!inUse) continue;
    const inputs = d.ports.filter((p) => p.dir === "in" && isVideoPort(p.type));
    if (!inputs.length) continue;
    const fed = inEdges(g, d.id).some((e) => e.link && inputs.some((p) => p.id === e.to.port.id));
    if (fed) continue;
    const first = inputs[0];
    const why = d.class === "processor" ? `${d.label} drives ${wallsByProc.get(d.id)!.join(", ")}` : `${d.label} is patched into the system`;
    const fixes: Fix[] = [];
    if (d.class === "processor") {
      const wallIds = r.led.walls.filter((w) => w.processorIds.includes(d.id)).map((w) => w.id);
      for (const h of r.servers.hosts) for (const o of h.outputs) {
        if (!o.feedsWallId || !wallIds.includes(o.feedsWallId) || (g.cablesByPort.get(o.portId)?.length ?? 0) > 0) continue;
        const ref = g.ports.get(o.portId);
        if (!ref) continue;
        const target = inputs.find((p) => compatible(ref.port.type, p.type)) ?? inputs[0];
        const c = compatible(ref.port.type, target.type);
        fixes.push({ label: `Cable ${portLabel(ref)} → ${d.label} ${target.name}${c?.cableType === "DP-HDMI" ? " via DP-HDMI adapter" : !c ? " via a converter" : ""}`, module: "signal" });
        break;
      }
    }
    const sw = r.devices.find((x) => x.class === "switcher");
    const swOut = sw?.ports.find((p) => p.dir === "out" && /PGM/i.test(p.name) && !(g.cablesByPort.get(p.id)?.length)) ?? sw?.ports.find((p) => p.dir === "out" && isVideoPort(p.type) && !(g.cablesByPort.get(p.id)?.length));
    if (sw && swOut && sw.id !== d.id) {
      const target = inputs.find((p) => compatible(swOut.type, p.type)) ?? first;
      fixes.push({ label: `Cable ${sw.label} ${swOut.name} → ${d.label} ${target.name}`, module: "signal" });
    }
    if (d.class === "processor") fixes.push({ label: `Remove ${d.label} from ${wallsByProc.get(d.id)!.join(", ")} if the wall is not in use`, module: "led" });
    else fixes.push({ label: `Disconnect ${d.label} if it is not in use`, module: "signal" });
    out.push({
      code: "SIG-006", severity: "block", title: "Unfed input", target: d.id, involved: [d.id, ...inputs.map((p) => p.id)],
      message: `${d.label} ${first.name} has no incoming signal but ${why}.`,
      rule: `Every in-use ${d.class === "ccu" ? "CCU return" : d.class} needs an inbound link on an input; ${d.label} has 0 inbound links.`,
      evidence: [
        ev(`cables ending at ${d.label}`, "none", "/cables"),
        ev(`${d.label} inputs`, inputs.map((p) => p.name).join(", "), `/devices/${d.id}/ports`),
        d.class === "processor"
          ? ev(`${wallsByProc.get(d.id)!.join(", ")} processors`, d.label, `/led/walls/${r.led.walls.find((w) => w.processorIds.includes(d.id))!.id}/processorIds`)
          : ev(`${d.label} links`, "linked on another port", "/signal/links"),
      ],
      fixes,
    });
  }

  // SIG-007 server output with feedsWallId and no cable
  for (const h of r.servers.hosts) {
    const dev = g.devices.get(h.deviceId);
    h.outputs.forEach((o, i) => {
      if (!o.feedsWallId) return;
      if ((g.cablesByPort.get(o.portId)?.length ?? 0) > 0) return;
      const wall = r.led.walls.find((w) => w.id === o.feedsWallId);
      const port = dev?.ports.find((p) => p.id === o.portId);
      const name = `${dev?.label ?? "server"} ${port?.name ?? "output"}`;
      const proc = wall?.processorIds.map((id) => g.devices.get(id)).find(Boolean);
      const free = proc?.ports.filter((p) => p.dir === "in" && isVideoPort(p.type) && !(g.cablesByPort.get(p.id)?.length)) ?? [];
      const fixes: Fix[] = [];
      if (proc && port) {
        const target = free.find((p) => compatible(port.type, p.type)) ?? free[0];
        fixes.push(target
          ? { label: `Cable ${name} → ${proc.label} ${target.name} on path ${h.role === "master" ? "A" : "B"}${compatible(port.type, target.type)?.cableType === "DP-HDMI" ? " via DP-HDMI adapter" : !compatible(port.type, target.type) ? " via a converter" : ""}`, module: "signal" }
          : { label: `Add an input path to ${proc.label} for ${name} (all inputs are in use)`, module: "signal" });
      }
      fixes.push({ label: `Clear feedsWallId on ${name} if it does not feed ${wall?.name ?? "the wall"}`, module: "servers" });
      out.push({
        code: "SIG-007", severity: "warn", title: "Unlinked server output", target: o.portId, involved: [h.id, h.deviceId, o.portId, ...(wall ? [wall.id] : [])],
        message: `${name} is set to feed ${wall?.name ?? "a wall"} but no cable leaves it.`,
        rule: `A server output with feedsWallId (${wall?.name ?? o.feedsWallId}) needs a cable on its port; ${name} has 0 cables.`,
        evidence: [
          ev(`cables on ${name}`, "none", `/devices/${h.deviceId}/ports/${o.portId}`),
          ev(`${name} feedsWallId`, wall?.name ?? String(o.feedsWallId), `/servers/hosts/${h.id}/outputs/${i}/feedsWallId`),
          ev(`${dev?.label ?? "server"} role`, h.role, `/servers/hosts/${h.id}/role`),
        ],
        fixes,
      });
    });
  }

  // SIG-008 single point of failure per redundancy group
  const spofs = singlePoints(g);
  for (const s of spofs) {
    if (!s.shared.length) continue;
    const names = s.shared.map((x) => x.label);
    const first = s.shared[0];
    const shared = s.shared.find((x) => x.kind === "device") ?? first;
    const fixes: Fix[] = [];
    const dev = g.devices.get(shared.id);
    if (dev) {
      const owner = ownerOf(dev.class);
      fixes.push({ label: owner === "led" ? `Add a second ${dev.model || dev.label} and re-run the B path through it` : `Route the B path through a second ${dev.label}-class device`, module: owner === "shell" ? "signal" : owner });
    } else fixes.push({ label: `Run the B path on its own ${shared.kind}`, module: "signal" });
    fixes.push({ label: "Accept risk with annotation", module: "binder" });
    out.push({
      code: "SIG-008", severity: "warn", title: "Single point of failure", target: s.group.id, involved: [s.group.id, ...s.group.primary, ...s.group.backup, ...s.shared.map((x) => x.id)],
      message: `Redundancy group ${s.group.name} has A and B paths that both pass through ${names.join(", ")}.`,
      rule: `A and B links in one group may not share a device, cable, or panel; shared: ${names.join(", ")} (${shared.via}).`,
      evidence: [
        ...s.shared.map((x) => ev(x.label, x.kind, x.kind === "device" || x.kind === "panel" ? `/devices/${x.id}` : `/cables/${x.id}`)),
        ev("path A chain", s.chainA.join(" → "), `/signal/redundancy/${s.group.id}/primary`),
        ev("path B chain", s.chainB.join(" → "), `/signal/redundancy/${s.group.id}/backup`),
        ev("group", s.group.name, `/signal/redundancy/${s.group.id}`),
      ],
      fixes,
    });
  }

  // SIG-009 missing redundancy: a wall expected to have a B path has none.
  for (const w of r.led.walls) {
    const procs = w.processorIds.map((id) => g.devices.get(id)).filter((d): d is Device => !!d);
    if (!procs.length) continue;
    const procIds = new Set(procs.map((p) => p.id));
    const feeding = g.edges.filter((e) => e.link && procIds.has(e.to.device.id));
    if (!feeding.length) continue; // unfed: SIG-006 covers it
    const backups = r.servers.hosts.filter((h) => h.role !== "master" && h.outputs.some((o) => o.feedsWallId === w.id));
    const expects = ctx.profile.redundancyExpected || backups.length > 0;
    if (!expects) continue;
    const groupB = new Set(r.signal.redundancy.flatMap((grp) => grp.backup));
    const hasB = feeding.some((e) => e.link!.path === "B" || groupB.has(e.link!.id))
      || r.signal.redundancy.some((grp) => grp.backup.some((id) => { const l = g.links.get(id); const e = l && g.edgeByCable.get(l.cableId); return !!e && procIds.has(e.to.device.id); }));
    if (hasB) continue;
    const procNames = procs.map((p) => p.label).join(", ");
    const backupDev = backups.map((h) => g.devices.get(h.deviceId)?.label).filter(Boolean) as string[];
    const why = backupDev.length ? `${backupDev.join(", ")} is the backup but nothing carries it to the wall` : `the ${ctx.profile.type} profile expects a B path`;
    const fixes: Fix[] = [];
    if (backups.length) {
      const h = backups[0];
      const o = h.outputs.find((x) => x.feedsWallId === w.id)!;
      const ref = g.ports.get(o.portId);
      fixes.push({ label: `Cable ${ref ? portLabel(ref) : backupDev[0]} → ${procs[0].label} on path B`, module: "signal" });
    } else fixes.push({ label: `Add a B feed into ${procs[0].label} (second switcher output or backup server)`, module: "signal" });
    fixes.push({ label: "Accept risk with annotation", module: "binder" });
    out.push({
      code: "SIG-009", severity: "warn", title: "Missing redundancy", target: w.id, involved: [w.id, ...procs.map((p) => p.id), ...feeding.map((e) => e.link!.id), ...backups.map((h) => h.id)],
      message: `${w.name} has no B path to ${procNames}: ${why}, so ${feeding.length === 1 ? edgeLabel(feeding[0]) : "the A feed"} is a single point of failure.`,
      rule: `When redundancy is expected every wall needs a path B link into its processor; ${procNames} has ${feeding.length} A link${feeding.length === 1 ? "" : "s"} and 0 B links.`,
      evidence: [
        ev(`B links into ${procNames}`, "0", "/signal/links"),
        ev(`A links into ${procNames}`, feeding.map((e) => edgeLabel(e)).join("; "), `/signal/links/${feeding[0].link!.id}`),
        ev("profile expects redundancy", String(ctx.profile.redundancyExpected), "profile.redundancyExpected"),
        ...backups.map((h) => ev(`${g.devices.get(h.deviceId)?.label ?? "server"} role`, h.role, `/servers/hosts/${h.id}/role`)),
        ev("redundancy groups", String(r.signal.redundancy.length), "/signal/redundancy"),
      ],
      fixes,
    });
  }

  // SIG-010 chain cycle
  for (const cy of findCycles(g)) {
    const e = cy.closing;
    const names = cy.devices.map((id) => g.devices.get(id)?.label ?? id);
    out.push({
      code: "SIG-010", severity: "block", title: "Chain cycle", target: e.link?.id ?? e.cable.id, involved: [e.cable.id, ...(e.link ? [e.link.id] : []), ...cy.devices],
      message: `${edgeLabel(e)} sends the signal back to ${e.to.device.label}, which is already upstream in the chain.`,
      rule: `A chain may not revisit a device; ${[...names, e.to.device.label].join(" → ")}.`,
      evidence: [ev("closing cable", `${cabLabel(e.cable.id)} (${edgeLabel(e)})`, `/cables/${e.cable.id}`), ev("chain", [...names, e.to.device.label].join(" → "), "/signal/links")],
      fixes: [{ label: `Remove ${cabLabel(e.cable.id)} or re-land it on a device downstream`, module: "signal" }],
    });
  }

  // SIG-011 port busy (pre-existing state; the store refuses new ones with E_PORT_BUSY)
  for (const [pid, cabs] of g.cablesByPort) {
    if (cabs.length < 2) continue;
    const ref = g.ports.get(pid);
    if (!ref || ref.port.dir === "bidir") continue;
    out.push({
      code: "SIG-011", severity: "block", title: "Port busy", target: pid, involved: [pid, ref.device.id, ...cabs.map((c) => c.id)],
      message: `${portLabel(ref)} has ${cabs.length} cables on it: ${cabs.map((c) => cabLabel(c.id)).join(", ")}.`,
      rule: `A ${ref.port.dir} ${ref.port.type} port carries one cable; it has ${cabs.length}.`,
      evidence: [
        ev(`cables on ${portLabel(ref)}`, cabs.map((c) => cabLabel(c.id)).join(", "), "/cables"),
        ev(`${portLabel(ref)} direction`, ref.port.dir, portPath(ref.device, pid)),
      ],
      fixes: [{ label: `Move ${cabLabel(cabs[cabs.length - 1].id)} to a free ${ref.port.type} port on ${ref.device.label}, or add a DA`, module: "signal" }],
    });
  }

  // SIG-013 recorder not on program
  const recorders = r.devices.filter((d) => d.class === "recorder");
  if (recorders.length) {
    const onPgm = recorders.some((rec) => inEdges(g, rec.id).some((e) => e.link && resolvesTo(g, e).some((x) => /\bPGM\b/i.test(x.link?.label ?? ""))));
    if (!onPgm) {
      const feeds = recorders.flatMap((rec) => inEdges(g, rec.id).filter((e) => e.link).map((e) => `${rec.label}: ${e.link!.label || edgeLabel(e)}`));
      const sw = r.devices.find((d) => d.class === "switcher");
      out.push({
        code: "SIG-013", severity: "warn", title: "Recorder not on program", target: recorders[0].id, involved: recorders.map((d) => d.id),
        message: `No recorder input resolves to a link labelled PGM${feeds.length ? ` (recorders see ${feeds.join("; ")})` : ""}.`,
        rule: `At least one recorder input must resolve (through pass-through devices) to a PGM link; ${feeds.length} recorder feed${feeds.length === 1 ? "" : "s"}, 0 on PGM.`,
        evidence: [
          ev("recorder feeds", feeds.length ? feeds.join("; ") : "none", "/signal/links"),
          ev("recorders", recorders.map((d) => d.label).join(", "), "/devices"),
          ev("record format", r.signal.formats.record || "(unset)", "/signal/formats/record"),
        ],
        fixes: [
          { label: sw ? `Cable ${sw.label} PGM (or a PGM aux) → ${recorders[0].label}` : `Feed ${recorders[0].label} from program`, module: "signal" },
          { label: "Relabel the recorder feed link PGM if it carries program", module: "signal" },
        ],
      });
    }
  }

  // SIG-014 reference missing
  const tcGens = r.devices.filter((d) => d.class === "tcGen");
  if (tcGens.length) for (const d of r.devices) {
    if (g.specOf(d).genlock !== true) continue;
    const gl = d.ports.filter((p) => p.type === "genlock" && canSink(p.dir));
    const fed = gl.some((p) => (g.cablesByPort.get(p.id) ?? []).some((c) => c.toPort === p.id || p.dir === "bidir"));
    if (fed) continue;
    out.push({
      code: "SIG-014", severity: "warn", title: "Reference missing", target: d.id, involved: [d.id, ...tcGens.map((t) => t.id)],
      message: `${d.label} takes genlock but has no reference cable while ${tcGens[0].label} is in the show.`,
      rule: `A device with spec.genlock = true needs an inbound genlock link when a sync generator exists; ${d.label} has 0.`,
      evidence: [
        ev(`${d.label} genlock inputs`, gl.length ? gl.map((p) => p.name).join(", ") + " (empty)" : "no genlock port", `/devices/${d.id}/ports`),
        ev("sync generator", tcGens.map((t) => t.label).join(", "), `/devices/${tcGens[0].id}`),
      ],
      fixes: [{ label: gl.length ? `Cable ${tcGens[0].label} REF OUT → ${d.label} ${gl[0].name} (BNC-ref)` : `Add a genlock input to ${d.label} or clear spec.genlock`, module: "signal" }],
    });
  }

  // SIG-015 timecode rate
  const house = parseFormat(r.signal.formats.house);
  if (house) {
    const expected = house.rate > 30 ? house.rate / 2 : house.rate;
    for (const e of g.edges) {
      if (e.from.port.type !== "LTC" || e.to.port.type !== "LTC" || !e.link?.format) continue;
      const m = /(\d+(?:\.\d+)?)/.exec(e.link.format);
      if (!m) continue;
      const rate = Number(m[1]);
      if (Math.abs(rate - expected) < 0.02 || Math.abs(rate - house.rate) < 0.02) continue;
      out.push({
        code: "SIG-015", severity: "warn", title: "Timecode rate", target: e.link.id, involved: [e.link.id, e.cable.id, e.from.device.id, e.to.device.id],
        message: `${edgeLabel(e)} carries LTC at ${e.link.format}, but the house format ${fmtShort(r.signal.formats.house)} runs at ${expected} fps.`,
        rule: `LTC frame rate must match the house format rate; ${rate} ≠ ${expected}.`,
        evidence: [ev("LTC rate", e.link.format, `/signal/links/${e.link.id}/format`), ev("house format", r.signal.formats.house, "/signal/formats/house")],
        fixes: [{ label: `Set the timecode generator to ${expected}${Math.abs(expected - 29.97) < 0.01 ? " DF" : ""}`, module: "servers" }],
      });
    }
  }

  // SIG-016 VLAN mismatch on cat6 links (only between devices that both have host entries)
  const vlansOf = (id: string) => new Set(r.signal.network.hosts.filter((h) => h.deviceId === id).map((h) => h.vlan));
  for (const e of g.edges) {
    if (e.cable.type !== "cat6") continue;
    const a = vlansOf(e.from.device.id);
    const b = vlansOf(e.to.device.id);
    if (!a.size || !b.size || [...a].some((v) => b.has(v))) continue;
    out.push({
      code: "SIG-016", severity: "warn", title: "VLAN mismatch", target: e.cable.id, involved: [e.cable.id, e.from.device.id, e.to.device.id],
      message: `${e.from.device.label} and ${e.to.device.label} are cabled on cat6 but share no VLAN.`,
      rule: `Both devices on a cat6 link need a VLAN in common; ${e.from.device.label} is on ${[...a].join(", ")}, ${e.to.device.label} on ${[...b].join(", ")}.`,
      evidence: [ev(`${e.to.device.label} VLANs`, [...b].join(", "), "/signal/network/hosts"), ev(`${e.from.device.label} VLANs`, [...a].join(", "), "/signal/network/hosts")],
      fixes: [{ label: `Add ${e.to.device.label} to VLAN ${[...a][0]}`, module: "signal" }],
    });
  }

  // SIG-017 cable length vs reach (segmented cables through a trunk are checked per segment by PHY-004)
  for (const c of r.cables) {
    if ((c.segments ?? []).some((s) => s.kind === "trunk-strand")) continue;
    const link = g.linkByCable.get(c.id);
    const fmt = link ? resolved.get(link.id)?.format ?? link.format : null;
    const reach = reachFt(c.type, fmt);
    if (!reach || c.type === "cat6" || c.length_ft <= reach.reach) continue;
    const e = g.edgeByCable.get(c.id);
    out.push({
      code: "SIG-017", severity: "warn", title: "Cable length", target: c.id, involved: [c.id, ...(link ? [link.id] : [])],
      message: `${cabLabel(c.id)}${e ? ` (${edgeLabel(e)})` : ""} is ${c.length_ft} ft of ${c.type}, beyond its ≈ ${reach.reach} ft reach${fmt ? ` at ${fmtShort(fmt)}` : ""}.`,
      rule: `${reach.basis}; cable is ${c.length_ft} ft.`,
      evidence: [ev(`${cabLabel(c.id)} length`, `${c.length_ft} ft`, `/cables/${c.id}/length_ft`), ev("reach", `${reach.reach} ft`, "port-rules"), ...(fmt ? [ev("format", describeFormat(fmt), `/signal/links/${link!.id}/format`)] : [])],
      fixes: c.type === "SDI"
        ? [{ label: "Insert a fibre pair (AJA FiDO-4T / 4R) or route through the trunk plan", module: "signal" }, { label: "Add a reclocking DA midway", module: "signal" }]
        : [{ label: "Use an active / fibre DisplayPort cable or move the server closer", module: "signal" }],
    });
  }

  // SIG-018 orphan device on the canvas
  for (const n of r.signal.nodes) {
    const d = g.devices.get(n.deviceId);
    if (!d || d.ports.some((p) => (g.cablesByPort.get(p.id)?.length ?? 0) > 0)) continue;
    out.push({
      code: "SIG-018", severity: "info", title: "Orphan device", target: d.id, involved: [d.id, n.id],
      message: `${d.label} is on the signal canvas with no cables.`,
      rule: `A device on the canvas should carry at least one cable; ${d.label} has 0.`,
      evidence: [ev(`cables on ${d.label}`, "0", `/devices/${d.id}/ports`), ev("canvas node", n.role, `/signal/nodes/${n.id}`)],
      fixes: [
        { label: `Remove ${d.label} from the canvas`, module: "signal", patch: [{ op: "remove", path: `/signal/nodes/${n.id}` }] },
        { label: `Cable ${d.label} into the system`, module: "signal" },
      ],
    });
  }

  out.push(...physicalChecks(r, g, resolved));
  return out;
}

// ---------------- derive ----------------
export function deriveSignal(r: ShowRecord, lib: LibraryLookup | null = defaultLibrary): Partial<Derived> {
  const g = buildGraph(r, specResolver(lib));
  const resolved = resolveFormats(g);
  const unresolvedPorts = [...new Set(r.cables.flatMap((c) => [c.fromPort, c.toPort]).filter((p): p is string => !!p && !g.ports.has(p)))];
  const formatMismatches = new Set<string>();
  for (const l of r.signal.links) {
    const e = g.edgeByCable.get(l.cableId);
    const res = resolved.get(l.id);
    if (!e || !res?.format) continue;
    const compat = compatible(e.from.port.type, e.to.port.type);
    if (compat && !formatFits(res.format, e.to.port.type, compat.maxFormat ?? PORT_MAX_FORMAT[e.to.port.type]).ok) formatMismatches.add(l.id);
    if (e.to.device.class === "processor" && isVideoPort(e.to.port.type)) {
      const acc = g.specOf(e.to.device).acceptedFormats;
      const accepted = Array.isArray(acc) ? acc.filter((x): x is string => typeof x === "string") : [];
      if ((accepted.length && !accepted.some((a) => sameFormat(a, res.format))) || (r.signal.formats.ledInput && !sameFormat(r.signal.formats.ledInput, res.format))) formatMismatches.add(l.id);
    }
  }
  const singles = [...new Set(singlePoints(g).flatMap((s) => s.shared.map((x) => x.id)))];
  const resolvedFormat: Record<string, string> = {};
  for (const [id, v] of resolved) resolvedFormat[id] = v.format;
  const builds = deriveSegments(r);
  const phys = physicalDerived(r, builds);
  return {
    signal: { unresolvedPorts, formatMismatches: [...formatMismatches], singlePoints: singles, resolvedFormat },
    physical: phys.physical,
    // Only the cable rollup: the store merges inventory key by key, so other modules' counts survive.
    inventory: { cableCountByType: phys.cableCountByType } as Derived["inventory"],
  };
}

// ---------------- seed ----------------
const LOCAL_SWITCHER: DeviceTemplate = {
  templateId: "tpl_ross_carbonite_ultra", class: "switcher", make: "Ross", model: "Carbonite Ultra", ru: 2, powerW: 150, weightLb: 18, source: "approximate",
  ports: [{ name: "SDI IN", type: "12G-SDI", dir: "in", count: 24 }, { name: "SDI OUT", type: "12G-SDI", dir: "out", count: 14 }, { name: "GENLOCK IN", type: "genlock", dir: "in", count: 1 }, { name: "NET", type: "cat6", dir: "bidir", count: 1 }],
  spec: { formatRule: "converting" },
};
const LOCAL_ROUTER: DeviceTemplate = {
  templateId: "tpl_ross_ultrix_fr1", class: "router", make: "Ross", model: "Ultrix FR1", ru: 1, powerW: 120, weightLb: 15, source: "approximate",
  ports: [{ name: "SDI IN", type: "12G-SDI", dir: "in", count: 36 }, { name: "SDI OUT", type: "12G-SDI", dir: "out", count: 36 }, { name: "NET", type: "cat6", dir: "bidir", count: 1 }],
  spec: { formatRule: "pass-through" },
};

export function seedSignal(r: ShowRecord, ctx: SeedContext): Patch[] {
  const ops: Patch[] = [];
  const f = r.signal.formats;
  const formats = { ...f, house: f.house || DEFAULT_FORMATS.house, ledInput: f.ledInput || DEFAULT_FORMATS.ledInput, record: f.record || f.house || DEFAULT_FORMATS.record };
  if (formats.house !== f.house || formats.ledInput !== f.ledInput || formats.record !== f.record) ops.push({ op: "replace", path: "/signal/formats", value: formats });
  if (!r.signal.network.vlans.length) ops.push({ op: "replace", path: "/signal/network/vlans", value: DEFAULT_VLANS });
  const added: Device[] = [];
  const labels = new Set(r.devices.map((d) => d.label.toLowerCase()));
  const want: [DeviceClass, string, DeviceTemplate][] = [["switcher", "SW-1", LOCAL_SWITCHER], ["router", "RTR-1", LOCAL_ROUTER]];
  for (const [cls, label, local] of want) {
    if (r.devices.some((d) => d.class === cls) || labels.has(label.toLowerCase())) continue;
    let t: DeviceTemplate | undefined;
    try { t = defaultLibrary.get(local.templateId); } catch { t = undefined; }
    const dev = instantiate(t ?? local, label, ctx.newId);
    added.push(dev);
    ops.push({ op: "add", path: "/devices/-", value: dev });
  }
  ops.push(...nodePatches(r, added, ctx.newId));
  ops.push(...seedPhysical(r, ctx.newId));
  return ops;
}

// ---------------- exports ----------------
function csv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map((v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n") + "\n";
}

function endName(r: ShowRecord, end: { port: string } | { jack: string; side: "front" | "rear" } | { strand: string }, jacks: ReturnType<typeof jackIndex>): string {
  if ("port" in end) {
    if (!end.port) return "(coupler)";
    for (const d of r.devices) { const p = d.ports.find((x) => x.id === end.port); if (p) return `${d.label}:${p.name}`; }
    return "(missing port)";
  }
  if ("jack" in end) { const j = jacks.get(end.jack); return j ? `${jackLabel(j.panel, j.jack)} ${end.side}` : end.jack; }
  return end.strand;
}

function abOf(r: ShowRecord, cableId: string): string {
  const c = r.cables.find((x) => x.id === cableId);
  const l = r.signal.links.find((x) => x.cableId === cableId);
  return c?.redundancyGroup ?? (l && r.signal.redundancy.some((g) => g.primary.includes(l.id) || g.backup.includes(l.id)) ? l.path : "");
}

export function renderCablePull(r: ShowRecord): string {
  const builds = deriveSegments(r);
  const jacks = jackIndex(r);
  const pathName = (id?: string) => { const p = r.physical.paths.find((x) => x.id === id); return p ? `${p.from.replace(/^pos_/, "")}–${p.to.replace(/^pos_/, "")}` : ""; };
  const groups = new Map<string, { type: string; stock: number; labels: string[]; ends: string[]; paths: Set<string>; ab: Set<string> }>();
  for (const b of builds.values()) for (const s of b.segments) {
    if (s.kind === "trunk-strand") continue;
    const key = `${b.type}|${s.length_ft.stock}`;
    const gr = groups.get(key) ?? { type: b.type, stock: s.length_ft.stock, labels: [], ends: [], paths: new Set<string>(), ab: new Set<string>() };
    gr.labels.push(s.label);
    gr.ends.push(`${endName(r, s.from, jacks)} → ${endName(r, s.to, jacks)}`);
    if (s.pathId) gr.paths.add(pathName(s.pathId));
    const ab = abOf(r, b.cableId);
    if (ab) gr.ab.add(ab);
    groups.set(key, gr);
  }
  const rows = [...groups.values()].sort((a, b) => a.type.localeCompare(b.type) || a.stock - b.stock)
    .map((gr) => [gr.type, gr.stock, gr.labels.length, gr.labels.join("; "), gr.ends.join("; "), [...gr.paths].join("; "), [...gr.ab].join("/")]);
  return csv([["type", "stock_ft", "qty", "labels", "from → to", "path", "A/B"], ...rows]);
}

export function renderPanelSchedule(r: ShowRecord): string {
  const rows: (string | number)[][] = [];
  const byId = new Map(r.cables.map((c) => [c.id, c]));
  const labels = cableLabels(r);
  for (const d of r.devices) {
    if (d.class !== "patchPanel") continue;
    for (const j of jacksOf(d)) {
      const cab = byId.get(j.front.cableId ?? j.rear.cableId ?? "");
      rows.push([d.label, jackLabel(d, j), j.type, j.front.cableId ? labels.get(j.front.cableId) ?? "" : "", j.rear.cableId ? labels.get(j.rear.cableId) ?? "" : "", cab ? bothEndsTag(r, cab) : ""]);
    }
  }
  return csv([["panel", "jack", "type", "front cable", "rear cable", "far-end tag"], ...rows]);
}

export function renderTrunkMap(r: ShowRecord): string {
  const rows: (string | number)[][] = [];
  const labels = cableLabels(r);
  for (const tid of r.physical.trunks) {
    const t = r.cables.find((c) => c.id === tid);
    if (!t) continue;
    for (const c of r.cables) for (const s of c.segments ?? []) {
      if (s.kind !== "trunk-strand" || !s.reelRef?.startsWith(`${tid}/`)) continue;
      const strand = s.reelRef.split("/")[1];
      rows.push([labels.get(t.id) ?? t.label, `${labels.get(t.id) ?? t.label}/${strand}`, labels.get(c.id) ?? c.label, bothEndsTag(r, c)]);
    }
  }
  return csv([["trunk", "strand", "cable", "from → to"], ...rows]);
}

export function renderRunList(r: ShowRecord): string {
  const phys = physicalDerived(r);
  const posLabel = (id: string) => r.physical.positions.find((p) => p.id === id)?.label ?? id;
  const rows = r.physical.paths.map((p) => {
    const slot = phys.physical.byPath[p.id] ?? { cables: 0, byType: {}, totalFt: 0 };
    return [`${posLabel(p.from)} ↔ ${posLabel(p.to)}`, p.route, p.length_ft.value == null ? "" : p.length_ft.value, p.length_ft.state, slot.cables,
      Object.entries(slot.byType).map(([k, v]) => `${k} ×${v}`).join("; "), slot.totalFt, p.protection ?? ""];
  });
  return csv([["path", "route", "length_ft", "state", "cables", "by type", "total_ft", "protection"], ...rows]);
}

export function renderLabelSheet(r: ShowRecord): string {
  const builds = deriveSegments(r);
  const jacks = jackIndex(r);
  const rows: string[][] = [];
  for (const b of builds.values()) {
    const c = r.cables.find((x) => x.id === b.cableId)!;
    const tag = bothEndsTag(r, c, jacks);
    const colour = colourFor(r, c);
    for (const s of b.segments) {
      if (s.kind === "trunk-strand") continue;
      rows.push([`${tag} [${endName(r, s.from, jacks)}]`, colour, s.label]);
      rows.push([`${tag} [${endName(r, s.to, jacks)}]`, colour, s.label]);
    }
  }
  return csv([["both-ends tag", "colour", "cable label"], ...rows]);
}

export function renderLinkList(r: ShowRecord): string {
  const g = buildGraph(r, specResolver(defaultLibrary));
  const resolved = resolveFormats(g);
  const labels = cableLabels(r);
  const rows = r.signal.links.map((l) => {
    const e = g.edgeByCable.get(l.cableId);
    const c = g.cables.get(l.cableId);
    return [l.label, e ? portLabel(e.from) : "", e ? portLabel(e.to) : "", c ? labels.get(c.id) ?? c.label : "", c?.type ?? "", resolved.get(l.id)?.format ?? l.format, l.path];
  });
  return csv([["link", "from", "to", "cable", "type", "format", "path"], ...rows]);
}

// ---------------- the contract ----------------
export const signalModule: ModuleContract = {
  id: "signal",
  version: "1.0.0",
  owns: ["/signal", "/physical"],
  reads: ["/devices", "/cables", "/led/walls", "/servers/hosts", "/event", "/racks", "/signal", "/physical"],
  deviceClasses: [...SIGNAL_DEVICE_CLASSES, "patchPanel"],
  cableTypes: SIGNAL_CABLE_TYPES,
  seed: seedSignal,
  derive: (r) => deriveSignal(r),
  validate: validateSignal,
  exports: [
    { key: "cable-pull", label: "Cable pull", mime: "text/csv", render: renderCablePull },
    { key: "panel-schedule", label: "Panel schedule", mime: "text/csv", render: renderPanelSchedule },
    { key: "trunk-map", label: "Trunk map", mime: "text/csv", render: renderTrunkMap },
    { key: "run-list", label: "Run list by path", mime: "text/csv", render: renderRunList },
    { key: "label-sheet", label: "Label sheet", mime: "text/csv", render: renderLabelSheet },
    { key: "link-list", label: "Signal link list", mime: "text/csv", render: renderLinkList },
  ],
};

export { SIGNAL_CLASSES, allChains };
export default signalModule;
