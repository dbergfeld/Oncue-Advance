import { useMemo, useState } from "react";
import { LIBRARY } from "../../library/library";
import { applyProfile, newShowFromWizard, review, setCrew, setSchedule, sizeWalls } from "../../setup/wizard";
import { PROFILES } from "../../store/profiles";
import { setupCompleted } from "../../store/readiness";
import { EVENT_TYPES, type EventType } from "../../store/types";
import { Modal } from "../kit";
import { useApp, useWorkspaceVersion } from "../state";

const STEPS = ["Identify", "Profile the system", "Size the walls", "Crew and contacts", "Schedule", "Review"];

export function Wizard() {
  const { ws, wizard, closeWizard, setShowId, go, toast } = useApp();
  useWorkspaceVersion();
  const [step, setStep] = useState(wizard.step);
  const [showId, setLocal] = useState<string | null>(wizard.showId);
  const r = showId && ws.has(showId) ? ws.get(showId) : null;
  const done = r ? setupCompleted(r) : ({} as Record<number, boolean>);
  const attempt = (fn: () => void, next: number) => {
    try { fn(); setStep(next); } catch (e) { toast("error", (e as Error).message); }
  };

  return (
    <Modal wide title={r ? `Setup · ${r.showCode}` : "New show"} onClose={closeWizard}>
      <ol className="flex flex-wrap gap-1 mb-4">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button disabled={!r && i > 0} onClick={() => setStep(i + 1)}
              className={`px-2 py-1 text-xs font-display uppercase tracking-wider border rounded-sm ${step === i + 1 ? "border-accent text-accent" : "border-line"} ${done[i + 1] ? "bg-ok/10" : ""}`}>
              {i + 1} · {s}{i >= 2 && i <= 4 && <span className="text-dim normal-case"> (optional)</span>}
            </button>
          </li>
        ))}
      </ol>
      {step === 1 && <Step1 initial={r} onDone={(id) => { setLocal(id); setShowId(id); setStep(2); }} />}
      {step === 2 && r && <Step2 type={r.event.type} onSubmit={(v) => attempt(() => applyProfile(ws, r.showId, v), 3)} onSkip={() => setStep(3)} />}
      {step === 3 && r && <Step3 showId={r.showId} onSubmit={(walls) => attempt(() => sizeWalls(ws, r.showId, walls, { pickProcessor: true }), 4)} onSkip={() => setStep(4)} />}
      {step === 4 && r && <Step4 showId={r.showId} onSubmit={(crew, contacts) => attempt(() => setCrew(ws, r.showId, crew, contacts), 5)} onSkip={() => setStep(5)} />}
      {step === 5 && r && (
        <div className="grid gap-3">
          <p>Seeds the {r.event.type} schedule template relative to {r.event.dates[0] ?? "the first show date"}. Every entry stays editable in Crew &amp; schedule, and task due dates move when these do.</p>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={!r.event.dates[0]} onClick={() => attempt(() => setSchedule(ws, r.showId, "template"), 6)}>Apply template</button>
            <button className="btn" onClick={() => setStep(6)}>Skip for now</button>
          </div>
        </div>
      )}
      {step === 6 && r && <Review showId={r.showId} onOpen={(v) => { closeWizard(); go(v); }} />}
    </Modal>
  );
}

