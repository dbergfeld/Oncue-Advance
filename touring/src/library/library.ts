// Device library (Device library tab + panel templates from the Cable & panels tab).
// A versioned catalog of DeviceTemplates every module instantiates from. Modules consume it only through
// `library.get/find`, `instantiate()` and the small resolvers below — never by reading the array directly.
import type { Device, DeviceClass, DeviceTemplate, Jack, LibraryLookup, Port, PortDir, PortTemplate, PortType, IdPrefix } from "../store/types";

type Src = DeviceTemplate["source"];
const VERIFIED = "2026-10-30";

function P(name: string, type: PortType, dir: PortDir, count = 1, notes?: string): PortTemplate {
  return notes ? { name, type, dir, count, notes } : { name, type, dir, count };
}

function T(
  templateId: string, cls: DeviceClass, make: string, model: string,
  o: { aliases?: string[]; ru?: number; powerW?: number; weightLb?: number; ports?: PortTemplate[]; spec?: Record<string, unknown>;
       inventory?: DeviceTemplate["inventory"]; source?: Src; deprecated?: boolean },
): DeviceTemplate {
  const source = o.source ?? "approximate";
  const t: DeviceTemplate = {
    templateId, class: cls, make, model, aliases: o.aliases ?? [], ru: o.ru ?? 0, powerW: o.powerW ?? 0, weightLb: o.weightLb ?? 0,
    ports: o.ports ?? [], spec: o.spec ?? {}, source,
  };
  if (o.inventory) t.inventory = o.inventory;
  if (source !== "approximate") t.verifiedAt = VERIFIED;
  if (o.deprecated) t.deprecated = true;
  return t;
}

// ---------- format lists ----------
export const FORMATS_1080 = ["1080p59.94", "1080p60", "1080p50", "1080i59.94", "1080i50", "720p59.94", "720p50"];
export const FORMATS_UHD = ["3840x2160p59.94", "3840x2160p60", "3840x2160p50", "3840x2160p29.97", "4096x2160p59.94", "4096x2160p60"];
export const FORMATS_8K = ["7680x4320p59.94", "7680x4320p60"];

/** Canonical "WxHpRATE" (or "WxHiRATE") form so "1080p59.94" and "1920x1080p59.94" compare equal. */
export function normFormat(f: string | null | undefined): string {
  if (!f) return "";
  const s = f.replace(/\s+/g, "").replace(/×/g, "x").toLowerCase();
  const short = /^(\d{3,4})([pi])([\d.]+)$/.exec(s);
  if (short) {
    const h = Number(short[1]);
    const w = h === 2160 ? 3840 : h === 4320 ? 7680 : Math.round((h * 16) / 9);
    return `${w}x${h}${short[2]}${Number(short[3])}`;
  }
  const full = /^(\d+)x(\d+)([pi])([\d.]+)$/.exec(s);
  if (full) return `${full[1]}x${full[2]}${full[3]}${Number(full[4])}`;
  return s;
}

/** Parses "3840x2160p59.94" / "1080p59.94" into resolution + rate. */
export function parseFormat(f: string | null | undefined): { resolution: string; w: number; h: number; scan: "p" | "i"; rate: number } | null {
  const n = normFormat(f);
  const m = /^(\d+)x(\d+)([pi])([\d.]+)$/.exec(n);
  if (!m) return null;
  return { resolution: `${m[1]}x${m[2]}`, w: Number(m[1]), h: Number(m[2]), scan: m[3] as "p" | "i", rate: Number(m[4]) };
}

// ---------- LED processors ----------
const AC = (n = 1) => P("AC IN", "AC-in", "in", n);
const DC = () => P("DC IN", "DC-in", "in");
const NET = (n = 1) => P("NET", "cat6", "bidir", n);

function processor(id: string, make: string, model: string, o: {
  aliases?: string[]; ru: number; powerW: number; weightLb: number; ports: PortTemplate[]; source: Src;
  pxPerPort8bit: number | null; pxPerPort10bit?: number | null; maxPx: number | null; maxCanvas: string | null;
  outputs1G: number; outputs10G: number; inputs: string[]; accepted: string[]; genlock: boolean; formatRule?: "converting" | "pass-through"; extra?: Record<string, unknown>;
}): DeviceTemplate {
  return T(id, "processor", make, model, {
    aliases: o.aliases, ru: o.ru, powerW: o.powerW, weightLb: o.weightLb, ports: o.ports, source: o.source,
    spec: {
      protocol: make === "NovaStar" ? "Novastar" : make, maxPx: o.maxPx, pxPerPort8bit: o.pxPerPort8bit, pxPerPort10bit: o.pxPerPort10bit ?? null,
      outputs1G: o.outputs1G, outputs10G: o.outputs10G, inputs: o.inputs, maxCanvas: o.maxCanvas, genlock: o.genlock,
      acceptedFormats: o.accepted, formatRule: o.formatRule ?? "converting", ...(o.extra ?? {}),
    },
  });
}

