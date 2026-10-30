import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/setlist-arena.json";
import { engine } from "../../../engine";
import { applyProfile, newShowFromWizard } from "../../../setup/wizard";
import { normalize } from "../../../store/blank";
import { newId } from "../../../store/ids";
import { Workspace } from "../../../store/store";
import type { Patch, ShowRecord } from "../../../store/types";
import {
  acceptReview, activeSetlist, addCue, addSong, copySetlistFrom, holdToggle, importSetlist, moveSong, nextSong, operatorFlagNote,
  parseSetlistText, quickCue, rehearsalReview, refreezeSetlist, rosterCameras, runState, setCueStatus, setNote, setRosterSlot, skipSong,
  startSong, unfreezeSetlist, updateCue, updateSong,
} from "../helpers";
import { showModule, validateShow } from "../index";

const SL = "sl_arena1";
const song = (r: ShowRecord, id: string) => activeSetlist(r)!.songs.find((s) => s.id === id)!;
const open = (r: ShowRecord, code: string) => r.binder.checks.filter((c) => c.code === code && !c.resolved);
const t = (sec: number) => new Date(Date.UTC(2026, 10, 14, 20, 0, 0) + sec * 1000).toISOString();

function setup(mutate?: (json: typeof fixture) => void) {
  let clock = 0;
  const ws = new Workspace(engine, null, () => t(clock++));
  const json = structuredClone(fixture);
  mutate?.(json);
  const r = ws.importRecord(json, { keepId: true });
  const id = r.showId;
  const apply = (ops: Patch[], by: "show" | "mobile" | "signal" = "show", cascade = false) => ws.patch(id, by, ops, "test", cascade ? { cascade: true } : {});
  const ok = (ops: Patch[], by: "show" | "mobile" | "signal" = "show", cascade = false) => {
    const res = apply(ops, by, cascade);
    expect(res.errors ?? []).toEqual([]);
    return ws.get(id);
  };
  return { ws, id, get: () => ws.get(id), apply, ok };
}

/** A second show of the same tour whose camera ids differ (dev_cam → dev_kam) and which has no CAM 5 / CAM 6. */
function destRecord(): ShowRecord {
  const json = JSON.parse(JSON.stringify(fixture).replace(/dev_cam/g, "dev_kam").replace(/p_cam/g, "p_kam")) as typeof fixture;
  json.showId = "dest-show";
  json.showCode = "SA-2026-002";
  json.devices = json.devices.filter((d) => d.label !== "CAM 5" && d.label !== "CAM 6");
  (json as unknown as ShowRecord).show = { setlists: [], activeSetlistId: null, cameraRoster: [], runLog: [], unbound: [], unfrozen: null };
  return normalize(json as unknown as ShowRecord);
}

/** The dest show as the wizard leaves it: roster synced from its cameras (CAM 1–4). */
function seededDest(ws: Workspace): ShowRecord {
  const d = ws.importRecord(destRecord(), { keepId: true });
  const res = ws.patch(d.showId, "show", showModule.seed(d, { newId, profile: "arena" }), "seed");
  expect(res.errors ?? []).toEqual([]);
  return ws.get(d.showId);
}

describe("fixture: setlist-arena", () => {
  it("has 14 songs, 6 cameras, 2 servers and a clean show book", () => {
    const { get } = setup();
    const r = get();
    expect(activeSetlist(r)!.songs).toHaveLength(14);
    expect(r.devices.filter((d) => d.class === "camera").map((d) => d.label)).toEqual(["CAM 1", "CAM 2", "CAM 3", "CAM 4", "CAM 5", "CAM 6"]);
    expect(r.servers.hosts.map((h) => h.role)).toEqual(["master", "backup"]);
    expect(activeSetlist(r)!.songs.map((s) => s.tag)).toEqual(expect.arrayContaining(["walk-on", "encore"]));
    expect(r.binder.checks.filter((c) => c.module === "show" && !c.resolved)).toEqual([]);
    expect(r.derived.show).toMatchObject({ songsWithoutPrimary: [], camerasWithoutNotes: [], cuesByKind: { record: 2 } });
  });
});

