# On Cue: Touring — Shared Show Record & Module Contracts
2026-10-30 · @David Bergfeld
## Purpose and scope
One `ShowRecord` is the single source of truth for a show; the five modules (LED Map & Power, Show Signal Flow, Rack Build, Media Servers, Show Binder) each own one slice of it and read the rest. No module keeps private show state, and no two modules may write the same field.
This spec defines three things: the show identity every module keys on, the full record shape, and the contract each module signs to read and write it. It applies to the desktop app and Pixel & Patch Mobile v.1 alike; mobile is a read-mostly client of the same record.
Rules that hold everywhere:
- One record per show. A tour is a folder of shows that share a `tourId`; it is not a record.
- Every entity has a stable `id`. Display names ("Wall A", "Cam 3") are labels and may change; ids never do.
- Modules write only through the store (`patch`), never by mutating the object they were handed.
- Derived values (power totals, pixel counts, weight rollups, port counts) are computed, never stored as inputs. The store caches them under `derived` and recomputes on write.
- A draft is editable; an issued revision is frozen. Modules read `meta.status` before offering a write.
## Show identity
A show is identified by `showId` (immutable UUID) and addressed by humans through `showCode`, a short slug of the form `ARTIST-YYYY-SEQ` (e.g. `LW-2026-014`). Every module header, export filename, and mobile deep link carries both.
| Field | Type | Owner | Rule |
| `showId` | UUID | Store | Set at create; never changes, even across copy-to-new-show (copy gets a new id) |
| `showCode` | string | Shell | Unique within the workspace; editable only while `status = draft` |
| `tourId` | UUID or null | Shell | Groups shows that share a package; null for one-offs |
| `name` | string | Shell | Display name ("Lainey Wilson · Bridgestone Arena") |
| `client` | object | Shell | `{ artist, management, productionCo }` |
| `event` | object | Shell | `{ type, dates[], venueId, venueName, city, state, room }` — `type` ∈ arena, amphitheater, festival, fly-date, rehearsal, corporate, broadcast |
| `vendor` | object | Shell | `{ company, orderRef, orderSystem }` — e.g. `{ "Fuse Operations", "372042", "RentalWorks" }` |
| `crew` | object | Shell | `{ videoDirector, crewChief, eic, ledLead, cameraLead, serverOp }` — names or crew ids |
| `meta.status` | enum | Store | `draft` → `issued` → `locked` → `archived` (see Lifecycle) |
| `meta.revision` | integer | Store | Increments on every `issue`; drafts carry the next number with a `-draft` suffix in exports |
| `meta.schemaVersion` | string | Store | Semver of this spec; migrations key on it |
| `meta.createdAt` / `updatedAt` | ISO 8601 | Store | Set by the store, never by a module |
| `meta.source` | enum | Store | `blank`, `template`, `example`, `copy` — example projects are flagged so they are never mistaken for a real advance |
| `meta.updatedBy` | string | Store | Module id of the last writer (`led`, `signal`, `rack`, `servers`, `binder`, `shell`) |

