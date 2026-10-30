// Port rules (Signal graph tab): the compatibility matrix as data, format parsing / ranking,
// port-direction rules, reach and stock tables. A new connector is a row here, not a code change.
import type { CableType, PortDir, PortType, Severity } from "../../store/types";

export interface PortRule {
  from: PortType[];
  to: PortType[];
  /** Allowed cable types; the first is the default picked by `connect()`. */
  cable: CableType[];
  /** Highest format the pair carries (`null` = not format-checked / inherits). */
  maxFormat: string | null;
  /** Severity when the arriving format exceeds `maxFormat`. */
  severity: Severity;
  formatRule: string;
  note?: string;
}

const SDI_ALL: PortType[] = ["12G-SDI", "3G-SDI", "HD-SDI"];

/** `port-rules` — read top to bottom, first matching row wins. */
export const PORT_RULES: PortRule[] = [
  { from: ["12G-SDI"], to: ["12G-SDI"], cable: ["SDI"], maxFormat: "2160p60", severity: "block", formatRule: "any up to 2160p60", note: "12G source to 12G sink" },
  { from: ["12G-SDI"], to: ["3G-SDI"], cable: ["SDI"], maxFormat: "1080p60", severity: "block", formatRule: "source must be ≤ 1080p60", note: "Down-rated by sink; block if source is 4K" },
  { from: ["3G-SDI"], to: ["12G-SDI", "3G-SDI"], cable: ["SDI"], maxFormat: "1080p60", severity: "block", formatRule: "≤ 1080p60" },
  { from: ["3G-SDI", "12G-SDI"], to: ["HD-SDI"], cable: ["SDI"], maxFormat: "1080i60", severity: "block", formatRule: "≤ 1080i / 720p", note: "block on 1080p sources" },
  { from: ["HD-SDI"], to: SDI_ALL, cable: ["SDI"], maxFormat: "1080i60", severity: "block", formatRule: "≤ 1080i / 720p", note: "HD-SDI source (added row)" },
  { from: ["HDMI2.0"], to: ["HDMI2.0", "HDMI2.1"], cable: ["HDMI"], maxFormat: "2160p60", severity: "block", formatRule: "≤ 2160p60", note: "HDCP flagged as warn when sink is an LED processor" },
  { from: ["HDMI2.1"], to: ["HDMI2.0"], cable: ["HDMI"], maxFormat: "2160p60", severity: "block", formatRule: "≤ 2160p60", note: "8K / 4K120 sources block" },
  { from: ["HDMI2.1"], to: ["HDMI2.1"], cable: ["HDMI"], maxFormat: "4320p60", severity: "block", formatRule: "≤ 4320p60", note: "added row" },
  { from: ["DP1.2"], to: ["DP1.2", "DP1.4"], cable: ["DP"], maxFormat: "2160p60", severity: "block", formatRule: "≤ 2160p60 (DP 1.2)", note: "Server to processor; cable ≤ 15 ft or active" },
  { from: ["DP1.4"], to: ["DP1.2"], cable: ["DP"], maxFormat: "2160p60", severity: "block", formatRule: "≤ 2160p60 (DP 1.2 sink)", note: "Server to processor; cable ≤ 15 ft or active" },
  { from: ["DP1.4"], to: ["DP1.4"], cable: ["DP"], maxFormat: "2160p120", severity: "block", formatRule: "≤ 2160p120 (DP 1.4)", note: "Server to processor; cable ≤ 15 ft or active" },
  { from: ["DP1.2", "DP1.4"], to: ["HDMI2.0", "HDMI2.1"], cable: ["DP-HDMI"], maxFormat: "2160p60", severity: "block", formatRule: "≤ 2160p60", note: "Active adapter, instantiated as a converter with ru: 0" },
  { from: ["DVI", "HDMI2.0", "HDMI2.1"], to: ["DVI"], cable: ["HDMI"], maxFormat: "1920x1200p60", severity: "block", formatRule: "≤ 1920×1200p60 (single-link DVI)", note: "added row; HDMI–DVI cable" },
  { from: ["DVI"], to: ["HDMI2.0", "HDMI2.1"], cable: ["HDMI"], maxFormat: "1920x1200p60", severity: "block", formatRule: "≤ 1920×1200p60 (single-link DVI)", note: "added row" },
  { from: ["fiberLED"], to: ["fiberLED"], cable: ["fiberLED"], maxFormat: null, severity: "block", formatRule: "n/a (Tessera / COEX protocol)", note: "Processor 10G to XD / tile; same protocol on both devices" },
  { from: ["etherCon"], to: ["etherCon"], cable: ["etherCon"], maxFormat: null, severity: "block", formatRule: "n/a", note: "XD / processor 1G to tile, tile to tile; same protocol" },
  { from: ["fiber-SMPTE"], to: ["fiber-SMPTE"], cable: ["SMPTE-311"], maxFormat: null, severity: "block", formatRule: "n/a", note: "Camera head ↔ CCU; bidir both ends" },
  { from: ["fiber-LC"], to: ["fiber-LC"], cable: ["fiber"], maxFormat: null, severity: "block", formatRule: "inherits", note: "FiDO / optical converters; both ends same SFP rate" },
  { from: ["fiber-ST"], to: ["fiber-ST"], cable: ["fiber"], maxFormat: null, severity: "block", formatRule: "inherits", note: "added row" },
  { from: ["cat6"], to: ["cat6"], cable: ["cat6"], maxFormat: null, severity: "block", formatRule: "n/a", note: "Control / NDI / Dante; both devices must share a VLAN" },
  { from: ["genlock"], to: ["genlock"], cable: ["BNC-ref"], maxFormat: null, severity: "block", formatRule: "tri-level or black burst must match sink's spec.refFormats" },
  { from: ["LTC"], to: ["LTC"], cable: ["audio-TRS", "BNC"], maxFormat: null, severity: "warn", formatRule: "frame rate must match house format", note: "29.97 DF vs 30 ND is a warn" },
  { from: ["tally"], to: ["tally"], cable: ["tally"], maxFormat: null, severity: "block", formatRule: "n/a", note: "comms layer; not format-checked" },
  { from: ["intercom"], to: ["intercom"], cable: ["comms"], maxFormat: null, severity: "block", formatRule: "n/a", note: "comms layer; not format-checked" },
  { from: ["AC-out"], to: ["AC-in"], cable: ["power"], maxFormat: null, severity: "block", formatRule: "voltage / connector match", note: "Owned by Rack and LED; never on the signal canvas" },
];

