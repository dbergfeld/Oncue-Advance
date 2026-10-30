// JSON-pointer helpers. Array segments may be a numeric index, "-" (append),
// or an entity id — `/devices/dev_proc1/label` addresses the device whose id is dev_proc1.

export function parsePointer(p: string): string[] {
  if (p === "" || p === "/") return [];
  if (!p.startsWith("/")) throw new Error(`bad pointer ${p}`);
  return p.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function arrayIndex(arr: unknown[], seg: string): number {
  if (/^\d+$/.test(seg)) return Number(seg);
  return arr.findIndex((x) => x !== null && typeof x === "object" && (x as { id?: unknown }).id === seg);
}

export function getAt(root: unknown, pointer: string): unknown {
  let cur: unknown = root;
  for (const seg of parsePointer(pointer)) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = arrayIndex(cur, seg);
      cur = i < 0 ? undefined : cur[i];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else return undefined;
  }
  return cur;
}

/** Walks to the parent of the pointer target. Returns undefined if the parent does not exist. */
function parentOf(root: unknown, segs: string[]): { parent: unknown; key: string } | undefined {
  let cur: unknown = root;
  for (const seg of segs.slice(0, -1)) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      const i = arrayIndex(cur, seg);
      if (i < 0) return undefined;
      cur = cur[i];
    } else cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur == null || typeof cur !== "object") return undefined;
  return { parent: cur, key: segs[segs.length - 1] };
}

export function addAt(root: unknown, pointer: string, value: unknown): boolean {
  const segs = parsePointer(pointer);
  const pk = parentOf(root, segs);
  if (!pk) return false;
  const { parent, key } = pk;
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else {
      const i = /^\d+$/.test(key) ? Number(key) : arrayIndex(parent, key);
      if (i < 0 || i > parent.length) return false;
      parent.splice(i, 0, value);
    }
  } else (parent as Record<string, unknown>)[key] = value;
  return true;
}

export function replaceAt(root: unknown, pointer: string, value: unknown): boolean {
  const segs = parsePointer(pointer);
  const pk = parentOf(root, segs);
  if (!pk) return false;
  const { parent, key } = pk;
  if (Array.isArray(parent)) {
    const i = arrayIndex(parent, key);
    if (i < 0 || i >= parent.length) return false;
    parent[i] = value;
  } else (parent as Record<string, unknown>)[key] = value;
  return true;
}

export function removeAt(root: unknown, pointer: string): unknown {
  const segs = parsePointer(pointer);
  const pk = parentOf(root, segs);
  if (!pk) return undefined;
  const { parent, key } = pk;
  if (Array.isArray(parent)) {
    const i = arrayIndex(parent, key);
    if (i < 0) return undefined;
    return parent.splice(i, 1)[0];
  }
  const obj = parent as Record<string, unknown>;
  if (!(key in obj)) return undefined;
  const v = obj[key];
  delete obj[key];
  return v;
}

/** Normalises id segments to indices so ownership checks can reason about collections. */
export function startsWith(pointer: string, prefix: string): boolean {
  return pointer === prefix || pointer.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

export function hashOf(v: unknown): string {
  const s = JSON.stringify(v) ?? "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
