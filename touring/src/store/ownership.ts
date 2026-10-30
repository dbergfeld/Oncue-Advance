import { getAt, parsePointer, startsWith } from "./pointer";
import type { CableType, DeviceClass, Lane, Patch, ShowRecord, ShowStatus, StoreError, WriterId } from "./types";

// Device classes and cable types are shared-write: exactly one writer per class / type.
export const DEVICE_CLASS_OWNER: Record<DeviceClass, WriterId[]> = {
  tile: ["led"], processor: ["led"], distro: ["led"], ledPdu: ["led"],
  camera: ["signal"], ccu: ["signal"], switcher: ["signal"], router: ["signal"], converter: ["signal"],
  recorder: ["signal"], monitor: ["signal"], fiber: ["signal"],
  rackPdu: ["rack"], ups: ["rack"], shelf: ["rack"],
  // Rack places rack-panel kinds; Signal places stage boxes, bulkheads and breakouts (Cable & panels tab).
  patchPanel: ["rack", "signal"],
  server: ["servers"], kvm: ["servers"], capture: ["servers"], tcGen: ["servers"],
  // RentalWorks import lands unrecognised I-Codes here for a human to classify.
  unknown: ["shell"],
};

export const LED_CABLES: CableType[] = ["etherCon", "fiberLED", "tilePower"];
export function cableOwner(t: CableType): WriterId {
  return LED_CABLES.includes(t) ? "led" : "signal";
}

export const LANE_OWNER: Record<Lane, WriterId[]> = {
  advance: ["shell"], crew: ["shell"], prep: ["shell", "mobile"],
  signal: ["signal"], led: ["led"], servers: ["servers"], rack: ["rack"],
};

/** Plain path prefixes each writer owns outright. */
const OWNS: Record<WriterId, string[]> = {
  shell: ["/showCode", "/tourId", "/name", "/client", "/event", "/vendor", "/crew", "/binder/schedule", "/binder/contacts", "/binder/annotations"],
  led: ["/led", "/binder/annotations"],
  signal: ["/signal", "/physical", "/binder/annotations"],
  rack: ["/racks", "/binder/annotations"],
  servers: ["/servers", "/binder/annotations"],
  binder: ["/binder"],
  mobile: ["/binder/annotations"],
  store: ["/"],
};

const IDENTITY_PATHS = ["/showCode", "/tourId", "/name", "/client", "/event", "/vendor", "/crew"];

/** Fields any listed writer may set on a device it does not own by class. */
const DEVICE_FIELD_ALLOW: Record<string, WriterId[]> = {
  rackId: ["rack"],
  ru: ["rack"],
  positionId: ["rack"],
  inventoryRef: ["shell"],
};

export function canWriteDevice(by: WriterId, cls: DeviceClass | undefined): boolean {
  if (by === "store") return true;
  if (!cls) return false;
  return DEVICE_CLASS_OWNER[cls]?.includes(by) ?? false;
}

export function canWriteLane(by: WriterId, lane: Lane | undefined): boolean {
  if (by === "store" || by === "binder") return true;
  if (!lane) return false;
  return LANE_OWNER[lane]?.includes(by) ?? false;
}

function err(code: string, path: string, msg: string): StoreError {
  return { code, path, msg };
}

/**
 * Checks one op against the caller's ownership. `before` is the record state the op will apply to
 * (ops are checked in sequence so an add-then-edit inside one patch resolves the new entity).
 */
export function checkOwnership(by: WriterId, op: Patch, before: ShowRecord): StoreError | null {
  if (by === "store") return null;
  const paths = op.op === "move" ? [op.from, op.path] : [op.path];
  for (const path of paths) {
    const e = checkPath(by, op, path, before);
    if (e) return e;
  }
  return null;
}