describe("acceptance: operator ⚑ note from mobile", () => {
  it("lands as a pending cover note on the right camera and song", () => {
    const { get, ok } = setup();
    const r = ok(operatorFlagNote(get(), "song_05", "dev_cam3", "can't see drums from here on this one", "Camera Op 3", newId), "mobile");
    const notes = song(r, "song_05").cameraNotes.filter((n) => n.cameraId === "dev_cam3");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ priority: "cover", pending: true, shot: "can't see drums from here on this one", authored: { by: "Camera Op 3" } });
    expect(song(r, "song_04").cameraNotes.some((n) => n.pending)).toBe(false);
    expect(r.meta.changelog.at(-1)?.by).toBe("mobile");
  });

  it("mobile cannot write a primary note, edit the director's notes, or reorder songs; other modules cannot write /show", () => {
    const { get, apply } = setup();
    const r = get();
    const primary = operatorFlagNote(r, "song_05", "dev_cam3", "mine", "op", newId).map((p) => ({ ...p, value: { ...(p as { value: object }).value, priority: "primary" } })) as Patch[];
    expect(apply(primary, "mobile").errors?.[0].code).toBe("E_NOT_OWNER");
    expect(apply([{ op: "replace", path: `/show/setlists/${SL}/songs/song_05/cameraNotes/note_05_1/shot`, value: "x" }], "mobile").errors?.[0].code).toBe("E_NOT_OWNER");
    expect(apply(moveSong(r, "song_03", 1), "mobile").errors?.[0].code).toBe("E_NOT_OWNER");
    expect(apply(addSong(r, "Sneaky", null, newId), "signal").errors?.[0].code).toBe("E_NOT_OWNER");
  });
});

describe("validate SHW-001..005", () => {
  it("SHW-001: note on an inactive camera, and unbound carried notes", () => {
    const { get, ok } = setup();
    let r = ok(setRosterSlot(get(), "dev_cam5", { active: false }));
    const c = open(r, "SHW-001");
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]).toMatchObject({ severity: "warn", module: "show" });
    expect(c[0].message).toMatch(/CAM 5/);
    expect(c[0].message).not.toMatch(/dev_cam5/);
    expect(c[0].fixes[0].patch).toBeTruthy();
    r = ok(c[0].fixes[0].patch!);
    expect(open(r, "SHW-001")).toEqual([]);
  });

  it("SHW-001: deleting a camera with cascade drops its roster slot and parks its notes as unbound", () => {
    const { get, apply, ok } = setup();
    expect(apply([{ op: "remove", path: "/devices/dev_cam5" }], "signal").errors?.[0].code).toBe("E_ORPHAN_DELETE");
    const r = ok([{ op: "remove", path: "/devices/dev_cam5" }], "signal", true);
    expect(r.show.cameraRoster.some((s) => s.cameraId === "dev_cam5")).toBe(false);
    expect(activeSetlist(r)!.songs.flatMap((s) => s.cameraNotes).some((n) => n.cameraId === "dev_cam5")).toBe(false);
    expect(r.show.unbound.length).toBeGreaterThan(0);
    expect(r.show.unbound.every((n) => n.cameraLabel === "CAM 5")).toBe(true);
    expect(open(r, "SHW-001")).toHaveLength(r.show.unbound.length);
    expect(open(r, "SHW-001")[0].message).toMatch(/no CAM 5/);
    void get;
  });

  it("SHW-002: song without a primary is info, warn once locked", () => {
    const { get, ok } = setup();
    const s8 = song(get(), "song_08");
    const r = ok(s8.cameraNotes.filter((n) => n.priority === "primary").map((n) => ({ op: "remove" as const, path: `/show/setlists/${SL}/songs/song_08/cameraNotes/${n.id}` })));
    const c = open(r, "SHW-002");
    expect(c.map((x) => x.target)).toEqual(["song_08"]);
    expect(c[0].severity).toBe("info");
    expect(c[0].message).toMatch(/Little Hours/);
    expect(r.derived.show!.songsWithoutPrimary).toEqual(["song_08"]);
    const locked = { ...r, meta: { ...r.meta, status: "locked" as const } };
    expect(validateShow(locked).find((x) => x.code === "SHW-002")?.severity).toBe("warn");
  });

  it("SHW-003: record-start with no record-stop", () => {
    const { ok } = setup();
    const r = ok([{ op: "remove", path: `/show/setlists/${SL}/songs/song_14/cues/cue_14_2` }]);
    const c = open(r, "SHW-003");
    expect(c.map((x) => x.target)).toEqual(["cue_01_1"]);
    expect(c[0].message).toMatch(/REC-1/);
  });

  it("SHW-004: look on the backup server", () => {
    const { get, ok } = setup();
    const r = ok(updateSong(get(), "song_02", { lookRef: { serverId: "srv_b", lookName: "Look 2" } }));
    const c = open(r, "SHW-004");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ severity: "info", target: "song_02" });
    expect(c[0].message).toMatch(/SRV-B/);
    const fixed = ok(c[0].fixes[0].patch!);
    expect(song(fixed, "song_02").lookRef?.serverId).toBe("srv_a");
  });

  it("SHW-005: cue action ref to a device not in the record blocks; free-text look refs are fine", () => {
    const { get, ok } = setup();
    let r = ok(updateCue(get(), "song_03", "cue_03_2", { action: { type: "look", ref: "Look 3 alt" } }));
    expect(open(r, "SHW-005")).toEqual([]);
    r = ok(updateCue(r, "song_14", "cue_14_2", { action: { type: "record-stop", ref: "dev_gone" } }));
    const c = open(r, "SHW-005");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ severity: "block", target: "cue_14_2" });
    r = ok(c[0].fixes[0].patch!);
    expect(open(r, "SHW-005")).toEqual([]);
  });
});