export interface Compat { cableType: CableType; cableTypes: CableType[]; maxFormat: string | null; severity: Severity; formatRule: string; rule: PortRule }

export function ruleFor(fromType: PortType, toType: PortType): PortRule | undefined {
  return PORT_RULES.find((r) => r.from.includes(fromType) && r.to.includes(toType));
}

/** The matrix row joining two port types, or null when the pair cannot be cabled. */
export function compatible(fromType: PortType, toType: PortType): Compat | null {
  const rule = ruleFor(fromType, toType);
  if (!rule) return null;
  return { cableType: rule.cable[0], cableTypes: rule.cable, maxFormat: rule.maxFormat, severity: rule.severity, formatRule: rule.formatRule, rule };
}

// ---------------- port direction ----------------
export const canSource = (dir: PortDir) => dir === "out" || dir === "bidir";
export const canSink = (dir: PortDir) => dir === "in" || dir === "bidir";

// ---------------- formats ----------------
export interface Format { w: number; h: number; scan: "p" | "i"; rate: number; rateGiven: boolean }

const STD_W: Record<number, number> = { 480: 720, 486: 720, 576: 720, 720: 1280, 1080: 1920, 1200: 1920, 1440: 2560, 2160: 3840, 4320: 7680 };

/**
 * Parses "1080p59.94", "3840x2160p59.94", "2160p59.94", "1080i59.94", "720p59.94", "3840×2160 @ 59.94",
 * "4096x2160p60", "3840x2160" (rate defaults to 60, conservative). Returns null for anything else.
 */
