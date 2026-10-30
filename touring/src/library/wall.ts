// Wall geometry shared by LED Map (derive/validate) and Media Servers (content spec fallback).
// Pure functions over a ShowRecord + the device library; no module imports another module.
import type { Device, DeviceTemplate, LibraryLookup, Port, ShowRecord, Wall } from "../store/types";
import { library, specOf, templateForDevice, templateForTileModel } from "./library";

export const MM_TO_FT = 0.00328;
export const DEFAULT_PX_PER_PORT = 525000;
/** A 10G (fiberLED) output carries ten 1G ports' worth of pixels (one XD = 10× 1G). */
export const PORTS_PER_10G = 10;
/** Header bar weight used for rigging loads when the tile template gives none (planning value). */
export const DEFAULT_HEADER_LB = 40;

export interface TileSpec {
  templateId: string | null; label: string; px_w: number; px_h: number; w_mm: number; h_mm: number; pitch_mm: number;
  maxW: number; avgW: number; weightLb: number; headerLb: number; protocol: string | null; approximate: boolean; caseModel?: string;
}

export function tileTemplateForWall(w: Pick<Wall, "templateId" | "tileModel">, lookup: LibraryLookup = library): DeviceTemplate | undefined {
  const byId = w.templateId ? lookup.get(w.templateId) : undefined;
  if (byId && byId.class === "tile") return byId;
  return templateForTileModel(w.tileModel, lookup);
}

/** Tile spec for a wall: library template (via templateId or tileModel) first, wall's own mm fields as fallback. */
export function tileSpecForWall(w: Wall, lookup: LibraryLookup = library): TileSpec {
  const t = tileTemplateForWall(w, lookup);
  if (t) {
    const s = t.spec as Record<string, number | string | null>;
    return {
      templateId: t.templateId, label: shortTileName(t), px_w: Number(s.px_w) || 0, px_h: Number(s.px_h) || 0,
      w_mm: Number(s.w_mm) || w.tileW_mm || 0, h_mm: Number(s.h_mm) || w.tileH_mm || 0, pitch_mm: Number(s.pitch_mm) || w.pitch_mm || 0,
      maxW: Number(s.maxW) || 0, avgW: Number(s.avgW) || 0, weightLb: t.weightLb, headerLb: Number(s.headerLb) || DEFAULT_HEADER_LB,
      protocol: (s.protocol as string) ?? null, approximate: t.source === "approximate", caseModel: t.inventory?.caseModel,
    };
  }
  const px = (mm: number) => (w.pitch_mm > 0 ? Math.round(mm / w.pitch_mm) : 0);
  return {
    templateId: null, label: w.tileModel || "tile", px_w: px(w.tileW_mm), px_h: px(w.tileH_mm), w_mm: w.tileW_mm, h_mm: w.tileH_mm, pitch_mm: w.pitch_mm,
    maxW: 0, avgW: 0, weightLb: 0, headerLb: DEFAULT_HEADER_LB, protocol: null, approximate: true,
  };
}

/** "ROE Visual" + "Carbon CB5" → "CB5" — the name a crew uses in a sentence. */
export function shortTileName(t: DeviceTemplate): string {
  return t.aliases?.[0] ?? t.model;
}