Lifecycle states:
- **draft** — fully editable by every module. Exports are watermarked DRAFT and carry `revision + "-draft"`.
- **issued** — a revision has been published to crew. Inputs are read-only; a module may still write `annotations` and `checks`. Any input change requires `reviseShow()`, which clones the record back to `draft` with `revision + 1` and a changelog entry.
- **locked** — show has loaded in. Only the Show Binder may write (notes, as-built deltas, strike punch list). Unlock requires explicit shell action and is logged.
- **archived** — read-only everywhere; eligible as a template source.
## Shared Show Record schema
The record is one JSON document with an identity block, five module-owned slices, two shared collections (`devices`, `cables`) that every module references by id, and a store-owned `derived` cache. Fields marked `→ id` hold a reference into another slice, never a copy.
```json
{
  "showId": "uuid",
  "showCode": "LW-2026-014",
  "tourId": "uuid | null",
  "name": "string",
  "client": { "artist": "", "management": "", "productionCo": "" },
  "event": { "type": "arena", "dates": ["2026-11-14"], "venueId": "", "venueName": "", "city": "", "state": "", "room": "" },
  "vendor": { "company": "Fuse Operations", "orderRef": "", "orderSystem": "RentalWorks" },
  "crew": { "videoDirector": "", "crewChief": "", "eic": "", "ledLead": "", "cameraLead": "", "serverOp": "" },
  "meta": { "status": "draft", "revision": 1, "schemaVersion": "1.0.0", "source": "blank",
            "createdAt": "", "updatedAt": "", "updatedBy": "shell", "changelog": [] },

  "devices": [ { "id": "dev_...", "class": "processor", "make": "Brompton", "model": "SX40",
                 "label": "PROC-1", "qty": 1, "rackId": "→ racks[].id | null", "ru": 2,
                 "powerW": 450, "weightLb": 22, "ports": [ { "id": "p_...", "name": "SDI OUT 1", "type": "12G-SDI", "dir": "out" } ],
                 "inventoryRef": { "system": "RentalWorks", "iCode": "", "barcode": "" } } ],
  "cables": [ { "id": "cab_...", "type": "SMPTE-311", "length_ft": 150, "fromPort": "→ ports.id", "toPort": "→ ports.id", "label": "", "redundancyGroup": "A|B|null" } ],

  "led": {
    "walls": [ { "id": "wall_...", "name": "Upstage Wall", "tileModel": "ROE CB5", "cols": 25, "rows": 7,
                 "tileW_mm": 500, "tileH_mm": 500, "pitch_mm": 5.77, "trimHeight_ft": 38,
                 "rigging": { "type": "flown|ground|hybrid", "headers": 5, "points": [] },
                 "processorIds": ["→ devices.id"], "dataRuns": [ { "portId": "→ ports.id", "tileChain": [[col,row]], "redundant": true } ],
                 "power": { "phase": "3Ø", "circuits": [ { "id": "ckt_...", "amps": 20, "tiles": [[col,row]] } ], "distroId": "→ devices.id" } } ],
    "canvas": { "w_px": 0, "h_px": 0, "mappings": [ { "wallId": "→", "x": 0, "y": 0 } ] }
  },

  "signal": {
    "nodes": [ { "id": "sig_...", "deviceId": "→ devices.id", "role": "source|switcher|router|processor|record|monitor|sink", "x": 0, "y": 0 } ],
    "links": [ { "id": "lnk_...", "cableId": "→ cables.id", "format": "1080p59.94", "path": "A|B", "label": "PGM" } ],
    "formats": { "house": "1080p59.94", "ledInput": "3840x2160p59.94", "record": "1080p59.94" },
    "redundancy": [ { "id": "rg_...", "name": "PGM to LED", "primary": ["→ lnk"], "backup": ["→ lnk"] } ],
    "network": { "vlans": [ { "id": 10, "name": "Control", "subnet": "10.10.0.0/24" } ], "hosts": [ { "deviceId": "→", "vlan": 10, "ip": "" } ] }
  },

  "racks": [ { "id": "rack_...", "name": "VIDEO 1", "ruTotal": 24, "caseModel": "", "location": "video world|dimmer beach|stage left",
               "slots": [ { "ru": 1, "deviceId": "→ devices.id" } ],
               "power": { "inlet": "L21-30", "pduIds": ["→ devices.id"], "circuitIds": ["→ ckt"] } } ],

  "servers": {
    "hosts": [ { "id": "srv_...", "deviceId": "→ devices.id", "platform": "disguise|Resolume|Pixera|Hippotizer", "role": "master|backup|understudy",
                 "outputs": [ { "portId": "→ ports.id", "resolution": "3840x2160", "refresh": 59.94, "feedsWallId": "→ wall" } ],
                 "inputs": [ { "portId": "→ ports.id", "source": "PGM" } ], "timecode": "LTC|MTC|none", "failover": "→ srv.id | null" } ],
    "content": { "canvasRef": "led.canvas", "contentSpecs": [ { "wallId": "→", "w_px": 0, "h_px": 0, "codec": "HAP|NotchLC|DXV", "fps": 59.94 } ] }
  },

  "binder": {
    "sections": [ { "id": "sec_...", "key": "front-view|rigging|video-system|led|cameras|network|foh|power|schedule|contacts|notes", "order": 1, "visible": true,
                    "blocks": [ { "type": "auto|text|image|table", "ref": "module.path | null", "body": "" } ] } ],
    "annotations": [ { "id": "ann_...", "target": "any entity id", "author": "", "body": "", "at": "" } ],
    "checks": [ { "id": "chk_...", "module": "signal", "severity": "info|warn|block", "target": "entity id", "message": "", "resolved": false } ],
    "schedule": [ { "id": "", "date": "", "time": "", "item": "", "owner": "" } ],
    "contacts": [ { "id": "", "name": "", "role": "", "phone": "", "email": "" } ]
  },

  "derived": {
    "led": { "perWall": { "wall_...": { "tiles": 175, "w_px": 2400, "h_px": 672, "w_ft": 41.0, "h_ft": 11.5, "maxW": 0, "avgW": 0, "weightLb": 0, "portsNeeded": 0 } }, "totals": {} },
    "power": { "byCircuit": {}, "byDistro": {}, "totalW": 0, "totalA_perLeg": 0 },
    "racks": { "byRack": { "rack_...": { "ruUsed": 0, "weightLb": 0, "powerW": 0 } } },
    "signal": { "unresolvedPorts": [], "formatMismatches": [], "singlePoints": [] },
    "inventory": { "deviceCount": 0, "cableCountByType": {}, "caseCount": 0 },
    "computedAt": ""
  }
}
```
Type rules: distances in feet with `_ft`, tile and pitch dimensions in millimetres with `_mm`, power in watts and amps, weight in pounds. Pixel dimensions use `_px`. Enums are lowercase strings. Arrays of entities are keyed by `id`; order in the array is display order.
## ID and naming conventions
Every entity id is `<prefix>_<nanoid12>` so a reference is readable in logs and a wrong-type reference fails validation before it reaches the UI.
| Prefix | Entity | Lives in | Referenced by |
| `dev_` | Device | `devices[]` | led, signal, racks, servers, binder |
| `p_` | Port on a device | `devices[].ports[]` | cables, led.dataRuns, servers.outputs/inputs |
| `cab_` | Cable | `cables[]` | signal.links |
| `wall_` | LED wall | `led.walls[]` | led.canvas, servers.outputs, binder |
| `ckt_` | Power circuit | `led.walls[].power.circuits[]` | racks.power |
| `sig_` | Signal node | `signal.nodes[]` | signal.links (via ports), binder |
| `lnk_` | Signal link | `signal.links[]` | signal.redundancy |
| `rg_` | Redundancy group | `signal.redundancy[]` | binder.checks |
| `rack_` | Rack | `racks[]` | devices.rackId |
| `srv_` | Media server host | `servers.hosts[]` | servers.hosts.failover |
| `sec_` / `ann_` / `chk_` | Binder section, annotation, check | `binder.*` | shell |

