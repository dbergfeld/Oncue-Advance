import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ShowAPI, Workspace } from "../store/store";
import type { Patch, Result, ShowRecord, WriterId } from "../store/types";

export type View = "shows" | "overview" | "advance" | "crew" | "led" | "pixelpatch" | "signal" | "rack" | "servers" | "binder" | "showbook" | "tasks" | "library" | "changelog";
export const VIEWS: { id: View; label: string; needsShow: boolean }[] = [
  { id: "shows", label: "Shows", needsShow: false },
  { id: "overview", label: "Overview", needsShow: true },
  { id: "advance", label: "Advance", needsShow: true },
  { id: "crew", label: "Crew & schedule", needsShow: true },
  { id: "led", label: "LED Map & Power", needsShow: true },
  { id: "pixelpatch", label: "Pixel & Patch", needsShow: true },
  { id: "signal", label: "Signal Flow", needsShow: true },
  { id: "rack", label: "Rack Build", needsShow: true },
  { id: "servers", label: "Media Servers", needsShow: true },
  { id: "binder", label: "Show Binder", needsShow: true },
  { id: "showbook", label: "Show Book", needsShow: true },
  { id: "tasks", label: "Tasks", needsShow: true },
  { id: "library", label: "Device library", needsShow: false },
  { id: "changelog", label: "Changelog", needsShow: true },
];

export interface Toast { id: number; kind: "ok" | "error"; text: string }

interface Ctx {
  ws: Workspace;
  showId: string | null;
  setShowId(id: string | null): void;
  view: View;
  go(v: View, focus?: string): void;
  focus: string | null;
  toasts: Toast[];
  toast(kind: Toast["kind"], text: string): void;
  ephemeral: boolean;
  wizard: { open: boolean; step: number; showId: string | null };
  openWizard(step?: number, showId?: string | null): void;
  closeWizard(): void;
}

const AppCtx = createContext<Ctx | null>(null);

function readHash(): View {
  try {
    const h = location.hash.replace(/^#/, "");
    return (VIEWS.find((v) => v.id === h)?.id ?? "shows") as View;
  } catch { return "shows"; }
}

function remembered(): string | null {
  try { return localStorage.getItem("oncue.lastShow"); } catch { return null; }
}

export function AppProvider({ ws, ephemeral, children }: { ws: Workspace; ephemeral: boolean; children: ReactNode }) {
  const [showId, setShowIdRaw] = useState<string | null>(() => { const s = remembered(); return s && ws.has(s) ? s : ws.list()[0]?.showId ?? null; });
  const [view, setView] = useState<View>(() => readHash());
  const [focus, setFocus] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wizard, setWizard] = useState({ open: false, step: 1, showId: null as string | null });

  useEffect(() => {
    const on = () => setView(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const setShowId = useCallback((id: string | null) => {
    setShowIdRaw(id);
    try { if (id) localStorage.setItem("oncue.lastShow", id); } catch { /* storage unavailable */ }
  }, []);
  const go = useCallback((v: View, f?: string) => {
    setView(v);
    setFocus(f ?? null);
    try { if (location.hash !== "#" + v) location.hash = v; } catch { /* hash routing unavailable */ }
  }, []);
  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3000);
  }, []);
  const value = useMemo<Ctx>(() => ({
    ws, showId: showId && ws.has(showId) ? showId : null, setShowId, view, go, focus, toasts, toast, ephemeral, wizard,
    openWizard: (step = 1, sid = null) => setWizard({ open: true, step, showId: sid }),
    closeWizard: () => setWizard((w) => ({ ...w, open: false })),
  }), [ws, showId, setShowId, view, go, focus, toasts, toast, ephemeral, wizard]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("no app context");
  return c;
}

/** Re-renders on every committed patch to any show. */
export function useWorkspaceVersion(): number {
  const { ws } = useApp();
  const sub = useCallback((cb: () => void) => ws.onWorkspace(cb), [ws]);
  const ver = useMemo(() => ({ n: 0 }), []);
  return useSyncExternalStore(sub, () => {
    // ws.list() identity changes per call; key on a cheap signature instead.
    const sig = ws.list().map((e) => e.updatedAt + e.status).join("|");
    if (sig !== (ver as { sig?: string }).sig) { (ver as { sig?: string }).sig = sig; ver.n++; }
    return ver.n;
  });
}

export function useRecord(): ShowRecord | null {
  const { ws, showId } = useApp();
  useWorkspaceVersion();
  return showId && ws.has(showId) ? ws.get(showId) : null;
}

/** Writer-scoped patch with a toast on refusal. Returns true when committed. */
export function useWriter(by: WriterId) {
  const { ws, showId, toast } = useApp();
  return useCallback((ops: Patch[] | ((r: ShowRecord) => Patch[]), reason: string, opts?: { cascade?: boolean; quiet?: boolean }): boolean => {
    if (!showId) return false;
    const list = typeof ops === "function" ? ops(ws.get(showId)) : ops;
    if (!list.length) { if (!opts?.quiet) toast("ok", "Nothing to change"); return true; }
    const res: Result = ws.patch(showId, by, list, reason, opts);
    if (!res.ok) { toast("error", explain(res)); return false; }
    if (!opts?.quiet) toast("ok", reason.replace(/^\w+:/, "").trim() || "Saved");
    return true;
  }, [ws, showId, toast, by]);
}

export function useApi(by: WriterId): ShowAPI | null {
  const { ws, showId } = useApp();
  return useMemo(() => (showId ? ws.api(showId, by) : null), [ws, showId, by]);
}

export function explain(res: Result): string {
  const e = res.errors?.[0];
  if (!e) return "Change refused";
  const nice: Record<string, string> = {
    E_FROZEN: "The show is not a draft", E_NOT_OWNER: "Another module owns this", E_CLASS_OWNER: "Another module owns this device class",
    E_LANE_OWNER: "Another lane owns this task", E_STALE: "Changed elsewhere; reload and retry", E_REF_MISSING: "Points at something that no longer exists",
    E_REF_TYPE: "Wrong kind of reference", E_LABEL_DUP: "That label is already used", E_ORPHAN_DELETE: "Still in use elsewhere",
    E_SCHEMA: "Value not accepted", E_PORT_BUSY: "Port already has a cable", E_BLOCKED: "Blocking checks are open", E_SOURCE: "Examples cannot be issued",
  };
  return `${nice[e.code] ?? e.code}: ${e.msg}`;
}

/** Inputs are editable only on a draft that is not an example or template. */
export function isFrozen(r: ShowRecord): boolean {
  return r.meta.status !== "draft" || r.meta.source === "example" || r.meta.source === "template";
}
