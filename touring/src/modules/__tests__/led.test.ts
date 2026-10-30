import { describe, expect, it } from "vitest";
import { library } from "../../library/library";
import { portCapacity, wallGeometry } from "../../library/wall";
import type { CheckDraft, Device, ShowRecord, Wall } from "../../store/types";
import {
  addWall, autoCircuits, autoProcessors, autoSplitRuns, canvasFor, deriveLed, ledModule, renderLedSummary, renderPowerByCircuit, seedLed, setCanvas, sizeWall, validateLed,
} from "../led";
import { ctx, exampleRecord, newId, workspace } from "./harness";

const codes = (cs: CheckDraft[]) => cs.map((c) => c.code).sort();
const ID_LIKE = /\b(dev|wall|p|ckt|rack|srv|cab)_[a-z0-9]+/;

function expectExplained(c: CheckDraft) {
  expect(c.title).toBeTruthy();
  expect(c.target).toBeTruthy();
  expect(c.message).not.toMatch(ID_LIKE);
  expect(c.rule).toBeTruthy();
  expect(c.evidence?.length).toBeGreaterThan(0);
  for (const e of c.evidence ?? []) { expect(e.label).toBeTruthy(); expect(e.value).toBeTruthy(); expect(e.path).toBeTruthy(); }
  expect(c.fixes?.length).toBeGreaterThan(0);
  for (const f of c.fixes ?? []) { expect(f.label).toBeTruthy(); expect(f.module).toBeTruthy(); }
}

/** A 25×7 CB5 wall (the Sombr rehearsal wall) on a blank show with SX40 + XDs picked by autoProcessors. */
function cb5Show(opts: { redundant?: boolean } = {}) {
  const t = workspace({ blank: true });
  const apply = (by: "led" | "rack" | "servers", ops: ReturnType<typeof addWall>, why: string) => {
    const res = t.ws.patch(t.id, by, ops, why);
    expect(res.errors ?? []).toEqual([]);
  };
  apply("led", addWall(t.get(), { name: "US Wall", templateId: "tpl_roe_cb5", cols: 25, rows: 7, trimHeight_ft: 38 }, newId), "add wall");
  const wallId = t.get().led.walls[0].id;
  apply("led", autoProcessors(t.get(), wallId, newId, { redundant: opts.redundant }), "processors");
  return { ...t, wallId, apply, wall: () => t.get().led.walls.find((w) => w.id === wallId)! };
}

