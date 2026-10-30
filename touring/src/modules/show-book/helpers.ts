// Show Book helpers: pure functions over a ShowRecord returning Patch[] for the `show` writer (operator ⚑ notes
// for `mobile`). Every pointer is id-addressed (`/show/setlists/<slId>/songs/<songId>/…`) so concurrent edits by
// the director and operators never land on the wrong song.
import { prefixOf } from "../../store/ids";
import type {
  CameraNote, CameraSlot, Cue, CueKind, CueStatus, Device, Flag, IdPrefix, Patch, RunEvent, RunId, SetChange, Setlist, ShowRecord, Song, SongTag,
} from "../../store/types";

export type NewId = (prefix: IdPrefix) => string;
type During = CameraNote["authored"]["during"];
type Unbound = ShowRecord["show"]["unbound"][number];

const TAGS: SongTag[] = ["opener", "ballad", "uptempo", "acoustic", "encore", "walk-on", "walk-off", "interstitial"];
const FLAG_KINDS: Flag["kind"][] = ["pyro", "strobe", "confetti", "crowd", "quick-change", "audience-lights", "custom"];
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- lookups

export function activeSetlist(r: ShowRecord): Setlist | null {
  const sb = r.show;
  if (!sb) return null;
  return sb.setlists.find((s) => s.id === sb.activeSetlistId) ?? null;
}

/** "CAM 2" < "CAM 10". */
export function labelCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function cameraLabel(r: ShowRecord, cameraId: string): string {
  const d = r.devices.find((x) => x.id === cameraId);
  if (d) return d.label || d.model || cameraId;
  return r.show?.unbound.find((n) => n.cameraId === cameraId)?.cameraLabel ?? cameraId;
}

/** Roster slots joined to their camera devices: active first, then label order. Slots whose device is gone are omitted. */
export function rosterCameras(r: ShowRecord): { slot: CameraSlot; device: Device }[] {
  const out: { slot: CameraSlot; device: Device }[] = [];
  for (const slot of r.show?.cameraRoster ?? []) {
    const device = r.devices.find((d) => d.id === slot.cameraId);
    if (device) out.push({ slot, device });
  }
  return out.sort((a, b) => Number(b.slot.active) - Number(a.slot.active) || labelCompare(a.device.label, b.device.label));
}

/** Locates a song in any setlist (song ids are unique across setlists). */
export function findSong(r: ShowRecord, songId: string): { setlist: Setlist; song: Song; base: string } | null {
  for (const setlist of r.show?.setlists ?? []) {
    const song = setlist.songs.find((s) => s.id === songId);
    if (song) return { setlist, song, base: `/show/setlists/${setlist.id}/songs/${song.id}` };
  }
  return null;
}

function mustSong(r: ShowRecord, songId: string) {
  const f = findSong(r, songId);
  if (!f) throw new Error(`no song ${songId}`);
  return f;
}

const orderedSongs = (sl: Setlist) => [...sl.songs].sort((a, b) => a.order - b.order);
const orderedCues = (s: Song) => [...s.cues].sort((a, b) => a.order - b.order);

function clean<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

/** m:ss */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "3:45" → 225, "225" → 225, "1:02:03" → 3723. */
export function parseDuration(v: string | undefined | null): number | undefined {
  const t = (v ?? "").trim();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ---------------------------------------------------------------- setlist import

export interface SetlistRow { title: string; durationSec?: number; bpm?: number; key?: string; tag?: SongTag }

export function inferTag(title: string): SongTag | undefined {
  const t = title.toLowerCase();
  if (/walk[\s-]?on/.test(t)) return "walk-on";
  if (/walk[\s-]?off/.test(t)) return "walk-off";
  if (/\bencore\b/.test(t)) return "encore";
  if (/\b(intro|interlude|interstitial|video package|vt)\b/.test(t)) return "interstitial";
  return undefined;
}

function csvSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Pasted setlist → rows. Accepts one title per line ("Title — 3:45", "Title - 3:45", "Title 3:45", "1. Title"),
 * or CSV / tab-separated with a header naming title, duration, bpm, key, tag. Tags are inferred from words
 * (walk-on, walk-off, encore, intro / interlude → interstitial) unless a tag column gives one.
 */
export function parseSetlistText(text: string): SetlistRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return [];
  const head = csvSplit(lines[0]).map((h) => h.toLowerCase());
  if ((lines[0].includes(",") || lines[0].includes("\t")) && head.includes("title")) {
    const col = (name: string) => head.indexOf(name);
    const ti = col("title"), di = col("duration"), bi = col("bpm"), ki = col("key"), gi = col("tag");
    return lines.slice(1).map((l) => {
      const c = csvSplit(l);
      const title = c[ti] ?? "";
      const tagRaw = (gi >= 0 ? c[gi] : "")?.toLowerCase().trim() as SongTag;
      const bpm = bi >= 0 && c[bi] ? Number(c[bi]) : undefined;
      return clean({
        title, durationSec: di >= 0 ? parseDuration(c[di]) : undefined, bpm: bpm && Number.isFinite(bpm) ? bpm : undefined,
        key: ki >= 0 && c[ki] ? c[ki] : undefined, tag: TAGS.includes(tagRaw) ? tagRaw : inferTag(title),
      });
    }).filter((r) => r.title);
  }
  return lines.map((l) => {
    let t = l.replace(/^\d+\s*[.)]\s+/, "");
    let durationSec: number | undefined;
    const m = t.match(/^(.*?)\s*(?:[—–-]\s*)?\(?((?:\d+:)?\d{1,2}:\d{2})\)?\s*$/);
    if (m && m[1].trim()) { t = m[1]; durationSec = parseDuration(m[2]); }
    const title = t.replace(/\s*[—–-]\s*$/, "").trim();
    return clean({ title, durationSec, tag: inferTag(title) });
  }).filter((r) => r.title);
}

