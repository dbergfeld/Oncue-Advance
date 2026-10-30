import { useEffect, useMemo, useState } from "react";
import {
  acceptOperatorNote, acceptReview, activeSetlist, addCue, addFlag, addSong, cameraLabel, copySetlistFrom, copySongNotes, fillColumn,
  holdToggle, importSetlist, moveSong, nextSong, operatorFlagNote, parseSetlistText, prevSong, quickCue, quickFlag, refreezeSetlist,
  rehearsalReview, removeCue, removeNote, removeSong, rosterCameras, runState, saveVersion, setCueStatus, setNote, setRosterSlot,
  setSetChange, skipSong, startSong, syncRoster, unfreezeSetlist, updateCue, updateSong,
} from "../../modules/show-book/helpers";
import { showModule } from "../../modules/show-book";
import { newId } from "../../store/ids";
import type { CameraNote, CueKind, Flag, RunId, ShowRecord, Song, SongTag } from "../../store/types";
import { CheckCard, CopyText, Edit, Empty, Modal, PageHead, Panel } from "../kit";
import { useApp, useRecord, useWriter } from "../state";

type Mode = "build" | "run" | "operator" | "review";
const TAGS: SongTag[] = ["opener", "ballad", "uptempo", "acoustic", "encore", "walk-on", "walk-off", "interstitial"];
const KINDS: CueKind[] = ["camera", "server", "record", "wall", "lighting-sync", "safety", "other"];
const FLAGS: Flag["kind"][] = ["pyro", "strobe", "confetti", "crowd", "quick-change", "audience-lights", "custom"];
const RUNS: RunId[] = ["rehearsal-1", "rehearsal-2", "show"];

