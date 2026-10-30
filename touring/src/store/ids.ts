import type { IdPrefix } from "./types";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** `<prefix>_<nanoid12>` — readable in logs, prefix-checked on every reference. */
export function newId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function prefixOf(id: string | null | undefined): string | null {
  if (!id || typeof id !== "string") return null;
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : null;
}