function newSong(id: string, order: number, title: string, extra: Partial<Song> = {}): Song {
  return clean({ id, order, title, cues: [], cameraNotes: [], flags: [], ...extra });
}

function emptySetlist(r: ShowRecord, id: string, source: Setlist["source"] = "manual"): Setlist {
  const date = r.event.dates[0];
  return { id, name: date ? `Set · ${date}` : `Set ${(r.show?.setlists.length ?? 0) + 1}`, version: 1, source, songs: [], setChanges: [] };
}

/** The active setlist, creating (and activating) an empty one when there is none. */
function ensureSetlist(r: ShowRecord, newId: NewId, source: Setlist["source"] = "manual"): { sl: Setlist; ops: Patch[] } {
  const cur = activeSetlist(r);
  if (cur) return { sl: cur, ops: [] };
  const sl = emptySetlist(r, newId("sl"), source);
  return { sl, ops: [{ op: "add", path: "/show/setlists/-", value: sl }, { op: "replace", path: "/show/activeSetlistId", value: sl.id }] };
}

// ---------------------------------------------------------------- re-binding across shows

/** Maps another show's device / server ids onto this record by label; unmatched cameras are reported. */
class Rebinder {
  private devByLabel = new Map<string, string>();
  private srvByLabel = new Map<string, string>();
  constructor(private src: ShowRecord, private dest: ShowRecord) {
    for (const d of dest.devices) this.devByLabel.set(d.label.trim().toLowerCase(), d.id);
    for (const h of dest.servers.hosts) {
      const d = dest.devices.find((x) => x.id === h.deviceId);
      if (d) this.srvByLabel.set(d.label.trim().toLowerCase(), h.id);
    }
  }
  srcLabel(id: string): string { return this.src.devices.find((d) => d.id === id)?.label ?? id; }
  device(id: string | undefined): string | undefined {
    if (!id) return undefined;
    if (this.dest.devices.some((d) => d.id === id)) return id;
    const d = this.src.devices.find((x) => x.id === id);
    return d ? this.devByLabel.get(d.label.trim().toLowerCase()) : undefined;
  }
  server(id: string | undefined): string | undefined {
    if (!id) return undefined;
    if (this.dest.servers.hosts.some((h) => h.id === id)) return id;
    const h = this.src.servers.hosts.find((x) => x.id === id);
    const d = h && this.src.devices.find((x) => x.id === h.deviceId);
    return d ? this.srvByLabel.get(d.label.trim().toLowerCase()) : undefined;
  }
  wall(id: string): string | undefined {
    if (this.dest.led.walls.some((w) => w.id === id)) return id;
    const w = this.src.led.walls.find((x) => x.id === id);
    return w ? this.dest.led.walls.find((x) => x.name.trim().toLowerCase() === w.name.trim().toLowerCase())?.id : undefined;
  }
  /** Any entity reference: a device rebinds by label; free text (no id prefix) is kept as written. */
  ref(v: string | undefined): string | undefined {
    if (!v) return undefined;
    if (!prefixOf(v)) return v;
    return this.device(v) ?? this.server(v);
  }
}

/** Copies a song's content (notes, cues, look, walls, flags) from another show, re-binding ids by label. */
function carrySong(rb: Rebinder, src: Song, id: string, order: number, title: string, newId: NewId, extra: Partial<Song>): { song: Song; unbound: Unbound[] } {
  const unbound: Unbound[] = [];
  const cameraNotes: CameraNote[] = [];
  for (const n of src.cameraNotes) {
    const { previous: _p, ...rest } = n;
    const note: CameraNote = { ...rest, id: newId("note") };
    const cam = rb.device(n.cameraId);
    if (cam) cameraNotes.push({ ...note, cameraId: cam });
    else unbound.push({ ...note, songTitle: title, cameraLabel: rb.srcLabel(n.cameraId) });
  }
  const cues: Cue[] = src.cues.map((c) => {
    const target = rb.ref(c.target);
    const ref = c.action ? rb.ref(c.action.ref) : undefined;
    return clean({ ...c, id: newId("cue"), status: null, target, action: c.action && ref ? { type: c.action.type, ref } : undefined });
  });
  const serverId = rb.server(src.lookRef?.serverId);
  const wallState = (src.wallState ?? []).map((w) => ({ ...w, wallId: rb.wall(w.wallId) })).filter((w): w is { wallId: string; note: string } => !!w.wallId);
  const song = newSong(id, order, title, clean({
    durationSec: src.durationSec, bpm: src.bpm, key: src.key, tag: src.tag, directorNote: src.directorNote,
    lookRef: src.lookRef && serverId ? { serverId, lookName: src.lookRef.lookName } : undefined,
    wallState: wallState.length ? wallState : undefined, flags: structuredClone(src.flags), cues, cameraNotes, ...extra,
  }));
  return { song, unbound };
}