function mmss(sec: number | undefined): string {
  if (sec === undefined || Number.isNaN(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function parseDur(t: string): number | undefined {
  const m = t.trim().match(/^(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : t.trim() ? Number(t) || undefined : undefined;
}

/** Lock state for the show slice: run actions keep working after lockShow; structure needs Unfreeze. */
function gates(r: ShowRecord) {
  const readOnly = r.meta.source === "example" || r.meta.source === "template" || r.meta.status === "archived";
  const locked = r.meta.status === "locked" && !r.show.unfrozen;
  return { readOnly, structural: readOnly || locked, locked };
}

export function ShowBookView() {
  const r = useRecord()!;
  const show = useWriter("show");
  const [mode, setMode] = useState<Mode>(r.meta.status === "locked" ? "run" : "build");
  const sl = activeSetlist(r);
  const g = gates(r);
  const checks = r.binder.checks.filter((c) => !c.resolved && c.module === "show");

  return (
    <div className="grid gap-4">
      <PageHead title="Show Book" sub={sl ? <>{sl.name} · <span className="font-mono">v{sl.version}</span> · {sl.songs.length} songs · {rosterCameras(r).filter((c) => c.slot.active).length} cameras{g.locked && " · setlist frozen at lock"}</> : "Setlist, cues and camera notes for show day."}
        actions={<>
          {r.meta.status === "locked" && !g.readOnly && (r.show.unfrozen
            ? <button className="btn" onClick={() => show((rec) => refreezeSetlist(rec), "show: refreeze setlist")}>Refreeze setlist</button>
            : <UnfreezeButton />)}
          {sl && !g.structural && <button className="btn" onClick={() => show((rec) => saveVersion(rec), `show: save setlist v${sl.version + 1}`)}>Save version</button>}
        </>} />
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
        {([["build", "Build"], ["run", "Director"], ["operator", "Operator"], ["review", "Rehearsal review"]] as [Mode, string][]).map(([m, l]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`px-3 py-1.5 font-display uppercase tracking-wider ${mode === m ? "border-b-2 border-accent text-accent" : "text-dim"}`}>{l}</button>
        ))}
      </div>
      {mode === "build" && <Build r={r} />}
      {mode === "run" && <Director r={r} />}
      {mode === "operator" && <Operator r={r} />}
      {mode === "review" && <Review r={r} onOpen={() => setMode("build")} />}
      {checks.length > 0 && mode !== "run" && mode !== "operator" && <Panel title="Show Book checks"><div className="grid gap-2 lg:grid-cols-2">{checks.map((c) => <CheckCard key={c.id} c={c} />)}</div></Panel>}
    </div>
  );
}

function UnfreezeButton() {
  const show = useWriter("show");
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Unfreeze setlist</button>
      {open && (
        <Modal title="Unfreeze setlist" onClose={() => setOpen(false)}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (show((rec) => unfreezeSetlist(rec, "videoDirector", why, new Date().toISOString()), `show: unfreeze setlist — ${why}`)) setOpen(false); }}>
            <p>Allows reordering and adding songs while the show is locked. Logged in the changelog like an unlock.</p>
            <label className="grid gap-1"><span className="label">Reason</span><input id="unfreeze-why" className="inp" required value={why} onChange={(e) => setWhy(e.target.value)} autoFocus /></label>
            <div><button className="btn btn-primary" type="submit">Unfreeze</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------------- Build ----------------
function Build({ r }: { r: ShowRecord }) {
  const show = useWriter("show");
  const { ws } = useApp();
  const g = gates(r);
  const sl = activeSetlist(r);
  const cams = rosterCameras(r);
  const active = cams.filter((c) => c.slot.active);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [songSel, setSongSel] = useState<string | null>(null);
  const [cell, setCell] = useState<{ songId: string; cameraId: string } | null>(null);
  const [fill, setFill] = useState({ cameraId: "", tag: "ballad" as SongTag, shot: "" });
  const others = ws.list().filter((e) => e.showId !== r.showId).map((e) => ws.get(e.showId)).filter((s) => (s.show?.setlists ?? []).some((x) => x.songs.length));
  const tourmates = others.filter((s) => r.tourId && s.tourId === r.tourId);
  const preview = useMemo(() => (text.trim() ? parseSetlistText(text) : []), [text]);
  const missing = r.devices.filter((d) => d.class === "camera" && !r.show.cameraRoster.some((s) => s.cameraId === d.id)).length;
  const song = sl?.songs.find((s) => s.id === songSel);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={g.structural} onClick={() => setImporting(true)}>Import setlist</button>
        <button className="btn" disabled={g.structural} onClick={() => show((rec) => addSong(rec, "New song", sl?.songs.at(-1)?.id ?? null, newId), "show: add song")}>Add song</button>
        {missing > 0 && <button className="btn" disabled={g.readOnly} onClick={() => show((rec) => syncRoster(rec), "show: add cameras to roster")}>Add {missing} camera{missing > 1 ? "s" : ""} from Signal</button>}
      </div>

      <Panel title="Camera roster">
        {cams.length === 0 ? <Empty>No camera devices on this show. Add cameras in Signal Flow; they appear here as columns.</Empty> : (
          <div className="scroll-x">
            <table className="tbl text-[13px]">
              <thead><tr><th>Camera</th><th>Operated</th><th>Operator (role or name)</th><th>Position</th><th>Comms</th></tr></thead>
              <tbody>{cams.map(({ slot, device }) => (
                <tr key={slot.cameraId}>
                  <td className="font-mono">{device?.label ?? "removed"}</td>
                  <td><input type="checkbox" aria-label="Operated" disabled={g.readOnly} checked={slot.active} onChange={(e) => show((rec) => setRosterSlot(rec, slot.cameraId, { active: e.target.checked }), "show: roster")} /></td>
                  {(["operator", "position", "comms"] as const).map((k) => (
                    <td key={k}><Edit value={slot[k]} disabled={g.readOnly} onCommit={(v) => show((rec) => setRosterSlot(rec, slot.cameraId, { [k]: v }), `show: roster ${k}`)} /></td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Notes grid" actions={active.length > 0 && sl && sl.songs.length > 0 && (
        <form className="flex flex-wrap gap-1 items-center" onSubmit={(e) => { e.preventDefault(); if (fill.cameraId && fill.shot) show((rec) => fillColumn(rec, fill.cameraId, fill.tag, fill.shot, "videoDirector", newId), `show: fill ${fill.tag}s`); }}>
          <span className="label">Fill</span>
          <select className="inp text-xs" aria-label="Fill tag" value={fill.tag} onChange={(e) => setFill({ ...fill, tag: e.target.value as SongTag })}>{TAGS.map((t) => <option key={t}>{t}</option>)}</select>
          <select className="inp text-xs" aria-label="Fill camera" value={fill.cameraId} onChange={(e) => setFill({ ...fill, cameraId: e.target.value })}><option value="">camera…</option>{active.map((c) => <option key={c.slot.cameraId} value={c.slot.cameraId}>{c.device?.label}</option>)}</select>
          <input className="inp text-xs w-44" aria-label="Fill shot" placeholder="tight on vocal" value={fill.shot} onChange={(e) => setFill({ ...fill, shot: e.target.value })} />
          <button className="btn text-xs" type="submit" disabled={g.structural}>Fill</button>
        </form>
      )}>
        {!sl || sl.songs.length === 0 ? <Empty>No songs yet. Import the setlist from management: paste one title per line, with an optional "— 3:45" duration.</Empty> : (
          <div className="scroll-x">
            <table className="tbl text-[13px]">
              <thead><tr><th>#</th><th>Song</th><th>Cues</th>{active.map((c) => <th key={c.slot.cameraId}>{c.device?.label}<div className="normal-case font-body tracking-normal text-[11px]">{c.slot.operator || "no operator"}</div></th>)}</tr></thead>
              <tbody>
                {sl.songs.slice().sort((a, b) => a.order - b.order).map((s) => (
                  <tr key={s.id} className={`${s.skipped ? "opacity-50" : ""} ${songSel === s.id ? "bg-accent/5" : ""}`}>
                    <td className="font-mono text-dim">{s.order}</td>
                    <td className="min-w-[12rem]">
                      <button className="text-left font-medium hover:text-accent" onClick={() => setSongSel(s.id)}>{s.title}</button>
                      <div className="text-xs text-dim">{[s.tag, s.durationSec ? mmss(s.durationSec) : null, s.lookRef?.lookName && `look ${s.lookRef.lookName}`, s.isNew && "new"].filter(Boolean).join(" · ")}{s.flags.length > 0 && <span className="text-warn"> · {s.flags.map((f) => f.kind).join(", ")}</span>}</div>
                    </td>
                    <td className="text-xs max-w-[14rem]">{s.cues.slice(0, 2).map((c) => <div key={c.id} className="truncate"><span className="font-mono text-dim">{c.at}</span> {c.call}</div>)}{s.cues.length > 2 && <div className="text-dim">+{s.cues.length - 2} more</div>}</td>
                    {active.map((c) => {
                      const notes = s.cameraNotes.filter((n) => n.cameraId === c.slot.cameraId);
                      const lead = notes.find((n) => n.priority === "primary") ?? notes[0];
                      return (
                        <td key={c.slot.cameraId} className="min-w-[9rem] max-w-[14rem]">
                          <button disabled={g.readOnly} onClick={() => setCell({ songId: s.id, cameraId: c.slot.cameraId })}
                            className={`w-full text-left rounded-sm px-1 py-0.5 ${lead ? "" : "border border-dashed border-warn/50 text-warn/80 text-xs"}`}>
                            {lead ? <span className={`block truncate ${lead.priority === "primary" ? "font-semibold" : lead.priority === "safety" ? "text-dim" : ""}`}>{lead.shot}</span> : "no note"}
                            {notes.length > 1 && <span className="text-[11px] text-dim">+{notes.length - 1}</span>}
                            {notes.some((n) => n.pending) && <span className="text-[11px] text-accent ml-1">⚑ pending</span>}
                            {notes.some((n) => n.warning) && <span className="text-[11px] text-block ml-1">warning</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {r.show.unbound.length > 0 && (
        <Panel title="Unbound notes"><p className="text-dim text-[13px] mb-2">Carried over from another show whose camera label has no match here. Reassign by adding the camera, or delete.</p>
          <ul className="text-[13px] grid gap-1">{r.show.unbound.map((n) => <li key={n.id}><span className="font-mono">{n.cameraLabel}</span> · {n.songTitle}: {n.shot}</li>)}</ul></Panel>
      )}

      {(tourmates.length > 0 || others.length > 0) && !g.structural && (
        <Panel title="Copy from show">
          <div className="flex flex-wrap gap-2">{(tourmates.length ? tourmates : others).slice(0, 6).map((s) => (
            <button key={s.showId} className="btn" onClick={() => show((rec) => copySetlistFrom(s, rec, newId), `show: copy setlist from ${s.showCode}`)}>{s.showCode} · {activeSetlist(s)?.songs.length ?? 0} songs</button>
          ))}</div>
          <p className="text-xs text-dim mt-2">Notes re-bind by camera label (CAM 3 → CAM 3). Run history is not copied.</p>
        </Panel>
      )}

      {song && <SongEditor r={r} song={song} onClose={() => setSongSel(null)} />}
      {cell && <NoteEditor r={r} songId={cell.songId} cameraId={cell.cameraId} onClose={() => setCell(null)} onNext={(dir) => {
        if (!sl) return;
        const songs = sl.songs.slice().sort((a, b) => a.order - b.order);
        if (dir === "camera") { const i = active.findIndex((c) => c.slot.cameraId === cell.cameraId); const n = active[i + 1]; if (n) setCell({ ...cell, cameraId: n.slot.cameraId }); else setCell(null); }
        else { const i = songs.findIndex((s) => s.id === cell.songId); const n = songs[i + 1]; if (n) setCell({ ...cell, songId: n.id }); else setCell(null); }
      }} />}
      {importing && (
        <Modal wide title="Import setlist" onClose={() => setImporting(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1"><span className="label">Paste titles, one per line, or a CSV (title, duration, bpm, key, tag)</span>
              <textarea id="setlist-text" className="inp font-mono text-xs" rows={16} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Walk-on\nOpening Song — 3:45\nSecond Song — 4:10\n…"} /></label>
            <div className="min-w-0"><div className="label mb-1">{preview.length} songs</div>
              <ol className="text-[13px] grid gap-0.5 max-h-80 overflow-y-auto">{preview.map((p, i) => <li key={i}><span className="font-mono text-dim mr-2">{i + 1}</span>{p.title}<span className="text-dim"> {p.durationSec ? mmss(p.durationSec) : ""} {p.tag ?? ""}</span></li>)}</ol></div>
          </div>
          <p className="text-xs text-dim mt-2">Titles that match earlier shows on this tour bring their notes and cues with them; others are marked new.</p>
          <button className="btn btn-primary mt-3" disabled={!preview.length} onClick={() => { if (show((rec) => importSetlist(rec, preview, newId, { source: "import", previous: others }), `show: import ${preview.length} songs`)) { setImporting(false); setText(""); } }}>Import {preview.length} songs</button>
        </Modal>
      )}
    </div>
  );
}

function SongEditor({ r, song, onClose }: { r: ShowRecord; song: Song; onClose(): void }) {
  const show = useWriter("show");
  const g = gates(r);
  const sl = activeSetlist(r)!;
  const up = (patch: Partial<Song>, why: string) => show((rec) => updateSong(rec, song.id, patch), `show: ${song.title} ${why}`);
  const [cue, setCue] = useState({ at: "", call: "" });
  const [flag, setFlag] = useState<{ kind: Flag["kind"]; at: string; note: string }>({ kind: "pyro", at: "", note: "" });
  const sc = sl.setChanges.find((x) => x.afterSongId === song.id);
  const [copyTo, setCopyTo] = useState("");
  return (
    <Modal wide title={song.title} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="grid gap-1 sm:col-span-2"><span className="label">Title</span><Edit value={song.title} disabled={g.structural} onCommit={(v) => up({ title: v }, "title")} /></label>
          <label className="grid gap-1"><span className="label">Duration</span><Edit value={song.durationSec ? mmss(song.durationSec) : ""} disabled={g.structural} placeholder="3:45" onCommit={(v) => up({ durationSec: parseDur(v) }, "duration")} /></label>
          <label className="grid gap-1"><span className="label">BPM</span><Edit type="number" value={song.bpm ?? ""} disabled={g.structural} onCommit={(v) => up({ bpm: v ? Number(v) : undefined }, "bpm")} /></label>
          <label className="grid gap-1"><span className="label">Key</span><Edit value={song.key ?? ""} disabled={g.structural} onCommit={(v) => up({ key: v || undefined }, "key")} /></label>
          <label className="grid gap-1"><span className="label">Tag</span><select className="inp" disabled={g.structural} value={song.tag ?? ""} onChange={(e) => up({ tag: (e.target.value || undefined) as SongTag }, "tag")}><option value="">—</option>{TAGS.map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1"><span className="label">Server look</span>
            <div className="flex gap-2">
              <select className="inp" aria-label="Server" disabled={g.structural} value={song.lookRef?.serverId ?? ""} onChange={(e) => up({ lookRef: e.target.value ? { serverId: e.target.value, lookName: song.lookRef?.lookName ?? "" } : undefined }, "server")}>
                <option value="">no server</option>{r.servers.hosts.map((h) => <option key={h.id} value={h.id}>{r.devices.find((d) => d.id === h.deviceId)?.label ?? h.id} ({h.role})</option>)}</select>
              <Edit className="flex-1" value={song.lookRef?.lookName ?? ""} disabled={g.structural || !song.lookRef} placeholder="Look 4" onCommit={(v) => up({ lookRef: { serverId: song.lookRef!.serverId, lookName: v } }, "look")} />
            </div></label>
          <label className="grid gap-1"><span className="label">Director note</span><Edit value={song.directorNote ?? ""} disabled={g.structural} onCommit={(v) => up({ directorNote: v || undefined }, "director note")} /></label>
        </div>
        <div><div className="label mb-1">Wall state</div>
          <div className="grid gap-1">{r.led.walls.map((w) => {
            const cur = song.wallState?.find((x) => x.wallId === w.id);
            return <label key={w.id} className="flex gap-2 items-center"><span className="w-28">{w.name}</span>
              <Edit className="flex-1" value={cur?.note ?? ""} placeholder="live IMAG / black / content" disabled={g.structural} onCommit={(v) => up({ wallState: [...(song.wallState ?? []).filter((x) => x.wallId !== w.id), ...(v ? [{ wallId: w.id, note: v }] : [])] }, `${w.name} state`)} /></label>;
          })}{r.led.walls.length === 0 && <span className="text-dim text-[13px]">No LED walls.</span>}</div></div>

        <div><div className="label mb-1">Cues</div>
          <table className="tbl text-[13px]"><thead><tr><th>At</th><th>Call</th><th>Kind</th><th>Hook</th><th /></tr></thead>
            <tbody>{song.cues.slice().sort((a, b) => a.order - b.order).map((c) => (
              <tr key={c.id}>
                <td><Edit className="w-24" value={c.at} disabled={g.structural} onCommit={(v) => show((rec) => updateCue(rec, song.id, c.id, { at: v }), "show: cue time")} /></td>
                <td><Edit className="w-full" value={c.call} disabled={g.structural} onCommit={(v) => show((rec) => updateCue(rec, song.id, c.id, { call: v }), "show: cue call")} /></td>
                <td><select className="inp" disabled={g.structural} value={c.kind} onChange={(e) => show((rec) => updateCue(rec, song.id, c.id, { kind: e.target.value as CueKind }), "show: cue kind")}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
                <td><select className="inp text-xs" disabled={g.structural} aria-label="Device hook" value={c.action ? `${c.action.type}|${c.action.ref}` : ""} onChange={(e) => { const [type, ref] = e.target.value.split("|"); show((rec) => updateCue(rec, song.id, c.id, { action: type ? { type: type as "record-start", ref } : undefined, target: ref || undefined }), "show: cue hook"); }}>
                  <option value="">none</option>
                  {r.devices.filter((d) => d.class === "recorder").flatMap((d) => [<option key={d.id + "s"} value={`record-start|${d.id}`}>record start · {d.label}</option>, <option key={d.id + "e"} value={`record-stop|${d.id}`}>record stop · {d.label}</option>])}
                  {r.servers.hosts.map((h) => <option key={h.id} value={`look|${h.id}`}>look · {r.devices.find((d) => d.id === h.deviceId)?.label}</option>)}
                  {r.led.walls.map((w) => <option key={w.id} value={`blackout|${w.id}`}>blackout · {w.name}</option>)}
                </select></td>
                <td><button className="btn text-xs" disabled={g.structural} onClick={() => show((rec) => removeCue(rec, song.id, c.id), "show: remove cue")}>Remove</button></td>
              </tr>
            ))}</tbody></table>
          <form className="flex flex-wrap gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); if (cue.call && show((rec) => addCue(rec, song.id, cue, newId), "show: add cue")) setCue({ at: "", call: "" }); }}>
            <input className="inp w-28" aria-label="Cue at" placeholder="verse 2" value={cue.at} onChange={(e) => setCue({ ...cue, at: e.target.value })} />
            <input className="inp flex-1 min-w-[12rem]" aria-label="Cue call" placeholder="server to Look 4 on chorus" value={cue.call} onChange={(e) => setCue({ ...cue, call: e.target.value })} />
            <button className="btn" type="submit" disabled={g.structural}>Add cue</button>
          </form></div>

        <div className="grid gap-4 md:grid-cols-2">
          <div><div className="label mb-1">Flags</div>
            <ul className="text-[13px] mb-2">{song.flags.map((f, i) => <li key={i}><b className="text-warn">{f.kind}</b> {f.at && <span className="font-mono">{f.at}</span>} {f.note}</li>)}</ul>
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (show((rec) => addFlag(rec, song.id, { kind: flag.kind, at: flag.at || undefined, note: flag.note }), "show: add flag")) setFlag({ ...flag, at: "", note: "" }); }}>
              <select className="inp" aria-label="Flag kind" value={flag.kind} onChange={(e) => setFlag({ ...flag, kind: e.target.value as Flag["kind"] })}>{FLAGS.map((k) => <option key={k}>{k}</option>)}</select>
              <input className="inp w-20" aria-label="Flag at" placeholder="3:10" value={flag.at} onChange={(e) => setFlag({ ...flag, at: e.target.value })} />
              <input className="inp flex-1" aria-label="Flag note" placeholder="SL, stay off the apron" value={flag.note} onChange={(e) => setFlag({ ...flag, note: e.target.value })} />
              <button className="btn" type="submit" disabled={g.structural}>Add</button>
            </form></div>
          <div><div className="label mb-1">Set change after this song</div>
            <div className="flex gap-2"><Edit className="w-24" value={sc ? mmss(sc.durationSec) : ""} placeholder="1:30" disabled={g.structural} onCommit={(v) => show((rec) => setSetChange(rec, song.id, { durationSec: parseDur(v) ?? 0 }), "show: set change")} />
              <Edit className="flex-1" value={sc?.notes ?? ""} placeholder="drum riser roll, CAM 4 to SR deck" disabled={g.structural} onCommit={(v) => show((rec) => setSetChange(rec, song.id, { notes: v }), "show: set change notes")} /></div></div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button className="btn" disabled={g.structural} onClick={() => show((rec) => moveSong(rec, song.id, -1), "show: move song up")}>Move up</button>
          <button className="btn" disabled={g.structural} onClick={() => show((rec) => moveSong(rec, song.id, 1), "show: move song down")}>Move down</button>
          <button className="btn" disabled={g.structural} onClick={() => show((rec) => addSong(rec, "New song", song.id, newId), "show: insert song")}>Insert song after</button>
          <select className="inp" aria-label="Copy notes to" value={copyTo} onChange={(e) => setCopyTo(e.target.value)}><option value="">Copy notes to…</option>{sl.songs.filter((s) => s.id !== song.id).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
          <button className="btn" disabled={g.structural || !copyTo} onClick={() => show((rec) => copySongNotes(rec, song.id, copyTo, "videoDirector", newId), "show: copy notes")}>Copy</button>
          <button className="btn ml-auto" disabled={g.structural} onClick={() => { if (show((rec) => removeSong(rec, song.id), `show: remove ${song.title}`)) onClose(); }}>Remove song</button>
        </div>
      </div>
    </Modal>
  );
}

function NoteEditor({ r, songId, cameraId, onClose, onNext }: { r: ShowRecord; songId: string; cameraId: string; onClose(): void; onNext(dir: "camera" | "song"): void }) {
  const show = useWriter("show");
  const g = gates(r);
  const song = activeSetlist(r)?.songs.find((s) => s.id === songId);
  const notes = song?.cameraNotes.filter((n) => n.cameraId === cameraId) ?? [];
  const primary = notes.find((n) => n.priority === "primary");
  const [f, setF] = useState<Partial<CameraNote> & { shot: string }>(() => ({ shot: primary?.shot ?? "", priority: "primary", move: primary?.move, timing: primary?.timing, warning: primary?.warning, lens: primary?.lens }));
  useEffect(() => setF({ shot: primary?.shot ?? "", priority: "primary", move: primary?.move, timing: primary?.timing, warning: primary?.warning, lens: primary?.lens }), [songId, cameraId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!song) return null;
  const save = (dir?: "camera" | "song") => {
    if (f.shot.trim()) show((rec) => setNote(rec, songId, cameraId, f, "videoDirector", r.meta.status === "locked" ? "show" : "build", newId), `show: ${cameraLabel(r, cameraId)} · ${song.title}`, { quiet: true });
    if (dir) onNext(dir); else onClose();
  };
  return (
    <Modal title={`${cameraLabel(r, cameraId)} · ${song.title}`} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save("song"); }}
        onKeyDown={(e) => { if (e.key === "Tab" && !e.shiftKey && (e.target as HTMLElement).id === "note-shot") { e.preventDefault(); save("camera"); } }}>
        <label className="grid gap-1"><span className="label">Shot · Tab = next camera, Enter = next song</span>
          <input id="note-shot" className="inp text-base" autoFocus disabled={g.readOnly} value={f.shot} onChange={(e) => setF({ ...f, shot: e.target.value })} placeholder="tight on guitar, hold through solo" /></label>
        <div className="grid gap-2 sm:grid-cols-4">
          <select className="inp" aria-label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as CameraNote["priority"] })}><option>primary</option><option>cover</option><option>safety</option></select>
          <select className="inp" aria-label="Move" value={f.move ?? ""} onChange={(e) => setF({ ...f, move: (e.target.value || undefined) as CameraNote["move"] })}><option value="">move…</option>{["static", "push", "pull", "pan", "track", "handheld"].map((m) => <option key={m}>{m}</option>)}</select>
          <input className="inp" aria-label="Timing" placeholder="from verse 2" value={f.timing ?? ""} onChange={(e) => setF({ ...f, timing: e.target.value })} />
          <input className="inp" aria-label="Lens" placeholder="lens" value={f.lens ?? ""} onChange={(e) => setF({ ...f, lens: e.target.value })} />
        </div>
        <input className="inp" aria-label="Warning" placeholder="Warning, e.g. pyro SL at 3:10, stay off the apron" value={f.warning ?? ""} onChange={(e) => setF({ ...f, warning: e.target.value })} />
        <div className="flex gap-2"><button className="btn btn-primary" type="submit" disabled={g.readOnly}>Save · next song</button><button type="button" className="btn" onClick={() => save()}>Save</button></div>
        {notes.length > 0 && (
          <ul className="text-[13px] grid gap-1 border-t border-line pt-2">{notes.map((n) => (
            <li key={n.id} className="flex flex-wrap gap-2 items-baseline">
              <span className="font-mono text-xs text-dim w-14">{n.priority}</span><span className="flex-1">{n.shot}{n.pending && <span className="text-accent text-xs ml-1">⚑ from {n.authored.by}</span>}</span>
              {n.pending && <button type="button" className="btn text-xs" onClick={() => show((rec) => acceptOperatorNote(rec, songId, n.id), "show: accept operator note")}>Accept</button>}
              <button type="button" className="btn text-xs" disabled={g.readOnly} onClick={() => show((rec) => removeNote(rec, songId, n.id), "show: remove note")}>Remove</button>
            </li>
          ))}</ul>
        )}
      </form>
    </Modal>
  );
}

// ---------------- Director (rehearsal / show) ----------------
function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const t = setInterval(() => setNow(new Date().toISOString()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Director({ r }: { r: ShowRecord }) {
  const show = useWriter("show");
  const g = gates(r);
  const [run, setRun] = useState<RunId>(r.meta.status === "locked" ? "show" : "rehearsal-1");
  const [input, setInput] = useState<null | { kind: "note"; cam: number } | { kind: "cue" } | { kind: "flag" }>(null);
  const [text, setText] = useState("");
  const now = useNow();
  const sl = activeSetlist(r);
  const songs = (sl?.songs ?? []).slice().sort((a, b) => a.order - b.order);
  const st = runState(r, run);
  const cur = songs.find((s) => s.id === st.songId) ?? null;
  const nextS = cur ? songs.find((s) => s.order > cur.order && !s.skipped) : songs.find((s) => !s.skipped);
  const active = rosterCameras(r).filter((c) => c.slot.active);
  const cues = cur ? cur.cues.slice().sort((a, b) => a.order - b.order) : [];
  const nextIdx = cues.findIndex((c) => c.id === st.nextCueId);
  const at = () => new Date().toISOString();
  const during = run === "show" ? "show" : "rehearsal";
  const can = !g.readOnly;
  const recordLive = useMemo(() => {
    let live = false;
    for (const e of r.show.runLog) if (e.run === run && e.event === "cue" && e.status === "hit" && e.cueId) {
      const c = songs.flatMap((s) => s.cues).find((x) => x.id === e.cueId);
      if (c?.action?.type === "record-start") live = true; if (c?.action?.type === "record-stop") live = false;
    }
    return live;
  }, [r.show.runLog, run, songs]);

  useEffect(() => {
    if (!can) return;
    const onKey = (e: KeyboardEvent) => {
      if (input || (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT" || e.metaKey || e.ctrlKey) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "n") { e.preventDefault(); show((rec) => (runState(rec, run).songId ? nextSong(rec, run, "videoDirector", at()) : startSong(rec, run, nextS?.id ?? songs[0]?.id, "videoDirector", at())), "", { quiet: true }); }
      else if (k === "ArrowLeft" || k === "b") { e.preventDefault(); show((rec) => prevSong(rec, run, "videoDirector", at()), "", { quiet: true }); }
      else if (cur && st.nextCueId && (k === "h" || k === "m" || k === "x")) show((rec) => setCueStatus(rec, run, cur.id, st.nextCueId!, k === "h" ? "hit" : k === "m" ? "missed" : "cut", "videoDirector", at()), "", { quiet: true });
      else if (cur && /^[1-9]$/.test(k) && active[Number(k) - 1]) { e.preventDefault(); setInput({ kind: "note", cam: Number(k) - 1 }); setText(""); }
      else if (cur && k === "c") { e.preventDefault(); setInput({ kind: "cue" }); setText(""); }
      else if (cur && k === "f") { e.preventDefault(); setInput({ kind: "flag" }); setText(""); }
      else if (k === " ") { e.preventDefault(); show((rec) => holdToggle(rec, run, "videoDirector", at()), "", { quiet: true }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const submit = () => {
    if (!cur || !input || !text.trim()) { setInput(null); return; }
    if (input.kind === "note") { const cam = active[input.cam]; show((rec) => setNote(rec, cur.id, cam.slot.cameraId, { shot: text, priority: "primary" }, "videoDirector", during, newId), `show: note ${cam.device?.label}`); }
    if (input.kind === "cue") show((rec) => quickCue(rec, run, cur.id, text, "videoDirector", at(), newId), "show: quick cue");
    if (input.kind === "flag") show((rec) => quickFlag(rec, run, cur.id, text.trim().split(/\s+/)[0] as Flag["kind"], "videoDirector", at()), "show: flag");
    setInput(null); setText("");
  };
  const elapsed = st.startedAt ? st.elapsedSec(now) : 0;
  const over = cur?.durationSec && elapsed > cur.durationSec;

  if (!sl || !songs.length) return <Empty>No setlist yet. Import one in Build.</Empty>;
  return (
    <div className="stage rounded-sm border border-line p-4 grid gap-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select aria-label="Run" className="inp" value={run} onChange={(e) => setRun(e.target.value as RunId)}>{RUNS.map((x) => <option key={x}>{x}</option>)}</select>
        <button className="btn" disabled={!can} onClick={() => show((rec) => prevSong(rec, run, "videoDirector", at()), "", { quiet: true })}>◀ Back</button>
        <button className="btn btn-primary" disabled={!can} onClick={() => show((rec) => (runState(rec, run).songId ? nextSong(rec, run, "videoDirector", at()) : startSong(rec, run, nextS?.id ?? songs[0].id, "videoDirector", at())), "", { quiet: true })}>{cur ? "Next ▶" : "Start ▶"}</button>
        <button className="btn" disabled={!can || !cur} onClick={() => show((rec) => holdToggle(rec, run, "videoDirector", at()), "", { quiet: true })}>{st.held ? "Resume" : "Hold"}</button>
        <button className="btn" disabled={!can || !nextS} onClick={() => nextS && show((rec) => skipSong(rec, run, nextS.id, "videoDirector", at()), `show: skip ${nextS.title}`)}>Skip next song</button>
        <span className="text-xs text-dim ml-auto">Keys: → next · ← back · h/m/x cue · 1–9 note to camera · c cue · f flag · space hold</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          <div className="label">Now{st.held && <span className="text-warn ml-2">HOLD</span>}</div>
          <div className="font-display text-5xl font-bold uppercase leading-none tracking-wide">{cur?.title ?? "—"}</div>
          <div className={`font-mono text-2xl mt-1 ${over ? "text-warn" : ""}`}>{mmss(elapsed)} <span className="text-dim text-lg">/ {mmss(cur?.durationSec)}</span></div>
          {cur?.directorNote && <div className="mt-1 text-dim">{cur.directorNote}</div>}
          {cur && cur.flags.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{cur.flags.map((f, i) => <span key={i} className="bg-block/20 text-block border border-block/50 px-2 rounded-sm text-sm font-semibold uppercase">{f.kind} {f.at} {f.note}</span>)}</div>}
          <ol className="mt-4 grid gap-1">
            {cues.map((c, i) => {
              const isNext = c.id === st.nextCueId;
              const hidden = nextIdx >= 0 && (i < nextIdx - 1 || i > nextIdx + 2);
              if (hidden) return null;
              return (
                <li key={c.id} className={`flex gap-3 items-baseline px-2 py-1 rounded-sm ${isNext ? "bg-accent/20 border border-accent text-lg" : c.status ? "opacity-50" : ""}`}>
                  <span className="font-mono w-20 shrink-0">{c.at}</span><span className="flex-1">{c.call}</span>
                  <span className="text-xs text-dim">{c.kind}</span>{c.status && <span className={`font-mono text-xs ${c.status === "hit" ? "text-ok" : "text-block"}`}>{c.status}</span>}
                </li>
              );
            })}
            {cur && cues.length === 0 && <li className="text-dim">No cues for this song. Press c to add one.</li>}
          </ol>
        </div>
        <div className="grid gap-3 content-start">
          <div className="border border-line rounded-sm p-3">
            <div className="label">Look · walls · record</div>
            <div>{cur?.lookRef ? `${r.devices.find((d) => d.id === r.servers.hosts.find((h) => h.id === cur.lookRef!.serverId)?.deviceId)?.label ?? "server"} → ${cur.lookRef.lookName}` : "no look"}</div>
            {cur?.wallState?.map((w) => <div key={w.wallId} className="text-[13px]">{r.led.walls.find((x) => x.id === w.wallId)?.name}: {w.note}</div>)}
            <div className={`mt-1 font-mono text-sm ${recordLive ? "text-block" : "text-dim"}`}>{recordLive ? "● RECORDING" : "record idle"}</div>
          </div>
          <div className="border border-line rounded-sm p-3">
            <div className="label">Next</div>
            <div className="font-display text-2xl uppercase">{nextS?.title ?? "end of set"}</div>
            {nextS?.cues[0] && <div className="text-[13px]"><span className="font-mono text-dim">{nextS.cues[0].at}</span> {nextS.cues[0].call}</div>}
          </div>
        </div>
      </div>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {active.map((c, i) => {
          const notes = cur?.cameraNotes.filter((n) => n.cameraId === c.slot.cameraId) ?? [];
          const p = notes.find((n) => n.priority === "primary") ?? notes[0];
          return (
            <button key={c.slot.cameraId} disabled={!can || !cur} onClick={() => { setInput({ kind: "note", cam: i }); setText(p?.shot ?? ""); }} className="text-left border border-line rounded-sm p-2 bg-raised min-w-0">
              <div className="flex justify-between"><span className="font-display text-lg">{c.device?.label}</span><span className="font-mono text-dim text-xs">{i + 1}</span></div>
              <div className="text-xs text-dim truncate">{c.slot.operator || "no operator"}</div>
              <div className={`text-[13px] mt-1 ${p ? "" : "text-warn"}`}>{p?.shot ?? "no note"}</div>
              {notes.some((n) => n.pending) && <div className="text-xs text-accent">⚑ operator note</div>}
            </button>
          );
        })}
      </div>
      {input && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <span className="label self-center">{input.kind === "note" ? `Note to ${active[input.cam]?.device?.label}` : input.kind === "cue" ? `Cue at ${mmss(elapsed)}` : `Flag at ${mmss(elapsed)} (one word: ${FLAGS.join(", ")})`}</span>
          <input id="run-input" className="inp flex-1 text-base" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setInput(null)} />
          <button className="btn btn-primary" type="submit">Enter</button>
        </form>
      )}
      <p className="text-xs text-dim">Every change saves to this browser immediately. Operators on other phones see it only once a shared sync backend exists. Until then, use the Operator tab or the printed camera cards.</p>
    </div>
  );
}

// ---------------- Operator ----------------
function Operator({ r }: { r: ShowRecord }) {
  const mobile = useWriter("mobile");
  const cams = rosterCameras(r).filter((c) => c.slot.active);
  const [cam, setCam] = useState(cams[0]?.slot.cameraId ?? "");
  const [run, setRun] = useState<RunId>(r.meta.status === "locked" ? "show" : "rehearsal-1");
  const [flagText, setFlagText] = useState("");
  const [all, setAll] = useState(false);
  const sl = activeSetlist(r);
  const songs = (sl?.songs ?? []).slice().sort((a, b) => a.order - b.order);
  const st = runState(r, run);
  const cur = songs.find((s) => s.id === st.songId) ?? songs[0];
  const next = cur ? songs.find((s) => s.order > cur.order && !s.skipped) : undefined;
  const slot = cams.find((c) => c.slot.cameraId === cam);
  if (!cams.length) return <Empty>No operated cameras in the roster.</Empty>;
  const mine = (s?: Song) => (s?.cameraNotes ?? []).filter((n) => n.cameraId === cam).sort((a, b) => ["primary", "cover", "safety"].indexOf(a.priority) - ["primary", "cover", "safety"].indexOf(b.priority));
  const remaining = cur ? cur.cues.filter((c) => !c.status).length : 0;
  return (
    <div className="stage rounded-sm border border-line p-4 max-w-md grid gap-3">
      <div className="flex gap-2">
        <select aria-label="Camera" className="inp flex-1" value={cam} onChange={(e) => setCam(e.target.value)}>{cams.map((c) => <option key={c.slot.cameraId} value={c.slot.cameraId}>{c.device?.label} · {c.slot.operator || "no operator"}</option>)}</select>
        <select aria-label="Run" className="inp" value={run} onChange={(e) => setRun(e.target.value as RunId)}>{RUNS.map((x) => <option key={x}>{x}</option>)}</select>
      </div>
      <div className="flex justify-between items-baseline"><span className="font-display text-4xl font-bold">{slot?.device?.label}</span><span className="text-dim">{slot?.slot.position}</span></div>
      <div className="label">{st.songId ? "Now" : "First up"} · {remaining} cues left</div>
      <div className="font-display text-3xl uppercase leading-tight">{cur?.title}</div>
      {mine(cur).map((n) => (
        <div key={n.id} className="grid gap-1">
          {n.warning && <div className="bg-block text-bg font-semibold px-3 py-2 rounded-sm">{n.warning}</div>}
          <div className={`text-2xl leading-snug ${n.priority === "primary" ? "font-semibold" : n.priority === "safety" ? "text-dim" : ""} ${n.previous ? "flash" : ""}`}>{n.shot}</div>
          {n.previous && <div className="text-sm text-dim line-through">{n.previous}</div>}
          <div className="text-xs text-dim">{[n.priority, n.move, n.timing, n.lens].filter(Boolean).join(" · ")}{n.pending && " · ⚑ awaiting director"}</div>
        </div>
      ))}
      {mine(cur).length === 0 && <div className="text-warn text-xl">No note for this song.</div>}
      {next && <div className="border-t border-line pt-2"><div className="label">Next · {next.title}</div><div className="text-[15px]">{mine(next)[0]?.shot ?? "no note"}</div></div>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (cur && flagText.trim() && mobile((rec) => operatorFlagNote(rec, cur.id, cam, flagText, slot?.slot.operator || slot?.device?.label || "operator", newId), "⚑ sent to director")) setFlagText(""); }}>
        <input id="op-flag" className="inp flex-1" placeholder="⚑ Can't see drums from here on this one" value={flagText} onChange={(e) => setFlagText(e.target.value)} disabled={r.meta.source === "example" || r.meta.status === "archived"} />
        <button className="btn btn-primary" type="submit">⚑</button>
      </form>
      <button className="btn" onClick={() => setAll(!all)}>{all ? "Hide" : "Show"} full setlist</button>
      {all && <ol className="grid gap-1 text-[14px]">{songs.map((s) => <li key={s.id} className={s.id === cur?.id ? "text-accent" : s.skipped ? "line-through text-dim" : ""}><span className="font-mono text-dim mr-2">{s.order}</span>{s.title}<div className="text-dim text-[13px] pl-6">{mine(s)[0]?.shot ?? "—"}</div></li>)}</ol>}
    </div>
  );
}

// ---------------- Review ----------------
function Review({ r, onOpen }: { r: ShowRecord; onOpen(): void }) {
  const show = useWriter("show");
  const [run, setRun] = useState<RunId>("rehearsal-1");
  const [exp, setExp] = useState<string | null>(null);
  const sl = activeSetlist(r);
  const rv = rehearsalReview(r, run);
  const title = (id: string) => sl?.songs.find((s) => s.id === id)?.title ?? id;
  const cueCall = (sid: string, cid: string) => sl?.songs.find((s) => s.id === sid)?.cues.find((c) => c.id === cid)?.call ?? cid;
  const ran = r.show.runLog.some((e) => e.run === run);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select aria-label="Run" className="inp" value={run} onChange={(e) => setRun(e.target.value as RunId)}>{RUNS.map((x) => <option key={x}>{x}</option>)}</select>
        <button className="btn btn-primary" disabled={gates(r).structural || !ran} onClick={() => show((rec) => acceptReview(rec), `show: accept ${run} review`)}>Accept review (save v{(sl?.version ?? 0) + 1}, clear statuses)</button>
        <button className="btn" onClick={() => setExp("x")}>Exports</button>
      </div>
      {!ran ? <Empty>No {run} logged yet. Run it from the Director tab.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Cues missed or cut">
            {[...rv.missed.map((x) => ({ ...x, s: "missed" })), ...rv.cut.map((x) => ({ ...x, s: "cut" }))].map((x, i) => <div key={i} className="text-[13px]"><span className="text-block font-mono mr-2">{x.s}</span>{title(x.songId)}: {cueCall(x.songId, x.cueId)}</div>)}
            {rv.missed.length + rv.cut.length === 0 && <Empty>All cues hit.</Empty>}
          </Panel>
          <Panel title="Durations, measured vs typed">
            <table className="tbl text-[13px]"><thead><tr><th>Song</th><th>Typed</th><th>Measured</th></tr></thead>
              <tbody>{rv.durations.filter((d) => d.measured !== undefined).map((d) => (
                <tr key={d.songId}><td>{title(d.songId)}</td><td className="font-mono">{mmss(d.typed)}</td><td className={`font-mono ${d.typed && d.measured && Math.abs(d.measured - d.typed) > 15 ? "text-warn" : ""}`}>{mmss(d.measured)}</td></tr>
              ))}</tbody></table>
          </Panel>
          <Panel title="Songs with no primary note">{rv.songsWithoutPrimary.length ? <ul className="text-[13px]">{rv.songsWithoutPrimary.map((id) => <li key={id}><button className="underline text-accent" onClick={onOpen}>{title(id)}</button></li>)}</ul> : <Empty>Every song has a primary shot.</Empty>}</Panel>
          <Panel title="Notes on cameras not operated">{rv.inactiveCameraNotes.length ? <ul className="text-[13px]">{rv.inactiveCameraNotes.map((x) => <li key={x.noteId}>{title(x.songId)}</li>)}</ul> : <Empty>None.</Empty>}</Panel>
        </div>
      )}
      {exp && <ExportList r={r} onClose={() => setExp(null)} />}
    </div>
  );
}

function ExportList({ r, onClose }: { r: ShowRecord; onClose(): void }) {
  const [sel, setSel] = useState<string | null>(null);
  const ex = showModule.exports;
  const cur = ex.find((e) => e.key === sel);
  return (
    <Modal wide title="Show Book exports" onClose={onClose}>
      <div className="flex flex-wrap gap-2 mb-3">{ex.map((e) => <button key={e.key} className={`btn ${sel === e.key ? "border-accent text-accent" : ""}`} onClick={() => setSel(e.key)}>{e.label}</button>)}</div>
      {cur ? <CopyText text={cur.render(r)} rows={22} /> : <p className="text-dim">Pick an export. Downloads are blocked in this viewer, so each opens as text to copy.</p>}
    </Modal>
  );
}
