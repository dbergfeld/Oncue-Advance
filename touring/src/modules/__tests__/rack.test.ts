import { describe, expect, it } from "vitest";
import { instantiate, library } from "../../library/library";
import type { CheckDraft, Device } from "../../store/types";
import { addRack, autoRack, deriveRack, firstFreeRu, placeDevice, rackModule, renderRackElevation, seedRack, unplaceDevice, validateRack } from "../rack";
import { exampleRecord, newId, workspace } from "./harness";

const codes = (cs: CheckDraft[]) => cs.map((c) => c.code).sort();

function explained(c: CheckDraft) {
  expect(c.title && c.target && c.message && c.rule).toBeTruthy();
  expect(c.message).not.toMatch(/\b(dev|rack|p)_[a-z0-9]+/);
  expect(c.evidence!.length).toBeGreaterThan(0);
  for (const e of c.evidence!) expect(e.label && e.value && e.path).toBeTruthy();
  expect(c.fixes!.length).toBeGreaterThan(0);
}

describe("rack derive", () => {
  it("rolls up the example fixture's VIDEO 1", () => {
    const d = deriveRack(exampleRecord());
    // PDU 1 + SX40 2 + Carbonite 3 + 2 × vx 2 at 4 RU
    expect(d.racks.byRack.rack_v1).toEqual({ ruUsed: 14, weightLb: 22 + 30 + 45 + 45 + 8, powerW: 2350, amps: 19.58 });
    expect(d.inventory.deviceCount).toBe(6);
    // 1 rack + 1 distro case + ceil(175 CB5 / 8 per dolly) = 22 dollies
    expect(d.inventory.caseCount).toBe(1 + 1 + 22);
  });
});

describe("rack validate", () => {
  it("raises no rack checks on the example fixture — 2,350 W on L21-30 is within rating (no RCK-003)", () => {
    expect(validateRack(exampleRecord())).toEqual([]);
    const t = workspace();
    expect(t.get().binder.checks.filter((c) => c.module === "rack")).toEqual([]);
  });

  it("RCK-003 warns once rack W ÷ V passes 0.8 × inlet amps", () => {
    const r = exampleRecord();
    r.devices.find((d) => d.id === "dev_sw1")!.powerW = 600; // 2,650 W ÷ 120 V = 22.1 A ≤ 24 A
    expect(codes(validateRack(r))).toEqual([]);
    r.devices.find((d) => d.id === "dev_sw1")!.powerW = 700; // 2,750 W → 22.9 A
    r.devices.find((d) => d.id === "dev_proc1")!.powerW = 650; // 2,950 W → 24.6 A
    const c = validateRack(r).find((x) => x.code === "RCK-003")!;
    expect(c).toMatchObject({ severity: "warn", target: "rack_v1", title: "Over inlet rating" });
    expect(c.rule).toBe("Rack W ÷ V must be ≤ 0.8 × inlet amps; 2,950 W ÷ 120 V = 24.6 A > 0.8 × 30 A = 24 A.");
    explained(c);
  });

  it("RCK-001 overlap with a move patch, RCK-002 overflow, RCK-004 unracked, RCK-005 no PDU", () => {
    const r = exampleRecord();
    r.racks[0].slots.find((s) => s.deviceId === "dev_srvB")!.ru = 12; // SRV-A spans 10–13
    const c1 = validateRack(r).find((x) => x.code === "RCK-001")!;
    expect(c1).toMatchObject({ severity: "block", target: "dev_srvB" });
    expect(c1.message).toBe("SRV-B and SRV-A both occupy RU 12, 13 in VIDEO 1.");
    explained(c1);
    expect(c1.fixes![0].patch).toBeDefined();

    const r2 = exampleRecord();
    r2.racks[0].slots.find((s) => s.deviceId === "dev_srvB")!.ru = 22; // 22–25 on a 24 RU rack
    const c2 = validateRack(r2).find((x) => x.code === "RCK-002")!;
    expect(c2).toMatchObject({ severity: "block", target: "rack_v1" });
    explained(c2);

    const r3 = exampleRecord();
    r3.devices.push({ ...instantiate(library.get("tpl_bmd_hyperdeck_4kpro")!, "REC-1", newId) });
    const c4 = validateRack(r3).find((x) => x.code === "RCK-004")!;
    expect(c4).toMatchObject({ severity: "info", title: "Unracked device" });
    expect(c4.fixes![0].label).toBe("Place REC-1 in VIDEO 1 at RU 2");
    explained(c4);

    const r5 = exampleRecord();
    r5.racks[0].slots = r5.racks[0].slots.filter((s) => s.deviceId !== "dev_pdu1");
    r5.racks[0].power.pduIds = [];
    const c5 = validateRack(r5).find((x) => x.code === "RCK-005")!;
    expect(c5).toMatchObject({ severity: "warn", target: "rack_v1" });
    explained(c5);
  });
});

