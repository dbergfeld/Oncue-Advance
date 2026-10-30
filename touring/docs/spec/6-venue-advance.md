# Venue advance workspace for video departments
2026-10-30 · @David Bergfeld
The Advance view is the shell's workspace for everything the video department needs from a venue before the truck arrives. It owns `event.*`, asks a fixed question set per section, and writes each confirmed answer straight into the record so LED Map, Signal Flow, Rack Build, Crew, and the Binder read it without a handoff step.
## Layout at a glance
[embed: Advance view layout · section rail, question panel, live demand check, status and deliverables rail]
Left rail picks the section and shows confirmed-of-total; the centre is the question table with the field, its state chip, and the live list of modules and tasks reading it; the right rail is section status, deliverables due from this section, and what is still out with the venue.
## Workspace and confirmation model
The Advance view is a questionnaire bound to record fields. Each question maps to one `event.*` field; answering it writes the field and stamps who confirmed it and how. A field's confirmation state is what the rest of the app trusts, so a number typed from memory and a number confirmed by the venue's production manager are never the same colour.
| State | Meaning | Set by | Downstream effect |
| `unknown` | Not asked yet | default | Consuming tasks stay `blocked`; modules show the field as a placeholder |
| `asked` | Sent to the venue / PM, no answer | user, with `askedAt` and `askedTo` | Still blocks; the Advance view lists it under Waiting on venue with days outstanding |
| `assumed` | Working value entered by us, not confirmed | user | Unblocks downstream with an ≈ badge on every derived number that uses it; `BND-005` info check "Built on assumed advance values" |
| `confirmed` | Venue or PM confirmed | user, with `confirmedBy`, `confirmedAt`, `source` (email / call / tech pack / site visit) | Unblocks cleanly; a later change to a confirmed field files `TSK-001` Changed after handoff |
| `waived` | Not applicable to this show | user, with a reason | Consuming tasks go `na`; field hidden from the Binder |

Each section of the view has the same four columns, left to right: the **question** as it would be asked, the **field** it fills (editable, with its state chip), **who uses it** (live list of modules and tasks reading that path, from the route table), and **evidence** (attachment or note: tech pack page, email, photo). The right rail shows the section's completion as confirmed / assumed / asked / unknown counts and the deliverables due from it.
Repeat venues are the common case on a tour, so the view opens with **Load from venue memory** when `event.venueId` matches a venue the workspace has advanced before; every field arrives as `assumed` with the prior show's confirmation noted, and the user confirms or re-asks. Nothing is auto-confirmed from memory.
## Section: venue access
Access answers set the schedule's earliest realistic start and the Crew lane's labor count. The push distance and dock type are what the Crew Chief sizes the load-in call on.
| Question (as asked) | Field | Type | Used by |
| How many dock positions can video use, and when? | `event.access.docks` | `{ count, type: 'dock-high' │ 'ground' │ 'ramp', windowStart, windowEnd }` | Schedule (load-in), Crew C4 labor, Prep truck order |
| Push distance dock to stage, and any ramps, lifts, or elevators on the path | `event.access.pushDistance_ft`, `event.access.pathNotes`, `event.access.elevator { present, capacity_lb, door_in }` | number, text, object | Crew C4, Rack Build (case size vs elevator door), Prep |
| Upstage / stage-left / stage-right clearance for video world and LED ground stacks | `event.access.stageDims { width_ft, depth_ft, wingSL_ft, wingSR_ft }` | object | LED Map (ground-stack footprint), Rack (video world placement) |
| Where is video world and how far to stage, FOH, and dimmer beach? | `event.access.videoWorld { location, toStage_ft, toFOH_ft, toDistro_ft }` | object | Signal (cable lengths, SIG-017), LED (feeder lengths) |
| Parking and shore power for trucks and buses | `event.access.truckParking`, `event.access.shorePower` | text, bool | Prep, Crew |
| Credentials, badging, and escort rules for video crew and local labor | `event.access.credentials` | text | Crew C5 crew sheet |
| Floor load limits and protection requirements | `event.access.floorLoad_psf`, `event.access.floorProtection` | number, text | LED (ground stack), Rack |
| Forklift / scissor lift available, who operates | `event.access.lifts { forklift, scissor, operatorProvided }` | object | LED (build method), Crew C4 |