const PROCESSORS: DeviceTemplate[] = [
  processor("tpl_brompton_sx40", "Brompton", "Tessera SX40", {
    aliases: ["SX40", "SX-40", "Tessera SX40", "Brompton SX40"], ru: 2, powerW: 140, weightLb: 16.5, source: "manufacturer",
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("HDMI IN", "HDMI2.0", "in"), P("HDMI THRU", "HDMI2.0", "out"), P("DMX IN", "dmx", "in"), P("DMX THRU", "dmx", "out"),
      P("GENLOCK IN", "genlock", "in"), P("10G OUT", "fiberLED", "out", 4), NET(), AC()],
    pxPerPort8bit: 525000, maxPx: 9_000_000, maxCanvas: "4096x2160", outputs1G: 0, outputs10G: 4, inputs: ["12G-SDI", "HDMI2.0"],
    accepted: [...FORMATS_1080, ...FORMATS_UHD], genlock: true, extra: { pairsWith: "tpl_brompton_xd", xdPer10G: 1, maxXD: 4, note: "1G capacity via XD: 525k px per port" },
  }),
  processor("tpl_brompton_xd", "Brompton", "Tessera XD", {
    aliases: ["XD", "Tessera XD", "Brompton XD", "XD distribution unit"], ru: 1, powerW: 50, weightLb: 22, source: "manufacturer",
    ports: [P("10G IN", "fiberLED", "in", 3), P("1G OUT", "etherCon", "out", 10), NET(), AC()],
    pxPerPort8bit: 525000, maxPx: null, maxCanvas: null, outputs1G: 10, outputs10G: 0, inputs: ["fiberLED"], accepted: [], genlock: false,
    formatRule: "pass-through", extra: { role: "distribution" },
  }),
  processor("tpl_brompton_s8", "Brompton", "Tessera S8", {
    aliases: ["S8", "Tessera S8", "Brompton S8"], ru: 2, powerW: 140, weightLb: 22, source: "manufacturer",
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("HDMI IN", "HDMI2.0", "in"), P("DVI IN", "DVI", "in"), P("GENLOCK IN", "genlock", "in"), P("1G OUT", "etherCon", "out", 8), NET(), AC()],
    pxPerPort8bit: 525000, maxPx: 4_200_000, maxCanvas: "4096x2160", outputs1G: 8, outputs10G: 0, inputs: ["12G-SDI", "HDMI2.0", "DVI"],
    accepted: [...FORMATS_1080, ...FORMATS_UHD], genlock: true,
  }),
  processor("tpl_brompton_s4", "Brompton", "Tessera S4", {
    aliases: ["S4", "Tessera S4", "Brompton S4"], ru: 1, powerW: 50, weightLb: 6.8, source: "manufacturer",
    ports: [P("DVI IN", "DVI", "in"), P("DVI THRU", "DVI", "out"), P("1G OUT", "etherCon", "out", 4), NET(), AC()],
    pxPerPort8bit: 525000, maxPx: 2_100_000, maxCanvas: "1920x1080", outputs1G: 4, outputs10G: 0, inputs: ["DVI"],
    accepted: FORMATS_1080.filter((f) => f.startsWith("1080p") || f.startsWith("720p")), genlock: false,
  }),
  processor("tpl_brompton_sq200", "Brompton", "Tessera SQ200", {
    aliases: ["SQ200", "Tessera SQ200"], ru: 2, powerW: 0, weightLb: 0, source: "approximate",
    ports: [P("12G-SDI IN", "12G-SDI", "in", 4), P("10G OUT", "fiberLED", "out", 4), NET(), AC()],
    pxPerPort8bit: null, maxPx: null, maxCanvas: "7680x4320", outputs1G: 0, outputs10G: 4, inputs: ["12G-SDI"],
    accepted: [...FORMATS_1080, ...FORMATS_UHD, ...FORMATS_8K], genlock: true, extra: { note: "Released Sep 2025; datasheet pending" },
  }),
  processor("tpl_novastar_mx40pro", "NovaStar", "MX40 Pro", {
    aliases: ["MX40 Pro", "MX40", "COEX MX40 Pro", "NovaStar MX40"], ru: 2, powerW: 95, weightLb: 13, source: "manufacturer",
    ports: [P("HDMI IN", "HDMI2.0", "in", 3), P("HDMI LOOP", "HDMI2.0", "out", 3), P("DP IN", "DP1.2", "in"), P("12G-SDI IN", "12G-SDI", "in"), P("12G-SDI LOOP", "12G-SDI", "out"),
      P("GENLOCK IN", "genlock", "in"), P("GENLOCK LOOP", "genlock", "out"), P("1G OUT", "etherCon", "out", 20), P("10G OUT", "fiberLED", "out", 4, "2 primary + 2 backup"), NET(), AC()],
    pxPerPort8bit: 659722, pxPerPort10bit: 494791, maxPx: 9_000_000, maxCanvas: "16384x16384", outputs1G: 20, outputs10G: 4, inputs: ["HDMI2.0", "DP1.2", "12G-SDI"],
    accepted: [...FORMATS_1080, ...FORMATS_UHD], genlock: true,
  }),
  processor("tpl_novastar_mx30", "NovaStar", "MX30", {
    aliases: ["MX30", "COEX MX30"], ru: 2, powerW: 80, weightLb: 12, source: "approximate",
    ports: [P("HDMI IN", "HDMI2.0", "in"), P("DP IN", "DP1.2", "in"), P("12G-SDI IN", "12G-SDI", "in"), P("1G OUT", "etherCon", "out", 10), P("10G OUT", "fiberLED", "out", 2), NET(), AC()],
    pxPerPort8bit: 659722, maxPx: 4_500_000, maxCanvas: "8192x8192", outputs1G: 10, outputs10G: 2, inputs: ["HDMI2.0", "DP1.2", "12G-SDI"],
    accepted: [...FORMATS_1080, ...FORMATS_UHD], genlock: true,
  }),
  processor("tpl_megapixel_helios", "Megapixel", "HELIOS 4K", {
    aliases: ["HELIOS", "Helios 4K", "Megapixel Helios"], ru: 2, powerW: 150, weightLb: 17.6, source: "approximate",
    ports: [P("12G-SDI IN", "12G-SDI", "in", 4), P("HDMI IN", "HDMI2.0", "in"), P("DP IN", "DP1.4", "in"), P("GENLOCK IN", "genlock", "in"), P("10G OUT", "fiberLED", "out", 4), NET(), AC()],
    pxPerPort8bit: null, maxPx: 8_800_000, maxCanvas: "4096x2160", outputs1G: 0, outputs10G: 4, inputs: ["12G-SDI", "HDMI2.0", "DP1.4"],
    accepted: [...FORMATS_1080, ...FORMATS_UHD], genlock: true,
  }),
  processor("tpl_megapixel_helios8k", "Megapixel", "HELIOS 8K", {
    aliases: ["Helios 8K"], ru: 2, powerW: 180, weightLb: 17.6, source: "approximate",
    ports: [P("12G-SDI IN", "12G-SDI", "in", 4), P("DP IN", "DP1.4", "in"), P("GENLOCK IN", "genlock", "in"), P("10G OUT", "fiberLED", "out", 8), NET(), AC()],
    pxPerPort8bit: null, maxPx: 35_000_000, maxCanvas: "7680x4320", outputs1G: 0, outputs10G: 8, inputs: ["12G-SDI", "DP1.4"],
    accepted: [...FORMATS_1080, ...FORMATS_UHD, ...FORMATS_8K], genlock: true,
  }),
];

// ---------- LED tiles ----------
function tile(id: string, make: string, model: string, o: {
  aliases: string[]; pitch: number; w: number; h: number; d: number | null; pxW: number; pxH: number; maxW: number; avgW: number; lb: number;
  nits: number; ip: string; curve: unknown; protocol: string; source: Src; transparency?: number; perCase?: number;
}): DeviceTemplate {
  return T(id, "tile", make, model, {
    aliases: o.aliases, ru: 0, powerW: 0, weightLb: o.lb, source: o.source,
    ports: [P("DATA", "etherCon", "bidir", 2), P("PWR", "AC-in", "in", 2)],
    spec: { pitch_mm: o.pitch, w_mm: o.w, h_mm: o.h, d_mm: o.d, px_w: o.pxW, px_h: o.pxH, maxW: o.maxW, avgW: o.avgW, nits: o.nits, ip: o.ip,
      curve: o.curve, protocol: o.protocol, transparency_pct: o.transparency ?? 0, formatRule: "terminal" },
    inventory: { iCodes: [], caseModel: `${model} dolly (${o.perCase ?? 8})`, caseWeightLb: 0 },
  });
}
const CARBON_CURVE = { concave: 15, convex: 10 };