export interface WallGeometry {
  tile: TileSpec; tiles: number; w_px: number; h_px: number; w_ft: number; h_ft: number; px: number;
  maxW: number; avgW: number; panelWeightLb: number; headerWeightLb: number; weightLb: number;
  pxPerPort: number; portsNeeded: number; redundant: boolean; approximate: boolean; tilesPerPort: number;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function deviceById(r: ShowRecord, id: string | null | undefined): Device | undefined {
  return id ? r.devices.find((d) => d.id === id) : undefined;
}

export function portOwner(r: ShowRecord, portId: string): { device: Device; port: Port } | undefined {
  for (const d of r.devices) {
    const p = d.ports.find((x) => x.id === portId);
    if (p) return { device: d, port: p };
  }
  return undefined;
}

/** 1G pixel capacity of a processor (device spec → template → 525,000 default). */
export function pxPerPortOf(d: Device | undefined, lookup: LibraryLookup = library): { px: number; approximate: boolean } {
  if (!d) return { px: DEFAULT_PX_PER_PORT, approximate: true };
  const s = specOf(d, lookup);
  const v = Number(s.pxPerPort8bit);
  const t = templateForDevice(d, lookup);
  return v > 0 ? { px: v, approximate: d.source === "approximate" || (!d.spec?.pxPerPort8bit && t?.source === "approximate") } : { px: DEFAULT_PX_PER_PORT, approximate: true };
}

/** Pixel capacity of one processor output port: 1G etherCon = pxPerPort8bit, 10G fiberLED = ×10. */
export function portCapacity(r: ShowRecord, portId: string, lookup: LibraryLookup = library): { px: number; device?: Device; port?: Port } {
  const o = portOwner(r, portId);
  if (!o) return { px: DEFAULT_PX_PER_PORT };
  const base = pxPerPortOf(o.device, lookup).px;
  return { px: o.port.type === "fiberLED" ? base * PORTS_PER_10G : base, device: o.device, port: o.port };
}

/** pxPerPort of the wall's first processor (the capacity LED Map plans ports against). */
export function wallPxPerPort(r: ShowRecord, w: Wall, lookup: LibraryLookup = library): { px: number; approximate: boolean } {
  return pxPerPortOf(deviceById(r, w.processorIds[0]), lookup);
}

export function wallGeometry(r: ShowRecord, w: Wall, lookup: LibraryLookup = library): WallGeometry {
  const tile = tileSpecForWall(w, lookup);
  const tiles = Math.max(0, w.cols) * Math.max(0, w.rows);
  const w_px = w.cols * tile.px_w;
  const h_px = w.rows * tile.px_h;
  const pxPer = wallPxPerPort(r, w, lookup);
  const tilePx = tile.px_w * tile.px_h;
  const redundant = w.dataRuns.some((d) => d.redundant);
  const base = tiles > 0 && tilePx > 0 ? Math.ceil((tiles * tilePx) / pxPer.px) : 0;
  const panelWeightLb = round(tiles * tile.weightLb, 2);
  const headerWeightLb = Math.max(0, w.rigging?.headers ?? 0) * tile.headerLb;
  return {
    tile, tiles, w_px, h_px, px: w_px * h_px,
    w_ft: round(w.cols * tile.w_mm * MM_TO_FT, 2), h_ft: round(w.rows * tile.h_mm * MM_TO_FT, 2),
    maxW: tiles * tile.maxW, avgW: tiles * tile.avgW, panelWeightLb, headerWeightLb, weightLb: round(panelWeightLb + headerWeightLb, 2),
    pxPerPort: pxPer.px, portsNeeded: redundant ? base * 2 : base, redundant,
    approximate: tile.approximate || pxPer.approximate, tilesPerPort: tilePx > 0 ? Math.max(1, Math.floor(pxPer.px / tilePx)) : 0,
  };
}

/** Wall px for consumers that prefer the derived cache (Media Servers): derived.led.perWall first, computed otherwise. */
export function wallPx(r: ShowRecord, w: Wall): { w_px: number; h_px: number } {
  const d = r.derived?.led?.perWall?.[w.id];
  if (d) return { w_px: d.w_px, h_px: d.h_px };
  const g = wallGeometry(r, w);
  return { w_px: g.w_px, h_px: g.h_px };
}

/** Column-snake order: col 0 top→bottom, col 1 bottom→top, … — the default tile data chain. */
export function snakeOrder(cols: number, rows: number): [number, number][] {
  const out: [number, number][] = [];
  for (let c = 0; c < cols; c++) for (let i = 0; i < rows; i++) out.push([c, c % 2 === 0 ? i : rows - 1 - i]);
  return out;
}
