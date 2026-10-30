import { SCHEMA_VERSION, type Confirmed, type Derived, type EventRecord, type EventType, type ShowRecord, type ShowSource } from "./types";

export function unknown<T>(value: T | null = null): Confirmed<T> {
  return { value, state: "unknown" };
}

export function blankEvent(type: EventType = "arena"): EventRecord {
  return {
    type, dates: [], venueId: null, venueName: "", city: "", state: "", room: "",
    access: {
      docks: unknown(), pushDistance_ft: unknown(), pathNotes: unknown(), elevator: unknown(), stageDims: unknown(),
      videoWorld: unknown(), truckParking: unknown(), shorePower: unknown(), credentials: unknown(),
      floorLoad_psf: unknown(), floorProtection: unknown(), lifts: unknown(),
    },
    power: {
      services: unknown(), dedicated: unknown(), electrician: unknown(), generator: unknown(),
      constraints: unknown(), groundingNotes: unknown(), service: "", amps: null, location: "",
    },
    rigging: {
      maxTrim_ft: unknown(), steelHeight_ft: unknown(), points: unknown(), pointCapacity_lb: unknown(), spacing_ft: unknown(),
      plotRef: unknown(), plotFormat: unknown(), houseRigger: unknown(), motors: unknown(), groundSupport: unknown(), restrictions: unknown(),
    },
    foh: unknown(),
    signalPath: { stageToFOH: unknown(), houseFibre: unknown(), videoVillage: unknown(), houseFeeds: unknown() },
    cameras: { positions: unknown() },
    comms: unknown(),
    labor: unknown(),
    houseVideo: unknown(),
  };
}

export function emptyDerived(): Derived {
  return {
    led: { perWall: {}, totals: { tiles: 0, maxW: 0, avgW: 0, weightLb: 0 } },
    power: { byCircuit: {}, byDistro: {}, totalW: 0, totalA_perLeg: 0 },
    racks: { byRack: {} },
    signal: { unresolvedPorts: [], formatMismatches: [], singlePoints: [], resolvedFormat: {} },
    inventory: { deviceCount: 0, cableCountByType: {}, caseCount: 0 },
    physical: { byPath: {} },
    tasks: {},
    readiness: { advance: false, criteria: [] },
    binder: { completeness: {}, openBySeverity: { block: 0, warn: 0, info: 0 } },
    computedAt: "",
  };
}

export function blankRecord(showId: string, showCode: string, source: ShowSource, now: string): ShowRecord {
  return {
    showId, showCode, tourId: null, name: "",
    client: { artist: "", management: "", productionCo: "" },
    event: blankEvent(),
    vendor: { company: "Fuse Operations", orderRef: "", orderSystem: "RentalWorks" },
    crew: { videoDirector: "", crewChief: "", eic: "", ledLead: "", cameraLead: "", serverOp: "", pm: "", localLabor: "" },
    meta: { status: "draft", revision: 1, schemaVersion: SCHEMA_VERSION, source, createdAt: now, updatedAt: now, updatedBy: "shell", changelog: [], rev: 0 },
    devices: [], cables: [],
    led: { walls: [], canvas: { w_px: 0, h_px: 0, mappings: [] } },
    signal: {
      nodes: [], links: [], formats: { house: "", ledInput: "", record: "" }, redundancy: [],
      network: { vlans: [], hosts: [] },
    },
    racks: [],
    servers: { hosts: [], content: { canvasRef: "led.canvas", contentSpecs: [] } },
    binder: { sections: [], annotations: [], checks: [], schedule: [], contacts: [] },
    tasks: [],
    physical: { positions: [], paths: [], trunks: [], stock: {} },
    derived: emptyDerived(),
  };
}

/** Fills any slice a hand-written fixture or older export left out, so every module can read safely. */
export function normalize(r: Partial<ShowRecord> & { showId: string }): ShowRecord {
  const base = blankRecord(r.showId, r.showCode ?? "", r.meta?.source ?? "blank", r.meta?.createdAt ?? new Date().toISOString());
  const ev = { ...base.event, ...(r.event ?? {}) } as EventRecord;
  // Older records carry only the identity block of `event`; fill advance sections.
  const be = blankEvent(ev.type);
  for (const k of ["access", "power", "rigging", "signalPath", "cameras"] as const) {
    (ev as unknown as Record<string, unknown>)[k] = { ...(be[k] as object), ...((ev[k] as object) ?? {}) };
  }
  for (const k of ["foh", "comms", "labor", "houseVideo"] as const) if (!ev[k]) (ev as unknown as Record<string, unknown>)[k] = be[k];
  const out: ShowRecord = {
    ...base, ...r,
    event: ev,
    crew: { ...base.crew, ...(r.crew ?? {}) },
    meta: { ...base.meta, ...(r.meta ?? {}), changelog: r.meta?.changelog ?? [], rev: r.meta?.rev ?? 0 },
    led: { ...base.led, ...(r.led ?? {}) },
    signal: { ...base.signal, ...(r.signal ?? {}), network: { ...base.signal.network, ...(r.signal?.network ?? {}) } },
    servers: { ...base.servers, ...(r.servers ?? {}) },
    binder: { ...base.binder, ...(r.binder ?? {}) },
    tasks: r.tasks ?? [],
    physical: { ...base.physical, ...(r.physical ?? {}) },
    derived: { ...emptyDerived(), ...((r.derived as Derived) ?? {}) },
  } as ShowRecord;
  const defaults = { rackId: null, ru: 0, powerW: 0, weightLb: 0, qty: 1, ports: [], inventoryRef: {} };
  out.devices = (out.devices ?? []).map((d) => ({ ...defaults, ...d }));
  out.cables = out.cables ?? [];
  return out;
}