/**
 * Fills the active setlist (created when there is none) with imported rows, appended after any existing songs.
 * Titles are matched case-insensitively against `previous` shows' setlists (first match wins, so pass the most
 * recent show first): a match copies that song's notes and cues, re-binding cameras by label (unmatched cameras →
 * show.unbound). With previous shows to match against, unmatched titles are flagged `isNew`.
 */
export function importSetlist(r: ShowRecord, rows: SetlistRow[], newId: NewId, opts: { source?: "manual" | "import" | "copy"; previous?: ShowRecord[] } = {}): Patch[] {
  const source = opts.source ?? "import";
  const { sl, ops } = ensureSetlist(r, newId, source);
  const base = `/show/setlists/${sl.id}`;
  if (sl.source !== source && ops.length === 0) ops.push({ op: "replace", path: `${base}/source`, value: source });
  const prev = (opts.previous ?? []).filter((p) => p.showId !== r.showId);
  const catalogue: { show: ShowRecord; song: Song }[] = [];
  for (const show of prev) {
    const lists = [...(show.show?.setlists ?? [])].sort((a, b) => Number(b.id === show.show.activeSetlistId) - Number(a.id === show.show.activeSetlistId));
    for (const l of lists) for (const song of l.songs) catalogue.push({ show, song });
  }
  let order = Math.max(0, ...sl.songs.map((s) => s.order));
  for (const row of rows) {
    const title = row.title.trim();
    if (!title) continue;
    order += 1;
    const id = newId("song");
    const extra = clean({ durationSec: row.durationSec, bpm: row.bpm, key: row.key, tag: row.tag });
    const hit = catalogue.find((c) => c.song.title.trim().toLowerCase() === title.toLowerCase());
    if (hit) {
      const { song, unbound } = carrySong(new Rebinder(hit.show, r), hit.song, id, order, title, newId, extra);
      ops.push({ op: "add", path: `${base}/songs/-`, value: song });
      for (const u of unbound) ops.push({ op: "add", path: "/show/unbound/-", value: u });
    } else {
      ops.push({ op: "add", path: `${base}/songs/-`, value: newSong(id, order, title, { ...extra, ...(catalogue.length ? { isNew: true } : {}) }) });
    }
  }
  return ops;
}

/**
 * "Copy from show": `src`'s active setlist with notes and cues into `dest`, re-binding cameraId by camera label
 * (CAM 3 → CAM 3), servers by device label and walls by name. Notes on cameras `dest` lacks go to show.unbound
 * (SHW-001). runLog is not copied; statuses, skips and show-time `previous` text are cleared. The copy replaces
 * `dest`'s active setlist when that is empty, otherwise it is added as a new setlist and made active.
 */
export function copySetlistFrom(src: ShowRecord, dest: ShowRecord, newId: NewId): Patch[] {
  const from = activeSetlist(src) ?? src.show?.setlists[0];
  if (!from) return [];
  const rb = new Rebinder(src, dest);
  const ids = new Map<string, string>();
  const unbound: Unbound[] = [];
  const songs = orderedSongs(from).map((s, i) => {
    const id = newId("song");
    ids.set(s.id, id);
    const { song, unbound: u } = carrySong(rb, s, id, i + 1, s.title, newId, {});
    unbound.push(...u);
    return song;
  });
  const setChanges: SetChange[] = from.setChanges.filter((c) => ids.has(c.afterSongId)).map((c) => ({
    ...c, afterSongId: ids.get(c.afterSongId)!,
    cameraMoves: c.cameraMoves.map((m) => ({ ...m, cameraId: rb.device(m.cameraId) ?? "" })).filter((m) => m.cameraId),
  }));
  const sl: Setlist = { id: newId("sl"), name: from.name, version: 1, source: "copy", songs, setChanges };
  const ops: Patch[] = [];
  const cur = activeSetlist(dest);
  if (cur && cur.songs.length === 0) ops.push({ op: "remove", path: `/show/setlists/${cur.id}` });
  ops.push({ op: "add", path: "/show/setlists/-", value: sl }, { op: "replace", path: "/show/activeSetlistId", value: sl.id });
  for (const u of unbound) ops.push({ op: "add", path: "/show/unbound/-", value: u });
  return ops;
}

// ---------------------------------------------------------------- songs

