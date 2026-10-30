// Acceptance tests on the full engine: the example fixture's expected checks (Shared Show Record tab),
// the A3 → L3 handoff (Task handoff tab), and the six-step wizard (New-show path tab).
import { describe, expect, it } from "vitest";
import { engine } from "../engine";
import tasksArena from "../fixtures/tasks-arena.json";
import { binderModule } from "../modules/binder";
import { loadExample, loadVenueMemory } from "../setup/example";
import { airtablePayload, importPullSheet, parseRentalWorksCsv } from "../setup/importers";
import { applyProfile, newShowFromWizard, review, setCrew, setSchedule, sizeWalls } from "../setup/wizard";
import { memoryPersist } from "../store/persist";
import { Workspace } from "../store/store";
import type { ShowRecord } from "../store/types";

const open = (r: ShowRecord) => r.binder.checks.filter((c) => !c.resolved);
const has = (r: ShowRecord, module: string, severity: string, code: string) => open(r).some((c) => c.module === module && c.severity === severity && c.code === code);

describe("example-arena fixture: expected checks after the first validate()", () => {
  const ws = new Workspace(engine, memoryPersist());
  const r = loadExample(ws);

  it("signal/warn single point of failure — no B path to PROC-1", () => {
    expect(has(r, "signal", "warn", "SIG-008") || has(r, "signal", "warn", "SIG-009")).toBe(true);
  });
  it("signal/warn SIG-007: SRV-B output has feedsWallId but no link", () => {
    const c = open(r).find((x) => x.code === "SIG-007");
    expect(c?.severity).toBe("warn");
    expect(c?.message).toMatch(/SRV-B/);
  });
  it("led/info LED-003: tileChain empty (unmapped tiles)", () => {
    expect(has(r, "led", "info", "LED-003")).toBe(true);
  });
  it("rack: 2,350 W on L21-30 is within rating, so no RCK-003", () => {
    expect(open(r).some((c) => c.code === "RCK-003")).toBe(false);
  });
  it("binder/warn BND-002: EIC and Crew Chief empty", () => {
    expect(has(r, "binder", "warn", "BND-002")).toBe(true);
  });
  it("is not issuable (example source) and carries a stable id", () => {
    expect(r.meta.source).toBe("example");
    expect(loadExample(ws).showId).toBe(r.showId);
    expect(ws.issueShow(r.showId).ok).toBe(false);
  });
  it("cover page lists readiness, known gaps and the confirmation summary", () => {
    const cover = binderModule.exports.find((e) => e.key === "cover")!.render(ws.get(r.showId));
    expect(cover).toMatch(/EX-2026-001 · REV 1-draft/);
    expect(cover).toMatch(/Known gaps at Rev 1/);
    expect(cover).toMatch(/BND-002/);
    expect(cover).toMatch(/\d+ confirmed · \d+ assumed · \d+ waiting/);
    expect(binderModule.exports.find((e) => e.key === "checks-csv")!.render(ws.get(r.showId)).split("\n")[0]).toMatch(/^code,module,severity/);
  });
});

describe("tasks-arena: A3 → L3 unblocks on a single event.power.amps write", () => {
  it("L3 waits on A3, then unblocks in the same patch cycle", () => {
    const ws = new Workspace(engine, memoryPersist());
    const r0 = ws.importRecord(tasksArena, { keepId: true });
    const t = (k: string) => ws.get(r0.showId).tasks.find((x) => x.key === k)!;
    expect(t("A1").status).toBe("done");
    expect(t("A4").status).toBe("done");
    expect(t("L1").status).toBe("done");
    expect(t("A3").status).toBe("todo");
    expect(t("L3").status).toBe("blocked");
    const blockers = ws.get(r0.showId).derived.tasks[t("L3").id].blockers;
    expect(blockers.map((b) => b.label).join()).toMatch(/A3/);
    expect(blockers[0].route).toBe("advance");

    const res = ws.patch(r0.showId, "shell", [{ op: "replace", path: "/event/power/amps", value: 400 }], "advance: venue power 400 A");
    expect(res.ok).toBe(true);
    expect(t("A3").status).toBe("done");
    expect(t("A3").history.at(-1)!.by).toBe("shell");
    expect(t("L3").status).not.toBe("blocked");
    expect(ws.get(r0.showId).derived.tasks[t("L3").id].blockers).toEqual([]);
    // Due dates hang off the load-in entry (2026-11-14): L3 is −10 d.
    expect(ws.get(r0.showId).derived.tasks[t("L3").id].dueResolved).toBe("2026-11-04");

    // A later change files TSK-001 naming the downstream work; nothing downstream is auto-changed.
    const l3 = t("L3").status;
    ws.patch(r0.showId, "shell", [{ op: "replace", path: "/event/power/amps", value: 200 }], "advance: venue power drops to 200 A");
    const tsk = open(ws.get(r0.showId)).find((c) => c.code === "TSK-001");
    expect(tsk?.severity).toBe("info");
    expect(tsk?.message).toMatch(/L3/);
    expect(t("L3").status).toBe(l3);
  });
});

