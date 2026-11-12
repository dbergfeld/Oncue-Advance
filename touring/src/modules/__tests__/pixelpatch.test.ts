import { describe, expect, it } from "vitest";
import { portCapacity } from "../../library/wall";
import type { ShowRecord } from "../../store/types";
import {
  addWall, autoSplitRuns, clearPort, dropXd, ledLegs, moveXd, nextPatchLetter, paintTiles, patchPorts, portPatchLabel, removeXd, validateLed, xdOutPorts,
} from "../led";
import { ctx, newId, workspace } from "./harness";

/** A 10×6 CB5 wall on a blank show with no processors yet (the Pixel & Patch starting point). */
function wallShow() {
  const t = workspace({ blank: true });
  const apply = (ops: ReturnType<typeof addWall>, why: string, opts?: { cascade?: boolean }) => {
    const res = t.ws.patch(t.id, "led", ops, why, opts);
    expect(res.errors ?? []).toEqual([]);
    return res;
  };
  apply(addWall(t.get(), { name: "US Wall", templateId: "tpl_roe_cb5", cols: 10, rows: 6, trimHeight_ft: 30 }, newId), "add wall");
  const wallId = t.get().led.walls[0].id;
  const wall = () => t.get().led.walls.find((w) => w.id === wallId)!;
  const dev = (label: string) => t.get().devices.find((d) => d.label === label)!;
  return { ...t, wallId, apply, wall, dev };
}

describe("Pixel & Patch: dropping XD boxes", () => {
  it("drops XD A with ten 1G ports, pairs it to a new SX40 10G OUT 1 and records the box on the wall", () => {
    const s = wallShow();
    expect(nextPatchLetter(s.wall())).toBe("A");
    s.apply(dropXd(s.get(), s.wallId, newId, { x: 1.5, y: 7 }), "drop A");
    const w = s.wall();
    const xd = s.dev("XD-A");
    expect(xd.templateId).toBe("tpl_brompton_xd");
    expect(xdOutPorts(xd)).toHaveLength(10);
    expect(w.patchBoxes).toEqual([{ deviceId: xd.id, letter: "A", x: 1.5, y: 7 }]);
    expect(w.processorIds).toEqual([xd.id, s.dev("PROC-1").id]);
    // The connection point: PROC-1 10G OUT 1 → XD-A 10G IN 1 as an LED-owned fiberLED jumper.
    const cab = s.get().cables.find((c) => c.type === "fiberLED")!;
    expect(cab.fromPort).toBe(s.dev("PROC-1").ports.find((p) => p.name === "10G OUT 1")!.id);
    expect(cab.toPort).toBe(xd.ports.find((p) => p.name === "10G IN 1")!.id);
    expect(cab.label).toBe("LED-001");
    expect(patchPorts(s.get(), w).map((p) => p.label)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);
    expect(portPatchLabel(s.get(), w, xdOutPorts(xd)[2].id)).toBe("A3");
    // Without a processor the wall blocked on LED-006; with the box it does not.
    expect(validateLed(s.get(), ctx()).map((c) => c.code)).not.toContain("LED-006");
  });

  it("B, C, D share PROC-1's four 10G outs; E brings PROC-2", () => {
    const s = wallShow();
    for (let i = 0; i < 5; i++) s.apply(dropXd(s.get(), s.wallId, newId), `drop ${i}`);
    const w = s.wall();
    expect(w.patchBoxes!.map((b) => b.letter)).toEqual(["A", "B", "C", "D", "E"]);
    expect(s.get().devices.filter((d) => d.templateId === "tpl_brompton_sx40").map((d) => d.label)).toEqual(["PROC-1", "PROC-2"]);
    const jumpers = s.get().cables.filter((c) => c.type === "fiberLED");
    expect(jumpers).toHaveLength(5);
    expect(jumpers.map((c) => c.label)).toEqual(["LED-001", "LED-002", "LED-003", "LED-004", "LED-005"]);
    const outsUsed = new Set(jumpers.map((c) => c.fromPort));
    expect(outsUsed.size).toBe(5);
    // Default drop positions stack below the grid, and moveXd relocates with clamping.
    expect(w.patchBoxes![1].y).toBeGreaterThan(w.rows);
    s.apply(moveXd(s.get(), s.wallId, w.patchBoxes![0].deviceId, { x: -3, y: 2.345 }), "move");
    expect(s.wall().patchBoxes![0]).toMatchObject({ x: 0, y: 2.35 });
    expect(moveXd(s.get(), s.wallId, w.patchBoxes![0].deviceId, { x: 0, y: 2.35 })).toEqual([]);
    expect(() => dropXd(s.get(), s.wallId, newId, { letter: "A" })).toThrow(/already has XD box A/);
  });

  it("labels stay unique across walls", () => {
    const s = wallShow();
    s.apply(dropXd(s.get(), s.wallId, newId), "A on US");
    s.apply(addWall(s.get(), { name: "IMAG L", templateId: "tpl_roe_cb5", cols: 4, rows: 3 }, newId), "imag");
    const imag = s.get().led.walls[1];
    s.apply(dropXd(s.get(), imag.id, newId), "A on IMAG");
    expect(s.get().devices.filter((d) => /^XD-A/.test(d.label)).map((d) => d.label).sort()).toEqual(["XD-A", "XD-A-2"]);
    expect(portPatchLabel(s.get(), s.get().led.walls[1], xdOutPorts(s.dev("XD-A-2"))[0].id)).toBe("A1");
  });
});