Labels follow the show's own convention and are free text, but the store seeds defaults so a blank show is usable immediately: processors `PROC-n`, walls by position (`US Wall`, `SL Wall`, `SR Wall`, `IMAG L/R`), racks `VIDEO n`, cameras `CAM n`, servers `SRV-A/B`, circuits `<distro>-<leg>-<n>`. Labels must be unique within their collection; the store rejects a duplicate with `E_LABEL_DUP`.
References are always the id string, never an embedded copy of the target. A module that needs the target's fields resolves it through `store.get(id)` so a rename or respec in the owning module shows up everywhere on the next render.
## Module ownership matrix
Exactly one writer per slice. **W** = owns and writes, **R** = reads, **A** = may append annotations/checks only, blank = no access. The shell (app frame, show picker, import/export) owns identity.
| Slice | Shell | LED Map & Power | Signal Flow | Rack Build | Media Servers | Show Binder |
| identity (`showId`…`crew`) | W | R | R | R | R | R |
| `meta` | W (store) | R | R | R | R | R |
| `devices[]` | R | W¹ | W¹ | W¹ | W¹ | R |
| `devices[].rackId`, `.ru` |  |  |  | W |  | R |
| `cables[]` |  | W² | W² |  |  | R |
| `led.*` |  | W | R | R | R | R |
| `signal.*` |  | R | W | R | R | R |
| `racks[]` |  | R | R | W | R | R |
| `servers.*` |  | R | R | R | W | R |
| `binder.sections/schedule/contacts` |  |  |  |  |  | W |
| `binder.annotations` | A | A | A | A | A | W |
| `binder.checks` |  | A | A | A | A | W (resolve) |
| `derived.*` | R | R | R | R | R | R |

