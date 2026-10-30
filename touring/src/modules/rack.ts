// Rack Build module (`rack`). Owns /racks, devices of class rackPdu/ups/shelf/patchPanel, and the
// rackId / ru / positionId allowlist on every device. Pure: writes are returned as Patch[] applied as 'rack'.
import type { CheckDraft, Derived, Device, ModuleContract, Patch, Rack, SeedContext, ShowRecord } from "../store/types";
import { newId as defaultNewId } from "../store/ids";
import { instantiate, library, nextLabel, templateForDevice, type NewId } from "../library/library";
import { tileTemplateForWall } from "../library/wall";
import { fmt, toCsv } from "../util/csv";

export const RACK_VOLTS = 120;
export const DEFAULT_RACK_RU = 24;
export const INLET_LIMIT = 0.8;

/** Inlet ratings: amps per leg and the voltage a rack's load is divided by (RCK-003 compares W ÷ V to 0.8 × amps). */
export const INLETS: Record<string, { amps: number; volts: number }> = {
  "L21-30": { amps: 30, volts: 120 }, "L21-20": { amps: 20, volts: 120 }, "L5-30": { amps: 30, volts: 120 }, "L5-20": { amps: 20, volts: 120 },
  "L6-30": { amps: 30, volts: 208 }, "L6-20": { amps: 20, volts: 208 }, "5-20": { amps: 20, volts: 120 }, "5-15": { amps: 15, volts: 120 },
  edison: { amps: 15, volts: 120 }, "powerCON TRUE1": { amps: 16, volts: 120 }, "powerCON": { amps: 20, volts: 120 },
};
export function inletRating(inlet: string | null | undefined): { amps: number; volts: number; known: boolean } {
  const k = Object.keys(INLETS).find((x) => x.toLowerCase() === (inlet ?? "").trim().toLowerCase());
  return k ? { ...INLETS[k], known: true } : { amps: 20, volts: RACK_VOLTS, known: false };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const devOf = (r: ShowRecord, id: string) => r.devices.find((d) => d.id === id);
const size = (d: Device | undefined) => Math.max(0, d?.ru ?? 0);

function findRack(r: ShowRecord, rackId: string): Rack {
  const k = r.racks.find((x) => x.id === rackId);
  if (!k) throw new Error(`no rack ${rackId}`);
  return k;
}

/** RU → device ids occupying it (a slot at ru with a device of height h covers ru … ru + h − 1). */
export function occupancy(r: ShowRecord, rack: Rack): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const s of rack.slots) {
    const h = Math.max(1, size(devOf(r, s.deviceId)));
    for (let u = s.ru; u < s.ru + h; u++) m.set(u, [...(m.get(u) ?? []), s.deviceId]);
  }
  return m;
}

/** Device ids placed in any rack's slots. */
export function placedIds(r: ShowRecord): Set<string> {
  return new Set(r.racks.flatMap((k) => k.slots.map((s) => s.deviceId)));
}

/** Lowest RU where `ruSize` consecutive units are free, or null. */
export function firstFreeRu(r: ShowRecord, rackId: string, ruSize: number): number | null {
  const rack = findRack(r, rackId);
  return firstFreeIn(occupancy(r, rack), rack.ruTotal, ruSize);
}

function firstFreeIn(occ: Map<number, unknown>, ruTotal: number, ruSize: number): number | null {
  const h = Math.max(1, ruSize);
  for (let u = 1; u + h - 1 <= ruTotal; u++) {
    let ok = true;
    for (let k = u; k < u + h; k++) if (occ.has(k)) { ok = false; break; }
    if (ok) return u;
  }
  return null;
}

// ---------------- derive ----------------
function caseCapacity(caseModel: string): number {
  const m = /\((\d+)\)\s*$/.exec(caseModel);
  return m ? Math.max(1, Number(m[1])) : 1;
}

