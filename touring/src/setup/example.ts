// The shipped example show and venue memory (Venue advance tab).
import fixture from "../fixtures/example-arena.json";
import { slug, type Workspace } from "../store/store";
import type { Patch, ShowRecord } from "../store/types";

export const EXAMPLE_SHOW_ID = (fixture as { showId: string }).showId;

/** Imports the example arena fixture (meta.source = example, stable id). Re-opening returns the existing copy. */
export function loadExample(ws: Workspace): ShowRecord {
  if (ws.has(EXAMPLE_SHOW_ID)) return ws.get(EXAMPLE_SHOW_ID);
  const raw = structuredClone(fixture) as unknown as ShowRecord;
  raw.meta = { ...raw.meta, source: "example" };
  return ws.importRecord(raw, { keepId: true });
}

/** Fields that commonly change per show are never carried from memory. */
const NEVER_CARRY = ["/event/access/credentials", "/event/access/docks"];

/**
 * "Load from venue memory": every remembered leaf comes back as `assumed` with source venue-memory and the
 * prior showCode in the note. Confirmed answers on this show are never overwritten. Returns the count written.
 */
export function loadVenueMemory(ws: Workspace, showId: string): number {
  const r = ws.get(showId);
  const mem = ws.venue(r.event.venueId) ??
    ws.venue(r.event.venueName ? slug(`${r.event.venueName}-${r.event.city}`) : null) ??
    ws.venueList().find((v) => v.venueName && v.venueName === r.event.venueName && v.city === r.event.city);
  if (!mem) return 0;
  const api = ws.api(showId, "shell");
  const ops: Patch[] = [];
  for (const [path, m] of Object.entries(mem.advance)) {
    if (NEVER_CARRY.some((p) => path === p || path.startsWith(p + "/"))) continue;
    const cur = api.get<{ state?: string } | undefined>(path);
    if (!cur || typeof cur !== "object" || cur.state === "confirmed") continue;
    ops.push({ op: "replace", path, value: { value: m.value, state: "assumed", source: "venue-memory", at: m.confirmedAt, note: `from venue memory · confirmed on ${m.showCode}` } });
  }
  if (!ops.length) return 0;
  const res = api.patch(ops, `advance: load venue memory (${mem.venueName})`);
  if (!res.ok) throw new Error(res.errors?.map((e) => `${e.code} ${e.msg}`).join("; "));
  return ops.length;
}