Default state on a blank show: every field `unknown`. A fly-date profile pre-sets `docks.type = unknown` but waives `stageDims` and `floorLoad_psf` since house video is in place.
## Section: power
Power is the advance answer with the most downstream weight: LED Map's distro picker, the circuit split, and the generator decision all read it. The section asks for what exists, not what we want, and compares it to the derived demand live.
| Question (as asked) | Field | Type | Used by |
| What video power service is available: amps, phase, voltage, connector, and where is the tie-in? | `event.power.services[]` each `{ id, amps, phase: '3Ø' │ '1Ø', volts, connector: 'cam-lok' │ 'tails' │ 'L21-30' │ 'other', location, toVideoWorld_ft, toUpstage_ft }` | array | LED L3 distro and feeder lengths, Rack inlet, Task A3 |
| Is the video service separate from lighting and audio? | `event.power.dedicated` | bool | LED (noise / shared neutral warning as `info`) |
| Is a house electrician required for tie-in, and what are the call rules? | `event.power.electrician { required, name, phone, callNotes }` | object | Schedule (tie-in slot before LED trim), Crew C4 |
| Generator required or available, and who provides it? | `event.power.generator { required, provider, kva, location }` | object | LED (avg W vs kVA), Binder power section |
| Any power limits or shutoff times (curfew, union break, venue policy)? | `event.power.constraints` | text | Schedule, Binder |
| Grounding and isolation notes (isolated ground, UPS requirement) | `event.power.groundingNotes` | text | Rack (UPS template suggested) |

Live comparison panel: derived LED max W and avg W (`derived.power.totalW`) and rack load against `services[].amps × volts × √3` for 3Ø. The panel shows headroom in amps per leg and turns red when `derived.power.totalA_perLeg > 0.8 × amps`, which is the same `LED-002` threshold LED Map uses, so Advance and LED agree by construction. A service with `amps` set and `location` empty still counts as `assumed`, because feeder length changes the order.
## Section: trim and rigging
Trim and point capacity decide whether the wall flies as designed, flies lower, or ground-stacks, so this section is where LED Map's `rigging.type` gets its answer. The video department asks; the rigger and venue confirm.
| Question (as asked) | Field | Type | Used by |
| Maximum trim height to the bottom of the LED, and to the steel | `event.rigging.maxTrim_ft`, `event.rigging.steelHeight_ft` | number | LED Map (trim vs `walls[].trimHeight_ft`, `LED-007` warn when design trim > max), Binder rigging |
| Point capacity and spacing over the video positions | `event.rigging.points[]` each `{ id, label, capacity_lb, x_ft, y_ft }` or `event.rigging.pointCapacity_lb` + `event.rigging.spacing_ft` when no plot | array / numbers | LED Map (header count and load per point, `LED-008` block when wall + headers > point capacity) |
| Is a rigging plot available, and in what format? | `event.rigging.plotRef` (attachment id), `event.rigging.plotFormat` | attachment, enum (PDF / DWG / Vectorworks) | Binder front-view and rigging sections |
| House rigger required? Call rules and cost owner | `event.rigging.houseRigger { required, name, phone, callNotes }` | object | Schedule (rig call before LED trim), Crew C4 |
| Motor provision: who supplies chain motors and control, how many, capacity | `event.rigging.motors { provider: 'tour' │ 'venue' │ 'vendor', count, capacity_lb, control }` | object | LED Map build method, Prep pull sheet (motors on our order or not) |
| Ground-support option: floor flatness, stack height limit, ballast rules | `event.rigging.groundSupport { allowed, maxStack_ft, ballastNotes }` | object | LED Map fallback when flown is blocked |
| Bridle, deck, or truss restrictions over the stage | `event.rigging.restrictions` | text | Binder rigging |

When `maxTrim_ft` is confirmed lower than a wall's designed `trimHeight_ft`, LED Map shows the delta on the wall and offers two patches: lower the trim, or switch to ground support if `groundSupport.allowed`. The Advance view shows the same conflict in the who uses it column, so the person on the phone with the venue sees the consequence while they still have them.
## Section: FOH and signal path
This section fixes the physical path between stage, video world, and FOH so Signal Flow's cable lengths and fibre plan are built on a measured run, not a guess, and so camera positions have a home.
| Question (as asked) | Field | Type | Used by |
| FOH position: location, size, riser height, distance to stage | `event.foh { location, width_ft, depth_ft, riserHeight_ft, toStage_ft, shared: ['audio','lighting','video'] }` | object | Signal (camera and switcher placement), Binder FOH layout, Crew |
| Cable path stage to FOH: overhead, trench, floor run, or house snake; length; protection rules | `event.signalPath.stageToFOH { route: 'overhead' │ 'trench' │ 'floor' │ 'house-fibre', length_ft, protection }` | object | Signal SIG-017 length check, fibre vs copper decision, Prep cable counts |
| House fibre or copper available between positions, count and connector | `event.signalPath.houseFibre { available, strands, connector, testedDate }` | object | Signal (use house fibre in place of our trunk), Prep |
| Camera positions: FOH, pit, handheld lanes, jib, robo; any that need platforms or permissions | `event.cameras.positions[]` each `{ id, label, location, platform, permitted, toVideoWorld_ft }` | array | Signal S4 camera count, CCU cable lengths, Crew (operators), Binder camera plot |
| Video village location if separate from video world | `event.signalPath.videoVillage { location, toVideoWorld_ft }` | object | Signal, Rack placement |
| Comms and tally path: house intercom available, frequencies, wireless restrictions | `event.comms { houseIntercom, wirelessRestrictions, frequencyCoordination }` | object | Signal comms layer, Binder |
| House feeds required: IMAG to house screens, broadcast or record feed to venue, press feed | `event.signalPath.houseFeeds[]` each `{ destination, format, connector, location }` | array | Signal (extra outputs and converters), Servers (output count) |

