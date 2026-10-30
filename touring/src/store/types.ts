// ShowRecord — the single source of truth for a show.
// Mirrors "Shared Show Record & Module Contracts" plus the additions from the
// Task handoff, Venue advance, Device library and Cable & panels tabs.

export const SCHEMA_VERSION = "1.0.0";

export type ModuleId = "led" | "signal" | "rack" | "servers" | "binder";
export type WriterId = ModuleId | "shell" | "store" | "mobile";
export type ShowStatus = "draft" | "issued" | "locked" | "archived";
export type ShowSource = "blank" | "template" | "example" | "copy";
export type EventType = "arena" | "amphitheater" | "festival" | "fly-date" | "rehearsal" | "corporate" | "broadcast";
export const EVENT_TYPES: EventType[] = ["arena", "amphitheater", "festival", "fly-date", "rehearsal", "corporate", "broadcast"];

export type IdPrefix =
  | "dev" | "p" | "cab" | "wall" | "ckt" | "sig" | "lnk" | "rg" | "rack" | "srv"
  | "sec" | "ann" | "chk" | "task" | "pos" | "path" | "seg" | "jack" | "sch" | "con" | "svc" | "cam";

// ---------- devices ----------
export type DeviceClass =
  | "tile" | "processor" | "distro" | "ledPdu"
  | "camera" | "ccu" | "switcher" | "router" | "converter" | "recorder" | "monitor" | "fiber"
  | "rackPdu" | "ups" | "shelf" | "patchPanel"
  | "server" | "kvm" | "capture" | "tcGen"
  | "unknown";

export type PortType =
  | "12G-SDI" | "3G-SDI" | "HD-SDI" | "HDMI2.0" | "HDMI2.1" | "DP1.2" | "DP1.4" | "DVI"
  | "fiberLED" | "etherCon" | "fiber-SMPTE" | "fiber-LC" | "fiber-ST" | "cat6"
  | "genlock" | "LTC" | "tally" | "intercom" | "dmx" | "AC-in" | "AC-out" | "DC-in";

export type PortDir = "in" | "out" | "bidir";

export interface Port { id: string; name: string; type: PortType; dir: PortDir }

export interface Jack {
  id: string; number: number; type: PortType;
  front: { cableId: string | null }; rear: { cableId: string | null };
  label?: string; group?: string;
}

export interface Device {
  id: string;
  templateId?: string;
  class: DeviceClass;
  make: string;
  model: string;
  label: string;
  qty: number;
  rackId: string | null;
  ru: number;
  powerW: number;
  weightLb: number;
  ports: Port[];
  spec?: Record<string, unknown>;
  source?: "manufacturer" | "measured" | "approximate";
  positionId?: string | null;
  inventoryRef: { system?: string; iCode?: string; barcode?: string };
  ext?: { airtable?: string };
}

// ---------- cables / physical ----------
export type CableType =
  | "SDI" | "HDMI" | "DP" | "DP-HDMI" | "SMPTE-311" | "fiber" | "cat6" | "tally" | "comms"
  | "BNC-ref" | "audio-TRS" | "BNC" | "power" | "etherCon" | "fiberLED" | "tilePower";

export type SegmentEnd = { port: string } | { jack: string; side: "front" | "rear" } | { strand: string };
export interface Segment {
  id: string; kind: "jumper" | "run" | "trunk-strand";
  from: SegmentEnd; to: SegmentEnd; pathId?: string;
  length_ft: { derived: number; pinned?: number; stock: number };
  reelRef?: string; label: string; landed?: boolean;
}

export interface Cable {
  id: string;
  type: CableType;
  length_ft: number;
  fromPort: string | null;
  toPort: string | null;
  label: string;
  redundancyGroup: "A" | "B" | null;
  segments?: Segment[];
  pathChain?: string[];
  strands?: number;
}

export type ConfirmState = "unknown" | "asked" | "assumed" | "confirmed" | "waived";
export interface Confirmed<T> {
  value: T | null; state: ConfirmState; by?: string; at?: string;
  source?: "email" | "call" | "tech-pack" | "site-visit" | "venue-memory" | "stage-plot";
  askedTo?: string; askedAt?: string; evidence?: string[]; note?: string;
}

export interface Position {
  id: string; label: string;
  kind: "stage" | "video-world" | "foh" | "power" | "camera" | "village" | "external";
  x_ft?: number; y_ft?: number; sourcePath: string;
}
export interface PhysPath {
  id: string; from: string; to: string; length_ft: Confirmed<number>;
  route: "overhead" | "trench" | "floor" | "house-fibre" | "direct";
  protection?: string; capacityNotes?: string; viaPanels: string[];
}

