// RentalWorks pull-sheet import and the Airtable (Ground) push payload.
import { instantiate, LIBRARY } from "../library/library";
import { newId } from "../store/ids";
import { DEVICE_CLASS_OWNER } from "../store/ownership";
import type { Workspace } from "../store/store";
import type { Device, DeviceTemplate, Patch, ShowRecord, WriterId } from "../store/types";

export interface PullLine { iCode: string; description: string; qty: number }

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parses a RentalWorks pull-sheet CSV (header row with I-Code, Description, Qty in any order). */
export function parseRentalWorksCsv(text: string): PullLine[] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!rows.length) return [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  let header = splitCsvLine(rows[0]).map(norm);
  let start = 1;
  let iI = header.findIndex((h) => h === "icode" || h === "code" || h === "inventorycode" || h === "itemcode");
  let iD = header.findIndex((h) => h.startsWith("description") || h === "item" || h === "name");
  let iQ = header.findIndex((h) => h === "qty" || h === "quantity" || h === "qtyordered" || h === "ordered");
  if (iI < 0 && iD < 0) { header = []; start = 0; iI = 0; iD = 1; iQ = 2; }
  const out: PullLine[] = [];
  for (const row of rows.slice(start)) {
    const c = splitCsvLine(row);
    const iCode = (c[iI] ?? "").trim();
    const description = (iD >= 0 ? c[iD] : "")?.trim() ?? "";
    const qty = iQ >= 0 ? Number((c[iQ] ?? "").replace(/[^0-9.]/g, "")) : 1;
    if (!iCode && !description) continue;
    out.push({ iCode, description, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 });
  }
  return out;
}

function templates(): DeviceTemplate[] {
  return (LIBRARY as unknown as { templates: DeviceTemplate[] }).templates ?? [];
}