export function deriveRack(r: ShowRecord): Pick<Derived, "racks"> & { inventory: Pick<Derived["inventory"], "deviceCount" | "caseCount"> } {
  const byRack: Derived["racks"]["byRack"] = {};
  for (const k of r.racks) {
    const ids = [...new Set(k.slots.map((s) => s.deviceId))];
    const devs = ids.map((id) => devOf(r, id)).filter((d): d is Device => !!d);
    const powerW = devs.reduce((s, d) => s + (d.powerW || 0) * (d.qty || 1), 0);
    byRack[k.id] = {
      ruUsed: devs.reduce((s, d) => s + size(d), 0),
      weightLb: round(devs.reduce((s, d) => s + (d.weightLb || 0) * (d.qty || 1), 0)),
      powerW, amps: round(powerW / RACK_VOLTS),
    };
  }
  // Cases: one per rack, plus loose (unracked) devices grouped by their template's case model, plus tile dollies per wall.
  const placed = placedIds(r);
  const cases = new Map<string, number>();
  for (const d of r.devices) {
    if (placed.has(d.id) || d.rackId) continue;
    const cm = templateForDevice(d)?.inventory?.caseModel;
    if (cm) cases.set(cm, (cases.get(cm) ?? 0) + (d.qty || 1));
  }
  for (const w of r.led.walls) {
    const cm = tileTemplateForWall(w)?.inventory?.caseModel;
    const tiles = Math.max(0, w.cols) * Math.max(0, w.rows);
    if (cm && tiles) cases.set(cm, (cases.get(cm) ?? 0) + tiles);
  }
  let caseCount = r.racks.length;
  for (const [cm, n] of cases) caseCount += Math.ceil(n / caseCapacity(cm));
  return { racks: { byRack }, inventory: { deviceCount: r.devices.reduce((s, d) => s + (d.qty || 1), 0), caseCount } };
}

