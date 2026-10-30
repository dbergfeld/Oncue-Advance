# Task handoff across Advance, Signal, and Crew
2026-10-30 · @David Bergfeld
Tasks live inside the show record as a shared `tasks[]` slice, each pinned to the entity it is about and to the task it waits on, so a dependency is visible from the wall, the link, or the crew slot it concerns without opening a separate tracker.
## The handoff at a glance
[embed: handoff chain · 3 lanes, 9 tasks, 3 cross-lane dependencies]
S2 is blocked because `crew.eic` is empty, not because someone forgot to move a card; the moment Crew fills the field, S2 unblocks, and when S2 clears SIG-006 the Rev 1 gate on A6 opens.
## Task model
`tasks[]` is a new top-level slice of the ShowRecord, shared-write by **lane** the same way `devices[]` is shared-write by class. A lane is a stream of work, not a module: Advance and Crew are shell-owned lanes, Signal, LED, Servers, and Rack belong to their modules, and the Binder may edit any task.
| Lane | Writer | Typical tasks |
| `advance` | shell (Advance view) | confirm venue power, get rigging plot, lock show date, confirm order ref, send advance Rev 1 |
| `signal` | Signal Flow | patch PGM A/B, assign formats, confirm CCU count, build fibre plan |
| `crew` | shell (Crew view) | name EIC, name LED Lead, confirm call times, book local labor, issue crew sheet |
| `led` | LED Map & Power | size walls, split data runs, assign circuits, confirm trim |
| `servers` | Media Servers | set output specs, confirm content delivery, pair failover |
| `rack` | Rack Build | place devices, PDU count, elevation drawing |
| `prep` | shell (Prep view) / mobile | pull sheet reviewed, cases labelled, scan complete |

```ts
interface Task {
  id: string;                       // task_
  lane: Lane;
  title: string;                    // imperative, one line
  detail?: string;
  status: 'todo' | 'doing' | 'blocked' | 'done' | 'na';
  owner?: string;                   // crew role key ('eic', 'crewChief', 'ledLead'...) or a contact id, never a free name
  due?: string;                     // ISO date; usually relative to a schedule entry (see dueFrom)
  dueFrom?: { scheduleId: string; offsetDays: number };   // 'two days before load-in'
  about: string[];                  // entity ids this task concerns: wall_, lnk_, rack_, srv_, dev_, sec_, or a crew role key
  blockedBy: string[];              // task ids that must be done first
  produces?: Condition;             // record condition that marks this task done automatically
  consumes?: Condition[];           // record conditions this task needs true before it can start
  source: 'setup' | 'check' | 'user' | 'import';   // where the task came from
  checkId?: string;                 // when source = check
  history: { at: string; by: string; from: Status; to: Status; note?: string }[];
}

type Condition =
  | { kind: 'path-set';   path: string }                        // e.g. '/crew/eic' is non-empty
  | { kind: 'path-equals'; path: string; value: unknown }
  | { kind: 'count-min'; path: string; min: number }            // '/signal/redundancy' has >= 1
  | { kind: 'check-clear'; code: string; target?: string }      // no open SIG-006 on this entity
  | { kind: 'status';     status: ShowStatus };                 // show issued
```
`about` is what connects a task to the rest of the record: a task about `wall_us` appears on that wall in LED Map, in the Binder's LED section, and on the Advance lane board, all from the one entry. `owner` is a crew role key rather than a name so the task follows whoever is assigned the role in `crew`.
## Dependencies and record-backed completion
A dependency is either another task (`blockedBy`) or a fact in the record (`consumes`). Most handoffs are the second kind: Signal does not wait for "Crew named the EIC" as a ticket, it waits for `/crew/eic` to be non-empty. The store evaluates conditions on every patch, so a task's `blocked` status is derived, never typed.
| Mechanism | Set by | Evaluated | Effect |
| `blockedBy: [taskId]` | user or setup | on every task status change | task shows `blocked` until every listed task is `done` or `na` |
| `consumes: [Condition]` | setup or module | on every patch touching the condition's path | task shows `blocked` with the unmet condition named, e.g. "waiting on crew.eic" |
| `produces: Condition` | setup or module | on every patch touching the path | task flips to `done` automatically with `by = <module id>`; flips back to `doing` if the condition stops holding before issue |
| `source: check` | store, from an open check | when the check opens / resolves | one task per open `block` or `warn` check in the owning lane; resolving the check closes the task, closing the task does not resolve the check |

