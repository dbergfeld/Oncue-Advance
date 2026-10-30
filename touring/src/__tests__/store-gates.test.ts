// Store gates (Shared Show Record tab): ownership, frozen states, concurrency, references, lifecycle.
import { describe, expect, it } from "vitest";
import { library, LIBRARY } from "../library/library";
import { binderModule } from "../modules/binder";
import { loadExample } from "../setup/example";
import { memoryPersist } from "../store/persist";
import { profileFor } from "../store/profiles";
import { binderSummary, readiness } from "../store/readiness";
import { Workspace, type Engine } from "../store/store";
import { deriveTasks } from "../store/tasks";
import type { Device, ShowRecord } from "../store/types";

// Gates are store-level: a binder-only engine keeps these tests independent of the module ports.
const gateEngine: Engine = { modules: [binderModule], library, libraryVersion: LIBRARY.libraryVersion, profileFor, deriveTasks, readiness, binderSummary };

function dev(id: string, cls: Device["class"], label: string, extra: Partial<Device> = {}): Device {
  return { id, class: cls, make: "X", model: "Y", label, qty: 1, rackId: null, ru: 0, powerW: 0, weightLb: 0, ports: [], inventoryRef: {}, ...extra };
}

function setup() {
  const ws = new Workspace(gateEngine, memoryPersist());
  const r = ws.createShow({ artist: "Gate Test", year: 2026 });
  const id = r.showId;
  expect(ws.patch(id, "rack", [{ op: "add", path: "/racks/-", value: { id: "rack_a1", name: "VIDEO 1", ruTotal: 24, caseModel: "", location: "video world", slots: [], power: { inlet: "L21-30", pduIds: [], circuitIds: [] } } }], "add rack").ok).toBe(true);
  expect(ws.patch(id, "signal", [{ op: "add", path: "/devices/-", value: dev("dev_sw1", "switcher", "SW-1") }], "add switcher").ok).toBe(true);
  return { ws, id };
}
const code = (res: { errors?: { code: string }[] }) => res.errors?.[0]?.code;

