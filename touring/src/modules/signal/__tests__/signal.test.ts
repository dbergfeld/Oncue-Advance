import { describe, expect, it } from "vitest";
import { asWorkingCopy } from "../../__tests__/harness";
import example from "../../../fixtures/example-arena.json";
import trunkFixture from "../../../fixtures/trunk-plan-arena.json";
import { instantiate, library } from "../../../library/library";
import { normalize } from "../../../store/blank";
import { profileFor } from "../../../store/profiles";
import { Workspace, type Engine } from "../../../store/store";
import type { CheckDraft, Device, IdPrefix, Patch, ShowRecord } from "../../../store/types";
import { buildGraph, resolveFormats, specResolver } from "../graph";
import { addSignalDevice, autoPatchProgram, connect, converterChain, disconnect } from "../helpers";
import { signalModule } from "../index";
import { applyLocal, deriveSegments, proposeTrunkPlan, seedPhysical, shortestPathChain } from "../physical";
import { compatible, formatFits, normalizeFormat, parseFormat, roundStock, sameFormat } from "../portRules";

let n = 0;
const newId = (p: IdPrefix) => `${p}_t${(n++).toString(36).padStart(4, "0")}`;
const load = (j: unknown) => normalize(structuredClone(j) as ShowRecord);
const arena = profileFor("arena");
const ctx = { profile: arena, library };
const validate = (r: ShowRecord, profile = arena) => signalModule.validate(r, { profile, library });
const find = (cs: CheckDraft[], code: string) => cs.filter((c) => c.code === code);

function workspace() {
  const engine: Engine = {
    modules: [signalModule], library, libraryVersion: "test", profileFor,
    deriveTasks: (r) => ({ tasks: r.tasks, derived: {}, checks: [] }),
    readiness: () => ({ advance: false, criteria: [] }),
    binderSummary: () => ({ completeness: {}, openBySeverity: { block: 0, warn: 0, info: 0 } }),
  };
  return new Workspace(engine, null, () => "2026-10-30T12:00:00.000Z");
}

function dev(id: string, cls: Device["class"], label: string, ports: [string, string, Device["ports"][number]["type"], Device["ports"][number]["dir"]][], extra: Partial<Device> = {}): Device {
  return { id, class: cls, make: "Test", model: label, label, qty: 1, rackId: null, ru: 0, powerW: 0, weightLb: 0, inventoryRef: {},
    ports: ports.map(([pid, name, type, dir]) => ({ id: pid, name, type, dir })), ...extra };
}

describe("port rules", () => {
  it("parses and normalises formats", () => {
    expect(normalizeFormat("3840x2160p59.94")).toBe("2160p59.94");
    expect(normalizeFormat("2160p59.94")).toBe("2160p59.94");
    expect(normalizeFormat("4096x2160p60")).toBe("4096x2160p60");
    expect(sameFormat("3840x2160p59.94", "2160p59.94")).toBe(true);
    expect(sameFormat("1080i59.94", "1080p59.94")).toBe(false);
    expect(parseFormat("720p59.94")).toMatchObject({ w: 1280, h: 720, scan: "p" });
    expect(parseFormat("3840×2160 @ 59.94")).toMatchObject({ w: 3840, h: 2160, rate: 59.94 });
  });

  it("ranks formats and fits them to sinks", () => {
    expect(formatFits("1080p59.94", "3G-SDI").ok).toBe(true);
    expect(formatFits("2160p59.94", "3G-SDI").ok).toBe(false);
    expect(formatFits("1080i59.94", "HD-SDI").ok).toBe(true);
    expect(formatFits("720p59.94", "HD-SDI").ok).toBe(true);
    expect(formatFits("1080p59.94", "HD-SDI").ok).toBe(false);
    expect(formatFits("3840x2160p59.94", "HDMI2.0").ok).toBe(true);
  });

  it("is a data matrix: compatible() returns cable type and max format", () => {
    expect(compatible("12G-SDI", "3G-SDI")).toMatchObject({ cableType: "SDI", maxFormat: "1080p60", severity: "block" });
    expect(compatible("DP1.4", "HDMI2.0")?.cableType).toBe("DP-HDMI");
    expect(compatible("fiber-SMPTE", "fiber-SMPTE")?.cableType).toBe("SMPTE-311");
    expect(compatible("DP1.4", "12G-SDI")).toBeNull();
    expect(compatible("LTC", "LTC")?.cableTypes).toEqual(["audio-TRS", "BNC"]);
  });

  it("rounds to stock and flags over-stock", () => {
    expect(roundStock("SDI", 182.5)).toMatchObject({ stock: 200, over: false });
    expect(roundStock("fiber", 182.5)).toMatchObject({ stock: 250, over: false });
    expect(roundStock("SDI", 300)).toMatchObject({ stock: 250, over: true });
    expect(roundStock("SMPTE-311", 120).stock).toBe(164);
  });
});

