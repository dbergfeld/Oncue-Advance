// Pixel & Patch — the LED section driven from the map instead of forms: drop XD boxes (A, B, C, D … with ports A1–A10) onto a
// wall's tile map, select a port, and paint tiles onto it. Every stroke is a data run; every dropped box lands on an SX40 10G out.
import { useMemo, useRef, useState } from "react";
import { LIBRARY } from "../../library/library";
import { portCapacity, wallGeometry } from "../../library/wall";
import {
  addWall, autoSplitRuns, clearPort, dropXd, ledLegs, moveXd, nextPatchLetter, paintTiles, patchBoxes, patchPorts, portPatchLabel, removeXd, setCanvas, sizeWall, xdOutPorts,
  type PaintMode,
} from "../../modules/led";
import { newId } from "../../store/ids";
import type { Device, PatchBox, ShowRecord, Wall } from "../../store/types";
import { CheckCard, Edit, Empty, fmt, PageHead, Panel, Stat } from "../kit";
import { useApp, useRecord, useWriter, isFrozen } from "../state";
import { nextWallName, RUN_COLORS, WallStates } from "./Led";

const XD_MIME = "application/x-oncue-xd";
const PAD = 10;
const PORTS = 10;
const BOX_LABEL_W = 36, BOX_PORT_W = 24, BOX_H = 46;
const BOX_W = BOX_LABEL_W + PORTS * BOX_PORT_W;
type Layer = "primary" | "backup";

const letterColor = (letter: string) => RUN_COLORS[Math.max(0, letter.charCodeAt(0) - 65) % RUN_COLORS.length];

export function PixelPatchView() {
  const r = useRecord()!;
  const led = useWriter("led");
  const [sel, setSel] = useState<string | null>(r.led.walls[0]?.id ?? null);
  const frozen = isFrozen(r);
  const wall = r.led.walls.find((w) => w.id === sel) ?? r.led.walls[0];
  const tiles = useMemo(() => LIBRARY.templates.filter((t) => t.class === "tile"), []);
  const checks = r.binder.checks.filter((c) => !c.resolved && c.module === "led");

  return (
    <div className="grid gap-4">
      <PageHead title="Pixel & Patch" sub="The LED map as a work surface: drop XD boxes on the tile map, pick a port (A1 … D10) and paint tiles onto it. Each stroke writes a data run; each box lands on an SX40 10G output, so the data flow draws itself."
        actions={<>
          <button className="btn" disabled={frozen} onClick={() => led((rec) => addWall(rec, { name: nextWallName(rec), templateId: "tpl_roe_cb5", cols: 10, rows: 6, position: "US", rigging: "flown", trimHeight_ft: 30 }, newId), "led: add wall")}>Add wall</button>
          <button className="btn" disabled={frozen || !r.led.walls.length} onClick={() => led((rec) => setCanvas(rec), "led: lay out canvas")}>Lay out canvas</button>
        </>} />
      {r.led.walls.length === 0 ? <Empty>No LED walls on this show. Add a wall, or run setup step 3.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
          <div className="grid gap-2 content-start">
            {r.led.walls.map((w) => {
              const d = r.derived.led.perWall[w.id];
              const boxes = patchBoxes(w);
              return (
                <button key={w.id} onClick={() => setSel(w.id)} className={`text-left border rounded-sm px-3 py-2 bg-raised ${wall?.id === w.id ? "border-accent" : "border-line"}`}>
                  <div className="font-display uppercase tracking-wider text-lg leading-tight">{w.name}</div>
                  <div className="font-mono text-xs text-dim">{w.tileModel} · {w.cols}×{w.rows} · {d ? `${fmt(d.w_px)}×${fmt(d.h_px)} px` : "—"}</div>
                  <div className="font-mono text-xs text-dim">{boxes.length ? `XD ${boxes.map((b) => b.letter).join(" ")}` : "no XD boxes"} · {w.dataRuns.filter((x) => !x.redundant).length} runs</div>
                </button>
              );
            })}
            <Panel title="Totals">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Tiles" value={fmt(r.derived.led.totals.tiles)} />
                <Stat label="Max" value={fmt(r.derived.led.totals.maxW / 1000, 1)} unit="kW" />
                <Stat label="Canvas" value={`${fmt(r.led.canvas.w_px)}×${fmt(r.led.canvas.h_px)}`} />
                <Stat label="XD boxes" value={fmt(r.led.walls.reduce((n, w) => n + patchBoxes(w).length, 0))} />
              </div>
            </Panel>
            <Panel title="How to map">
              <ol className="text-[13px] grid gap-1 list-decimal pl-5">
                <li>Drag the <b>XD box</b> chip onto the map (or press Place).</li>
                <li>Click a port on the box — <span className="font-mono">A1</span>, <span className="font-mono">A2</span> …</li>
                <li>Click or drag across tiles to chain them onto that port. Shift-drag to unpaint.</li>
                <li>Switch to <b>Backup</b> to paint redundant runs the same way.</li>
              </ol>
            </Panel>
          </div>
          {wall && <WallPatch key={wall.id} r={r} wall={wall} frozen={frozen} tiles={tiles} />}
        </div>
      )}
      <Panel title="LED checks">{checks.length === 0 ? <Empty>No open LED checks.</Empty> : <div className="grid gap-2 lg:grid-cols-2">{checks.map((c) => <CheckCard key={c.id} c={c} />)}</div>}</Panel>
    </div>
  );
}

