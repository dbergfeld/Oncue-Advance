import { useState } from "react";
import { loadVenueMemory } from "../../setup/example";
import { getAt } from "../../store/pointer";
import type { ConfirmState, Confirmed, EventType, Patch, ShowRecord } from "../../store/types";
import { EVENT_TYPES } from "../../store/types";
import { ConfirmChip, Edit, fmt, PageHead, Panel } from "../kit";
import { useApp, useRecord, useWriter, isFrozen } from "../state";

type FieldType = "number" | "text" | "bool";
interface Sub { key: string; label: string; type: FieldType | string[] }
interface Q { q: string; path: string; kind: FieldType | "object" | "list"; fields?: Sub[]; uses: string }

const SECTIONS: { id: string; title: string; intro: string; qs: Q[] }[] = [
  { id: "access", title: "Venue access", intro: "Sets the earliest realistic start and the load-in labor count.", qs: [
    { q: "How many dock positions can video use, and when?", path: "/event/access/docks", kind: "object", fields: [{ key: "count", label: "Docks", type: "number" }, { key: "type", label: "Type", type: ["dock-high", "ground", "ramp", "unknown"] }, { key: "windowStart", label: "From", type: "text" }, { key: "windowEnd", label: "To", type: "text" }], uses: "Schedule (load-in) · Crew C4 · Prep truck order" },
    { q: "Push distance dock to stage", path: "/event/access/pushDistance_ft", kind: "number", uses: "Crew C4 · Rack (case size) · Prep" },
    { q: "Ramps, lifts or elevators on the push path", path: "/event/access/pathNotes", kind: "text", uses: "Crew C4 · Prep" },
    { q: "Elevator on the path?", path: "/event/access/elevator", kind: "object", fields: [{ key: "present", label: "Present", type: "bool" }, { key: "capacity_lb", label: "Capacity lb", type: "number" }, { key: "door_in", label: "Door in", type: "number" }], uses: "Rack Build (case vs door)" },
    { q: "Stage and wing clearance for video world and LED ground stacks", path: "/event/access/stageDims", kind: "object", fields: [{ key: "width_ft", label: "Width ft", type: "number" }, { key: "depth_ft", label: "Depth ft", type: "number" }, { key: "wingSL_ft", label: "SL wing ft", type: "number" }, { key: "wingSR_ft", label: "SR wing ft", type: "number" }], uses: "LED Map (ground stack) · Rack (video world)" },
    { q: "Where is video world and how far to stage, FOH and dimmer beach?", path: "/event/access/videoWorld", kind: "object", fields: [{ key: "location", label: "Location", type: "text" }, { key: "toStage_ft", label: "→ stage ft", type: "number" }, { key: "toFOH_ft", label: "→ FOH ft", type: "number" }, { key: "toDistro_ft", label: "→ distro ft", type: "number" }], uses: "Signal (cable lengths, SIG-017) · LED feeders · physical paths" },
    { q: "Truck and bus parking", path: "/event/access/truckParking", kind: "text", uses: "Prep · Crew" },
    { q: "Shore power for trucks and buses?", path: "/event/access/shorePower", kind: "bool", uses: "Prep · Crew" },
    { q: "Credentials, badging and escort rules", path: "/event/access/credentials", kind: "text", uses: "Crew C5 crew sheet" },
    { q: "Floor load limit", path: "/event/access/floorLoad_psf", kind: "number", uses: "LED (ground stack) · Rack" },
    { q: "Floor protection requirements", path: "/event/access/floorProtection", kind: "text", uses: "LED · Rack" },
    { q: "Forklift / scissor lift available, who operates", path: "/event/access/lifts", kind: "object", fields: [{ key: "forklift", label: "Forklift", type: "bool" }, { key: "scissor", label: "Scissor", type: "bool" }, { key: "operatorProvided", label: "Operator provided", type: "bool" }], uses: "LED build method · Crew C4" },
  ] },
  { id: "power", title: "Power", intro: "What exists, not what we want. Compared live with the derived demand.", qs: [
    { q: "Video power service: amps, phase, voltage, connector, tie-in location", path: "/event/power/services", kind: "list", fields: [{ key: "amps", label: "Amps", type: "number" }, { key: "phase", label: "Phase", type: ["3Ø", "1Ø"] }, { key: "volts", label: "Volts", type: "number" }, { key: "connector", label: "Connector", type: ["cam-lok", "tails", "L21-30", "other"] }, { key: "location", label: "Location", type: "text" }, { key: "toVideoWorld_ft", label: "→ VW ft", type: "number" }, { key: "toUpstage_ft", label: "→ US ft", type: "number" }], uses: "LED L3 distro + feeders · Rack inlet · Task A3" },
    { q: "Is the video service separate from lighting and audio?", path: "/event/power/dedicated", kind: "bool", uses: "LED (shared-neutral note)" },
    { q: "House electrician required for tie-in? Call rules", path: "/event/power/electrician", kind: "object", fields: [{ key: "required", label: "Required", type: "bool" }, { key: "name", label: "Name", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "callNotes", label: "Call notes", type: "text" }], uses: "Schedule (tie-in before LED trim) · Crew C4" },
    { q: "Generator required or available, who provides it?", path: "/event/power/generator", kind: "object", fields: [{ key: "required", label: "Required", type: "bool" }, { key: "provider", label: "Provider", type: "text" }, { key: "kva", label: "kVA", type: "number" }, { key: "location", label: "Location", type: "text" }], uses: "LED (avg W vs kVA) · Binder power" },
    { q: "Power limits or shutoff times", path: "/event/power/constraints", kind: "text", uses: "Schedule · Binder" },
    { q: "Grounding and isolation notes", path: "/event/power/groundingNotes", kind: "text", uses: "Rack (UPS suggestion)" },
  ] },
  { id: "rigging", title: "Trim and rigging", intro: "Decides whether each wall flies as designed, flies lower, or ground-stacks.", qs: [
    { q: "Maximum trim height to the bottom of the LED", path: "/event/rigging/maxTrim_ft", kind: "number", uses: "LED Map (LED-007) · Task A4" },
    { q: "Height to the steel", path: "/event/rigging/steelHeight_ft", kind: "number", uses: "Cable segments (overhead runs)" },
    { q: "Point capacity over the video positions (no plot)", path: "/event/rigging/pointCapacity_lb", kind: "number", uses: "LED Map (LED-008)" },
    { q: "Point spacing", path: "/event/rigging/spacing_ft", kind: "number", uses: "LED Map headers" },
    { q: "Rigging plot available? Format", path: "/event/rigging/plotFormat", kind: "text", uses: "Binder front-view and rigging" },
    { q: "House rigger required? Call rules", path: "/event/rigging/houseRigger", kind: "object", fields: [{ key: "required", label: "Required", type: "bool" }, { key: "name", label: "Name", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "callNotes", label: "Call notes", type: "text" }], uses: "Schedule (rig call) · Crew C4" },
    { q: "Who supplies chain motors and control?", path: "/event/rigging/motors", kind: "object", fields: [{ key: "provider", label: "Provider", type: ["tour", "venue", "vendor"] }, { key: "count", label: "Count", type: "number" }, { key: "capacity_lb", label: "Capacity lb", type: "number" }, { key: "control", label: "Control", type: "text" }], uses: "LED build method · Prep pull sheet" },
    { q: "Ground-support option", path: "/event/rigging/groundSupport", kind: "object", fields: [{ key: "allowed", label: "Allowed", type: "bool" }, { key: "maxStack_ft", label: "Max stack ft", type: "number" }, { key: "ballastNotes", label: "Ballast", type: "text" }], uses: "LED Map fallback" },
    { q: "Bridle, deck or truss restrictions", path: "/event/rigging/restrictions", kind: "text", uses: "Binder rigging" },
  ] },
  { id: "foh", title: "FOH and signal path", intro: "Fixes the measured runs that cable lengths and the fibre plan are built on.", qs: [
    { q: "FOH position: location, size, riser, distance to stage", path: "/event/foh", kind: "object", fields: [{ key: "location", label: "Location", type: "text" }, { key: "width_ft", label: "W ft", type: "number" }, { key: "depth_ft", label: "D ft", type: "number" }, { key: "riserHeight_ft", label: "Riser ft", type: "number" }, { key: "toStage_ft", label: "→ stage ft", type: "number" }], uses: "Signal placement · Binder FOH" },
    { q: "Cable path stage to FOH", path: "/event/signalPath/stageToFOH", kind: "object", fields: [{ key: "route", label: "Route", type: ["overhead", "trench", "floor", "house-fibre"] }, { key: "length_ft", label: "Length ft", type: "number" }, { key: "protection", label: "Protection", type: "text" }], uses: "SIG-017 length · fibre vs copper · Prep" },
    { q: "House fibre or copper between positions", path: "/event/signalPath/houseFibre", kind: "object", fields: [{ key: "available", label: "Available", type: "bool" }, { key: "strands", label: "Strands", type: "number" }, { key: "connector", label: "Connector", type: "text" }, { key: "testedDate", label: "Tested", type: "text" }], uses: "Signal trunk plan · Prep" },
    { q: "Camera positions", path: "/event/cameras/positions", kind: "list", fields: [{ key: "label", label: "Label", type: "text" }, { key: "location", label: "Location", type: "text" }, { key: "platform", label: "Platform", type: "bool" }, { key: "permitted", label: "Permitted", type: "bool" }, { key: "toVideoWorld_ft", label: "→ VW ft", type: "number" }], uses: "Signal S4 · CCU cable lengths · Binder camera plot" },
    { q: "Video village, if separate from video world", path: "/event/signalPath/videoVillage", kind: "object", fields: [{ key: "location", label: "Location", type: "text" }, { key: "toVideoWorld_ft", label: "→ VW ft", type: "number" }], uses: "Signal · Rack placement" },
    { q: "Comms and tally: house intercom, wireless restrictions", path: "/event/comms", kind: "object", fields: [{ key: "houseIntercom", label: "House intercom", type: "text" }, { key: "wirelessRestrictions", label: "Wireless", type: "text" }, { key: "frequencyCoordination", label: "Freq coord", type: "text" }], uses: "Signal comms layer · Binder" },
    { q: "House feeds required", path: "/event/signalPath/houseFeeds", kind: "list", fields: [{ key: "destination", label: "Destination", type: "text" }, { key: "format", label: "Format", type: "text" }, { key: "connector", label: "Connector", type: "text" }, { key: "location", label: "Location", type: "text" }], uses: "Signal outputs · Servers output count" },
    { q: "House LED / IMAG (fly-date)", path: "/event/houseVideo", kind: "text", uses: "Task A5" },
    { q: "Union breaks, meal and overtime rules", path: "/event/labor", kind: "object", fields: [{ key: "unionHouse", label: "Union house", type: "bool" }, { key: "breakRules", label: "Breaks", type: "text" }, { key: "mealRules", label: "Meals", type: "text" }, { key: "otAfter_h", label: "OT after h", type: "number" }], uses: "Crew C4 labor count" },
  ] },
];

