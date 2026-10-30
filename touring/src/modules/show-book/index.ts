// Show Book module (`show`): setlist, cues and per-camera notes for build, rehearsal and show (Cues & camera notes tab).
// Owns /show. Reads devices (cameras), servers.hosts, led.walls, crew and the schedule. Validates SHW-001..005.
import { entityIndex } from "../../store/refs";
import { prefixOf } from "../../store/ids";
import { toCsv } from "../../util/csv";
import type { CheckDraft, Cue, Derived, ModuleContract, Patch, RunId, Setlist, ShowRecord, Song } from "../../store/types";
import {
  activeSetlist, cameraLabel, labelCompare, latestRun, measuredByRun, mmss, rosterCameras, songsWithoutPrimary, syncRoster,
} from "./helpers";

const orderedSongs = (sl: Setlist) => [...sl.songs].sort((a, b) => a.order - b.order);
const orderedCues = (s: Song) => [...s.cues].sort((a, b) => a.order - b.order);
const songPath = (sl: Setlist, s: Song) => `/show/setlists/${sl.id}/songs/${s.id}`;
const short = (t: string, n = 48) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

// ---------------------------------------------------------------- seed / derive

/** One empty setlist named from event.dates[0]; roster from every camera device (first by label → camera lead). Idempotent. */
export function seedShow(r: ShowRecord, newId: (p: "sl") => string): Patch[] {
  const ops: Patch[] = [];
  if (!r.show.setlists.length) {
    const date = r.event.dates[0];
    const sl: Setlist = { id: newId("sl"), name: date ? `Set · ${date}` : "Set 1", version: 1, source: "manual", songs: [], setChanges: [] };
    ops.push({ op: "add", path: "/show/setlists/-", value: sl }, { op: "replace", path: "/show/activeSetlistId", value: sl.id });
  } else if (!r.show.activeSetlistId || !r.show.setlists.some((s) => s.id === r.show.activeSetlistId)) {
    ops.push({ op: "replace", path: "/show/activeSetlistId", value: r.show.setlists[0].id });
  }
  ops.push(...syncRoster(r));
  return ops;
}