function WallPatch({ r, wall, frozen, tiles }: { r: ShowRecord; wall: Wall; frozen: boolean; tiles: typeof LIBRARY.templates }) {
  const led = useWriter("led");
  const { toast } = useApp();
  const d = r.derived.led.perWall[wall.id];
  const [layer, setLayer] = useState<Layer>("primary");
  const [selPort, setSelPort] = useState<string | null>(null);
  const size = (patch: Record<string, unknown>, why: string) => led((rec) => sizeWall(rec, wall.id, patch), `led: ${wall.name} ${why}`);
  const ports = patchPorts(r, wall);
  const selected = ports.find((p) => p.port.id === selPort) ?? null;
  const g = wallGeometry(r, wall);
  const nextLetter = nextPatchLetter(wall);

  const place = (letter: string, at?: { x: number; y: number }) => led((rec) => dropXd(rec, wall.id, newId, { letter, ...at }), `led: drop XD ${letter} on ${wall.name}`);
  const snake = () => {
    const ops = autoSplitRuns(r, wall.id);
    if (!ops.length) { toast("error", `Not enough XD ports for ${wall.name}: it needs ${g.portsNeeded} and the boxes give ${ports.length}. Drop another box.`); return; }
    led(ops, `led: snake-map ${wall.name} onto its boxes`);
  };

  return (
    <Panel title={wall.name} actions={<>
      <button className="btn" disabled={frozen || !ports.length} onClick={snake} title="Fill the boxes' ports in column-snake order">Snake-map onto boxes</button>
      <button className="btn" disabled={frozen || !wall.dataRuns.length} onClick={() => led([{ op: "replace", path: `/led/walls/${wall.id}/dataRuns`, value: [] }], `led: clear ${wall.name} data runs`)}>Clear all runs</button>
      <button className="btn" disabled={frozen} onClick={() => led([{ op: "remove", path: `/led/walls/${wall.id}` }], `led: remove ${wall.name}`, { cascade: true })}>Remove wall</button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
        <label className="grid gap-1"><span className="label">Name</span><Edit value={wall.name} disabled={frozen} onCommit={(v) => led([{ op: "replace", path: `/led/walls/${wall.id}/name`, value: v }], "led: rename wall")} /></label>
        <label className="grid gap-1 sm:col-span-2"><span className="label">Tile</span>
          <select className="inp" disabled={frozen} value={wall.templateId ?? ""} onChange={(e) => size({ templateId: e.target.value }, "tile model")}>
            <option value="">{wall.tileModel}</option>{tiles.map((t) => <option key={t.templateId} value={t.templateId}>{t.make} {t.model}</option>)}</select></label>
        <label className="grid gap-1"><span className="label">Cols</span><Edit type="number" value={wall.cols} disabled={frozen} onCommit={(v) => size({ cols: Number(v) }, "cols")} /></label>
        <label className="grid gap-1"><span className="label">Rows</span><Edit type="number" value={wall.rows} disabled={frozen} onCommit={(v) => size({ rows: Number(v) }, "rows")} /></label>
        <label className="grid gap-1"><span className="label">Trim ft</span><Edit type="number" value={wall.trimHeight_ft} disabled={frozen} onCommit={(v) => size({ trimHeight_ft: Number(v) }, "trim")} /></label>
      </div>
      {d && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
          <Stat label="Tiles" value={fmt(d.tiles)} />
          <Stat label="Pixels" value={`${fmt(d.w_px)}×${fmt(d.h_px)}`} />
          <Stat label="Px / tile" value={fmt(g.tile.px_w * g.tile.px_h)} />
          <Stat label="Ports needed" value={fmt(d.portsNeeded)} />
          <Stat label="Ports on boxes" value={fmt(ports.length)} />
          <Stat label="Mapped" value={`${fmt(mappedTiles(wall, false))} / ${fmt(d.tiles)}`} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <span className="label">Layer</span>
        <div role="tablist" className="flex gap-2">
          {(["primary", "backup"] as Layer[]).map((l) => <button key={l} role="tab" aria-selected={layer === l} className={`btn ${layer === l ? "border-accent text-accent" : ""}`} onClick={() => setLayer(l)}>{l === "primary" ? "Primary runs" : "Backup runs"}</button>)}
        </div>
        <span className="label ml-2">Painting onto</span>
        <span className={`font-mono text-sm border rounded-sm px-2 leading-6 ${selected ? "border-accent text-accent" : "border-line text-dim"}`}>{selected ? `${selected.label} · ${selected.device.label} ${selected.port.name}` : "no port selected"}</span>
        <div className="ml-auto flex flex-wrap gap-2 items-center">
          <span className="label">Drop an XD box</span>
          <span draggable={!frozen} role="button" tabIndex={0} title={`Drag onto the map to add XD ${nextLetter}`}
            className={`font-mono text-sm border-2 border-dashed rounded-sm px-2 leading-7 select-none ${frozen ? "opacity-40" : "cursor-grab"}`} style={{ borderColor: letterColor(nextLetter) }}
            onDragStart={(e) => { e.dataTransfer.setData(XD_MIME, nextLetter); e.dataTransfer.effectAllowed = "copy"; }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); place(nextLetter); } }}>
            XD {nextLetter} · {nextLetter}1–{nextLetter}{PORTS}
          </span>
          <button className="btn" disabled={frozen} onClick={() => place(nextLetter)}>Place</button>
        </div>
      </div>
      <PatchMap r={r} wall={wall} frozen={frozen} layer={layer} selPort={selPort} setSelPort={setSelPort} onDrop={(letter, at) => place(letter, at)} />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] mt-4">
        <FlowStrip r={r} wall={wall} />
        <PortTable r={r} wall={wall} frozen={frozen} layer={layer} selPort={selPort} setSelPort={setSelPort} />
      </div>
      <WallStates r={r} wallId={wall.id} />
    </Panel>
  );
}