describe("LED wall math (Device library tab)", () => {
  it("CB5 25×7: 175 tiles, 2600×1456 px, 49.2×27.6 ft, 87.5 kW, 5,343 lb, 8 ports (16 redundant)", () => {
    const s = cb5Show();
    const g = wallGeometry(s.get(), s.wall());
    expect(g.tiles).toBe(175);
    expect([g.w_px, g.h_px]).toEqual([2600, 1456]);
    expect(g.px).toBe(3_785_600);
    expect(g.w_ft).toBeCloseTo(49.2, 1);
    expect(Math.abs(g.h_ft - 27.6)).toBeLessThan(0.06); // 7 × 1200 × 0.00328 = 27.55 → "27.6"
    expect(g.maxW).toBe(87_500);
    expect(g.avgW).toBe(43_750);
    expect(Math.round(g.panelWeightLb)).toBe(5_343);
    expect(g.pxPerPort).toBe(525_000);
    expect(g.portsNeeded).toBe(8);
    expect(g.tilesPerPort).toBe(24);

    const d = s.get().derived.led.perWall[s.wallId];
    expect(d).toMatchObject({ tiles: 175, w_px: 2600, h_px: 1456, maxW: 87_500, avgW: 43_750, portsNeeded: 8, approximate: false });
    expect(d.weightLb).toBe(g.panelWeightLb + g.headerWeightLb);

    // Redundant runs double the port count.
    s.apply("led", autoSplitRuns(s.get(), s.wallId, newId, { redundant: true }), "redundant runs");
    expect(s.get().derived.led.perWall[s.wallId].portsNeeded).toBe(16);
    expect(s.wall().dataRuns.filter((r) => r.redundant)).toHaveLength(8);
  });

  it("autoProcessors pairs an SX40 with enough XDs (and the fixture's 500 mm CB5 still reads library px)", () => {
    const s = cb5Show();
    const procs = s.wall().processorIds.map((id) => s.get().devices.find((d) => d.id === id)!);
    expect(procs.map((d) => d.label)).toEqual(["PROC-1", "XD-1"]);
    expect(procs[0].templateId).toBe("tpl_brompton_sx40");
    // XD lands on SX40 10G OUT 1 via a LED-owned fiberLED jumper.
    const cab = s.get().cables.find((c) => c.type === "fiberLED")!;
    expect(cab.fromPort).toBe(procs[0].ports.find((p) => p.name === "10G OUT 1")!.id);
    expect(cab.label).toBe("LED-001");
    // 16 ports needed with redundancy → two XDs
    const r = cb5Show({ redundant: true });
    expect(r.wall().processorIds.map((id) => r.get().devices.find((d) => d.id === id)!.label)).toEqual(["PROC-1", "XD-1", "XD-2"]);

    const fx = exampleRecord();
    const g = wallGeometry(fx, fx.led.walls[0]);
    expect(g.tile.templateId).toBe("tpl_roe_cb5");
    expect([g.w_px, g.h_px, g.portsNeeded]).toEqual([2600, 1456, 8]);
  });
});

describe("LED derive", () => {
  it("rolls up the example fixture: per wall, power by circuit and distro, totals", () => {
    const r = exampleRecord();
    const d = deriveLed(r);
    expect(d.led.perWall.wall_us).toMatchObject({ tiles: 175, w_px: 2600, h_px: 1456, maxW: 87_500, portsNeeded: 8 });
    expect(d.led.totals.tiles).toBe(175);
    expect(d.power.byCircuit.ckt_us_a1).toEqual({ amps: 20, loadW: 0, loadA: 0, pct: 0 });
    expect(d.power.byDistro.dev_dist1.loadW).toBe(87_500);
    // 87.5 kW of tiles + 2,350 W of rack gear (non-tile devices).
    expect(d.power.totalW).toBe(87_500 + 450 + 300 + 800 + 800);
    expect(d.power.totalA_perLeg).toBeCloseTo(89_850 / (208 * Math.sqrt(3)), 1);
  });

  it("byCircuit sums only the tiles assigned to each circuit", () => {
    const r = exampleRecord();
    r.led.walls[0].power.circuits[0].tiles = [[0, 0], [0, 1], [0, 1], [99, 99]];
    const d = deriveLed(r);
    expect(d.power.byCircuit.ckt_us_a1.loadW).toBe(1000);
    expect(d.power.byCircuit.ckt_us_a1.loadA).toBeCloseTo(1000 / 208, 2);
  });
});

describe("LED validate on the example fixture", () => {
  it("emits led/info LED-003 (unmapped tiles) and no port, circuit, processor, trim or point checks", () => {
    const r = exampleRecord();
    const checks = validateLed(r, ctx());
    const c3 = checks.find((c) => c.code === "LED-003")!;
    expect(c3).toMatchObject({ severity: "info", target: "wall_us", title: "Unmapped tiles" });
    expect(c3.message).toBe("US Wall: 175 of 175 tiles have no data run and 175 of 175 have no circuit.");
    expectExplained(c3);
    for (const code of ["LED-001", "LED-002", "LED-005", "LED-006", "LED-007", "LED-008"]) expect(codes(checks)).not.toContain(code);
    // The fixture's stored canvas (2400×672, from 500 mm / 96 px tiles) is smaller than the library CB5 wall (2600×1456),
    // so LED-004 reports the overflow; laying the canvas out from derived px clears it.
    const c4 = checks.find((c) => c.code === "LED-004")!;
    expect(c4.severity).toBe("warn");
    expectExplained(c4);
    expect(c4.fixes![0].patch).toEqual(setCanvas(r));
  });

  it("round-trips through the store: setCanvas clears LED-004 as the led writer", () => {
    const t = workspace();
    const before = t.get().binder.checks.filter((c) => c.module === "led").map((c) => `${c.severity}/${c.code}`).sort();
    expect(before).toEqual(["info/LED-003", "warn/LED-004"]);
    expect(t.ws.patch(t.id, "led", setCanvas(t.get()), "canvas").ok).toBe(true);
    expect(t.get().led.canvas).toEqual({ w_px: 2600, h_px: 1456, mappings: [{ wallId: "wall_us", x: 0, y: 0 }] });
    expect(t.get().binder.checks.filter((c) => c.module === "led" && !c.resolved).map((c) => c.code)).toEqual(["LED-003"]);
  });
});