// ---------- module slices ----------
export interface Circuit { id: string; amps: number; tiles: [number, number][] }
export interface DataRun { portId: string; tileChain: [number, number][]; redundant: boolean }
export interface Wall {
  id: string; name: string; tileModel: string; templateId?: string;
  cols: number; rows: number; tileW_mm: number; tileH_mm: number; pitch_mm: number; trimHeight_ft: number;
  position?: string;
  rigging: { type: "flown" | "ground" | "hybrid"; headers: number; points: unknown[] };
  processorIds: string[];
  dataRuns: DataRun[];
  power: { phase: "3Ø" | "1Ø"; circuits: Circuit[]; distroId: string | null };
}

export interface SignalNode { id: string; deviceId: string; role: "source" | "switcher" | "router" | "processor" | "record" | "monitor" | "sink"; x: number; y: number }
export interface SignalLink { id: string; cableId: string; format: string; path: "A" | "B"; label: string; inherited?: boolean }
export interface RedundancyGroup { id: string; name: string; primary: string[]; backup: string[] }

export interface Rack {
  id: string; name: string; ruTotal: number; caseModel: string; location: string;
  slots: { ru: number; deviceId: string }[];
  power: { inlet: string; pduIds: string[]; circuitIds: string[] };
  positionId?: string | null;
}

export interface ServerHost {
  id: string; deviceId: string; platform: string; role: "master" | "backup" | "understudy";
  outputs: { portId: string; resolution: string; refresh: number; feedsWallId: string | null }[];
  inputs: { portId: string; source: string }[];
  timecode: "LTC" | "MTC" | "none"; failover: string | null;
}

export type Severity = "info" | "warn" | "block";
export interface Check {
  id: string; code: string; module: ModuleId | "store"; severity: Severity;
  title: string; target: string; involved: string[];
  message: string; rule: string;
  evidence: { label: string; value: string; path: string }[];
  fixes: { label: string; patch?: Patch[]; module: ModuleId | "shell" }[];
  resolved: boolean; resolvedBy?: string; resolvedAt?: string;
  resolution?: "fixed" | "accepted-risk" | "not-applicable";
  firstSeen: string; lastSeen: string; rev: number;
}

export type BinderSectionKey = "front-view" | "rigging" | "video-system" | "led" | "cameras" | "network" | "foh" | "power" | "schedule" | "contacts" | "notes";
export interface BinderSection {
  id: string; key: BinderSectionKey; order: number; visible: boolean; required?: boolean;
  blocks: { type: "auto" | "text" | "image" | "table"; ref: string | null; body: string }[];
}
export interface ScheduleEntry { id: string; key?: string; date: string; time: string; item: string; owner: string; confirmed?: boolean }
export interface Contact { id: string; name: string; role: string; phone: string; email: string }
export interface Annotation { id: string; target: string; author: string; body: string; at: string }

// ---------- tasks ----------
export type Lane = "advance" | "signal" | "crew" | "led" | "servers" | "rack" | "prep";
export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "na";
export type Condition =
  | { kind: "path-set"; path: string }
  | { kind: "path-equals"; path: string; value: unknown }
  | { kind: "count-min"; path: string; min: number }
  | { kind: "check-clear"; code: string; target?: string }
  | { kind: "status"; status: ShowStatus }
  | { kind: "all"; of: Condition[] };
export interface Task {
  id: string; key?: string; lane: Lane; title: string; detail?: string;
  status: TaskStatus; owner?: string; due?: string;
  dueFrom?: { scheduleId: string; offsetDays: number };
  about: string[]; blockedBy: string[];
  produces?: Condition; consumes?: Condition[];
  source: "setup" | "check" | "user" | "import"; checkId?: string;
  userDone?: boolean;
  history: { at: string; by: string; from: TaskStatus; to: TaskStatus; note?: string }[];
}

// ---------- event / advance ----------
export interface PowerService { id: string; amps: number; phase: "3Ø" | "1Ø"; volts: number; connector: "cam-lok" | "tails" | "L21-30" | "other"; location: string; toVideoWorld_ft?: number; toUpstage_ft?: number }
export interface CameraPosition { id: string; label: string; location: string; platform: boolean; permitted: boolean; toVideoWorld_ft?: number }
export interface HouseFeed { destination: string; format: string; connector: string; location: string }