export function parseFormat(s: string | null | undefined): Format | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim().replace(/×/g, "x").replace(/\s+/g, "").replace(/@/g, "").toLowerCase();
  let m = /^(\d{3,5})x(\d{3,5})(?:([pi])?(\d+(?:\.\d+)?))?$/.exec(t);
  if (m) {
    const rate = m[4] ? Number(m[4]) : 60;
    return { w: Number(m[1]), h: Number(m[2]), scan: (m[3] as "p" | "i") ?? "p", rate, rateGiven: !!m[4] };
  }
  m = /^(\d{3,4})([pi])(\d+(?:\.\d+)?)?$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const w = STD_W[h] ?? Math.round((h * 16) / 9);
    return { w, h, scan: m[2] as "p" | "i", rate: m[3] ? Number(m[3]) : 60, rateGiven: !!m[3] };
  }
  return null;
}

function rateStr(r: number): string {
  return Number.isInteger(r) ? String(r) : String(Number(r.toFixed(3)));
}

/** Canonical short form: 3840x2160p59.94 → 2160p59.94; non-standard widths keep W×H (4096x2160p60). */
export function normalizeFormat(s: string | null | undefined): string {
  const f = parseFormat(s);
  if (!f) return (s ?? "").trim();
  const std = STD_W[f.h] === f.w;
  return `${std ? "" : `${f.w}x`}${f.h}${f.scan}${rateStr(f.rate)}`;
}

/** Long form used in evidence: 3840×2160 @ 59.94. */
export function describeFormat(s: string | null | undefined): string {
  const f = parseFormat(s);
  if (!f) return s || "(no format)";
  return `${f.w}×${f.h}${f.scan === "i" ? "i" : ""} @ ${rateStr(f.rate)}`;
}

export function sameFormat(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = parseFormat(a);
  const fb = parseFormat(b);
  if (!fa || !fb) return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  return fa.w === fb.w && fa.h === fb.h && fa.scan === fb.scan && Math.abs(fa.rate - fb.rate) < 0.01;
}

/** Ranking key: active pixel rate (frames per second for p, frame pairs for i). */
export function formatRank(s: string | Format | null | undefined): number {
  const f = typeof s === "object" && s !== null ? s : parseFormat(s as string);
  if (!f) return 0;
  const frames = f.scan === "i" ? f.rate / 2 : f.rate;
  return f.w * f.h * frames;
}

/** a ≤ b with a small tolerance so 59.94 fits a 60 limit. */
export function formatLE(a: string, b: string): boolean {
  return formatRank(a) <= formatRank(b) * 1.0001;
}

/** Highest format each port type accepts, independent of the source side. */
export const PORT_MAX_FORMAT: Partial<Record<PortType, string>> = {
  "12G-SDI": "2160p60", "3G-SDI": "1080p60", "HD-SDI": "1080i60",
  "HDMI2.0": "2160p60", "HDMI2.1": "4320p60", "DP1.2": "2160p60", "DP1.4": "2160p120", "DVI": "1920x1200p60",
};

export const VIDEO_PORT_TYPES: PortType[] = ["12G-SDI", "3G-SDI", "HD-SDI", "HDMI2.0", "HDMI2.1", "DP1.2", "DP1.4", "DVI"];
export const isVideoPort = (t: PortType) => VIDEO_PORT_TYPES.includes(t);

export interface FormatFit { ok: boolean; max: string | null; arriving: string; rank: number; maxRank: number }

/** Does `format` fit what a `toPortType` input accepts? Unparseable formats and unrated ports fit. */
export function formatFits(format: string, toPortType: PortType, maxOverride?: string | null): FormatFit {
  const max = maxOverride ?? PORT_MAX_FORMAT[toPortType] ?? null;
  const rank = formatRank(format);
  if (!max || !rank) return { ok: true, max, arriving: format, rank, maxRank: max ? formatRank(max) : 0 };
  return { ok: formatLE(format, max), max, arriving: format, rank, maxRank: formatRank(max) };
}

/** "3G-SDI accepts up to 1080p60" phrasing for rules. */
export function maxPhrase(max: string): string {
  const f = parseFormat(max);
  if (!f) return max;
  return normalizeFormat(max);
}