describe("wizard: blank arena show through all six steps", () => {
  const ws = new Workspace(engine, memoryPersist());
  const id = newShowFromWizard(ws, { source: "blank", artist: "Lainey Wilson", type: "arena", dates: ["2026-11-14"], venueName: "Bridgestone Arena", city: "Nashville", state: "TN", room: "Main Bowl", orderRef: "372042" });

  it("step 1 identifies the show and mints a showCode", () => {
    const r = ws.get(id);
    expect(r.showCode).toBe("LW-2026-001");
    expect(r.name).toBe("Lainey Wilson · Bridgestone Arena");
    expect(r.meta.changelog.some((c) => c.reason === "setup:identify" && c.by === "shell")).toBe(true);
    expect(review(r).nextStep).toBe(2);
  });

  it("step 2 seeds the arena profile with placeholders and the task chain", () => {
    applyProfile(ws, id, { walls: 3, cameras: 6, servers: 2, imag: true, record: true, redundantPgm: true });
    const r = ws.get(id);
    expect(r.led.walls.map((w) => w.name)).toEqual(["US Wall", "IMAG L", "IMAG R"]);
    expect(r.led.walls.every((w) => w.cols === 0 && w.templateId === "tpl_roe_cb5")).toBe(true);
    expect(r.racks.map((k) => k.name)).toEqual(["VIDEO 1", "VIDEO 2"]);
    expect(r.servers.hosts.map((h) => h.role).sort()).toEqual(["backup", "master"]);
    expect(r.devices.filter((d) => d.class === "camera")).toHaveLength(6);
    expect(r.signal.network.vlans.map((v) => v.id)).toEqual([10, 20, 30]);
    expect(r.binder.sections).toHaveLength(11);
    expect(r.binder.sections.filter((s) => s.required).map((s) => s.key)).toEqual(["front-view", "video-system", "led", "power", "schedule", "contacts"]);
    expect(r.tasks.filter((t) => t.source === "setup").map((t) => t.key)).toContain("P1");
    const writers = new Set(r.meta.changelog.filter((c) => c.reason === "setup:profile").map((c) => c.by));
    for (const w of ["led", "rack", "servers", "signal", "binder", "shell"]) expect(writers).toContain(w);
    expect(review(r).nextStep).toBe(3);
  });

  it("steps 3–5 reach advance-ready with only warn/info gaps", () => {
    const walls = ws.get(id).led.walls;
    sizeWalls(ws, id, walls.map((w) => (w.name === "US Wall"
      ? { wallId: w.id, cols: 20, rows: 6, rigging: "flown" as const, trimHeight_ft: 38 }
      : { wallId: w.id, cols: 6, rows: 4, rigging: "flown" as const, trimHeight_ft: 30 })), { pickProcessor: true });
    setCrew(ws, id, { videoDirector: "Flo", crewChief: "Ana", eic: "Ben", ledLead: "Cy", cameraLead: "Di", serverOp: "Ed", pm: "Gus" }, [{ name: "Venue PM", role: "venue", phone: "", email: "" }]);
    setSchedule(ws, id, "template");
    const r = ws.get(id);
    const rv = review(r);
    expect(rv.nextStep).toBe(6);
    expect(rv.counts.tiles).toBe(20 * 6 + 2 * 6 * 4);
    expect(open(r).filter((c) => c.severity === "block")).toEqual([]);
    expect(r.derived.readiness.advance).toBe(true);
    expect(r.binder.schedule.find((s) => s.key === "load-in")?.time).toBe("08:00");
    // What remains is documented, not hidden: every open check routes to its owning module.
    for (const m of Object.keys(rv.openChecks)) expect(rv.routes[m]).toBeTruthy();
    expect(ws.issueShow(id).ok).toBe(true);
    expect(ws.get(id).tasks.find((t) => t.key === "A6")!.status).toBe("done");
  });

  it("venue memory comes back as assumed on the next show at the venue", () => {
    const id2 = newShowFromWizard(ws, { source: "blank", artist: "Lainey Wilson", type: "arena", dates: ["2026-12-01"], venueName: "Bridgestone Arena", city: "Nashville" });
    expect(loadVenueMemory(ws, id2)).toBe(0); // nothing was confirmed on the first show
    ws.reviseShow(id, "confirm trim");
    ws.patch(id, "shell", [{ op: "replace", path: "/event/rigging/maxTrim_ft", value: { value: 42, state: "confirmed", source: "email" } }], "trim confirmed");
    expect(ws.issueShow(id).ok).toBe(true);
    expect(loadVenueMemory(ws, id2)).toBe(1);
    const leaf = ws.get(id2).event.rigging.maxTrim_ft;
    expect(leaf).toMatchObject({ value: 42, state: "assumed", source: "venue-memory" });
    expect(leaf.note).toMatch(/LW-2026-001/);
  });
});