¹ `devices[]` is shared-write by **class**: LED owns `class ∈ {tile, processor, distro, ledPdu}`, Signal owns `{camera, ccu, switcher, router, converter, recorder, monitor, fiber}`, Rack owns `{rackPdu, ups, shelf, patchPanel}`, Servers owns `{server, kvm, capture, tcGen}`. A module may read any device; it may only create, edit, or delete devices of its own classes. The store enforces this with `E_CLASS_OWNER`.
² `cables[]` is shared-write by **type**: LED owns LED data and tile power cables (`etherCon`, `fiberLED`, `tilePower`); Signal owns everything else (`SDI`, `SMPTE-311`, `fiber`, `cat6`, `tally`, `comms`). The port a cable lands on must exist on a device the cable owner can read, which is always true.
Cross-module needs are met by reading, not writing. Examples: Rack Build reads `devices[].powerW` to roll up rack load, but LED owns the processor's wattage; Media Servers reads `led.canvas` and `derived.led.perWall.*_px` to size outputs, but never writes wall dimensions. If a module needs a field it does not own changed, it files a `binder.checks` entry (severity `warn`) pointing at the entity, and the owning module surfaces it.
## Module contract interface
Every module is a plain object that the shell registers at boot. The store hands it a scoped `ShowAPI`; the module never touches the record directly or imports another module.
```ts
interface ModuleContract {
  id: 'led' | 'signal' | 'rack' | 'servers' | 'binder';
  version: string;                       // module semver, logged in meta.changelog
  owns: string[];                        // JSON-pointer prefixes this module may write, e.g. ['/led', '/devices?class=tile|processor|distro|ledPdu']
  reads: string[];                       // prefixes it subscribes to; store narrows change events to these
  deviceClasses: DeviceClass[];          // classes it may create/edit/delete in devices[]
  cableTypes: CableType[];               // types it may create/edit/delete in cables[]

  init(api: ShowAPI): void;              // called once per show open
  seed(record: ShowRecord): Patch[];     // defaults for a blank show (labels, house format, one rack, etc.)
  derive(record: ShowRecord): Partial<Derived>;   // pure; store merges into derived.<id>
  validate(record: ShowRecord): Check[]; // pure; cross-module checks allowed, writes none
  migrate(record: any, from: string): ShowRecord;  // schemaVersion upgrades for its own slice
  exports: { key: string; label: string; mime: string; render(record): Blob }[];  // CSV/PDF/PNG the Binder may embed
}

interface ShowAPI {
  get<T>(pointer: string): T;                     // read any path; always the current committed record
  resolve(id: string): Entity | undefined;        // id -> entity, any slice
  patch(ops: Patch[], reason: string): Result;    // the only write path
  subscribe(pointer: string, cb: (change) => void): Unsubscribe;
  status(): 'draft' | 'issued' | 'locked' | 'archived';
  check(c: Omit<Check,'id'|'module'>): string;    // append to binder.checks; returns chk_ id
  annotate(targetId: string, body: string): string;
  newId(prefix: IdPrefix): string;
}

type Patch =
  | { op: 'add';     path: string; value: unknown }
  | { op: 'replace'; path: string; value: unknown; ifHash?: string }
  | { op: 'remove';  path: string; ifHash?: string }
  | { op: 'move';    from: string; path: string };

interface Result { ok: boolean; rev: number; errors?: { code: string; path: string; msg: string }[] }
```
Write semantics:
1. `patch()` is atomic. All ops in a call apply or none do.
2. The store checks each op's `path` against the caller's `owns` and the entity's class/type ownership. A miss returns `E_NOT_OWNER` and nothing is written.
3. If `status()` is `issued` or `locked`, any op outside `/binder/annotations` and `/binder/checks` returns `E_FROZEN` (Binder gets `/binder/*` while `locked`).
4. `ifHash` is optional optimistic concurrency for a single entity; on mismatch the op fails with `E_STALE` and the caller re-reads.
5. After a successful patch the store runs `derive()` on every module whose `reads` intersect the changed paths, then `validate()` on all modules, then emits change events. Derived values and checks are therefore never more than one write behind.
6. `reason` is a short human string ("added SR wall", "re-patched PGM-B") and lands in `meta.changelog` with module id, rev, and timestamp.
Read semantics: `get()` returns a frozen snapshot; mutating it throws in dev builds. `subscribe()` fires once per committed patch with `{ paths[], rev, by }`; modules re-read what they need rather than consuming a diff. Cross-module reads go through `get()`/`resolve()`, never through another module's object.
Shell-only operations (not on `ShowAPI`): `createShow(source)`, `copyShow(showId)`, `issueShow()`, `reviseShow()`, `lockShow()`, `unlockShow(reason)`, `archiveShow()`, `importRecord(json)`, `exportRecord()`.
## Per-module contracts
Each module's `owns`, `reads`, what it must derive, what it must validate, and what it seeds on a blank show.
| Module | Owns (write) | Reads | Derives | Validates (checks it must emit) | Seeds on blank show |
| **LED Map & Power** (`led`) | `/led/*`; devices of class tile, processor, distro, ledPdu; cables etherCon, fiberLED, tilePower | identity, `/racks` (distro placement), `/servers/content` (to flag canvas mismatch) | per-wall tile count, px W×H, ft W×H, max/avg W, weight, data ports needed, header/point loads; power by circuit and distro, amps per leg | tile count vs processor port capacity; circuit load > 80% rated; wall px vs server content spec; unmapped tiles on canvas; redundant data run missing | one wall (`US Wall`, ROE CB5, 0×0), one processor `PROC-1`, one distro, 3Ø default |
| **Show Signal Flow** (`signal`) | `/signal/*`; devices of class camera, ccu, switcher, router, converter, recorder, monitor, fiber; all non-LED cables | identity, `/devices`, `/led/walls[].processorIds`, `/servers/hosts[].outputs` | unresolved ports (cable to a port that no longer exists), format mismatches per link, single points of failure per redundancy group, cable count by type/length | link format ≠ downstream input format; A/B paths sharing a device; LED processor input with no feeding link; server output with no link; recorder not on PGM | house format 1080p59.94, LED input 3840×2160p59.94, switcher `SW-1`, router `RTR-1`, VLAN 10 Control / 20 Media / 30 Comms |
| **Rack Build** (`rack`) | `/racks/*`; `/devices[].rackId` and `.ru` for any device; devices of class rackPdu, ups, shelf, patchPanel | identity, `/devices` (ru, powerW, weightLb), `/led/walls[].power.circuits` | RU used/free per rack, weight per rack, watts and amps per rack and per PDU inlet, device-to-rack index | RU overlap; RU overflow; rack load > PDU inlet rating; device placed in two racks; unracked device with `ru > 0`; rack with no PDU | one rack `VIDEO 1`, 24RU, one PDU, inlet L21-30 |
| **Media Servers** (`servers`) | `/servers/*`; devices of class server, kvm, capture, tcGen | identity, `/led/canvas`, `/derived/led/perWall`, `/signal/formats`, `/signal/links` | output count vs wall feed count; content spec per wall from canvas px; failover pairs resolved; total output bandwidth | output resolution ≠ wall px (warn) or ≠ processor input (block); master with no backup/understudy; output with no `feedsWallId`; timecode source mismatch with signal house TC | one host `SRV-A` (master), one `SRV-B` (backup) paired via `failover`, content codec HAP, fps follows house format |
| **Show Binder** (`binder`) | `/binder/*` (sections, schedule, contacts, annotations, checks) | everything | section completeness %, open checks by severity, revision summary for the cover page | required sections hidden on an issued show; blocking checks unresolved at `issueShow()`; contact list missing EIC or Crew Chief | 11 sections in default order, all visible; `auto` blocks bound to `led`, `signal`, `racks`, `servers` exports; cover page from identity |