// ---------------- reach ----------------
/** Copper reach in feet by cable type and (for SDI) the format carried. */
export function reachFt(cableType: CableType, format?: string | null): { reach: number; basis: string } | null {
  if (cableType === "SDI" || cableType === "BNC") {
    const rank = formatRank(format ?? "");
    if (rank > formatRank("1080p60") * 1.0001) return { reach: 230, basis: "12G-SDI (2160p) ≈ 230 ft" };
    return { reach: 330, basis: "3G-SDI (1080p) ≈ 330 ft" };
  }
  if (cableType === "DP" || cableType === "DP-HDMI") return { reach: 15, basis: "DisplayPort passive ≤ 15 ft" };
  if (cableType === "cat6") return { reach: 328, basis: "Cat6 ≤ 328 ft (100 m)" };
  return null;
}

// ---------------- stock ----------------
/** Stock lengths per cable type (Cable & panels tab); record.physical.stock overlays these. */
export const DEFAULT_STOCK: Partial<Record<CableType, number[]>> = {
  SDI: [3, 6, 10, 15, 25, 50, 75, 100, 150, 200, 250],
  "BNC-ref": [3, 6, 10, 15, 25, 50, 75, 100, 150, 200, 250],
  BNC: [3, 6, 10, 15, 25, 50, 75, 100, 150, 200, 250],
  fiber: [100, 250, 500, 1000],
  "SMPTE-311": [100, 164, 328, 500, 1000],
  cat6: [3, 7, 15, 25, 50, 100, 150, 250],
  etherCon: [3, 6, 10, 25, 50],
  // Not in the spec's stock list — working assumptions so every type rounds to something orderable.
  HDMI: [3, 6, 10, 15, 25, 50],
  DP: [3, 6, 10, 15, 25, 50],
  "DP-HDMI": [3, 6, 10, 15],
  fiberLED: [3, 10, 25, 50, 100, 150, 250, 500],
  comms: [10, 25, 50, 100, 250],
  tally: [10, 25, 50, 100, 250],
  "audio-TRS": [6, 10, 25, 50, 100],
};

export function stockList(type: CableType, overlay?: Partial<Record<CableType, number[]>>): number[] {
  const l = overlay?.[type]?.length ? overlay[type]! : DEFAULT_STOCK[type] ?? [];
  return [...l].sort((a, b) => a - b);
}

/** Smallest stock length ≥ derived. `over` = derived exceeds the longest stock (two runs + coupler). */
export function roundStock(type: CableType, derived: number, overlay?: Partial<Record<CableType, number[]>>): { stock: number; over: boolean; longest: number | null } {
  const list = stockList(type, overlay);
  if (!list.length) return { stock: Math.ceil(derived), over: false, longest: null };
  const hit = list.find((s) => s >= derived - 1e-9);
  const longest = list[list.length - 1];
  return hit !== undefined ? { stock: hit, over: false, longest } : { stock: longest, over: true, longest };
}

// ---------------- labels ----------------
export const CABLE_LABEL_PREFIX: Record<CableType, string> = {
  SDI: "SDI", HDMI: "HDMI", DP: "DP", "DP-HDMI": "DPH", "SMPTE-311": "SMP", fiber: "FIB", cat6: "CAT", tally: "TAL", comms: "COM",
  "BNC-ref": "REF", "audio-TRS": "LTC", BNC: "BNC", power: "PWR", etherCon: "LED", fiberLED: "LED", tilePower: "PWR",
};

/** Colour-band convention (offered, not enforced). */
export function labelColour(type: CableType, path: "A" | "B" | null): string {
  if (type === "comms" || type === "tally") return "green";
  if (type === "cat6") return "blue";
  if (type === "etherCon" || type === "fiberLED") return "orange";
  return path === "B" ? "yellow" : "white";
}

/** Cable types drawn on the video chain (used for chains, cycles and single points). */
export const CHAIN_CABLE_TYPES: CableType[] = ["SDI", "HDMI", "DP", "DP-HDMI", "SMPTE-311", "fiber", "fiberLED", "etherCon", "BNC"];