export interface EventRecord {
  type: EventType; dates: string[]; venueId: string | null; venueName: string; city: string; state: string; room: string;
  access: {
    docks: Confirmed<{ count: number; type: "dock-high" | "ground" | "ramp" | "unknown"; windowStart?: string; windowEnd?: string }>;
    pushDistance_ft: Confirmed<number>; pathNotes: Confirmed<string>;
    elevator: Confirmed<{ present: boolean; capacity_lb?: number; door_in?: number }>;
    stageDims: Confirmed<{ width_ft: number; depth_ft: number; wingSL_ft?: number; wingSR_ft?: number }>;
    videoWorld: Confirmed<{ location: string; toStage_ft?: number; toFOH_ft?: number; toDistro_ft?: number }>;
    truckParking: Confirmed<string>; shorePower: Confirmed<boolean>; credentials: Confirmed<string>;
    floorLoad_psf: Confirmed<number>; floorProtection: Confirmed<string>;
    lifts: Confirmed<{ forklift: boolean; scissor: boolean; operatorProvided: boolean }>;
  };
  power: {
    services: Confirmed<PowerService[]>; dedicated: Confirmed<boolean>;
    electrician: Confirmed<{ required: boolean; name?: string; phone?: string; callNotes?: string }>;
    generator: Confirmed<{ required: boolean; provider?: string; kva?: number; location?: string }>;
    constraints: Confirmed<string>; groundingNotes: Confirmed<string>;
    // convenience mirrors read by the seeded task chain (A3)
    service?: string; amps?: number | null; location?: string;
  };
  rigging: {
    maxTrim_ft: Confirmed<number>; steelHeight_ft: Confirmed<number>;
    points: Confirmed<{ id: string; label: string; capacity_lb: number; x_ft?: number; y_ft?: number }[]>;
    pointCapacity_lb: Confirmed<number>; spacing_ft: Confirmed<number>;
    plotRef: Confirmed<string>; plotFormat: Confirmed<"PDF" | "DWG" | "VWX">;
    houseRigger: Confirmed<{ required: boolean; name?: string; phone?: string; callNotes?: string }>;
    motors: Confirmed<{ provider: "tour" | "venue" | "vendor"; count: number; capacity_lb: number; control?: string }>;
    groundSupport: Confirmed<{ allowed: boolean; maxStack_ft?: number; ballastNotes?: string }>;
    restrictions: Confirmed<string>;
  };
  foh: Confirmed<{ location: string; width_ft?: number; depth_ft?: number; riserHeight_ft?: number; toStage_ft?: number; shared?: string[] }>;
  signalPath: {
    stageToFOH: Confirmed<{ route: "overhead" | "trench" | "floor" | "house-fibre"; length_ft: number; protection?: string }>;
    houseFibre: Confirmed<{ available: boolean; strands?: number; connector?: string; testedDate?: string }>;
    videoVillage: Confirmed<{ location: string; toVideoWorld_ft?: number }>;
    houseFeeds: Confirmed<HouseFeed[]>;
  };
  cameras: { positions: Confirmed<CameraPosition[]> };
  comms: Confirmed<{ houseIntercom?: string; wirelessRestrictions?: string; frequencyCoordination?: string }>;
  labor: Confirmed<{ unionHouse: boolean; breakRules?: string; mealRules?: string; otAfter_h?: number }>;
  houseVideo: Confirmed<string>;
}

export interface Crew {
  videoDirector: string; crewChief: string; eic: string; ledLead: string; cameraLead: string; serverOp: string;
  pm?: string; localLabor?: string;
}

export interface ChangelogEntry { rev: number; at: string; by: WriterId; reason: string; from?: number; paths?: string[] }

export interface Derived {
  led: {
    perWall: Record<string, { tiles: number; w_px: number; h_px: number; w_ft: number; h_ft: number; maxW: number; avgW: number; weightLb: number; portsNeeded: number; approximate: boolean }>;
    totals: { tiles: number; maxW: number; avgW: number; weightLb: number };
  };
  power: { byCircuit: Record<string, { amps: number; loadW: number; loadA: number; pct: number }>; byDistro: Record<string, { loadW: number }>; totalW: number; totalA_perLeg: number };
  racks: { byRack: Record<string, { ruUsed: number; weightLb: number; powerW: number; amps: number }> };
  signal: { unresolvedPorts: string[]; formatMismatches: string[]; singlePoints: string[]; resolvedFormat: Record<string, string> };
  inventory: { deviceCount: number; cableCountByType: Record<string, number>; caseCount: number };
  physical?: { byPath: Record<string, { cables: number; byType: Record<string, number>; totalFt: number }> };
  tasks: Record<string, { status: TaskStatus; blockers: { kind: string; label: string; route?: string }[]; dueResolved?: string }>;
  readiness: { advance: boolean; criteria: { label: string; ok: boolean; blocks: boolean }[] };
  binder: { completeness: Record<string, number>; openBySeverity: Record<Severity, number> };
  computedAt: string;
}