/** Order Intelligence matching: I-Codes first, then aliases against the description, then make + model. */
export function matchTemplate(line: PullLine): DeviceTemplate | undefined {
  const list = templates();
  const code = line.iCode.toLowerCase();
  const desc = ` ${line.description.toLowerCase()} `;
  const byCode = code ? list.find((t) => t.inventory?.iCodes.some((c) => c.toLowerCase() === code)) : undefined;
  if (byCode) return byCode;
  const word = (s: string) => new RegExp(`(^|[^a-z0-9])${s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(desc);
  const byAlias = list.filter((t) => (t.aliases ?? []).some((a) => a.length >= 3 && word(a))).sort((a, b) => longestAlias(b, desc) - longestAlias(a, desc))[0];
  if (byAlias) return byAlias;
  return list.find((t) => word(t.make) && word(t.model)) ?? list.find((t) => t.model.length >= 4 && word(t.model));
}
function longestAlias(t: DeviceTemplate, desc: string): number {
  return Math.max(0, ...(t.aliases ?? []).filter((a) => desc.includes(a.toLowerCase())).map((a) => a.length));
}

const IMPORT_TARGET = "import:rentalworks";

/** The previous import, kept as an annotation so the diff is store-tracked and survives reload. */
function previousImport(r: ShowRecord): Record<string, number> | null {
  const ann = [...r.binder.annotations].reverse().find((a) => a.target === IMPORT_TARGET);
  if (!ann) return null;
  try { return JSON.parse(ann.body.slice(ann.body.indexOf("{"))) as Record<string, number>; } catch { return null; }
}

function uniqueLabel(base: string, used: Set<string>): string {
  let n = 1;
  let l = `${base} ${n}`;
  while (used.has(l.toLowerCase())) l = `${base} ${++n}`;
  used.add(l.toLowerCase());
  return l;
}

export interface ImportResult { added: number; unknown: number; checks: string[]; diff: { added: PullLine[]; removed: { iCode: string; qty: number }[] } | null }

/**
 * Imports a pull sheet. First import: matched lines instantiate their template via the owning module's writer;
 * unmatched lines land as class `unknown` (shell) with an info check. Later imports never edit the record —
 * they diff against the last import and file IMP-001 (added) / IMP-002 (removed) warn checks.
 */
export function importPullSheet(ws: Workspace, showId: string, csvText: string): ImportResult {
  const lines = parseRentalWorksCsv(csvText);
  const r = ws.get(showId);
  const shell = ws.api(showId, "shell");
  const totals: Record<string, number> = {};
  for (const l of lines) { const k = l.iCode || l.description; totals[k] = (totals[k] ?? 0) + l.qty; }
  const prev = previousImport(r);
  const result: ImportResult = { added: 0, unknown: 0, checks: [], diff: null };

  if (prev) {
    const added = lines.filter((l) => (totals[l.iCode || l.description] ?? 0) > (prev[l.iCode || l.description] ?? 0));
    const removed = Object.entries(prev).filter(([k, q]) => (totals[k] ?? 0) < q).map(([iCode, qty]) => ({ iCode, qty: qty - (totals[iCode] ?? 0) }));
    result.diff = { added, removed };
    const seen = new Set<string>();
    for (const l of added) {
      const k = l.iCode || l.description;
      if (seen.has(k)) continue;
      seen.add(k);
      const delta = totals[k] - (prev[k] ?? 0);
      result.checks.push(shell.check({ code: "IMP-001", severity: "warn", target: `icode:${k}`, title: "Added since last import",
        message: `${l.description || k} (${k}): +${delta} on order ${r.vendor.orderRef || "?"} since the last pull-sheet import; add it in its owning module if it belongs in the system.` }));
    }
    for (const x of removed) result.checks.push(shell.check({ code: "IMP-002", severity: "warn", target: `icode:${x.iCode}`, title: "Removed since last import",
      message: `${x.iCode}: −${x.qty} on order ${r.vendor.orderRef || "?"} since the last pull-sheet import; remove or re-source the device in its owning module.` }));
  } else {
    const used = new Set(r.devices.map((d) => d.label.toLowerCase()));
    const byWriter = new Map<WriterId, Patch[]>();
    const push = (w: WriterId, d: Device) => byWriter.set(w, [...(byWriter.get(w) ?? []), { op: "add", path: "/devices/-", value: d }]);
    const deprecated: string[] = [];
    const unknown: PullLine[] = [];
    for (const l of lines) {
      const t = matchTemplate(l);
      if (!t) { unknown.push(l); continue; }
      if (t.deprecated) deprecated.push(`${l.iCode} → ${t.templateId}`);
      const writer = DEVICE_CLASS_OWNER[t.class][0];
      // Rack-mounted items become one device per unit (so each can be placed); bulk items carry qty.
      const units = t.ru > 0 ? Math.min(l.qty, 64) : 1;
      for (let i = 0; i < units; i++) {
        const d = instantiate(t, uniqueLabel(t.model, used), newId);
        d.qty = t.ru > 0 ? 1 : l.qty;
        d.inventoryRef = { system: "RentalWorks", iCode: l.iCode || d.inventoryRef.iCode || "", barcode: "" };
        push(writer, d);
        result.added++;
      }
    }
    for (const l of unknown) {
      push("shell", { id: newId("dev"), class: "unknown", make: "", model: l.description || l.iCode, label: uniqueLabel(l.iCode || "ITEM", used), qty: l.qty,
        rackId: null, ru: 0, powerW: 0, weightLb: 0, ports: [], inventoryRef: { system: "RentalWorks", iCode: l.iCode, barcode: "" } });
      result.unknown++;
    }
    for (const [writer, ops] of byWriter) {
      const res = ws.patch(showId, writer, ops, `import: RentalWorks pull sheet ${r.vendor.orderRef}`.trim());
      if (!res.ok) throw new Error(res.errors?.map((e) => `${e.code} ${e.path}: ${e.msg}`).join("; "));
    }
    if (unknown.length) result.checks.push(shell.check({ code: "IMP-003", severity: "info", target: IMPORT_TARGET, title: "Unrecognised I-Codes",
      message: `${unknown.length} pull-sheet line${unknown.length > 1 ? "s" : ""} did not match the device library (${unknown.slice(0, 4).map((u) => u.iCode || u.description).join(", ")}); assign a class to each.` }));
    if (deprecated.length) result.checks.push(shell.check({ code: "IMP-004", severity: "info", target: IMPORT_TARGET, title: "Deprecated template matched",
      message: `${deprecated.length} line${deprecated.length > 1 ? "s" : ""} matched a deprecated library template (${deprecated.slice(0, 3).join(", ")}).` }));
  }
  shell.annotate(IMPORT_TARGET, `RentalWorks import ${new Date().toISOString().slice(0, 10)} order ${r.vendor.orderRef || "?"} ${JSON.stringify(totals)}`);
  return result;
}

// ---------------------------------------------------------------- Airtable (Ground)

export const AIRTABLE_BASE = "appzQEKX7O1IAi6KN";

export interface AirtableRow { id?: string; fields: Record<string, unknown> }

/** One-way push payload: Shows ← identity + meta; Devices; Racks; Checks (open only). No network. */
export function airtablePayload(r: ShowRecord): { baseId: string; Shows: AirtableRow[]; Devices: AirtableRow[]; Racks: AirtableRow[]; Checks: AirtableRow[] } {
  const rackName = new Map(r.racks.map((k) => [k.id, k.name]));
  return {
    baseId: AIRTABLE_BASE,
    Shows: [{ fields: {
      showId: r.showId, showCode: r.showCode, name: r.name, artist: r.client.artist, eventType: r.event.type, dates: r.event.dates.join(", "),
      venue: r.event.venueName, city: r.event.city, state: r.event.state, room: r.event.room, orderRef: r.vendor.orderRef, vendor: r.vendor.company,
      status: r.meta.status, revision: r.meta.revision, updatedAt: r.meta.updatedAt, tourId: r.tourId ?? "",
    } }],
    Devices: r.devices.map((d) => ({ ...(d.ext?.airtable ? { id: d.ext.airtable } : {}), fields: {
      deviceId: d.id, showId: r.showId, class: d.class, make: d.make, model: d.model, label: d.label, qty: d.qty,
      rackId: d.rackId ?? "", rack: d.rackId ? rackName.get(d.rackId) ?? "" : "", iCode: d.inventoryRef.iCode ?? "", barcode: d.inventoryRef.barcode ?? "",
    } })),
    Racks: r.racks.map((k) => ({ fields: {
      rackId: k.id, showId: r.showId, name: k.name, ruTotal: k.ruTotal, ruUsed: r.derived?.racks?.byRack?.[k.id]?.ruUsed ?? 0,
      caseModel: k.caseModel, location: k.location, inlet: k.power.inlet, powerW: r.derived?.racks?.byRack?.[k.id]?.powerW ?? 0,
    } })),
    Checks: r.binder.checks.filter((c) => !c.resolved).map((c) => ({ fields: {
      checkId: c.id, showId: r.showId, code: c.code, module: c.module, severity: c.severity, title: c.title, target: c.target, message: c.message,
    } })),
  };
}