const TILES: DeviceTemplate[] = [
  tile("tpl_roe_cb5", "ROE Visual", "Carbon CB5", { aliases: ["CB5", "ROE CB5", "Carbon 5", "Carbon CB5"], pitch: 5.77, w: 600, h: 1200, d: 77, pxW: 104, pxH: 208, maxW: 500, avgW: 250, lb: 30.53, nits: 6000, ip: "outdoor", curve: CARBON_CURVE, protocol: "Brompton", source: "manufacturer" }),
  tile("tpl_roe_cb5_mkii", "ROE Visual", "Carbon CB5 MKII", { aliases: ["CB5 MKII", "CB5 MK2", "ROE CB5 MKII", "Carbon CB5 MK2"], pitch: 5.77, w: 600, h: 1200, d: 79, pxW: 104, pxH: 208, maxW: 480, avgW: 240, lb: 29.9, nits: 6000, ip: "IP65", curve: CARBON_CURVE, protocol: "Brompton", source: "manufacturer" }),
  tile("tpl_roe_cb5_half", "ROE Visual", "Carbon CB5 Half", { aliases: ["CB5 Half", "ROE CB5 Half", "CB5H"], pitch: 5.77, w: 600, h: 600, d: 77, pxW: 104, pxH: 104, maxW: 250, avgW: 125, lb: 15.3, nits: 6000, ip: "outdoor", curve: CARBON_CURVE, protocol: "Brompton", source: "approximate", perCase: 16 }),
  tile("tpl_roe_cb3", "ROE Visual", "Carbon CB3", { aliases: ["CB3", "ROE CB3", "Carbon 3"], pitch: 3.75, w: 600, h: 1200, d: 77, pxW: 160, pxH: 320, maxW: 540, avgW: 270, lb: 29.1, nits: 1500, ip: "indoor", curve: CARBON_CURVE, protocol: "Brompton", source: "manufacturer" }),
  tile("tpl_roe_cb8", "ROE Visual", "Carbon CB8", { aliases: ["CB8", "ROE CB8", "Carbon 8"], pitch: 8.33, w: 600, h: 1200, d: 77, pxW: 72, pxH: 144, maxW: 430, avgW: 220, lb: 28.0, nits: 5000, ip: "outdoor", curve: CARBON_CURVE, protocol: "Brompton", source: "manufacturer" }),
  tile("tpl_roe_v8t", "ROE Visual", "Vanish V8T", { aliases: ["V8T", "Vanish 8T", "Vanish V8T", "ROE V8T", "ROE Vanish 8T"], pitch: 8.9, w: 1000, h: 1000, d: 95, pxW: 112, pxH: 112, maxW: 480, avgW: 240, lb: 40.1, nits: 4000, ip: "IP65 outdoor", curve: true, protocol: "Brompton", source: "manufacturer", transparency: 50, perCase: 6 }),
  tile("tpl_roe_v8t_h", "ROE Visual", "Vanish V8T-H", { aliases: ["V8T-H", "V8T Half", "Vanish 8T Half", "ROE V8T-H"], pitch: 8.9, w: 1000, h: 500, d: 95, pxW: 112, pxH: 56, maxW: 260, avgW: 130, lb: 24.7, nits: 4000, ip: "IP65 outdoor", curve: true, protocol: "Brompton", source: "manufacturer", transparency: 50, perCase: 12 }),
  tile("tpl_roe_v8s", "ROE Visual", "Vanish V8S", { aliases: ["V8S", "Vanish 8S", "ROE V8S"], pitch: 8.9, w: 1000, h: 1000, d: 67, pxW: 112, pxH: 112, maxW: 440, avgW: 220, lb: 20.5, nits: 3500, ip: "indoor", curve: true, protocol: "Brompton", source: "manufacturer", transparency: 50, perCase: 6 }),
  tile("tpl_roe_bm4", "ROE Visual", "Black Marble BM4", { aliases: ["BM4", "Black Marble", "ROE BM4"], pitch: 4.6, w: 1000, h: 500, d: null, pxW: 208, pxH: 104, maxW: 450, avgW: 225, lb: 48, nits: 1500, ip: "indoor", curve: false, protocol: "Brompton", source: "approximate", perCase: 6 }),
  tile("tpl_roe_dm2_6", "ROE Visual", "Diamond DM2.6", { aliases: ["DM2.6", "Diamond 2.6", "ROE DM2.6"], pitch: 2.6, w: 500, h: 500, d: null, pxW: 192, pxH: 192, maxW: 230, avgW: 115, lb: 17.6, nits: 1200, ip: "indoor", curve: { concave: true, convex: true }, protocol: "Brompton", source: "approximate" }),
  tile("tpl_absen_pl3_9", "Absen", "PL3.9 Pro", { aliases: ["PL3.9", "PL3.9 Pro", "Absen PL3.9"], pitch: 3.9, w: 500, h: 500, d: null, pxW: 128, pxH: 128, maxW: 200, avgW: 80, lb: 17, nits: 1200, ip: "indoor", curve: true, protocol: "Novastar", source: "approximate" }),
  tile("tpl_infiled_db5", "INFiLED", "DB5", { aliases: ["DB5", "INFiLED DB5", "DB 5.2"], pitch: 5.2, w: 500, h: 500, d: null, pxW: 96, pxH: 96, maxW: 180, avgW: 70, lb: 15, nits: 5000, ip: "outdoor", curve: true, protocol: "Novastar", source: "approximate" }),
];

// ---------- cameras and CCUs ----------
function systemCamera(id: string, make: string, model: string, o: { aliases?: string[]; sensor: string; mount: string; formats: string[]; ccu: string; powerW: number; lb: number }): DeviceTemplate {
  return T(id, "camera", make, model, {
    aliases: o.aliases, ru: 0, powerW: o.powerW, weightLb: o.lb, ports: [P("SMPTE FIBRE", "fiber-SMPTE", "bidir")],
    spec: { sensor: o.sensor, mount: o.mount, formats: o.formats, outputs: ["fiber-SMPTE"], transport: "SMPTE", ccuRequired: true, ccuTemplateId: o.ccu, ptz: false, formatRule: "converting" },
    inventory: { iCodes: [], caseModel: `${model} camera case (1)` },
  });
}
function ccu(id: string, make: string, model: string, o: { aliases?: string[]; family: string; ru: number; powerW: number; lb: number }): DeviceTemplate {
  return T(id, "ccu", make, model, {
    aliases: o.aliases, ru: o.ru, powerW: o.powerW, weightLb: o.lb,
    ports: [P("SMPTE FIBRE", "fiber-SMPTE", "bidir"), P("SDI OUT", "12G-SDI", "out", 4), P("RETURN IN", "12G-SDI", "in"), P("TALLY", "tally", "in"),
      P("INTERCOM", "intercom", "bidir"), P("GENLOCK IN", "genlock", "in"), NET(), AC()],
    spec: { cameraFamily: o.family, transport: "SMPTE", outputs: 4, returnFeeds: 1, tally: true, acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD], formatRule: "converting", genlock: true },
  });
}

