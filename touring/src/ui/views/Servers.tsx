import { addServerPair, assignOutputs, syncContentSpecs } from "../../modules/servers";
import { newId } from "../../store/ids";
import type { ServerHost } from "../../store/types";
import { CheckCard, Edit, Empty, PageHead, Panel } from "../kit";
import { useRecord, useWriter, isFrozen } from "../state";

export function ServersView() {
  const r = useRecord()!;
  const srv = useWriter("servers");
  const frozen = isFrozen(r);
  const checks = r.binder.checks.filter((c) => !c.resolved && c.module === "servers");
  const label = (h: ServerHost) => r.devices.find((d) => d.id === h.deviceId)?.label ?? h.id;
  const portName = (pid: string) => { for (const d of r.devices) { const p = d.ports.find((x) => x.id === pid); if (p) return p.name; } return "?"; };
  const setHost = (h: ServerHost, patch: Partial<ServerHost>, why: string) => srv([{ op: "replace", path: `/servers/hosts/${h.id}`, value: { ...h, ...patch } }], `servers: ${label(h)} ${why}`);

  return (
    <div className="grid gap-4">
      <PageHead title="Media Servers" sub={<>Sizes outputs to the LED canvas ({r.led.canvas.w_px}×{r.led.canvas.h_px} px) and pairs failover. Never writes wall dimensions.</>}
        actions={<>
          <button className="btn" disabled={frozen} onClick={() => srv((rec) => addServerPair(rec, newId), "servers: add server pair")}>Add server pair</button>
          <button className="btn" disabled={frozen} onClick={() => srv((rec) => syncContentSpecs(rec), "servers: content specs from canvas")}>Content specs from canvas</button>
          <button className="btn" disabled={frozen} onClick={() => srv((rec) => assignOutputs(rec), "servers: assign outputs to walls")}>Assign outputs</button>
        </>} />
      <Panel title="Hosts">
        {r.servers.hosts.length === 0 ? <Empty>No media servers on this show.</Empty> : (
          <div className="grid gap-4">
            {r.servers.hosts.map((h) => {
              const dev = r.devices.find((d) => d.id === h.deviceId);
              return (
                <div key={h.id} className="border border-line rounded-sm p-3">
                  <div className="flex flex-wrap gap-3 items-end mb-2">
                    <div className="font-display text-xl uppercase tracking-wider">{label(h)}</div>
                    <span className="text-dim">{dev?.make} {dev?.model}</span>
                    <label className="grid gap-0.5"><span className="label">Role</span>
                      <select className="inp" disabled={frozen} value={h.role} onChange={(e) => setHost(h, { role: e.target.value as ServerHost["role"] }, "role")}>{["master", "backup", "understudy"].map((x) => <option key={x}>{x}</option>)}</select></label>
                    <label className="grid gap-0.5"><span className="label">Failover to</span>
                      <select className="inp" disabled={frozen} value={h.failover ?? ""} onChange={(e) => setHost(h, { failover: e.target.value || null }, "failover")}>
                        <option value="">none</option>{r.servers.hosts.filter((x) => x.id !== h.id).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</select></label>
                    <label className="grid gap-0.5"><span className="label">Timecode</span>
                      <select className="inp" disabled={frozen} value={h.timecode} onChange={(e) => setHost(h, { timecode: e.target.value as ServerHost["timecode"] }, "timecode")}>{["LTC", "MTC", "none"].map((x) => <option key={x}>{x}</option>)}</select></label>
                  </div>
                  <div className="scroll-x">
                    <table className="tbl text-[13px]"><thead><tr><th>Output</th><th>Resolution</th><th>Refresh</th><th>Feeds wall</th></tr></thead>
                      <tbody>{h.outputs.map((o, i) => (
                        <tr key={o.portId}>
                          <td className="font-mono">{portName(o.portId)}</td>
                          <td><Edit value={o.resolution} disabled={frozen} onCommit={(v) => setHost(h, { outputs: h.outputs.map((x, j) => (j === i ? { ...x, resolution: v } : x)) }, "output resolution")} /></td>
                          <td><Edit type="number" value={o.refresh} disabled={frozen} onCommit={(v) => setHost(h, { outputs: h.outputs.map((x, j) => (j === i ? { ...x, refresh: Number(v) } : x)) }, "output refresh")} /></td>
                          <td><select className="inp" disabled={frozen} value={o.feedsWallId ?? ""} aria-label="Feeds wall" onChange={(e) => setHost(h, { outputs: h.outputs.map((x, j) => (j === i ? { ...x, feedsWallId: e.target.value || null } : x)) }, "output wall")}>
                            <option value="">—</option>{r.led.walls.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                        </tr>
                      ))}</tbody></table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Content specs">
          {r.servers.content.contentSpecs.length === 0 ? <Empty>No content specs. Use Content specs from canvas.</Empty> : (
            <table className="tbl text-[13px]"><thead><tr><th>Wall</th><th>Spec px</th><th>Wall px</th><th>Codec</th><th>fps</th></tr></thead>
              <tbody>{r.servers.content.contentSpecs.map((c) => {
                const w = r.led.walls.find((x) => x.id === c.wallId);
                const d = r.derived.led.perWall[c.wallId];
                const bad = d && (d.w_px !== c.w_px || d.h_px !== c.h_px);
                return <tr key={c.wallId}><td>{w?.name}</td><td className={`font-mono ${bad ? "text-warn" : ""}`}>{c.w_px}×{c.h_px}</td><td className="font-mono">{d ? `${d.w_px}×${d.h_px}` : "—"}</td><td>{c.codec}</td><td className="font-mono">{c.fps}</td></tr>;
              })}</tbody></table>
          )}
        </Panel>
        <Panel title="Looks by song">
          {(() => {
            const sl = r.show.setlists.find((x) => x.id === r.show.activeSetlistId);
            const rows = (sl?.songs ?? []).filter((s) => s.lookRef).sort((a, b) => a.order - b.order);
            if (!rows.length) return <Empty>No song looks yet. Set them per song in the Show Book.</Empty>;
            return <table className="tbl text-[13px]"><thead><tr><th>#</th><th>Song</th><th>Server</th><th>Look</th></tr></thead>
              <tbody>{rows.map((s) => <tr key={s.id}><td className="font-mono text-dim">{s.order}</td><td>{s.title}</td><td>{label(r.servers.hosts.find((h) => h.id === s.lookRef!.serverId) ?? r.servers.hosts[0])}</td><td className="font-mono">{s.lookRef!.lookName || "—"}</td></tr>)}</tbody></table>;
          })()}
        </Panel>
        <Panel title="Server checks">{checks.length === 0 ? <Empty>No open server checks.</Empty> : <div className="grid gap-2">{checks.map((c) => <CheckCard key={c.id} c={c} />)}</div>}</Panel>
      </div>
    </div>
  );
}