describe("example arena fixture (first tab acceptance)", () => {
  const r = load(example);
  const checks = validate(r);

  it("emits the expected signal warnings and no signal blocks", () => {
    // No B path into PROC-1 while SRV-B is the backup for US Wall: SIG-009 (redundancy[] is empty, so
    // there is no group for SIG-008 to test). SRV-B DP OUT 1 has feedsWallId and no cable: SIG-007.
    const spof = find(checks, "SIG-009");
    expect(spof).toHaveLength(1);
    expect(spof[0]).toMatchObject({ severity: "warn", target: "wall_us" });
    expect(spof[0].message).toContain("no B path to PROC-1");
    const srv = find(checks, "SIG-007");
    expect(srv).toHaveLength(1);
    expect(srv[0]).toMatchObject({ severity: "warn", target: "p_srvB_out1" });
    expect(srv[0].message).toMatch(/SRV-B DP OUT 1 is set to feed US Wall but no cable/);
    expect(srv[0].rule).toContain("feedsWallId");
    expect(checks.filter((c) => c.severity === "block")).toEqual([]);
    expect(checks.filter((c) => c.severity === "warn").map((c) => c.code).sort()).toEqual(["SIG-007", "SIG-009"]);
  });

  it("still flags missing redundancy when the profile does not expect it but a backup server feeds the wall", () => {
    const cs = validate(r, profileFor("rehearsal"));
    expect(find(cs, "SIG-009")).toHaveLength(1);
  });

  it("messages use labels, never ids, and evidence carries paths", () => {
    for (const c of checks) {
      expect(c.message).not.toMatch(/\b(dev|p|cab|lnk|wall|srv)_[a-z0-9]/i);
      expect(c.rule).toBeTruthy();
      for (const e of c.evidence ?? []) expect(e.path).toBeTruthy();
      expect(c.fixes?.length).toBeGreaterThan(0);
    }
  });

  it("derives resolved formats, mismatches and inventory", () => {
    const d = signalModule.derive(r);
    expect(d.signal?.resolvedFormat.lnk_pgm).toBe("1080p59.94");
    expect(sameFormat(d.signal!.resolvedFormat.lnk_srv_proc, "3840x2160p59.94")).toBe(true);
    expect(d.signal?.formatMismatches).toEqual([]);
    expect(d.signal?.unresolvedPorts).toEqual([]);
    expect(d.inventory?.cableCountByType).toMatchObject({ "SDI 10ft": 1, "SDI 6ft": 1, "fiberLED 150ft": 1 });
  });

  it("runs clean through the store under the signal writer", () => {
    const ws = workspace();
    const rec = ws.importRecord(asWorkingCopy(example));
    const open = rec.binder.checks.filter((c) => c.module === "signal" && !c.resolved).map((c) => c.code).sort();
    expect(open).toContain("SIG-007");
    expect(open).toContain("SIG-009");
  });
});