const CAMERAS: DeviceTemplate[] = [
  systemCamera("tpl_sony_hdc3500", "Sony", "HDC-3500", { aliases: ["HDC3500"], sensor: '3× 2/3" CMOS', mount: "B4", formats: ["1080p59.94", "1080i59.94", "3840x2160p59.94"], ccu: "tpl_sony_hdcu3500", powerW: 60, lb: 11 }),
  ccu("tpl_sony_hdcu3500", "Sony", "HDCU-3500", { aliases: ["HDCU3500"], family: "HDC-3500", ru: 2, powerW: 200, lb: 20 }),
  systemCamera("tpl_sony_hdc5500", "Sony", "HDC-5500", { aliases: ["HDC5500"], sensor: '3× 2/3" 4K CMOS', mount: "B4", formats: ["1080p59.94", "3840x2160p59.94"], ccu: "tpl_sony_hdcu5500", powerW: 80, lb: 13 }),
  ccu("tpl_sony_hdcu5500", "Sony", "HDCU-5500", { aliases: ["HDCU5500"], family: "HDC-5500", ru: 2, powerW: 220, lb: 22 }),
  systemCamera("tpl_sony_hxcfb80", "Sony", "HXC-FB80", { aliases: ["HXCFB80", "FB80"], sensor: '3× 2/3" CMOS', mount: "B4", formats: ["1080p59.94", "1080i59.94"], ccu: "tpl_sony_hxcufb80", powerW: 45, lb: 9 }),
  ccu("tpl_sony_hxcufb80", "Sony", "HXCU-FB80", { aliases: ["HXCUFB80"], family: "HXC-FB80", ru: 2, powerW: 120, lb: 15 }),
  systemCamera("tpl_pana_uc4000", "Panasonic", "AK-UC4000", { aliases: ["UC4000"], sensor: "4.4K MOS", mount: "B4", formats: ["1080p59.94", "3840x2160p59.94"], ccu: "tpl_pana_ucu600", powerW: 70, lb: 12 }),
  ccu("tpl_pana_ucu600", "Panasonic", "AK-UCU600", { aliases: ["UCU600"], family: "AK-UC4000", ru: 2, powerW: 180, lb: 18 }),
  T("tpl_bmd_ursabroadcast_g2", "camera", "Blackmagic Design", "URSA Broadcast G2", {
    aliases: ["URSA Broadcast G2", "URSA G2"], powerW: 40, weightLb: 6.5,
    ports: [P("12G-SDI OUT", "12G-SDI", "out"), P("12G-SDI RETURN IN", "12G-SDI", "in")],
    spec: { sensor: "6K S35", mount: "B4 / EF", formats: ["1080p59.94", "3840x2160p59.94"], outputs: ["12G-SDI"], transport: "SDI", ccuRequired: false, ccuTemplateId: "tpl_bmd_studioconverter", ptz: false, formatRule: "converting" },
  }),
  T("tpl_bmd_studio4kpro_g2", "camera", "Blackmagic Design", "Studio Camera 4K Pro G2", {
    aliases: ["Studio Camera 4K Pro", "Studio 4K Pro G2"], powerW: 30, weightLb: 3.5,
    ports: [P("12G-SDI OUT", "12G-SDI", "out"), P("12G-SDI RETURN IN", "12G-SDI", "in"), P("TALLY", "tally", "in")],
    spec: { sensor: '4/3" 4K', mount: "MFT", formats: ["1080p59.94", "3840x2160p59.94"], outputs: ["12G-SDI"], transport: "SDI", ccuRequired: false, ptz: false, formatRule: "converting" },
  }),
  T("tpl_pana_ue160", "camera", "Panasonic", "AW-UE160", {
    aliases: ["UE160", "AW-UE160 PTZ"], powerW: 50, weightLb: 10,
    ports: [P("12G-SDI OUT", "12G-SDI", "out"), P("HDMI OUT", "HDMI2.0", "out"), P("LAN", "cat6", "bidir", 1, "control, NDI, ST 2110, PoE++")],
    spec: { sensor: '1" MOS', mount: "integrated", formats: ["1080p59.94", "3840x2160p59.94"], outputs: ["12G-SDI", "HDMI2.0", "NDI", "ST2110"], transport: "SDI", ccuRequired: false, ptz: true, poe: "PoE++", formatRule: "converting" },
  }),
  T("tpl_sony_brcx1000", "camera", "Sony", "BRC-X1000", {
    aliases: ["BRC-X1000 PTZ", "BRCX1000"], powerW: 40, weightLb: 7,
    ports: [P("3G-SDI OUT", "3G-SDI", "out"), P("HDMI OUT", "HDMI2.0", "out"), P("LAN", "cat6", "bidir", 1, "VISCA over IP")],
    spec: { sensor: '1" CMOS', mount: "integrated", formats: ["1080p59.94", "3840x2160p29.97"], outputs: ["3G-SDI", "HDMI2.0"], transport: "SDI", ccuRequired: false, ptz: true, formatRule: "converting" },
  }),
  T("tpl_marshall_cv568", "camera", "Marshall", "CV568", {
    aliases: ["CV568 POV"], powerW: 5, weightLb: 0.4,
    ports: [P("3G-SDI OUT", "3G-SDI", "out"), P("HDMI OUT", "HDMI2.0", "out"), P("GENLOCK IN", "genlock", "in")],
    spec: { sensor: '1/2.5" CMOS', mount: "M12 / CS", formats: ["1080p59.94"], outputs: ["3G-SDI", "HDMI2.0"], transport: "SDI", ccuRequired: false, ptz: false, pov: true, genlock: true, formatRule: "converting" },
  }),
];

// ---------- converters, distribution, transport ----------
type FormatRule = "pass-through" | "converting" | "terminal";
function conv(id: string, make: string, model: string, o: {
  aliases?: string[]; from: string; to: string; scaler: boolean | null; frameSync: boolean | null; poweredBy: string; ru?: number; powerW: number; lb: number;
  ports: PortTemplate[]; rule: FormatRule; notes: string; cls?: DeviceClass; extra?: Record<string, unknown>;
}): DeviceTemplate {
  return T(id, o.cls ?? "converter", make, model, {
    aliases: o.aliases, ru: o.ru ?? 0, powerW: o.powerW, weightLb: o.lb, ports: o.ports,
    spec: { from: o.from, to: o.to, scaler: o.scaler, frameSync: o.frameSync, poweredBy: o.poweredBy, formatRule: o.rule, notes: o.notes, ...(o.extra ?? {}) },
  });
}

