import { useMemo, useState } from "react";
import { LIBRARY } from "../../library/library";
import { addWall, autoCircuits, autoProcessors, autoSplitRuns, setCanvas, sizeWall } from "../../modules/led";
import { newId } from "../../store/ids";
import type { ShowRecord, Wall } from "../../store/types";
import { CheckCard, Edit, Empty, fmt, PageHead, Panel, Stat } from "../kit";
import { useApp, useRecord, useWriter, isFrozen } from "../state";

export const RUN_COLORS = ["#e08a1e", "#2f8fcf", "#3aa65a", "#c2416b", "#8b6fd6", "#c9a227", "#1fa3a3", "#d0603a"];

export function LedView() {
  const r = useRecord()!;
  const led = useWriter("led");
  const { go } = useApp();
  const [sel, setSel] = useState<string | null>(r.led.walls[0]?.id ?? null);
  const [layer, setLayer] = useState<"data" | "power">("data");
  const frozen = isFrozen(r);
  const wall = r.led.walls.find((w) => w.id === sel) ?? r.led.walls[0];
  const tiles = useMemo(() => LIBRARY.templates.filter((t) => t.class === "tile"), []);
  const checks = r.binder.checks.filter((c) => !c.resolved && c.module === "led");
  const ledDevices = r.devices.filter((d) => ["processor", "distro", "ledPdu"].includes(d.class));

  return (
    <div className="grid gap-4">
      <PageHead title="LED Map & Power" sub="Owns walls, processors, distros and LED data and power cables. Publishes the canvas every other module sizes to."
        actions={<>
          <button className="btn" disabled={frozen} onClick={() => led((rec) => addWall(rec, { name: nextWallName(rec), templateId: "tpl_roe_cb5", cols: 10, rows: 6, position: "US", rigging: "flown", trimHeight_ft: 30 }, newId), "led: add wall")}>Add wall</button>
          <button className="btn" disabled={frozen || !r.led.walls.length} onClick={() => led((rec) => setCanvas(rec), "led: lay out canvas")}>Lay out canvas</button>
          <button className="btn" disabled={!r.led.walls.length} onClick={() => go("pixelpatch")} title="Map tiles to XD ports by hand on the tile map">Pixel &amp; Patch</button>
        </>} />
      {r.led.walls.length === 0 ? <Empty>No LED walls on this show. Add a wall, or run setup step 3.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
          <div className="grid gap-2 content-start">
            {r.led.walls.map((w) => {
              const d = r.derived.led.perWall[w.id];
              return (
                <button key={w.id} onClick={() => setSel(w.id)} className={`text-left border rounded-sm px-3 py-2 bg-raised ${wall?.id === w.id ? "border-accent" : "border-line"}`}>
                  <div className="font-display uppercase tracking-wider text-lg leading-tight">{w.name}</div>
                  <div className="font-mono text-xs text-dim">{w.tileModel} · {w.cols}×{w.rows} · {d ? `${fmt(d.w_px)}×${fmt(d.h_px)} px` : "—"}</div>
                </button>
              );
            })}
            <Panel title="Totals">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Tiles" value={fmt(r.derived.led.totals.tiles)} />
                <Stat label="Max" value={fmt(r.derived.led.totals.maxW / 1000, 1)} unit="kW" />
                <Stat label="Avg" value={fmt(r.derived.led.totals.avgW / 1000, 1)} unit="kW" />
                <Stat label="Panel weight" value={fmt(r.derived.led.totals.weightLb)} unit="lb" />
                <Stat label="Canvas" value={`${fmt(r.led.canvas.w_px)}×${fmt(r.led.canvas.h_px)}`} />
                <Stat label="A / leg" value={fmt(r.derived.power.totalA_perLeg)} unit="A" />
              </div>
            </Panel>
          </div>
          {wall && <WallDetail r={r} wall={wall} frozen={frozen} layer={layer} setLayer={setLayer} tiles={tiles} />}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Processors, distros & PDUs">
          {ledDevices.length === 0 ? <Empty>None yet.</Empty> : (
            <table className="tbl text-[13px]"><thead><tr><th>Label</th><th>Class</th><th>Make / model</th><th className="text-right">W</th><th>Rack</th></tr></thead>
              <tbody>{ledDevices.map((d) => (
                <tr key={d.id}><td><Edit value={d.label} disabled={frozen} onCommit={(v) => led([{ op: "replace", path: `/devices/${d.id}/label`, value: v }], `led: rename ${d.label}`)} /></td>
                  <td>{d.class}</td><td>{d.make} {d.model}{d.source === "approximate" && <span className="text-warn ml-1" title="approximate spec">≈</span>}</td>
                  <td className="text-right font-mono">{d.powerW}</td><td className="font-mono text-xs">{r.racks.find((k) => k.id === d.rackId)?.name ?? "—"}</td></tr>
              ))}</tbody></table>
          )}
        </Panel>
        <Panel title="LED checks">{checks.length === 0 ? <Empty>No open LED checks.</Empty> : <div className="grid gap-2">{checks.map((c) => <CheckCard key={c.id} c={c} />)}</div>}</Panel>
      </div>
    </div>
  );
}

export function nextWallName(r: ShowRecord): string {
  const names = ["US Wall", "IMAG L", "IMAG R", "SL Wall", "SR Wall", "DS Wall"];
  return names.find((n) => !r.led.walls.some((w) => w.name === n)) ?? `Wall ${r.led.walls.length + 1}`;
}

function WallDetail({ r, wall, frozen, layer, setLayer, tiles }: { r: ShowRecord; wall: Wall; frozen: boolean; layer: "data" | "power"; setLayer(l: "data" | "power"): void; tiles: typeof LIBRARY.templates }) {
  const led = useWriter("led");
  const d = r.derived.led.perWall[wall.id];
  const size = (patch: Record<string, unknown>, why: string) => led((rec) => sizeWall(rec, wall.id, patch), `led: ${wall.name} ${why}`);
  const maxTrim = r.event.rigging.maxTrim_ft;
  return (
    <Panel title={wall.name} actions={<>
      <button className="btn" disabled={frozen} onClick={() => led((rec) => autoProcessors(rec, wall.id, newId), `led: processors for ${wall.name}`)}>Pick processors</button>
      <button className="btn" disabled={frozen} onClick={() => led((rec) => autoSplitRuns(rec, wall.id, newId), `led: split data runs on ${wall.name}`)}>Split data runs</button>
      <button className="btn" disabled={frozen} onClick={() => led((rec) => autoCircuits(rec, wall.id, newId), `led: circuits for ${wall.name}`)}>Assign circuits</button>
      <button className="btn" disabled={frozen} onClick={() => led([{ op: "remove", path: `/led/walls/${wall.id}` }], `led: remove ${wall.name}`, { cascade: true })}>Remove wall</button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
        <label className="grid gap-1"><span className="label">Name</span><Edit value={wall.name} disabled={frozen} onCommit={(v) => led([{ op: "replace", path: `/led/walls/${wall.id}/name`, value: v }], "led: rename wall")} /></label>
        <label className="grid gap-1 sm:col-span-2"><span className="label">Tile</span>
          <select className="inp" disabled={frozen} value={wall.templateId ?? ""} onChange={(e) => size({ templateId: e.target.value }, "tile model")}>
            <option value="">{wall.tileModel}</option>{tiles.map((t) => <option key={t.templateId} value={t.templateId}>{t.make} {t.model}</option>)}</select></label>
        <label className="grid gap-1"><span className="label">Cols</span><Edit type="number" value={wall.cols} disabled={frozen} onCommit={(v) => size({ cols: Number(v) }, "cols")} /></label>
        <label className="grid gap-1"><span className="label">Rows</span><Edit type="number" value={wall.rows} disabled={frozen} onCommit={(v) => size({ rows: Number(v) }, "rows")} /></label>
        <label className="grid gap-1"><span className="label">Trim ft</span><Edit type="number" value={wall.trimHeight_ft} disabled={frozen} onCommit={(v) => size({ trimHeight_ft: Number(v) }, "trim")} />
          {maxTrim.value != null && <span className={`text-xs ${wall.trimHeight_ft > (maxTrim.value as number) ? "text-warn" : "text-dim"}`}>venue max {maxTrim.value} ft ({maxTrim.state})</span>}</label>
      </div>
      {d && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
          <Stat label="Tiles" value={fmt(d.tiles)} />
          <Stat label="Pixels" value={`${fmt(d.w_px)}×${fmt(d.h_px)}`} />
          <Stat label="Size" value={`${fmt(d.w_ft, 1)}×${fmt(d.h_ft, 1)}`} unit="ft" />
          <Stat label="Max / avg" value={`${fmt(d.maxW / 1000, 1)} / ${fmt(d.avgW / 1000, 1)}`} unit="kW" approx={d.approximate} />
          <Stat label="Weight" value={fmt(d.weightLb)} unit="lb" approx={d.approximate} />
          <Stat label="Data ports" value={fmt(d.portsNeeded)} />
        </div>
      )}
      <div className="flex gap-2 mb-2" role="tablist">
        {(["data", "power"] as const).map((l) => <button key={l} role="tab" aria-selected={layer === l} className={`btn ${layer === l ? "border-accent text-accent" : ""}`} onClick={() => setLayer(l)}>{l === "data" ? "Data runs" : "Circuits"}</button>)}
      </div>
      <TileMap wall={wall} layer={layer} r={r} />
      <WallStates r={r} wallId={wall.id} />
    </Panel>
  );
}

function TileMap({ wall, layer, r }: { wall: Wall; layer: "data" | "power"; r: ShowRecord }) {
  const cell = Math.max(8, Math.min(28, Math.floor(720 / Math.max(1, wall.cols))));
  const px = r.derived.led.perWall[wall.id];
  const aspect = px && px.w_px && wall.cols && wall.rows ? (px.h_px / wall.rows) / (px.w_px / wall.cols) : (wall.tileH_mm || 500) / (wall.tileW_mm || 500);
  const ch = cell * aspect;
  const owner = new Map<string, number>();
  // Redundant (backup) runs cover the same tiles as their primaries, so the map colours primaries only.
  const groups = layer === "data" ? wall.dataRuns.map((d) => (d.redundant ? [] : d.tileChain)) : wall.power.circuits.map((c) => c.tiles);
  groups.forEach((g, i) => g.forEach(([c, rw]) => owner.set(`${c},${rw}`, i)));
  const W = wall.cols * cell, H = wall.rows * ch;
  if (!wall.cols || !wall.rows) return <Empty>Size the wall to see its tiles.</Empty>;
  const portName = (pid: string) => { for (const d of r.devices) { const p = d.ports.find((x) => x.id === pid); if (p) return `${d.label} ${p.name}`; } return "unassigned"; };
  return (
    <div className="grid gap-2">
      <div className="scroll-x border border-line rounded-sm bg-panel p-2">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${wall.name} tile map, ${layer}`}>
          {Array.from({ length: wall.rows }).flatMap((_, rw) => Array.from({ length: wall.cols }).map((__, c) => {
            const g = owner.get(`${c},${rw}`);
            return <rect key={`${c}-${rw}`} x={c * cell + 0.5} y={rw * ch + 0.5} width={cell - 1} height={ch - 1}
              fill={g === undefined ? "rgb(var(--line))" : RUN_COLORS[g % RUN_COLORS.length]} opacity={g === undefined ? 0.6 : 0.85} />;
          }))}
        </svg>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {layer === "data" ? wall.dataRuns.map((d, i) => (
          <li key={i} className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={d.redundant ? { border: "1px dashed rgb(var(--dim))" } : { background: RUN_COLORS[i % RUN_COLORS.length] }} />run {i + 1} · {d.tileChain.length} tiles · {portName(d.portId)}{d.redundant && " · redundant"}</li>
        )) : wall.power.circuits.map((c, i) => {
          const load = r.derived.power.byCircuit[c.id];
          return <li key={c.id} className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }} />{c.amps} A · {c.tiles.length} tiles{load && <span className={load.pct > 0.8 ? "text-block" : ""}> · {Math.round(load.pct * 100)}%</span>}</li>;
        })}
        {(layer === "data" ? wall.dataRuns : wall.power.circuits).length === 0 && <li className="text-dim">None yet — use {layer === "data" ? "Split data runs" : "Assign circuits"}.</li>}
      </ul>
    </div>
  );
}

/** Per-song wall state from the Show Book, so a wall sent to black is readable here too. */
export function WallStates({ r, wallId }: { r: ShowRecord; wallId: string }) {
  const sl = r.show.setlists.find((x) => x.id === r.show.activeSetlistId);
  const rows = (sl?.songs ?? []).map((s) => ({ s, w: s.wallState?.find((x) => x.wallId === wallId) })).filter((x) => x.w).sort((a, b) => a.s.order - b.s.order);
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <div className="label mb-1">Show Book · wall state by song</div>
      <ul className="text-xs grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">{rows.map(({ s, w }) => <li key={s.id}><span className="font-mono text-dim mr-1">{s.order}</span>{s.title}: <b>{w!.note}</b></li>)}</ul>
    </div>
  );
}
