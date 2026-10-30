# Signal graph, port rules, and validation outcomes
2026-10-30 · @David Bergfeld
The signal graph is a typed port graph over `devices[]`, `cables[]`, and `signal.links[]`; every validation is a query on that graph, and every failed check explains itself with the entities it read, the rule it applied, and the smallest change that would clear it.
## The graph at a glance
[embed: signal graph example · 6 devices, 5 links, 1 redundancy group]
SW-1 feeds SRV-A on program; SRV-A and SRV-B each drive PROC-1 on paths A and B; PROC-1 reaches the wall through one XD, so the group fails SIG-008 even though both servers are present.
## Graph model
The graph has one vertex type (a **port**) and one edge type (a **link**). Devices group ports; nodes position devices on the canvas; redundancy groups name sets of links that must survive a single failure. Nothing in the graph is inferred from a label.
| Term | Record path | Definition | Invariants |
| Device | `devices[]` | A physical unit with ports | Has a `class`; owned by one module |
| Port | `devices[].ports[]` | A connector with a `type` and `dir` (`in`, `out`, `bidir`) | Belongs to exactly one device; `type` from the closed enum |
| Cable | `cables[]` | Physical run from `fromPort` to `toPort` with a `type` and `length_ft` | Both ends resolve to existing ports; `fromPort.dir ∈ {out, bidir}`, `toPort.dir ∈ {in, bidir}`; cable type compatible with both port types |
| Link | `signal.links[]` | A signal travelling over a cable: `format`, `path` (A or B), `label` | One link per cable; `format` is accepted by the `toPort` (port rules) |
| Node | `signal.nodes[]` | Canvas placement + `role` for a device | One node per device that appears in Signal Flow; `role` is a drawing hint, not a rule |
| Path | `links[].path` | A or B; every link is on one | A and B of the same redundancy group may not share a device |
| Redundancy group | `signal.redundancy[]` | `primary[]` and `backup[]` link ids that carry the same content | Both arrays reach the same terminal `toPort` device; non-empty |
| Chain | derived | Ordered links from a source port to a sink port following device internal routing | Computed per sink; cycles are an error |

Format propagation: a link's `format` is set once at the **source** port (camera, server output, switcher output). Each device class declares how formats pass through it in `spec`:
- **Pass-through** (DA, fibre converter, router, patch panel): output format = input format. Signal copies it and marks the link `inherited: true`; editing it is refused with `E_FORMAT_INHERITED`.
- **Converting** (scaler, Teranex, LED processor, switcher): output format comes from `spec.outputFormat` or the device's configured program format. Signal leaves the link editable and validates the input side against `spec.acceptedFormats`.
- **Terminal** (tile data, monitor, recorder input): no output. Validation stops here.
A device with internal routing (switcher, router, server) does not expose its matrix; Signal treats every `in` port as reachable to every `out` port for chain and single-point computation. That is conservative in the right direction: a failure anywhere in the device fails every chain through it.
## Port rules
A cable may join two ports only if the pair appears in the compatibility matrix with a cable type that matches both. The matrix is data (`port-rules.json`), so a new connector is a row, not a code change.
| From port (out) | To port (in) | Cable type | Format rule | Notes |
| `12G-SDI` | `12G-SDI` | `SDI` | any up to 2160p60 | 12G source to 12G sink |
| `12G-SDI` | `3G-SDI` | `SDI` | source must be ≤ 1080p60 | Down-rated by sink; `block` if source is 4K |
| `3G-SDI` | `12G-SDI` / `3G-SDI` | `SDI` | ≤ 1080p60 |  |
| `3G-SDI` / `12G-SDI` | `HD-SDI` | `SDI` | ≤ 1080i / 720p | `block` on 1080p sources |
| `HDMI2.0` | `HDMI2.0` / `HDMI2.1` | `HDMI` | ≤ 2160p60 | HDCP flagged as `warn` when sink is an LED processor |
| `HDMI2.1` | `HDMI2.0` | `HDMI` | ≤ 2160p60 | 8K / 4K120 sources `block` |
| `DP1.2` / `DP1.4` | `DP1.2` / `DP1.4` | `DP` | ≤ 2160p60 (1.2) / ≤ 2160p120 (1.4) | Server to processor; cable ≤ 15 ft or active |
| `DP1.2` / `DP1.4` | `HDMI2.0` | `DP-HDMI` (active adapter) | ≤ 2160p60 | Adapter instantiated as a `converter` with `ru: 0` |
| `fiberLED` | `fiberLED` | `fiberLED` | n/a (Tessera / COEX protocol) | Processor 10G to XD / tile; same `protocol` on both devices |
| `etherCon` | `etherCon` | `etherCon` | n/a | XD / processor 1G to tile, tile to tile; same `protocol` |
| `fiber-SMPTE` | `fiber-SMPTE` | `SMPTE-311` | n/a | Camera head ↔ CCU; `bidir` both ends |
| `fiber-LC` | `fiber-LC` | `fiber` | inherits | FiDO / optical converters; both ends same SFP rate |
| `cat6` | `cat6` | `cat6` | n/a | Control / NDI / Dante; both devices must share a VLAN in `signal.network` |
| `genlock` (out) | `genlock` (in) | `BNC-ref` | tri-level or black burst must match sink's `spec.refFormats` |  |
| `LTC` (out) | `LTC` (in) | `audio-TRS` / `BNC` | frame rate must match house format | 29.97 DF vs 30 ND is a `warn` |
| `tally` / `intercom` | `tally` / `intercom` | `tally` / `comms` | n/a | Drawn on the comms layer; not format-checked |
| `AC-out` | `AC-in` | `power` | voltage / connector match | Owned by Rack and LED; never on the signal canvas |

