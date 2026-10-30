import { setupCompleted } from "../../store/readiness";
import type { Severity } from "../../store/types";
import { CheckCard, Empty, fmt, PageHead, Panel, SevChip, Stat } from "../kit";
import { useApp, useRecord } from "../state";

const STEP_NAMES: Record<number, string> = { 1: "Identify", 2: "Profile the system", 3: "Size the walls", 4: "Crew and contacts", 5: "Schedule" };

export function OverviewView() {
  const r = useRecord()!;
  const { openWizard, showId, go } = useApp();
  const d = r.derived;
  const open = r.binder.checks.filter((c) => !c.resolved);
  const bySev = (s: Severity) => open.filter((c) => c.severity === s);
  const done = setupCompleted(r);
  const incomplete = Object.entries(done).filter(([, v]) => !v).map(([k]) => Number(k));
  const tasks = r.tasks.filter((t) => t.status !== "done" && t.status !== "na");
  const blocked = tasks.filter((t) => (d.tasks[t.id]?.status ?? t.status) === "blocked");
  const approx = Object.values(d.led.perWall).some((w) => w.approximate);

  return (
    <div className="grid gap-4 max-w-6xl">
      <PageHead title="Overview" sub={<>{r.client.artist || "No artist"} · {r.event.venueName || "No venue"}{r.event.city && `, ${r.event.city}`} · <span className="font-mono">{r.event.dates.join(", ") || "no date"}</span> · {r.event.type}</>} />
      {incomplete.length > 0 && r.meta.status === "draft" && r.meta.source !== "example" && (
        <div className="flex flex-wrap gap-2 items-center bg-accent/10 border border-accent/40 rounded-sm px-3 py-2">
          <span className="label text-ink">Finish setup</span>
          {incomplete.map((s) => <button key={s} className="btn" onClick={() => openWizard(s, showId)}>{s} · {STEP_NAMES[s]}</button>)}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Advance readiness" actions={<span className={`font-display uppercase tracking-widest text-sm ${d.readiness.advance ? "text-ok" : "text-block"}`}>{d.readiness.advance ? "Ready to issue" : "Not ready"}</span>}>
          <ul className="grid gap-1">
            {d.readiness.criteria.map((c, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className={`font-mono w-5 shrink-0 ${c.ok ? "text-ok" : c.blocks ? "text-block" : "text-warn"}`} aria-label={c.ok ? "met" : "not met"}>{c.ok ? "✓" : c.blocks ? "✗" : "!"}</span>
                <span className={c.ok ? "text-dim" : ""}>{c.label}{!c.ok && !c.blocks && <span className="text-warn text-xs ml-1">(warning)</span>}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Open checks" actions={<><SevChip s="block" n={bySev("block").length} /><SevChip s="warn" n={bySev("warn").length} /><SevChip s="info" n={bySev("info").length} /></>}>
          {open.length === 0 ? <Empty>No open checks.</Empty> : (
            <div className="grid gap-2 max-h-[28rem] overflow-y-auto pr-1">
              {[...bySev("block"), ...bySev("warn"), ...bySev("info")].map((c) => <CheckCard key={c.id} c={c} />)}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="System totals">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Stat label="LED tiles" value={fmt(d.led.totals.tiles)} />
          <Stat label="LED max" value={fmt(d.led.totals.maxW / 1000, 1)} unit="kW" approx={approx} />
          <Stat label="Total load" value={fmt(d.power.totalW / 1000, 1)} unit="kW" approx={approx} />
          <Stat label="Amps / leg" value={fmt(d.power.totalA_perLeg, 0)} unit="A" approx={approx} />
          <Stat label="Devices" value={fmt(d.inventory.deviceCount || r.devices.length)} />
          <Stat label="Cables" value={fmt(r.cables.length)} />
        </div>
      </Panel>
      <Panel title="Work in flight" actions={<button className="btn" onClick={() => go("tasks")}>Open task board</button>}>
        <div className="flex flex-wrap gap-6">
          <Stat label="Open tasks" value={tasks.length} />
          <Stat label="Blocked" value={blocked.length} />
          <Stat label="Revision" value={r.meta.revision} />
          <Stat label="Record rev" value={r.meta.rev} />
        </div>
        {blocked.length > 0 && (
          <ul className="mt-3 grid gap-1 text-[13px]">
            {blocked.slice(0, 6).map((t) => (
              <li key={t.id}><span className="font-mono text-xs text-dim mr-2">{t.lane}</span>{t.title} <span className="text-block">— {d.tasks[t.id]?.blockers.map((b) => b.label).join("; ")}</span></li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