Status derivation order, per task, after each patch:
1. `na` and user-set `done` without `produces` are left alone.
2. If `produces` holds → `done` (auto). If it held before and no longer does, and the show is still `draft` → `doing`, with a history entry "reopened: <path> changed by <module>".
3. Else if any `blockedBy` task is not `done`/`na`, or any `consumes` condition is false → `blocked`, with `blockers[]` filled in `derived.tasks`.
4. Else keep the user's `todo` / `doing`.
The handoff itself is therefore just a record write in the upstream lane. When Advance confirms venue power by filling `event.power.service` and `event.power.amps`, the Advance task closes, the LED task "Assign distro and circuits" unblocks, and LED Map's distro picker is enabled in the same patch cycle. Nobody moves a card or opens a second app.
## Where dependencies show
The same `tasks[]` entries render in five places; none is the "real" board. Every surface reads `derived.tasks`, which the store fills with each task's blockers resolved to labels.
| Surface | What it shows | Interaction |
| **Entity badge** (wall, link, rack, server, crew slot) | count of open tasks `about` this entity, red if any is `blocked` | hover: task titles + the blocker label ("waiting on crew.ledLead"); click: side panel filtered to the entity |
| **Module side panel** | tasks in the module's lane plus any task `about` an entity the module owns | change status, set owner, add a task about the selected entity; blocked tasks show a **Go to blocker** link that opens the upstream module or Advance/Crew view on the exact field |
| **Lane board** (shell, Advance view) | columns = lanes, rows = status; dependency lines drawn between cards when one is selected | drag between status columns only; lane is fixed by ownership |
| **Binder · Readiness section** | open tasks grouped by lane, blocked first, with owner role and due; prints on the cover page as Open items at Rev N | read-only in the Binder; resolving happens in the owning lane |
| **Mobile** | My tasks (by crew role from `crew`), then tasks about scanned entities | status change and note only |

The **Go to blocker** link is the key piece: a blocked Signal task about `lnk_pgm` whose condition is `path-set /crew/eic` opens the Crew view with the EIC field focused, and a blocked Crew task whose condition is `count-min /led/walls 1` opens LED Map with **Add wall** highlighted. The link is built from the condition's `path` by a shell-level route table (`/crew/*` → Crew view, `/led/*` → LED Map, `/signal/*` → Signal Flow, `/event/*` → Advance view), so a new field needs no new wiring.
Due dates are shown relative to the schedule when `dueFrom` is set ("2 days before load-in · Nov 12"), and move automatically when the schedule entry moves. A task with no due date and no `dueFrom` is sorted last and never generates a reminder.
## Seeded handoff chains
Step 2 of setup seeds this task set from the profile. Every task is record-backed where a condition exists, so most of them close themselves as the show is built. Due offsets are from the schedule's `load-in` entry unless noted.
| # | Lane | Task | Owner role | `produces` (auto-done when) | `consumes` / `blockedBy` | Due |
| A1 | advance | Confirm show date and venue | pm | `path-set /event/dates[0]` and `/event/venueName` | — | setup |
| A2 | advance | Confirm vendor order ref | pm | `path-set /vendor/orderRef` | — | −21 d |
| A3 | advance | Get venue power service (amps, phase, location) | eic | `path-set /event/power/amps` | A1 | −14 d |
| A4 | advance | Get rigging plot and trim limits | ledLead | `path-set /event/rigging/maxTrim_ft` | A1 | −14 d |
| A5 | advance | Confirm house LED / IMAG (fly-date only) | videoDirector | `path-set /event/houseVideo` | A1 | −14 d |
| A6 | advance | Issue advance Rev 1 | videoDirector | `status issued` | all `block` checks clear | −7 d |
| C1 | crew | Name Crew Chief and EIC | pm | `path-set /crew/crewChief` and `/crew/eic` | — | −21 d |
| C2 | crew | Name LED Lead, Camera Lead, Server Op | crewChief | `path-set` on each role | C1 | −14 d |
| C3 | crew | Confirm call times | crewChief | `count-min /binder/schedule 2` (load-in + show) | A1 | −10 d |
| C4 | crew | Book local labor count | crewChief | `path-set /crew/localLabor` | A3, L1 (wall sizes set weight and build time) | −7 d |
| C5 | crew | Issue crew sheet | crewChief | user-closed | C2, C3, C4 | −5 d |
| L1 | led | Size every wall | ledLead | all walls `cols > 0` (LED-006 clear) | A4 | −14 d |
| L2 | led | Assign processors and split data runs | ledLead | `check-clear LED-001` | L1 | −10 d |
| L3 | led | Assign distro and circuits | eic | `check-clear LED-002` and every tile on a circuit | A3, L1 | −10 d |
| S1 | signal | Set house and LED input formats | eic | `path-set /signal/formats/house` | — | setup |
| S2 | signal | Patch program path A to every processor | eic | `check-clear SIG-006` | L2, V1 | −10 d |
| S3 | signal | Patch path B and define redundancy groups | eic | `check-clear SIG-009` | S2 | −7 d |
| S4 | signal | Confirm camera and CCU count, fibre plan | cameraLead | `count-min /devices?class=camera N` (N from profile) | C2 | −10 d |
| S5 | signal | Clear single points of failure or accept risk | eic | `check-clear SIG-008` or annotation | S3 | −5 d |
| V1 | servers | Set server outputs to wall canvas | serverOp | `check-clear SRV-001` and `SRV-002` | L1 | −10 d |
| V2 | servers | Pair failover | serverOp | `check-clear SRV-003` | V1 | −7 d |
| R1 | rack | Place every device, no RU conflicts | eic | `check-clear RCK-001`, `RCK-002`, `RCK-004` | L2, S2, V1 | −7 d |
| R2 | rack | PDU and inlet per rack | eic | `check-clear RCK-003`, `RCK-005` | R1 | −7 d |
| P1 | prep | Review pull sheet against record | crewChief | user-closed; import diff produces `warn` tasks | A2, R1 | −5 d |