// ---------------- validate ----------------
export function validateRack(r: ShowRecord): CheckDraft[] {
  const out: CheckDraft[] = [];
  const where = new Map<string, Rack[]>();
  for (const k of r.racks) for (const s of k.slots) where.set(s.deviceId, [...(where.get(s.deviceId) ?? []), k]);

  for (const k of r.racks) {
    const kp = `/racks/${k.id}`;
    // RCK-001 RU overlap
    const occ = occupancy(r, k);
    const pairs = new Map<string, { a: string; b: string; rus: number[] }>();
    for (const [u, ids] of occ) {
      const uniq = [...new Set(ids)];
      for (let i = 1; i < uniq.length; i++) {
        const key = `${uniq[0]}|${uniq[i]}`;
        const p = pairs.get(key) ?? { a: uniq[0], b: uniq[i], rus: [] };
        p.rus.push(u);
        pairs.set(key, p);
      }
    }
    for (const p of pairs.values()) {
      const a = devOf(r, p.a), b = devOf(r, p.b);
      const ia = k.slots.findIndex((s) => s.deviceId === p.a), ib = k.slots.findIndex((s) => s.deviceId === p.b);
      const free = b ? firstFreeIn(new Map([...occ].filter(([, ids]) => !ids.includes(p.b))), k.ruTotal, size(b)) : null;
      out.push({
        code: "RCK-001", severity: "block", title: "RU overlap", target: p.b, involved: [k.id, p.a, p.b],
        message: `${b?.label ?? "A device"} and ${a?.label ?? "another device"} both occupy RU ${p.rus.join(", ")} in ${k.name}.`,
        rule: `Each RU holds one device; ${a?.label} spans RU ${k.slots[ia]?.ru}–${(k.slots[ia]?.ru ?? 0) + Math.max(1, size(a)) - 1} and ${b?.label} spans RU ${k.slots[ib]?.ru}–${(k.slots[ib]?.ru ?? 0) + Math.max(1, size(b)) - 1}.`,
        evidence: [
          { label: `${b?.label} slot`, value: `RU ${k.slots[ib]?.ru}, ${size(b)} RU tall`, path: `${kp}/slots/${ib}` },
          { label: `${a?.label} slot`, value: `RU ${k.slots[ia]?.ru}, ${size(a)} RU tall`, path: `${kp}/slots/${ia}` },
          { label: `${k.name} size`, value: `${k.ruTotal} RU`, path: `${kp}/ruTotal` },
        ],
        fixes: [
          free != null ? { label: `Move ${b?.label} to RU ${free}`, module: "rack", patch: placeDevice(r, p.b, k.id, free) } : { label: `Move ${b?.label} to another rack`, module: "rack" },
        ],
      });
    }

    // RCK-002 RU overflow
    const ruUsed = [...new Set(k.slots.map((s) => s.deviceId))].reduce((s, id) => s + size(devOf(r, id)), 0);
    const over = k.slots.filter((s) => s.ru < 1 || s.ru + Math.max(1, size(devOf(r, s.deviceId))) - 1 > k.ruTotal);
    if (ruUsed > k.ruTotal || over.length) {
      out.push({
        code: "RCK-002", severity: "block", title: "RU overflow", target: k.id, involved: [k.id, ...over.map((s) => s.deviceId)],
        message: ruUsed > k.ruTotal
          ? `${k.name} holds ${ruUsed} RU of gear in a ${k.ruTotal} RU rack.`
          : `${over.map((s) => devOf(r, s.deviceId)?.label ?? "A device").join(", ")} ${over.length > 1 ? "extend" : "extends"} past the top of ${k.name} (${k.ruTotal} RU).`,
        rule: `RU used must be ≤ RU total and every device must sit within RU 1–${k.ruTotal}; used ${ruUsed} RU of ${k.ruTotal}.`,
        evidence: [
          { label: `${k.name} RU used`, value: `${ruUsed} RU`, path: `/derived/racks/byRack/${k.id}/ruUsed` },
          { label: `${k.name} RU total`, value: `${k.ruTotal} RU`, path: `${kp}/ruTotal` },
          ...over.map((s) => ({ label: `${devOf(r, s.deviceId)?.label} slot`, value: `RU ${s.ru}, ${size(devOf(r, s.deviceId))} RU tall`, path: `${kp}/slots/${k.slots.indexOf(s)}` })),
        ],
        fixes: [
          { label: `Move gear from ${k.name} to another rack (auto-rack)`, module: "rack" },
          { label: `Use a taller rack than ${k.ruTotal} RU`, module: "rack" },
        ],
      });
    }

    // RCK-003 over inlet rating
    const powerW = [...new Set(k.slots.map((s) => s.deviceId))].reduce((s, id) => { const d = devOf(r, id); return s + (d?.powerW || 0) * (d?.qty || 1); }, 0);
    const inlet = inletRating(k.power.inlet);
    const amps = powerW / inlet.volts;
    if (amps > INLET_LIMIT * inlet.amps) {
      out.push({
        code: "RCK-003", severity: "warn", title: "Over inlet rating", target: k.id, involved: [k.id, ...k.power.pduIds],
        message: `${k.name} draws ${fmt(powerW)} W (${fmt(amps, 1)} A) on its ${k.power.inlet || "unspecified"} inlet, above 80% of its ${inlet.amps} A rating.`,
        rule: `Rack W ÷ V must be ≤ 0.8 × inlet amps; ${fmt(powerW)} W ÷ ${inlet.volts} V = ${fmt(amps, 1)} A > 0.8 × ${inlet.amps} A = ${fmt(INLET_LIMIT * inlet.amps, 1)} A.`,
        evidence: [
          { label: `${k.name} load`, value: `${fmt(powerW)} W`, path: `/derived/racks/byRack/${k.id}/powerW` },
          { label: `${k.name} inlet`, value: `${k.power.inlet || "unspecified"} (${inlet.amps} A @ ${inlet.volts} V${inlet.known ? "" : ", assumed"})`, path: `${kp}/power/inlet` },
        ],
        fixes: [
          { label: `Move high-draw gear out of ${k.name}`, module: "rack" },
          { label: `Feed ${k.name} from a larger inlet`, module: "rack" },
        ],
      });
    }

    // RCK-005 no PDU
    const hasPdu = k.power.pduIds.some((id) => devOf(r, id)?.class === "rackPdu") || k.slots.some((s) => devOf(r, s.deviceId)?.class === "rackPdu");
    const nonPdu = k.slots.filter((s) => devOf(r, s.deviceId)?.class !== "rackPdu");
    if (nonPdu.length && !hasPdu) {
      const ru = firstFreeRu(r, k.id, 1);
      out.push({
        code: "RCK-005", severity: "warn", title: "No PDU", target: k.id, involved: [k.id],
        message: `${k.name} holds ${nonPdu.length} device${nonPdu.length > 1 ? "s" : ""} but no rack PDU.`,
        rule: `A rack with devices needs a rackPdu; ${k.name} has ${nonPdu.length} devices and 0 PDUs.`,
        evidence: [
          { label: `${k.name} PDUs`, value: "none", path: `${kp}/power/pduIds` },
          { label: `${k.name} devices`, value: String(nonPdu.length), path: `${kp}/slots` },
        ],
        fixes: [{ label: `Add a SurgeX SX-1120-RT to ${k.name}${ru != null ? ` at RU ${ru}` : ""}`, module: "rack" }],
      });
    }
  }

  // RCK-001 (variant) device placed in two racks
  for (const [id, racks] of where) {
    const uniq = [...new Set(racks)];
    if (uniq.length < 2) continue;
    const d = devOf(r, id);
    out.push({
      code: "RCK-001", severity: "block", title: "Device placed twice", target: id, involved: [id, ...uniq.map((k) => k.id)],
      message: `${d?.label ?? "A device"} is placed in ${uniq.map((k) => k.name).join(" and ")}.`,
      rule: `A device occupies one rack; ${d?.label} has slots in ${uniq.length} racks.`,
      evidence: uniq.map((k) => ({ label: `${k.name} slot`, value: `RU ${k.slots.find((s) => s.deviceId === id)?.ru}`, path: `/racks/${k.id}/slots/${k.slots.findIndex((s) => s.deviceId === id)}` })),
      fixes: [{ label: `Keep ${d?.label} in ${uniq.find((k) => k.id === d?.rackId)?.name ?? uniq[0].name} only`, module: "rack",
        patch: placeDevice(r, id, d?.rackId && uniq.some((k) => k.id === d.rackId) ? d.rackId : uniq[0].id, uniq.find((k) => k.id === (d?.rackId ?? uniq[0].id))?.slots.find((s) => s.deviceId === id)?.ru ?? 1) }],
    });
  }

  // RCK-004 unracked device
  const placed = placedIds(r);
  for (const d of r.devices) {
    if (!(d.ru > 0) || d.rackId || placed.has(d.id)) continue;
    let fix: CheckDraft["fixes"] = [{ label: `Place ${d.label} in a rack`, module: "rack" }];
    for (const k of r.racks) {
      const ru = firstFreeRu(r, k.id, d.ru);
      if (ru != null) { fix = [{ label: `Place ${d.label} in ${k.name} at RU ${ru}`, module: "rack", patch: placeDevice(r, d.id, k.id, ru) }]; break; }
    }
    out.push({
      code: "RCK-004", severity: "info", title: "Unracked device", target: d.id, involved: [d.id],
      message: `${d.label} takes ${d.ru} RU but is not placed in a rack.`,
      rule: `A device with ru > 0 needs a rack; ${d.label} has ru = ${d.ru} and no rack.`,
      evidence: [
        { label: `${d.label} height`, value: `${d.ru} RU`, path: `/devices/${d.id}/ru` },
        { label: `${d.label} rack`, value: "none", path: `/devices/${d.id}/rackId` },
      ],
      fixes: fix,
    });
  }
  return out;
}