function Step1({ initial, onDone }: { initial: ReturnType<typeof Object> | null; onDone(id: string): void }) {
  const { ws, toast } = useApp();
  const shows = ws.list();
  const [f, setF] = useState({ source: "blank" as "blank" | "template" | "example" | "copy", copyFrom: "", artist: "", name: "", type: "arena" as EventType, dates: "", venueName: "", city: "", state: "", room: "", orderRef: "" });
  if (initial) return <p className="text-dim">Identity is set. Edit it any time in Advance → Identity &amp; order.</p>;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      try {
        const id = newShowFromWizard(ws, { ...f, dates: f.dates.split(",").map((s) => s.trim()).filter(Boolean), copyFrom: f.copyFrom || undefined });
        onDone(id);
      } catch (err) { toast("error", (err as Error).message); }
    }}>
      <fieldset className="flex flex-wrap gap-3"><legend className="label mb-1">Start from</legend>
        {(["blank", "template", "example", "copy"] as const).map((s) => (
          <label key={s} className="flex gap-1 items-center"><input type="radio" name="src" checked={f.source === s} onChange={() => setF({ ...f, source: s })} />{s === "copy" ? "copy of a show" : s}</label>
        ))}
      </fieldset>
      {(f.source === "copy" || f.source === "template") && (
        <label className="grid gap-1"><span className="label">Source show</span>
          <select id="wz-copy" className="inp" value={f.copyFrom} onChange={set("copyFrom")} required>
            <option value="">Choose…</option>{shows.map((s) => <option key={s.showId} value={s.showId}>{s.showCode} · {s.name}</option>)}</select></label>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <L label="Artist"><input id="wz-artist" className="inp" value={f.artist} onChange={set("artist")} required /></L>
        <L label="Show name"><input id="wz-name" className="inp" value={f.name} onChange={set("name")} placeholder="Artist · Venue" required /></L>
        <L label="Event type"><select id="wz-type" className="inp" value={f.type} onChange={set("type")}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></L>
        <L label="Date(s), YYYY-MM-DD, comma separated"><input id="wz-dates" className="inp" value={f.dates} onChange={set("dates")} placeholder="2026-11-14" required /></L>
        <L label="Venue"><input id="wz-venue" className="inp" value={f.venueName} onChange={set("venueName")} required /></L>
        <L label="Room"><input id="wz-room" className="inp" value={f.room} onChange={set("room")} /></L>
        <L label="City"><input id="wz-city" className="inp" value={f.city} onChange={set("city")} required /></L>
        <L label="State"><input id="wz-state" className="inp" value={f.state} onChange={set("state")} /></L>
        <L label="RentalWorks order ref"><input id="wz-order" className="inp" value={f.orderRef} onChange={set("orderRef")} /></L>
      </div>
      <div><button className="btn btn-primary" type="submit">Create draft</button></div>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 min-w-0"><span className="label">{label}</span>{children}</label>;
}

function Step2({ type, onSubmit, onSkip }: { type: EventType; onSubmit(v: { walls: number; cameras: number; servers: 0 | 1 | 2; imag: boolean; record: boolean; redundantPgm: boolean }): void; onSkip(): void }) {
  const p = PROFILES[type];
  const [v, setV] = useState({ walls: p.walls.length, cameras: p.cameras, servers: p.servers, imag: p.walls.some((w) => /imag/i.test(w.name)), record: p.record !== "None", redundantPgm: p.redundancyExpected });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <p>The <b>{type}</b> profile: house {p.formats.house}, LED input {p.formats.ledInput}, racks {p.racks.join(", ")}, distro {p.distro}. A starting point; every value stays editable in its module.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <L label="LED walls (0–6)"><input id="wz-walls" className="inp" type="number" min={0} max={6} value={v.walls} onChange={(e) => setV({ ...v, walls: Number(e.target.value) })} /></L>
        <L label="Cameras (0–12)"><input id="wz-cams" className="inp" type="number" min={0} max={12} value={v.cameras} onChange={(e) => setV({ ...v, cameras: Number(e.target.value) })} /></L>
        <L label="Media servers"><select id="wz-srv" className="inp" value={v.servers} onChange={(e) => setV({ ...v, servers: Number(e.target.value) as 0 | 1 | 2 })}><option value={0}>None</option><option value={1}>One</option><option value={2}>A + B</option></select></L>
      </div>
      <div className="flex flex-wrap gap-4">
        {(["imag", "record", "redundantPgm"] as const).map((k) => (
          <label key={k} className="flex gap-1 items-center"><input type="checkbox" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{k === "imag" ? "IMAG" : k === "record" ? "Record" : "Redundant PGM path"}</label>
        ))}
      </div>
      <div className="flex gap-2"><button className="btn btn-primary" type="submit">Apply profile</button><button type="button" className="btn" onClick={onSkip}>Already applied</button></div>
    </form>
  );
}