Every `_ft` distance here is a planning length; Signal adds a connector and service-loop allowance (`+15 %`, min 25 ft) when it proposes cable lengths, and Prep rounds to stock reel lengths. Confirmed distances set the `SIG-017` threshold check; assumed ones add the ≈ badge to every cable length in the pull sheet.
## Section: schedule
The schedule section is the only place `binder.schedule[]` is edited during advance. It starts from the profile template and asks the venue for the fixed points; everything with a `dueFrom` elsewhere in the record moves when these do.
| Question (as asked) | Field | Type | Used by |
| Earliest building access and dock open time | `binder.schedule[key=access]` | entry `{ id, key, date, time, item, owner, confirmed }` | Load-in start, Crew C3 |
| Load-in call, rig call, power tie-in slot | `binder.schedule[key=load-in]`, `[key=rig]`, `[key=power-tie-in]` | entries | Crew C3/C4, LED trim ordering, electrician call |
| LED trim and video line check windows | `binder.schedule[key=led-trim]`, `[key=line-check]` | entries | LED, Signal, Servers tasks (`dueFrom`) |
| Rehearsal / soundcheck windows video must support | `binder.schedule[key=rehearsal]` | entries | Servers content check, Crew |
| Doors, show, curfew | `binder.schedule[key=doors]`, `[key=show]`, `[key=curfew]` | entries | Binder cover, strike planning |
| Strike order and truck-out deadline | `binder.schedule[key=strike]`, `[key=truck-out]` | entries | Crew, Prep return |
| Union breaks, meal penalties, overtime rules | `event.labor { unionHouse, breakRules, mealRules, otAfter_h }` | object | Crew C4 labor count and cost note |

Entries carry `confirmed: bool` and the same state chip as other fields. The view renders them as a single-day timeline with the video dependencies drawn under it (power tie-in before LED trim before line check before rehearsal), and flags an order violation inline ("LED trim scheduled before power tie-in") as `BND-006` warn. Multi-day shows repeat the timeline per `event.dates[]` and copy the template into each day.
## Deliverables
The right rail lists what leaves the department and what must arrive, each tied to its record source so it is generated, not retyped. Outgoing items are Binder exports; incoming items are attachments that confirm fields.
| Direction | Deliverable | To / from | Record source | Format | Due (from load-in) |
| Out | Video advance packet (Rev N): system summary, power request, rigging request, FOH footprint, schedule asks | Production manager, venue | Binder sections `video-system`, `power`, `rigging`, `foh`, `schedule` | PDF | −14 d, re-sent on each issue |
| Out | Power request form | Venue / house electrician | `event.power.services[]` demand vs `derived.power` | PDF + one-page table | −14 d |
| Out | Rigging request: points, loads, trims, motor list | Rigger, venue | `led.walls[].rigging`, `derived.led.perWall.weightLb`, `event.rigging.motors` | PDF + CSV of points | −14 d |
| Out | FOH and camera footprint | PM, audio, lighting | `event.foh`, `event.cameras.positions[]` | PDF plan | −10 d |
| Out | Crew sheet: calls, roles, credentials | Crew, local labor | `crew`, `binder.schedule`, `event.access.credentials` | PDF | −5 d (task C5) |
| Out | Pull sheet and truck pack | Shop, truck lead | `devices[]`, `cables[]`, `inventory` | CSV (RentalWorks) + PDF | −5 d (task P1) |
| Out | House feed list | Venue video / broadcast | `event.signalPath.houseFeeds[]` | one-page table | −7 d |
| In | Venue tech pack | Venue | attaches to `event.*` as evidence; fields confirmed from it | PDF | −21 d |
| In | Rigging plot | Venue / rigger | `event.rigging.plotRef` | PDF / DWG / VWX | −14 d |
| In | Power confirmation (service, location, electrician) | Venue | `event.power.services[]` → `confirmed` | email / form | −10 d |
| In | Stage plot and set design | Production designer | attachment; LED Map imports wall positions when given | PDF / DWG | −14 d |
| In | Content specs acknowledged | Content team / server op | `servers.content.contentSpecs[]` → confirmed | email | −7 d |