Profile variations: fly-date drops A4, L1–L3 and adds A5; rehearsal drops C4, C5, S4, V2, P1; broadcast adds S6 "Confirm truck handoff formats" (`path-set /signal/formats/truck`). Users add their own tasks in any lane they can write; those default to `source: user` and have no conditions unless the user picks one from the entity they attached it to.
## Handoff rules
- **Close in the lane that owns it.** A task's status is written only by its lane's writer, the Binder, or the store (auto). Signal cannot mark a Crew task done; it can only make the condition true by writing the field, if it owns it, or ask by annotation.
- **Record wins over status.** A user may mark a record-backed task `done` early; the store leaves it `done` only while the condition holds. If it does not hold at `issueShow()`, the task is reopened and listed on the cover page as an open item.
- **A late change reopens exactly what depends on it.** When an upstream field changes after its task closed (venue power drops from 400 A to 200 A), the store reopens the producing task, re-derives every task whose `consumes` reads that path, and files one `info` check "Changed after handoff" on the field naming the downstream tasks affected. Nothing downstream is auto-closed or auto-changed.
- **Checks and tasks are separate.** A check is the system's finding; a task is someone's work. Resolving a check closes its task; closing a task never resolves a check. Accepting risk on a `warn` check closes the task with `resolution = accepted-risk` carried in the history note.
- **Issue snapshots the board.** `issueShow()` copies open tasks into `revisions[N].openTasks` so the cover page of Rev N is stable even as work continues on the next draft.
- **Locked shows take only prep and strike tasks.** While `locked`, new tasks may be created in the `prep` lane only, and existing tasks may change status but not conditions.
- **Owner follows the role.** If `crew.eic` changes from one person to another, every task with `owner = 'eic'` moves with it and gets a history line; no task is re-assigned by hand.
- **No orphans.** A task's `about` ids are validated like any reference; deleting the entity with `cascade: true` marks its tasks `na` with the note "entity removed", never deletes them.
## Store additions
Four changes to the first tab's spec make this work; none alters an existing module contract.
1. **Schema** — add `tasks: Task[]` at the top level and `openTasks` to the revision snapshot. Add `event.power { service, amps, location }`, `event.rigging { maxTrim_ft, plotRef }`, `event.houseVideo`, and `crew.localLabor` as the Advance-owned fields the seeded chains read.
2. **Ownership** — `tasks[]` is shared-write by `lane`: `advance`, `crew`, `prep` to the shell; `signal`, `led`, `servers`, `rack` to their modules; Binder writes any. Enforced as `E_LANE_OWNER`, the same path as `E_CLASS_OWNER`. Status writes by the store itself carry `by = 'store'`.
3. **Derive** — a store-level `deriveTasks()` runs after module `derive()` and before `validate()`: evaluates every `produces` and `consumes`, resolves `blockedBy`, fills `derived.tasks[id] = { status, blockers: [{ kind, label, route }], dueResolved }`, and reopens or auto-closes per the derivation order above. Conditions are evaluated only when a patched path intersects theirs, so cost scales with the change, not the record.
4. **Validate** — one new check, `TSK-001` Changed after handoff (`info`), filed on a field whose producing task was already done; and one `issueShow()` gate: open tasks in the `advance` lane with `blockedBy` empty and status `todo` are listed on the cover page but do not block issue (blocking remains the job of `block` checks).
```ts
// ShowAPI additions (all modules)
task(create: Omit<Task,'id'|'history'|'source'>): string;   // lane must be one the caller may write
setTaskStatus(id: string, status: TaskStatus, note?: string): Result;
tasksAbout(entityId: string): DerivedTask[];                  // what a module reads to draw badges

// shell route table used by Go to blocker
const routes = { '/crew/': 'crew-view', '/event/': 'advance-view', '/led/': 'led', '/signal/': 'signal', '/servers/': 'servers', '/racks/': 'rack', '/binder/schedule': 'crew-view' };
```
Add to the implementation checklist on the first tab, after `store/derive.ts`: `store/tasks.ts` (schema, lane ownership, `deriveTasks`, route table) and `fixtures/tasks-arena.json` (the seeded chain above, with a test that A3 → L3 unblocks on a single `event.power.amps` write).