const CONVERTERS: DeviceTemplate[] = [
  conv("tpl_aja_hi5_12g", "AJA", "Hi5-12G", { aliases: ["Hi5-12G", "Hi5 12G"], from: "12G-SDI", to: "HDMI2.0", scaler: false, frameSync: false, poweredBy: "DC", powerW: 6, lb: 0.5,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("HDMI OUT", "HDMI2.0", "out"), DC()], rule: "pass-through", notes: "LED processor HDMI input feed, monitor taps" }),
  conv("tpl_aja_ha5_12g", "AJA", "HA5-12G", { aliases: ["HA5-12G", "HA5 12G"], from: "HDMI2.0", to: "12G-SDI", scaler: false, frameSync: false, poweredBy: "DC", powerW: 6, lb: 0.5,
    ports: [P("HDMI IN", "HDMI2.0", "in"), P("12G-SDI OUT", "12G-SDI", "out"), DC()], rule: "pass-through", notes: "Laptop / server HDMI into SDI plant" }),
  conv("tpl_aja_fido_4t", "AJA", "FiDO-4T-12G", { aliases: ["FiDO-4T", "FiDO 4T"], from: "12G-SDI", to: "fiber-LC", scaler: null, frameSync: null, poweredBy: "DC", powerW: 8, lb: 0.6,
    ports: [P("12G-SDI IN", "12G-SDI", "in", 4), P("FIBER OUT", "fiber-LC", "out", 4), DC()], rule: "pass-through", notes: "Long-run SDI; pairs with FiDO-4R", extra: { pairsWith: "tpl_aja_fido_4r", channels: 4 } }),
  conv("tpl_aja_fido_4r", "AJA", "FiDO-4R-12G", { aliases: ["FiDO-4R", "FiDO 4R"], from: "fiber-LC", to: "12G-SDI", scaler: null, frameSync: null, poweredBy: "DC", powerW: 8, lb: 0.6,
    ports: [P("FIBER IN", "fiber-LC", "in", 4), P("12G-SDI OUT", "12G-SDI", "out", 4), DC()], rule: "pass-through", notes: "Receive end of FiDO-4T", extra: { pairsWith: "tpl_aja_fido_4t", channels: 4 } }),
  conv("tpl_bmd_teranex_12g", "Blackmagic Design", "Teranex Mini 12G-SDI to HDMI 8K HDR", { aliases: ["Teranex Mini 12G to HDMI", "Teranex Mini SDI to HDMI 8K"], from: "12G-SDI", to: "HDMI2.0", scaler: false, frameSync: false, poweredBy: "AC", powerW: 10, lb: 1.2,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("12G-SDI LOOP", "12G-SDI", "out"), P("HDMI OUT", "HDMI2.0", "out"), AC()], rule: "pass-through", notes: "Dual on-screen scopes; monitor feeds" }),
  conv("tpl_bmd_teranex_av", "Blackmagic Design", "Teranex AV", { aliases: ["Teranex AV"], from: "12G-SDI / HDMI2.0", to: "12G-SDI / HDMI2.0", scaler: true, frameSync: true, poweredBy: "AC", ru: 1, powerW: 20, lb: 3,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("HDMI IN", "HDMI2.0", "in"), P("12G-SDI OUT", "12G-SDI", "out", 2), P("HDMI OUT", "HDMI2.0", "out"), P("GENLOCK IN", "genlock", "in"), AC()],
    rule: "converting", notes: "Standards conversion; low-latency presenter switch", extra: { acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD] } }),
  conv("tpl_decimator_mdhx", "Decimator", "MD-HX", { aliases: ["MD-HX", "Decimator MD HX"], from: "3G-SDI / HDMI2.0", to: "3G-SDI / HDMI2.0", scaler: true, frameSync: true, poweredBy: "USB / DC", powerW: 4, lb: 0.3,
    ports: [P("SDI IN", "3G-SDI", "in"), P("HDMI IN", "HDMI2.0", "in"), P("SDI OUT", "3G-SDI", "out", 2), P("HDMI OUT", "HDMI2.0", "out"), DC()],
    rule: "converting", notes: "Cross-converter with scaling; front-row utility box", extra: { acceptedFormats: FORMATS_1080 } }),
  conv("tpl_decimator_12g_cross", "Decimator", "12G-CROSS", { aliases: ["12G-CROSS", "Decimator 12G Cross"], from: "12G-SDI / HDMI2.0", to: "12G-SDI / HDMI2.0", scaler: true, frameSync: true, poweredBy: "USB / DC", powerW: 6, lb: 0.4,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("HDMI IN", "HDMI2.0", "in"), P("12G-SDI OUT", "12G-SDI", "out", 2), P("HDMI OUT", "HDMI2.0", "out"), DC()],
    rule: "converting", notes: "4K cross-converter", extra: { acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD] } }),
  conv("tpl_bmd_da_12g", "Blackmagic Design", "Mini Converter SDI Distribution 12G", { aliases: ["SDI Distribution 12G", "BMD 12G DA"], from: "12G-SDI", to: "12G-SDI", scaler: null, frameSync: null, poweredBy: "DC", powerW: 6, lb: 0.7,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("12G-SDI OUT", "12G-SDI", "out", 8), DC()], rule: "pass-through", notes: "Reclocking DA", extra: { outputs: 8 } }),
  conv("tpl_aja_12gda", "AJA", "12GDA", { aliases: ["12GDA", "AJA 12G DA"], from: "12G-SDI", to: "12G-SDI", scaler: null, frameSync: null, poweredBy: "DC", powerW: 6, lb: 0.5,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("12G-SDI OUT", "12G-SDI", "out", 4), DC()], rule: "pass-through", notes: "Reclocking DA", extra: { outputs: 4 } }),
  conv("tpl_bmd_optical_12g", "Blackmagic Design", "Mini Converter Optical Fiber 12G", { aliases: ["Optical Fiber 12G", "BMD Optical 12G"], from: "12G-SDI / fiber-LC", to: "fiber-LC / 12G-SDI", scaler: null, frameSync: null, poweredBy: "DC", powerW: 6, lb: 0.7,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("12G-SDI OUT", "12G-SDI", "out"), P("FIBER IN", "fiber-LC", "in"), P("FIBER OUT", "fiber-LC", "out"), DC()], rule: "pass-through", notes: "Single-channel fibre (SFP)" }),
  conv("tpl_bmd_studioconverter", "Blackmagic Design", "Studio Fiber Converter", { aliases: ["Studio Fiber Converter"], from: "fiber-SMPTE", to: "12G-SDI", scaler: null, frameSync: null, poweredBy: "AC", ru: 1, powerW: 40, lb: 6,
    ports: [P("SMPTE FIBRE", "fiber-SMPTE", "bidir"), P("12G-SDI OUT", "12G-SDI", "out"), P("12G-SDI RETURN IN", "12G-SDI", "in"), P("TALLY", "tally", "in"), P("TALKBACK", "intercom", "bidir"), AC()],
    rule: "pass-through", notes: "Base station for URSA fibre" }),
  conv("tpl_smpte_fiber_reel", "Generic", "SMPTE 311M hybrid fibre reel 328 ft", { aliases: ["SMPTE reel", "SMPTE 328"], from: "fiber-SMPTE", to: "fiber-SMPTE", scaler: null, frameSync: null, poweredBy: "none", powerW: 0, lb: 45,
    ports: [P("END A", "fiber-SMPTE", "bidir"), P("END B", "fiber-SMPTE", "bidir")], rule: "pass-through", notes: "Instantiates as a fiber device", cls: "fiber",
    extra: { channels: 1, connectors: "SMPTE 304", distance_ft: 328, direction: "bidir" } }),
  conv("tpl_tac12_fiber", "Generic", "12-ch tactical fibre reel 500 ft", { aliases: ["tac 12", "tactical fibre 12"], from: "fiber-LC", to: "fiber-LC", scaler: null, frameSync: null, poweredBy: "none", powerW: 0, lb: 30,
    ports: [P("END A", "fiber-LC", "in", 12), P("END B", "fiber-LC", "out", 12)], rule: "pass-through", notes: "Trunk for FiDO / Brompton 10G runs", cls: "fiber",
    extra: { channels: 12, connectors: "opticalCON / LC", distance_ft: 500, direction: "A→B" } }),
  T("tpl_netgear_m4250", "router", "Netgear", "M4250-26G4XF-PoE+", {
    aliases: ["M4250", "Netgear M4250"], ru: 1, powerW: 60, weightLb: 9,
    ports: [P("PORT", "cat6", "bidir", 24, "PoE+"), P("SFP+", "fiber-LC", "bidir", 4), AC()],
    spec: { size: "24x24", formats: [], expandable: false, network: true, poeBudgetW: 480, from: "cat6", to: "cat6", scaler: null, frameSync: null, poweredBy: "AC", formatRule: "pass-through", notes: "Control / media switch; Signal network slice" },
  }),
];

// ---------- common endpoints ----------
const SERVER_SPEC = (platform: string, outputs: { count: number; type: PortType }, inputs: number, gpu: string, extra: Record<string, unknown> = {}) => ({
  platform, outputs, maxOutputRes: "3840x2160p60", inputs, gpu, storage_tb: 4, timecode: "LTC", genlock: true, formatRule: "converting",
  acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD], ...extra,
});