describe("Pixel & Patch: painting tiles onto ports", () => {
  function painted() {
    const s = wallShow();
    s.apply(dropXd(s.get(), s.wallId, newId), "drop A");
    const ports = patchPorts(s.get(), s.wall());
    const port = (label: string) => ports.find((p) => p.label === label)!.port.id;
    return { ...s, port };
  }

  it("add appends a stroke in stroke order; a second port steals tiles; remove and set edit the chain", () => {
    const s = painted();
    const a1 = s.port("A1"), a2 = s.port("A2");
    s.apply(paintTiles(s.get(), s.wallId, a1, [[0, 0], [0, 1], [0, 2], [1, 2]]), "paint A1");
    expect(s.wall().dataRuns).toEqual([{ portId: a1, tileChain: [[0, 0], [0, 1], [0, 2], [1, 2]], redundant: false }]);
    // Painting a tile that is already on A1 onto A2 moves it.
    s.apply(paintTiles(s.get(), s.wallId, a2, [[1, 2], [1, 1], [99, 99]]), "paint A2");
    expect(s.wall().dataRuns).toEqual([
      { portId: a1, tileChain: [[0, 0], [0, 1], [0, 2]], redundant: false },
      { portId: a2, tileChain: [[1, 2], [1, 1]], redundant: false },
    ]);
    // Appending to A1 keeps its position in the run list and dedupes.
    s.apply(paintTiles(s.get(), s.wallId, a1, [[0, 2], [0, 3]], "add"), "extend A1");
    expect(s.wall().dataRuns[0].tileChain).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    s.apply(paintTiles(s.get(), s.wallId, a1, [[0, 1]], "remove"), "unpaint");
    expect(s.wall().dataRuns[0].tileChain).toEqual([[0, 0], [0, 2], [0, 3]]);
    s.apply(paintTiles(s.get(), s.wallId, a1, [[5, 5], [5, 4]], "set"), "set A1");
    expect(s.wall().dataRuns[0].tileChain).toEqual([[5, 5], [5, 4]]);
    // Removing every tile drops the run; a no-op stroke yields no patch.
    s.apply(paintTiles(s.get(), s.wallId, a1, [[5, 5], [5, 4]], "remove"), "empty A1");
    expect(s.wall().dataRuns.map((d) => d.portId)).toEqual([a2]);
    expect(paintTiles(s.get(), s.wallId, a1, [], "add")).toEqual([]);
    expect(paintTiles(s.get(), s.wallId, a2, [[1, 2]], "add")).toEqual([]);
    expect(() => paintTiles(s.get(), s.wallId, "p_nope", [[0, 0]])).toThrow(/no port/);
  });

  it("backup runs live beside primaries and only steal from other backups", () => {
    const s = painted();
    const a1 = s.port("A1"), a2 = s.port("A2");
    s.apply(paintTiles(s.get(), s.wallId, a1, [[0, 0], [0, 1]]), "primary");
    s.apply(paintTiles(s.get(), s.wallId, a2, [[0, 0], [0, 1]], "add", { redundant: true }), "backup");
    expect(s.wall().dataRuns).toEqual([
      { portId: a1, tileChain: [[0, 0], [0, 1]], redundant: false },
      { portId: a2, tileChain: [[0, 0], [0, 1]], redundant: true },
    ]);
    expect(validateLed(s.get(), ctx({ redundancyExpected: true })).map((c) => c.code)).not.toContain("LED-005");
    s.apply(clearPort(s.get(), s.wallId, a2), "clear A2");
    expect(s.wall().dataRuns).toHaveLength(1);
    expect(clearPort(s.get(), s.wallId, a2)).toEqual([]);
  });

  it("over-painting a port raises LED-001 with the port's patch label, and autoSplitRuns still works on dropped boxes", () => {
    const s = painted();
    const a1 = s.port("A1");
    const all: [number, number][] = [];
    for (let c = 0; c < 10; c++) for (let r = 0; r < 6; r++) all.push([c, r]);
    s.apply(paintTiles(s.get(), s.wallId, a1, all, "set"), "everything on A1");
    const c1 = validateLed(s.get(), ctx()).find((c) => c.code === "LED-001")!;
    expect(c1).toMatchObject({ severity: "block", target: a1 });
    expect(c1.message).toContain("on XD-A 1G OUT 1");
    expect(60 * 104 * 208).toBeGreaterThan(portCapacity(s.get(), a1).px);
    s.apply(autoSplitRuns(s.get(), s.wallId, newId), "rebalance");
    const runs = s.wall().dataRuns;
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => portPatchLabel(s.get(), s.wall(), r.portId))).toEqual(["A1", "A2", "A3"]);
  });

  it("ledLegs summarises XD → wall runs and the SX40 → XD jumper", () => {
    const s = painted();
    s.apply(paintTiles(s.get(), s.wallId, s.port("A1"), [[0, 0], [0, 1]]), "A1");
    s.apply(paintTiles(s.get(), s.wallId, s.port("A4"), [[2, 0]]), "A4");
    const legs = ledLegs(s.get(), s.wall());
    const xd = s.dev("XD-A"), sx = s.dev("PROC-1");
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ fromDeviceId: xd.id, toWallId: s.wallId, ports: ["A1", "A4"], tiles: 3, px: 3 * 104 * 208, label: "2 runs · 3 tiles" });
    expect(legs[1]).toMatchObject({ fromDeviceId: sx.id, toDeviceId: xd.id, toWallId: null, label: "LED-001 · 10G OUT 1 → 10G IN 1" });
  });

  it("removeXd takes its runs, box, processor entry, jumper and device away in one write", () => {
    const s = painted();
    const xd = s.dev("XD-A");
    s.apply(paintTiles(s.get(), s.wallId, s.port("A1"), [[0, 0]]), "A1");
    s.apply(removeXd(s.get(), s.wallId, xd.id), "remove A", { cascade: true });
    const r: ShowRecord = s.get();
    expect(r.devices.find((d) => d.id === xd.id)).toBeUndefined();
    expect(r.cables.filter((c) => c.type === "fiberLED")).toHaveLength(0);
    expect(s.wall()).toMatchObject({ dataRuns: [], patchBoxes: [] });
    expect(s.wall().processorIds).toEqual([s.dev("PROC-1").id]);
    expect(removeXd(s.get(), s.wallId, xd.id)).toEqual([]);
    // The next drop starts again at A.
    expect(nextPatchLetter(s.wall())).toBe("A");
  });
});
