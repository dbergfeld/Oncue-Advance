// IndexedDB `oncue.shows`: one record per show, revisions beside it, venue memory, autosave on every commit.
// Falls back to memory when IndexedDB is unavailable (private windows, previews, sandboxed frames).
import type { Persist, VenueMemory } from "./store";
import type { Revision, ShowRecord } from "./types";

const DB = "oncue.shows";
const VERSION = 1;

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("shows")) db.createObjectStore("shows", { keyPath: "showId" });
      if (!db.objectStoreNames.contains("revisions")) db.createObjectStore("revisions", { keyPath: "showId" });
      if (!db.objectStoreNames.contains("venues")) db.createObjectStore("venues", { keyPath: "venueId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function all<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, stores: string[], fn: (t: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, "readwrite");
    fn(t);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function indexedDbPersist(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<Persist> {
  if (!idb) return memoryPersist();
  let db: IDBDatabase;
  try { db = await open(idb); } catch { return memoryPersist(); }
  return {
    async loadAll() {
      const shows = await all<ShowRecord>(db, "shows");
      const revs = await all<{ showId: string; list: Revision[] }>(db, "revisions");
      const venues = await all<VenueMemory>(db, "venues");
      return { shows, revisions: Object.fromEntries(revs.map((r) => [r.showId, r.list])), venues: Object.fromEntries(venues.map((v) => [v.venueId, v])) };
    },
    saveShow: (r, list) => tx(db, ["shows", "revisions"], (t) => { t.objectStore("shows").put(r); t.objectStore("revisions").put({ showId: r.showId, list }); }),
    deleteShow: (id) => tx(db, ["shows", "revisions"], (t) => { t.objectStore("shows").delete(id); t.objectStore("revisions").delete(id); }),
    saveVenue: (v) => tx(db, ["venues"], (t) => { t.objectStore("venues").put(v); }),
  };
}

export function memoryPersist(): Persist & { ephemeral: true } {
  const shows = new Map<string, ShowRecord>();
  const revs = new Map<string, Revision[]>();
  const venues = new Map<string, VenueMemory>();
  return {
    ephemeral: true,
    async loadAll() { return { shows: [...shows.values()], revisions: Object.fromEntries(revs), venues: Object.fromEntries(venues) }; },
    async saveShow(r, list) { shows.set(r.showId, structuredClone(r)); revs.set(r.showId, list); },
    async deleteShow(id) { shows.delete(id); revs.delete(id); },
    async saveVenue(v) { venues.set(v.venueId, v); },
  };
}