describe("LED-001 port capacity and auto-split", () => {
  it("flags a 175-tile run on one 1G port, offers an auto-split patch, and autoSplitRuns clears it", () => {
    const s = cb5Show();
    const wall = s.wall();
    const xd = s.get().devices.find((d) => d.label === "XD-1")!;
    const port = xd.ports.find((p) => p.type === "etherCon" && p.dir === "out")!;
    const all: [number, number][] = [];
    for (let c = 0; c < 25; c++) for (let r = 0; r < 7; r++) all.push([c, r]);
    s.apply("led", [{ op: "replace", path: `/led/walls/${wall.id}/dataRuns`, value: [{ portId: port.id, tileChain: all, redundant: false }] }], "one long run");

    const checks = validateLed(s.get(), ctx());
    const c1 = checks.find((c) => c.code === "LED-001")!;
    expect(c1).toMatchObject({ severity: "block", target: port.id, title: "Port capacity" });
    expect(c1.message).toBe("US Wall data run 1 drives 175 CB5 tiles (3,785,600 px) on XD-1 1G OUT 1, rated for 525,000 px.");
    expect(c1.rule).toBe("tiles × 104 × 208 must be ≤ the port's pixel capacity; 3,785,600 > 525,000.");
    expectExplained(c1);
    expect(c1.fixes![0].label).toBe("Split run 1 into 8 runs of ≤ 24 tiles (auto-split)");
    expect(c1.fixes![0].patch?.length).toBeGreaterThan(0);
    // Applying the attached auto-split patch clears the block.
    s.apply("led", c1.fixes![0].patch!, "auto-split from check");
    expect(codes(validateLed(s.get(), ctx()))).not.toContain("LED-001");

    // autoSplitRuns re-balances from scratch: 8 runs of ≤ 24 tiles in snake order, each within its port's capacity.
    s.apply("led", autoSplitRuns(s.get(), wall.id, newId), "re-balance");
    const runs = s.wall().dataRuns;
    expect(runs).toHaveLength(8);
    expect(runs.map((r) => r.tileChain.length)).toEqual([24, 24, 24, 24, 24, 24, 24, 7]);
    for (const r of runs) expect(r.tileChain.length * 104 * 208).toBeLessThanOrEqual(portCapacity(s.get(), r.portId).px);
    expect(new Set(runs.map((r) => r.portId)).size).toBe(8);
    expect(runs[0].tileChain.slice(6, 9)).toEqual([[0, 6], [1, 6], [1, 5]]);
    const covered = new Set(runs.flatMap((r) => r.tileChain.map((t) => t.join(","))));
    expect(covered.size).toBe(175);
    expect(s.get().binder.checks.filter((c) => c.code === "LED-001" && !c.resolved)).toHaveLength(0);
  });

  it("autoSplitRuns adds XDs when the wall's ports are short (with newId) and returns [] without", () => {
    const s = cb5Show();
    const wall = s.wall();
    expect(autoSplitRuns(s.get(), wall.id, undefined, { redundant: true })).toEqual([]);
    s.apply("led", autoSplitRuns(s.get(), wall.id, newId, { redundant: true }), "redundant");
    expect(s.wall().dataRuns).toHaveLength(16);
    expect(s.get().devices.filter((d) => d.label.startsWith("XD-"))).toHaveLength(2);
  });
});