describe("worked examples (Signal graph tab)", () => {
  it("SIG-004 · 2160p59.94 into a 3G-SDI monitor input blocks with ranked fixes", () => {
    const r = load(example);
    const srvA = r.devices.find((d) => d.id === "dev_srvA")!;
    srvA.ports.push({ id: "p_srvA_sdi2", name: "SDI OUT 2", type: "12G-SDI", dir: "out" });
    r.servers.hosts[0].outputs.push({ portId: "p_srvA_sdi2", resolution: "3840x2160", refresh: 59.94, feedsWallId: null });
    r.devices.push(dev("dev_mon1", "monitor", "MON-1", [["p_mon1_in", "SDI IN", "3G-SDI", "in"]]));
    r.cables.push({ id: "cab_srvA_mon1", type: "SDI", length_ft: 25, fromPort: "p_srvA_sdi2", toPort: "p_mon1_in", label: "SDI-020", redundancyGroup: null });
    r.signal.links.push({ id: "lnk_mon", cableId: "cab_srvA_mon1", format: "", path: "A", label: "MON FEED" });
    const c = find(validate(r), "SIG-004");
    expect(c).toHaveLength(1);
    expect(c[0].severity).toBe("block");
    expect(c[0].target).toBe("lnk_mon");
    expect(c[0].message).toBe("SRV-A SDI OUT 2 → MON-1 SDI IN is carrying 2160p59.94 into a 3G-SDI input that accepts up to 1080p60.");
    expect(c[0].rule).toBe("3G-SDI accepts ≤ 1080p60; arriving format 2160p59.94 (inherited from SRV-A output).");
    expect(c[0].evidence![0]).toMatchObject({ value: "3840×2160 @ 59.94", path: "/servers/hosts/srv_a/outputs/1" });
    expect(c[0].evidence![1].path).toBe("/devices/dev_mon1/ports/p_mon1_in");
    expect(c[0].fixes!.map((f) => f.module)).toEqual(["signal", "servers", "signal"]);
    expect(c[0].fixes![0].label).toBe("Feed MON-1 from SW-1 PGM OUT instead");
  });

  it("SIG-004 · a 12G 4K source into a 3G sink is blocked by the matrix row", () => {
    const r = load(example);
    r.devices.push(dev("dev_cam1", "camera", "CAM 1", [["p_cam1_out", "12G OUT", "12G-SDI", "out"]]));
    r.devices.push(dev("dev_rec1", "recorder", "REC-1", [["p_rec1_in", "SDI IN", "3G-SDI", "in"]]));
    r.cables.push({ id: "cab_cam_rec", type: "SDI", length_ft: 50, fromPort: "p_cam1_out", toPort: "p_rec1_in", label: "SDI-030", redundancyGroup: null });
    r.signal.links.push({ id: "lnk_cam_rec", cableId: "cab_cam_rec", format: "2160p59.94", path: "A", label: "CAM 1" });
    const cs = validate(r);
    expect(find(cs, "SIG-004")[0]).toMatchObject({ severity: "block", target: "lnk_cam_rec" });
    expect(find(cs, "SIG-004")[0].rule).toContain("1080p60");
    // The recorder sees CAM 1, not program.
    expect(find(cs, "SIG-013")).toHaveLength(1);
    expect(signalModule.derive(r).signal?.formatMismatches).toContain("lnk_cam_rec");
  });

  it("SIG-008 · A and B through one XD is a single point of failure (the processor itself is the shared terminal)", () => {
    const r = load(example);
    const proc = r.devices.find((d) => d.id === "dev_proc1")!;
    proc.ports.push({ id: "p_proc1_in2", name: "HDMI IN 2", type: "HDMI2.0", dir: "in" });
    r.devices.push(dev("dev_xd1", "processor", "XD-1", [["p_xd1_in1", "10G IN 1", "fiberLED", "in"], ["p_xd1_out1", "1G OUT 1", "etherCon", "out"]], { spec: { protocol: "Brompton", formatRule: "pass-through" } }));
    r.cables = r.cables.filter((c) => c.id !== "cab_proc1_wall");
    r.cables.push({ id: "cab_proc_xd", type: "fiberLED", length_ft: 150, fromPort: "p_proc1_out1", toPort: "p_xd1_in1", label: "LED-001", redundancyGroup: null });
    r.cables.push({ id: "cab_srvB_proc1", type: "DP-HDMI", length_ft: 6, fromPort: "p_srvB_out1", toPort: "p_proc1_in2", label: "DPH-001-B", redundancyGroup: "B" });
    r.signal.links.push({ id: "lnk_srvB_proc", cableId: "cab_srvB_proc1", format: "", path: "B", label: "LED FEED B" });
    r.signal.redundancy.push({ id: "rg_pgm_us", name: "PGM to US Wall", primary: ["lnk_srv_proc"], backup: ["lnk_srvB_proc"] });
    const cs = validate(r);
    const c = find(cs, "SIG-008");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ severity: "warn", target: "rg_pgm_us" });
    expect(c[0].message).toBe("Redundancy group PGM to US Wall has A and B paths that both pass through LED-001, XD-1.");
    expect(c[0].involved).toContain("dev_xd1");
    expect(c[0].fixes![0].module).toBe("led");
    expect(c[0].fixes![1]).toMatchObject({ module: "binder" });
    expect(find(cs, "SIG-009")).toHaveLength(0);
    expect(find(cs, "SIG-007")).toHaveLength(0);
    expect(signalModule.derive(r).signal?.singlePoints.sort()).toEqual(["cab_proc_xd", "dev_xd1"]);
  });

  it("SIG-006 · PROC-1 with no inbound link blocks and suggests the DP-HDMI adapter feed", () => {
    const r = load(example);
    r.cables = r.cables.filter((c) => c.id !== "cab_srvA_proc1");
    r.signal.links = r.signal.links.filter((l) => l.id !== "lnk_srv_proc");
    const c = find(validate(r), "SIG-006");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ severity: "block", target: "dev_proc1" });
    expect(c[0].message).toBe("PROC-1 HDMI IN 1 has no incoming signal but PROC-1 drives US Wall.");
    expect(c[0].rule).toContain("0 inbound links");
    expect(c[0].evidence![0].value).toBe("none");
    expect(c[0].fixes![0].label).toBe("Cable SRV-A DP OUT 1 → PROC-1 HDMI IN 1 via DP-HDMI adapter");
    expect(c[0].fixes!.at(-1)).toMatchObject({ module: "led", label: "Remove PROC-1 from US Wall if the wall is not in use" });
  });
});