// ---------------- helpers (Patch[] applied as 'rack') ----------------
/** Places a device at `ru` in `rackId`: removes it from any other slot, adds the slot, sets devices[].rackId (+ positionId from the rack). device.ru stays its height. */
export function placeDevice(r: ShowRecord, deviceId: string, rackId: string, ru: number): Patch[] {
  const rack = findRack(r, rackId);
  const d = devOf(r, deviceId);
  if (!d) throw new Error(`no device ${deviceId}`);
  const out: Patch[] = [];
  for (const k of r.racks) {
    if (k.id === rackId) continue;
    if (k.slots.some((s) => s.deviceId === deviceId)) out.push({ op: "replace", path: `/racks/${k.id}/slots`, value: k.slots.filter((s) => s.deviceId !== deviceId) });
    if (k.power.pduIds.includes(deviceId)) out.push({ op: "replace", path: `/racks/${k.id}/power/pduIds`, value: k.power.pduIds.filter((x) => x !== deviceId) });
  }
  const slots = [...rack.slots.filter((s) => s.deviceId !== deviceId), { ru, deviceId }].sort((a, b) => a.ru - b.ru);
  out.push({ op: "replace", path: `/racks/${rackId}/slots`, value: slots });
  if (d.class === "rackPdu" && !rack.power.pduIds.includes(deviceId)) out.push({ op: "replace", path: `/racks/${rackId}/power/pduIds`, value: [...rack.power.pduIds, deviceId] });
  if (d.rackId !== rackId) out.push({ op: "replace", path: `/devices/${deviceId}/rackId`, value: rackId });
  if (rack.positionId && d.positionId !== rack.positionId) out.push({ op: d.positionId === undefined ? "add" : "replace", path: `/devices/${deviceId}/positionId`, value: rack.positionId });
  return out;
}

