# New-show path: blank to first advance
2026-10-30 · @David Bergfeld
A new show goes from an empty record to advance-ready in six guided steps, each seeding real defaults so every module opens populated rather than blank. The user can stop after step 2 and still have a usable draft.
Steps 1 and 2 are the only gates to a saved, module-ready draft; steps 3–5 can be finished from inside the LED Map and Binder, and step 6 is where readiness is first computed.
## Guided setup, step by step
The shell runs a six-step wizard on **New show**. Steps 1–2 are required; 3–6 can be skipped and completed later from each module, which shows a "Finish setup" banner until its step is done. Every step writes through `patch()` with `reason = "setup:<step>"` so the changelog shows exactly what was seeded versus what the user entered.
| Step | Shell asks | Seeds (if skipped or left blank) | Writes to | Can skip |
| **1 · Identify** | Start from: blank / template / example / copy of an existing show. Artist, show name, event type, date(s), venue (name, city, state, room), vendor order ref | `showCode` auto-generated `ARTIST-YYYY-SEQ`; `vendor.company = Fuse Operations`, `orderSystem = RentalWorks`; `meta.source` per choice | identity, `meta` | No |
| **2 · Profile the system** | Show type confirms a **system profile** (table below). Then three counts: LED walls (0–6), cameras (0–12), media servers (0 / 1 / A+B). Toggles: IMAG, record, redundant PGM path | Profile defaults for formats, rack count, distro phase, redundancy expectation. Counts create placeholder entities with labels only (`US Wall`, `CAM 1`, `SRV-A`) | `signal.formats`, `signal.network.vlans`, `racks[]`, `devices[]` (placeholders), `servers.hosts[]`, `led.walls[]` (0×0) | No |
| **3 · Size the walls** | Per wall: tile model, cols × rows, position, flown / ground, trim height. Processor make/model or "pick for me" | Tile model from profile (CB5 arena, Vanish 8T outdoor); processor count from tile total ÷ port capacity; one distro per 3Ø service; circuits auto-split by rated amps | `led.walls[]`, `led.canvas`, processor + distro `devices[]`, `ckt_` circuits | Yes → LED module banner |
| **4 · Crew and contacts** | Video Director, Crew Chief, EIC, LED Lead, Camera Lead, Server Op; PM and venue contacts | Any blank role stays blank and raises the `binder/warn` missing-EIC/Crew-Chief check | `crew`, `binder.contacts[]` | Yes → Binder banner |
| **5 · Schedule** | Load-in, LED trim, line check, rehearsal, doors, show, strike. One date per entry, times optional | Profile template times relative to show date (arena: load-in 08:00, LED trim 13:00, line check 16:00, doors 18:30, show 20:00) | `binder.schedule[]` | Yes → Binder banner |
| **6 · Review** | Summary card: counts, formats, open checks. Buttons: **Open LED Map**, **Open Signal Flow**, **Open Binder**, **Done** | Runs `derive()` + `validate()`; writes nothing new | `derived`, `binder.checks` | n/a |

Template and copy starts behave the same way but pre-fill every step from the source record. Copy keeps devices, cables, walls, racks, and servers; it clears `event`, `crew`, `schedule`, `annotations`, resolved checks, and every `inventoryRef.barcode`, and mints new ids throughout so two shows never share an entity id. Example starts are read-only until copied; the wizard offers **Copy to new show** instead of **Done**.
## Defaults by show type
Step 2 picks a system profile from `event.type`. The profile is a starting point, not a constraint; every value is editable in its owning module afterward and the changelog records the override.
| Profile | House / LED input | Walls seeded | Tile default | Cameras | Servers | Racks | Distro | Redundancy expected | Record |
| Arena | 1080p59.94 / 3840×2160p59.94 | 1 US + 2 IMAG | ROE CB5 | 6 | A+B | VIDEO 1, VIDEO 2 | 3Ø 400A | PGM A/B to LED, dual server | PGM + ISO 2 |
| Amphitheater | 1080p59.94 / 3840×2160p59.94 | 1 US + 2 IMAG | ROE CB5 | 5 | A+B | VIDEO 1, VIDEO 2 | 3Ø 400A | PGM A/B to LED | PGM |
| Festival | 1080p59.94 / 3840×2160p59.94 | 2 IMAG | ROE Vanish 8T | 4 | A+B | VIDEO 1 | 3Ø 200A | PGM A/B to LED | PGM |
| Fly-date | 1080p59.94 / 1080p59.94 | 0 (house LED) | — | 3 | 1 | VIDEO 1 (flypack) | 1Ø 20A × 2 | None by default | PGM |
| Rehearsal | 1080p59.94 / 3840×2160p59.94 | 1 US | ROE CB5 | 0 | 1 | VIDEO 1 | 3Ø 200A | None | None |
| Corporate | 1080p59.94 / 3840×2160p59.94 | 1 US | ROE CB5 | 2 | A+B | VIDEO 1 | 3Ø 200A | Dual server | PGM |
| Broadcast | 1080p59.94 / 1080p59.94 | 0 | — | 8 | 1 | VIDEO 1, VIDEO 2 | 3Ø 200A | PGM A/B to truck | PGM + ISO 4 |

