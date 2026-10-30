import { setSchedule } from "../../setup/wizard";
import { newId } from "../../store/ids";
import type { Contact, ScheduleEntry } from "../../store/types";
import { Edit, Empty, PageHead, Panel } from "../kit";
import { explain, useApp, useRecord, useWriter, isFrozen } from "../state";

const ROLES: [keyof ReturnType<typeof crewOf>, string][] = [
  ["videoDirector", "Video Director"], ["crewChief", "Crew Chief"], ["eic", "EIC"], ["ledLead", "LED Lead"],
  ["cameraLead", "Camera Lead"], ["serverOp", "Server Op"], ["pm", "Production Manager"], ["localLabor", "Local labor count"],
];
function crewOf(r: NonNullable<ReturnType<typeof useRecord>>) { return r.crew; }
const KEYS = ["access", "load-in", "rig", "power-tie-in", "led-trim", "line-check", "rehearsal", "doors", "show", "curfew", "strike", "truck-out"];
const ORDER = ["power-tie-in", "led-trim", "line-check", "rehearsal"];

export function CrewView() {
  const r = useRecord()!;
  const { ws, showId, toast } = useApp();
  const shell = useWriter("shell");
  const frozen = isFrozen(r);
  const sched = [...r.binder.schedule].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const tasksFor = (role: string) => r.tasks.filter((t) => t.owner === role && t.status !== "done" && t.status !== "na").length;

  const setEntry = (e: ScheduleEntry, patch: Partial<ScheduleEntry>) => shell([{ op: "replace", path: `/binder/schedule/${e.id}`, value: { ...e, ...patch } }], `schedule: ${e.item}`);
  const setContact = (c: Contact, patch: Partial<Contact>) => shell([{ op: "replace", path: `/binder/contacts/${c.id}`, value: { ...c, ...patch } }], `contact: ${c.name || "new"}`);

  return (
    <div className="grid gap-4 max-w-6xl">
      <PageHead title="Crew & schedule" sub="Tasks follow the role, not the person: change who holds a role and their tasks move with it." />
      <Panel title="Roles">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map(([k, label]) => (
            <label key={k} className="grid gap-1 min-w-0"><span className="label">{label}{tasksFor(k) > 0 && <span className="ml-1 text-accent normal-case">· {tasksFor(k)} open tasks</span>}</span>
              <Edit id={`crew-${k}`} value={r.crew[k] ?? ""} disabled={frozen} placeholder="TBD" onCommit={(v) => shell([{ op: "replace", path: `/crew/${k}`, value: v }], `crew: ${label}`)} /></label>
          ))}
        </div>
      </Panel>
      <Panel title="Schedule" actions={<>
        <button className="btn" disabled={frozen || !r.event.dates[0]} title={r.event.dates[0] ? "" : "Set a show date first"} onClick={() => {
          try { setSchedule(ws, showId!, "template"); toast("ok", "Schedule template applied"); } catch (e) { toast("error", (e as Error).message); }
        }}>Apply {r.event.type} template</button>
        <button className="btn" disabled={frozen} onClick={() => shell([{ op: "add", path: "/binder/schedule/-", value: { id: newId("sch"), key: "", date: r.event.dates[0] ?? "", time: "", item: "New entry", owner: "", confirmed: false } }], "schedule: add entry")}>Add entry</button>
      </>}>
        {sched.length === 0 ? <Empty>No schedule yet. Apply the profile template or add entries.</Empty> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Time</th><th>Key</th><th>Item</th><th>Owner</th><th>Confirmed</th><th /></tr></thead>
              <tbody>
                {sched.map((e) => {
                  const idx = ORDER.indexOf(e.key ?? "");
                  const before = idx > 0 ? sched.find((x) => x.key === ORDER[idx - 1] && x.date === e.date) : undefined;
                  const bad = before && `${before.time}` > `${e.time}`;
                  return (
                    <tr key={e.id} className={bad ? "bg-warn/10" : ""}>
                      <td><Edit value={e.date} type="date" disabled={frozen} onCommit={(v) => setEntry(e, { date: v })} /></td>
                      <td><Edit value={e.time} type="time" disabled={frozen} onCommit={(v) => setEntry(e, { time: v })} /></td>
                      <td><select className="inp" disabled={frozen} value={e.key ?? ""} onChange={(x) => setEntry(e, { key: x.target.value })} aria-label="Schedule key"><option value="">—</option>{KEYS.map((k) => <option key={k}>{k}</option>)}</select></td>
                      <td><Edit value={e.item} disabled={frozen} onCommit={(v) => setEntry(e, { item: v })} />{bad && <div className="text-xs text-warn">Before {before!.item}</div>}</td>
                      <td><Edit value={e.owner} disabled={frozen} onCommit={(v) => setEntry(e, { owner: v })} /></td>
                      <td><input type="checkbox" aria-label="Confirmed" disabled={frozen} checked={!!e.confirmed} onChange={(x) => setEntry(e, { confirmed: x.target.checked })} /></td>
                      <td><button className="btn" disabled={frozen} onClick={() => { const res = ws.patch(showId!, "shell", [{ op: "remove", path: `/binder/schedule/${e.id}` }], `schedule: remove ${e.item}`); if (!res.ok) toast("error", explain(res)); }}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Contacts" actions={<button className="btn" disabled={frozen} onClick={() => shell([{ op: "add", path: "/binder/contacts/-", value: { id: newId("con"), name: "", role: "", phone: "", email: "" } }], "contacts: add")}>Add contact</button>}>
        {r.binder.contacts.length === 0 ? <Empty>No contacts. Add the PM and venue production contacts.</Empty> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th /></tr></thead>
              <tbody>{r.binder.contacts.map((c) => (
                <tr key={c.id}>
                  {(["name", "role", "phone", "email"] as const).map((k) => <td key={k}><Edit value={c[k]} disabled={frozen} onCommit={(v) => setContact(c, { [k]: v })} /></td>)}
                  <td><button className="btn" disabled={frozen} onClick={() => shell([{ op: "remove", path: `/binder/contacts/${c.id}` }], "contacts: remove")}>Remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