Contract notes by module:
- **LED Map & Power** publishes `led.canvas` as the authoritative pixel space. Media Servers consumes it; Signal reads processor port assignments from `led.walls[].dataRuns` to draw the processor-to-wall leg without re-entering it.
- **Signal Flow** is the only module that creates non-LED cables, so every SDI/fiber/cat6 count the Binder prints comes from one place. It reads server outputs and processor inputs as endpoints and draws links between ports it does not own.
- **Rack Build** writes exactly two fields on devices it doesn't own (`rackId`, `ru`). This is the one deliberate exception to class ownership and is enforced as a path allowlist, not a class grant.
- **Media Servers** never writes a wall dimension. If content spec and canvas disagree, it files a `warn` check against the wall and the LED module shows it inline.
- **Show Binder** is a composer. `auto` blocks hold a `ref` into another module's `exports[]` and render live; `text`/`image`/`table` blocks are its own content. It is the only module that may mark a check `resolved`, and it does so with an annotation naming who resolved it.
## Drafts, issue, lock, and revisions
[embed: show lifecycle · 4 states, 2 return paths]
Only `draft` accepts input writes. `issueShow()` freezes the record as revision N and is what crew receives; a change after that is a new draft at N+1, never an edit to N.
Rules:
- `issueShow()` is refused while any `binder.checks` entry has `severity = block` and `resolved = false`. Warnings are listed on the cover page but do not stop issue.
- On issue the store snapshots the full record to `revisions[N]` (immutable, stored beside the live record), stamps `meta.revision = N`, and clears the `-draft` export suffix.
- `reviseShow()` clones `revisions[N]` into the live record with `status = draft`, `revision = N + 1`, and appends `{ rev: N+1, from: N, reason, at, by }` to `meta.changelog`. Annotations and unresolved checks carry forward; resolved checks are dropped.
- Example and template shows (`meta.source ∈ {example, template}`) can never be issued. `copyShow()` on one produces a `draft` with `source = copy` and a new `showId`, which can.
- `lockShow()` is a shell action at load-in. While locked, the Binder owns the whole `/binder` tree for as-built notes and the strike punch list; every other path returns `E_FROZEN`.
- `derived` is recomputed on every committed patch and is also recomputed once on open, so a record migrated by `migrate()` never shows stale totals.
- Exports (PDF, CSV, PNG) embed `showCode`, `revision`, `status`, and `updatedAt` in the footer. A draft export is watermarked DRAFT; an issued export carries `REV N`.
## Cross-module validation and conflict rules
Validation runs in two layers. The **store** rejects writes that would corrupt the record (hard errors, patch fails). **Modules** emit checks that describe a show that is valid data but not a buildable system (soft, patch succeeds, check appears in the Binder and inline in the owning module).
Store-level errors (patch refused):
| Code | Condition |
| `E_NOT_OWNER` | Path or entity class/type outside the caller's `owns` |
| `E_FROZEN` | Write to an input path while `issued`/`locked`/`archived` |
| `E_STALE` | `ifHash` does not match the entity's current hash |
| `E_REF_MISSING` | A `→ id` field points at an entity that does not exist |
| `E_REF_TYPE` | Reference prefix does not match the field's expected entity (e.g. a `wall_` in `deviceId`) |
| `E_LABEL_DUP` | Duplicate label within a collection |
| `E_ORPHAN_DELETE` | Removing an entity still referenced elsewhere (see cascade rules) |
| `E_SCHEMA` | Value fails the slice's JSON schema (type, enum, required) |