describe("parseSetlistText", () => {
  it("reads pasted lines with dash, em dash or bare durations and infers tags", () => {
    expect(parseSetlistText("Walk-on\nNorthern Lights — 4:05\n2. Paper Satellites - 3:32\nGlasshouse 3:51\n\nIntro VT\nEncore: Homecoming")).toEqual([
      { title: "Walk-on", tag: "walk-on" },
      { title: "Northern Lights", durationSec: 245 },
      { title: "Paper Satellites", durationSec: 212 },
      { title: "Glasshouse", durationSec: 231 },
      { title: "Intro VT", tag: "interstitial" },
      { title: "Encore: Homecoming", tag: "encore" },
    ]);
  });
  it("reads CSV with a header", () => {
    expect(parseSetlistText('title,duration,bpm,key,tag\nNorthern Lights,4:05,128,E,opener\n"Copper, Coal",204,132,G,\nWalk Off,,,,')).toEqual([
      { title: "Northern Lights", durationSec: 245, bpm: 128, key: "E", tag: "opener" },
      { title: "Copper, Coal", durationSec: 204, bpm: 132, key: "G" },
      { title: "Walk Off", tag: "walk-off" },
    ]);
  });
});

describe("carry-over between shows", () => {
  it("importSetlist matches titles case-insensitively, re-binds cameras by label and flags new titles", () => {
    const { get } = setup();
    const ws = new Workspace(engine);
    const dest = seededDest(ws);
    const ops = importSetlist(dest, parseSetlistText("northern lights — 4:10\nBrand New Song 3:00"), newId, { previous: [get()] });
    const res = ws.patch(dest.showId, "show", ops, "import");
    expect(res.errors ?? []).toEqual([]);
    const r = ws.get(dest.showId);
    const sl = activeSetlist(r)!;
    expect(sl.source).toBe("import");
    expect(sl.songs.map((s) => [s.title, s.durationSec, !!s.isNew])).toEqual([["northern lights", 250, false], ["Brand New Song", 180, true]]);
    const nl = sl.songs[0];
    expect(nl.cameraNotes.map((n) => n.cameraId).sort()).toEqual(["dev_kam1", "dev_kam1"]);
    expect(nl.cues.map((c) => c.call)).toEqual(["Wide on downbeat", "Server to Look 2"]);
    expect(r.show.unbound.map((n) => [n.cameraLabel, n.songTitle])).toEqual([["CAM 5", "northern lights"]]);
    expect(open(r, "SHW-001")).toHaveLength(1);
  });

  it("copySetlistFrom re-binds by label, keeps unmatched under unbound, clears statuses and copies no runLog", () => {
    const src = setup();
    const s0 = src.get();
    src.ok([...startSong(s0, "rehearsal-1", "song_01", "vd", t(10)), ...setCueStatus(s0, "rehearsal-1", "song_01", "cue_01_1", "missed", "vd", t(20)), ...skipSong(s0, "rehearsal-1", "song_07", "vd", t(30))]);
    const ws = new Workspace(engine);
    const dest = seededDest(ws);
    const res = ws.patch(dest.showId, "show", copySetlistFrom(src.get(), dest, newId), "copy from show");
    expect(res.errors ?? []).toEqual([]);
    const r = ws.get(dest.showId);
    const sl = activeSetlist(r)!;
    expect(sl.songs).toHaveLength(14);
    expect(sl.source).toBe("copy");
    expect(r.show.runLog).toEqual([]);
    expect(sl.songs.flatMap((s) => s.cues).every((c) => c.status == null)).toBe(true);
    expect(sl.songs.some((s) => s.skipped)).toBe(false);
    const ids = new Set(sl.songs.flatMap((s) => s.cameraNotes.map((n) => n.cameraId)));
    expect([...ids].every((id) => id.startsWith("dev_kam"))).toBe(true);
    expect(new Set(r.show.unbound.map((n) => n.cameraLabel))).toEqual(new Set(["CAM 5", "CAM 6"]));
    expect(sl.setChanges[0].cameraMoves).toEqual([]); // CAM 6 move had no match
    expect(open(r, "SHW-001").length).toBe(r.show.unbound.length);
  });

  it("copyShow within a tour keeps the book bound to the copied cameras and clears run history", () => {
    const { ws, id, get, ok } = setup();
    ok([...startSong(get(), "show", "song_01", "vd", t(1)), ...setCueStatus(get(), "show", "song_01", "cue_01_1", "hit", "vd", t(2))]);
    const copy = ws.copyShow(id);
    expect(copy.tourId).toBe("tour-example-2026");
    const sl = activeSetlist(copy)!;
    expect(sl.songs).toHaveLength(14);
    expect(copy.show.runLog).toEqual([]);
    expect(sl.songs.flatMap((s) => s.cues).every((c) => c.status == null)).toBe(true);
    const cams = new Set(copy.devices.filter((d) => d.class === "camera").map((d) => d.id));
    expect(sl.songs.flatMap((s) => s.cameraNotes).every((n) => cams.has(n.cameraId))).toBe(true);
    expect(sl.id).not.toBe(SL);
    expect(copy.binder.checks.filter((c) => c.module === "show" && !c.resolved)).toEqual([]);
  });
});