describe("graph checks", () => {
  it("SIG-001 · dangling cable offers a safe delete patch that clears it", () => {
    const r = load(example);
    r.cables.push({ id: "cab_ghost", type: "SDI", length_ft: 10, fromPort: "p_sw1_pgm2", toPort: "p_srvB_gone", label: "SDI-099", redundancyGroup: null });
    r.signal.links.push({ id: "lnk_ghost", cableId: "cab_ghost", format: "1080p59.94", path: "A", label: "GHOST" });
    const cs = find(validate(r), "SIG-001");
    expect(cs).toHaveLength(2);
    expect(cs[0].message).toContain("SDI-099");
    const patch = cs[0].fixes![0].patch!;
    expect(patch).toBeDefined();
    const after = applyLocal(r, patch);
    expect(find(validate(after), "SIG-001")).toHaveLength(0);
    expect(after.signal.links.find((l) => l.id === "lnk_ghost")).toBeUndefined();
    expect(signalModule.derive(r).signal?.unresolvedPorts.sort()).toEqual(["p_srvB_gone", "p_sw1_pgm2"]);
  });

  it("SIG-002 / SIG-003 / SIG-011 / SIG-017", () => {
    const r = load(example);
    r.devices.push(dev("dev_mon2", "monitor", "MON-2", [["p_mon2_in", "SDI IN", "12G-SDI", "in"], ["p_mon2_hdmi", "HDMI IN", "HDMI2.0", "in"]]));
    r.devices.push(dev("dev_cam2", "camera", "CAM 2", [["p_cam2_out", "SDI OUT", "12G-SDI", "out"]]));
    // into an output port (reversed)
    r.cables.push({ id: "cab_rev", type: "SDI", length_ft: 10, fromPort: "p_mon2_in", toPort: "p_cam2_out", label: "SDI-040", redundancyGroup: null });
    // SDI into HDMI: not in the matrix
    r.cables.push({ id: "cab_bad", type: "SDI", length_ft: 10, fromPort: "p_sw1_pgm", toPort: "p_mon2_hdmi", label: "SDI-041", redundancyGroup: null });
    // a long 4K run
    r.devices.push(dev("dev_cam3", "camera", "CAM 3", [["p_cam3_out", "SDI OUT", "12G-SDI", "out"]]));
    r.devices.push(dev("dev_mon3", "monitor", "MON-3", [["p_mon3_in", "SDI IN", "12G-SDI", "in"]]));
    r.cables.push({ id: "cab_long", type: "SDI", length_ft: 300, fromPort: "p_cam3_out", toPort: "p_mon3_in", label: "SDI-042", redundancyGroup: null });
    r.signal.links.push({ id: "lnk_long", cableId: "cab_long", format: "2160p59.94", path: "A", label: "CAM 3" });
    const cs = validate(r);
    const dir = find(cs, "SIG-002")[0];
    expect(dir.message).toBe("SDI-040 leaves MON-2 SDI IN, which is an input.");
    expect(dir.fixes![0].patch).toBeDefined();
    expect(find(cs, "SIG-003").find((c) => c.target === "cab_bad")?.severity).toBe("block");
    expect(find(cs, "SIG-011").map((c) => c.target)).toContain("p_sw1_pgm");
    expect(find(cs, "SIG-017")[0]).toMatchObject({ target: "cab_long", severity: "warn" });
    expect(find(cs, "SIG-017")[0].rule).toContain("230");
  });

  it("SIG-010 · a router → DA → router loop is a chain cycle", () => {
    const r = load(example);
    r.devices.push(dev("dev_rtr", "router", "RTR-1", [["p_rtr_in1", "SDI IN 1", "12G-SDI", "in"], ["p_rtr_out1", "SDI OUT 1", "12G-SDI", "out"]]));
    r.devices.push(dev("dev_da", "converter", "DA-1", [["p_da_in", "SDI IN", "12G-SDI", "in"], ["p_da_out", "SDI OUT 1", "12G-SDI", "out"]]));
    r.cables.push({ id: "cab_r_d", type: "SDI", length_ft: 3, fromPort: "p_rtr_out1", toPort: "p_da_in", label: "SDI-050", redundancyGroup: null });
    r.cables.push({ id: "cab_d_r", type: "SDI", length_ft: 3, fromPort: "p_da_out", toPort: "p_rtr_in1", label: "SDI-051", redundancyGroup: null });
    r.signal.links.push({ id: "lnk_rd", cableId: "cab_r_d", format: "1080p59.94", path: "A", label: "LOOP 1" });
    r.signal.links.push({ id: "lnk_dr", cableId: "cab_d_r", format: "", path: "A", label: "LOOP 2" });
    const c = find(validate(r), "SIG-010");
    expect(c).toHaveLength(1);
    expect(c[0].severity).toBe("block");
    expect(c[0].rule).toMatch(/RTR-1 → DA-1 → RTR-1|DA-1 → RTR-1 → DA-1/);
    // propagation still terminates and the DA passes the router's format through
    const g = buildGraph(r, specResolver(library));
    expect(resolveFormats(g).get("lnk_dr")?.inherited).toBe(true);
  });

  it("SIG-012 protocol, SIG-014 reference, SIG-016 VLAN, SIG-018 orphan", () => {
    const r = load(example);
    r.devices.push(dev("dev_xdn", "processor", "XD-N", [["p_xdn_in", "10G IN", "fiberLED", "in"]], { spec: { protocol: "Novastar", formatRule: "pass-through" } }));
    r.cables.find((c) => c.id === "cab_proc1_wall")!.toPort = "p_xdn_in";
    r.devices.find((d) => d.id === "dev_proc1")!.spec = { protocol: "Brompton", genlock: true };
    r.devices.push(dev("dev_sync", "tcGen", "SYNC-1", [["p_sync_ref", "REF OUT", "genlock", "out"]]));
    r.devices.push(dev("dev_sw2", "switcher", "SW-2", [["p_sw2_net", "NET", "cat6", "bidir"]]));
    r.devices.push(dev("dev_mvw", "monitor", "MV-1", [["p_mvw_net", "NET", "cat6", "bidir"]]));
    r.cables.push({ id: "cab_net", type: "cat6", length_ft: 15, fromPort: "p_sw2_net", toPort: "p_mvw_net", label: "CAT-001", redundancyGroup: null });
    r.signal.network.hosts.push({ deviceId: "dev_sw2", vlan: 10, ip: "10.10.0.5" }, { deviceId: "dev_mvw", vlan: 20, ip: "10.20.0.5" });
    r.devices.push(dev("dev_lonely", "monitor", "MON-9", [["p_lonely", "SDI IN", "12G-SDI", "in"]]));
    r.signal.nodes.push({ id: "sig_lonely", deviceId: "dev_lonely", role: "monitor", x: 0, y: 0 });
    const cs = validate(r);
    expect(find(cs, "SIG-012")[0].rule).toBe("fiberLED links need the same spec.protocol on both devices; Brompton ≠ Novastar.");
    expect(find(cs, "SIG-014").map((c) => c.target)).toEqual(["dev_proc1"]);
    expect(find(cs, "SIG-016")[0].target).toBe("cab_net");
    expect(find(cs, "SIG-018")[0]).toMatchObject({ target: "dev_lonely", severity: "info" });
    expect(find(cs, "SIG-018")[0].fixes![0].patch).toEqual([{ op: "remove", path: "/signal/nodes/sig_lonely" }]);
  });

  it("SIG-013 clears when a recorder resolves through a DA to PGM; SIG-015 compares LTC to house rate", () => {
    const r = load(example);
    r.devices.find((d) => d.id === "dev_sw1")!.ports.push({ id: "p_sw1_pgm2", name: "PGM OUT 2", type: "3G-SDI", dir: "out" }, { id: "p_sw1_ltc", name: "LTC IN", type: "LTC", dir: "in" });
    r.devices.push(dev("dev_da2", "converter", "DA-2", [["p_da2_in", "SDI IN", "12G-SDI", "in"], ["p_da2_out", "SDI OUT", "12G-SDI", "out"]]));
    r.devices.push(dev("dev_rec", "recorder", "REC-1", [["p_rec_in", "SDI IN", "12G-SDI", "in"]]));
    r.devices.push(dev("dev_tc", "tcGen", "TC-1", [["p_tc_ltc", "LTC OUT", "LTC", "out"]]));
    r.cables.push(
      { id: "cab_pgm_da", type: "SDI", length_ft: 3, fromPort: "p_sw1_pgm2", toPort: "p_da2_in", label: "SDI-060", redundancyGroup: null },
      { id: "cab_da_rec", type: "SDI", length_ft: 3, fromPort: "p_da2_out", toPort: "p_rec_in", label: "SDI-061", redundancyGroup: null },
      { id: "cab_ltc", type: "audio-TRS", length_ft: 10, fromPort: "p_tc_ltc", toPort: "p_sw1_ltc", label: "LTC-001", redundancyGroup: null },
    );
    r.signal.links.push(
      { id: "lnk_pgm_da", cableId: "cab_pgm_da", format: "1080p59.94", path: "A", label: "PGM" },
      { id: "lnk_da_rec", cableId: "cab_da_rec", format: "", path: "A", label: "REC" },
      { id: "lnk_ltc", cableId: "cab_ltc", format: "30 NDF", path: "A", label: "LTC" },
    );
    const cs = validate(r);
    expect(find(cs, "SIG-013")).toHaveLength(0);
    expect(find(cs, "SIG-015")[0].rule).toBe("LTC frame rate must match the house format rate; 30 ≠ 29.97.");
  });
});