/** Inserts a song after `afterSongId` (null appends at the end) and shifts the rest; creates the setlist if needed. */
export function addSong(r: ShowRecord, title: string, afterSongId: string | null, newId: NewId): Patch[] {
  const { sl, ops } = ensureSetlist(r, newId);
  const songs = orderedSongs(sl);
  const at = afterSongId ? songs.findIndex((s) => s.id === afterSongId) + 1 || songs.length : songs.length;
  const base = `/show/setlists/${sl.id}/songs`;
  songs.slice(at).forEach((s, i) => { if (s.order !== at + i + 2) ops.push({ op: "replace", path: `${base}/${s.id}/order`, value: at + i + 2 }); });
  const song = newSong(newId("song"), at + 1, title.trim() || "New song", inferTag(title) ? { tag: inferTag(title) } : {});
  const idx = afterSongId ? sl.songs.findIndex((s) => s.id === afterSongId) + 1 || sl.songs.length : sl.songs.length;
  ops.push({ op: "add", path: `${base}/${idx}`, value: song });
  return ops;
}

export function updateSong(r: ShowRecord, songId: string, patch: Partial<Song>): Patch[] {
  const { song, base } = mustSong(r, songId);
  const ops: Patch[] = [];
  for (const [k, v] of Object.entries(patch) as [keyof Song, unknown][]) {
    if (k === "id" || k === "order") continue;
    if (v === undefined) { if (k in song) ops.push({ op: "remove", path: `${base}/${k}` }); }
    else if (JSON.stringify(song[k]) !== JSON.stringify(v)) ops.push({ op: k in song ? "replace" : "add", path: `${base}/${k}`, value: v });
  }
  return ops;
}

export function removeSong(r: ShowRecord, songId: string): Patch[] {
  const { setlist, base } = mustSong(r, songId);
  const ops: Patch[] = [];
  setlist.setChanges.map((c, i) => [c, i] as const).filter(([c]) => c.afterSongId === songId).reverse()
    .forEach(([, i]) => ops.push({ op: "remove", path: `/show/setlists/${setlist.id}/setChanges/${i}` }));
  ops.push({ op: "remove", path: base });
  orderedSongs(setlist).filter((s) => s.id !== songId).forEach((s, i) => {
    if (s.order !== i + 1) ops.push({ op: "replace", path: `/show/setlists/${setlist.id}/songs/${s.id}/order`, value: i + 1 });
  });
  return ops;
}

/** Swaps a song with its neighbour; `order` stays contiguous 1..n and the array follows it. */
export function moveSong(r: ShowRecord, songId: string, delta: -1 | 1): Patch[] {
  const { setlist } = mustSong(r, songId);
  const songs = orderedSongs(setlist);
  const i = songs.findIndex((s) => s.id === songId);
  const j = i + delta;
  if (j < 0 || j >= songs.length) return [];
  const next = [...songs];
  [next[i], next[j]] = [next[j], next[i]];
  const base = `/show/setlists/${setlist.id}/songs`;
  const ops: Patch[] = [{ op: "move", from: `${base}/${songId}`, path: `${base}/${j}` }];
  next.forEach((s, k) => { if (s.order !== k + 1) ops.push({ op: "replace", path: `${base}/${s.id}/order`, value: k + 1 }); });
  return ops;
}

// ---------------------------------------------------------------- roster

/** Adds camera devices missing from the roster (label order; the first camera of an empty roster goes to the camera lead) and marks slots whose camera is gone inactive. */
export function syncRoster(r: ShowRecord): Patch[] {
  const roster = r.show?.cameraRoster ?? [];
  const cams = r.devices.filter((d) => d.class === "camera").sort((a, b) => labelCompare(a.label, b.label));
  const camIds = new Set(cams.map((d) => d.id));
  const ops: Patch[] = [];
  roster.forEach((s, i) => { if (!camIds.has(s.cameraId) && s.active) ops.push({ op: "replace", path: `/show/cameraRoster/${i}/active`, value: false }); });
  let first = roster.length === 0;
  for (const d of cams) {
    if (roster.some((s) => s.cameraId === d.id)) continue;
    ops.push({ op: "add", path: "/show/cameraRoster/-", value: { cameraId: d.id, operator: first ? "cameraLead" : "", position: "", comms: "", active: true } satisfies CameraSlot });
    first = false;
  }
  return ops;
}

export function setRosterSlot(r: ShowRecord, cameraId: string, patch: Partial<CameraSlot>): Patch[] {
  const roster = r.show?.cameraRoster ?? [];
  const i = roster.findIndex((s) => s.cameraId === cameraId);
  if (i < 0) return [{ op: "add", path: "/show/cameraRoster/-", value: { cameraId, operator: "", position: "", comms: "", active: true, ...patch } }];
  return [{ op: "replace", path: `/show/cameraRoster/${i}`, value: { ...roster[i], ...patch, cameraId: patch.cameraId ?? roster[i].cameraId } }];
}

// ---------------------------------------------------------------- camera notes

