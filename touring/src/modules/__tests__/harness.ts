// Test harness: a Workspace with only the LED / Rack / Servers modules and stubbed store hooks,
// so these tests run independently of the other modules' ports.
import fixture from "../../fixtures/example-arena.json";
import { LIBRARY, library } from "../../library/library";
import { normalize } from "../../store/blank";
import { newId } from "../../store/ids";
import { Workspace, type Engine } from "../../store/store";
import type { EventType, ShowRecord, SystemProfile, ValidateContext } from "../../store/types";
import { ledModule } from "../led";
import { rackModule } from "../rack";
import { serversModule } from "../servers";

export function profile(over: Partial<SystemProfile> = {}): SystemProfile {
  return {
    type: "arena", formats: { house: "1080p59.94", ledInput: "3840x2160p59.94", record: "1080p59.94" }, walls: [], tileTemplate: "tpl_roe_cb5",
    cameras: 0, servers: 2, racks: ["VIDEO 1"], distro: "3Ø 200A", redundancyExpected: false, dualServerExpected: false, record: "PGM",
    vlans: [], binderHidden: [], ...over,
  };
}

export function ctx(over: Partial<SystemProfile> = {}): ValidateContext {
  return { profile: profile(over), library };
}

export function engine(p: Partial<SystemProfile> = {}): Engine {
  return {
    modules: [ledModule, rackModule, serversModule], library, libraryVersion: LIBRARY.libraryVersion,
    profileFor: (type: EventType) => profile({ type, ...p }),
    deriveTasks: (r) => ({ tasks: r.tasks, derived: {}, checks: [] }),
    readiness: () => ({ advance: false, criteria: [] }),
    binderSummary: () => ({ completeness: {}, openBySeverity: { block: 0, warn: 0, info: 0 } }),
  };
}

export function exampleRecord(): ShowRecord {
  return normalize(structuredClone(fixture) as unknown as ShowRecord);
}

/** A workspace holding the example fixture (or a blank show) for patch round-trips under real ownership gates. */
export function workspace(opts: { blank?: boolean; profile?: Partial<SystemProfile> } = {}) {
  const ws = new Workspace(engine(opts.profile));
  const r = opts.blank ? ws.createShow({ artist: "Module Test", year: 2026 }) : ws.importRecord(asWorkingCopy(fixture), { keepId: true });
  return { ws, id: r.showId, get: () => ws.get(r.showId) };
}

export { newId };

/** The example ships read-only (meta.source = example); tests edit a working copy of it. */
export function asWorkingCopy<T>(json: T): T {
  const c = structuredClone(json) as T & { meta: { source: string } };
  c.meta.source = "copy";
  return c;
}