describe("helpers", () => {
  it("connect picks the cable type from the matrix and adds nodes; disconnect removes link + cable", () => {
    const r = load(example);
    r.devices.push(dev("dev_mon5", "monitor", "MON-5", [["p_mon5_in", "HDMI IN", "HDMI2.0", "in"]]));
    const ops = connect(r, "p_srvB_out1", "p_mon5_in", { path: "B" }, newId);
    const cable = (ops[0] as { value: { type: string; label: string } }).value;
    expect(cable.type).toBe("DP-HDMI");
    expect(cable.label).toBe("DPH-001-B");
    const after = applyLocal(r, ops);
    const link = after.signal.links.at(-1)!;
    expect(sameFormat(link.format, "3840x2160p59.94")).toBe(true);
    expect(after.signal.nodes.map((n) => n.deviceId)).toEqual(expect.arrayContaining(["dev_srvB", "dev_mon5"]));
    const back = applyLocal(after, disconnect(after, link.id));
    expect(back.cables).toHaveLength(r.cables.length);
    expect(back.signal.links).toHaveLength(r.signal.links.length);
    expect(() => connect(r, "p_proc1_out1", "p_mon5_in", {}, newId)).toThrow();
  });

  it("addSignalDevice adds a system camera's CCU and SMPTE cable in one patch", () => {
    const ws = workspace();
    const rec = ws.importRecord(asWorkingCopy(example));
    const ops = addSignalDevice(rec, "tpl_sony_hdc3500", "CAM 1", newId);
    const res = ws.api(rec.showId, "signal").patch(ops, "add CAM 1");
    expect(res.errors).toBeUndefined();
    const r2 = ws.get(rec.showId);
    expect(r2.devices.map((d) => d.label)).toEqual(expect.arrayContaining(["CAM 1", "CAM 1 CCU"]));
    expect(r2.cables.find((c) => c.type === "SMPTE-311")?.label).toBe("SMP-001");
  });

  it("converterChain bridges DP → 12G-SDI through two hops and DP → HDMI through the adapter", () => {
    expect(converterChain("DP1.4", "HDMI2.0")?.map((h) => h.template.templateId)).toEqual(["tpl_generic_dp_hdmi_adapter"]);
    const two = converterChain("DP1.4", "12G-SDI");
    expect(two).toHaveLength(2);
    expect(two![0].template.templateId).toBe("tpl_generic_dp_hdmi_adapter");
    expect(converterChain("12G-SDI", "12G-SDI")).toEqual([]);
  });

  it("autoPatchProgram wires PGM and A/B server feeds, clearing SIG-006, SIG-007 and SIG-009 through the store", () => {
    const ws = workspace();
    const rec = ws.importRecord(asWorkingCopy(example));
    const showId = rec.showId;
    // Build the wizard-shaped show: drop the fixture's hand-made feeds, library SX40 + Carbonite.
    const base = ws.get(showId);
    const sig = ws.api(showId, "signal");
    const led = ws.api(showId, "led");
    const srv = ws.api(showId, "servers");
    expect(sig.patch([...disconnect(base, "lnk_srv_proc"), ...disconnect(base, "lnk_pgm")], "clear feeds").ok).toBe(true);
    const sx40 = instantiate(library.get("tpl_brompton_sx40")!, "PROC-2", newId);
    expect(led.patch([{ op: "add", path: "/devices/-", value: sx40 }, { op: "replace", path: "/led/walls/wall_us/processorIds", value: ["dev_proc1", sx40.id] }], "add SX40").ok).toBe(true);
    // PROC-1 keeps its single HDMI input; SRV-B gets a 12G input for PGM.
    const vx = instantiate(library.get("tpl_disguise_vx2")!, "SRV-C", newId);
    expect(srv.patch([{ op: "add", path: "/devices/-", value: vx }], "add vx").ok).toBe(true);
    let r = ws.get(showId);
    const before = validate(r);
    expect(find(before, "SIG-006").map((c) => c.target).sort()).toEqual(["dev_proc1", sx40.id].sort());
    const ops = autoPatchProgram(r, newId);
    const res = sig.patch(ops, "auto-patch program");
    expect(res.errors).toBeUndefined();
    r = ws.get(showId);
    const after = validate(r);
    expect(find(after, "SIG-006")).toHaveLength(0);
    expect(find(after, "SIG-007")).toHaveLength(0);
    expect(find(after, "SIG-009")).toHaveLength(0);
    expect(find(after, "SIG-008")).toHaveLength(0);
    expect(after.filter((c) => c.severity === "block")).toEqual([]);
    expect(r.devices.filter((d) => d.label.startsWith("DPH-")).length).toBeGreaterThanOrEqual(2);
    expect(r.signal.redundancy.map((g) => g.name)).toEqual(["PGM to US Wall"]);
    // SW-1's PGM went to SRV-A's input
    const pgm = r.cables.find((c) => c.fromPort === "p_sw1_pgm");
    expect(pgm?.toPort).toBe("p_srvA_in1");
    // idempotent: nothing left to wire
    expect(autoPatchProgram(r, newId)).toEqual([]);
  });

  it("seed is idempotent and writes formats, VLANs, SW-1, RTR-1 and positions", () => {
    const ws = workspace();
    const rec = ws.createShow({ showCode: "SEED-2026-001" });
    const ops = signalModule.seed(rec, { newId, profile: "arena" });
    expect(ws.api(rec.showId, "signal").patch(ops, "seed").ok).toBe(true);
    const r = ws.get(rec.showId);
    expect(r.signal.formats).toMatchObject({ house: "1080p59.94", ledInput: "3840x2160p59.94" });
    expect(r.signal.network.vlans.map((v) => `${v.id} ${v.name}`)).toEqual(["10 Control", "20 Media", "30 Comms"]);
    expect(r.devices.map((d) => `${d.label}:${d.templateId}`).sort()).toEqual(["RTR-1:tpl_ross_ultrix_fr1", "SW-1:tpl_ross_carbonite_ultra"]);
    expect(r.physical.positions.map((p) => p.id)).toEqual(expect.arrayContaining(["pos_stage_us", "pos_stage_sl", "pos_stage_sr", "pos_video_world", "pos_foh", "pos_dimmer_beach"]));
    expect(signalModule.seed(r, { newId, profile: "arena" })).toEqual([]);
  });
});

