// Slice-level schema checks (E_SCHEMA): required ids with the right prefix, closed enums.
import { prefixOf } from "./ids";
import { startsWith } from "./pointer";
import { EVENT_TYPES, type ShowRecord, type StoreError } from "./types";

export const DEVICE_CLASSES = ["tile", "processor", "distro", "ledPdu", "camera", "ccu", "switcher", "router", "converter", "recorder", "monitor", "fiber",
  "rackPdu", "ups", "shelf", "patchPanel", "server", "kvm", "capture", "tcGen", "unknown"];
export const PORT_TYPES = ["12G-SDI", "3G-SDI", "HD-SDI", "HDMI2.0", "HDMI2.1", "DP1.2", "DP1.4", "DVI", "fiberLED", "etherCon", "fiber-SMPTE", "fiber-LC", "fiber-ST",
  "cat6", "genlock", "LTC", "tally", "intercom", "dmx", "AC-in", "AC-out", "DC-in"];
export const CABLE_TYPES = ["SDI", "HDMI", "DP", "DP-HDMI", "SMPTE-311", "fiber", "cat6", "tally", "comms", "BNC-ref", "audio-TRS", "BNC", "power", "etherCon", "fiberLED", "tilePower"];
const LANES = ["advance", "signal", "crew", "led", "servers", "rack", "prep"];
const TASK_STATUS = ["todo", "doing", "blocked", "done", "na"];
const SEVERITY = ["info", "warn", "block"];
const CONFIRM = ["unknown", "asked", "assumed", "confirmed", "waived"];

function e(path: string, msg: string): StoreError { return { code: "E_SCHEMA", path, msg }; }

function idOk(id: unknown, prefix: string): boolean {
  return typeof id === "string" && prefixOf(id) === prefix;
}

export function schemaErrors(r: ShowRecord, touched: string[]): StoreError[] {
  const hit = (p: string) => touched.some((t) => startsWith(t, p) || startsWith(p, t));
  const out: StoreError[] = [];
  if (hit("/event") && !EVENT_TYPES.includes(r.event.type)) out.push(e("/event/type", `event.type must be one of ${EVENT_TYPES.join(", ")}`));
  if (hit("/event") && !Array.isArray(r.event.dates)) out.push(e("/event/dates", "dates must be an array"));
  if (hit("/event")) {
    const walk = (o: unknown, path: string) => {
      if (!o || typeof o !== "object" || Array.isArray(o)) return;
      const rec = o as Record<string, unknown>;
      if ("state" in rec && "value" in rec) { if (!CONFIRM.includes(rec.state as string)) out.push(e(path + "/state", `invalid confirmation state ${String(rec.state)}`)); return; }
      for (const [k, v] of Object.entries(rec)) walk(v, `${path}/${k}`);
    };
    walk(r.event, "/event");
  }
  if (hit("/devices")) {
    if (!Array.isArray(r.devices)) return [e("/devices", "devices must be an array")];
    for (const d of r.devices) {
      const p = `/devices/${d.id}`;
      if (!idOk(d.id, "dev")) out.push(e(p, "device id must be dev_*"));
      if (!DEVICE_CLASSES.includes(d.class)) out.push(e(p + "/class", `unknown device class ${d.class}`));
      if (typeof d.label !== "string") out.push(e(p + "/label", "label required"));
      if (typeof d.ru !== "number" || d.ru < 0) out.push(e(p + "/ru", "ru must be a number ≥ 0"));
      if (!Array.isArray(d.ports)) { out.push(e(p + "/ports", "ports must be an array")); continue; }
      for (const port of d.ports) {
        if (!idOk(port.id, "p")) out.push(e(p + "/ports", `port id must be p_* (${port.id})`));
        if (!PORT_TYPES.includes(port.type)) out.push(e(p + `/ports/${port.id}/type`, `unknown port type ${port.type}`));
        if (!["in", "out", "bidir"].includes(port.dir)) out.push(e(p + `/ports/${port.id}/dir`, `bad dir ${port.dir}`));
      }
      if (out.length) break;
    }
  }
  if (hit("/cables")) for (const c of r.cables) {
    if (!idOk(c.id, "cab")) out.push(e(`/cables/${c.id}`, "cable id must be cab_*"));
    if (!CABLE_TYPES.includes(c.type)) out.push(e(`/cables/${c.id}/type`, `unknown cable type ${c.type}`));
    if (typeof c.length_ft !== "number" || c.length_ft < 0) out.push(e(`/cables/${c.id}/length_ft`, "length_ft must be ≥ 0"));
  }
  if (hit("/led")) for (const w of r.led.walls) {
    if (!idOk(w.id, "wall")) out.push(e(`/led/walls/${w.id}`, "wall id must be wall_*"));
    if (!(w.cols >= 0 && w.rows >= 0)) out.push(e(`/led/walls/${w.id}`, "cols and rows must be ≥ 0"));
    for (const c of w.power?.circuits ?? []) if (!idOk(c.id, "ckt")) out.push(e(`/led/walls/${w.id}/power`, "circuit id must be ckt_*"));
  }
  if (hit("/racks")) for (const k of r.racks) {
    if (!idOk(k.id, "rack")) out.push(e(`/racks/${k.id}`, "rack id must be rack_*"));
    if (!(k.ruTotal > 0)) out.push(e(`/racks/${k.id}/ruTotal`, "ruTotal must be > 0"));
  }
  if (hit("/signal")) {
    for (const l of r.signal.links) { if (!idOk(l.id, "lnk")) out.push(e(`/signal/links/${l.id}`, "link id must be lnk_*")); if (!["A", "B"].includes(l.path)) out.push(e(`/signal/links/${l.id}/path`, "path must be A or B")); }
    for (const n of r.signal.nodes) if (!idOk(n.id, "sig")) out.push(e(`/signal/nodes/${n.id}`, "node id must be sig_*"));
    for (const g of r.signal.redundancy) if (!idOk(g.id, "rg")) out.push(e(`/signal/redundancy/${g.id}`, "group id must be rg_*"));
  }
  if (hit("/servers")) for (const h of r.servers.hosts) if (!idOk(h.id, "srv")) out.push(e(`/servers/hosts/${h.id}`, "host id must be srv_*"));
  if (hit("/tasks")) for (const t of r.tasks) {
    if (!idOk(t.id, "task")) out.push(e(`/tasks/${t.id}`, "task id must be task_*"));
    if (!LANES.includes(t.lane)) out.push(e(`/tasks/${t.id}/lane`, `unknown lane ${t.lane}`));
    if (!TASK_STATUS.includes(t.status)) out.push(e(`/tasks/${t.id}/status`, `unknown status ${t.status}`));
  }
  if (hit("/binder/checks")) for (const c of r.binder.checks) {
    if (!idOk(c.id, "chk")) out.push(e(`/binder/checks/${c.id}`, "check id must be chk_*"));
    if (!SEVERITY.includes(c.severity)) out.push(e(`/binder/checks/${c.id}/severity`, "bad severity"));
  }
  return out.slice(0, 5);
}