const ENDPOINTS: DeviceTemplate[] = [
  T("tpl_ross_carbonite_ultra", "switcher", "Ross", "Carbonite Ultra", {
    aliases: ["Carbonite Ultra", "Carbonite"], ru: 2, powerW: 150, weightLb: 18,
    ports: [P("SDI IN", "12G-SDI", "in", 24), P("SDI OUT", "12G-SDI", "out", 14), P("TALLY", "tally", "out"), P("GENLOCK IN", "genlock", "in"), NET(), AC()],
    spec: { meLevels: 2, miniME: 5, inputs: 24, outputs: 14, auxOuts: 14, formats: [...FORMATS_1080, ...FORMATS_UHD], acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD], multiview: 2, controlPanel: "Carbonite panel", genlock: true, formatRule: "converting" },
  }),
  T("tpl_ross_ultrix_fr1", "router", "Ross", "Ultrix FR1", {
    aliases: ["Ultrix", "Ultrix FR1"], ru: 1, powerW: 120, weightLb: 15,
    ports: [P("SDI IN", "12G-SDI", "in", 36), P("SDI OUT", "12G-SDI", "out", 36), NET(), AC()],
    spec: { size: "36x36", formats: [...FORMATS_1080, ...FORMATS_UHD], expandable: true, formatRule: "pass-through" },
  }),
  T("tpl_bmd_atem_constellation_8k", "switcher", "Blackmagic Design", "ATEM Constellation 8K", {
    aliases: ["Constellation 8K", "ATEM 8K"], ru: 2, powerW: 110, weightLb: 13,
    ports: [P("SDI IN", "12G-SDI", "in", 40), P("SDI OUT", "12G-SDI", "out", 24), P("MULTIVIEW OUT", "12G-SDI", "out", 4), NET(), AC()],
    spec: { meLevels: 4, inputs: 40, outputs: 24, auxOuts: 24, formats: [...FORMATS_1080, ...FORMATS_UHD, ...FORMATS_8K], acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD, ...FORMATS_8K], multiview: 4, controlPanel: "ATEM panel", formatRule: "converting" },
  }),
  T("tpl_bmd_atem_4me_constellation_4k", "switcher", "Blackmagic Design", "ATEM 4 M/E Constellation 4K", {
    aliases: ["Constellation 4K", "ATEM 4ME 4K"], ru: 2, powerW: 110, weightLb: 13,
    ports: [P("SDI IN", "12G-SDI", "in", 40), P("SDI OUT", "12G-SDI", "out", 24), P("MULTIVIEW OUT", "12G-SDI", "out", 4), NET(), AC()],
    spec: { meLevels: 4, inputs: 40, outputs: 24, auxOuts: 24, formats: [...FORMATS_1080, ...FORMATS_UHD], acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD], multiview: 4, controlPanel: "ATEM panel", formatRule: "converting" },
  }),
  T("tpl_bmd_videohub_40x40_12g", "router", "Blackmagic Design", "Smart Videohub 40x40 12G", {
    aliases: ["Videohub 40x40", "Smart Videohub 40×40 12G"], ru: 2, powerW: 60, weightLb: 10,
    ports: [P("SDI IN", "12G-SDI", "in", 40), P("SDI OUT", "12G-SDI", "out", 40), NET(), AC()],
    spec: { size: "40x40", formats: [...FORMATS_1080, ...FORMATS_UHD], expandable: false, formatRule: "pass-through" },
  }),
  T("tpl_bmd_hyperdeck_4kpro", "recorder", "Blackmagic Design", "HyperDeck Studio 4K Pro", {
    aliases: ["HyperDeck 4K Pro", "HyperDeck Studio 4K Pro"], ru: 1, powerW: 25, weightLb: 6,
    ports: [P("12G-SDI IN", "12G-SDI", "in"), P("12G-SDI OUT", "12G-SDI", "out"), P("HDMI OUT", "HDMI2.0", "out"), P("LTC IN", "LTC", "in"), NET(), AC()],
    spec: { channels: 1, codecs: ["ProRes", "DNx", "H.264", "H.265"], media: ["SSD", "SSD", "SD"], formats: [...FORMATS_1080, ...FORMATS_UHD], acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD], formatRule: "terminal" },
  }),
  T("tpl_bmd_hyperdeck_extreme_8k", "recorder", "Blackmagic Design", "HyperDeck Extreme 8K HDR", {
    aliases: ["HyperDeck Extreme 8K"], ru: 3, powerW: 60, weightLb: 14,
    ports: [P("12G-SDI IN", "12G-SDI", "in", 4), P("12G-SDI OUT", "12G-SDI", "out", 4), P("HDMI OUT", "HDMI2.0", "out"), P("LTC IN", "LTC", "in"), NET(), AC()],
    spec: { channels: 1, codecs: ["ProRes", "H.265"], media: ["CFast"], formats: [...FORMATS_1080, ...FORMATS_UHD, ...FORMATS_8K], acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD, ...FORMATS_8K], formatRule: "terminal" },
  }),
  T("tpl_disguise_vx2", "server", "disguise", "vx 2", {
    aliases: ["vx2", "vx 2", "disguise vx2", "d3 vx2"], ru: 4, powerW: 800, weightLb: 45,
    ports: [P("DP OUT", "DP1.4", "out", 4), P("SDI IN", "12G-SDI", "in", 4), P("GENLOCK IN", "genlock", "in"), P("LTC IN", "LTC", "in"), NET(), AC(2)],
    spec: SERVER_SPEC("disguise", { count: 4, type: "DP1.4" }, 4, "NVIDIA RTX A6000"),
    inventory: { iCodes: [], caseModel: "disguise vx shock rack (1)" },
  }),
  T("tpl_disguise_vx4", "server", "disguise", "vx 4", {
    aliases: ["vx4", "vx 4", "disguise vx4"], ru: 4, powerW: 1000, weightLb: 55,
    ports: [P("DP OUT", "DP1.4", "out", 4), P("SDI IN", "12G-SDI", "in", 4), P("GENLOCK IN", "genlock", "in"), P("LTC IN", "LTC", "in"), NET(), AC(2)],
    spec: SERVER_SPEC("disguise", { count: 4, type: "DP1.4" }, 4, "NVIDIA RTX A6000", { outputDepth: "10-bit" }),
    inventory: { iCodes: [], caseModel: "disguise vx shock rack (1)" },
  }),
  T("tpl_resolume_server", "server", "Resolume", "Arena server (custom 4× DP)", {
    aliases: ["Resolume Arena server", "Resolume server"], ru: 4, powerW: 700, weightLb: 40,
    ports: [P("DP OUT", "DP1.4", "out", 4), P("SDI IN", "12G-SDI", "in", 1, "DeckLink capture"), NET(), AC()],
    spec: SERVER_SPEC("Resolume", { count: 4, type: "DP1.4" }, 1, "NVIDIA RTX"),
  }),
  T("tpl_hippo_boreal_plus", "server", "Green Hippo", "Hippotizer Boreal+ MK2", {
    aliases: ["Boreal+", "Boreal+ MK2", "Hippotizer Boreal"], ru: 3, powerW: 600, weightLb: 35,
    ports: [P("DP OUT", "DP1.2", "out", 4), P("SDI IN", "12G-SDI", "in", 2), P("GENLOCK IN", "genlock", "in"), P("LTC IN", "LTC", "in"), NET(), AC()],
    spec: SERVER_SPEC("Hippotizer", { count: 4, type: "DP1.2" }, 2, "NVIDIA"),
  }),
  T("tpl_pixera_two", "server", "AV Stumpfl", "PIXERA two", {
    aliases: ["PIXERA two", "Pixera 2"], ru: 3, powerW: 650, weightLb: 40,
    ports: [P("DP OUT", "DP1.4", "out", 4), NET(), AC()],
    spec: SERVER_SPEC("Pixera", { count: 4, type: "DP1.4" }, 0, "NVIDIA"),
  }),
  T("tpl_bmd_decklink_8k", "capture", "Blackmagic Design", "DeckLink 8K Pro", {
    aliases: ["DeckLink 8K Pro", "DeckLink 8K"], ru: 0, powerW: 25, weightLb: 1,
    ports: [P("12G-SDI", "12G-SDI", "bidir", 4)],
    spec: { channels: 4, type: "PCIe", formats: [...FORMATS_1080, ...FORMATS_UHD, ...FORMATS_8K], formatRule: "terminal" },
  }),
  T("tpl_evertz_5601", "tcGen", "Evertz", "5601MSC", {
    aliases: ["5601MSC", "Evertz 5601", "master sync"], ru: 1, powerW: 40, weightLb: 8,
    ports: [P("REF OUT", "genlock", "out", 6), P("LTC OUT", "LTC", "out"), NET(), AC()],
    spec: { outputs: { genlock: 6, ltc: 1 }, refSource: "GPS / internal", refFormats: ["tri-level", "black burst"], ntp: true, formatRule: "terminal" },
  }),
  T("tpl_tvlogic_lum_181h", "monitor", "TVLogic", "LUM-181H", {
    aliases: ["LUM-181H", "TVLogic 18"], ru: 8, powerW: 60, weightLb: 15,
    ports: [P("12G-SDI IN", "12G-SDI", "in", 2), P("HDMI IN", "HDMI2.0", "in"), AC()],
    spec: { size_in: 18, inputs: ["12G-SDI", "12G-SDI", "HDMI2.0"], multiview: 4, rackMount: true, acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD], formatRule: "terminal" },
  }),
  T("tpl_bmd_smartview_4k", "monitor", "Blackmagic Design", "SmartView 4K G3", {
    aliases: ["SmartView 4K"], ru: 6, powerW: 45, weightLb: 10,
    ports: [P("12G-SDI IN", "12G-SDI", "in", 2), NET(), AC()],
    spec: { size_in: 15.6, inputs: ["12G-SDI", "12G-SDI"], multiview: 1, rackMount: true, acceptedFormats: [...FORMATS_1080, ...FORMATS_UHD], formatRule: "terminal" },
  }),
  T("tpl_surgex_sx1120", "rackPdu", "SurgeX", "SX-1120-RT", {
    aliases: ["SX-1120-RT", "SX1120", "SurgeX 20A"], ru: 1, powerW: 0, weightLb: 8,
    ports: [P("AC IN", "AC-in", "in"), P("AC OUT", "AC-out", "out", 9)],
    spec: { inlet: "L5-20", outlets: 9, ratedAmps: 20, metered: false, surge: true },
  }),
  T("tpl_apc_ap7900b", "rackPdu", "APC", "AP7900B", {
    aliases: ["AP7900B", "APC switched PDU"], ru: 1, powerW: 0, weightLb: 6,
    ports: [P("AC IN", "AC-in", "in"), P("AC OUT", "AC-out", "out", 8), NET()],
    spec: { inlet: "L5-20", outlets: 8, ratedAmps: 20, metered: true, switched: true },
  }),
  T("tpl_apc_smt1500rm", "ups", "APC", "Smart-UPS SMT1500RM2U", {
    aliases: ["SMT1500RM2U", "SMT1500", "APC 1500 UPS"], ru: 2, powerW: 30, weightLb: 60,
    ports: [P("AC IN", "AC-in", "in"), P("AC OUT", "AC-out", "out", 6)],
    spec: { va: 1500, watts: 1000, runtimeMin: 8, outlets: 6 },
  }),
  T("tpl_motionlabs_200a", "distro", "Motion Labs", "200A 3Ø", {
    aliases: ["200A 3Ø", "200A 3 phase", "Motion Labs 200A"], ru: 0, powerW: 0, weightLb: 180,
    ports: [P("CAM-LOK IN", "AC-in", "in", 5), P("L21-30 OUT", "AC-out", "out", 6), P("L5-20 OUT", "AC-out", "out", 12)],
    spec: { service: "3Ø", volts: 208, inletAmps: 200, outlets: [{ connector: "L21-30", amps: 30, count: 6 }, { connector: "L5-20", amps: 20, count: 12 }], l2130Count: 6, phaseBalance: true },
    inventory: { iCodes: [], caseModel: "Motion Labs distro road case (1)" },
  }),
  T("tpl_motionlabs_400a", "distro", "Motion Labs", "400A 3Ø", {
    aliases: ["400A 3Ø", "400A 3 phase", "Motion Labs 400A"], ru: 0, powerW: 0, weightLb: 320,
    ports: [P("CAM-LOK IN", "AC-in", "in", 5), P("L21-30 OUT", "AC-out", "out", 12), P("L5-20 OUT", "AC-out", "out", 24)],
    spec: { service: "3Ø", volts: 208, inletAmps: 400, outlets: [{ connector: "L21-30", amps: 30, count: 12 }, { connector: "L5-20", amps: 20, count: 24 }], l2130Count: 12, phaseBalance: true },
    inventory: { iCodes: [], caseModel: "Motion Labs distro road case (1)" },
  }),
];