Format inheritance along a chain:
1. Start at the source link's `format` (set by the user or by the server's output spec).
2. At each device, apply its class rule: pass-through copies, converting replaces with the device's output format, terminal stops.
3. At each link, compare the arriving format to the `toPort` rule in the matrix. A miss is a `block` (the signal cannot physically work) unless the matrix row says `warn`.
4. Record the resolved format on the link as `derived.signal.resolvedFormat[linkId]` so the canvas can print it next to the line even when the stored `format` is blank.
A port may carry at most one cable unless its type is `bidir` on a network device (`cat6` on a switch is many-to-one by nature and is modelled as `count` ports on the template). A second cable to a single-cable port is refused at patch time with `E_PORT_BUSY`, naming the cable already there.
## Validation catalog
Each check has a stable `code` so the Binder can group, filter, and suppress by rule; the explanation text is generated from the code's template (next section), never hand-written per instance. Severity: **block** stops `issueShow()`; **warn** prints on the cover page; **info** is inline only.
| Code | Module | Severity | Trigger (what fails) | Reads |
| `SIG-001` Dangling cable | signal | block | cable end references a port that no longer exists | `cables[]`, `devices[].ports` |
| `SIG-002` Port direction | signal | block | cable leaves an `in` port or enters an `out` port | ports |
| `SIG-003` Incompatible ports | signal | block | port pair not in the compatibility matrix | matrix, ports |
| `SIG-004` Format exceeds sink | signal | block | resolved format above the `toPort` rule (4K into 3G-SDI) | resolved formats |
| `SIG-005` Format mismatch at processor | signal | block | LED processor input receives a format outside `spec.acceptedFormats` or ≠ `signal.formats.ledInput` | processor spec, links |
| `SIG-006` Unfed input | signal | block | processor, recorder, or CCU return input with no inbound link where the device is in use | ports, links |
| `SIG-007` Unlinked server output | signal | warn | server output with `feedsWallId` set but no cable | `servers.hosts[].outputs`, cables |
| `SIG-008` Single point of failure | signal | warn | A and B links of a redundancy group traverse one device, cable, or XD | redundancy, chains |
| `SIG-009` Missing redundancy | signal | warn | profile expects a B path to a wall and none exists | profile, chains |
| `SIG-010` Chain cycle | signal | block | a chain returns to a device already visited | chains |
| `SIG-011` Port busy | signal | block | two cables on a single-cable port | cables |
| `SIG-012` Protocol mismatch | signal | block | `fiberLED` / `etherCon` link between devices with different `spec.protocol` | processor + tile spec |
| `SIG-013` Recorder not on program | signal | warn | no recorder input resolves to a link labelled PGM | links |
| `SIG-014` Reference missing | signal | warn | a device with `spec.genlock = true` has no `genlock` inbound link while a `tcGen` exists | ports, links |
| `SIG-015` Timecode rate | signal | warn | LTC frame rate ≠ house format rate | `signal.formats`, links |
| `SIG-016` VLAN mismatch | signal | warn | two devices on a `cat6` link have no VLAN in common | `signal.network` |
| `SIG-017` Cable length | signal | warn | SDI run > 12G reach (≈ 230 ft at 12G, 330 ft at 3G) or DP > 15 ft passive | cable type, length |
| `SIG-018` Orphan device | signal | info | device on the canvas with no cables | cables |
| `LED-001` Port capacity | led | block | tiles on a data run exceed `pxPerPort8bit` (or 10-bit when HDR) | wall, processor spec |
| `LED-002` Circuit over 80% | led | warn | Σ `maxW` on a circuit > 0.8 × rated | circuits, tile spec |
| `LED-003` Unmapped tiles | led | info | tiles with no data run or no circuit | wall |
| `LED-004` Canvas gap | led | warn | wall mapped off the canvas or overlapping another wall | `led.canvas` |
| `LED-005` Missing redundant run | led | warn | profile expects redundant data and `dataRuns[].redundant = false` | wall, profile |
| `LED-006` Processor unassigned | led | block | wall with tiles > 0 and `processorIds` empty | wall |
| `SRV-001` Output / canvas mismatch | servers | warn | content spec px ≠ derived wall px | `servers.content`, `derived.led` |
| `SRV-002` Output / processor input | servers | block | output resolution or refresh not accepted by the processor input | server outputs, processor spec |
| `SRV-003` No failover | servers | warn | master with `failover = null` where profile expects dual server | hosts, profile |
| `SRV-004` Output unassigned | servers | warn | output with no `feedsWallId` while walls exist | outputs |
| `RCK-001` RU overlap | rack | block | two devices share an RU | slots |
| `RCK-002` RU overflow | rack | block | `ruUsed > ruTotal` | slots |
| `RCK-003` Over inlet rating | rack | warn | rack W ÷ V > 0.8 × inlet amps | devices, PDU spec |
| `RCK-004` Unracked device | rack | info | `ru > 0` and `rackId = null` | devices |
| `RCK-005` No PDU | rack | warn | rack with devices and no `rackPdu` | racks |
| `BND-001` Required section hidden | binder | block | `required` section not `visible` at issue | sections |
| `BND-002` Missing key crew | binder | warn | `crew.eic` or `crew.crewChief` empty at issue | crew |
| `BND-003` Schedule incomplete | binder | warn | no load-in or show entry | schedule |
| `BND-004` Approximate specs in totals | binder | info | any device contributing to a printed total has `source = approximate` | devices |