/**
 * Adds or amends a camera's note for a song. The camera's existing note of the same priority (default primary,
 * pending ⚑ notes excluded) is amended; otherwise a note is added. At show time (show locked, or during = show)
 * the old shot is kept in `previous` so a mid-set change is never a silent swap.
 */
export function setNote(r: ShowRecord, songId: string, cameraId: string, fields: Partial<CameraNote> & { shot: string }, by: string, during: During, newId: NewId, at: string = now()): Patch[] {
  const { song, base } = mustSong(r, songId);
  const priority = fields.priority ?? "primary";
  const showTime = during === "show" || r.meta.status === "locked";
  const existing = song.cameraNotes.find((n) => n.cameraId === cameraId && n.priority === priority && !n.pending);
  const authored = { by, at, during };
  if (existing) {
    const { previous: _p, ...old } = existing;
    const next: CameraNote = clean({ ...old, ...fields, id: existing.id, cameraId, priority, authored,
      previous: showTime && existing.shot !== fields.shot ? existing.shot : undefined });
    return [{ op: "replace", path: `${base}/cameraNotes/${existing.id}`, value: next }];
  }
  const note: CameraNote = clean({ ...fields, id: newId("note"), cameraId, priority, authored, pending: undefined, previous: undefined });
  return [{ op: "add", path: `${base}/cameraNotes/-`, value: note }];
}

export function removeNote(r: ShowRecord, songId: string, noteId: string): Patch[] {
  const { base } = mustSong(r, songId);
  return [{ op: "remove", path: `${base}/cameraNotes/${noteId}` }];
}

/** The director accepts an operator's ⚑ note: it stays a cover note, no longer pending. */
export function acceptOperatorNote(r: ShowRecord, songId: string, noteId: string): Patch[] {
  const { song, base } = mustSong(r, songId);
  const n = song.cameraNotes.find((x) => x.id === noteId);
  if (!n || !n.pending) return [];
  const { pending: _p, ...rest } = n;
  return [{ op: "replace", path: `${base}/cameraNotes/${noteId}`, value: rest }];
}

/** Operator ⚑ note — apply as the `mobile` writer: a pending cover note authored by the operator. */
export function operatorFlagNote(r: ShowRecord, songId: string, cameraId: string, text: string, operator: string, newId: NewId, at: string = now()): Patch[] {
  const { base } = mustSong(r, songId);
  const note: CameraNote = {
    id: newId("note"), cameraId, shot: text.trim(), priority: "cover", pending: true,
    authored: { by: operator, at, during: r.meta.status === "locked" ? "show" : "rehearsal" },
  };
  return [{ op: "add", path: `${base}/cameraNotes/-`, value: note }];
}

/** Fills one camera's primary shot across every song carrying `tag` ("all ballads: CAM 2 tight on vocal"). */
export function fillColumn(r: ShowRecord, cameraId: string, tag: SongTag, shot: string, by: string, newId: NewId): Patch[] {
  const sl = activeSetlist(r);
  if (!sl) return [];
  return orderedSongs(sl).filter((s) => s.tag === tag).flatMap((s) => setNote(r, s.id, cameraId, { shot, priority: "primary" }, by, "build", newId));
}

/** Copies every (non-pending) note on one song to another, amending same camera + priority notes there. */
export function copySongNotes(r: ShowRecord, fromSongId: string, toSongId: string, by: string, newId: NewId): Patch[] {
  const { song } = mustSong(r, fromSongId);
  mustSong(r, toSongId);
  const during: During = r.meta.status === "locked" ? "show" : "build";
  return song.cameraNotes.filter((n) => !n.pending).flatMap((n) => {
    const { id: _id, authored: _a, previous: _p, pending: _q, cameraId, ...fields } = n;
    return setNote(r, toSongId, cameraId, fields, by, during, newId);
  });
}

// ---------------------------------------------------------------- cues, flags, set changes

/** Kind from the words of a call: "server", "record", "black" … editable afterwards. */
export function inferCueKind(call: string): CueKind {
  const t = call.toLowerCase();
  if (/\b(rec|record|recording|roll tape|hyperdeck)\b/.test(t)) return "record";
  if (/\b(server|look|content|media|clip|playback|d3|disguise)\b/.test(t)) return "server";
  if (/\b(black|blackout|wall|imag|led|screens?)\b/.test(t)) return "wall";
  if (/\b(pyro|safety|hazard|stay off|clear the|co2|flame)\b/.test(t)) return "safety";
  if (/\b(lx|lights?|lighting|strobe|timecode|tc|sync)\b/.test(t)) return "lighting-sync";
  if (/\b(cam|camera|wide|tight|close|cu|ws|ms|push|pull|pan|track|handheld|shot|cut to|dissolve|take)\b/.test(t)) return "camera";
  return "other";
}