// ---------- patch panels (Cable & panels tab) ----------
export interface JackTemplate { type: PortType; count: number; group?: string; label?: string }
function panel(id: string, model: string, o: { kind: "stage-box" | "bulkhead" | "rack-panel" | "fibre-breakout" | "wall-plate"; jacks: JackTemplate[]; ru: number; lb: number; place: string; notes: string;
  trunkPort?: { type: "fiber-LC" | "fiber-SMPTE" | "multipin"; strands: number } }): DeviceTemplate {
  return T(id, "patchPanel", "Generic", model, {
    ru: o.ru, powerW: 0, weightLb: o.lb, ports: [],
    spec: { panelKind: o.kind, jacks: o.jacks, ru: o.ru, typicalPlace: o.place, notes: o.notes, formatRule: "pass-through", ...(o.trunkPort ? { trunkPort: o.trunkPort } : {}) },
  });
}

const PANELS: DeviceTemplate[] = [
  panel("tpl_panel_stagebox_12sdi", "Stage box 12× SDI", { kind: "stage-box", ru: 0, lb: 25, place: "pos_stage_sl / pos_stage_sr",
    jacks: [{ type: "12G-SDI", count: 12, group: "SDI" }, { type: "etherCon", count: 4, group: "NET" }, { type: "intercom", count: 2, group: "COMMS" }],
    trunkPort: { type: "fiber-LC", strands: 12 }, notes: "Lands on a 12-ch tactical trunk or copper snake" }),
  panel("tpl_panel_fibre_12lc", "Fibre breakout 12× LC", { kind: "fibre-breakout", ru: 1, lb: 5, place: "both ends of a tactical fibre trunk",
    jacks: [{ type: "fiber-LC", count: 12, group: "LC" }], trunkPort: { type: "fiber-LC", strands: 24 }, notes: "Each LC pair = one 12G path with FiDO or SFP converters; opticalCON MTP rear" }),
  panel("tpl_panel_vw_24sdi", "Video world 24× SDI patch", { kind: "rack-panel", ru: 1, lb: 4, place: "top of VIDEO 1",
    jacks: [{ type: "12G-SDI", count: 24, group: "SDI" }], notes: "Everything entering video world lands here first" }),
  panel("tpl_panel_smpte_4", "SMPTE bulkhead 4×", { kind: "bulkhead", ru: 1, lb: 6, place: "video world rack, camera side",
    jacks: [{ type: "fiber-SMPTE", count: 4, group: "SMPTE" }], notes: "Camera fibre home runs land here, then short jumpers to CCUs" }),
  panel("tpl_panel_cat6_24", "Network 24× RJ45", { kind: "rack-panel", ru: 1, lb: 3, place: "network rack",
    jacks: [{ type: "cat6", count: 24, group: "NET" }], notes: "Control VLAN patching" }),
  panel("tpl_panel_foh_8sdi", "FOH stage box 8× SDI", { kind: "stage-box", ru: 0, lb: 18, place: "pos_foh",
    jacks: [{ type: "12G-SDI", count: 8, group: "SDI" }, { type: "etherCon", count: 2, group: "NET" }, { type: "intercom", count: 2, group: "COMMS" }], notes: "FOH cameras and monitors" }),
  panel("tpl_panel_ac_pdu_front", "AC front panel 8× powerCON TRUE1", { kind: "rack-panel", ru: 1, lb: 4, place: "rack front",
    jacks: [{ type: "AC-out", count: 8, group: "AC" }], notes: "Lets power jumpers appear in Build without touching PDU rears" }),
];

