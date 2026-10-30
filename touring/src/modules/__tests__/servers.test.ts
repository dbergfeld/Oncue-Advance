import { describe, expect, it } from "vitest";
import { instantiate, library } from "../../library/library";
import type { CheckDraft } from "../../store/types";
import { setCanvas } from "../led";
import { addServerPair, assignOutputs, renderServerOutputs, seedServers, serversModule, syncContentSpecs, validateServers } from "../servers";
import { ctx, exampleRecord, newId, workspace } from "./harness";

const codes = (cs: CheckDraft[]) => cs.map((c) => c.code).sort();

function explained(c: CheckDraft) {
  expect(c.title && c.target && c.message && c.rule).toBeTruthy();
  expect(c.message).not.toMatch(/\b(dev|srv|wall|p)_[a-z0-9]+/);
  expect(c.evidence!.length).toBeGreaterThan(0);
  for (const e of c.evidence!) expect(e.label && e.value && e.path).toBeTruthy();
  expect(c.fixes!.length).toBeGreaterThan(0);
}

describe("servers validate on the example fixture", () => {
  it("raises no SRV-002/003/004/005; SRV-001 reports the 2400×672 content spec vs the library-derived 2600×1456 wall", () => {
    const r = exampleRecord();
    const checks = validateServers(r, ctx({ dualServerExpected: true }));
    expect(codes(checks)).toEqual(["SRV-001"]);
    const c = checks[0];
    expect(c).toMatchObject({ severity: "warn", target: "wall_us" });
    expect(c.message).toBe("US Wall content is built at 2,400×672 px but the wall is 2,600×1,456 px.");
    explained(c);
    // The attached fix rebuilds the content spec from wall px.
    expect(c.fixes![0].patch).toEqual(syncContentSpecs(r));
  });

  it("syncContentSpecs clears SRV-001 through the store as the servers writer", () => {
    const t = workspace();
    expect(t.get().binder.checks.filter((c) => c.module === "servers").map((c) => c.code)).toEqual(["SRV-001"]);
    expect(t.ws.patch(t.id, "servers", syncContentSpecs(t.get()), "sync").ok).toBe(true);
    expect(t.get().servers.content.contentSpecs).toEqual([{ wallId: "wall_us", w_px: 2600, h_px: 1456, codec: "HAP", fps: 59.94 }]);
    expect(t.get().binder.checks.filter((c) => c.module === "servers" && !c.resolved)).toEqual([]);
    // LED canvas fix is the led writer's to make, not servers'.
    expect(t.ws.patch(t.id, "servers", setCanvas(t.get()), "x").errors?.[0].code).toBe("E_NOT_OWNER");
  });
});