/** Removes a device from every rack and clears its rackId. */
export function unplaceDevice(r: ShowRecord, deviceId: string): Patch[] {
  const out: Patch[] = [];
  for (const k of r.racks) {
    if (k.slots.some((s) => s.deviceId === deviceId)) out.push({ op: "replace", path: `/racks/${k.id}/slots`, value: k.slots.filter((s) => s.deviceId !== deviceId) });
    if (k.power.pduIds.includes(deviceId)) out.push({ op: "replace", path: `/racks/${k.id}/power/pduIds`, value: k.power.pduIds.filter((x) => x !== deviceId) });
  }
  const d = devOf(r, deviceId);
  if (d?.rackId) out.push({ op: "replace", path: `/devices/${deviceId}/rackId`, value: null });
  return out;
}

export function newRack(name: string, newId: NewId, ruTotal = DEFAULT_RACK_RU): Rack {
  return { id: newId("rack"), name, ruTotal, caseModel: `${ruTotal}RU shock rack`, location: "video world", slots: [], power: { inlet: "L21-30", pduIds: [], circuitIds: [] } };
}

/** Appends an empty 24 RU rack (L21-30 inlet). */
export function addRack(r: ShowRecord, name: string, newId: NewId, ruTotal = DEFAULT_RACK_RU): Patch[] {
  void r;
  return [{ op: "add", path: "/racks/-", value: newRack(name, newId, ruTotal) }];
}

