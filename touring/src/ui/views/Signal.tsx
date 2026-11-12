import { useMemo, useRef, useState } from "react";
import { LIBRARY } from "../../library/library";
import { ledLegs, type LedLeg } from "../../modules/led";
import { addRedundancyGroup, addSignalDevice, autoPatchProgram, connect, disconnect } from "../../modules/signal/helpers";
import { proposeTrunkPlan, seedPhysical } from "../../modules/signal/physical";
import { newId } from "../../store/ids";
import type { Device, ShowRecord } from "../../store/types";
import { CheckCard, Empty, PageHead, Panel } from "../kit";
import { useRecord, useWriter, isFrozen } from "../state";

type Layer = "logical" | "physical" | "build";
const COL: Record<string, number> = { camera: 0, ccu: 1, server: 2, switcher: 2, router: 3, converter: 3, recorder: 4, monitor: 4, processor: 5, patchPanel: 3, fiber: 3 };
const NODE_W = 132, NODE_H = 40;
const WALL_COL = 6;

function portOwner(r: ShowRecord) {
  const m = new Map<string, { dev: Device; name: string; type: string }>();
  r.devices.forEach((d) => d.ports.forEach((p) => m.set(p.id, { dev: d, name: p.name, type: p.type })));
  return m;
}

export function SignalView() {
  const r = useRecord()!;
  const sig = useWriter("signal");
  const frozen = isFrozen(r);
  const [layer, setLayer] = useState<Layer>("logical");
  const [selLink, setSelLink] = useState<string | null>(null);
  const ports = useMemo(() => portOwner(r), [r]);
  const checks = r.binder.checks.filter((c) => !c.resolved && c.module === "signal");
  const flagged = new Set(checks.flatMap((c) => [c.target, ...(c.involved ?? [])]));

  // LED legs are read from led.walls[].dataRuns and the fiberLED jumpers (Pixel & Patch): processor → wall, never re-entered here.
  const legs = useMemo(() => r.led.walls.flatMap((w) => ledLegs(r, w).map((l) => ({ ...l, wall: w }))), [r]);
  // Devices drawn: every node plus any device that carries a signal cable, plus processors that drive a wall.
  const drawn = useMemo(() => {
    const ids = new Set(r.signal.nodes.map((n) => n.deviceId));
    for (const c of r.cables) for (const p of [c.fromPort, c.toPort]) { const o = p && ports.get(p); if (o && !["etherCon", "fiberLED", "tilePower"].includes(c.type)) ids.add(o.dev.id); }
    for (const l of legs) { ids.add(l.fromDeviceId); if (l.toDeviceId) ids.add(l.toDeviceId); }
    const counters: Record<number, number> = {};
    return [...ids].map((id) => {
      const d = r.devices.find((x) => x.id === id)!;
      if (!d) return null;
      const n = r.signal.nodes.find((x) => x.deviceId === id);
      const col = COL[d.class] ?? 3;
      const row = (counters[col] = (counters[col] ?? 0) + 1) - 1;
      return { d, x: n?.x ?? 20 + col * 170, y: n?.y ?? 20 + row * 70, nodeId: n?.id };
    }).filter(Boolean) as { d: Device; x: number; y: number; nodeId?: string }[];
  }, [r, ports, legs]);
  const pos = new Map(drawn.map((n) => [n.d.id, n]));
  // Walls with data runs sit in their own column to the right of the processors.
  const wallNodes = r.led.walls.filter((w) => legs.some((l) => l.toWallId === w.id)).map((w, i) => ({ w, x: 20 + WALL_COL * 170, y: 20 + i * 70 }));
  const wallPos = new Map(wallNodes.map((n) => [n.w.id, n]));
  const W = Math.max(900, ...drawn.map((n) => n.x + NODE_W + 20), ...wallNodes.map((n) => n.x + NODE_W + 20));
  const H = Math.max(360, ...drawn.map((n) => n.y + NODE_H + 30), ...wallNodes.map((n) => n.y + NODE_H + 30));

  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const toSvg = (e: React.PointerEvent) => {
    const s = svgRef.current!; const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(s.getScreenCTM()!.inverse());
  };

  const link = r.signal.links.find((l) => l.id === selLink);
  const cable = link && r.cables.find((c) => c.id === link.cableId);

  return (
    <div className="grid gap-4">
      <PageHead title="Signal Flow" sub="A typed port graph: every link is a cable between two ports, and every check names the entities, the rule and the smallest fix."
        actions={<>
          <button className="btn btn-primary" disabled={frozen} onClick={() => sig((rec) => autoPatchProgram(rec, newId), "signal: auto-patch program path")}>Auto-patch program</button>
          <button className="btn" disabled={frozen} onClick={() => sig((rec) => seedPhysical(rec, newId), "signal: positions and paths from advance")}>Paths from advance</button>
          <button className="btn" disabled={frozen} onClick={() => sig((rec) => proposeTrunkPlan(rec, newId), "signal: accept trunk plan")}>Trunk plan</button>
        </>} />
      <div className="flex flex-wrap gap-2 items-center" role="tablist">
        <span className="label">Layer</span>
        {(["logical", "physical", "build"] as Layer[]).map((l) => <button key={l} role="tab" aria-selected={layer === l} className={`btn ${layer === l ? "border-accent text-accent" : ""}`} onClick={() => setLayer(l)}>{l}</button>)}
        <span className="text-xs text-dim">Drag devices to arrange. Click a line to inspect it{r.signal.links.length > 10 ? " and see its label" : ""}. Dotted legs are LED data runs mapped in Pixel &amp; Patch.</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="scroll-x border border-line rounded-sm bg-panel min-w-0">
          {drawn.length === 0 ? <div className="p-6"><Empty>No signal devices yet. Add sources and destinations, or run Auto-patch program.</Empty></div> : (
            <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signal flow canvas"
              onPointerMove={(e) => { if (drag) { const p = toSvg(e); setDrag({ ...drag, x: p.x - drag.dx, y: p.y - drag.dy }); } }}
              onPointerUp={() => {
                if (!drag) return;
                const n = r.signal.nodes.find((x) => x.deviceId === drag.id);
                const d = r.devices.find((x) => x.id === drag.id)!;
                const x = Math.round(drag.x), y = Math.round(drag.y);
                if (n) sig([{ op: "replace", path: `/signal/nodes/${n.id}/x`, value: x }, { op: "replace", path: `/signal/nodes/${n.id}/y`, value: y }], "", { quiet: true });
                else sig([{ op: "add", path: "/signal/nodes/-", value: { id: newId("sig"), deviceId: d.id, role: "sink", x, y } }], "", { quiet: true });
                setDrag(null);
              }}>
              <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="rgb(var(--dim))" /></marker></defs>
              {legs.map((l) => {
                const pa = drag?.id === l.fromDeviceId ? drag : pos.get(l.fromDeviceId);
                const pb = l.toDeviceId ? (drag?.id === l.toDeviceId ? drag : pos.get(l.toDeviceId)) : l.toWallId ? wallPos.get(l.toWallId) : undefined;
                if (!pa || !pb) return null;
                const x1 = pa.x + NODE_W, y1 = pa.y + NODE_H / 2, x2 = pb.x, y2 = pb.y + NODE_H / 2, mx = (x1 + x2) / 2;
                const txt = l.short;
                return (
                  <g key={`led-${l.cableId ?? `${l.fromDeviceId}-${l.toWallId}`}`}>
                    <title>{legTitle(l, r)}</title>
                    <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.8} strokeDasharray="2 3" markerEnd="url(#arr)" />
                    {(legs.length <= 12) && <text x={mx} y={(y1 + y2) / 2 - 4} fontSize={10} textAnchor="middle" fill="rgb(var(--ink))" fontFamily="IBM Plex Mono, monospace" paintOrder="stroke" stroke="rgb(var(--panel))" strokeWidth={3}>{txt}</text>}
                  </g>
                );
              })}
              {r.signal.links.map((l) => {
                const c = r.cables.find((x) => x.id === l.cableId);
                const a = c?.fromPort && ports.get(c.fromPort), b = c?.toPort && ports.get(c.toPort);
                if (!a || !b) return null;
                const pa = drag?.id === a.dev.id ? drag : pos.get(a.dev.id), pb = drag?.id === b.dev.id ? drag : pos.get(b.dev.id);
                if (!pa || !pb) return null;
                const x1 = pa.x + NODE_W, y1 = pa.y + NODE_H / 2, x2 = pb.x, y2 = pb.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                const col = l.path === "B" ? "rgb(var(--warn))" : "rgb(var(--ink) / 0.7)";
                const bad = flagged.has(l.id) || (c && flagged.has(c.id));
                const fmtTxt = r.derived.signal.resolvedFormat?.[l.id] ?? l.format;
                const txt = layer === "logical" ? `${l.label} · ${fmtTxt}` : layer === "physical" ? `${c!.label} · ${c!.type} ${c!.length_ft} ft` : (c!.segments?.length ? c!.segments.map((s) => `${s.label} ${s.length_ft.stock}′`).join(" → ") : `${c!.label} ${c!.length_ft}′`);
                return (
                  <g key={l.id} onClick={() => setSelLink(l.id)} className="cursor-pointer">
                    <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={bad ? "rgb(var(--block))" : col} strokeWidth={selLink === l.id ? 3.5 : 1.8} markerEnd="url(#arr)" strokeDasharray={l.path === "B" ? "6 3" : undefined} />
                    <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="transparent" strokeWidth={12} />
                    {(r.signal.links.length <= 10 || selLink === l.id) && <text x={mx} y={(y1 + y2) / 2 - 4} fontSize={10} textAnchor="middle" fill="rgb(var(--ink))" fontFamily="IBM Plex Mono, monospace" paintOrder="stroke" stroke="rgb(var(--panel))" strokeWidth={3}>{txt}</text>}
                  </g>
                );
              })}
              {wallNodes.map((n) => (
                <g key={n.w.id} transform={`translate(${n.x},${n.y})`}>
                  <rect width={NODE_W} height={NODE_H} rx={3} fill="rgb(var(--raised))" stroke="rgb(var(--accent))" strokeDasharray="4 3" />
                  <text x={10} y={16} fontSize={12} fontWeight={600} fill="rgb(var(--ink))" fontFamily="IBM Plex Sans, sans-serif">{n.w.name}</text>
                  <text x={10} y={31} fontSize={9.5} fill="rgb(var(--dim))" fontFamily="IBM Plex Mono, monospace">LED wall · {n.w.cols}×{n.w.rows}</text>
                </g>
              ))}
              {drawn.map((n) => {
                const p = drag?.id === n.d.id ? drag : n;
                const bad = flagged.has(n.d.id);
                return (
                  <g key={n.d.id} transform={`translate(${p.x},${p.y})`} className={frozen ? "" : "cursor-move"}
                    onPointerDown={(e) => { if (frozen) return; const q = toSvg(e); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ id: n.d.id, dx: q.x - n.x, dy: q.y - n.y, x: n.x, y: n.y }); }}>
                    <rect width={NODE_W} height={NODE_H} rx={3} fill="rgb(var(--raised))" stroke={bad ? "rgb(var(--block))" : "rgb(var(--line))"} strokeWidth={bad ? 2 : 1} />
                    <rect width={4} height={NODE_H} fill="rgb(var(--accent))" />
                    <text x={10} y={16} fontSize={12} fontWeight={600} fill="rgb(var(--ink))" fontFamily="IBM Plex Sans, sans-serif">{n.d.label}</text>
                    <text x={10} y={31} fontSize={9.5} fill="rgb(var(--dim))" fontFamily="IBM Plex Mono, monospace">{n.d.class} · {n.d.model.slice(0, 16)}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <div className="grid gap-4 content-start min-w-0">
          {link && cable ? (
            <Panel title={link.label || cable.label} actions={<button className="btn" disabled={frozen} onClick={() => { sig((rec) => disconnect(rec, link.id), `signal: disconnect ${link.label}`); setSelLink(null); }}>Disconnect</button>}>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-[13px]">
                <dt className="label">From</dt><dd>{ports.get(cable.fromPort!)?.dev.label} · {ports.get(cable.fromPort!)?.name}</dd>
                <dt className="label">To</dt><dd>{cable.toPort ? `${ports.get(cable.toPort)?.dev.label} · ${ports.get(cable.toPort)?.name}` : "open end"}</dd>
                <dt className="label">Format</dt><dd className="font-mono">{r.derived.signal.resolvedFormat?.[link.id] ?? link.format}{link.inherited && " (inherited)"}</dd>
                <dt className="label">Path</dt><dd>{link.path}</dd>
                <dt className="label">Cable</dt><dd className="font-mono">{cable.label} · {cable.type} · {cable.length_ft} ft</dd>
              </dl>
              {cable.segments && cable.segments.length > 0 && (
                <div className="mt-2"><div className="label">Segments</div>
                  <ol className="text-xs font-mono grid gap-0.5 mt-1">{cable.segments.map((s) => <li key={s.id}>{s.label} · {s.kind} · {s.length_ft.pinned ?? s.length_ft.derived} → {s.length_ft.stock} ft stock</li>)}</ol></div>
              )}
            </Panel>
          ) : null}
          <ConnectForm r={r} frozen={frozen} />
          <AddDevice frozen={frozen} />
          <Redundancy r={r} frozen={frozen} />
        </div>
      </div>
      <Panel title="Signal checks">{checks.length === 0 ? <Empty>No open signal checks.</Empty> : <div className="grid gap-2 lg:grid-cols-2">{checks.map((c) => <CheckCard key={c.id} c={c} />)}</div>}</Panel>
    </div>
  );
}

function legTitle(l: LedLeg & { wall: { name: string } }, r: ShowRecord): string {
  const name = (id: string | null) => r.devices.find((d) => d.id === id)?.label ?? "";
  return l.toWallId ? `${name(l.fromDeviceId)} → ${l.wall.name}: ${l.label} on ${l.ports.join(", ")} (${l.px.toLocaleString("en-US")} px). Mapped in Pixel & Patch.` : `${name(l.fromDeviceId)} → ${name(l.toDeviceId)}: ${l.label}`;
}

function ConnectForm({ r, frozen }: { r: ShowRecord; frozen: boolean }) {
  const sig = useWriter("signal");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [format, setFormat] = useState(""); const [path, setPath] = useState<"A" | "B">("A"); const [label, setLabel] = useState("");
  const busy = new Set(r.cables.flatMap((c) => [c.fromPort, c.toPort]).filter(Boolean) as string[]);
  const opts = (dirs: string[]) => r.devices.filter((d) => !["tile"].includes(d.class)).flatMap((d) => d.ports.filter((p) => dirs.includes(p.dir) && !["AC-in", "AC-out", "DC-in", "etherCon", "fiberLED"].includes(p.type)).map((p) => ({ id: p.id, text: `${d.label} · ${p.name} (${p.type})${busy.has(p.id) && p.dir !== "bidir" ? " — in use" : ""}` })));
  return (
    <Panel title="Connect">
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (sig((rec) => connect(rec, from, to, { format: format || undefined, path, label: label || undefined }, newId), "signal: connect")) { setFrom(""); setTo(""); setLabel(""); } }}>
        <select id="sig-from" className="inp" value={from} onChange={(e) => setFrom(e.target.value)} required aria-label="From port"><option value="">From (output)…</option>{opts(["out", "bidir"]).map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}</select>
        <select id="sig-to" className="inp" value={to} onChange={(e) => setTo(e.target.value)} required aria-label="To port"><option value="">To (input)…</option>{opts(["in", "bidir"]).map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}</select>
        <div className="flex gap-2">
          <input id="sig-label" className="inp flex-1" placeholder="Label (PGM, ISO 1…)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <select id="sig-path" className="inp" value={path} onChange={(e) => setPath(e.target.value as "A" | "B")} aria-label="Path"><option>A</option><option>B</option></select>
        </div>
        <input id="sig-format" className="inp" placeholder={`Format at source (default ${r.signal.formats.house || "house"})`} value={format} onChange={(e) => setFormat(e.target.value)} />
        <div><button className="btn btn-primary" type="submit" disabled={frozen}>Connect</button></div>
      </form>
    </Panel>
  );
}

function AddDevice({ frozen }: { frozen: boolean }) {
  const sig = useWriter("signal");
  const list = useMemo(() => LIBRARY.templates.filter((t) => ["camera", "ccu", "switcher", "router", "converter", "recorder", "monitor", "fiber", "patchPanel"].includes(t.class)), []);
  const [t, setT] = useState(list[0]?.templateId ?? ""); const [label, setLabel] = useState("");
  return (
    <Panel title="Add signal device">
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (sig((rec) => addSignalDevice(rec, t, label || defaultLabel(rec, t), newId), `signal: add ${label || t}`)) setLabel(""); }}>
        <select id="sig-tpl" className="inp" value={t} onChange={(e) => setT(e.target.value)} aria-label="Template">{list.map((x) => <option key={x.templateId} value={x.templateId}>{x.class} · {x.make} {x.model}</option>)}</select>
        <input id="sig-dev-label" className="inp" placeholder="Label (auto if blank)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div><button className="btn" type="submit" disabled={frozen}>Add</button></div>
      </form>
    </Panel>
  );
}