describe("physical layer and trunk plan (Cable & panels tab)", () => {
  it("seeds positions and paths mirrored as Confirmed from the advance", () => {
    const r = load(trunkFixture);
    r.event.cameras.positions = { value: [{ id: "cam_foh1", label: "FOH 1", location: "FOH riser", platform: true, permitted: true, toVideoWorld_ft: 220 }], state: "assumed" };
    const s = applyLocal(r, seedPhysical(r, newId));
    const vw = s.physical.paths.find((p) => p.id === "path_vw_stage_sl")!;
    expect(vw.length_ft).toMatchObject({ value: 150, state: "confirmed", source: "site-visit" });
    expect(s.physical.paths.find((p) => p.id === "path_vw_cam_foh1")?.length_ft).toMatchObject({ value: 220, state: "assumed" });
    expect(s.physical.positions.some((p) => p.id === "pos_cam_foh1")).toBe(true);
    expect(shortestPathChain(s, "pos_video_world", "pos_stage_us")).toEqual(["path_vw_stage_sl", "path_stage_sl_us"]);
    expect(seedPhysical(s, newId)).toEqual([]);
  });

  it("a direct cable is one run of path × 1.15 + 10 rounded to stock", () => {
    const r = load(trunkFixture);
    const s = applyLocal(r, seedPhysical(r, newId));
    const b = deriveSegments(s).get("cab_sw1_proc1")!;
    expect(b.segments).toHaveLength(1);
    expect(b.segments[0]).toMatchObject({ kind: "run", pathId: "path_vw_stage_sl", label: "SDI-001", length_ft: { derived: 182.5, stock: 200 } });
    expect(b.total_ft).toBe(200);
  });

  it("over-stock runs become two runs + coupler and raise PHY-003", () => {
    const r = load(trunkFixture);
    r.event.access.videoWorld.value!.toStage_ft = 260;
    const s = applyLocal(r, seedPhysical(r, newId));
    const b = deriveSegments(s).get("cab_sw1_proc1")!;
    expect(b.segments.map((x) => x.length_ft.stock)).toEqual([250, 75]);
    expect(b.segments.map((x) => x.label)).toEqual(["SDI-001.1", "SDI-001.2"]);
    const cs = validate(s);
    expect(find(cs, "PHY-003")).toHaveLength(1);
    expect(find(cs, "PHY-004").length).toBeGreaterThan(0); // a 250 ft 4K segment is past 12G reach
  });

  it("one stage-to-video-world SDI cable yields three segments through SL-SB-1 and VW-FO-1", () => {
    const ws = workspace();
    const rec = ws.importRecord(asWorkingCopy(trunkFixture));
    const ops: Patch[] = proposeTrunkPlan(rec, newId);
    const res = ws.api(rec.showId, "signal").patch(ops, "accept trunk plan");
    expect(res.errors).toBeUndefined();
    const r = ws.get(rec.showId);
    const sb = r.devices.find((d) => d.label === "SL-SB-1")!;
    const fo = r.devices.find((d) => d.label === "VW-FO-1")!;
    expect(sb.positionId).toBe("pos_stage_sl");
    expect(fo.positionId).toBe("pos_video_world");
    const trunk = r.cables.find((c) => r.physical.trunks.includes(c.id))!;
    expect(trunk).toMatchObject({ type: "fiber", label: "FIB-001", length_ft: 250, strands: 24 });
    const cab = r.cables.find((c) => c.id === "cab_sw1_proc1")!;
    expect(cab.segments).toHaveLength(3);
    const [s1, s2, s3] = cab.segments!;
    expect(s1).toMatchObject({ kind: "jumper", from: { port: "p_sw1_aux1" }, label: "SDI-001.1", length_ft: { derived: 25, stock: 25 } });
    expect(s2).toMatchObject({ kind: "trunk-strand", label: "SDI-001.2", reelRef: `${trunk.id}/01`, length_ft: { stock: 250 } });
    expect(s3).toMatchObject({ kind: "jumper", to: { port: "p_proc1_sdi" }, label: "SDI-001.3", length_ft: { derived: 50, stock: 50 } });
    const jackPanel = (end: unknown) => {
      const id = (end as { jack: string }).jack;
      return [sb, fo].find((p) => (p.spec!.jacks as { id: string }[]).some((j) => j.id === id))?.label;
    };
    expect(jackPanel(s1.to)).toBe("VW-FO-1");
    expect(jackPanel(s3.from)).toBe("SL-SB-1");
    // Stock total: 25 + 250 + 50 — the trunk's 182.5 ft derived run rounds to the 250 ft fibre reel.
    expect(cab.length_ft).toBe(325);
    expect(deriveSegments(r).get(cab.id)!.total_ft).toBe(325);
    // No physical warnings on a clean plan; the 4K SDI no longer trips SIG-017 because it rides fibre.
    const cs = validate(r);
    expect(cs.filter((c) => c.code.startsWith("PHY-") && c.severity !== "info")).toEqual([]);
    expect(find(cs, "SIG-017")).toHaveLength(0);
    // derived rollups
    const d = r.derived;
    expect(d.physical?.byPath.path_vw_stage_sl).toMatchObject({ cables: 1, byType: { fiber: 1 }, totalFt: 250 });
    expect(d.inventory.cableCountByType).toMatchObject({ "SDI 25ft": 1, "SDI 50ft": 1, "fiber 250ft": 1 });
    // re-proposing routes nothing new
    expect(proposeTrunkPlan(r, newId)).toEqual([]);
    // exports
    const pull = signalModule.exports.find((e) => e.key === "cable-pull")!.render(r);
    expect(pull.split("\n")[0]).toBe("type,stock_ft,qty,labels,from → to,path,A/B");
    expect(pull).toContain("SDI,25,1,SDI-001.1");
    const panel = signalModule.exports.find((e) => e.key === "panel-schedule")!.render(r);
    expect(panel).toContain("SL-SB-1:01");
    expect(panel).toContain("SW-1:AUX 1 → PROC-1:12G-SDI IN via VW-FO-1:01, SL-SB-1:01");
    expect(signalModule.exports.find((e) => e.key === "trunk-map")!.render(r)).toContain("FIB-001/01");
    expect(signalModule.exports.find((e) => e.key === "label-sheet")!.render(r).trim().split("\n")).toHaveLength(1 + 6); // two jumpers + the trunk reel, two tags each
    expect(signalModule.exports.find((e) => e.key === "run-list")!.render(r)).toContain("Stage left floor ↔ Stage left,floor,150,confirmed,1");
    expect(signalModule.exports.find((e) => e.key === "link-list")!.render(r)).toContain("LED FEED,SW-1 AUX 1,PROC-1 12G-SDI IN");
  });

  it("PHY-005 / PHY-006 / PHY-007 / PHY-008 / PHY-001 / PHY-002", () => {
    const r0 = load(trunkFixture);
    r0.event.access.videoWorld = { value: null, state: "unknown" };
    let r = applyLocal(r0, seedPhysical(r0, newId));
    let cs = validate(r);
    expect(find(cs, "PHY-005").map((c) => c.target)).toEqual(["path_vw_stage_sl"]);
    // trunk plan, then break things
    r = load(trunkFixture);
    r = applyLocal(r, proposeTrunkPlan(r, newId));
    const sb = r.devices.find((d) => d.label === "SL-SB-1")!;
    sb.positionId = "pos_video_world";
    const jacks = sb.spec!.jacks as { front: { cableId: string | null }; rear: { cableId: string | null } }[];
    jacks[5].front.cableId = "cab_sw1_proc1";
    const trunk = r.cables.find((c) => r.physical.trunks.includes(c.id))!;
    trunk.strands = 0;
    r.devices.push(dev("dev_cam7", "camera", "CAM 7", [["p_cam7", "SDI OUT", "12G-SDI", "out"]]));
    r.devices.find((d) => d.id === "dev_sw1")!.ports.push({ id: "p_sw1_in7", name: "SDI IN 7", type: "12G-SDI", dir: "in" });
    r.cables.push({ id: "cab_cam7", type: "SDI", length_ft: 100, fromPort: "p_cam7", toPort: "p_sw1_in7", label: "SDI-007", redundancyGroup: null });
    cs = validate(r);
    expect(find(cs, "PHY-007")[0].message).toBe("SL-SB-1 is a stage box placed at Stage left floor.");
    expect(find(cs, "PHY-001")).toHaveLength(1);
    expect(find(cs, "PHY-002")[0].fixes![0].patch).toBeDefined();
    expect(find(cs, "PHY-008").map((c) => c.target)).toEqual(["dev_cam7"]);
  });

  it("PHY-006 · A and B over the same trunk", () => {
    let r = load(trunkFixture);
    r.devices.find((d) => d.id === "dev_proc1")!.ports.push({ id: "p_proc1_sdi2", name: "12G-SDI IN 2", type: "12G-SDI", dir: "in" });
    r.cables.push({ id: "cab_pgm_proc1", type: "SDI", length_ft: 200, fromPort: "p_sw1_pgm", toPort: "p_proc1_sdi2", label: "SDI-002", redundancyGroup: "B" });
    r.signal.links.push({ id: "lnk_pgm_b", cableId: "cab_pgm_proc1", format: "3840x2160p59.94", path: "B", label: "LED FEED B" });
    r.signal.redundancy.push({ id: "rg_led", name: "LED feed", primary: ["lnk_aux1"], backup: ["lnk_pgm_b"] });
    r = applyLocal(r, proposeTrunkPlan(r, newId));
    const cs = validate(r);
    expect(find(cs, "PHY-006")[0]).toMatchObject({ target: "rg_led", severity: "warn" });
    // ...and the shared trunk + panels are SIG-008 single points too.
    expect(find(cs, "SIG-008")[0].message).toContain("FIB-001");
    expect(ctx.profile.type).toBe("arena");
  });
});