describe("servers checks", () => {
  it("SRV-002 blocks an output the processor / LED input does not take", () => {
    const r = exampleRecord();
    r.servers.hosts[0].outputs[0].resolution = "1920x1080";
    const c = validateServers(r, ctx()).find((x) => x.code === "SRV-002")!;
    expect(c).toMatchObject({ severity: "block", target: "p_srvA_out1" });
    expect(c.rule).toBe("LED input format is 3840x2160p59.94; the output is 1920x1080p59.94.");
    explained(c);
    expect(c.fixes![0].patch).toEqual([
      { op: "replace", path: "/servers/hosts/srv_a/outputs/0/resolution", value: "3840x2160" },
      { op: "replace", path: "/servers/hosts/srv_a/outputs/0/refresh", value: 59.94 },
    ]);
    // A processor whose accepted list excludes the raster also blocks, even with no LED input format set.
    const r2 = exampleRecord();
    r2.signal.formats.ledInput = "";
    r2.devices.find((d) => d.id === "dev_proc1")!.spec = { acceptedFormats: ["1080p59.94"] };
    expect(validateServers(r2, ctx()).find((x) => x.code === "SRV-002")!.rule).toContain("PROC-1 accepts 1920x1080p59.94");
  });

  it("SRV-003 warns on a master with no failover when the profile expects dual servers", () => {
    const r = exampleRecord();
    r.servers.hosts[0].failover = null;
    expect(codes(validateServers(r, ctx()))).not.toContain("SRV-003");
    const c = validateServers(r, ctx({ dualServerExpected: true })).find((x) => x.code === "SRV-003")!;
    expect(c).toMatchObject({ severity: "warn", target: "srv_a" });
    expect(c.fixes![0].patch).toEqual([{ op: "replace", path: "/servers/hosts/srv_a/failover", value: "srv_b" }]);
    explained(c);
  });

  it("SRV-004 warns on an output with no wall, and assignOutputs fixes it", () => {
    const r = exampleRecord();
    r.servers.hosts[1].outputs[0].feedsWallId = null;
    const c = validateServers(r, ctx()).find((x) => x.code === "SRV-004")!;
    expect(c).toMatchObject({ severity: "warn", target: "p_srvB_out1" });
    explained(c);
    expect(assignOutputs(r)).toEqual(c.fixes![0].patch);
    expect(assignOutputs(r)).toEqual([{ op: "replace", path: "/servers/hosts/srv_b/outputs", value: [{ portId: "p_srvB_out1", resolution: "3840x2160", refresh: 59.94, feedsWallId: "wall_us" }] }]);
  });

  it("SRV-005 warns on a genlock server with no sync generator; a tcGen clears it", () => {
    const r = exampleRecord();
    expect(codes(validateServers(r, ctx()))).not.toContain("SRV-005"); // fixture servers carry no genlock spec
    const vx = instantiate(library.get("tpl_disguise_vx2")!, "SRV-C", newId);
    r.devices.push(vx);
    const c = validateServers(r, ctx()).find((x) => x.code === "SRV-005")!;
    expect(c).toMatchObject({ severity: "warn", target: vx.id });
    explained(c);
    r.devices.push(instantiate(library.get("tpl_evertz_5601")!, "SYNC-1", newId));
    expect(codes(validateServers(r, ctx()))).not.toContain("SRV-005");
  });
});

describe("servers seed and helpers", () => {
  it("seeds SRV-A master + SRV-B backup disguise vx 2 paired via failover, HAP content per wall at house fps", () => {
    const t = workspace({ blank: true });
    t.ws.patch(t.id, "shell", [{ op: "replace", path: "/name", value: "x" }], "noop");
    const ops = seedServers(t.get(), { newId });
    const res = t.ws.patch(t.id, "servers", ops, "seed");
    expect(res.errors ?? []).toEqual([]);
    const r = t.get();
    const [a, b] = r.servers.hosts;
    expect(r.devices.map((d) => d.label)).toEqual(["SRV-A", "SRV-B"]);
    expect(r.devices.every((d) => d.templateId === "tpl_disguise_vx2" && d.class === "server")).toBe(true);
    expect(a).toMatchObject({ role: "master", platform: "disguise", timecode: "LTC", failover: b.id });
    expect(b).toMatchObject({ role: "backup", failover: null });
    expect(a.outputs).toHaveLength(1);
    expect(a.outputs[0].feedsWallId).toBeNull();
    expect(serversModule.seed(r, { newId, profile: "arena" })).toEqual([]);
  });

  it("addServerPair picks the next free letters and feeds every wall; syncContentSpecs sizes each wall", () => {
    const r = exampleRecord();
    const ops = addServerPair(r, newId, "tpl_disguise_vx4");
    const devs = ops.filter((o) => o.path === "/devices/-").map((o) => (o as { value: { label: string } }).value.label);
    expect(devs).toEqual(["SRV-C", "SRV-D"]);
    const hosts = ops.filter((o) => o.path === "/servers/hosts/-").map((o) => (o as { value: { outputs: { feedsWallId: string }[]; role: string } }).value);
    expect(hosts.map((h) => h.role)).toEqual(["master", "backup"]);
    expect(hosts[0].outputs.map((o) => o.feedsWallId)).toEqual(["wall_us"]);
    const t = workspace();
    expect(t.ws.patch(t.id, "servers", addServerPair(t.get(), newId), "pair").errors ?? []).toEqual([]);
  });

  it("exports server outputs CSV", () => {
    const csv = renderServerOutputs(exampleRecord()).split("\n");
    expect(csv[1]).toBe("SRV-A,disguise,master,SRV-A DP OUT 1,3840x2160,59.94,US Wall,SRV-B,LTC");
  });
});
