// The store: the only writer of ShowRecords. Modules get a scoped ShowAPI; the shell gets
// the lifecycle operations. Every committed patch re-derives, re-validates and re-evaluates tasks.
import { blankRecord, emptyDerived, normalize } from "./blank";
import { newId, prefixOf, uuid } from "./ids";
import { checkFrozen, checkOwnership, canWriteLane, isIdentityPath } from "./ownership";
import { addAt, deepFreeze, getAt, hashOf, parsePointer, removeAt, replaceAt, startsWith } from "./pointer";
import { entityIndex, refProblems, type RefProblem } from "./refs";
import { schemaErrors } from "./schema";
import type {
  Check, CheckDraft, Derived, EventType, IdPrefix, LibraryLookup, ModuleContract, ModuleId, Patch, Result,
  Revision, ShowRecord, ShowSource, ShowStatus, StoreError, SystemProfile, Task, TaskStatus, WriterId,
} from "./types";
import { SCHEMA_VERSION } from "./types";

export interface Engine {
  modules: ModuleContract[];
  library: LibraryLookup;
  libraryVersion: string;
  profileFor(type: EventType): SystemProfile;
  /** Store-level task evaluation (Task handoff tab). Returns the new tasks array and derived.tasks. */
  deriveTasks(record: ShowRecord, prev: ShowRecord | null, at: string): { tasks: Task[]; derived: Derived["tasks"]; checks: (CheckDraft & { module?: ModuleId | "store" })[] };
  readiness(record: ShowRecord): Derived["readiness"];
  binderSummary(record: ShowRecord): Derived["binder"];
}

export interface Persist {
  loadAll(): Promise<{ shows: ShowRecord[]; revisions: Record<string, Revision[]>; venues: Record<string, VenueMemory> }>;
  saveShow(r: ShowRecord, revisions: Revision[]): Promise<void>;
  deleteShow(showId: string): Promise<void>;
  saveVenue(v: VenueMemory): Promise<void>;
}

export interface VenueMemory {
  venueId: string; venueName: string; city: string; state: string;
  advance: Record<string, { value: unknown; confirmedAt?: string; showCode: string }>;
}

export interface WorkspaceEntry { showId: string; showCode: string; name: string; status: ShowStatus; source: ShowSource; updatedAt: string; revision: number; tourId: string | null; eventDate?: string }

export interface PatchOptions { cascade?: boolean }

export interface ShowAPI {
  readonly by: WriterId;
  record(): ShowRecord;
  get<T = unknown>(pointer: string): T;
  resolve(id: string): unknown;
  patch(ops: Patch[], reason: string, opts?: PatchOptions): Result;
  subscribe(cb: (change: Change) => void): () => void;
  status(): ShowStatus;
  check(c: { code?: string; severity: Check["severity"]; target: string; message: string; title?: string }): string;
  annotate(targetId: string, body: string): string;
  newId(prefix: IdPrefix): string;
  hash(pointer: string): string;
  task(t: Omit<Task, "id" | "history" | "source"> & { source?: Task["source"] }): string;
  setTaskStatus(id: string, status: TaskStatus, note?: string): Result;
  resolveCheck(id: string, resolution: NonNullable<Check["resolution"]>, note: string): Result;
}

export interface Change { showId: string; paths: string[]; rev: number; by: WriterId }

const AUTO_CHECK = /^(SIG|LED|SRV|RCK|BND|PHY)-\d/;
const MODULE_LANE: Record<string, Task["lane"]> = { led: "led", signal: "signal", rack: "rack", servers: "servers", binder: "advance", store: "advance" };

export class StoreFailure extends Error {
  constructor(public errors: StoreError[]) { super(errors.map((e) => `${e.code} ${e.path}: ${e.msg}`).join("; ")); }
}

export class Workspace {
  private shows = new Map<string, ShowRecord>();
  private revs = new Map<string, Revision[]>();
  private venues = new Map<string, VenueMemory>();
  private listeners = new Map<string, Set<(c: Change) => void>>();
  private wsListeners = new Set<() => void>();
  private saveQueue = Promise.resolve();
  devGuard = false;

  constructor(public engine: Engine, private persist: Persist | null = null, private clock: () => string = () => new Date().toISOString()) {}

  async load(): Promise<void> {
    if (!this.persist) return;
    const { shows, revisions, venues } = await this.persist.loadAll();
    for (const s of shows) {
      const r = this.migrate(normalize(s));
      this.recompute(r, null, "store");
      this.shows.set(r.showId, r);
    }
    for (const [id, list] of Object.entries(revisions)) this.revs.set(id, list);
    for (const v of Object.values(venues)) this.venues.set(v.venueId, v);
    this.emitWs();
  }

