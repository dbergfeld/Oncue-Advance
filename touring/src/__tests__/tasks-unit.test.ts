// deriveTasks / evalCondition behaviour independent of the module ports.
import { describe, expect, it } from "vitest";
import { library, LIBRARY } from "../library/library";
import { binderModule } from "../modules/binder";
import { memoryPersist } from "../store/persist";
import { profileFor } from "../store/profiles";
import { binderSummary, readiness } from "../store/readiness";
import { Workspace, type Engine } from "../store/store";
import { deriveTasks, evalCondition, seedTasks } from "../store/tasks";
import { newId } from "../store/ids";
import type { Task } from "../store/types";

const eng: Engine = { modules: [binderModule], library, libraryVersion: LIBRARY.libraryVersion, profileFor, deriveTasks, readiness, binderSummary };

function show() {
  const ws = new Workspace(eng, memoryPersist());
  const id = ws.createShow({ artist: "Unit", year: 2026 }).showId;
  const tasks = seedTasks(ws.get(id), profileFor("arena"), newId);
  expect(ws.patch(id, "store", tasks.map((t) => ({ op: "add" as const, path: "/tasks/-", value: t })), "setup:tasks").ok).toBe(true);
  const byKey = (k: string) => ws.get(id).tasks.find((t) => t.key === k) as Task;
  return { ws, id, byKey };
}

describe("tasks", () => {
  it("seeds the arena chain with keys, blockedBy ids and profile variations", () => {
    const { byKey, ws, id } = show();
    const keys = ws.get(id).tasks.map((t) => t.key);
    expect(keys).toContain("A6");
    expect(keys).not.toContain("A5");
    expect(keys).not.toContain("S6");
    expect(byKey("L3").blockedBy).toEqual([byKey("A3").id, byKey("L1").id]);
    const fly = seedTasks(ws.get(id), profileFor("fly-date"), newId).map((t) => t.key);
    expect(fly).toContain("A5");
    expect(fly).not.toContain("L1");
    const reh = seedTasks(ws.get(id), profileFor("rehearsal"), newId).map((t) => t.key);
    expect(reh).not.toContain("C4");
    expect(reh).not.toContain("P1");
  });

  it("consumes / blockedBy derive blocked with labelled blockers and routes", () => {
    const { ws, id, byKey } = show();
    const a3 = byKey("A3");
    expect(a3.status).toBe("blocked");
    const b = ws.get(id).derived.tasks[a3.id].blockers;
    expect(b[0]).toMatchObject({ kind: "task", route: "advance" });
    expect(b[0].label).toMatch(/A1/);
  });

  it("produces closes automatically, a late change reopens and files TSK-001", () => {
    const { ws, id, byKey } = show();
    ws.patch(id, "shell", [{ op: "replace", path: "/event/dates", value: ["2026-11-14"] }, { op: "replace", path: "/event/venueName", value: "Bridgestone" }], "identify");
    expect(byKey("A1").status).toBe("done");
    expect(byKey("A3").status).toBe("todo");
    ws.patch(id, "shell", [{ op: "replace", path: "/event/power/amps", value: 400 }], "power");
    expect(byKey("A3").status).toBe("done");
    ws.patch(id, "shell", [{ op: "replace", path: "/event/power/amps", value: 200 }], "power drop");
    expect(byKey("A3").status).toBe("done");
    const tsk = ws.get(id).binder.checks.find((c) => c.code === "TSK-001");
    expect(tsk).toBeTruthy();
    expect(tsk!.message).toMatch(/L3|C4/);
    ws.patch(id, "shell", [{ op: "replace", path: "/event/power/amps", value: null }], "power cleared");
    const a3 = byKey("A3");
    expect(a3.status).toBe("doing");
    expect(a3.history.at(-1)!.note).toMatch(/reopened/);
  });

  it("Confirmed leaves count when confirmed or assumed; waived goes na", () => {
    const { ws, id, byKey } = show();
    const r = ws.get(id);
    expect(evalCondition(r, { kind: "path-set", path: "/event/rigging/maxTrim_ft" })).toBe(false);
    ws.patch(id, "shell", [{ op: "replace", path: "/event/rigging/maxTrim_ft", value: { value: 40, state: "asked" } }], "asked");
    expect(byKey("A4").status).not.toBe("done");
    ws.patch(id, "shell", [{ op: "replace", path: "/event/rigging/maxTrim_ft", value: { value: 40, state: "assumed" } }], "assumed");
    expect(byKey("A4").status).toBe("done");
    expect(ws.get(id).binder.checks.some((c) => c.code === "BND-005" && !c.resolved)).toBe(true);
    ws.patch(id, "shell", [{ op: "replace", path: "/event/rigging/maxTrim_ft", value: { value: null, state: "waived" } }], "waived");
    expect(byKey("A4").status).toBe("na");
  });

  it("owner follows the role", () => {
    const { ws, id, byKey } = show();
    ws.patch(id, "shell", [{ op: "replace", path: "/crew/eic", value: "Sam" }], "eic");
    expect(byKey("A3").history.at(-1)!.note).toMatch(/owner eic: — → Sam/);
  });

  it("count-min with a class query", () => {
    const { ws, id } = show();
    expect(evalCondition(ws.get(id), { kind: "count-min", path: "/devices?class=camera", min: 1 })).toBe(false);
  });
});
