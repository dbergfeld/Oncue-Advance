// First-advance exit criteria (New-show path tab), Binder summary, and wizard step completion.
import { profileFor, sectionVisible } from "./profiles";
import { isSet } from "./tasks";
import type { BinderSectionKey, Derived, Severity, ShowRecord } from "./types";

export const BINDER_KEYS: BinderSectionKey[] = ["front-view", "rigging", "video-system", "led", "cameras", "network", "foh", "power", "schedule", "contacts", "notes"];

const has = (r: ShowRecord, re: RegExp, key?: string[]) => r.binder.schedule.some((s) => (key && s.key && key.includes(s.key)) || re.test(s.item));

export function hasLoadIn(r: ShowRecord): boolean {
  // Festival profiles have a changeover template with no load-in; the changeover stands in for it.
  return has(r, /load-in/i, ["load-in"]) || (r.event.type === "festival" && has(r, /changeover/i, ["set"]));
}
export function hasShow(r: ShowRecord): boolean {
  return has(r, /\bshow\b/i, ["show"]);
}

const VIDEO_IN = ["12G-SDI", "3G-SDI", "HD-SDI", "HDMI2.0", "HDMI2.1", "DP1.2", "DP1.4", "DVI"];

/** Processors driving a wall whose inputs carry no linked signal. */
export function unfedProcessors(r: ShowRecord): string[] {
  const linkedCables = new Set(r.signal.links.map((l) => l.cableId));
  const out: string[] = [];
  const procIds = new Set(r.led.walls.flatMap((w) => w.processorIds));
  for (const id of procIds) {
    const d = r.devices.find((x) => x.id === id);
    if (!d) { out.push(id); continue; }
    const inPorts = new Set(d.ports.filter((p) => p.dir !== "out" && VIDEO_IN.includes(p.type)).map((p) => p.id));
    const fed = r.cables.some((c) => c.toPort && inPorts.has(c.toPort) && linkedCables.has(c.id));
    if (!fed) out.push(id);
  }
  return out;
}

export function readiness(r: ShowRecord): Derived["readiness"] {
  const profile = profileFor(r.event.type);
  const walls = r.led.walls;
  const perWall = r.derived?.led?.perWall ?? {};
  const byCircuit = r.derived?.power?.byCircuit ?? {};
  const byRack = r.derived?.racks?.byRack ?? {};

  const circuitsOver = Object.entries(byCircuit).filter(([, c]) => c.amps > 0 && c.loadA > 0.8 * c.amps);
  const specMismatch = r.servers.hosts.length === 0 ? [] : walls.filter((w) => {
    const px = perWall[w.id];
    if (!px || !(px.w_px > 0)) return false;
    const spec = r.servers.content.contentSpecs.find((s) => s.wallId === w.id);
    return !spec || spec.w_px !== px.w_px || spec.h_px !== px.h_px;
  });
  const unracked = r.devices.filter((d) => d.ru > 0 && !d.rackId);
  const overflow = r.racks.filter((k) => (byRack[k.id]?.ruUsed ?? 0) > k.ruTotal);
  const requiredHidden = r.binder.sections.filter((s) => s.required && !s.visible);
  const openBlocks = r.binder.checks.filter((c) => c.severity === "block" && !c.resolved);

  const criteria: Derived["readiness"]["criteria"] = [
    { label: "Identity complete: artist, name, event type, at least one date, venue name and city", blocks: true,
      ok: !!r.client.artist.trim() && !!r.name.trim() && !!r.event.type && r.event.dates.length > 0 && !!r.event.venueName.trim() && !!r.event.city.trim() },
    { label: "Vendor order ref present", blocks: false, ok: !!r.vendor.orderRef.trim() },
    { label: "Every LED wall has cols × rows > 0 and a tile model", blocks: true, ok: walls.every((w) => w.cols > 0 && w.rows > 0 && !!w.tileModel) },
    { label: "Every wall has at least one processor and every processor input has a feeding link", blocks: true,
      ok: walls.every((w) => w.processorIds.length > 0) && unfedProcessors(r).length === 0 },
    { label: "No circuit over 80% rated load", blocks: true, ok: circuitsOver.length === 0 },
    { label: "Server content spec matches canvas px for every wall", blocks: false, ok: specMismatch.length === 0 },
    { label: "Every device with ru > 0 is racked and no rack overflows", blocks: true, ok: unracked.length === 0 && overflow.length === 0 },
    { label: "Redundancy groups defined wherever the profile expects them", blocks: false,
      ok: !profile.redundancyExpected || walls.length === 0 || r.signal.redundancy.length > 0 },
    { label: "Crew Chief and EIC named", blocks: false, ok: !!r.crew.crewChief.trim() && !!r.crew.eic.trim() },
    { label: "Schedule has load-in and show entries", blocks: false, ok: hasLoadIn(r) && hasShow(r) },
    { label: "All required Binder sections visible", blocks: true, ok: requiredHidden.length === 0 },
    { label: "Zero unresolved block checks", blocks: true, ok: openBlocks.length === 0 },
  ];
  return { advance: criteria.every((c) => c.ok || !c.blocks), criteria };
}

