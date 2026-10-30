import { useState } from "react";
import { LIBRARY, instantiate } from "../../library/library";
import { addRack, autoRack, firstFreeRu, placeDevice, unplaceDevice } from "../../modules/rack";
import { newId } from "../../store/ids";
import type { Rack, ShowRecord } from "../../store/types";
import { CheckCard, Empty, fmt, PageHead, Panel } from "../kit";
import { useRecord, useWriter, isFrozen } from "../state";

const U = 18;

export function RackView() {
  const r = useRecord()!;
  const rack = useWriter("rack");
  const frozen = isFrozen(r);
  const unracked = r.devices.filter((d) => d.ru > 0 && !d.rackId);
  const checks = r.binder.checks.filter((c) => !c.resolved && c.module === "rack");
  const [pdu, setPdu] = useState("tpl_surgex_sx1120");
  const rackTemplates = LIBRARY.templates.filter((t) => ["rackPdu", "ups", "shelf", "patchPanel"].includes(t.class));

  return (
    <div className="grid gap-4">
      <PageHead title="Rack Build" sub="Places every device with rack units, rolls up weight and load, and owns PDUs, UPS, shelves and rack panels."
        actions={<>
          <button className="btn btn-primary" disabled={frozen || !unracked.length} onClick={() => rack((rec) => autoRack(rec), "rack: auto-place devices")}>Auto-place {unracked.length || ""}</button>
          <button className="btn" disabled={frozen} onClick={() => rack((rec) => addRack(rec, `VIDEO ${rec.racks.length + 1}`, newId), "rack: add rack")}>Add rack</button>
        </>} />
      <div className="flex gap-4 overflow-x-auto pb-2">
        {r.racks.length === 0 ? <Empty>No racks. Add one or apply the show profile.</Empty> : r.racks.map((k) => <Elevation key={k.id} r={r} k={k} frozen={frozen} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Unracked devices">
          {unracked.length === 0 ? <Empty>Every device with rack units is placed.</Empty> : (
            <table className="tbl text-[13px]"><thead><tr><th>Device</th><th className="text-right">RU</th><th>Place in</th></tr></thead>
              <tbody>{unracked.map((d) => (
                <tr key={d.id}><td>{d.label} <span className="text-dim">{d.make} {d.model}</span></td><td className="text-right font-mono">{d.ru}</td>
                  <td className="flex flex-wrap gap-1">{r.racks.map((k) => {
                    const ru = firstFreeRu(r, k.id, d.ru);
                    return <button key={k.id} className="btn text-xs" disabled={frozen || ru == null} onClick={() => rack((rec) => placeDevice(rec, d.id, k.id, firstFreeRu(rec, k.id, d.ru)!), `rack: place ${d.label} in ${k.name}`)}>{k.name}{ru != null ? ` @${ru}` : " full"}</button>;
                  })}</td></tr>
              ))}</tbody></table>
          )}
        </Panel>
        <Panel title="Add rack hardware" actions={<>
          <select className="inp" value={pdu} onChange={(e) => setPdu(e.target.value)} aria-label="Template">{rackTemplates.map((t) => <option key={t.templateId} value={t.templateId}>{t.class} · {t.make} {t.model}</option>)}</select>
          <button className="btn" disabled={frozen} onClick={() => {
            const t = LIBRARY.templates.find((x) => x.templateId === pdu)!;
            const n = r.devices.filter((d) => d.class === t.class).length + 1;
            const prefix = t.class === "rackPdu" ? "PDU" : t.class === "ups" ? "UPS" : t.class === "shelf" ? "SHELF" : "PANEL";
            rack([{ op: "add", path: "/devices/-", value: instantiate(t, `${prefix}-${n}`, newId) }], `rack: add ${t.model}`);
          }}>Add</button>
        </>}>
          {checks.length === 0 ? <Empty>No open rack checks.</Empty> : <div className="grid gap-2">{checks.map((c) => <CheckCard key={c.id} c={c} />)}</div>}
        </Panel>
      </div>
    </div>
  );
}

function Elevation({ r, k, frozen }: { r: ShowRecord; k: Rack; frozen: boolean }) {
  const rack = useWriter("rack");
  const roll = r.derived.racks.byRack[k.id];
  const H = k.ruTotal * U;
  return (
    <section className="bg-raised border border-line rounded-sm shrink-0 w-[19rem]">
      <header className="px-3 py-2 border-b border-line">
        <div className="font-display text-xl uppercase tracking-wider">{k.name}</div>
        <div className="font-mono text-xs text-dim">{roll ? `${roll.ruUsed}/${k.ruTotal} RU · ${fmt(roll.weightLb)} lb · ${fmt(roll.powerW)} W · ${fmt(roll.amps, 1)} A` : `${k.ruTotal} RU`} · {k.power.inlet}</div>
      </header>
      <div className="p-3">
        <svg width="100%" viewBox={`0 0 260 ${H + 2}`} role="img" aria-label={`${k.name} elevation`}>
          {Array.from({ length: k.ruTotal }).map((_, i) => (
            <g key={i}><rect x={22} y={i * U + 1} width={236} height={U} fill="rgb(var(--panel))" stroke="rgb(var(--line))" strokeWidth={0.5} />
              <text x={2} y={i * U + 13} fontSize={9} fill="rgb(var(--dim))" fontFamily="IBM Plex Mono, monospace">{i + 1}</text></g>
          ))}
          {k.slots.map((s) => {
            const d = r.devices.find((x) => x.id === s.deviceId);
            if (!d) return null;
            const h = Math.max(1, d.ru) * U;
            return (
              <g key={s.deviceId}>
                <rect x={24} y={(s.ru - 1) * U + 2} width={232} height={h - 2} rx={2} fill="rgb(var(--accent) / 0.16)" stroke="rgb(var(--accent))" strokeWidth={1} />
                <text x={30} y={(s.ru - 1) * U + 14} fontSize={11} fill="rgb(var(--ink))" fontFamily="IBM Plex Sans, sans-serif">{d.label} · {d.model}</text>
                {d.ru > 1 && <text x={30} y={(s.ru - 1) * U + 27} fontSize={9} fill="rgb(var(--dim))" fontFamily="IBM Plex Mono, monospace">{d.ru}RU · {d.powerW} W</text>}
              </g>
            );
          })}
        </svg>
        <ul className="mt-2 grid gap-0.5 text-xs">
          {k.slots.map((s) => {
            const d = r.devices.find((x) => x.id === s.deviceId);
            return d && <li key={s.deviceId} className="flex justify-between"><span>RU {s.ru} · {d.label}</span>
              <button className="text-accent underline disabled:opacity-40" disabled={frozen} onClick={() => rack((rec) => unplaceDevice(rec, d.id), `rack: unrack ${d.label}`)}>unrack</button></li>;
          })}
        </ul>
      </div>
    </section>
  );
}