function mappedTiles(w: Wall, redundant: boolean): number {
  const s = new Set<string>();
  for (const run of w.dataRuns) if (run.redundant === redundant) for (const [c, rw] of run.tileChain) if (c >= 0 && rw >= 0 && c < w.cols && rw < w.rows) s.add(`${c},${rw}`);
  return s.size;
}

interface Stroke { mode: PaintMode; tiles: [number, number][]; keys: Set<string> }
interface BoxDrag { deviceId: string; dx: number; dy: number; x: number; y: number }

function PatchMap({ r, wall, frozen, layer, selPort, setSelPort, onDrop }: {
  r: ShowRecord; wall: Wall; frozen: boolean; layer: Layer; selPort: string | null; setSelPort(p: string | null): void; onDrop(letter: string, at: { x: number; y: number }): void;
}) {
  const led = useWriter("led");
  const { toast } = useApp();
  const svgRef = useRef<SVGSVGElement>(null);
  const [stroke, setStroke] = useState<Stroke | null>(null);
  const [drag, setDrag] = useState<BoxDrag | null>(null);
  const [over, setOver] = useState(false);
  const redundant = layer === "backup";

  const cell = Math.max(14, Math.min(32, Math.floor(760 / Math.max(1, wall.cols))));
  const px = r.derived.led.perWall[wall.id];
  const aspect = px && px.w_px && wall.cols && wall.rows ? (px.h_px / wall.rows) / (px.w_px / wall.cols) : (wall.tileH_mm || 500) / (wall.tileW_mm || 500);
  const ch = cell * aspect;
  const gridW = wall.cols * cell, gridH = wall.rows * ch;
  const boxes = patchBoxes(wall);
  const boxPx = (b: PatchBox) => (drag?.deviceId === b.deviceId ? { x: drag.x, y: drag.y } : { x: PAD + b.x * cell, y: PAD + b.y * ch });
  const W = Math.max(gridW + 2 * PAD, ...boxes.map((b) => boxPx(b).x + BOX_W + PAD), BOX_W + 2 * PAD);
  const H = Math.max(gridH + 2 * PAD + (boxes.length ? 0 : BOX_H + 24), ...boxes.map((b) => boxPx(b).y + BOX_H + 16 + PAD));

  // Who owns each tile on the active layer, and how each port looks.
  const ports = patchPorts(r, wall);
  const portInfo = new Map(ports.map((p) => [p.port.id, p]));
  const owner = new Map<string, { portId: string; label: string; color: string }>();
  const runs = wall.dataRuns.filter((d) => d.redundant === redundant);
  runs.forEach((run, i) => {
    const info = portInfo.get(run.portId);
    const color = info ? letterColor(info.box.letter) : RUN_COLORS[(i + 4) % RUN_COLORS.length];
    run.tileChain.forEach(([c, rw]) => owner.set(`${c},${rw}`, { portId: run.portId, label: info?.label ?? portPatchLabel(r, wall, run.portId), color }));
  });
  const selRun = selPort ? runs.find((d) => d.portId === selPort) : undefined;
  const tilePx = wallGeometry(r, wall).tile.px_w * wallGeometry(r, wall).tile.px_h;
  const portState = (portId: string) => {
    const mine = wall.dataRuns.filter((d) => d.portId === portId);
    const n = Math.max(0, ...mine.map((d) => d.tileChain.length));
    return { mapped: mine.length > 0, over: n * tilePx > portCapacity(r, portId).px, tiles: mine.find((d) => d.redundant === redundant)?.tileChain.length ?? 0 };
  };

  const toSvg = (clientX: number, clientY: number) => {
    const s = svgRef.current!; const pt = s.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(s.getScreenCTM()!.inverse());
  };
  const tileAt = (p: { x: number; y: number }): [number, number] | null => {
    const c = Math.floor((p.x - PAD) / cell), rw = Math.floor((p.y - PAD) / ch);
    return c >= 0 && rw >= 0 && c < wall.cols && rw < wall.rows ? [c, rw] : null;
  };
  const beginStroke = (e: React.PointerEvent, t: [number, number]) => {
    if (frozen) return;
    if (!selPort) { toast("error", "Select a port on an XD box first (A1, A2 …), then paint tiles onto it."); return; }
    svgRef.current?.setPointerCapture(e.pointerId);
    setStroke({ mode: e.shiftKey ? "remove" : "add", tiles: [t], keys: new Set([`${t[0]},${t[1]}`]) });
  };
  const endStroke = () => {
    if (!stroke || !selPort) { setStroke(null); return; }
    const { mode, tiles } = stroke;
    // A single click on a tile already on the selected port unpaints it.
    const single = tiles.length === 1 && mode === "add" && owner.get(`${tiles[0][0]},${tiles[0][1]}`)?.portId === selPort;
    const label = portPatchLabel(r, wall, selPort);
    led((rec) => paintTiles(rec, wall.id, selPort, tiles, single ? "remove" : mode, { redundant }), `led: ${single || mode === "remove" ? "unpaint" : "paint"} ${tiles.length} tile${tiles.length === 1 ? "" : "s"} ${single || mode === "remove" ? "from" : "onto"} ${label}${redundant ? " (backup)" : ""}`, { quiet: true });
    setStroke(null);
  };

  const dropAt = (clientX: number, clientY: number, letter: string) => {
    const p = toSvg(clientX, clientY);
    onDrop(letter, { x: Math.max(0, (p.x - PAD - BOX_W / 2) / cell), y: Math.max(0, (p.y - PAD - BOX_H / 2) / ch) });
  };

  if (!wall.cols || !wall.rows) return <Empty>Size the wall (cols × rows) to see its tiles.</Empty>;
  return (
    <div className={`scroll-x border rounded-sm bg-panel p-2 ${over ? "border-accent" : "border-line"}`}
      onDragOver={(e) => { if (frozen || !e.dataTransfer.types.includes(XD_MIME)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!over) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { const letter = e.dataTransfer.getData(XD_MIME); setOver(false); if (!letter || frozen) return; e.preventDefault(); dropAt(e.clientX, e.clientY, letter); }}>
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${wall.name} pixel & patch map, ${layer} runs`} className={stroke ? "cursor-crosshair select-none" : "select-none"}
        onPointerMove={(e) => {
          if (drag) { const p = toSvg(e.clientX, e.clientY); setDrag({ ...drag, x: Math.max(PAD, p.x - drag.dx), y: Math.max(PAD, p.y - drag.dy) }); return; }
          if (stroke) {
            const t = tileAt(toSvg(e.clientX, e.clientY));
            if (!t) return;
            const k = `${t[0]},${t[1]}`;
            if (stroke.keys.has(k)) return;
            setStroke({ ...stroke, tiles: [...stroke.tiles, t], keys: new Set([...stroke.keys, k]) });
          }
        }}
        onPointerUp={() => {
          if (drag) {
            led((rec) => moveXd(rec, wall.id, drag.deviceId, { x: (drag.x - PAD) / cell, y: (drag.y - PAD) / ch }), "", { quiet: true });
            setDrag(null);
          }
          if (stroke) endStroke();
        }}
        onPointerCancel={() => { setDrag(null); setStroke(null); }}>
        <defs>
          <pattern id="pp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="rgb(var(--dim) / 0.35)" /></pattern>
        </defs>
        {/* tiles */}
        {Array.from({ length: wall.rows }).flatMap((_, rw) => Array.from({ length: wall.cols }).map((__, c) => {
          const k = `${c},${rw}`;
          const o = owner.get(k);
          const inStroke = stroke?.keys.has(k);
          const isSel = !!o && o.portId === selPort;
          const fill = inStroke ? (stroke!.mode === "remove" ? "url(#pp-hatch)" : "rgb(var(--accent))") : o ? o.color : "rgb(var(--line))";
          const x = PAD + c * cell, y = PAD + rw * ch;
          return (
            <g key={k} onPointerDown={(e) => { e.stopPropagation(); beginStroke(e, [c, rw]); }} className={frozen ? "" : "cursor-crosshair"}>
              <rect x={x + 0.5} y={y + 0.5} width={cell - 1} height={ch - 1} fill={fill} opacity={inStroke ? 0.9 : o ? (isSel ? 0.95 : selPort ? 0.45 : 0.8) : 0.6}
                stroke={isSel ? "rgb(var(--ink))" : "none"} strokeWidth={isSel ? 1.5 : 0}>
                <title>{`tile ${c + 1},${rw + 1}${o ? ` · ${o.label}` : " · unmapped"}`}</title>
              </rect>
              {o && cell >= 20 && <text x={x + cell / 2} y={y + ch / 2 + 3.5} fontSize={Math.min(11, cell * 0.42)} textAnchor="middle" fill={isSel ? "rgb(var(--ink))" : "rgb(var(--raised))"} fontFamily="IBM Plex Mono, monospace" fontWeight={600} pointerEvents="none">{o.label}</text>}
            </g>
          );
        }))}
        {/* daisy-chain order of the selected run */}
        {selRun && selRun.tileChain.length > 1 && (
          <polyline points={selRun.tileChain.map(([c, rw]) => `${PAD + c * cell + cell / 2},${PAD + rw * ch + ch / 2}`).join(" ")} fill="none" stroke="rgb(var(--ink))" strokeWidth={1.5} strokeLinejoin="round" strokeOpacity={0.8} pointerEvents="none" />
        )}
        {selRun && selRun.tileChain[0] && <circle cx={PAD + selRun.tileChain[0][0] * cell + cell / 2} cy={PAD + selRun.tileChain[0][1] * ch + ch / 2} r={Math.min(5, cell / 4)} fill="rgb(var(--ink))" pointerEvents="none" />}
        {/* drop hint */}
        {boxes.length === 0 && (
          <g pointerEvents="none">
            <rect x={PAD} y={gridH + PAD + 12} width={BOX_W} height={BOX_H} rx={3} fill="none" stroke={over ? "rgb(var(--accent))" : "rgb(var(--dim))"} strokeDasharray="5 4" />
            <text x={PAD + BOX_W / 2} y={gridH + PAD + 12 + BOX_H / 2 + 4} fontSize={12} textAnchor="middle" fill="rgb(var(--dim))" fontFamily="IBM Plex Sans, sans-serif">drop an XD box here</text>
          </g>
        )}
        {/* XD boxes */}
        {boxes.map((b) => {
          const dev = r.devices.find((x) => x.id === b.deviceId);
          if (!dev) return null;
          const { x, y } = boxPx(b);
          const color = letterColor(b.letter);
          const feed = feedOf(r, dev);
          return (
            <g key={b.deviceId} transform={`translate(${x},${y})`}>
              <rect width={BOX_W} height={BOX_H} rx={3} fill="rgb(var(--raised))" stroke={drag?.deviceId === b.deviceId ? "rgb(var(--accent))" : "rgb(var(--line))"} />
              <g className={frozen ? "" : "cursor-move"}
                onPointerDown={(e) => { if (frozen) return; e.stopPropagation(); const p = toSvg(e.clientX, e.clientY); svgRef.current?.setPointerCapture(e.pointerId); setDrag({ deviceId: b.deviceId, dx: p.x - x, dy: p.y - y, x, y }); }}>
                <rect width={BOX_LABEL_W} height={BOX_H} rx={3} fill={color} />
                <text x={BOX_LABEL_W / 2} y={BOX_H / 2 - 2} fontSize={18} fontWeight={700} textAnchor="middle" fill="rgb(var(--raised))" fontFamily="Barlow Condensed, sans-serif">{b.letter}</text>
                <text x={BOX_LABEL_W / 2} y={BOX_H - 7} fontSize={8} textAnchor="middle" fill="rgb(var(--raised))" fontFamily="IBM Plex Mono, monospace">XD</text>
                <title>{`${dev.label} · drag to move`}</title>
              </g>
              {xdOutPorts(dev).map((p, i) => {
                const st = portState(p.id);
                const isSel = p.id === selPort;
                const px0 = BOX_LABEL_W + i * BOX_PORT_W;
                return (
                  <g key={p.id} className={frozen ? "" : "cursor-pointer"} onPointerDown={(e) => { e.stopPropagation(); if (frozen) return; setSelPort(isSel ? null : p.id); }}>
                    <rect x={px0 + 2} y={6} width={BOX_PORT_W - 4} height={BOX_H - 12} rx={2} fill={st.mapped ? color : "rgb(var(--panel))"} fillOpacity={st.mapped ? 0.85 : 1}
                      stroke={isSel ? "rgb(var(--accent))" : st.over ? "rgb(var(--block))" : "rgb(var(--line))"} strokeWidth={isSel || st.over ? 2 : 1} />
                    <text x={px0 + BOX_PORT_W / 2} y={BOX_H / 2 + 1} fontSize={10} fontWeight={600} textAnchor="middle" fill={st.mapped ? "rgb(var(--raised))" : "rgb(var(--ink))"} fontFamily="IBM Plex Mono, monospace">{i + 1}</text>
                    {st.tiles > 0 && <text x={px0 + BOX_PORT_W / 2} y={BOX_H - 9} fontSize={7.5} textAnchor="middle" fill={st.mapped ? "rgb(var(--raised))" : "rgb(var(--dim))"} fontFamily="IBM Plex Mono, monospace">{st.tiles}</text>}
                    <title>{`${b.letter}${i + 1} · ${dev.label} ${p.name}${st.tiles ? ` · ${st.tiles} tiles` : ""}${st.over ? " · over capacity" : ""}`}</title>
                  </g>
                );
              })}
              <text x={BOX_W} y={BOX_H + 12} fontSize={9.5} textAnchor="end" fill={feed ? "rgb(var(--dim))" : "rgb(var(--warn))"} fontFamily="IBM Plex Mono, monospace" pointerEvents="none">
                {feed ? `${dev.label} ← ${feed.device.label} ${feed.port.name} (${feed.cable.label})` : `${dev.label} · no 10G feed`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The SX40 output feeding an XD's 10G IN, through the LED-owned fiberLED jumper. */
function feedOf(r: ShowRecord, xd: Device) {
  const ins = new Set(xd.ports.filter((p) => p.type === "fiberLED" && p.dir === "in").map((p) => p.id));
  for (const c of r.cables) {
    if (c.type !== "fiberLED" || !c.toPort || !ins.has(c.toPort) || !c.fromPort) continue;
    for (const d of r.devices) { const p = d.ports.find((x) => x.id === c.fromPort); if (p) return { device: d, port: p, cable: c }; }
  }
  return null;
}

function PortTable({ r, wall, frozen, layer, selPort, setSelPort }: { r: ShowRecord; wall: Wall; frozen: boolean; layer: Layer; selPort: string | null; setSelPort(p: string | null): void }) {
  const led = useWriter("led");
  const boxes = patchBoxes(wall);
  const tilePx = wallGeometry(r, wall).tile.px_w * wallGeometry(r, wall).tile.px_h;
  const redundant = layer === "backup";
  const others = wall.dataRuns.filter((run) => !boxes.some((b) => r.devices.find((d) => d.id === b.deviceId)?.ports.some((p) => p.id === run.portId)));
  return (
    <Panel title="XD ports">
      {boxes.length === 0 ? <Empty>No XD boxes on {wall.name} yet. Drag the chip onto the map, or press Place.</Empty> : (
        <div className="grid gap-3">
          {boxes.map((b) => {
            const dev = r.devices.find((x) => x.id === b.deviceId);
            if (!dev) return null;
            const feed = feedOf(r, dev);
            return (
              <div key={b.deviceId} className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: letterColor(b.letter) }} />
                  <b className="font-display uppercase tracking-wider">XD {b.letter}</b>
                  <span className="font-mono text-xs text-dim">{dev.label}{feed ? ` ← ${feed.device.label} ${feed.port.name}` : ""}</span>
                  {!feed && <span className="text-xs text-warn">no 10G feed</span>}
                  <button className="ml-auto text-block underline text-xs disabled:opacity-40" disabled={frozen} onClick={() => { if (selPort && dev.ports.some((p) => p.id === selPort)) setSelPort(null); led((rec) => removeXd(rec, wall.id, dev.id), `led: remove XD ${b.letter} from ${wall.name}`, { cascade: true }); }}>remove</button>
                </div>
                <table className="tbl text-xs"><tbody>
                  {xdOutPorts(dev).map((p, i) => {
                    const run = wall.dataRuns.find((d) => d.portId === p.id && d.redundant === redundant);
                    const n = run?.tileChain.length ?? 0;
                    const cap = portCapacity(r, p.id).px;
                    const pct = cap ? Math.round((n * tilePx / cap) * 100) : 0;
                    const isSel = selPort === p.id;
                    return (
                      <tr key={p.id} className={isSel ? "bg-accent/10" : ""}>
                        <td className="font-mono font-semibold w-10">{b.letter}{i + 1}</td>
                        <td className="font-mono">{n ? `${n} tiles` : <span className="text-dim">—</span>}</td>
                        <td className={`font-mono text-right ${pct > 100 ? "text-block" : "text-dim"}`}>{n ? `${pct}%` : ""}</td>
                        <td className="text-right whitespace-nowrap">
                          <button className={`underline text-xs ${isSel ? "text-accent" : ""}`} disabled={frozen} onClick={() => setSelPort(isSel ? null : p.id)}>{isSel ? "selected" : "select"}</button>
                          {n > 0 && <button className="underline text-xs ml-2 text-dim" disabled={frozen} onClick={() => led((rec) => clearPort(rec, wall.id, p.id), `led: clear ${b.letter}${i + 1}`)}>clear</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody></table>
              </div>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <div className="mt-3 text-xs text-dim">
          <div className="label mb-1">Runs on other processors</div>
          <ul className="grid gap-0.5">{others.map((run, i) => <li key={i} className="font-mono">{portPatchLabel(r, wall, run.portId)} · {run.tileChain.length} tiles{run.redundant ? " · backup" : ""}
            <button className="underline ml-2 disabled:opacity-40" disabled={frozen} onClick={() => led((rec) => clearPort(rec, wall.id, run.portId), "led: clear run")}>clear</button></li>)}</ul>
        </div>
      )}
    </Panel>
  );
}

/** Derived data-flow strip: SX40s → XD boxes (10G jumpers) → the wall (1G runs). Nothing here is typed; it follows the map. */
function FlowStrip({ r, wall }: { r: ShowRecord; wall: Wall }) {
  const legs = ledLegs(r, wall);
  const boxes = patchBoxes(wall);
  const procs = wall.processorIds.map((id) => r.devices.find((d) => d.id === id)).filter((d): d is Device => !!d);
  const xds = procs.filter((d) => xdOutPorts(d).length > 0 && d.ports.some((p) => p.type === "fiberLED" && p.dir === "in"));
  const heads = procs.filter((d) => !xds.includes(d));
  const NODE_W = 150, NODE_H = 36, COL = 240, ROW = 52, X0 = 12, Y0 = 12;
  const rows = Math.max(heads.length, xds.length, 1);
  const H = Y0 * 2 + rows * ROW;
  const W = X0 * 2 + 2 * COL + NODE_W;
  const pos = new Map<string, { x: number; y: number }>();
  heads.forEach((d, i) => pos.set(d.id, { x: X0, y: Y0 + i * ROW }));
  xds.forEach((d, i) => pos.set(d.id, { x: X0 + COL, y: Y0 + i * ROW }));
  const wallPos = { x: X0 + 2 * COL, y: Y0 + ((rows - 1) * ROW) / 2 };
  const letterOf = (id: string) => boxes.find((b) => b.deviceId === id)?.letter;
  const edge = (a: { x: number; y: number }, b: { x: number; y: number }, key: string, label: string, title: string, warn?: boolean) => {
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2, mx = (x1 + x2) / 2;
    return (
      <g key={key}>
        <title>{title}</title>
        <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={warn ? "rgb(var(--warn))" : "rgb(var(--accent))"} strokeWidth={1.8} strokeDasharray={warn ? "5 3" : undefined} />
        <text x={mx} y={(y1 + y2) / 2 - 4} fontSize={9.5} textAnchor="middle" fill="rgb(var(--ink))" fontFamily="IBM Plex Mono, monospace" paintOrder="stroke" stroke="rgb(var(--panel))" strokeWidth={3}>{label}</text>
      </g>
    );
  };
  const node = (key: string, p: { x: number; y: number }, title: string, sub: string, color?: string) => (
    <g key={key} transform={`translate(${p.x},${p.y})`}>
      <rect width={NODE_W} height={NODE_H} rx={3} fill="rgb(var(--raised))" stroke="rgb(var(--line))" />
      <rect width={4} height={NODE_H} fill={color ?? "rgb(var(--accent))"} />
      <text x={10} y={15} fontSize={12} fontWeight={600} fill="rgb(var(--ink))" fontFamily="IBM Plex Sans, sans-serif">{title}</text>
      <text x={10} y={28} fontSize={9.5} fill="rgb(var(--dim))" fontFamily="IBM Plex Mono, monospace">{sub}</text>
    </g>
  );
  return (
    <Panel title="Data flow">
      {procs.length === 0 ? <Empty>Drop an XD box to start the data flow for {wall.name}.</Empty> : (
        <div className="scroll-x">
          <svg width="100%" style={{ minWidth: 420, maxWidth: W }} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${wall.name} data flow`}>
            {legs.filter((l) => l.toDeviceId).map((l) => { const a = pos.get(l.fromDeviceId), b = pos.get(l.toDeviceId!); return a && b ? edge(a, b, l.cableId ?? l.label, l.short, l.label) : null; })}
            {legs.filter((l) => l.toWallId).map((l) => { const a = pos.get(l.fromDeviceId); return a ? edge(a, wallPos, `w-${l.fromDeviceId}`, l.short, `${l.label} · ${fmt(l.px)} px`) : null; })}
            {heads.map((d) => node(d.id, pos.get(d.id)!, d.label, d.model))}
            {xds.map((d) => { const L = letterOf(d.id); const fed = legs.some((l) => l.toDeviceId === d.id); return node(d.id, pos.get(d.id)!, L ? `XD ${L} · ${d.label}` : d.label, fed ? `${wall.dataRuns.filter((x) => !x.redundant && xdOutPorts(d).some((p) => p.id === x.portId)).length} / ${PORTS} ports in use` : "no 10G feed", L ? letterColor(L) : undefined); })}
            {node("wall", wallPos, wall.name, `${wall.cols}×${wall.rows} ${wall.tileModel} · ${fmt(mappedTiles(wall, false))} mapped`)}
          </svg>
        </div>
      )}
    </Panel>
  );
}