// ---------------------------------------------------------------- binder summary

const pct = (items: boolean[]) => (items.length ? Math.round((100 * items.filter(Boolean).length) / items.length) : 100);

export function sectionCompleteness(r: ShowRecord, key: BinderSectionKey): number {
  const profile = profileFor(r.event.type);
  const walls = r.led.walls;
  switch (key) {
    case "front-view":
      return pct([!!r.client.artist, !!r.name, r.event.dates.length > 0, !!r.event.venueName, !!r.event.city, !!r.vendor.orderRef]);
    case "rigging": {
      const g = r.event.rigging;
      return pct([isSet(g.maxTrim_ft), isSet(g.points) || isSet(g.pointCapacity_lb), isSet(g.plotRef), isSet(g.motors), walls.every((w) => w.rigging.headers > 0 || w.rigging.type === "ground")]);
    }
    case "video-system":
      return pct([!!r.signal.formats.house, !!r.signal.formats.ledInput, r.signal.links.length > 0, r.devices.some((d) => d.class === "switcher"), r.racks.length > 0]);
    case "led":
      if (!walls.length) return profile.walls.length ? 0 : 100;
      return pct(walls.flatMap((w) => [w.cols > 0 && w.rows > 0, w.processorIds.length > 0, w.dataRuns.length > 0, w.power.circuits.length > 0]));
    case "cameras": {
      const cams = r.devices.filter((d) => d.class === "camera").length;
      return pct([cams >= profile.cameras, isSet(r.event.cameras.positions) || profile.cameras === 0]);
    }
    case "network":
      return pct([r.signal.network.vlans.length > 0, r.signal.network.hosts.length > 0]);
    case "foh":
      return pct([isSet(r.event.foh), isSet(r.event.signalPath.stageToFOH)]);
    case "power":
      return pct([isSet(r.event.power.services) || isSet(r.event.power.amps), walls.every((w) => w.power.circuits.length > 0), walls.every((w) => !!w.power.distroId)]);
    case "schedule":
      return pct([hasLoadIn(r), hasShow(r), r.binder.schedule.length >= 2]);
    case "contacts":
      return pct([!!r.crew.videoDirector, !!r.crew.crewChief, !!r.crew.eic, !!r.crew.ledLead, !!r.crew.cameraLead, !!r.crew.serverOp, r.binder.contacts.length > 0]);
    case "notes": {
      const sec = r.binder.sections.find((s) => s.key === "notes");
      return sec?.blocks.some((b) => b.type !== "auto" && b.body.trim()) || r.binder.annotations.length > 0 ? 100 : 0;
    }
  }
}

export function binderSummary(r: ShowRecord): Derived["binder"] {
  const completeness: Record<string, number> = {};
  const profile = profileFor(r.event.type);
  const keys = r.binder.sections.length ? r.binder.sections.filter((s) => s.visible).map((s) => s.key) : BINDER_KEYS.filter((k) => sectionVisible(profile, k));
  for (const k of keys) completeness[k] = sectionCompleteness(r, k);
  const openBySeverity: Record<Severity, number> = { block: 0, warn: 0, info: 0 };
  for (const c of r.binder.checks) if (!c.resolved) openBySeverity[c.severity] += 1;
  return { completeness, openBySeverity };
}

/** Wizard completion is read from the record, never remembered (New-show path tab). */
export function setupCompleted(r: ShowRecord): Record<number, boolean> {
  return {
    1: !!r.client.artist && !!r.name && r.event.dates.length > 0 && !!r.event.venueName,
    2: !!r.signal.formats.house && r.racks.length > 0,
    3: r.led.walls.every((w) => w.cols > 0 && w.rows > 0 && w.processorIds.length > 0),
    4: !!r.crew.crewChief && !!r.crew.eic,
    5: r.binder.schedule.some((s) => /load-in/i.test(s.item)) && r.binder.schedule.some((s) => /show/i.test(s.item)),
  };
}

export function firstIncompleteStep(r: ShowRecord): 1 | 2 | 3 | 4 | 5 | 6 {
  const c = setupCompleted(r);
  for (const k of [1, 2, 3, 4, 5] as const) if (!c[k]) return k;
  return 6;
}