/** Places every unracked device with ru > 0 first-fit (tallest first), adding VIDEO n racks as needed. */
export function autoRack(r: ShowRecord, newId: NewId = defaultNewId): Patch[] {
  const placed = placedIds(r);
  const todo = r.devices.filter((d) => d.ru > 0 && !placed.has(d.id) && !d.rackId).sort((a, b) => b.ru - a.ru);
  if (!todo.length) return [];
  const racks = r.racks.map((k) => ({ rack: k, occ: occupancy(r, k) as Map<number, unknown>, slots: [...k.slots], fresh: false }));
  const names = new Set(r.racks.map((k) => k.name));
  const out: Patch[] = [];
  const devPatches: Patch[] = [];
  for (const d of todo) {
    if (d.ru > DEFAULT_RACK_RU && !racks.some((k) => k.rack.ruTotal >= d.ru)) continue;
    let target = racks.find((k) => firstFreeIn(k.occ, k.rack.ruTotal, d.ru) != null);
    if (!target) {
      const name = nextLabel(names, "VIDEO", 1, { sep: " " });
      names.add(name);
      target = { rack: newRack(name, newId), occ: new Map(), slots: [], fresh: true };
      racks.push(target);
    }
    const ru = firstFreeIn(target.occ, target.rack.ruTotal, d.ru)!;
    for (let u = ru; u < ru + d.ru; u++) target.occ.set(u, d.id);
    target.slots.push({ ru, deviceId: d.id });
    devPatches.push({ op: "replace", path: `/devices/${d.id}/rackId`, value: target.rack.id });
    if (d.class === "rackPdu") target.rack = { ...target.rack, power: { ...target.rack.power, pduIds: [...target.rack.power.pduIds, d.id] } };
  }
  for (const k of racks) {
    const slots = k.slots.sort((a, b) => a.ru - b.ru);
    if (k.fresh) out.push({ op: "add", path: "/racks/-", value: { ...k.rack, slots } });
    else if (slots.length !== k.rack.slots.length) {
      out.push({ op: "replace", path: `/racks/${k.rack.id}/slots`, value: slots });
      const orig = r.racks.find((x) => x.id === k.rack.id)!;
      if (k.rack.power.pduIds.length !== orig.power.pduIds.length) out.push({ op: "replace", path: `/racks/${k.rack.id}/power/pduIds`, value: k.rack.power.pduIds });
    }
  }
  return [...out, ...devPatches];
}

// ---------------- seed ----------------
/** Blank-show default: rack VIDEO 1 (24 RU, L21-30) with a SurgeX PDU at RU 1. Idempotent (no-op when racks exist). */
export function seedRack(r: ShowRecord, ctx: Pick<SeedContext, "newId">): Patch[] {
  if (r.racks.length) return [];
  const rack = newRack("VIDEO 1", ctx.newId);
  const pdu = instantiate(library.get("tpl_surgex_sx1120")!, nextLabel(r.devices.map((d) => d.label), "PDU"), ctx.newId);
  pdu.rackId = rack.id;
  rack.slots = [{ ru: 1, deviceId: pdu.id }];
  rack.power.pduIds = [pdu.id];
  return [{ op: "add", path: "/racks/-", value: rack }, { op: "add", path: "/devices/-", value: pdu }];
}

// ---------------- export ----------------
export function renderRackElevation(r: ShowRecord): string {
  const rows: unknown[][] = [];
  for (const k of r.racks) {
    for (const s of [...k.slots].sort((a, b) => b.ru - a.ru)) {
      const d = devOf(r, s.deviceId);
      const h = Math.max(1, size(d));
      rows.push([k.name, k.ruTotal, s.ru, h > 1 ? `${s.ru}-${s.ru + h - 1}` : String(s.ru), d?.label ?? s.deviceId, d?.make ?? "", d?.model ?? "", d?.class ?? "", size(d), d?.powerW ?? 0, d?.weightLb ?? 0]);
    }
  }
  return toCsv(["Rack", "Rack RU", "RU", "Span", "Device", "Make", "Model", "Class", "Height RU", "Power W", "Weight lb"], rows);
}

export const rackModule: ModuleContract = {
  id: "rack",
  version: "1.0.0",
  owns: ["/racks"],
  reads: ["/racks", "/devices", "/led/walls"],
  deviceClasses: ["rackPdu", "ups", "shelf", "patchPanel"],
  cableTypes: [],
  seed: (record, ctx) => seedRack(record, ctx),
  derive: (record) => deriveRack(record) as Partial<Derived>,
  validate: (record) => validateRack(record),
  exports: [{ key: "rack-elevation", label: "Rack elevation", mime: "text/csv", render: renderRackElevation }],
};