function checkPath(by: WriterId, op: Patch, path: string, before: ShowRecord): StoreError | null {
  const segs = parsePointer(path);
  const top = segs[0];

  if (top === "devices") {
    if (segs.length < 2) return err("E_NOT_OWNER", path, `${by} may not replace the whole devices[] collection`);
    const existing = getAt(before, `/devices/${segs[1]}`) as { class?: DeviceClass } | undefined;
    const cls = existing?.class ?? (op.op === "add" && segs.length === 2 ? (op.value as { class?: DeviceClass })?.class : undefined);
    if (canWriteDevice(by, cls)) {
      // An owner may not move its device into a class it does not own.
      if (op.op !== "remove" && op.op !== "move") {
        const newCls = segs.length === 2 ? (op.value as { class?: DeviceClass })?.class : segs[2] === "class" ? (op.value as DeviceClass) : undefined;
        if (newCls && !canWriteDevice(by, newCls)) return err("E_CLASS_OWNER", path, `${by} may not create devices of class ${newCls}`);
      }
      return null;
    }
    const field = segs[2];
    if (field && DEVICE_FIELD_ALLOW[field]?.includes(by)) return null;
    if (by === "mobile" && field === "inventoryRef" && segs[3] === "barcode") return null;
    if (by === "shell" && cls === "unknown") return null;
    return err("E_CLASS_OWNER", path, `${by} does not own devices of class ${cls ?? "?"}`);
  }

  if (top === "cables") {
    if (segs.length < 2) return err("E_NOT_OWNER", path, `${by} may not replace the whole cables[] collection`);
    const existing = getAt(before, `/cables/${segs[1]}`) as { type?: CableType } | undefined;
    const type = existing?.type ?? (op.op === "add" && segs.length === 2 ? (op.value as { type?: CableType })?.type : undefined);
    if (by === "mobile" && segs[2] === "segments" && segs[4] === "landed") return null;
    if (!type) return err("E_NOT_OWNER", path, "cable type unknown");
    if (cableOwner(type) !== by) return err("E_NOT_OWNER", path, `${by} does not own ${type} cables`);
    if (op.op !== "remove" && op.op !== "move") {
      const newType = segs.length === 2 ? (op.value as { type?: CableType })?.type : segs[2] === "type" ? (op.value as CableType) : undefined;
      if (newType && cableOwner(newType) !== by) return err("E_NOT_OWNER", path, `${by} may not create ${newType} cables`);
    }
    return null;
  }

  if (top === "tasks") {
    if (segs.length < 2) return err("E_LANE_OWNER", path, `${by} may not replace the whole tasks[] collection`);
    const existing = getAt(before, `/tasks/${segs[1]}`) as { lane?: Lane } | undefined;
    const lane = existing?.lane ?? (op.op === "add" && segs.length === 2 ? (op.value as { lane?: Lane })?.lane : undefined);
    if (!canWriteLane(by, lane)) return err("E_LANE_OWNER", path, `${by} may not write tasks in lane ${lane ?? "?"}`);
    return null;
  }

  if (top === "binder" && segs[1] === "checks") {
    // Modules may append checks; only the Binder (and mobile) resolve them.
    if (by === "binder" || by === "mobile") return null;
    if (op.op === "add" && segs.length === 3) return null;
    return err("E_NOT_OWNER", path, "only the Show Binder resolves checks");
  }

  for (const prefix of OWNS[by] ?? []) if (startsWith(path, prefix)) return null;
  return err("E_NOT_OWNER", path, `${by} does not own ${path}`);
}

/** Frozen-state gate: which input paths stay writable after issue / lock. */
export function checkFrozen(by: WriterId, status: ShowStatus, op: Patch, before: ShowRecord): StoreError | null {
  if (by === "store" || status === "draft") return null;
  const path = op.path;
  if (status === "archived") return err("E_FROZEN", path, "archived shows are read-only");
  if (startsWith(path, "/binder/annotations") || startsWith(path, "/binder/checks")) return null;
  if (status === "locked") {
    if (by === "binder" && startsWith(path, "/binder")) return null;
    if (startsWith(path, "/tasks")) {
      const segs = parsePointer(path);
      const t = getAt(before, `/tasks/${segs[1]}`) as { lane?: Lane } | undefined;
      const lane = t?.lane ?? (op.op === "add" ? (op.value as { lane?: Lane })?.lane : undefined);
      // Existing tasks may change status; new tasks only in the prep lane.
      if (t ? segs[2] === "status" || segs[2] === "history" : lane === "prep") return null;
    }
    if (by === "mobile" && /^\/devices\/[^/]+\/inventoryRef\/barcode$/.test(path)) return null;
    if (by === "mobile" && /^\/cables\/[^/]+\/segments\/[^/]+\/landed$/.test(path)) return null;
  }
  return err("E_FROZEN", path, `show is ${status}; inputs are read-only — revise the show to make changes`);
}

export function isIdentityPath(path: string): boolean {
  return IDENTITY_PATHS.some((p) => startsWith(path, p));
}

/** Route table used by "Go to blocker" (Task handoff tab). */
export const ROUTES: [string, string][] = [
  ["/crew/", "crew"],
  ["/event/", "advance"],
  ["/vendor/", "advance"],
  ["/led/", "led"],
  ["/signal/", "signal"],
  ["/physical/", "signal"],
  ["/servers/", "servers"],
  ["/racks/", "rack"],
  ["/binder/schedule", "advance"],
  ["/binder/", "binder"],
  ["/devices", "signal"],
];
export function routeFor(path: string): string | undefined {
  return ROUTES.find(([p]) => path.startsWith(p) || path + "/" === p)?.[1];
}
