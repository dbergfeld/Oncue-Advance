// Reference index: every `→ id` field in the record, with the prefix it must carry.
import { prefixOf } from "./ids";
import type { ShowRecord } from "./types";

export interface RefSite {
  path: string;          // pointer to the field (or array element) holding the reference
  value: string;
  expect: string[];      // allowed prefixes
  nullable: boolean;     // cascade may null it
  arrayItem: boolean;    // cascade may drop it from its array
  owner: string;         // slice the reference lives in (for cascade rules)
}

export function entityIndex(r: ShowRecord): Map<string, string> {
  const m = new Map<string, string>();
  const put = (id: string | undefined, path: string) => { if (id) m.set(id, path); };
  r.devices.forEach((d) => { put(d.id, `/devices/${d.id}`); d.ports.forEach((p) => put(p.id, `/devices/${d.id}/ports/${p.id}`));
    ((d.spec?.jacks as { id: string }[] | undefined) ?? []).forEach((j) => put(j.id, `/devices/${d.id}/spec/jacks/${j.id}`)); });
  r.cables.forEach((c) => put(c.id, `/cables/${c.id}`));
  r.led.walls.forEach((w) => { put(w.id, `/led/walls/${w.id}`); w.power.circuits.forEach((c) => put(c.id, `/led/walls/${w.id}/power/circuits/${c.id}`)); });
  r.signal.nodes.forEach((n) => put(n.id, `/signal/nodes/${n.id}`));
  r.signal.links.forEach((l) => put(l.id, `/signal/links/${l.id}`));
  r.signal.redundancy.forEach((g) => put(g.id, `/signal/redundancy/${g.id}`));
  r.racks.forEach((k) => put(k.id, `/racks/${k.id}`));
  r.servers.hosts.forEach((h) => put(h.id, `/servers/hosts/${h.id}`));
  r.binder.sections.forEach((s) => put(s.id, `/binder/sections/${s.id}`));
  r.binder.annotations.forEach((a) => put(a.id, `/binder/annotations/${a.id}`));
  r.binder.checks.forEach((c) => put(c.id, `/binder/checks/${c.id}`));
  r.binder.schedule.forEach((s) => put(s.id, `/binder/schedule/${s.id}`));
  r.binder.contacts.forEach((c) => put(c.id, `/binder/contacts/${c.id}`));
  r.tasks.forEach((t) => put(t.id, `/tasks/${t.id}`));
  r.physical.positions.forEach((p) => put(p.id, `/physical/positions/${p.id}`));
  r.physical.paths.forEach((p) => put(p.id, `/physical/paths/${p.id}`));
  for (const sl of r.show?.setlists ?? []) {
    put(sl.id, `/show/setlists/${sl.id}`);
    for (const s of sl.songs) {
      put(s.id, `/show/setlists/${sl.id}/songs/${s.id}`);
      s.cues.forEach((c) => put(c.id, `/show/setlists/${sl.id}/songs/${s.id}/cues/${c.id}`));
      s.cameraNotes.forEach((n) => put(n.id, `/show/setlists/${sl.id}/songs/${s.id}/cameraNotes/${n.id}`));
    }
  }
  return m;
}