function recordAction(r: ShowRecord, call: string, target?: string): Cue["action"] | undefined {
  const t = call.toLowerCase();
  const rec = target ?? r.devices.filter((d) => d.class === "recorder").sort((a, b) => labelCompare(a.label, b.label))[0]?.id;
  if (!rec) return undefined;
  if (/\b(stop|end|cut record)\b/.test(t)) return { type: "record-stop", ref: rec };
  if (/\b(start|roll|rolling|go)\b/.test(t) || /\brecord\b/.test(t)) return { type: "record-start", ref: rec };
  return undefined;
}

export function addCue(r: ShowRecord, songId: string, c: { at: string; call: string; kind?: CueKind; target?: string; action?: Cue["action"] }, newId: NewId): Patch[] {
  const { song, base } = mustSong(r, songId);
  const kind = c.kind ?? inferCueKind(c.call);
  const action = c.action ?? (kind === "record" ? recordAction(r, c.call, c.target) : undefined);
  const cue: Cue = clean({ id: newId("cue"), order: Math.max(0, ...song.cues.map((x) => x.order)) + 1, at: c.at, call: c.call, kind, target: c.target ?? action?.ref, action, status: null });
  return [{ op: "add", path: `${base}/cues/-`, value: cue }];
}

export function updateCue(r: ShowRecord, songId: string, cueId: string, patch: Partial<Cue>): Patch[] {
  const { song, base } = mustSong(r, songId);
  const cue = song.cues.find((c) => c.id === cueId);
  if (!cue) return [];
  return [{ op: "replace", path: `${base}/cues/${cueId}`, value: clean({ ...cue, ...patch, id: cue.id }) }];
}

export function removeCue(r: ShowRecord, songId: string, cueId: string): Patch[] {
  const { song, base } = mustSong(r, songId);
  const ops: Patch[] = [{ op: "remove", path: `${base}/cues/${cueId}` }];
  orderedCues(song).filter((c) => c.id !== cueId).forEach((c, i) => { if (c.order !== i + 1) ops.push({ op: "replace", path: `${base}/cues/${c.id}/order`, value: i + 1 }); });
  return ops;
}

export function addFlag(r: ShowRecord, songId: string, flag: Flag): Patch[] {
  const { base } = mustSong(r, songId);
  return [{ op: "add", path: `${base}/flags/-`, value: clean({ ...flag }) }];
}

export function setSetChange(r: ShowRecord, afterSongId: string, patch: Partial<SetChange>): Patch[] {
  const { setlist } = mustSong(r, afterSongId);
  const i = setlist.setChanges.findIndex((c) => c.afterSongId === afterSongId);
  const base = `/show/setlists/${setlist.id}/setChanges`;
  if (i < 0) return [{ op: "add", path: `${base}/-`, value: { afterSongId, durationSec: 0, notes: "", cameraMoves: [], ...patch } satisfies SetChange }];
  return [{ op: "replace", path: `${base}/${i}`, value: { ...setlist.setChanges[i], ...patch, afterSongId } }];
}

/** Save marks setlist.version + 1. */
export function saveVersion(r: ShowRecord): Patch[] {
  const sl = activeSetlist(r);
  return sl ? [{ op: "replace", path: `/show/setlists/${sl.id}/version`, value: sl.version + 1 }] : [];
}

// ---------------------------------------------------------------- run controls

const secs = (from: string, to: string) => Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);

export interface RunState { songId: string | null; startedAt: string | null; held: boolean; nextCueId: string | null; elapsedSec(now: string): number }

/** Where a run is: the song started and not yet ended, whether the clock is held, and the next un-statused cue. */
export function runState(r: ShowRecord, run: RunId): RunState {
  let songId: string | null = null, startedAt: string | null = null, heldSince: string | null = null, heldSec = 0;
  for (const e of r.show?.runLog ?? []) {
    if (e.run !== run) continue;
    if (e.event === "start") { songId = e.songId; startedAt = e.at; heldSince = null; heldSec = 0; }
    else if (e.event === "end" && e.songId === songId) { songId = null; startedAt = null; heldSince = null; heldSec = 0; }
    else if (e.event === "hold" && songId && !heldSince) heldSince = e.at;
    else if (e.event === "resume" && heldSince) { heldSec += secs(heldSince, e.at); heldSince = null; }
  }
  const song = songId ? findSong(r, songId)?.song : undefined;
  const nextCueId = song ? orderedCues(song).find((c) => !c.status)?.id ?? null : null;
  const s0 = startedAt, h0 = heldSince, hs = heldSec;
  return {
    songId, startedAt, held: !!heldSince, nextCueId,
    elapsedSec: (t: string) => (s0 ? Math.max(0, secs(s0, h0 ?? t) - hs) : 0),
  };
}

const log = (e: RunEvent): Patch => ({ op: "add", path: "/show/runLog/-", value: clean(e) });
const runDuring = (run: RunId): During => (run === "show" ? "show" : "rehearsal");

function endCurrent(r: ShowRecord, run: RunId, by: string, at: string): Patch[] {
  const st = runState(r, run);
  if (!st.songId) return [];
  const ops: Patch[] = [];
  if (st.held) ops.push(log({ at, run, songId: st.songId, event: "resume", by, during: runDuring(run) }));
  ops.push(log({ at, run, songId: st.songId, event: "end", by, during: runDuring(run) }));
  return ops;
}