describe("importers", () => {
  const csv = `I-Code,Description,Qty\nV1001,ROE CB5 LED Panel,24\nV2002,Brompton Tessera SX40 Processor,1\nZZ999,Mystery widget,2\n`;
  it("parses a RentalWorks pull sheet", () => {
    expect(parseRentalWorksCsv(csv)).toEqual([
      { iCode: "V1001", description: "ROE CB5 LED Panel", qty: 24 },
      { iCode: "V2002", description: "Brompton Tessera SX40 Processor", qty: 1 },
      { iCode: "ZZ999", description: "Mystery widget", qty: 2 },
    ]);
  });
  it("first import instantiates matches by owning writer, unknowns as class unknown; re-import diffs as warn checks", () => {
    const ws = new Workspace(engine, memoryPersist());
    const id = ws.createShow({ artist: "Imp", year: 2026 }).showId;
    const res = importPullSheet(ws, id, csv);
    const r = ws.get(id);
    expect(res.unknown).toBe(1);
    expect(r.devices.some((d) => d.class === "tile" && d.qty === 24 && d.inventoryRef.iCode === "V1001")).toBe(true);
    expect(r.devices.some((d) => d.class === "processor")).toBe(true);
    expect(r.devices.some((d) => d.class === "unknown" && d.inventoryRef.iCode === "ZZ999")).toBe(true);
    expect(open(r).some((c) => c.code === "IMP-003" && c.severity === "info")).toBe(true);
    const before = ws.get(id).devices.length;
    const res2 = importPullSheet(ws, id, `I-Code,Description,Qty\nV1001,ROE CB5 LED Panel,30\nV2002,Brompton Tessera SX40 Processor,1\n`);
    const r2 = ws.get(id);
    expect(r2.devices).toHaveLength(before);
    expect(res2.diff!.added.map((l) => l.iCode)).toEqual(["V1001"]);
    expect(open(r2).filter((c) => c.code === "IMP-001" && c.severity === "warn")).toHaveLength(1);
    expect(open(r2).filter((c) => c.code === "IMP-002" && c.severity === "warn")).toHaveLength(1);
  });
  it("builds the Airtable Ground payload without network", () => {
    const ws = new Workspace(engine, memoryPersist());
    const r = loadExample(ws);
    const p = airtablePayload(r);
    expect(p.baseId).toBe("appzQEKX7O1IAi6KN");
    expect(p.Shows[0].fields.showCode).toBe("EX-2026-001");
    expect(p.Devices).toHaveLength(r.devices.length);
    expect(p.Racks[0].fields.name).toBe("VIDEO 1");
    expect(p.Checks.every((c) => typeof c.fields.severity === "string")).toBe(true);
  });
});

describe("binder auto blocks", () => {
  it("every auto ref resolves to a registered module export", () => {
    const keys = new Set(engine.modules.flatMap((m) => m.exports.map((e) => `${m.id}.${e.key}`)));
    const ws = new Workspace(engine, memoryPersist());
    const id = ws.createShow({ artist: "Ref", year: 2026 }).showId;
    ws.patch(id, "binder", binderModule.seed(ws.get(id), { newId: (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`, profile: "festival" }), "seed");
    const r = ws.get(id);
    const refs = r.binder.sections.flatMap((s) => s.blocks.filter((b) => b.type === "auto").map((b) => b.ref!));
    expect(refs.filter((x) => !keys.has(x))).toEqual([]);
    expect(r.binder.sections.find((s) => s.key === "rigging")).toMatchObject({ visible: false, required: false });
  });
});