function defaultLabel(r: ShowRecord, templateId: string): string {
  const t = LIBRARY.templates.find((x) => x.templateId === templateId);
  const prefix = ({ camera: "CAM", ccu: "CCU", switcher: "SW", router: "RTR", converter: "CONV", recorder: "REC", monitor: "MON", fiber: "FIB", patchPanel: "PP" } as Record<string, string>)[t?.class ?? ""] ?? "DEV";
  for (let i = 1; ; i++) { const l = `${prefix}-${i}`; if (!r.devices.some((d) => d.label === l)) return l; }
}

function Redundancy({ r, frozen }: { r: ShowRecord; frozen: boolean }) {
  const sig = useWriter("signal");
  const [name, setName] = useState("PGM to LED");
  const [a, setA] = useState<string[]>([]); const [b, setB] = useState<string[]>([]);
  const links = r.signal.links;
  return (
    <Panel title="Redundancy groups">
      <ul className="grid gap-1 text-[13px] mb-2">
        {r.signal.redundancy.map((g) => <li key={g.id}><b>{g.name}</b> <span className="text-dim">A {g.primary.length} · B {g.backup.length}</span>
          <button className="ml-2 text-accent underline text-xs disabled:opacity-40" disabled={frozen} onClick={() => sig([{ op: "remove", path: `/signal/redundancy/${g.id}` }], `signal: remove group ${g.name}`)}>remove</button></li>)}
        {r.signal.redundancy.length === 0 && <li className="text-dim">None defined.</li>}
      </ul>
      {links.length > 0 && (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); sig((rec) => addRedundancyGroup(rec, name, a, b, newId), `signal: group ${name}`); setA([]); setB([]); }}>
          <input id="rg-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
          <div className="grid grid-cols-2 gap-2">
            <select id="rg-a" multiple className="inp h-24 text-xs" value={a} onChange={(e) => setA([...e.target.selectedOptions].map((o) => o.value))} aria-label="Primary links">{links.filter((l) => l.path === "A").map((l) => <option key={l.id} value={l.id}>{l.label || l.id}</option>)}</select>
            <select id="rg-b" multiple className="inp h-24 text-xs" value={b} onChange={(e) => setB([...e.target.selectedOptions].map((o) => o.value))} aria-label="Backup links">{links.filter((l) => l.path === "B").map((l) => <option key={l.id} value={l.id}>{l.label || l.id}</option>)}</select>
          </div>
          <div><button className="btn" type="submit" disabled={frozen || !a.length || !b.length}>Create group</button></div>
        </form>
      )}
    </Panel>
  );
}