  // ---------------- workspace index ----------------
  list(): WorkspaceEntry[] {
    return [...this.shows.values()]
      .map((r) => ({ showId: r.showId, showCode: r.showCode, name: r.name, status: r.meta.status, source: r.meta.source, updatedAt: r.meta.updatedAt, revision: r.meta.revision, tourId: r.tourId, eventDate: r.event.dates[0] }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  has(showId: string): boolean { return this.shows.has(showId); }
  get(showId: string): ShowRecord {
    const r = this.shows.get(showId);
    if (!r) throw new Error(`no show ${showId}`);
    return r;
  }
  revisions(showId: string): Revision[] { return this.revs.get(showId) ?? []; }
  venue(venueId: string | null | undefined): VenueMemory | undefined { return venueId ? this.venues.get(venueId) : undefined; }
  venueList(): VenueMemory[] { return [...this.venues.values()]; }
  onWorkspace(cb: () => void): () => void { this.wsListeners.add(cb); return () => this.wsListeners.delete(cb); }
  private emitWs() { this.wsListeners.forEach((cb) => cb()); }

  subscribe(showId: string, cb: (c: Change) => void): () => void {
    let set = this.listeners.get(showId);
    if (!set) this.listeners.set(showId, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  // ---------------- the one write path ----------------
  patch(showId: string, by: WriterId, ops: Patch[], reason: string, opts: PatchOptions = {}): Result {
    const before = this.get(showId);
    const draft = structuredClone(before) as ShowRecord;
    const errors: StoreError[] = [];
    const touched: string[] = [];
    let removed = false;

    for (const op of ops) {
      const own = checkOwnership(by, op, draft);
      if (own) { errors.push(own); break; }
      const frozen = checkFrozen(by, draft.meta.status, op, draft);
      if (frozen) { errors.push(frozen); break; }
      if (draft.meta.status !== "draft" && op.path === "/showCode") { errors.push({ code: "E_FROZEN", path: op.path, msg: "showCode is editable only while draft" }); break; }
      if ((op.op === "replace" || op.op === "remove") && op.ifHash) {
        const cur = hashOf(getAt(draft, entityPointer(op.path)));
        if (cur !== op.ifHash) { errors.push({ code: "E_STALE", path: op.path, msg: "entity changed since read; re-read and retry" }); break; }
      }
      let ok = true;
      if (op.op === "add") ok = addAt(draft, op.path, structuredClone(op.value));
      else if (op.op === "replace") ok = replaceAt(draft, op.path, structuredClone(op.value));
      else if (op.op === "remove") { ok = removeAt(draft, op.path) !== undefined; removed = true; }
      else if (op.op === "move") {
        const v = removeAt(draft, op.from);
        ok = v !== undefined && addAt(draft, op.path, v);
        touched.push(op.from);
      }
      if (!ok) { errors.push({ code: "E_SCHEMA", path: op.path, msg: `path does not resolve for ${op.op}` }); break; }
      touched.push(op.path);
    }

    if (!errors.length) errors.push(...this.portBusy(draft, before));
    if (!errors.length) errors.push(...schemaErrors(draft, touched));
    if (!errors.length) errors.push(...labelDup(draft, touched));
    if (!errors.length) {
      const beforeProblems = new Set(refProblems(before).map(pkey));
      let fresh = refProblems(draft).filter((p) => !beforeProblems.has(pkey(p)));
      const typeErr = fresh.find((p) => p.code === "E_REF_TYPE");
      if (typeErr) errors.push({ code: "E_REF_TYPE", path: typeErr.site.path, msg: `${typeErr.site.value} is not a ${typeErr.site.expect.join("/")}_ reference` });
      else if (fresh.length) {
        if (opts.cascade) {
          const cascadeErr = this.cascade(draft, by, fresh);
          if (cascadeErr) errors.push(cascadeErr);
          fresh = refProblems(draft).filter((p) => !beforeProblems.has(pkey(p)));
          if (!cascadeErr && fresh.length) errors.push({ code: "E_ORPHAN_DELETE", path: fresh[0].site.path, msg: `still referenced at ${fresh[0].site.path}` });
        } else if (removed) {
          const p = fresh[0];
          errors.push({ code: "E_ORPHAN_DELETE", path: p.site.path, msg: `${p.site.value} is still referenced at ${p.site.path}; delete with cascade or remove the reference first` });
        } else {
          const p = fresh[0];
          errors.push({ code: "E_REF_MISSING", path: p.site.path, msg: `${p.site.value} does not exist` });
        }
      }
    }
    if (errors.length) return { ok: false, rev: before.meta.rev, errors };

    this.commit(before, draft, by, reason, touched);
    return { ok: true, rev: draft.meta.rev };
  }

  private portBusy(draft: ShowRecord, before: ShowRecord): StoreError[] {
    // A non-bidir port carries at most one cable (E_PORT_BUSY) — checked only for newly busy ports.
    const count = (r: ShowRecord) => {
      const m = new Map<string, string[]>();
      for (const c of r.cables) for (const p of [c.fromPort, c.toPort]) if (p) m.set(p, [...(m.get(p) ?? []), c.id]);
      return m;
    };
    const was = count(before);
    const portIdx = new Map<string, { dir: string; label: string }>();
    draft.devices.forEach((d) => d.ports.forEach((p) => portIdx.set(p.id, { dir: p.dir, label: `${d.label} ${p.name}` })));
    for (const [port, cabs] of count(draft)) {
      if (cabs.length < 2 || (was.get(port)?.length ?? 0) >= cabs.length) continue;
      if (portIdx.get(port)?.dir === "bidir") continue;
      const held = draft.cables.find((c) => c.id === cabs[0]);
      return [{ code: "E_PORT_BUSY", path: `/cables/${cabs[cabs.length - 1]}`, msg: `${portIdx.get(port)?.label ?? port} already carries ${held?.label || cabs[0]}` }];
    }
    return [];
  }

  /** Cascade rules: null what can be nulled, delete dependent cables/links, mark tasks na. */
  private cascade(draft: ShowRecord, by: WriterId, problems: RefProblem[]): StoreError | null {
    const sliceOf: Record<string, WriterId> = { led: "led", racks: "rack", servers: "servers", signal: "signal" };
    // Devices in another module's dataRun or rack slot are never cascade-deleted from that slice.
    for (const p of problems) {
      const owner = sliceOf[p.site.owner];
      if (owner && owner !== by && (p.site.path.includes("/slots/") || p.site.path.includes("/dataRuns/")))
        return { code: "E_ORPHAN_DELETE", path: p.site.path, msg: `${p.site.value} is placed in the ${owner} module (${p.site.path}); remove it there first` };
    }
    for (let guard = 0; guard < 6; guard++) {
      const probs = refProblems(draft).filter((p) => p.code === "E_REF_MISSING");
      if (!probs.length) break;
      // Deepest paths first so array indices stay valid while removing.
      for (const p of probs.sort((a, b) => b.site.path.localeCompare(a.site.path))) {
        const s = p.site;
        const segs = parsePointer(s.path);
        if (s.nullable) replaceAt(draft, s.path, null);
        else if (s.arrayItem) removeAt(draft, s.path);
        else if (segs[0] === "cables") removeAt(draft, `/cables/${segs[1]}`);
        else if (segs[0] === "signal" && segs[1] === "links") removeAt(draft, `/signal/links/${segs[2]}`);
        else if (segs[0] === "signal" && segs[1] === "nodes") removeAt(draft, `/signal/nodes/${segs[2]}`);
        else if (segs[0] === "signal" && segs[1] === "network") removeAt(draft, `/signal/network/hosts/${segs[3]}`);
        else if (segs[0] === "led" && segs[1] === "canvas") removeAt(draft, `/led/canvas/mappings/${segs[3]}`);
        else if (segs[0] === "led" && segs[3] === "dataRuns") removeAt(draft, `/led/walls/${segs[2]}/dataRuns/${segs[4]}`);
        else if (segs[0] === "racks" && segs[2] === "slots") removeAt(draft, `/racks/${segs[1]}/slots/${segs[3]}`);
        else if (segs[0] === "servers" && segs[1] === "content") removeAt(draft, `/servers/content/contentSpecs/${segs[3]}`);
        else if (segs[0] === "servers" && segs[3] === "outputs") removeAt(draft, `/servers/hosts/${segs[2]}/outputs/${segs[4]}`);
        else if (segs[0] === "servers" && segs[3] === "inputs") removeAt(draft, `/servers/hosts/${segs[2]}/inputs/${segs[4]}`);
        else if (segs[0] === "servers" && segs[1] === "hosts") removeAt(draft, `/servers/hosts/${segs[2]}`);
        draft.meta.changelog.push({ rev: draft.meta.rev + 1, at: this.clock(), by, reason: `cascade: ${s.path} (${s.value})` });
      }
    }
    // Tasks about removed entities go na, never deleted.
    const idx = entityIndex(draft);
    for (const t of draft.tasks) {
      const gone = t.about.filter((a) => prefixOf(a) && !idx.has(a));
      if (gone.length && t.status !== "na" && t.status !== "done") {
        t.history.push({ at: this.clock(), by: "store", from: t.status, to: "na", note: "entity removed" });
        t.status = "na";
      }
    }
    return null;
  }

  private commit(before: ShowRecord, draft: ShowRecord, by: WriterId, reason: string, paths: string[]) {
    const at = this.clock();
    draft.meta.rev = before.meta.rev + 1;
    draft.meta.updatedAt = at;
    draft.meta.updatedBy = by;
    if (reason) draft.meta.changelog.push({ rev: draft.meta.rev, at, by, reason, paths: paths.slice(0, 20) });
    if (draft.meta.changelog.length > 500) draft.meta.changelog = draft.meta.changelog.slice(-500);
    this.recompute(draft, before, by);
    this.set(draft, { showId: draft.showId, paths, rev: draft.meta.rev, by });
  }

  private set(r: ShowRecord, change: Change | null) {
    if (this.devGuard) deepFreeze(r);
    this.shows.set(r.showId, r);
    this.save(r);
    if (change) this.listeners.get(r.showId)?.forEach((cb) => cb(change));
    this.emitWs();
  }

  private save(r: ShowRecord) {
    const p = this.persist;
    if (!p) return;
    const revs = this.revs.get(r.showId) ?? [];
    this.saveQueue = this.saveQueue.then(() => p.saveShow(r, revs)).catch((e) => console.warn("autosave failed", e));
  }
  flush(): Promise<void> { return this.saveQueue; }

  /** derive() for every module, then validate() for all, then tasks — derived and checks are never more than one write behind. */
  recompute(r: ShowRecord, prev: ShowRecord | null, _by: WriterId) {
    const e = this.engine;
    const at = this.clock();
    const derived: Derived = { ...emptyDerived(), tasks: r.derived?.tasks ?? {} };
    for (const m of e.modules) mergeDerived(derived, m.derive(r));
    r.derived = derived;

    const profile = e.profileFor(r.event.type);
    const drafts: (CheckDraft & { module: ModuleId | "store" })[] = [];
    for (const m of e.modules) {
      try { for (const c of m.validate(r, { profile, library: e.library })) drafts.push({ ...c, module: m.id }); }
      catch (err) { console.error(`validate ${m.id} failed`, err); }
    }
    mergeChecks(r, drafts, at, AUTO_CHECK);
    syncCheckTasks(r, at);

    const t = e.deriveTasks(r, prev, at);
    r.tasks = t.tasks;
    r.derived.tasks = t.derived;
    if (t.checks.length) appendEventChecks(r, t.checks.map((c) => ({ ...c, module: c.module ?? "store" })), at);

    r.derived.readiness = e.readiness(r);
    r.derived.binder = e.binderSummary(r);
    r.derived.computedAt = at;
  }

  // ---------------- module-facing API ----------------
  api(showId: string, by: WriterId): ShowAPI {
    const ws = this;
    return {
      by,
      record: () => ws.get(showId),
      get: <T,>(pointer: string) => getAt(ws.get(showId), pointer) as T,
      resolve: (id: string) => { const p = entityIndex(ws.get(showId)).get(id); return p ? getAt(ws.get(showId), p) : undefined; },
      patch: (ops, reason, opts) => ws.patch(showId, by, ops, reason, opts),
      subscribe: (cb) => ws.subscribe(showId, cb),
      status: () => ws.get(showId).meta.status,
      newId,
      hash: (pointer) => hashOf(getAt(ws.get(showId), pointer)),
      check: (c) => {
        const id = newId("chk");
        const at = ws.clock();
        const chk: Check = { id, code: c.code ?? "NOTE", module: (["led", "signal", "rack", "servers", "binder"].includes(by) ? by : "store") as Check["module"], severity: c.severity,
          title: c.title ?? "Request", target: c.target, involved: [c.target], message: c.message, rule: "", evidence: [], fixes: [],
          resolved: false, firstSeen: at, lastSeen: at, rev: ws.get(showId).meta.rev };
        const r = ws.patch(showId, by, [{ op: "add", path: "/binder/checks/-", value: chk }], `check: ${c.message}`);
        if (!r.ok) throw new StoreFailure(r.errors!);
        return id;
      },
      annotate: (targetId, body) => {
        const id = newId("ann");
        const r = ws.patch(showId, by, [{ op: "add", path: "/binder/annotations/-", value: { id, target: targetId, author: by, body, at: ws.clock() } }], `annotate ${targetId}`);
        if (!r.ok) throw new StoreFailure(r.errors!);
        return id;
      },
      task: (t) => {
        if (!canWriteLane(by, t.lane)) throw new StoreFailure([{ code: "E_LANE_OWNER", path: "/tasks", msg: `${by} may not write lane ${t.lane}` }]);
        const id = newId("task");
        const task: Task = { ...t, id, source: t.source ?? "user", history: [{ at: ws.clock(), by, from: "todo", to: t.status }] };
        const r = ws.patch(showId, by, [{ op: "add", path: "/tasks/-", value: task }], `task: ${t.title}`);
        if (!r.ok) throw new StoreFailure(r.errors!);
        return id;
      },
      setTaskStatus: (id, status, note) => {
        const t = ws.get(showId).tasks.find((x) => x.id === id);
        if (!t) return { ok: false, rev: ws.get(showId).meta.rev, errors: [{ code: "E_SCHEMA", path: `/tasks/${id}`, msg: "no such task" }] };
        const next: Task = { ...t, status, userDone: status === "done", history: [...t.history, { at: ws.clock(), by, from: t.status, to: status, note }] };
        return ws.patch(showId, by, [{ op: "replace", path: `/tasks/${id}`, value: next }], `task ${t.title}: ${t.status} → ${status}`);
      },
      resolveCheck: (id, resolution, note) => {
        const r0 = ws.get(showId);
        const c = r0.binder.checks.find((x) => x.id === id);
        if (!c) return { ok: false, rev: r0.meta.rev, errors: [{ code: "E_SCHEMA", path: `/binder/checks/${id}`, msg: "no such check" }] };
        if (c.severity === "block" && resolution === "accepted-risk")
          return { ok: false, rev: r0.meta.rev, errors: [{ code: "E_SCHEMA", path: `/binder/checks/${id}`, msg: "a block check can only be fixed or marked not-applicable" }] };
        if ((resolution !== "fixed") && !note.trim())
          return { ok: false, rev: r0.meta.rev, errors: [{ code: "E_SCHEMA", path: `/binder/checks/${id}`, msg: "an annotation is required" }] };
        const at = ws.clock();
        const ops: Patch[] = [{ op: "replace", path: `/binder/checks/${id}`, value: { ...c, resolved: true, resolution, resolvedBy: by, resolvedAt: at } }];
        ops.push({ op: "add", path: "/binder/annotations/-", value: { id: newId("ann"), target: c.target, author: by, body: `${c.code} ${resolution}: ${note}`, at } });
        return ws.patch(showId, by === "mobile" ? "mobile" : "binder", ops, `resolve ${c.code} (${resolution})`);
      },
    };
  }

  // ---------------- shell-only lifecycle ----------------
  createShow(opts: { source?: ShowSource; showCode?: string; artist?: string; year?: number; tourId?: string | null } = {}): ShowRecord {
    const now = this.clock();
    const showId = uuid();
    const code = opts.showCode ?? this.mintShowCode(opts.artist ?? "SHOW", opts.year ?? new Date(now).getFullYear());
    const r = blankRecord(showId, code, opts.source ?? "blank", now);
    r.tourId = opts.tourId ?? null;
    r.meta.libraryVersion = this.engine.libraryVersion;
    r.meta.changelog.push({ rev: 0, at: now, by: "shell", reason: `createShow(${r.meta.source})` });
    this.recompute(r, null, "store");
    this.set(r, null);
    return r;
  }

  mintShowCode(artist: string, year: number): string {
    const initials = artist.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "SHOW";
    const prefix = `${initials}-${year}-`;
    const used = new Set([...this.shows.values()].map((s) => s.showCode));
    for (let n = 1; n < 1000; n++) { const c = prefix + String(n).padStart(3, "0"); if (!used.has(c)) return c; }
    return prefix + Date.now();
  }

  /** Adds a fully formed record (example fixture, import). */
  importRecord(json: unknown, opts: { keepId?: boolean } = {}): ShowRecord {
    const raw = typeof json === "string" ? JSON.parse(json) : json;
    const body = raw && typeof raw === "object" && "record" in raw ? (raw as { record: ShowRecord; revisions?: Revision[] }) : { record: raw as ShowRecord, revisions: [] as Revision[] };
    let r = this.migrate(normalize(structuredClone(body.record)));
    if (!opts.keepId && this.shows.has(r.showId)) r = { ...r, showId: uuid() };
    if ([...this.shows.values()].some((s) => s.showCode === r.showCode && s.showId !== r.showId)) r.showCode = this.mintShowCode(r.client.artist || r.showCode, new Date().getFullYear());
    this.recompute(r, null, "store");
    if (body.revisions?.length) this.revs.set(r.showId, body.revisions);
    this.set(r, null);
    return r;
  }

  exportRecord(showId: string): { filename: string; json: string } {
    const r = this.get(showId);
    const name = `${r.showCode}_r${r.meta.revision}${r.meta.status === "draft" ? "-draft" : ""}.oncue.json`;
    return { filename: name, json: JSON.stringify({ schemaVersion: SCHEMA_VERSION, record: r, revisions: this.revisions(showId) }, null, 2) };
  }

  /** Copy keeps devices, cables, walls, racks and servers; clears event, crew, schedule, annotations, resolved checks and barcodes; mints new ids throughout. */
  copyShow(showId: string): ShowRecord {
    const src = this.get(showId);
    const now = this.clock();
    let json = JSON.stringify(src);
    // Re-mint every prefixed id so two shows never share an entity id.
    const ids = new Set<string>();
    json.replace(/"((?:dev|p|cab|wall|ckt|sig|lnk|rg|rack|srv|sec|ann|chk|task|pos|path|seg|jack|sch|con|svc|cam)_[A-Za-z0-9_]+)"/g, (_m, id) => { ids.add(id); return _m; });
    const map = new Map<string, string>();
    for (const id of ids) map.set(id, newId(id.slice(0, id.indexOf("_")) as IdPrefix));
    json = json.replace(/"((?:dev|p|cab|wall|ckt|sig|lnk|rg|rack|srv|sec|ann|chk|task|pos|path|seg|jack|sch|con|svc|cam)_[A-Za-z0-9_]+)"/g, (m, id) => (map.has(id) ? `"${map.get(id)}"` : m));
    const r = normalize(JSON.parse(json));
    const fresh = blankRecord(uuid(), this.mintShowCode(src.client.artist || "SHOW", new Date(now).getFullYear()), "copy", now);
    r.showId = fresh.showId;
    r.showCode = fresh.showCode;
    r.name = `${src.name} (copy)`;
    r.event = { ...fresh.event, type: src.event.type };
    r.crew = fresh.crew;
    r.meta = { ...fresh.meta, libraryVersion: src.meta.libraryVersion };
    r.binder = { ...r.binder, schedule: [], annotations: [], checks: r.binder.checks.filter((c) => !c.resolved) };
    r.devices.forEach((d) => { d.inventoryRef = { ...d.inventoryRef, barcode: "" }; delete d.ext; });
    r.tasks = r.tasks.map((t) => ({ ...t, history: [], userDone: false, status: "todo" }));
    r.meta.changelog.push({ rev: 0, at: now, by: "shell", reason: `copyShow(${src.showCode})` });
    this.recompute(r, null, "store");
    this.set(r, null);
    return r;
  }

  deleteShow(showId: string) {
    this.shows.delete(showId);
    this.revs.delete(showId);
    this.persist?.deleteShow(showId);
    this.emitWs();
  }

  issueShow(showId: string): Result {
    const r = this.get(showId);
    const errs: StoreError[] = [];
    if (r.meta.status !== "draft") errs.push({ code: "E_FROZEN", path: "/meta/status", msg: `show is ${r.meta.status}` });
    if (r.meta.source === "example" || r.meta.source === "template") errs.push({ code: "E_SOURCE", path: "/meta/source", msg: "example and template shows can never be issued — copy to a new show first" });
    const blocks = r.binder.checks.filter((c) => c.severity === "block" && !c.resolved);
    if (blocks.length) errs.push({ code: "E_BLOCKED", path: "/binder/checks", msg: `${blocks.length} unresolved block check(s): ${blocks.slice(0, 3).map((b) => b.title).join(", ")}` });
    if (errs.length) return { ok: false, rev: r.meta.rev, errors: errs };
    const at = this.clock();
    const next = structuredClone(r) as ShowRecord;
    next.meta.status = "issued";
    next.meta.changelog.push({ rev: next.meta.rev + 1, at, by: "shell", reason: `issueShow → REV ${next.meta.revision}` });
    // Record wins over status: user-done tasks whose condition fails reopen at issue.
    next.meta.rev += 1;
    next.meta.updatedAt = at;
    this.recompute(next, r, "shell");
    const openTasks = next.tasks.filter((t) => t.status !== "done" && t.status !== "na");
    const list = [...this.revisions(showId), { rev: next.meta.revision, issuedAt: at, record: structuredClone(next), openTasks: structuredClone(openTasks) }];
    this.revs.set(showId, list);
    this.rememberVenue(next);
    this.set(next, { showId, paths: ["/meta/status"], rev: next.meta.rev, by: "shell" });
    return { ok: true, rev: next.meta.rev };
  }

  reviseShow(showId: string, reason: string): Result {
    const r = this.get(showId);
    if (r.meta.status !== "issued" && r.meta.status !== "locked") return { ok: false, rev: r.meta.rev, errors: [{ code: "E_FROZEN", path: "/meta/status", msg: "only an issued show can be revised" }] };
    const snap = this.revisions(showId).at(-1)?.record ?? r;
    const at = this.clock();
    const next = structuredClone(snap) as ShowRecord;
    // Annotations and unresolved checks carry forward from the live record; resolved checks drop.
    next.binder.annotations = structuredClone(r.binder.annotations);
    next.binder.checks = structuredClone(r.binder.checks.filter((c) => !c.resolved));
    next.meta.status = "draft";
    next.meta.revision = snap.meta.revision + 1;
    next.meta.changelog = [...r.meta.changelog, { rev: next.meta.revision, from: snap.meta.revision, at, by: "shell", reason: reason || "revise" }];
    next.meta.rev = r.meta.rev + 1;
    next.meta.updatedAt = at;
    this.recompute(next, r, "shell");
    this.set(next, { showId, paths: ["/meta/status"], rev: next.meta.rev, by: "shell" });
    return { ok: true, rev: next.meta.rev };
  }

  private setStatus(showId: string, from: ShowStatus[], to: ShowStatus, reason: string): Result {
    const r = this.get(showId);
    if (!from.includes(r.meta.status)) return { ok: false, rev: r.meta.rev, errors: [{ code: "E_FROZEN", path: "/meta/status", msg: `cannot go from ${r.meta.status} to ${to}` }] };
    const next = structuredClone(r) as ShowRecord;
    const at = this.clock();
    next.meta.status = to;
    next.meta.rev += 1;
    next.meta.updatedAt = at;
    next.meta.changelog.push({ rev: next.meta.rev, at, by: "shell", reason });
    this.recompute(next, r, "shell");
    this.set(next, { showId, paths: ["/meta/status"], rev: next.meta.rev, by: "shell" });
    return { ok: true, rev: next.meta.rev };
  }
  lockShow(showId: string): Result { return this.setStatus(showId, ["issued"], "locked", "lockShow (load-in)"); }
  unlockShow(showId: string, reason: string): Result {
    if (!reason.trim()) return { ok: false, rev: this.get(showId).meta.rev, errors: [{ code: "E_SCHEMA", path: "/meta/status", msg: "unlock requires a reason" }] };
    return this.setStatus(showId, ["locked"], "issued", `unlockShow: ${reason}`);
  }
  archiveShow(showId: string): Result { return this.setStatus(showId, ["issued", "locked", "draft"], "archived", "archiveShow"); }

  // ---------------- venue memory ----------------
  private rememberVenue(r: ShowRecord) {
    const venueId = r.event.venueId || (r.event.venueName ? slug(`${r.event.venueName}-${r.event.city}`) : null);
    if (!venueId) return;
    const mem: VenueMemory = this.venues.get(venueId) ?? { venueId, venueName: r.event.venueName, city: r.event.city, state: r.event.state, advance: {} };
    const EXCLUDE = ["/event/access/credentials", "/event/access/docks"];
    walkConfirmed(r.event, "/event", (path, leaf) => {
      if (leaf.state !== "confirmed" || EXCLUDE.includes(path)) return;
      mem.advance[path] = { value: leaf.value, confirmedAt: leaf.at, showCode: r.showCode };
    });
    this.venues.set(venueId, mem);
    this.persist?.saveVenue(mem);
  }

  // ---------------- migration ----------------
  migrate(r: ShowRecord): ShowRecord {
    const from = r.meta.schemaVersion;
    if (from === SCHEMA_VERSION) return r;
    let out = r;
    for (const m of this.engine.modules) if (m.migrate) out = m.migrate(out, from);
    out.meta.schemaVersion = SCHEMA_VERSION;
    return out;
  }
}

// ---------------- helpers ----------------
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pkey(p: RefProblem) { return `${p.code}|${p.site.path}|${p.site.value}`; }

/** For ifHash: the entity a pointer lands in (e.g. /devices/dev_x/label → /devices/dev_x). */
function entityPointer(path: string): string {
  const segs = parsePointer(path);
  const collections = new Set(["devices", "cables", "walls", "racks", "hosts", "links", "nodes", "tasks", "checks", "schedule", "contacts", "positions", "paths"]);
  let last = -1;
  segs.forEach((s, i) => { if (collections.has(segs[i - 1]) && s) last = i; });
  return last < 0 ? path : "/" + segs.slice(0, last + 1).join("/");
}

function mergeDerived(target: Derived, part: Partial<Derived>) {
  for (const [k, v] of Object.entries(part)) {
    const key = k as keyof Derived;
    const cur = target[key] as unknown;
    if (cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v)) {
      (target as unknown as Record<string, unknown>)[key] = { ...(cur as object), ...(v as object) };
    } else (target as unknown as Record<string, unknown>)[key] = v;
  }
}

/** Check instances are keyed by code + target: re-running replaces rather than duplicates; a resolved instance whose condition recurs reopens with history intact. */
function mergeChecks(r: ShowRecord, drafts: (CheckDraft & { module: ModuleId | "store" })[], at: string, auto: RegExp) {
  const key = (c: { code: string; target: string }) => `${c.code}|${c.target}`;
  const existing = new Map(r.binder.checks.map((c) => [key(c), c]));
  const seen = new Set<string>();
  const out: Check[] = [];
  for (const d of drafts) {
    const k = key(d);
    if (seen.has(k)) continue;
    seen.add(k);
    const prev = existing.get(k);
    const base = { involved: [d.target], evidence: [], fixes: [], rule: "" };
    if (prev) {
      const autoFixed = prev.resolved && prev.resolution === "fixed" && prev.resolvedBy === "store";
      out.push({ ...prev, ...base, ...d, id: prev.id, firstSeen: prev.firstSeen, lastSeen: at, rev: r.meta.rev,
        resolved: autoFixed ? false : prev.resolved, resolution: autoFixed ? undefined : prev.resolution,
        resolvedBy: autoFixed ? undefined : prev.resolvedBy, resolvedAt: autoFixed ? undefined : prev.resolvedAt });
    } else {
      out.push({ ...base, ...d, id: newId("chk"), resolved: false, firstSeen: at, lastSeen: at, rev: r.meta.rev });
    }
  }
  for (const c of r.binder.checks) {
    if (seen.has(key(c))) continue;
    if (auto.test(c.code)) {
      if (c.resolved) { if (c.resolvedBy !== "store") out.push(c); continue; } // condition gone and already resolved by a person
      out.push({ ...c, resolved: true, resolution: "fixed", resolvedBy: "store", resolvedAt: at });
    } else out.push(c);
  }
  // Drop store-fixed checks after they've been seen fixed for a while, to keep the list readable.
  r.binder.checks = out.filter((c) => !(c.resolvedBy === "store" && c.resolved && c.resolvedAt && c.resolvedAt < at && out.length > 200));
}

function appendEventChecks(r: ShowRecord, drafts: (CheckDraft & { module: ModuleId | "store" })[], at: string) {
  for (const d of drafts) {
    const open = r.binder.checks.find((c) => c.code === d.code && c.target === d.target && !c.resolved);
    if (open) { open.lastSeen = at; open.message = d.message; continue; }
    r.binder.checks.push({ involved: [d.target], evidence: [], fixes: [], rule: "", ...d, id: newId("chk"), resolved: false, firstSeen: at, lastSeen: at, rev: r.meta.rev });
  }
}

/** One task per open block/warn check in the owning lane; resolving the check closes the task, closing the task never resolves the check. */
function syncCheckTasks(r: ShowRecord, at: string) {
  const byCheck = new Map(r.tasks.filter((t) => t.source === "check" && t.checkId).map((t) => [t.checkId!, t]));
  for (const c of r.binder.checks) {
    if (c.severity === "info") continue;
    const t = byCheck.get(c.id);
    if (!c.resolved && !t) {
      r.tasks.push({ id: newId("task"), lane: MODULE_LANE[c.module] ?? "advance", title: `${c.code} · ${c.title}`, detail: c.message, status: "todo",
        about: [c.target], blockedBy: [], source: "check", checkId: c.id, history: [{ at, by: "store", from: "todo", to: "todo", note: "opened from check" }] });
    } else if (t && c.resolved && t.status !== "done" && t.status !== "na") {
      const note = c.resolution === "accepted-risk" ? "check accepted-risk" : `check ${c.resolution ?? "resolved"}`;
      t.history.push({ at, by: "store", from: t.status, to: "done", note });
      t.status = "done";
    } else if (t && !c.resolved && t.status === "done" && !t.userDone) {
      t.history.push({ at, by: "store", from: "done", to: "todo", note: "check reopened" });
      t.status = "todo";
    }
  }
  // Tasks for checks that no longer exist close.
  const ids = new Set(r.binder.checks.map((c) => c.id));
  for (const t of r.tasks) if (t.source === "check" && t.checkId && !ids.has(t.checkId) && t.status !== "done" && t.status !== "na") {
    t.history.push({ at, by: "store", from: t.status, to: "done", note: "check cleared" });
    t.status = "done";
  }
}

function labelDup(r: ShowRecord, touched: string[]): StoreError[] {
  const cols: [string, { id: string; label?: string; name?: string }[], "label" | "name"][] = [
    ["/devices", r.devices, "label"], ["/cables", r.cables, "label"], ["/led/walls", r.led.walls, "name"], ["/racks", r.racks, "name"],
  ];
  for (const [path, list, field] of cols) {
    if (!touched.some((t) => startsWith(t, path) || startsWith(path, t))) continue;
    const seen = new Map<string, string>();
    for (const e of list) {
      const l = (e[field] ?? "").trim();
      if (!l) continue;
      if (seen.has(l.toLowerCase())) return [{ code: "E_LABEL_DUP", path: `${path}/${e.id}/${field}`, msg: `label "${l}" is already used in ${path}` }];
      seen.set(l.toLowerCase(), e.id);
    }
  }
  return [];
}

export function walkConfirmed(obj: unknown, base: string, cb: (path: string, leaf: { value: unknown; state: string; at?: string }) => void) {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v && typeof v === "object" && "state" in (v as object) && "value" in (v as object)) cb(`${base}/${k}`, v as { value: unknown; state: string; at?: string });
    else if (v && typeof v === "object" && !Array.isArray(v)) walkConfirmed(v, `${base}/${k}`, cb);
  }
}

export { isIdentityPath };