Cascade rules on delete: a module may delete its own entity only if nothing references it, **or** it passes `cascade: true` in the patch reason object. With cascade the store nulls the dangling references it can (`rackId → null`, `feedsWallId → null`) and deletes the ones it cannot (a `cables[]` entry whose port is gone, a `signal.links[]` entry whose cable is gone), logging each in `changelog`. Devices referenced by a `dataRun` or `slot` are never cascade-deleted from another module's slice; the owner gets a `block` check instead.
Module-level checks (`binder.checks`) use three severities. `block` stops `issueShow()`; `warn` prints on the cover page; `info` is inline only. The canonical cross-module set:
| Check | Emitted by | Severity | Trigger |
| Processor port capacity exceeded | led | block | tiles per data run > processor port spec |
| Circuit over 80% | led | warn | summed tile max W on a circuit > 0.8 × rated |
| Canvas / content mismatch | servers | warn | `contentSpecs[].w_px/h_px` ≠ `derived.led.perWall.*_px` |
| Output / processor input mismatch | servers | block | server output resolution or refresh ≠ `signal.formats.ledInput` |
| Format mismatch on link | signal | block | link `format` ≠ downstream port's accepted formats |
| Single point of failure | signal | warn | A and B paths of a redundancy group traverse the same device |
| Unfed processor input | signal | block | processor input port with no inbound link |
| Unlinked server output | signal | warn | server output with `feedsWallId` set but no link |
| RU overlap / overflow | rack | block | two devices share an RU or `ruUsed > ruTotal` |
| Rack over inlet rating | rack | warn | rack `powerW / voltage` > inlet amps × 0.8 |
| Unracked device | rack | info | device with `ru > 0` and `rackId = null` |
| Required section hidden | binder | block | a section with `required: true` has `visible: false` at issue |
| Missing EIC or Crew Chief | binder | warn | `crew.eic` or `crew.crewChief` empty at issue |

Conflict resolution between concurrent writers (desktop and mobile on the same record):
1. Writes are serialized by the store; the second writer to the same entity gets `E_STALE` if it sent `ifHash`, or last-write-wins at entity granularity if it did not.
2. Mobile sends `ifHash` on every write and shows the current value on conflict. Desktop may omit it for bulk operations (tile mapping, port auto-patch).
3. Ownership prevents cross-module conflicts by construction: two modules can never race on one field.
4. Annotations and checks are append-only, so they never conflict.
## Persistence, export, and external mapping
The live record is one JSON document per show; revisions are sibling documents. Nothing outside the store writes to either.
| Layer | Location | What it holds | Notes |
| Local store | IndexedDB `oncue.shows` (desktop + mobile PWA) | `ShowRecord` per `showId`, `revisions[]` per show, `workspace` index (showCode, name, status, updatedAt) | Autosave on every committed patch; `localStorage` only for UI prefs |
| Export file | `<showCode>_r<rev>[-draft].oncue.json` | Full record + revisions, `schemaVersion` at top | Import runs `migrate()` on each module slice if `schemaVersion` is behind |
| Crew exports | PDF / CSV / PNG from `exports[]` | Binder sections, pull-sheet CSV, LED map PNG, signal flow PNG, rack elevations | Footer carries `showCode · REV n · updatedAt`; drafts watermarked |
| Airtable (Ground) | base `appzQEKX7O1IAi6KN` | one-way push of identity, `devices[]`, `racks[]`, open `checks` | Mapping below; Airtable is a mirror, never a source |
| RentalWorks | order `vendor.orderRef` | `devices[].inventoryRef.iCode` / `barcode`; pull-sheet diff | Import only (CSV/PDF via the Order Intelligence skill) until API access is confirmed |