describe("store gates", () => {
  it("E_NOT_OWNER: a module writing another module's slice", () => {
    const { ws, id } = setup();
    expect(code(ws.patch(id, "led", [{ op: "replace", path: "/signal/formats/house", value: "720p" }], "x"))).toBe("E_NOT_OWNER");
    expect(code(ws.patch(id, "rack", [{ op: "replace", path: "/name", value: "x" }], "x"))).toBe("E_NOT_OWNER");
    expect(ws.get(id).signal.formats.house).toBe("");
  });

  it("E_CLASS_OWNER: devices are shared-write by class", () => {
    const { ws, id } = setup();
    expect(code(ws.patch(id, "led", [{ op: "add", path: "/devices/-", value: dev("dev_cam1", "camera", "CAM 1") }], "x"))).toBe("E_CLASS_OWNER");
    expect(code(ws.patch(id, "led", [{ op: "replace", path: "/devices/dev_sw1/label", value: "SW-X" }], "x"))).toBe("E_CLASS_OWNER");
    // Rack's rackId / ru allowlist on a device it does not own.
    expect(ws.patch(id, "rack", [{ op: "replace", path: "/devices/dev_sw1/rackId", value: "rack_a1" }, { op: "replace", path: "/devices/dev_sw1/ru", value: 2 }], "rack it").ok).toBe(true);
  });

  it("E_LANE_OWNER: tasks are shared-write by lane", () => {
    const { ws, id } = setup();
    const task = { id: "task_x1", lane: "led", title: "x", status: "todo", about: [], blockedBy: [], source: "user", history: [] };
    expect(code(ws.patch(id, "signal", [{ op: "add", path: "/tasks/-", value: task }], "x"))).toBe("E_LANE_OWNER");
    expect(() => ws.api(id, "signal").task({ lane: "crew", title: "y", status: "todo", about: [], blockedBy: [] })).toThrow(/E_LANE_OWNER/);
    expect(ws.patch(id, "led", [{ op: "add", path: "/tasks/-", value: task }], "x").ok).toBe(true);
  });

  it("E_STALE: ifHash must match the entity's current hash", () => {
    const { ws, id } = setup();
    const api = ws.api(id, "signal");
    const h = api.hash("/devices/dev_sw1");
    expect(api.patch([{ op: "replace", path: "/devices/dev_sw1/label", value: "SW-2", ifHash: h }], "rename").ok).toBe(true);
    expect(code(api.patch([{ op: "replace", path: "/devices/dev_sw1/label", value: "SW-3", ifHash: h }], "rename again"))).toBe("E_STALE");
    expect(ws.get(id).devices.find((d) => d.id === "dev_sw1")!.label).toBe("SW-2");
  });

  it("E_REF_MISSING and E_REF_TYPE", () => {
    const { ws, id } = setup();
    expect(code(ws.patch(id, "rack", [{ op: "replace", path: "/devices/dev_sw1/rackId", value: "rack_nope" }], "x"))).toBe("E_REF_MISSING");
    expect(code(ws.patch(id, "rack", [{ op: "replace", path: "/devices/dev_sw1/rackId", value: "wall_a1" }], "x"))).toBe("E_REF_TYPE");
  });

  it("E_LABEL_DUP: labels are unique within a collection", () => {
    const { ws, id } = setup();
    expect(code(ws.patch(id, "signal", [{ op: "add", path: "/devices/-", value: dev("dev_sw2", "switcher", "sw-1") }], "x"))).toBe("E_LABEL_DUP");
  });

  it("E_ORPHAN_DELETE without cascade; cascade nulls the reference", () => {
    const { ws, id } = setup();
    ws.patch(id, "rack", [{ op: "replace", path: "/devices/dev_sw1/rackId", value: "rack_a1" }], "rack it");
    expect(code(ws.patch(id, "rack", [{ op: "remove", path: "/racks/rack_a1" }], "drop rack"))).toBe("E_ORPHAN_DELETE");
    const res = ws.patch(id, "rack", [{ op: "remove", path: "/racks/rack_a1" }], "drop rack", { cascade: true });
    expect(res.ok).toBe(true);
    const r = ws.get(id);
    expect(r.racks).toHaveLength(0);
    expect(r.devices.find((d) => d.id === "dev_sw1")!.rackId).toBeNull();
    expect(r.meta.changelog.some((c) => c.reason.startsWith("cascade:"))).toBe(true);
  });

  it("E_FROZEN after issue; annotations and checks stay writable", () => {
    const { ws, id } = setup();
    expect(ws.issueShow(id).ok).toBe(true);
    expect(code(ws.patch(id, "shell", [{ op: "replace", path: "/name", value: "late" }], "x"))).toBe("E_FROZEN");
    expect(code(ws.patch(id, "signal", [{ op: "replace", path: "/signal/formats/house", value: "720p" }], "x"))).toBe("E_FROZEN");
    expect(() => ws.api(id, "led").annotate("dev_sw1", "note after issue")).not.toThrow();
    expect(() => ws.api(id, "led").check({ severity: "warn", target: "dev_sw1", message: "late finding" })).not.toThrow();
  });

  it("issueShow is refused with unresolved block checks", () => {
    const { ws, id } = setup();
    ws.api(id, "signal").check({ code: "NOTE", severity: "block", target: "dev_sw1", message: "cannot ship" });
    const res = ws.issueShow(id);
    expect(res.ok).toBe(false);
    expect(res.errors!.map((e) => e.code)).toContain("E_BLOCKED");
  });

  it("issueShow is refused for an example show", () => {
    const ws = new Workspace(gateEngine, memoryPersist());
    const ex = loadExample(ws);
    expect(ex.meta.source).toBe("example");
    expect(ws.issueShow(ex.showId).errors!.map((e) => e.code)).toContain("E_SOURCE");
  });

  it("reviseShow carries unresolved checks forward and drops resolved ones", () => {
    const { ws, id } = setup();
    expect(ws.issueShow(id).ok).toBe(true);
    const api = ws.api(id, "signal");
    const keep = api.check({ code: "NOTE", severity: "warn", target: "dev_sw1", message: "still open" });
    const gone = api.check({ code: "NOTE", severity: "warn", target: "rack_a1", message: "will resolve" });
    expect(ws.api(id, "binder").resolveCheck(gone, "accepted-risk", "fine for rev 1").ok).toBe(true);
    expect(ws.reviseShow(id, "add IMAG").ok).toBe(true);
    const r = ws.get(id);
    expect(r.meta.status).toBe("draft");
    expect(r.meta.revision).toBe(2);
    expect(r.binder.checks.some((c) => c.id === keep)).toBe(true);
    expect(r.binder.checks.some((c) => c.id === gone)).toBe(false);
    expect(r.meta.changelog.at(-1)).toMatchObject({ rev: 2, from: 1, reason: "add IMAG" });
  });

  it("copyShow mints new ids throughout and gets a new showId", () => {
    const ws = new Workspace(gateEngine, memoryPersist());
    const ex = loadExample(ws);
    const cp = ws.copyShow(ex.showId);
    expect(cp.showId).not.toBe(ex.showId);
    expect(cp.meta.source).toBe("copy");
    const ids = (r: ShowRecord) => new Set(JSON.stringify(r).match(/"(?:dev|p|cab|wall|ckt|sig|lnk|rack|srv)_[A-Za-z0-9_]+"/g) ?? []);
    const shared = [...ids(cp)].filter((x) => ids(ex).has(x));
    expect(shared).toEqual([]);
    expect(cp.devices).toHaveLength(ex.devices.length);
    // References still resolve after re-minting.
    expect(cp.led.walls[0].processorIds.every((pid) => cp.devices.some((d) => d.id === pid))).toBe(true);
    expect(cp.event.venueName).toBe("");
  });
});