describe("LED circuits, processors and rigging checks", () => {
  it("autoCircuits keeps each 20 A circuit ≤ 80% and, with runs, clears LED-003", () => {
    const s = cb5Show();
    s.apply("led", autoSplitRuns(s.get(), s.wallId, newId), "runs");
    s.apply("led", autoCircuits(s.get(), s.wallId, newId), "circuits");
    const w = s.wall();
    expect(w.power.distroId).toBeTruthy();
    expect(s.get().devices.find((d) => d.id === w.power.distroId)!.label).toBe("LED DISTRO 1");
    // 0.8 × 20 A × 208 V = 3,328 W → 6 CB5 tiles (3,000 W) per circuit → 30 circuits.
    expect(w.power.circuits).toHaveLength(30);
    for (const c of Object.values(s.get().derived.power.byCircuit)) expect(c.pct).toBeLessThanOrEqual(80);
    const left = validateLed(s.get(), ctx());
    expect(codes(left)).not.toContain("LED-002");
    expect(codes(left)).not.toContain("LED-003");
  });

  it("LED-002 warns on a circuit over 80% with both compared values", () => {
    const r = exampleRecord();
    r.led.walls[0].power.circuits[0].tiles = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 0]];
    const c = validateLed(r, ctx()).find((x) => x.code === "LED-002")!;
    expect(c).toMatchObject({ severity: "warn", target: "ckt_us_a1" });
    expect(c.message).toBe("Circuit LED DISTRO 1-A-1 on US Wall carries 8 CB5 tiles at 4,000 W max — 96% of a 20 A circuit.");
    expect(c.rule).toBe("Σ tile max W must be ≤ 80% of rated: 8 × 500 W = 4,000 W > 0.8 × 20 A × 208 V = 3,328 W.");
    expectExplained(c);
  });

  it("LED-006 blocks a wall with tiles and no processor", () => {
    const r = exampleRecord();
    r.led.walls[0].processorIds = [];
    const c = validateLed(r, ctx()).find((x) => x.code === "LED-006")!;
    expect(c).toMatchObject({ severity: "block", target: "wall_us" });
    expectExplained(c);
  });

  it("LED-005 warns when the profile expects redundancy and no run is redundant", () => {
    const r = exampleRecord();
    expect(codes(validateLed(r, ctx({ redundancyExpected: true })))).toContain("LED-005");
    r.led.walls[0].dataRuns[0].redundant = true;
    expect(codes(validateLed(r, ctx({ redundancyExpected: true })))).not.toContain("LED-005");
  });

  it("LED-007 warns when design trim exceeds a confirmed/assumed venue max", () => {
    const r = exampleRecord();
    r.event.rigging.maxTrim_ft = { value: 32, state: "asked" };
    expect(codes(validateLed(r, ctx()))).not.toContain("LED-007");
    r.event.rigging.maxTrim_ft = { value: 32, state: "confirmed" };
    const c = validateLed(r, ctx()).find((x) => x.code === "LED-007")!;
    expect(c).toMatchObject({ severity: "warn", target: "wall_us" });
    expect(c.rule).toContain("38 ft > 32 ft");
    expectExplained(c);
    expect(c.fixes![0].patch).toEqual([{ op: "replace", path: "/led/walls/wall_us/trimHeight_ft", value: 32 }]);
  });

  it("LED-008 blocks when wall + headers exceed point capacity × headers", () => {
    const r = exampleRecord();
    r.event.rigging.pointCapacity_lb = { value: 2000, state: "assumed" };
    expect(codes(validateLed(r, ctx()))).not.toContain("LED-008"); // 5,543 lb ≤ 2,000 × 5
    r.event.rigging.pointCapacity_lb = { value: 1000, state: "assumed" };
    const c = validateLed(r, ctx()).find((x) => x.code === "LED-008")!;
    expect(c).toMatchObject({ severity: "block", target: "wall_us" });
    expect(c.rule).toContain("> 1,000 lb × 5 = 5,000 lb");
    expectExplained(c);
  });

  it("LED-004 flags overlapping walls", () => {
    const s = cb5Show();
    s.apply("led", addWall(s.get(), { name: "IMAG L", templateId: "tpl_roe_cb5", cols: 4, rows: 3 }, newId), "imag");
    expect(codes(validateLed(s.get(), ctx()))).not.toContain("LED-004");
    const r = structuredClone(s.get()) as ShowRecord;
    r.led.canvas.mappings[1].x = 100;
    const c = validateLed(r, ctx()).find((x) => x.code === "LED-004")!;
    expect(c.message).toContain("overlaps");
    expectExplained(c);
  });
});