export interface ShowRecord {
  showId: string;
  showCode: string;
  tourId: string | null;
  name: string;
  client: { artist: string; management: string; productionCo: string };
  event: EventRecord;
  vendor: { company: string; orderRef: string; orderSystem: string };
  crew: Crew;
  meta: {
    status: ShowStatus; revision: number; schemaVersion: string; source: ShowSource;
    createdAt: string; updatedAt: string; updatedBy: WriterId; changelog: ChangelogEntry[];
    libraryVersion?: string; rev: number;
  };
  devices: Device[];
  cables: Cable[];
  led: { walls: Wall[]; canvas: { w_px: number; h_px: number; mappings: { wallId: string; x: number; y: number }[] } };
  signal: {
    nodes: SignalNode[]; links: SignalLink[];
    formats: { house: string; ledInput: string; record: string; truck?: string };
    redundancy: RedundancyGroup[];
    network: { vlans: { id: number; name: string; subnet: string }[]; hosts: { deviceId: string; vlan: number; ip: string }[] };
  };
  racks: Rack[];
  servers: { hosts: ServerHost[]; content: { canvasRef: string; contentSpecs: { wallId: string; w_px: number; h_px: number; codec: string; fps: number }[] } };
  binder: { sections: BinderSection[]; annotations: Annotation[]; checks: Check[]; schedule: ScheduleEntry[]; contacts: Contact[] };
  tasks: Task[];
  physical: { positions: Position[]; paths: PhysPath[]; trunks: string[]; stock: Partial<Record<CableType, number[]>> };
  derived: Derived;
}

export interface Revision { rev: number; issuedAt: string; record: ShowRecord; openTasks: Task[] }

export type Patch =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown; ifHash?: string }
  | { op: "remove"; path: string; ifHash?: string }
  | { op: "move"; from: string; path: string };

export interface StoreError { code: string; path: string; msg: string }
export interface Result { ok: boolean; rev: number; errors?: StoreError[] }

export interface ModuleContract {
  id: ModuleId;
  version: string;
  owns: string[];
  reads: string[];
  deviceClasses: DeviceClass[];
  cableTypes: CableType[];
  seed(record: ShowRecord, ctx: SeedContext): Patch[];
  derive(record: ShowRecord): Partial<Derived>;
  validate(record: ShowRecord, ctx: ValidateContext): CheckDraft[];
  migrate?(record: ShowRecord, from: string): ShowRecord;
  exports: { key: string; label: string; mime: string; render(record: ShowRecord): string }[];
}

export interface SeedContext { newId(prefix: IdPrefix): string; profile: EventType }
export interface ValidateContext { profile: SystemProfile; library: LibraryLookup }

/** A check before the store stamps id / timestamps / resolution state. */
export type CheckDraft = Omit<Check, "id" | "resolved" | "firstSeen" | "lastSeen" | "rev" | "module" | "involved" | "evidence" | "fixes" | "rule"> &
  Partial<Pick<Check, "involved" | "evidence" | "fixes" | "rule">>;

export interface SystemProfile {
  type: EventType;
  formats: { house: string; ledInput: string; record: string };
  walls: { name: string; position: string }[];
  tileTemplate: string | null;
  cameras: number;
  servers: 0 | 1 | 2;
  racks: string[];
  distro: string;
  redundancyExpected: boolean;
  dualServerExpected: boolean;
  record: string;
  vlans: { id: number; name: string; subnet: string }[];
  binderHidden: BinderSectionKey[];
  binderOnly?: BinderSectionKey[];
}

export interface LibraryLookup {
  get(templateId: string): DeviceTemplate | undefined;
  find(q: { class?: DeviceClass; protocol?: string; make?: string; text?: string }): DeviceTemplate[];
}

export interface PortTemplate { name: string; type: PortType; dir: PortDir; count: number; notes?: string }
export interface DeviceTemplate {
  templateId: string; class: DeviceClass; make: string; model: string; aliases?: string[];
  ru: number; powerW: number; weightLb: number; ports: PortTemplate[]; spec: Record<string, unknown>;
  inventory?: { iCodes: string[]; caseModel?: string; caseWeightLb?: number };
  source: "manufacturer" | "measured" | "approximate"; verifiedAt?: string; deprecated?: boolean;
}