function Step3({ showId, onSubmit, onSkip }: { showId: string; onSubmit(w: { wallId: string; templateId: string; cols: number; rows: number; position: string; rigging: "flown" | "ground" | "hybrid"; trimHeight_ft: number }[]): void; onSkip(): void }) {
  const { ws } = useApp();
  const r = ws.get(showId);
  const tiles = useMemo(() => LIBRARY.templates.filter((t) => t.class === "tile"), []);
  const profileTile = PROFILES[r.event.type].tileTemplate ?? "tpl_roe_cb5";
  const [rows, setRows] = useState(() => r.led.walls.map((w) => ({
    wallId: w.id, name: w.name, templateId: w.templateId ?? profileTile, cols: w.cols || 12, rows: w.rows || 6, position: w.position ?? (/imag/i.test(w.name) ? "SL" : "US"),
    rigging: w.rigging.type, trimHeight_ft: w.trimHeight_ft || 30,
  })));
  if (!rows.length) return <div className="grid gap-2"><p>No walls on this show. Add walls in LED Map &amp; Power, or continue.</p><div><button className="btn" onClick={onSkip}>Continue</button></div></div>;
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(rows); }}>
      <p className="text-dim">Processors, data runs, distro and circuits are picked for you from the tile count and the processor's port capacity. Then servers, racks and the program path are patched so the show opens buildable.</p>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Wall</th><th>Tile</th><th>Cols</th><th>Rows</th><th>Position</th><th>Rigging</th><th>Trim ft</th></tr></thead>
          <tbody>{rows.map((w, i) => {
            const up = (k: string, val: unknown) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
            return (
              <tr key={w.wallId}>
                <td className="font-medium">{w.name}</td>
                <td><select className="inp" value={w.templateId} onChange={(e) => up("templateId", e.target.value)} aria-label="Tile">{tiles.map((t) => <option key={t.templateId} value={t.templateId}>{t.make} {t.model}</option>)}</select></td>
                <td><input className="inp w-16" type="number" min={1} value={w.cols} onChange={(e) => up("cols", Number(e.target.value))} aria-label="Columns" /></td>
                <td><input className="inp w-16" type="number" min={1} value={w.rows} onChange={(e) => up("rows", Number(e.target.value))} aria-label="Rows" /></td>
                <td><select className="inp" value={w.position} onChange={(e) => up("position", e.target.value)} aria-label="Position">{["US", "SL", "SR", "DS", "FOH"].map((p) => <option key={p}>{p}</option>)}</select></td>
                <td><select className="inp" value={w.rigging} onChange={(e) => up("rigging", e.target.value)} aria-label="Rigging">{["flown", "ground", "hybrid"].map((p) => <option key={p}>{p}</option>)}</select></td>
                <td><input className="inp w-20" type="number" value={w.trimHeight_ft} onChange={(e) => up("trimHeight_ft", Number(e.target.value))} aria-label="Trim height" /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <div className="flex gap-2"><button className="btn btn-primary" type="submit">Size walls and build system</button><button type="button" className="btn" onClick={onSkip}>Skip for now</button></div>
    </form>
  );
}

const ROLES = [["videoDirector", "Video Director"], ["crewChief", "Crew Chief"], ["eic", "EIC"], ["ledLead", "LED Lead"], ["cameraLead", "Camera Lead"], ["serverOp", "Server Op"], ["pm", "Production Manager"]] as const;
function Step4({ showId, onSubmit, onSkip }: { showId: string; onSubmit(crew: Record<string, string>, contacts: { name: string; role: string; phone: string; email: string }[]): void; onSkip(): void }) {
  const { ws } = useApp();
  const r = ws.get(showId);
  const [crew, setCrewS] = useState<Record<string, string>>(() => Object.fromEntries(ROLES.map(([k]) => [k, (r.crew as unknown as Record<string, string>)[k] ?? ""])));
  const [venue, setVenue] = useState({ name: "", role: "Venue production manager", phone: "", email: "" });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(crew, venue.name ? [venue] : []); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map(([k, l]) => <L key={k} label={l}><input className="inp" value={crew[k]} placeholder="TBD" onChange={(e) => setCrewS({ ...crew, [k]: e.target.value })} /></L>)}
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-4"><legend className="label mb-1">Venue contact</legend>
        {(["name", "role", "phone", "email"] as const).map((k) => <input key={k} className="inp" placeholder={k} value={venue[k]} onChange={(e) => setVenue({ ...venue, [k]: e.target.value })} aria-label={`Venue contact ${k}`} />)}
      </fieldset>
      <p className="text-xs text-dim">Blank roles stay blank and raise the missing EIC / Crew Chief warning.</p>
      <div className="flex gap-2"><button className="btn btn-primary" type="submit">Save crew</button><button type="button" className="btn" onClick={onSkip}>Skip for now</button></div>
    </form>
  );
}

function Review({ showId, onOpen }: { showId: string; onOpen(v: "led" | "signal" | "binder" | "overview"): void }) {
  const { ws } = useApp();
  const r = ws.get(showId);
  const s = review(r) as unknown as Record<string, unknown>;
  const rd = r.derived.readiness;
  const open = r.binder.checks.filter((c) => !c.resolved);
  return (
    <div className="grid gap-3">
      <div className="grid sm:grid-cols-4 gap-3 font-mono">
        <div><div className="label">Walls</div>{r.led.walls.length}</div>
        <div><div className="label">Devices</div>{r.devices.length}</div>
        <div><div className="label">Cables</div>{r.cables.length}</div>
        <div><div className="label">Formats</div>{r.signal.formats.house || "—"} / {r.signal.formats.ledInput || "—"}</div>
      </div>
      <p className={rd.advance ? "text-ok" : "text-block"}>{rd.advance ? "Advance-ready: Issue advance is unlocked." : `Not ready: ${rd.criteria.filter((c) => !c.ok && c.blocks).map((c) => c.label).join("; ")}`}</p>
      <p className="text-[13px]">{open.filter((c) => c.severity === "block").length} blocking · {open.filter((c) => c.severity === "warn").length} warnings · {open.filter((c) => c.severity === "info").length} info{s && "routes" in s ? "" : ""}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => onOpen("led")}>Open LED Map</button>
        <button className="btn" onClick={() => onOpen("signal")}>Open Signal Flow</button>
        <button className="btn" onClick={() => onOpen("binder")}>Open Binder</button>
        <button className="btn btn-primary" onClick={() => onOpen("overview")}>Done</button>
      </div>
    </div>
  );
}