Airtable push mapping (Ground base): `Shows` ← identity + `meta`; `Devices` ← `devices[]` with `showId` link, `class`, `make`, `model`, `label`, `rackId` link, `iCode`; `Racks` ← `racks[]`; `Checks` ← open `binder.checks` with severity. Push is triggered by `issueShow()` and by an explicit shell action; it never runs on draft autosave. Airtable record ids are stored back on the entity under `ext.airtable` so re-push updates rather than duplicates.
RentalWorks import mapping: a pull-sheet line (`I-Code`, description, qty) becomes a `devices[]` entry with `inventoryRef.iCode` set and `class` inferred from the Stencil Library's 23-class device library; unrecognized I-Codes land as `class = unknown` with an `info` check so a human assigns them. An order revision diff appends `warn` checks for items added or removed since the last import rather than silently editing the record.
Mobile (Pixel & Patch Mobile v.1) opens the same record by `showId`. It is read-mostly: it may write `binder.annotations`, `binder.checks` (resolve), and `devices[].inventoryRef.barcode` from scan mode. All other paths are hidden behind the same `E_FROZEN`/`E_NOT_OWNER` gates with a `mobile` module id, so the ownership matrix needs no second copy.
## Seeded example ShowRecord
A minimal but fully cross-referenced record: one CB5 wall, one processor, one server pair, one rack, one PGM link. Every `→` in the schema resolves. Use it as the first fixture for store tests and as the `meta.source = example` show that ships with the app.
```json
{
  "showId": "7c2e5a10-4f3b-4d8e-9a61-2b0c7e1f9d44",
  "showCode": "EX-2026-001",
  "tourId": null,
  "name": "Example Arena · Single Wall + IMAG",
  "client": { "artist": "Example Artist", "management": "", "productionCo": "" },
  "event": { "type": "arena", "dates": ["2026-11-14"], "venueId": "", "venueName": "Example Arena", "city": "Nashville", "state": "TN", "room": "Main Bowl" },
  "vendor": { "company": "Fuse Operations", "orderRef": "000000", "orderSystem": "RentalWorks" },
  "crew": { "videoDirector": "", "crewChief": "", "eic": "", "ledLead": "", "cameraLead": "", "serverOp": "" },
  "meta": { "status": "draft", "revision": 1, "schemaVersion": "1.0.0", "source": "example",
            "createdAt": "2026-10-30T08:00:00Z", "updatedAt": "2026-10-30T08:00:00Z", "updatedBy": "shell", "changelog": [] },

  "devices": [
    { "id": "dev_proc1", "class": "processor", "make": "Brompton", "model": "SX40", "label": "PROC-1", "qty": 1, "rackId": "rack_v1", "ru": 2, "powerW": 450, "weightLb": 22,
      "ports": [ { "id": "p_proc1_in1", "name": "HDMI IN 1", "type": "HDMI2.0", "dir": "in" }, { "id": "p_proc1_out1", "name": "10G OUT 1", "type": "fiberLED", "dir": "out" } ],
      "inventoryRef": { "system": "RentalWorks", "iCode": "", "barcode": "" } },
    { "id": "dev_dist1", "class": "distro", "make": "Motion Labs", "model": "200A 3Ø", "label": "LED DISTRO 1", "qty": 1, "rackId": null, "ru": 0, "powerW": 0, "weightLb": 180, "ports": [], "inventoryRef": {} },
    { "id": "dev_sw1", "class": "switcher", "make": "Ross", "model": "Carbonite Ultra", "label": "SW-1", "qty": 1, "rackId": "rack_v1", "ru": 3, "powerW": 300, "weightLb": 30,
      "ports": [ { "id": "p_sw1_pgm", "name": "PGM OUT", "type": "3G-SDI", "dir": "out" } ], "inventoryRef": {} },
    { "id": "dev_srvA", "class": "server", "make": "disguise", "model": "vx 2", "label": "SRV-A", "qty": 1, "rackId": "rack_v1", "ru": 4, "powerW": 800, "weightLb": 45,
      "ports": [ { "id": "p_srvA_out1", "name": "DP OUT 1", "type": "DP1.4", "dir": "out" }, { "id": "p_srvA_in1", "name": "SDI IN 1", "type": "3G-SDI", "dir": "in" } ], "inventoryRef": {} },
    { "id": "dev_srvB", "class": "server", "make": "disguise", "model": "vx 2", "label": "SRV-B", "qty": 1, "rackId": "rack_v1", "ru": 4, "powerW": 800, "weightLb": 45,
      "ports": [ { "id": "p_srvB_out1", "name": "DP OUT 1", "type": "DP1.4", "dir": "out" } ], "inventoryRef": {} },
    { "id": "dev_pdu1", "class": "rackPdu", "make": "SurgeX", "model": "SX-1120-RT", "label": "PDU-1", "qty": 1, "rackId": "rack_v1", "ru": 1, "powerW": 0, "weightLb": 8, "ports": [], "inventoryRef": {} }
  ],
  "cables": [
    { "id": "cab_pgm_srvA", "type": "SDI", "length_ft": 10, "fromPort": "p_sw1_pgm", "toPort": "p_srvA_in1", "label": "PGM → SRV-A", "redundancyGroup": null },
    { "id": "cab_srvA_proc1", "type": "SDI", "length_ft": 6, "fromPort": "p_srvA_out1", "toPort": "p_proc1_in1", "label": "SRV-A → PROC-1", "redundancyGroup": "A" },
    { "id": "cab_proc1_wall", "type": "fiberLED", "length_ft": 150, "fromPort": "p_proc1_out1", "toPort": null, "label": "PROC-1 → US Wall", "redundancyGroup": "A" }
  ],

  "led": {
    "walls": [ { "id": "wall_us", "name": "US Wall", "tileModel": "ROE CB5", "cols": 25, "rows": 7, "tileW_mm": 500, "tileH_mm": 500, "pitch_mm": 5.77, "trimHeight_ft": 38,
                 "rigging": { "type": "flown", "headers": 5, "points": [] },
                 "processorIds": ["dev_proc1"],
                 "dataRuns": [ { "portId": "p_proc1_out1", "tileChain": [], "redundant": false } ],
                 "power": { "phase": "3Ø", "circuits": [ { "id": "ckt_us_a1", "amps": 20, "tiles": [] } ], "distroId": "dev_dist1" } } ],
    "canvas": { "w_px": 2400, "h_px": 672, "mappings": [ { "wallId": "wall_us", "x": 0, "y": 0 } ] }
  },
  "signal": {
    "nodes": [ { "id": "sig_sw1", "deviceId": "dev_sw1", "role": "switcher", "x": 100, "y": 200 }, { "id": "sig_srvA", "deviceId": "dev_srvA", "role": "source", "x": 300, "y": 200 }, { "id": "sig_proc1", "deviceId": "dev_proc1", "role": "processor", "x": 500, "y": 200 } ],
    "links": [ { "id": "lnk_pgm", "cableId": "cab_pgm_srvA", "format": "1080p59.94", "path": "A", "label": "PGM" }, { "id": "lnk_srv_proc", "cableId": "cab_srvA_proc1", "format": "3840x2160p59.94", "path": "A", "label": "LED FEED" } ],
    "formats": { "house": "1080p59.94", "ledInput": "3840x2160p59.94", "record": "1080p59.94" },
    "redundancy": [],
    "network": { "vlans": [ { "id": 10, "name": "Control", "subnet": "10.10.0.0/24" } ], "hosts": [ { "deviceId": "dev_proc1", "vlan": 10, "ip": "10.10.0.21" } ] }
  },
  "racks": [ { "id": "rack_v1", "name": "VIDEO 1", "ruTotal": 24, "caseModel": "", "location": "video world",
               "slots": [ { "ru": 1, "deviceId": "dev_pdu1" }, { "ru": 3, "deviceId": "dev_proc1" }, { "ru": 6, "deviceId": "dev_sw1" }, { "ru": 10, "deviceId": "dev_srvA" }, { "ru": 15, "deviceId": "dev_srvB" } ],
               "power": { "inlet": "L21-30", "pduIds": ["dev_pdu1"], "circuitIds": [] } } ],
  "servers": {
    "hosts": [ { "id": "srv_a", "deviceId": "dev_srvA", "platform": "disguise", "role": "master", "outputs": [ { "portId": "p_srvA_out1", "resolution": "3840x2160", "refresh": 59.94, "feedsWallId": "wall_us" } ], "inputs": [ { "portId": "p_srvA_in1", "source": "PGM" } ], "timecode": "LTC", "failover": "srv_b" },
               { "id": "srv_b", "deviceId": "dev_srvB", "platform": "disguise", "role": "backup", "outputs": [ { "portId": "p_srvB_out1", "resolution": "3840x2160", "refresh": 59.94, "feedsWallId": "wall_us" } ], "inputs": [], "timecode": "LTC", "failover": null } ],
    "content": { "canvasRef": "led.canvas", "contentSpecs": [ { "wallId": "wall_us", "w_px": 2400, "h_px": 672, "codec": "HAP", "fps": 59.94 } ] }
  },
  "binder": { "sections": [], "annotations": [], "checks": [], "schedule": [], "contacts": [] },
  "derived": {}
}
```
Expected checks after the first `validate()` pass on this fixture, which doubles as the acceptance test for the validation layer: `signal/warn` single point of failure (no B path to PROC-1); `signal/warn` SRV-B output has `feedsWallId` but no link; `led/info` `dataRuns[0].tileChain` empty (unmapped tiles); `rack/warn` rack load 2,350 W on an L21-30 inlet is within rating, so no check; `binder/warn` EIC and Crew Chief empty.
## Implementation checklist
Order matters: the store and its gates come before any module is ported, so the first module to land is already running under the contract.
1. `store/schema.ts` — JSON schema per slice, `schemaVersion = 1.0.0`, id-prefix regex per reference field
2. `store/ids.ts` — `newId(prefix)` with nanoid12; prefix table from this spec
3. `store/ownership.ts` — `owns` path matcher, device-class and cable-type grants, Rack's `rackId`/`ru` allowlist
4. `store/patch.ts` — atomic `patch()`, `E_*` codes, `ifHash` per entity, `changelog` append
5. `store/lifecycle.ts` — `issueShow`, `reviseShow`, `lockShow`, `unlockShow`, `archiveShow`, `copyShow`; block-check gate on issue; `revisions[]` snapshot
6. `store/derive.ts` — run `derive()` for affected modules then `validate()` for all; write `derived.*` and `binder.checks`
7. `store/cascade.ts` — reference index, `E_ORPHAN_DELETE`, `cascade: true` null/delete rules
8. `store/persist.ts` — IndexedDB `oncue.shows`, autosave, import/export `.oncue.json`, `migrate()` dispatch
9. `fixtures/example-arena.json` — the seeded record above; test asserts the five expected checks
10. Port **LED Map & Power** to `ModuleContract` (owns `/led`, LED device classes, LED cable types)
11. Port **Show Signal Flow** (owns `/signal`, signal device classes, non-LED cables)
12. Port **Rack Build** (owns `/racks`, `rackId`/`ru` allowlist)
13. Port **Media Servers** (owns `/servers`, server device classes)
14. Port **Show Binder** (owns `/binder`; `auto` blocks bound to module `exports[]`)
15. Shell — show picker reads `workspace` index; new-from-blank, from-template, from-example, copy; DRAFT / REV n badge in every module header
16. Mobile v.1 — register as module id `mobile` with `owns = ['/binder/annotations', '/binder/checks', '/devices/*/inventoryRef/barcode']`; `ifHash` on every write
17. Airtable push — Ground mapping, `ext.airtable` write-back, triggered on issue
18. RentalWorks import — pull-sheet CSV to `devices[]` with class inference from the Stencil Library; revision diff to `warn` checks
19. Dev-build guard — freeze `get()` snapshots; throw on direct mutation; log any module importing another module