/** Starts a song (ending whatever is running). */
export function startSong(r: ShowRecord, run: RunId, songId: string, by: string, at: string): Patch[] {
  const st = runState(r, run);
  if (st.songId === songId) return [];
  return [...endCurrent(r, run, by, at), log({ at, run, songId, event: "start", by, during: runDuring(run) })];
}

function neighbour(r: ShowRecord, run: RunId, dir: 1 | -1): { songs: Song[]; cur: string | null; target: Song | undefined } {
  const sl = activeSetlist(r);
  const songs = sl ? orderedSongs(sl) : [];
  const cur = runState(r, run).songId;
  const i = cur ? songs.findIndex((s) => s.id === cur) : -1;
  let target: Song | undefined;
  if (i < 0) target = dir === 1 ? songs.find((s) => !s.skipped) : undefined;
  else for (let k = i + dir; k >= 0 && k < songs.length; k += dir) if (!songs[k].skipped) { target = songs[k]; break; }
  return { songs, cur, target };
}

/** Ends the current song and starts the next non-skipped one (the first, when nothing is running). */
export function nextSong(r: ShowRecord, run: RunId, by: string, at: string): Patch[] {
  const { target } = neighbour(r, run, 1);
  const ops = endCurrent(r, run, by, at);
  if (target) ops.push(log({ at, run, songId: target.id, event: "start", by, during: runDuring(run) }));
  return ops;
}

/** Ends the current song and restarts the previous non-skipped one. */
export function prevSong(r: ShowRecord, run: RunId, by: string, at: string): Patch[] {
  const { target, cur } = neighbour(r, run, -1);
  if (!cur || !target) return [];
  return [...endCurrent(r, run, by, at), log({ at, run, songId: target.id, event: "start", by, during: runDuring(run) })];
}

/** Cue hit / missed / cut for this run: mirrored on the cue, logged in runLog. `null` clears the mirror only. */
export function setCueStatus(r: ShowRecord, run: RunId, songId: string, cueId: string, status: CueStatus | null, by: string, at: string): Patch[] {
  const { base } = mustSong(r, songId);
  const ops: Patch[] = [{ op: "replace", path: `${base}/cues/${cueId}/status`, value: status }];
  if (status) ops.push(log({ at, run, songId, event: "cue", cueId, status, by, during: runDuring(run) }));
  return ops;
}

/** Management cut it: marks the song skipped and logs the skip; next / back pass over it. */
export function skipSong(r: ShowRecord, run: RunId, songId: string, by: string, at: string): Patch[] {
  const { song, base } = mustSong(r, songId);
  const ops: Patch[] = [];
  if (runState(r, run).songId === songId) ops.push(...endCurrent(r, run, by, at));
  ops.push({ op: song.skipped === undefined ? "add" : "replace", path: `${base}/skipped`, value: true });
  ops.push(log({ at, run, songId, event: "skip", by, during: runDuring(run) }));
  return ops;
}

/** Hold pauses the song clock without losing position; again resumes. */
export function holdToggle(r: ShowRecord, run: RunId, by: string, at: string): Patch[] {
  const st = runState(r, run);
  if (!st.songId) return [];
  return [log({ at, run, songId: st.songId, event: st.held ? "resume" : "hold", by, during: runDuring(run) })];
}

/** Quick cue at the current moment: `at` = elapsed m:ss when the song is running. */
export function quickCue(r: ShowRecord, run: RunId, songId: string, call: string, by: string, at: string, newId: NewId): Patch[] {
  const st = runState(r, run);
  const when = st.songId === songId ? mmss(st.elapsedSec(at)) : "—";
  const ops = addCue(r, songId, { at: when, call }, newId);
  const cue = (ops[0] as { value: Cue }).value;
  ops.push(log({ at, run, songId, event: "note", cueId: cue.id, by, note: `quick cue: ${call}`, during: runDuring(run) }));
  return ops;
}

/** Flag at the elapsed time with a one-word kind (unknown words become a custom flag). */
export function quickFlag(r: ShowRecord, run: RunId, songId: string, kind: string, by: string, at: string): Patch[] {
  const st = runState(r, run);
  const word = kind.trim().toLowerCase();
  const k = (FLAG_KINDS as string[]).includes(word) ? (word as Flag["kind"]) : "custom";
  const when = st.songId === songId ? mmss(st.elapsedSec(at)) : undefined;
  return [
    ...addFlag(r, songId, clean({ kind: k, at: when, note: k === "custom" ? kind.trim() : "" })),
    log({ at, run, songId, event: "note", by, note: `flag: ${kind.trim()}`, during: runDuring(run) }),
  ];
}

/**
 * Measured song durations from runLog start/end pairs (hold time subtracted), per run then per song.
 * Returns { run → { songId → { sec, endedAt } } }.
 */