const STATES: ConfirmState[] = ["unknown", "asked", "assumed", "confirmed", "waived"];

export function AdvanceView() {
  const r = useRecord()!;
  const { ws, showId, toast, focus } = useApp();
  const shell = useWriter("shell");
  const [sec, setSec] = useState(() => SECTIONS.find((s) => focus && s.qs.some((q) => focus.startsWith(q.path)))?.id ?? "identity");
  const frozen = isFrozen(r);
  const mem = ws.venue(r.event.venueId) ?? ws.venueList().find((v) => v.venueName && v.venueName === r.event.venueName && v.city === r.event.city);

  const counts = (qs: Q[]) => {
    const c: Record<ConfirmState, number> = { unknown: 0, asked: 0, assumed: 0, confirmed: 0, waived: 0 };
    qs.forEach((q) => { const leaf = getAt(r, q.path) as Confirmed<unknown> | undefined; if (leaf) c[leaf.state]++; });
    return c;
  };
  const all = counts(SECTIONS.flatMap((s) => s.qs));
  const current = SECTIONS.find((s) => s.id === sec);

  return (
    <div className="max-w-6xl">
      <PageHead title="Advance" sub={<span className="font-mono">{all.confirmed} confirmed · {all.assumed} assumed · {all.asked} waiting · {all.unknown} not asked</span>}
        actions={mem && <button className="btn" disabled={frozen} onClick={() => { const n = loadVenueMemory(ws, showId!); toast("ok", `Loaded ${n} remembered answers as assumed`); }}>Load from venue memory</button>} />
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <nav className="grid gap-1 content-start">
          <SectionTab id="identity" active={sec} onClick={setSec} title="Identity & order" note={r.event.venueName ? "set" : "empty"} />
          {SECTIONS.map((s) => { const c = counts(s.qs); return <SectionTab key={s.id} id={s.id} active={sec} onClick={setSec} title={s.title} note={`${c.confirmed}/${s.qs.length} confirmed`} />; })}
        </nav>
        <div className="grid gap-4 min-w-0">
          {sec === "identity" ? <Identity r={r} frozen={frozen} /> : current && (
            <>
              {current.id === "power" && <PowerCompare r={r} />}
              <Panel title={current.title}>
                <p className="text-dim mb-3">{current.intro}</p>
                <div className="grid gap-3">
                  {current.qs.map((q) => <Question key={q.path} q={q} r={r} frozen={frozen} highlight={focus === q.path}
                    onSave={(leaf) => shell(mirror(q.path, leaf), `advance: ${q.q.slice(0, 48)}`)} />)}
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** event.power.services also fills the convenience fields the seeded task chain reads (A3). */
function mirror(path: string, leaf: Confirmed<unknown>): Patch[] {
  const ops: Patch[] = [{ op: "replace", path, value: leaf }];
  if (path === "/event/power/services") {
    const ok = leaf.state === "confirmed" || leaf.state === "assumed";
    const svc = ok ? (leaf.value as { amps?: number; phase?: string; location?: string }[] | null)?.[0] : undefined;
    ops.push({ op: "replace", path: "/event/power/amps", value: svc?.amps ?? null });
    ops.push({ op: "replace", path: "/event/power/service", value: svc ? `${svc.phase ?? ""} ${svc.amps ?? ""}A`.trim() : "" });
    ops.push({ op: "replace", path: "/event/power/location", value: svc?.location ?? "" });
  }
  return ops;
}

function SectionTab({ id, active, onClick, title, note }: { id: string; active: string; onClick(id: string): void; title: string; note: string }) {
  return (
    <button onClick={() => onClick(id)} className={`text-left px-3 py-2 border rounded-sm ${active === id ? "border-accent bg-raised" : "border-line hover:bg-raised"}`}>
      <div className="font-display uppercase tracking-wider">{title}</div>
      <div className="text-xs text-dim font-mono">{note}</div>
    </button>
  );
}

function Identity({ r, frozen }: { r: ShowRecord; frozen: boolean }) {
  const shell = useWriter("shell");
  const set = (path: string, value: unknown, why: string) => shell([{ op: "replace", path, value }], `identity: ${why}`);
  const F = ({ label, path, v, type = "text" }: { label: string; path: string; v: string | number; type?: string }) => (
    <label className="grid gap-1 min-w-0"><span className="label">{label}</span>
      <Edit id={`id-${path}`} value={v} type={type} disabled={frozen} onCommit={(x) => set(path, type === "number" ? Number(x) : x, label)} /></label>
  );
  return (
    <Panel title="Identity & order">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <F label="Artist" path="/client/artist" v={r.client.artist} />
        <F label="Show name" path="/name" v={r.name} />
        <label className="grid gap-1"><span className="label">Event type</span>
          <select id="id-type" className="inp" disabled={frozen} value={r.event.type} onChange={(e) => set("/event/type", e.target.value as EventType, "event type")}>
            {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="grid gap-1"><span className="label">Show date(s), comma separated</span>
          <Edit id="id-dates" value={r.event.dates.join(", ")} disabled={frozen} onCommit={(x) => set("/event/dates", x.split(",").map((s) => s.trim()).filter(Boolean), "dates")} /></label>
        <F label="Venue" path="/event/venueName" v={r.event.venueName} />
        <F label="Room" path="/event/room" v={r.event.room} />
        <F label="City" path="/event/city" v={r.event.city} />
        <F label="State" path="/event/state" v={r.event.state} />
        <F label="Management" path="/client/management" v={r.client.management} />
        <F label="Production company" path="/client/productionCo" v={r.client.productionCo} />
        <F label="Vendor" path="/vendor/company" v={r.vendor.company} />
        <F label={`${r.vendor.orderSystem} order ref`} path="/vendor/orderRef" v={r.vendor.orderRef} />
        <F label="Show code (draft only)" path="/showCode" v={r.showCode} />
      </div>
    </Panel>
  );
}

function PowerCompare({ r }: { r: ShowRecord }) {
  const svc = r.event.power.services;
  const list = (svc.value ?? []) as { amps: number; phase: string; volts: number }[];
  const capW = list.reduce((s, x) => s + (x.amps || 0) * (x.volts || 208) * (x.phase === "3Ø" ? Math.sqrt(3) : 1), 0);
  const amps = list.reduce((s, x) => s + (x.amps || 0), 0);
  const perLeg = r.derived.power.totalA_perLeg;
  const pct = amps ? perLeg / amps : 0;
  const red = amps > 0 && pct > 0.8;
  return (
    <Panel title="Demand vs service" actions={<ConfirmChip s={svc.state} />}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><div className="label">Derived load</div><div className="font-mono text-lg">{fmt(r.derived.power.totalW / 1000, 1)} kW</div></div>
        <div><div className="label">Amps per leg</div><div className="font-mono text-lg">{fmt(perLeg, 0)} A</div></div>
        <div><div className="label">Service</div><div className="font-mono text-lg">{amps ? `${fmt(amps)} A · ${fmt(capW / 1000, 0)} kW` : "not set"}</div></div>
        <div><div className="label">Headroom</div><div className={`font-mono text-lg ${red ? "text-block" : "text-ok"}`}>{amps ? `${fmt(amps * 0.8 - perLeg, 0)} A to 80%` : "—"}</div></div>
      </div>
      {amps > 0 && (
        <div className="mt-3 h-3 bg-panel rounded-sm overflow-hidden relative" aria-label={`load is ${Math.round(pct * 100)}% of service`}>
          <div className={`h-full ${red ? "bg-block" : "bg-accent"}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
          <div className="absolute top-0 h-full border-l-2 border-ink/60" style={{ left: "80%" }} title="80% rule" />
        </div>
      )}
    </Panel>
  );
}

function Question({ q, r, frozen, onSave, highlight }: { q: Q; r: ShowRecord; frozen: boolean; onSave(l: Confirmed<unknown>): void; highlight: boolean }) {
  const leaf = (getAt(r, q.path) as Confirmed<unknown>) ?? { value: null, state: "unknown" };
  const save = (patch: Partial<Confirmed<unknown>>) => {
    const next = { ...leaf, ...patch };
    if (patch.state === "confirmed") { next.at = new Date().toISOString(); next.by = next.by || "shell"; next.source = next.source || "call"; }
    if (patch.state === "asked") next.askedAt = new Date().toISOString();
    onSave(next);
  };
  const setValue = (value: unknown) => save({ value, state: leaf.state === "unknown" || leaf.state === "asked" ? "assumed" : leaf.state });
  return (
    <div className={`grid gap-2 md:grid-cols-[1fr_auto] border-b border-line pb-3 ${highlight ? "bg-accent/5 ring-1 ring-accent" : ""}`}>
      <div className="min-w-0 grid gap-1.5">
        <div className="font-medium">{q.q}</div>
        <ValueEditor q={q} value={leaf.value} disabled={frozen || leaf.state === "waived"} onChange={setValue} />
        <div className="text-xs text-dim"><span className="label mr-1">Used by</span>{q.uses}{leaf.note && <> · <i>{leaf.note}</i></>}{leaf.askedAt && leaf.state === "asked" && <> · asked {Math.max(0, Math.round((Date.now() - Date.parse(leaf.askedAt)) / 864e5))} d ago</>}</div>
      </div>
      <div className="flex md:flex-col gap-2 items-start md:items-end">
        <ConfirmChip s={leaf.state} />
        <select aria-label="Confirmation state" className="inp text-xs" disabled={frozen} value={leaf.state} onChange={(e) => save({ state: e.target.value as ConfirmState })}>
          {STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
        {leaf.state === "confirmed" && (
          <select aria-label="Confirmed via" className="inp text-xs" disabled={frozen} value={leaf.source ?? "call"} onChange={(e) => save({ source: e.target.value as Confirmed<unknown>["source"] })}>
            {["email", "call", "tech-pack", "site-visit", "stage-plot", "venue-memory"].map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function SubInput({ f, v, disabled, onChange }: { f: Sub; v: unknown; disabled: boolean; onChange(x: unknown): void }) {
  if (Array.isArray(f.type)) return (
    <select className="inp" disabled={disabled} value={(v as string) ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={f.label}>
      <option value="">—</option>{f.type.map((o) => <option key={o}>{o}</option>)}</select>
  );
  if (f.type === "bool") return <input type="checkbox" aria-label={f.label} disabled={disabled} checked={!!v} onChange={(e) => onChange(e.target.checked)} />;
  return <Edit value={v as string | number} type={f.type === "number" ? "number" : "text"} disabled={disabled} className="w-full" onCommit={(x) => onChange(f.type === "number" ? (x === "" ? undefined : Number(x)) : x)} />;
}

function ValueEditor({ q, value, disabled, onChange }: { q: Q; value: unknown; disabled: boolean; onChange(v: unknown): void }) {
  if (q.kind === "bool") return (
    <div className="flex gap-3">{[true, false].map((b) => (
      <label key={String(b)} className="flex gap-1 items-center"><input type="radio" disabled={disabled} checked={value === b} onChange={() => onChange(b)} />{b ? "Yes" : "No"}</label>
    ))}</div>
  );
  if (q.kind === "number" || q.kind === "text") return <Edit value={value as string | number} type={q.kind === "number" ? "number" : "text"} disabled={disabled} className="w-full max-w-md" onCommit={(x) => onChange(q.kind === "number" ? (x === "" ? null : Number(x)) : x)} />;
  if (q.kind === "object") {
    const obj = (value ?? {}) as Record<string, unknown>;
    return (
      <div className="flex flex-wrap gap-2">
        {q.fields!.map((f) => (
          <label key={f.key} className="grid gap-0.5 min-w-[7rem] flex-1"><span className="text-[11px] text-dim">{f.label}</span>
            <SubInput f={f} v={obj[f.key]} disabled={disabled} onChange={(x) => onChange({ ...obj, [f.key]: x })} /></label>
        ))}
      </div>
    );
  }
  const list = ((value ?? []) as Record<string, unknown>[]);
  const prefix = q.path.includes("services") ? "svc" : q.path.includes("positions") ? "cam" : null;
  return (
    <div className="grid gap-2">
      <div className="scroll-x">
        <table className="tbl text-[13px]">
          <thead><tr>{q.fields!.map((f) => <th key={f.key}>{f.label}</th>)}<th /></tr></thead>
          <tbody>
            {list.map((row, i) => (
              <tr key={(row.id as string) ?? i}>
                {q.fields!.map((f) => <td key={f.key}><SubInput f={f} v={row[f.key]} disabled={disabled} onChange={(x) => onChange(list.map((r2, j) => (j === i ? { ...r2, [f.key]: x } : r2)))} /></td>)}
                <td><button className="btn" disabled={disabled} onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button className="btn" disabled={disabled} onClick={() => onChange([...list, prefix ? { id: `${prefix}_${Math.random().toString(36).slice(2, 14)}` } : {}])}>Add row</button></div>
    </div>
  );
}