describe("lifecycle gate", () => {
  it("locked: quick notes, cue status, skip and ⚑ land; addSong needs Unfreeze setlist", () => {
    const { ws, id, get, apply, ok } = setup();
    expect(ws.issueShow(id).ok).toBe(true);
    // issued: setlist work still runs in parallel
    ok(addCue(get(), "song_04", { at: "outro", call: "Wide to end" }, newId));
    expect(ws.lockShow(id).ok).toBe(true);
    const old = song(get(), "song_02").cameraNotes.find((n) => n.priority === "primary")!;
    let r = ok(setNote(get(), "song_02", old.cameraId, { shot: "tighter on vocal, hold" }, "videoDirector", "show", newId));
    const amended = song(r, "song_02").cameraNotes.find((n) => n.id === old.id)!;
    expect(amended).toMatchObject({ shot: "tighter on vocal, hold", previous: old.shot, authored: { during: "show" } });
    r = ok(setCueStatus(r, "show", "song_02", "cue_02_1", "hit", "videoDirector", t(100)));
    r = ok(skipSong(r, "show", "song_09", "videoDirector", t(101)));
    r = ok(operatorFlagNote(r, "song_10", "dev_cam4", "pyro smoke blocks the drums", "op4", newId), "mobile");
    expect(apply(addSong(r, "Surprise", "song_03", newId)).errors?.[0].code).toBe("E_FROZEN");
    expect(apply(moveSong(r, "song_03", 1)).errors?.[0].code).toBe("E_FROZEN");
    r = ok(unfreezeSetlist(r, "videoDirector", "artist added a song", t(102)));
    r = ok(addSong(r, "Surprise", "song_03", newId));
    expect(activeSetlist(r)!.songs.map((s) => s.order)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(activeSetlist(r)!.songs[3].title).toBe("Surprise");
    r = ok(refreezeSetlist(r));
    expect(apply(addSong(r, "Another", null, newId)).errors?.[0].code).toBe("E_FROZEN");
    expect(ws.archiveShow(id).ok).toBe(true);
    expect(apply(operatorFlagNote(get(), "song_10", "dev_cam4", "late", "op4", newId), "mobile").errors?.[0].code).toBe("E_FROZEN");
  });

  it("the example show stays read-only for the show writer", () => {
    const ws = new Workspace(engine);
    const raw = structuredClone(fixture);
    raw.meta.source = "example";
    const r = ws.importRecord(raw, { keepId: true });
    expect(ws.patch(r.showId, "show", addSong(r, "x", null, newId), "t").errors?.[0].code).toBe("E_FROZEN");
    expect(ws.patch(r.showId, "mobile", operatorFlagNote(r, "song_01", "dev_cam1", "x", "op", newId), "t").errors?.[0].code).toBe("E_FROZEN");
  });

  it("issueShow snapshots the active setlist into the revision", () => {
    const { ws, id } = setup();
    expect(ws.issueShow(id).ok).toBe(true);
    const rev = ws.revisions(id).at(-1)!;
    expect(rev.setlist?.id).toBe(SL);
    expect(rev.setlist?.version).toBe(3);
    expect(rev.setlist?.songs).toHaveLength(14);
  });
});

describe("run controls", () => {
  it("measures durations from start/end pairs (minus holds) and feeds the rehearsal review", () => {
    const { get, ok } = setup();
    const run = "rehearsal-1" as const;
    let r = ok(nextSong(get(), run, "vd", t(0))); // starts song 1
    expect(runState(r, run).songId).toBe("song_01");
    expect(runState(r, run).nextCueId).toBe("cue_01_1");
    r = ok(setCueStatus(r, run, "song_01", "cue_01_1", "hit", "vd", t(5)));
    expect(runState(r, run).nextCueId).toBe("cue_01_2");
    r = ok(setCueStatus(r, run, "song_01", "cue_01_2", "missed", "vd", t(8)));
    r = ok(nextSong(r, run, "vd", t(92))); // song 1 = 92 s
    r = ok(holdToggle(r, run, "vd", t(100)));
    expect(runState(r, run).held).toBe(true);
    expect(runState(r, run).elapsedSec(t(130))).toBe(8);
    r = ok(holdToggle(r, run, "vd", t(130)));
    r = ok(quickCue(r, run, "song_02", "Server to Look 2B", "vd", t(152), newId));
    const qc = song(r, "song_02").cues.at(-1)!;
    expect(qc).toMatchObject({ at: "0:30", kind: "server" });
    r = ok(setCueStatus(r, run, "song_02", "cue_02_1", "cut", "vd", t(160)));
    r = ok(skipSong(r, run, "song_03", "vd", t(170)));
    r = ok(nextSong(r, run, "vd", t(300))); // song 2 = 208 - 30 held = 178 s; song 3 skipped → song 4
    expect(runState(r, run).songId).toBe("song_04");
    expect(r.derived.show!.measuredDurations).toEqual({ song_01: 92, song_02: 178 });
    expect(r.derived.show!.totalRunSec).toBe(270);
    const rv = rehearsalReview(r, run);
    expect(rv.missed).toEqual([{ songId: "song_01", cueId: "cue_01_2" }]);
    expect(rv.cut).toEqual([{ songId: "song_02", cueId: "cue_02_1" }]);
    expect(rv.durations.find((d) => d.songId === "song_01")).toEqual({ songId: "song_01", typed: 90, measured: 92 });
    expect(rv.songsWithoutPrimary).toEqual([]);
    r = ok(acceptReview(r));
    expect(activeSetlist(r)!.version).toBe(4);
    expect(activeSetlist(r)!.songs.flatMap((s) => s.cues).every((c) => !c.status)).toBe(true);
    expect(activeSetlist(r)!.songs.some((s) => s.skipped)).toBe(false);
    expect(r.show.runLog.length).toBeGreaterThan(5);
  });
});

describe("seed and wizard", () => {
  it("applyProfile seeds an empty dated setlist and a roster of the profile's cameras", () => {
    const ws = new Workspace(engine);
    const id = newShowFromWizard(ws, { source: "blank", artist: "Seed Test", type: "arena", dates: ["2026-11-14"], venueName: "Arena", city: "Nashville" });
    applyProfile(ws, id, { cameras: 4 });
    const r = ws.get(id);
    expect(r.show.setlists.map((s) => s.name)).toEqual(["Set · 2026-11-14"]);
    expect(r.show.activeSetlistId).toBe(r.show.setlists[0].id);
    expect(rosterCameras(r).map((c) => [c.device.label, c.slot.operator, c.slot.active])).toEqual([
      ["CAM 1", "cameraLead", true], ["CAM 2", "", true], ["CAM 3", "", true], ["CAM 4", "", true]]);
    expect(r.meta.changelog.some((c) => c.by === "show" && c.reason === "setup:profile")).toBe(true);
    expect(showModule.seed(r, { newId, profile: "arena" })).toEqual([]);
    expect(r.binder.sections.find((s) => s.key === "show-book")).toMatchObject({ visible: true, required: false, blocks: [{ type: "auto", ref: "show.director-book" }, { type: "text" }] });
    expect(r.binder.sections.find((s) => s.key === "cameras")?.blocks[0]).toMatchObject({ type: "auto", ref: "show.camera-card" });
  });
});

describe("exports", () => {
  it("all seven render with the setlist-version footer", () => {
    const { get, ok } = setup();
    const r0 = get();
    ok([...startSong(r0, "show", "song_01", "vd", t(0)), ...setCueStatus(r0, "show", "song_01", "cue_01_1", "hit", "vd", t(3))]);
    const r = ok(nextSong(get(), "show", "vd", t(95)));
    const keys = showModule.exports.map((e) => [e.key, e.label]);
    expect(keys).toEqual([["camera-card", "Camera cards"], ["director-book", "Director book"], ["operator-strip", "Operator strip"], ["set-change", "Set-change sheet"],
      ["look-list", "Server look list"], ["record-log", "Record log"], ["run-report", "Run report"]]);
    for (const e of showModule.exports) {
      const out = e.render(r);
      expect(out, e.key).toMatch(/SA-2026-001 · setlist v3 · printed \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    }
    const cards = showModule.exports[0].render(r);
    expect(cards.split("\f")).toHaveLength(6);
    expect(cards).toMatch(/CAMERA CARD — CAM 3/);
    expect(cards).toMatch(/pyro SL at 3:10/);
    expect(showModule.exports[1].render(r)).toMatch(/Set change into "Little Hours"/);
    expect(showModule.exports[4].render(r).split("\n")[1]).toMatch(/^SRV-A,1,/);
    const recLog = showModule.exports[5].render(r);
    expect(recLog).toMatch(/record-start,REC-1,Walk-On: House to Half/);
    expect(recLog).toMatch(/record-stop,REC-1,Last Train Out/);
    expect(showModule.exports[6].render(r)).toMatch(/Walk-On: House to Half\s+1:30\s+1:35/);
  });
});
