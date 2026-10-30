import { useState } from "react";
import { LANE_OWNER } from "../../store/ownership";
import type { Lane, ShowRecord, Task, TaskStatus } from "../../store/types";
import { PageHead, Panel, TaskChip } from "../kit";
import { explain, useApp, useRecord, type View } from "../state";

const LANES: Lane[] = ["advance", "crew", "led", "signal", "servers", "rack", "prep"];
const STATUS: TaskStatus[] = ["blocked", "todo", "doing", "done", "na"];

export function labelFor(r: ShowRecord, id: string): string {
  const d = r.devices.find((x) => x.id === id); if (d) return d.label;
  const w = r.led.walls.find((x) => x.id === id); if (w) return w.name;
  const k = r.racks.find((x) => x.id === id); if (k) return k.name;
  const l = r.signal.links.find((x) => x.id === id); if (l) return l.label || "link";
  const h = r.servers.hosts.find((x) => x.id === id); if (h) return r.devices.find((x) => x.id === h.deviceId)?.label ?? "server";
  return id;
}

export function TasksView() {
  const r = useRecord()!;
  const { ws, showId, go, toast } = useApp();
  const [showDone, setShowDone] = useState(false);
  const [lane, setLane] = useState<Lane>("advance");
  const [title, setTitle] = useState("");
  const d = r.derived.tasks;
  const setStatus = (t: Task, s: TaskStatus) => {
    const api = ws.api(showId!, LANE_OWNER[t.lane][0]);
    const res = api.setTaskStatus(t.id, s);
    if (!res.ok) toast("error", explain(res));
  };
  const visible = r.tasks.filter((t) => showDone || (t.status !== "done" && t.status !== "na"));

  return (
    <div className="grid gap-4">
      <PageHead title="Tasks" sub="Most tasks close themselves when the record says the work is done. Blocked means a field upstream is still empty."
        actions={<label className="flex gap-2 items-center"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show done</label>} />
      <Panel title="Add a task">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          try { ws.api(showId!, LANE_OWNER[lane][0]).task({ lane, title, status: "todo", about: [], blockedBy: [] }); setTitle(""); toast("ok", "Task added"); }
          catch (err) { toast("error", (err as Error).message); }
        }}>
          <select id="task-lane" className="inp" value={lane} onChange={(e) => setLane(e.target.value as Lane)} aria-label="Lane">{LANES.map((l) => <option key={l}>{l}</option>)}</select>
          <input id="task-title" className="inp flex-1 min-w-[12rem]" placeholder="Imperative, one line" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn btn-primary" type="submit">Add</button>
        </form>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {LANES.map((ln) => {
          const list = visible.filter((t) => t.lane === ln).sort((a, b) => STATUS.indexOf(d[a.id]?.status ?? a.status) - STATUS.indexOf(d[b.id]?.status ?? b.status));
          return (
            <section key={ln} className="bg-panel border border-line rounded-sm min-w-0">
              <h2 className="font-display uppercase tracking-wider px-3 py-2 border-b border-line flex justify-between">{ln}<span className="font-mono text-dim text-xs">{list.length}</span></h2>
              <div className="p-2 grid gap-2">
                {list.map((t) => {
                  const dt = d[t.id];
                  const st = dt?.status ?? t.status;
                  return (
                    <article key={t.id} className={`bg-raised border rounded-sm p-2 text-[13px] ${st === "blocked" ? "border-block/50" : "border-line"}`}>
                      <div className="flex justify-between gap-2 items-start">
                        <span className="font-medium">{t.key && <span className="font-mono text-xs text-dim mr-1">{t.key}</span>}{t.title}</span>
                        <TaskChip s={st} />
                      </div>
                      {t.owner && <div className="text-xs text-dim mt-1">owner: {t.owner}{r.crew[t.owner as keyof typeof r.crew] ? ` (${r.crew[t.owner as keyof typeof r.crew]})` : ""}</div>}
                      {(dt?.dueResolved || t.due) && <div className="text-xs font-mono text-dim">{dt?.dueResolved ?? t.due}</div>}
                      {t.about.length > 0 && <div className="text-xs text-dim">about: {t.about.map((a) => labelFor(r, a)).join(", ")}</div>}
                      {st === "blocked" && dt?.blockers.map((b, i) => (
                        <div key={i} className="text-xs text-block mt-1">waiting on {b.label}
                          {b.route && <button className="ml-1 underline text-accent" onClick={() => go(b.route as View, b.label)}>Go to blocker</button>}</div>
                      ))}
                      <select aria-label="Set status" className="inp text-xs mt-2 w-full" value={t.status} onChange={(e) => setStatus(t, e.target.value as TaskStatus)}>
                        {(["todo", "doing", "done", "na"] as TaskStatus[]).map((s) => <option key={s}>{s}</option>)}
                        {t.status === "blocked" && <option>blocked</option>}
                      </select>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