export function refSites(r: ShowRecord): RefSite[] {
  const out: RefSite[] = [];
  const one = (path: string, value: string | null | undefined, expect: string[], nullable: boolean, owner: string) => {
    if (value) out.push({ path, value, expect, nullable, arrayItem: false, owner });
  };
  const many = (path: string, values: string[] | undefined, expect: string[], owner: string) => {
    (values ?? []).forEach((v, i) => v && out.push({ path: `${path}/${i}`, value: v, expect, nullable: false, arrayItem: true, owner }));
  };
  for (const d of r.devices) {
    one(`/devices/${d.id}/rackId`, d.rackId, ["rack"], true, "devices");
    one(`/devices/${d.id}/positionId`, d.positionId, ["pos"], true, "devices");
  }
  for (const c of r.cables) {
    // A cable whose port is gone cannot be nulled; cascade deletes the cable.
    one(`/cables/${c.id}/fromPort`, c.fromPort, ["p"], false, "cables");
    one(`/cables/${c.id}/toPort`, c.toPort, ["p"], false, "cables");
    many(`/cables/${c.id}/pathChain`, c.pathChain, ["path"], "cables");
  }
  for (const w of r.led.walls) {
    many(`/led/walls/${w.id}/processorIds`, w.processorIds, ["dev"], "led");
    w.dataRuns.forEach((d, i) => one(`/led/walls/${w.id}/dataRuns/${i}/portId`, d.portId, ["p"], false, "led"));
    one(`/led/walls/${w.id}/power/distroId`, w.power.distroId, ["dev"], true, "led");
  }
  r.led.canvas.mappings.forEach((m, i) => one(`/led/canvas/mappings/${i}/wallId`, m.wallId, ["wall"], false, "led"));
  for (const n of r.signal.nodes) one(`/signal/nodes/${n.id}/deviceId`, n.deviceId, ["dev"], false, "signal");
  for (const l of r.signal.links) one(`/signal/links/${l.id}/cableId`, l.cableId, ["cab"], false, "signal");
  for (const g of r.signal.redundancy) {
    many(`/signal/redundancy/${g.id}/primary`, g.primary, ["lnk"], "signal");
    many(`/signal/redundancy/${g.id}/backup`, g.backup, ["lnk"], "signal");
  }
  r.signal.network.hosts.forEach((h, i) => one(`/signal/network/hosts/${i}/deviceId`, h.deviceId, ["dev"], false, "signal"));
  for (const k of r.racks) {
    k.slots.forEach((s, i) => one(`/racks/${k.id}/slots/${i}/deviceId`, s.deviceId, ["dev"], false, "racks"));
    many(`/racks/${k.id}/power/pduIds`, k.power.pduIds, ["dev"], "racks");
    many(`/racks/${k.id}/power/circuitIds`, k.power.circuitIds, ["ckt"], "racks");
  }
  for (const h of r.servers.hosts) {
    one(`/servers/hosts/${h.id}/deviceId`, h.deviceId, ["dev"], false, "servers");
    h.outputs.forEach((o, i) => {
      one(`/servers/hosts/${h.id}/outputs/${i}/portId`, o.portId, ["p"], false, "servers");
      one(`/servers/hosts/${h.id}/outputs/${i}/feedsWallId`, o.feedsWallId, ["wall"], true, "servers");
    });
    h.inputs.forEach((o, i) => one(`/servers/hosts/${h.id}/inputs/${i}/portId`, o.portId, ["p"], false, "servers"));
    one(`/servers/hosts/${h.id}/failover`, h.failover, ["srv"], true, "servers");
  }
  r.servers.content.contentSpecs.forEach((c, i) => one(`/servers/content/contentSpecs/${i}/wallId`, c.wallId, ["wall"], false, "servers"));
  for (const t of r.tasks) many(`/tasks/${t.id}/blockedBy`, t.blockedBy, ["task"], "tasks");
  // Show Book. Roster slots and camera notes drop with their camera on cascade (the store parks dropped notes in
  // show.unbound so SHW-001 warns); a look on a removed server nulls; a wall state on a removed wall drops.
  // cue.target and cue.action.ref are soft (any entity, or free text) — SHW-005 reports dangling action refs.
  const item = (path: string, value: string | undefined, expect: string[]) => { if (value) out.push({ path, value, expect, nullable: false, arrayItem: true, owner: "show" }); };
  (r.show?.cameraRoster ?? []).forEach((s, i) => item(`/show/cameraRoster/${i}`, s.cameraId, ["dev"]));
  for (const sl of r.show?.setlists ?? []) for (const s of sl.songs) {
    const base = `/show/setlists/${sl.id}/songs/${s.id}`;
    s.cameraNotes.forEach((n) => item(`${base}/cameraNotes/${n.id}`, n.cameraId, ["dev"]));
    one(`${base}/lookRef/serverId`, s.lookRef?.serverId, ["srv"], true, "show");
    (s.wallState ?? []).forEach((w, i) => item(`${base}/wallState/${i}`, w.wallId, ["wall"]));
  }
  return out;
}

export interface RefProblem { site: RefSite; code: "E_REF_MISSING" | "E_REF_TYPE" }

export function refProblems(r: ShowRecord): RefProblem[] {
  const idx = entityIndex(r);
  const out: RefProblem[] = [];
  for (const s of refSites(r)) {
    const p = prefixOf(s.value);
    if (!p || !s.expect.includes(p)) out.push({ site: s, code: "E_REF_TYPE" });
    else if (!idx.has(s.value)) out.push({ site: s, code: "E_REF_MISSING" });
  }
  return out;
}