Checks run after every committed patch over the whole record (the graph is small; a 300-device show validates in well under 100 ms). A check instance is keyed by `code + target id` so re-running replaces rather than duplicates, and a resolved instance whose condition recurs reopens with its history intact.
## How a failed check is explained
A failed check answers four questions in order: **what** is wrong, **where** (which entities), **why** (the rule and the values it compared), and **what would clear it**. The `Check` object carries each as structured data so the canvas, the Binder, mobile, and an exported PDF render the same explanation.
```ts
interface Check {
  id: string;                 // chk_
  code: string;               // 'SIG-004'
  module: ModuleId;
  severity: 'block' | 'warn' | 'info';
  title: string;              // from template: 'Format exceeds sink'
  target: string;             // primary entity id (the link, wall, rack...)
  involved: string[];         // every entity read to decide: ports, devices, cables, specs
  message: string;            // one sentence, filled from the template with labels, never ids
  rule: string;               // the rule in plain words, with the compared values
  evidence: { label: string; value: string; path: string }[];   // what was read, where it lives
  fixes: { label: string; patch?: Patch[]; module: ModuleId }[]; // smallest changes that clear it; a patch is offered only when it is safe to apply unreviewed
  resolved: boolean; resolvedBy?: string; resolvedAt?: string; resolution?: 'fixed' | 'accepted-risk' | 'not-applicable';
  firstSeen: string; lastSeen: string; rev: number;
}
```
Template rules:
- `message` names things by **label** ("PGM-A → PROC-1 HDMI IN 1"), one sentence, no ids, no jargon the Crew Chief would not use.
- `rule` states the comparison with both values: "3G-SDI accepts up to 1080p60; the arriving format is 2160p59.94."
- `evidence` lists every value the check read, each with the record path, so a user can click through to the owning module. Order: the failing value first, then the limit, then context.
- `fixes` are ranked by how little they change. Each names the module that owns the change. A `patch` is attached only when applying it needs no judgement (reassigning a label, deleting a dangling cable); anything that alters a design choice (swapping a port, adding a device) is described but not pre-built.
- A check never says "invalid" or "error" alone; it says what is true and what the system expected.
- `resolution = accepted-risk` is allowed on `warn` and `info` only and requires an annotation; `block` can only be `fixed` or `not-applicable` (with annotation).
Where it shows: on the canvas as a badge on the `target` with a hover card (title, message, first fix); in the owning module's side panel as a list filtered to that module's codes; in the Binder's **Checks** section grouped by severity then code; on the cover page of an issued revision as Known gaps at Rev N (warnings only, one line each); on mobile as the same card with a **Resolve** action.
## Worked examples
Four checks as the user sees them, generated from the seeded example show on the first tab plus one deliberate mistake each.
**SIG-004 · Format exceeds sink · block**
**SRV-A DP OUT 1 → MON-1 SDI IN** is carrying 2160p59.94 into a 3G-SDI input that accepts up to 1080p60. Rule: 3G-SDI accepts ≤ 1080p60; arriving format 2160p59.94 (inherited from SRV-A output 1). Evidence: SRV-A output 1 resolution 3840×2160 @ 59.94 (`servers.hosts[srv_a].outputs[0]`) · MON-1 SDI IN type 3G-SDI (`devices[dev_mon1].ports[0]`) · cable SDI 25 ft (`cables[cab_srvA_mon1]`). Fixes: (1) Feed MON-1 from SW-1 PGM OUT instead — Signal Flow. (2) Change SRV-A output 1 to 1080p59.94 — Media Servers; also affects US Wall feed. (3) Replace MON-1 with a 12G-SDI monitor — Rack Build.
**SIG-008 · Single point of failure · warn**
Redundancy group **PGM to US Wall** has A and B paths that both pass through **XD-1**. Rule: A and B links in one group may not share a device; shared: XD-1 (links SRV-A → PROC-1 A, SRV-B → PROC-1 B both exit via XD-1 10G IN 1). Evidence: group PGM to US Wall (`signal.redundancy[rg_pgm_us]`) · path A chain SRV-A → PROC-1 → XD-1 → US Wall · path B chain SRV-B → PROC-1 → XD-1 → US Wall · XD-1 (`devices[dev_xd1]`). Fixes: (1) Add a second XD and land PROC-1 10G OUT 2 on it, re-run B data to the wall — LED Map & Power. (2) Accept risk with annotation — Show Binder.
**LED-001 · Port capacity · block**
**US Wall data run 3** drives 48 CB5 tiles (1,038,336 px) on one 1G port rated for 525,000 px. Rule: tiles × 104 × 208 must be ≤ processor `pxPerPort8bit`; 1,038,336 > 525,000. Evidence: run 3 tile chain 48 tiles (`led.walls[wall_us].dataRuns[2]`) · CB5 104×208 px (`tpl_roe_cb5.spec`) · Brompton 1G port 525,000 px (`tpl_brompton_sx40.spec.pxPerPort8bit`). Fixes: (1) Split run 3 into two runs of 24 tiles (auto-split available) — LED Map & Power, patch attached. (2) Re-balance all runs to ≤ 24 tiles each — LED Map & Power.
**SIG-006 · Unfed input · block**
**PROC-1 HDMI IN 1** has no incoming signal but PROC-1 drives US Wall. Rule: every input on an in-use processor needs an inbound link; PROC-1 is referenced by US Wall and has 0 inbound links. Evidence: US Wall processors PROC-1 (`led.walls[wall_us].processorIds`) · PROC-1 inputs HDMI IN 1, 12G-SDI IN 1 (`devices[dev_proc1].ports`) · cables ending at PROC-1: none. Fixes: (1) Cable SRV-A DP OUT 1 → PROC-1 HDMI IN 1 via DP-HDMI adapter — Signal Flow. (2) Cable SW-1 PGM OUT → PROC-1 12G-SDI IN 1 — Signal Flow. (3) Remove PROC-1 from US Wall if the wall is not in use — LED Map & Power.
The message line alone is what prints on the cover page; the full card is one click away in every surface.
## What the system does not validate
The graph knows connectors, formats, counts, and ratings. It does not know what is configured inside a device or what the room looks like. The Binder prints this list verbatim under the Checks section so a clean report is never read as a guarantee.
| Not validated | Why | Where it is covered instead |
| Internal device configuration (switcher input mapping, processor canvas offsets, server content assignment) | Not in the record; devices are black boxes between ports | Module notes and the show file for each device, linked from the Binder |
| Actual cable runs, lengths as built, and connector condition | Record holds planned length only | Prep checklist and scan mode on mobile |
| Rigging loads, trim heights, and structure | LED Map records headers and points but does not engineer them | Rigging plot and venue structural review in the Binder `rigging` section |
| Generator or house power availability | Distro inlet rating is validated; what feeds the distro is not | Advance power form, `event` notes |
| Brightness, colour, and viewing distance | Tile `nits` is informational | Video Director judgement; not a check |
| Network bandwidth and switch configuration | VLAN membership is checked; traffic and QoS are not | Network slice notes |
| Content fit and aspect | Pixel dimensions are checked; what is on them is not | Media Servers content review |
| Anything on a device with `source = approximate` beyond flagging it | Values may be wrong | `BND-004` info check and the ≈ badge |

When a user asks the AI validation panel a question the graph cannot answer ("will this be bright enough outdoors?"), the panel says it is outside what the record can verify and points to the row above, instead of guessing.