export function deriveShow(r: ShowRecord): NonNullable<Derived["show"]> {
  const sl = activeSetlist(r);
  const songs = sl ? orderedSongs(sl) : [];
  const active = (r.show?.cameraRoster ?? []).filter((s) => s.active).map((s) => s.cameraId);
  const noted = new Set(songs.flatMap((s) => s.cameraNotes.map((n) => n.cameraId)));
  const cuesByKind: Record<string, number> = {};
  for (const s of songs) for (const c of s.cues) cuesByKind[c.kind] = (cuesByKind[c.kind] ?? 0) + 1;
  const run = latestRun(r);
  const measuredDurations: Record<string, number> = {};
  if (run) for (const [id, v] of measuredByRun(r).get(run) ?? []) measuredDurations[id] = v.sec;
  return {
    songsWithoutPrimary: songsWithoutPrimary(r, sl),
    camerasWithoutNotes: active.filter((id) => !noted.has(id)),
    cuesByKind,
    measuredDurations,
    totalRunSec: Object.values(measuredDurations).reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------- validate

const DEVICE_ACTIONS = new Set(["record-start", "record-stop", "blackout"]);
const isStart = (c: Cue) => c.action?.type === "record-start" || (!c.action && c.kind === "record" && /\b(start|roll|rolling)\b/i.test(c.call));
const isStop = (c: Cue) => c.action?.type === "record-stop" || (!c.action && c.kind === "record" && /\b(stop|end)\b/i.test(c.call));

export function validateShow(r: ShowRecord): CheckDraft[] {
  const out: CheckDraft[] = [];
  const sb = r.show;
  if (!sb) return out;
  const roster = new Map(sb.cameraRoster.map((s, i) => [s.cameraId, { s, i }]));
  const devices = new Map(r.devices.map((d) => [d.id, d]));
  const locked = r.meta.status === "locked";

  // SHW-001 · camera note on an inactive or removed camera (warn); every unbound carried note too.
  for (const sl of sb.setlists) for (const song of orderedSongs(sl)) for (const n of song.cameraNotes) {
    const slot = roster.get(n.cameraId);
    const dev = devices.get(n.cameraId);
    if (dev && dev.class === "camera" && slot?.s.active) continue;
    const label = cameraLabel(r, n.cameraId);
    const why = !dev ? "is no longer in the record" : dev.class !== "camera" ? `is a ${dev.class}, not a camera` : !slot ? "is not on the camera roster" : "is marked inactive on the roster";
    const notePath = `${songPath(sl, song)}/cameraNotes/${n.id}`;
    out.push({
      code: "SHW-001", severity: "warn", title: "Note on an inactive camera", target: n.id, involved: [n.id, song.id, n.cameraId],
      message: `"${song.title}" has a ${n.priority} note for ${label} ("${short(n.shot)}"), but ${label} ${why}.`,
      rule: "Camera notes bind to active roster cameras; a note on an inactive or removed camera is never read by an operator.",
      evidence: [
        { label: `${label} note`, value: n.shot, path: notePath },
        { label: `${label} roster slot`, value: slot ? (slot.s.active ? "active" : "inactive") : "none", path: slot ? `/show/cameraRoster/${slot.i}` : "/show/cameraRoster" },
      ],
      fixes: [
        ...(dev && dev.class === "camera" ? [{ label: `Make ${label} active on the roster`, module: "show" as const,
          patch: slot ? [{ op: "replace" as const, path: `/show/cameraRoster/${slot.i}/active`, value: true }]
            : [{ op: "add" as const, path: "/show/cameraRoster/-", value: { cameraId: n.cameraId, operator: "", position: "", comms: "", active: true } }] }] : []),
        { label: `Delete the ${label} note on "${song.title}"`, module: "show", patch: [{ op: "remove", path: notePath }] },
      ],
    });
  }
  for (const n of sb.unbound) out.push({
    code: "SHW-001", severity: "warn", title: "Unbound camera note", target: n.id, involved: [n.id],
    message: `A ${n.priority} note for ${n.cameraLabel} on "${n.songTitle}" ("${short(n.shot)}") was carried over, but this show has no ${n.cameraLabel}.`,
    rule: "Notes carried from another show re-bind by camera label; a note whose label has no match is held as unbound until it is reassigned or deleted.",
    evidence: [{ label: `${n.cameraLabel} note`, value: n.shot, path: `/show/unbound/${n.id}` }, { label: "Cameras", value: rosterCameras(r).map((c) => c.device.label).join(", ") || "none", path: "/show/cameraRoster" }],
    fixes: [
      { label: "Reassign the note to a camera in Build", module: "show" },
      { label: `Delete the unbound ${n.cameraLabel} note`, module: "show", patch: [{ op: "remove", path: `/show/unbound/${n.id}` }] },
    ],
  });

  const sl = activeSetlist(r);
  const songs = sl ? orderedSongs(sl) : [];
  const activeCams = rosterCameras(r).filter((c) => c.slot.active && c.device.class === "camera");

  // SHW-002 · song with no primary note on any active camera (info; warn once locked). Skipped songs and shows with no active cameras are exempt.
  if (sl && activeCams.length) {
    const missing = new Set(songsWithoutPrimary(r, sl));
    for (const song of songs) {
      if (!missing.has(song.id) || song.skipped) continue;
      out.push({
        code: "SHW-002", severity: locked ? "warn" : "info", title: "Song without a primary shot", target: song.id, involved: [song.id],
        message: `"${song.title}" (song ${song.order}) has no primary note on any active camera (${activeCams.map((c) => c.device.label).join(", ")}).`,
        rule: `Every song needs at least one primary camera note on an active roster camera so the director knows what to take${locked ? "; the show is locked, so this is now a warning" : ""}.`,
        evidence: [
          { label: `"${song.title}" notes`, value: song.cameraNotes.length ? song.cameraNotes.map((n) => `${cameraLabel(r, n.cameraId)} ${n.priority}`).join(", ") : "none", path: `${songPath(sl, song)}/cameraNotes` },
          { label: "Show status", value: r.meta.status, path: "/meta/status" },
        ],
        fixes: [{ label: `Add a primary note for "${song.title}" in Build`, module: "show" }],
      });
    }
  }

  // SHW-003 · record-start with no matching record-stop later in the set (per recorder).
  if (sl) {
    const open = new Map<string, { song: Song; cue: Cue }[]>();
    for (const song of songs) for (const cue of orderedCues(song)) {
      const dev = cue.action?.ref ?? cue.target ?? "";
      if (isStart(cue)) open.set(dev, [...(open.get(dev) ?? []), { song, cue }]);
      else if (isStop(cue)) open.get(dev)?.shift();
    }
    for (const [dev, starts] of open) for (const { song, cue } of starts) {
      const label = dev ? cameraLabel(r, dev) : "the recorder";
      out.push({
        code: "SHW-003", severity: "warn", title: "Record start without stop", target: cue.id, involved: [cue.id, song.id, ...(dev ? [dev] : [])],
        message: `"${song.title}" starts ${label} recording ("${short(cue.call)}" at ${cue.at || "—"}), but no later cue stops it.`,
        rule: "Every record-start cue needs a matching record-stop cue on the same recorder later in the setlist.",
        evidence: [{ label: `Record start · ${song.title}`, value: `${cue.at} · ${cue.call}`, path: `${songPath(sl, song)}/cues/${cue.id}` }],
        fixes: [{ label: `Add a record-stop cue for ${label} on the last song`, module: "show" }],
      });
    }
  }

  // SHW-004 · look on a backup-only server (info).
  for (const song of songs) {
    const h = song.lookRef?.serverId ? r.servers.hosts.find((x) => x.id === song.lookRef!.serverId) : undefined;
    if (!h || h.role !== "backup") continue;
    const label = r.devices.find((d) => d.id === h.deviceId)?.label ?? "the server";
    const master = r.servers.hosts.find((x) => x.role === "master" && x.failover === h.id) ?? r.servers.hosts.find((x) => x.role === "master");
    const mLabel = master ? r.devices.find((d) => d.id === master.deviceId)?.label ?? "the master" : null;
    out.push({
      code: "SHW-004", severity: "info", title: "Look on the backup server", target: song.id, involved: [song.id, h.id],
      message: `"${song.title}" plays ${song.lookRef!.lookName || "its look"} from ${label}, which is the backup server.`,
      rule: "A song's look should be referenced on the master server; the backup mirrors it.",
      evidence: [{ label: `"${song.title}" look`, value: `${label} · ${song.lookRef!.lookName}`, path: `${songPath(sl!, song)}/lookRef` }, { label: `${label} role`, value: "backup", path: `/servers/hosts/${h.id}/role` }],
      fixes: master ? [{ label: `Point the look at ${mLabel}`, module: "show", patch: [{ op: "replace", path: `${songPath(sl!, song)}/lookRef/serverId`, value: master.id }] }]
        : [{ label: "Add a master server", module: "servers" }],
    });
  }

  // SHW-005 · cue action.ref to a device not in the record (block). Free-text refs (look names, LX cue numbers) are fine.
  const idx = entityIndex(r);
  for (const s of sb.setlists) for (const song of orderedSongs(s)) for (const cue of song.cues) {
    const ref = cue.action?.ref;
    if (!cue.action) continue;
    // An id-shaped ref must resolve; a device hook (record / blackout) must be id-shaped; look / cue-ref may be free text.
    const idShaped = !!ref && !!prefixOf(ref) && /^[a-z]+_[A-Za-z0-9_]+$/.test(ref);
    const bad = idShaped ? !idx.has(ref!) : DEVICE_ACTIONS.has(cue.action.type);
    if (!bad) continue;
    const cuePath = `${songPath(s, song)}/cues/${cue.id}`;
    out.push({
      code: "SHW-005", severity: "block", title: "Cue references a missing device", target: cue.id, involved: [cue.id, song.id],
      message: `The ${cue.action.type} cue "${short(cue.call)}" on "${song.title}" points at ${ref || "nothing"}, which is not a device in this show.`,
      rule: "A cue's machine hook (action.ref) must name an entity the record has, so a later integration fires the right device.",
      evidence: [{ label: "Cue action", value: `${cue.action.type} → ${ref || "(empty)"}`, path: `${cuePath}/action` }],
      fixes: [
        { label: "Remove the machine hook (keep the cue)", module: "show", patch: [{ op: "remove", path: `${cuePath}/action` }] },
        { label: "Pick the device in Build", module: "show" },
      ],
    });
  }
  return out;
}

// ---------------------------------------------------------------- exports

function footer(r: ShowRecord): string {
  const v = activeSetlist(r)?.version ?? 0;
  return `${r.showCode} · setlist v${v} · printed ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
}
const PRI = { primary: 0, cover: 1, safety: 2 } as const;
const lookOf = (r: ShowRecord, s: Song) => {
  if (!s.lookRef) return "";
  const h = r.servers.hosts.find((x) => x.id === s.lookRef!.serverId);
  const label = h ? r.devices.find((d) => d.id === h.deviceId)?.label ?? "" : "";
  return [label, s.lookRef.lookName].filter(Boolean).join(" · ");
};
const wallsOf = (r: ShowRecord, s: Song) => (s.wallState ?? []).map((w) => `${r.led.walls.find((x) => x.id === w.wallId)?.name ?? "wall"}: ${w.note}`).join("; ");
const flagsOf = (s: Song) => s.flags.map((f) => `${f.kind === "custom" ? f.note || "flag" : f.kind}${f.at ? ` @${f.at}` : ""}${f.kind !== "custom" && f.note ? ` (${f.note})` : ""}`).join(", ");
const dur = (n?: number) => (n ? mmss(n) : "—");
const PAGE = "\n\f\n";

export function renderCameraCards(r: ShowRecord): string {
  const sl = activeSetlist(r);
  if (!sl) return `No setlist.\n\n${footer(r)}`;
  const pages = rosterCameras(r).filter((c) => c.slot.active).map(({ slot, device }) => {
    const L = [`CAMERA CARD — ${device.label}`, `${r.name || r.showCode} · ${sl.name}`, `Operator: ${slot.operator ? (r.crew as unknown as Record<string, string>)[slot.operator] || slot.operator : "—"} · Position: ${slot.position || "—"} · Comms: ${slot.comms || "—"}`, ""];
    for (const s of orderedSongs(sl)) {
      const notes = s.cameraNotes.filter((n) => n.cameraId === device.id).sort((a, b) => PRI[a.priority] - PRI[b.priority]);
      const flags = flagsOf(s);
      L.push(`${String(s.order).padStart(2)}. ${s.title}${s.skipped ? " (SKIPPED)" : ""}${flags ? `   [${flags}]` : ""}`);
      if (!notes.length) L.push("    —");
      for (const n of notes) {
        L.push(`    ${n.priority.toUpperCase()}: ${n.shot}${n.move ? ` · ${n.move}` : ""}${n.lens ? ` · ${n.lens}` : ""}${n.timing ? ` · ${n.timing}` : ""}${n.pending ? " (⚑ pending)" : ""}`);
        if (n.warning) L.push(`    !! ${n.warning}`);
      }
    }
    L.push("", footer(r));
    return L.join("\n");
  });
  return pages.length ? pages.join(PAGE) : `No active cameras on the roster.\n\n${footer(r)}`;
}

export function renderDirectorBook(r: ShowRecord): string {
  const sl = activeSetlist(r);
  if (!sl) return `No setlist.\n\n${footer(r)}`;
  const cams = rosterCameras(r).filter((c) => c.slot.active);
  const songs = orderedSongs(sl);
  const pages = songs.map((s, i) => {
    const L = [`${s.order}. ${s.title}${s.tag ? ` [${s.tag}]` : ""}${s.skipped ? " — SKIPPED" : ""}`, `Duration ${dur(s.durationSec)}${s.bpm ? ` · ${s.bpm} bpm` : ""}${s.key ? ` · ${s.key}` : ""}`, ""];
    L.push("CUES");
    for (const c of orderedCues(s)) L.push(`  ${c.order}. [${c.at || "—"}] ${c.call} (${c.kind}${c.action ? ` · ${c.action.type}` : ""})`);
    if (!s.cues.length) L.push("  —");
    L.push("", "CAMERAS");
    for (const { device } of cams) L.push(`  ${device.label.padEnd(8)} ${s.cameraNotes.find((n) => n.cameraId === device.id && n.priority === "primary")?.shot ?? "—"}`);
    L.push("", `Look: ${lookOf(r, s) || "—"}`, `Walls: ${wallsOf(r, s) || "—"}`, `Flags: ${flagsOf(s) || "—"}`);
    if (s.directorNote) L.push(`Note: ${s.directorNote}`);
    const sc = sl.setChanges.find((c) => c.afterSongId === s.id);
    if (sc && songs[i + 1]) L.push(`Set change into "${songs[i + 1].title}": ${dur(sc.durationSec)}${sc.notes ? ` · ${sc.notes}` : ""}${sc.cameraMoves.length ? ` · ${sc.cameraMoves.map((m) => `${cameraLabel(r, m.cameraId)} → ${m.to}`).join(", ")}` : ""}`);
    L.push("", footer(r));
    return L.join("\n");
  });
  return [`DIRECTOR BOOK — ${r.name || r.showCode} · ${sl.name} · ${songs.length} songs`, ...pages].join(PAGE);
}

export function renderOperatorStrip(r: ShowRecord): string {
  const sl = activeSetlist(r);
  const L = [`OPERATOR STRIP — ${r.showCode}`];
  for (const s of sl ? orderedSongs(sl) : []) {
    const rec = s.cues.filter((c) => c.kind === "record" || c.action?.type === "record-start" || c.action?.type === "record-stop").map((c) => `${c.action?.type ?? "rec"} @${c.at}`).join(", ");
    L.push(`${String(s.order).padStart(2)} ${s.title} | ${lookOf(r, s) || "—"} | ${wallsOf(r, s) || "—"}${rec ? ` | ${rec}` : ""}`);
  }
  L.push(footer(r));
  return L.join("\n");
}

export function renderSetChanges(r: ShowRecord): string {
  const sl = activeSetlist(r);
  const rows: unknown[][] = [];
  if (sl) for (const c of sl.setChanges) {
    const s = sl.songs.find((x) => x.id === c.afterSongId);
    rows.push([s ? `${s.order}. ${s.title}` : "", dur(c.durationSec), c.cameraMoves.map((m) => `${cameraLabel(r, m.cameraId)} → ${m.to}`).join("; "), c.notes]);
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  return toCsv(["After song", "Duration", "Camera moves", "Notes"], rows) + footer(r) + "\n";
}

export function renderLookList(r: ShowRecord): string {
  const sl = activeSetlist(r);
  const rows: unknown[][] = [];
  for (const s of sl ? orderedSongs(sl) : []) {
    const h = s.lookRef ? r.servers.hosts.find((x) => x.id === s.lookRef!.serverId) : undefined;
    const server = h ? r.devices.find((d) => d.id === h.deviceId)?.label ?? "" : "";
    rows.push([server, s.order, s.title, s.lookRef?.lookName ?? "", wallsOf(r, s)]);
  }
  rows.sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || labelCompare(String(a[0]), String(b[0])) || Number(a[1]) - Number(b[1]));
  return toCsv(["Server", "#", "Song", "Look", "Wall state"], rows) + footer(r) + "\n";
}

function runFor(r: ShowRecord, prefer: RunId = "show"): RunId | null {
  const log = r.show?.runLog ?? [];
  if (log.some((e) => e.run === prefer)) return prefer;
  return [...log].reverse().find((e) => e.event === "start")?.run ?? null;
}

export function renderRecordLog(r: ShowRecord): string {
  const sl = activeSetlist(r);
  const run = runFor(r, "show");
  const rows: unknown[][] = [];
  for (const s of sl ? orderedSongs(sl) : []) for (const c of orderedCues(s)) {
    if (!(c.action?.type === "record-start" || c.action?.type === "record-stop" || (!c.action && c.kind === "record"))) continue;
    const ev = (r.show.runLog ?? []).filter((e) => e.run === run && e.cueId === c.id && e.event === "cue").at(-1);
    const start = (r.show.runLog ?? []).filter((e) => e.run === run && e.songId === s.id && e.event === "start").at(-1);
    rows.push([c.action?.type ?? "record", cameraLabel(r, c.action?.ref ?? c.target ?? ""), s.title, c.at, c.call, run ?? "", ev?.at ?? start?.at ?? "", ev?.status ?? ""]);
  }
  return toCsv(["Action", "Recorder", "Song", "At", "Call", "Run", "Time", "Status"], rows) + footer(r) + "\n";
}

export function renderRunReport(r: ShowRecord): string {
  const sl = activeSetlist(r);
  const run = runFor(r, "show");
  const L = [`RUN REPORT — ${r.showCode} · ${run ?? "no run logged"}`, ""];
  if (!sl) return [...L, "No setlist.", "", footer(r)].join("\n");
  const measured = run ? measuredByRun(r).get(run) ?? new Map() : new Map();
  L.push("DURATIONS (typed / measured / Δ)");
  let tT = 0, tM = 0;
  for (const s of orderedSongs(sl)) {
    const m = measured.get(s.id)?.sec as number | undefined;
    tT += s.durationSec ?? 0; tM += m ?? 0;
    L.push(`  ${String(s.order).padStart(2)}. ${s.title.padEnd(28)} ${dur(s.durationSec).padStart(6)} ${dur(m).padStart(6)}${m && s.durationSec ? `  ${m >= s.durationSec ? "+" : "-"}${mmss(Math.abs(m - s.durationSec))}` : ""}`);
  }
  L.push(`  Total ${dur(tT)} typed · ${dur(tM)} measured`, "");
  const statuses = (r.show.runLog ?? []).filter((e) => e.run === run && e.event === "cue" && e.status && e.status !== "hit");
  L.push("CUES MISSED OR CUT");
  for (const e of statuses) {
    const s = sl.songs.find((x) => x.id === e.songId);
    const c = s?.cues.find((x) => x.id === e.cueId);
    L.push(`  ${e.status!.toUpperCase()} · ${s?.title ?? e.songId} · ${c ? `[${c.at}] ${c.call}` : e.cueId}`);
  }
  if (!statuses.length) L.push("  None");
  L.push("", "NOTES ADDED AT SHOW TIME");
  const showNotes = orderedSongs(sl).flatMap((s) => s.cameraNotes.filter((n) => n.authored.during === "show").map((n) => `  ${s.title} · ${cameraLabel(r, n.cameraId)} · ${n.shot}${n.previous ? ` (was: ${n.previous})` : ""} — ${n.authored.by}`));
  L.push(...(showNotes.length ? showNotes : ["  None"]), "", "SKIPPED SONGS");
  const skipped = (r.show.runLog ?? []).filter((e) => e.run === run && e.event === "skip").map((e) => `  ${sl.songs.find((s) => s.id === e.songId)?.title ?? e.songId} (${e.at})`);
  L.push(...(skipped.length ? skipped : ["  None"]), "", footer(r));
  return L.join("\n");
}

// ---------------------------------------------------------------- contract

export const showModule: ModuleContract = {
  id: "show",
  version: "1.0.0",
  owns: ["/show"],
  reads: ["/devices", "/servers/hosts", "/led/walls", "/crew", "/binder/schedule"],
  deviceClasses: [],
  cableTypes: [],
  seed: (record, ctx) => seedShow(record, (p) => ctx.newId(p)),
  derive: (record) => ({ show: deriveShow(record) }),
  validate: (record) => validateShow(record),
  exports: [
    { key: "camera-card", label: "Camera cards", mime: "text/plain", render: renderCameraCards },
    { key: "director-book", label: "Director book", mime: "text/plain", render: renderDirectorBook },
    { key: "operator-strip", label: "Operator strip", mime: "text/plain", render: renderOperatorStrip },
    { key: "set-change", label: "Set-change sheet", mime: "text/csv", render: renderSetChanges },
    { key: "look-list", label: "Server look list", mime: "text/csv", render: renderLookList },
    { key: "record-log", label: "Record log", mime: "text/csv", render: renderRecordLog },
    { key: "run-report", label: "Run report", mime: "text/plain", render: renderRunReport },
  ],
};