Each deliverable row is itself a task in the `advance` lane with `about` set to its source paths, so a change to a confirmed field after the packet went out reopens the packet task and marks the sent PDF superseded. Outgoing documents carry `showCode · REV n · field confirmation summary` in the footer: "12 confirmed · 3 assumed · 2 waiting" tells the reader how firm the packet is.
## Record additions and venue memory
`event` grows from the identity block on the first tab into the full advance record below. Every leaf that a question fills is wrapped in a `Confirmed<T>` so state travels with the value.
```ts
type ConfirmState = 'unknown' | 'asked' | 'assumed' | 'confirmed' | 'waived';
interface Confirmed<T> { value: T | null; state: ConfirmState; by?: string; at?: string;
                         source?: 'email' | 'call' | 'tech-pack' | 'site-visit' | 'venue-memory' | 'stage-plot';
                         askedTo?: string; askedAt?: string; evidence?: string[]; note?: string }

interface EventRecord {
  type: EventType; dates: string[]; venueId: string | null; venueName: string; city: string; state: string; room: string;
  access:     { docks: Confirmed<Dock[]>; pushDistance_ft: Confirmed<number>; pathNotes: Confirmed<string>; elevator: Confirmed<Elevator>;
                stageDims: Confirmed<StageDims>; videoWorld: Confirmed<Position>; truckParking: Confirmed<string>; shorePower: Confirmed<boolean>;
                credentials: Confirmed<string>; floorLoad_psf: Confirmed<number>; floorProtection: Confirmed<string>; lifts: Confirmed<Lifts> };
  power:      { services: Confirmed<PowerService[]>; dedicated: Confirmed<boolean>; electrician: Confirmed<Contact & { required: boolean; callNotes: string }>;
                generator: Confirmed<Generator>; constraints: Confirmed<string>; groundingNotes: Confirmed<string> };
  rigging:    { maxTrim_ft: Confirmed<number>; steelHeight_ft: Confirmed<number>; points: Confirmed<RigPoint[]>; pointCapacity_lb: Confirmed<number>;
                spacing_ft: Confirmed<number>; plotRef: Confirmed<string>; plotFormat: Confirmed<'PDF'|'DWG'|'VWX'>; houseRigger: Confirmed<Contact & { required: boolean }>;
                motors: Confirmed<Motors>; groundSupport: Confirmed<GroundSupport>; restrictions: Confirmed<string> };
  foh:        Confirmed<FOH>;
  signalPath: { stageToFOH: Confirmed<CablePath>; houseFibre: Confirmed<HouseFibre>; videoVillage: Confirmed<Position>; houseFeeds: Confirmed<HouseFeed[]> };
  cameras:    { positions: Confirmed<CameraPosition[]> };
  comms:      Confirmed<Comms>;
  labor:      Confirmed<Labor>;
  houseVideo: Confirmed<string>;          // fly-date only
}
```
Ownership: `/event/*` is written by the shell's Advance view only; modules read it. The Binder may attach evidence. Tasks whose `consumes` reads an `event` path treat `state ∈ {confirmed, assumed}` as satisfied and surface `assumed` as a soft warning on the task card.
Venue memory is a separate store, `venues.json` (and the Venue Intelligence base when connected), keyed by `venueId`. On `issueShow()` the shell copies every `confirmed` event leaf into `venues[venueId].advance[path] = { value, confirmedAt, showCode }`. On a new show at the same venue, **Load from venue memory** writes those values back as `assumed` with `source = venue-memory` and the prior `showCode` in the note. Fields that commonly change per show (`docks.windowStart`, `schedule`, `credentials`) are excluded from the copy; fields that rarely change (`maxTrim_ft`, `services[]`, `pushDistance_ft`, `stageToFOH`) are the ones worth carrying. A venue record also keeps the last three attachments per section so the tech pack does not have to be found again.
New checks introduced by this tab, for the catalog on the Signal graph tab: `LED-007` design trim above venue max (warn), `LED-008` point capacity exceeded (block), `BND-005` built on assumed advance values (info), `BND-006` schedule order violation (warn).