export function measuredByRun(r: ShowRecord): Map<RunId, Map<string, { sec: number; endedAt: string }>> {
  const out = new Map<RunId, Map<string, { sec: number; endedAt: string }>>();
  const open = new Map<RunId, { songId: string; at: string; heldSince: string | null; held: number }>();
  for (const e of r.show?.runLog ?? []) {
    const o = open.get(e.run);
    if (e.event === "start") open.set(e.run, { songId: e.songId, at: e.at, heldSince: null, held: 0 });
    else if (!o || o.songId !== e.songId) continue;
    else if (e.event === "hold" && !o.heldSince) o.heldSince = e.at;
    else if (e.event === "resume" && o.heldSince) { o.held += secs(o.heldSince, e.at); o.heldSince = null; }
    else if (e.event === "end") {
      const held = o.held + (o.heldSince ? secs(o.heldSince, e.at) : 0);
      const m = out.get(e.run) ?? new Map();
      m.set(e.songId, { sec: Math.round(Math.max(0, secs(o.at, e.at) - held)), endedAt: e.at });
      out.set(e.run, m);
      open.delete(e.run);
    }
  }
  return out;
}

/** The run whose latest start/end pair ended last (the one "latest run that has any"). */
export function latestRun(r: ShowRecord): RunId | null {
  let best: { run: RunId; at: string } | null = null;
  for (const [run, m] of measuredByRun(r)) for (const v of m.values()) if (!best || v.endedAt > best.at) best = { run, at: v.endedAt };
  return best?.run ?? null;
}

/** Song ids with no primary note on any active roster camera. */
export function songsWithoutPrimary(r: ShowRecord, sl: Setlist | null = activeSetlist(r)): string[] {
  if (!sl) return [];
  const active = new Set((r.show?.cameraRoster ?? []).filter((s) => s.active).map((s) => s.cameraId));
  return orderedSongs(sl).filter((s) => !s.cameraNotes.some((n) => n.priority === "primary" && active.has(n.cameraId))).map((s) => s.id);
}

export interface RehearsalReview {
  missed: { songId: string; cueId: string }[];
  cut: { songId: string; cueId: string }[];
  songsWithoutPrimary: string[];
  inactiveCameraNotes: { songId: string; noteId: string }[];
  durations: { songId: string; typed?: number; measured?: number }[];
}

/** After a run: cues missed / cut (last status per cue in this run's log), songs with no primary, notes on inactive cameras, measured vs typed. */
export function rehearsalReview(r: ShowRecord, run: RunId): RehearsalReview {
  const sl = activeSetlist(r);
  const songs = sl ? orderedSongs(sl) : [];
  const last = new Map<string, { songId: string; status: CueStatus }>();
  for (const e of r.show?.runLog ?? []) if (e.run === run && e.event === "cue" && e.cueId && e.status) last.set(e.cueId, { songId: e.songId, status: e.status });
  const missed: RehearsalReview["missed"] = [], cut: RehearsalReview["cut"] = [];
  for (const s of songs) for (const c of orderedCues(s)) {
    const st = last.get(c.id)?.status;
    if (st === "missed") missed.push({ songId: s.id, cueId: c.id });
    if (st === "cut") cut.push({ songId: s.id, cueId: c.id });
  }
  const inactive = new Set((r.show?.cameraRoster ?? []).filter((s) => !s.active).map((s) => s.cameraId));
  const measured = measuredByRun(r).get(run) ?? new Map();
  return {
    missed, cut,
    songsWithoutPrimary: songsWithoutPrimary(r, sl),
    inactiveCameraNotes: songs.flatMap((s) => s.cameraNotes.filter((n) => inactive.has(n.cameraId)).map((n) => ({ songId: s.id, noteId: n.id }))),
    durations: songs.map((s) => clean({ songId: s.id, typed: s.durationSec, measured: measured.get(s.id)?.sec })),
  };
}

/** Accepting the review bumps the version and clears per-run statuses and skips; runLog keeps the history. */
export function acceptReview(r: ShowRecord): Patch[] {
  const sl = activeSetlist(r);
  if (!sl) return [];
  const ops = saveVersion(r);
  for (const s of sl.songs) {
    const base = `/show/setlists/${sl.id}/songs/${s.id}`;
    for (const c of s.cues) if (c.status) ops.push({ op: "replace", path: `${base}/cues/${c.id}/status`, value: null });
    if (s.skipped) ops.push({ op: "replace", path: `${base}/skipped`, value: false });
  }
  return ops;
}

/** "Unfreeze setlist" while locked: structural edits allowed until refrozen; logged with its reason. */
export function unfreezeSetlist(_r: ShowRecord, by: string, reason: string, at: string): Patch[] {
  if (!reason.trim()) throw new Error("Unfreeze setlist requires a reason");
  return [{ op: "replace", path: "/show/unfrozen", value: { by, at, reason: reason.trim() } }];
}

export function refreezeSetlist(_r: ShowRecord): Patch[] {
  return [{ op: "replace", path: "/show/unfrozen", value: null }];
}