describe("rack helpers under the store's ownership gates", () => {
  it("placeDevice writes rackId on another module's device via the allowlist; firstFreeRu skips occupied RUs", () => {
    const t = workspace();
    const rec = instantiate(library.get("tpl_bmd_hyperdeck_4kpro")!, "REC-1", newId);
    expect(t.ws.patch(t.id, "signal", [{ op: "add", path: "/devices/-", value: rec }], "add recorder").ok).toBe(true);
    expect(t.get().binder.checks.some((c) => c.code === "RCK-004" && c.target === rec.id)).toBe(true);
    expect(firstFreeRu(t.get(), "rack_v1", 1)).toBe(2);
    expect(firstFreeRu(t.get(), "rack_v1", 4)).toBe(19);
    const res = t.ws.patch(t.id, "rack", placeDevice(t.get(), rec.id, "rack_v1", 2), "place recorder");
    expect(res.errors ?? []).toEqual([]);
    const r = t.get();
    expect(r.devices.find((d) => d.id === rec.id)!.rackId).toBe("rack_v1");
    expect(r.racks[0].slots.find((s) => s.deviceId === rec.id)!.ru).toBe(2);
    expect(r.derived.racks.byRack.rack_v1.ruUsed).toBe(15);
    expect(r.binder.checks.filter((c) => c.code === "RCK-004" && !c.resolved)).toHaveLength(0);

    expect(t.ws.patch(t.id, "rack", unplaceDevice(t.get(), rec.id), "unplace").ok).toBe(true);
    expect(t.get().devices.find((d) => d.id === rec.id)!.rackId).toBeNull();
    expect(t.get().racks[0].slots.some((s) => s.deviceId === rec.id)).toBe(false);
  });

  it("autoRack places unracked gear first-fit and adds racks as needed", () => {
    const t = workspace({ blank: true });
    const devs: Device[] = [];
    for (let i = 1; i <= 7; i++) devs.push(instantiate(library.get("tpl_disguise_vx2")!, `SRV-${i}`, newId));
    expect(t.ws.patch(t.id, "servers", devs.map((d) => ({ op: "add" as const, path: "/devices/-", value: d })), "servers").ok).toBe(true);
    expect(t.ws.patch(t.id, "rack", addRack(t.get(), "VIDEO 1", newId), "rack").ok).toBe(true);
    const res = t.ws.patch(t.id, "rack", autoRack(t.get(), newId), "auto rack");
    expect(res.errors ?? []).toEqual([]);
    const r = t.get();
    expect(r.racks.map((k) => k.name)).toEqual(["VIDEO 1", "VIDEO 2"]);
    expect(r.racks[0].slots.map((s) => s.ru)).toEqual([1, 5, 9, 13, 17, 21]);
    expect(r.racks[1].slots).toHaveLength(1);
    expect(r.devices.every((d) => d.rackId)).toBe(true);
    expect(validateRack(r).filter((c) => c.code !== "RCK-005" && c.code !== "RCK-003")).toEqual([]);
    expect(autoRack(r, newId)).toEqual([]);
  });

  it("seed adds VIDEO 1 (24 RU, L21-30) with a SurgeX PDU at RU 1, once", () => {
    const t = workspace({ blank: true });
    expect(t.ws.patch(t.id, "rack", seedRack(t.get(), { newId }), "seed").ok).toBe(true);
    const r = t.get();
    expect(r.racks).toHaveLength(1);
    expect(r.racks[0]).toMatchObject({ name: "VIDEO 1", ruTotal: 24, power: { inlet: "L21-30" } });
    const pdu = r.devices.find((d) => d.class === "rackPdu")!;
    expect(pdu).toMatchObject({ make: "SurgeX", model: "SX-1120-RT", label: "PDU-1", rackId: r.racks[0].id });
    expect(r.racks[0].slots).toEqual([{ ru: 1, deviceId: pdu.id }]);
    expect(r.racks[0].power.pduIds).toEqual([pdu.id]);
    expect(rackModule.seed(r, { newId, profile: "arena" })).toEqual([]);
  });

  it("exports a rack elevation CSV", () => {
    const csv = renderRackElevation(exampleRecord()).split("\n");
    expect(csv[0]).toBe("Rack,Rack RU,RU,Span,Device,Make,Model,Class,Height RU,Power W,Weight lb");
    expect(csv[1]).toBe("VIDEO 1,24,15,15-18,SRV-B,disguise,vx 2,server,4,800,45");
    expect(csv).toContain("VIDEO 1,24,1,1,PDU-1,SurgeX,SX-1120-RT,rackPdu,1,0,8");
  });
});
