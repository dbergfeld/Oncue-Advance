# On Cue: Touring

The shared-ShowRecord workspace described in the **On Cue: Touring — Shared Show Record & Module Contracts** doc (copied into `docs/spec/`). One JSON record per show is the single source of truth; five modules each own one slice of it and read the rest.

| Module | Owns | View |
| --- | --- | --- |
| LED Map & Power (`led`) | `/led`, tiles / processors / distros / LED PDUs, LED data + tile power cables | wall sizing, tile map (data runs / circuits), canvas |
| Show Signal Flow (`signal`) | `/signal`, `/physical`, cameras / CCUs / switchers / routers / converters / recorders / monitors / fibre / stage-box panels, every non-LED cable | port-graph canvas with Logical / Physical / Build layers, connect, redundancy groups, trunk plan |
| Rack Build (`rack`) | `/racks`, PDUs / UPS / shelves / rack panels, `rackId` + `ru` + `positionId` on any device | rack elevations, auto-place |
| Media Servers (`servers`) | `/servers`, servers / KVM / capture / sync | outputs to walls, failover, content specs |
| Show Binder (`binder`) | `/binder` | cover page, sections, checks (the only place they are resolved), exports, revisions |
| Show Book (`show`) | `/show` | setlist import, camera roster, notes grid, cues, flags; Director run screen (rehearsal and show), Operator screen with ⚑ notes, rehearsal review, seven exports |
| Shell | identity, `/event` (Advance), `/crew`, schedule, contacts, `advance` / `crew` / `prep` task lanes | Shows, New-show wizard, Advance, Crew & schedule, Tasks |

## Stack

React 18 + TypeScript + Vite + Tailwind; no server. Persistence is IndexedDB (`oncue.shows`) with an in-memory fallback, and shows move between machines as `<showCode>_r<rev>[-draft].oncue.json` exports.

```
src/store/        the contract: types, ids, JSON-pointer patch, ownership gates, refs + cascade,
                  schema, lifecycle (issue / revise / lock / archive / copy), tasks, readiness, persistence
src/library/      device library (templates from the Device library tab) + instantiate()
src/modules/      led.ts, rack.ts, servers.ts, binder.ts, signal/ (port rules, graph, physical layer, helpers),
                  show-book/ (setlist, cues, camera notes, run log, lifecycle gates)
src/setup/        six-step new-show wizard, example + venue memory, RentalWorks CSV import, Airtable payload
src/engine.ts     wires modules + store-level derivations into the Workspace
src/ui/           app shell and one view per module
docs/spec/        the roadmap doc, one file per tab
```

## Commands

```bash
npm install
npm run dev              # http://localhost:5174
npm test                 # vitest: store gates, fixture acceptance checks, task handoff, wizard, modules
npm run typecheck
npm run build            # static site in dist/
npm run build:artifact   # single page in dist-artifact/on-cue-touring.html (React from cdnjs, everything else inlined)
```

## How a write works

Every write is `patch(ops, reason)` through the store, as one writer (`led`, `signal`, `rack`, `servers`, `binder`, `shell`, `mobile`). The store refuses with `E_NOT_OWNER`, `E_CLASS_OWNER`, `E_LANE_OWNER`, `E_FROZEN`, `E_STALE`, `E_REF_MISSING`, `E_REF_TYPE`, `E_LABEL_DUP`, `E_ORPHAN_DELETE`, `E_PORT_BUSY` or `E_SCHEMA`, and applies nothing. On success it re-derives every module, validates every module (checks keyed by `code + target`, so they replace rather than duplicate), opens one task per open block/warn check, evaluates the task chain (`produces` / `consumes` / `blockedBy`), recomputes readiness, appends to the changelog and autosaves.

## Roadmap status

Implementation checklist from the spec, in order:

| # | Item | Status |
| --- | --- | --- |
| 1–8 | store: schema, ids, ownership, patch, lifecycle, derive, cascade, persist | done |
| — | store/tasks.ts (Task handoff tab), signal/physical.ts (Cable & panels tab) | done |
| 9 | `fixtures/example-arena.json` + acceptance test of the expected checks | done |
| 10–14 | LED Map & Power, Signal Flow, Rack Build, Media Servers, Show Binder on `ModuleContract` | done |
| — | Show Book (Cues & camera notes tab): `/show` slice, SHW-001..005, locked-show gates, `fixtures/setlist-arena.json`, ⚑ mobile-note test | done; live sync between the director's and operators' devices needs a shared backend, which this local-first build does not have |
| 15 | Shell: show picker, new from blank / template / example / copy, DRAFT / REV badge | done |
| 16 | Mobile v.1 | writer id `mobile` and its gates exist in the store; no mobile client yet |
| 17 | Airtable push | payload built per the Ground mapping; sending it needs an Airtable connection |
| 18 | RentalWorks import | pull-sheet CSV import with class inference and revision diff checks |
| 19 | Dev-build guard | dev builds deep-freeze committed records |