describe("LED helpers, seed and exports", () => {
  it("addWall / sizeWall / setCanvas produce LED-only patches", () => {
    const s = cb5Show();
    const before = s.wall();
    expect(before.tileModel).toBe("ROE CB5");
    expect(before.rigging.headers).toBe(5);
    expect(s.get().led.canvas).toEqual(canvasFor(s.get()));
    s.apply("led", autoSplitRuns(s.get(), s.wallId, newId), "runs");
    s.apply("led", sizeWall(s.get(), s.wallId, { cols: 20, rows: 5, templateId: "tpl_roe_cb5_mkii" }), "resize");
    const w: Wall = s.wall();
    expect([w.cols, w.rows, w.templateId]).toEqual([20, 5, "tpl_roe_cb5_mkii"]);
    expect(w.dataRuns.every((r) => r.tileChain.every(([c, rr]) => c < 20 && rr < 5))).toBe(true);
    // string rigging shorthand
    s.apply("led", addWall(s.get(), { name: "Floor", templateId: "tpl_roe_bm4", cols: 2, rows: 2, rigging: "ground" }, newId), "floor");
    expect(s.get().led.walls[1].rigging.type).toBe("ground");
  });

  it("seed is minimal and idempotent", () => {
    const t = workspace({ blank: true });
    const ops = seedLed(t.get(), { newId });
    expect(t.ws.patch(t.id, "led", ops, "seed").ok).toBe(true);
    const r = t.get();
    expect(r.led.walls).toHaveLength(1);
    expect(r.led.walls[0]).toMatchObject({ name: "US Wall", tileModel: "ROE CB5", cols: 0, rows: 0, power: { phase: "3Ø" } });
    expect(r.devices.map((d: Device) => d.label).sort()).toEqual(["LED DISTRO 1", "PROC-1", "XD-1"]);
    expect(r.led.walls[0].processorIds).toHaveLength(2);
    expect(ledModule.seed(r, { newId, profile: "arena" })).toEqual([]);
    expect(codes(validateLed(r, ctx()))).toEqual([]);
  });

  it("exports render CSV", () => {
    const r = exampleRecord();
    const sum = ledModule.exports.find((e) => e.key === "led-summary")!.render(r);
    expect(sum.split("\n")[1]).toMatch(/^US Wall,CB5,25,7,175,2600,1456,/);
    expect(renderLedSummary(r)).toBe(sum);
    const pwr = renderPowerByCircuit(r);
    expect(pwr.split("\n")[0]).toBe("Wall,Circuit,Distro,Amps,Volts,Tiles,Load W,Load A,% of rated");
    expect(pwr.split("\n")[1]).toBe("US Wall,LED DISTRO 1-A-1,LED DISTRO 1,20,208,0,0,0,0");
  });

  it("uses the library tile spec even when the wall carries different mm (fixture)", () => {
    expect(library.get("tpl_roe_cb5")!.spec.px_w).toBe(104);
  });
});