export const LIBRARY: { libraryVersion: "2026.10.1"; schemaVersion: "1.0.0"; templates: DeviceTemplate[] } = {
  libraryVersion: "2026.10.1",
  schemaVersion: "1.0.0",
  templates: [...PROCESSORS, ...TILES, ...CAMERAS, ...CONVERTERS, ...ENDPOINTS, ...PANELS],
};

// ---------- lookup ----------
/** Lowercase alphanumerics only — "Tessera SX-40" → "tesserasx40". */
export function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/ø/g, "o").replace(/×/g, "x").replace(/[^a-z0-9]/g, "");
}

function names(t: DeviceTemplate): string[] {
  return [t.templateId, t.model, `${t.make} ${t.model}`, ...(t.aliases ?? [])].map(norm);
}

function isExact(t: DeviceTemplate, text: string): boolean {
  const n = norm(text);
  return !!n && names(t).includes(n);
}

export function makeLookup(templates: DeviceTemplate[]): LibraryLookup {
  const byId = new Map(templates.map((t) => [t.templateId, t]));
  return {
    get: (id) => byId.get(id),
    find: (q) => {
      const text = norm(q.text);
      const out = templates.filter((t) => {
        if (q.class && t.class !== q.class) return false;
        if (q.protocol && norm(String(t.spec.protocol ?? "")) !== norm(q.protocol)) return false;
        if (q.make && !norm(t.make).includes(norm(q.make)) && !norm(q.make).includes(norm(t.make))) return false;
        if (text) {
          const exact = isExact(t, q.text!);
          if (!exact && !names(t).some((n) => n.includes(text))) return false;
          if (t.deprecated && !exact) return false;
        } else if (t.deprecated) return false;
        return true;
      });
      // Exact name hits first, then shorter models (a closer match).
      return out.sort((a, b) => Number(isExact(b, q.text ?? "")) - Number(isExact(a, q.text ?? "")) || a.model.length - b.model.length);
    },
  };
}

export const library: LibraryLookup = makeLookup(LIBRARY.templates);

const MAKE_WORDS = ["roevisual", "roe", "visual", "brompton", "novastar", "megapixel", "absen", "infiled"];
const FAMILY_WORDS = ["carbon", "vanish", "blackmarble", "diamond", "tessera"];

/** Resolves free-text tile names ("ROE CB5", "ROE Vanish 8T", "Carbon CB5") to a tile template. */
export function templateForTileModel(name: string | null | undefined, lookup: LibraryLookup = library): DeviceTemplate | undefined {
  if (!name) return undefined;
  const tiles = lookup.find({ class: "tile" });
  const n = norm(name);
  const exact = tiles.find((t) => names(t).includes(n));
  if (exact) return exact;
  // Strip make words, then family words, and retry against stripped template names.
  const strip = (s: string) => {
    let out = s;
    for (const w of MAKE_WORDS) if (out.startsWith(w)) out = out.slice(w.length);
    for (const w of FAMILY_WORDS) if (out.startsWith(w)) out = out.slice(w.length);
    return out;
  };
  const q = strip(n);
  if (!q) return undefined;
  const stripped = (t: DeviceTemplate) => names(t).map(strip);
  const hit = tiles.find((t) => stripped(t).includes(q)) ?? tiles.find((t) => stripped(t).some((s) => s === "v" + q || q === "v" + s));
  return hit;
}

/** Resolves the template behind a device: explicit templateId first, then make + model / alias match within the class. */
export function templateForDevice(d: { templateId?: string; class?: string; make?: string; model?: string }, lookup: LibraryLookup = library): DeviceTemplate | undefined {
  if (d.templateId) {
    const t = lookup.get(d.templateId);
    if (t) return t;
  }
  if (!d.model) return undefined;
  const cands = lookup.find({ class: d.class as DeviceClass | undefined, text: d.model });
  const exact = cands.filter((t) => isExact(t, d.model!));
  const pool = exact.length ? exact : [];
  return pool.find((t) => !d.make || norm(t.make).includes(norm(d.make)) || norm(d.make).includes(norm(t.make))) ?? pool[0];
}

/** Effective spec for a device: template spec overlaid by the device's own spec. */
export function specOf(d: { templateId?: string; class?: string; make?: string; model?: string; spec?: Record<string, unknown> }, lookup: LibraryLookup = library): Record<string, unknown> {
  const t = templateForDevice(d, lookup);
  return { ...(t?.spec ?? {}), ...(d.spec ?? {}) };
}

// ---------- instantiate ----------
export type NewId = (prefix: IdPrefix) => string;

function expandJacks(spec: Record<string, unknown>, newId: NewId): Jack[] | undefined {
  const list = spec.jacks as (JackTemplate | Jack)[] | undefined;
  if (!Array.isArray(list)) return undefined;
  const out: Jack[] = [];
  let n = 1;
  for (const j of list) {
    if ("front" in j) { out.push({ ...j, id: newId("jack"), number: n++, front: { cableId: null }, rear: { cableId: null } }); continue; }
    for (let i = 0; i < j.count; i++) {
      const jack: Jack = { id: newId("jack"), number: n++, type: j.type, front: { cableId: null }, rear: { cableId: null } };
      if (j.group) jack.group = j.group;
      if (j.label) jack.label = `${j.label} ${i + 1}`;
      out.push(jack);
    }
  }
  return out;
}

/** Template → devices[] entry: mints a dev_ id, a p_ id per expanded port and a jack_ id per panel jack. */
export function instantiate(t: DeviceTemplate, label: string, newId: NewId): Device {
  const spec = structuredClone(t.spec) as Record<string, unknown>;
  const jacks = expandJacks(spec, newId);
  if (jacks) spec.jacks = jacks;
  const ports: Port[] = t.ports.flatMap((p) =>
    Array.from({ length: p.count }, (_, i) => ({ id: newId("p"), name: p.count > 1 ? `${p.name} ${i + 1}` : p.name, type: p.type, dir: p.dir })));
  return {
    id: newId("dev"), templateId: t.templateId, class: t.class, make: t.make, model: t.model, label,
    qty: 1, rackId: null, ru: t.ru, powerW: t.powerW, weightLb: t.weightLb, ports, spec, source: t.source,
    inventoryRef: { system: "RentalWorks", iCode: t.inventory?.iCodes[0] ?? "", barcode: "" },
  };
}

/** Smallest "<PREFIX>-n" label not already used in devices[] (labels are unique per collection). */
export function nextLabel(used: Iterable<string>, prefix: string, start = 1): string {
  const set = new Set([...used].map((l) => l.trim().toLowerCase()));
  for (let i = start; ; i++) if (!set.has(`${prefix}-${i}`.toLowerCase())) return `${prefix}-${i}`;
}