Profile side effects:
- **Network**: every profile seeds VLAN 10 Control, 20 Media, 30 Comms; fly-date and rehearsal collapse to VLAN 10 only.
- **Schedule template**: arena and amphitheater use the 08:00 load-in template; festival uses a changeover template (set, line check, show) with no load-in; rehearsal seeds a single "Wall up" entry; fly-date seeds load-in and show only.
- **Binder sections**: all 11 visible for arena, amphitheater, corporate, broadcast; festival and fly-date hide `rigging` and `foh`; rehearsal shows `led`, `power`, `network`, `schedule`, `contacts` only. Hidden sections can be re-enabled in the Binder.
- **Checks**: profiles with "Redundancy expected" register a `signal/warn` single-point-of-failure check as soon as a wall exists with no B path, so the gap is visible from step 6 onward.
## First-advance exit criteria
"Advance-ready" is a derived flag, `derived.readiness.advance = true`, not a lifecycle state. The show stays `draft`; the flag unlocks the **Issue advance** button, which runs `issueShow()` and produces revision 1. The Binder shows the criteria as a live checklist on its cover page.
| Criterion | Source of truth | Blocks issue |
| Identity complete: artist, name, event type, at least one date, venue name and city | identity | Yes |
| Vendor order ref present | `vendor.orderRef` | No (warn) |
| Every LED wall has cols × rows > 0 and a tile model | `led.walls[]` | Yes |
| Every wall has at least one processor and every processor input has a feeding link | `led.walls[].processorIds`, `signal.links` | Yes |
| No circuit over 80% rated load | `derived.power.byCircuit` | Yes |
| Server content spec matches canvas px for every wall | `servers.content.contentSpecs` vs `derived.led.perWall` | No (warn) |
| Every device with `ru > 0` is racked and no rack overflows | `derived.racks.byRack` | Yes |
| Redundancy groups defined wherever the profile expects them | `signal.redundancy[]` | No (warn) |
| Crew Chief and EIC named | `crew` | No (warn) |
| Schedule has load-in and show entries | `binder.schedule[]` | No (warn) |
| All required Binder sections visible | `binder.sections[]` | Yes |
| Zero unresolved `block` checks | `binder.checks` | Yes |

The flag is simply "no criterion marked **Blocks issue** is failing". Warnings print on the cover page under *Known gaps at Rev 1* so a first advance can go out with, for example, crew TBD, and the gap is documented rather than hidden. Any later change to a blocking input drops the show back to not-ready until it is fixed, and `reviseShow()` re-evaluates the list before Rev 2 can issue.
## Wizard state and record writes
The wizard is shell UI over ordinary `patch()` calls; it holds no state of its own beyond the current step. Closing it at any point leaves a valid draft, and reopening it resumes at the first incomplete step read from the record.
```ts
// completion is read, not remembered
const completed = {
  1: !!r.client.artist && !!r.name && r.event.dates.length > 0 && !!r.event.venueName,
  2: !!r.signal.formats.house && r.racks.length > 0,
  3: r.led.walls.every(w => w.cols > 0 && w.rows > 0 && w.processorIds.length > 0),
  4: !!r.crew.crewChief && !!r.crew.eic,
  5: r.binder.schedule.some(s => /load-in/i.test(s.item)) && r.binder.schedule.some(s => /show/i.test(s.item)),
};
```
Record writes per step (`reason` shown):
1. `createShow(source)` → blank record with `meta.source`, `schemaVersion`, `status = draft`, `revision = 1`; then `setup:identify` patches identity and `vendor`. `showCode` is minted here and shown for edit.
2. `setup:profile` → `signal.formats`, `signal.network.vlans`, `racks[]` from the profile; then one `add` per placeholder device, server host, and 0×0 wall; `binder.sections[]` visibility from the profile. Each module's `seed()` runs here against the profile so module-specific defaults land in one patch.
3. `setup:walls` → per wall: `replace` cols/rows/tile/rigging; `add` processors and distro to `devices[]`; `add` circuits; `replace` `led.canvas` from `derive()`. Runs the LED module's auto-split helper and then hands the result to `patch()` as plain ops.
4. `setup:crew` → `replace` on `crew.*`; `add` to `binder.contacts[]`.
5. `setup:schedule` → `add` per schedule entry, times from the profile template offset from `event.dates[0]`.
6. No writes; `derive()` + `validate()` run on the last patch already. The review card reads `derived.readiness` and `binder.checks` and routes the user to the module that owns each open item.

Resuming later: every module header shows a **Finish setup** chip while its step is incomplete. Clicking it opens the wizard at that step with the module's current values pre-filled, so a wall sized in the LED module directly marks step 3 complete without the wizard ever having been reopened.
