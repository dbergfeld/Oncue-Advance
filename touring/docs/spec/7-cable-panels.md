# Cable and panel planning inside system design
2026-10-30 · @David Bergfeld
A link on the Signal Flow canvas is a logical connection; underneath it the same record holds the physical path it takes, every panel it passes through, and each cable segment with a length. One build context, three layers, no second drawing.
## The layers at a glance
[embed: link to segments · 1 link, 1 cable, 3 segments, 2 panels, 2 positions]
The top row is what the canvas shows in Logical and Physical layers; the bottom row is the same cable in Build, split at the video-world patch panel and the stage box, with the 210 ft confirmed path driving the 250 ft stock run.
## Three layers, one context
The record already has `signal.links[]` (logical) and `cables[]` (physical, port to port). This tab inserts the missing middle: a cable may be realised as several **segments** joined at **panels**, and every segment follows a **path** between two **positions**. Signal Flow shows all of it on one canvas with a layer toggle; nothing is drawn twice.
| Layer | Entity | Answers | Drawn as |
| Logical | `signal.links[]` | what signal goes where, in what format | the line between two device ports on the canvas |
| Physical | `cables[]` | which end lands on which port, cable type, total length | the same line, with its type and total length printed |
| Build | `cables[].segments[]` | which reel or jumper, through which panel jacks, how long each piece is | the line split at panel glyphs; each piece labelled with its length and label |
| Space | `physical.positions[]`, `physical.paths[]` | where the devices and panels stand and which run the cable takes | a plan underlay the canvas can snap device groups and panels to |

Layer toggle in Signal Flow: **Logical** hides panels and shows one line per link; **Physical** shows the same lines with cable type and total length; **Build** expands each line into its segments through panels and prints labels. Selecting a line in any layer selects the same link, cable, and segments in the side panel, so editing a segment length in Build updates the cable's total in Physical and the `SIG-017` reach check in Logical without a mode change.
Default behaviour: a cable with no `segments[]` is one segment from port to port, its path chosen automatically from the two devices' positions. Panels are added when the user drops one on a path, or when the profile's trunk plan is accepted at setup (stage box → trunk → video-world panel for every stage-to-video-world cable).
## Positions and paths
A position is a place gear stands; a path is a run between two positions with a measured length and a route type. Both come from the advance, so the physical map is the venue's answers made usable rather than a new drawing.
| Position (seeded) | Source field | Holds |
| `pos_stage_us`, `pos_stage_sl`, `pos_stage_sr` | `event.access.stageDims` | LED walls, stage boxes, processors when stage-side |
| `pos_video_world` | `event.access.videoWorld` | racks, switcher, servers, processors, video-world panel |
| `pos_foh` | `event.foh` | FOH cameras, FOH panel, director position when FOH-based |
| `pos_dimmer_beach` | `event.power.services[].location` | LED distro, generator tie-in |
| `pos_cam_<id>` | `event.cameras.positions[]` | each camera position |
| `pos_video_village` | `event.signalPath.videoVillage` | when separate from video world |
| `pos_truck` / `pos_house_feed_<n>` | `event.signalPath.houseFeeds[]` | broadcast truck, house screens |

Paths are seeded between every pair the advance measured, each with `length_ft` and `route`:
```ts
interface Position { id: string; label: string; kind: 'stage' | 'video-world' | 'foh' | 'power' | 'camera' | 'village' | 'external'; x_ft?: number; y_ft?: number; sourcePath: string }
interface Path     { id: string; from: string; to: string; length_ft: Confirmed<number>; route: 'overhead' | 'trench' | 'floor' | 'house-fibre' | 'direct';
                     protection?: string; capacityNotes?: string; viaPanels: string[] }   // panel ids that sit on this path, in order
```
A device gets a `positionId` (Rack Build sets it for racked devices through the rack; LED Map sets it for walls, processors, and distros; Signal sets it for cameras and panels). A cable's default path is the shortest chain of `paths[]` between its two devices' positions; the user can pin a different chain. When the advance distance is `assumed`, every derived cable length on that path inherits the ≈ badge; when it is `confirmed`, lengths are firm and `SIG-017` is enforced at full strength.
The plan underlay is optional and schematic: positions are boxes placed by `x_ft` / `y_ft` when the stage plot gives them, otherwise in a default arrangement (stage top, video world stage-left down, FOH bottom). It exists to make the Build layer readable, not to replace the stage plot.
## Panels
A panel is a device of class `patchPanel` whose ports are **jacks**, each jack a pass-through pair (front and rear) of one connector type. Panels are where trunks break out, where stage boxes land, and where a rack presents its connections. They sit on a path and belong to a position.
```ts
interface Jack { id: string; number: number; type: PortType; front: { cableId: string | null }; rear: { cableId: string | null }; label?: string; group?: string }
interface Panel extends Device { class: 'patchPanel'; spec: { panelKind: 'stage-box' | 'bulkhead' | 'rack-panel' | 'fibre-breakout' | 'wall-plate'; jacks: Jack[]; ru: number; trunkPort?: { type: 'fiber-LC' | 'fiber-SMPTE' | 'multipin'; strands: number } } }
```
| Template | Kind | Jacks | RU | Typical place | Notes |
| `tpl_panel_stagebox_12sdi` | stage-box | 12× 12G-SDI BNC, 4× etherCon, 2× XLR comms | 0 (floor) | `pos_stage_sl` / `pos_stage_sr` | Lands on a 12-ch tactical trunk or copper snake |
| `tpl_panel_fibre_12lc` | fibre-breakout | 12× LC duplex, opticalCON MTP rear | 1 | both ends of a tactical fibre trunk | Each LC pair = one 12G path with FiDO or SFP converters |
| `tpl_panel_vw_24sdi` | rack-panel | 24× 12G-SDI BNC pass-through | 1 | top of `VIDEO 1` | Everything entering video world lands here first |
| `tpl_panel_smpte_4` | bulkhead | 4× SMPTE 304 hybrid | 1 | video world rack, camera side | Camera fibre home runs land here, then short jumpers to CCUs |
| `tpl_panel_cat6_24` | rack-panel | 24× RJ45 keystone | 1 | network rack | Control VLAN patching |
| `tpl_panel_foh_8sdi` | stage-box | 8× 12G-SDI, 2× etherCon, 2× XLR | 0 | `pos_foh` | FOH cameras and monitors |
| `tpl_panel_ac_pdu_front` | rack-panel | 8× powerCON TRUE1 | 1 | rack front | Lets power jumpers appear in Build without touching PDU rears |

Rules: a jack's `front` and `rear` each hold at most one cable (`E_PORT_BUSY` applies); a cable landing on the front of jack 7 is joined to whatever is on the rear of jack 7, so the link is continuous without a user drawing the inside of the panel. A panel's `trunkPort` is how a fibre breakout connects to the trunk: the trunk is one `cables[]` entry of type `fiber` with `strands`, and each jack pair maps to a strand pair. Rack-panel templates are placed by Rack Build like any 1 RU device; stage boxes and bulkheads are placed by Signal at a position.
## Segments and length derivation
A cable's `segments[]` is the ordered list of physical pieces from `fromPort` to `toPort`. Each segment is either a **jumper** (a stock cable from a port to a jack, or jack to port) or a **run** (a reel or trunk strand along a path). Lengths are derived unless the user pins them.
```ts
interface Segment { id: string; kind: 'jumper' | 'run' | 'trunk-strand'; from: End; to: End; pathId?: string;
                    length_ft: { derived: number; pinned?: number; stock: number }; reelRef?: string; label: string }
type End = { port: string } | { jack: string; side: 'front' | 'rear' } | { strand: string }
```
Derivation, per segment:
1. **Run along a path**: `derived = path.length_ft × 1.15 + 10` (15 % route allowance plus 10 ft for drops at each end). Overhead routes add the trim height twice when `event.rigging.steelHeight_ft` is confirmed.
2. **Jumper inside a position**: `derived = 10` within a rack, `25` rack to rack or rack to panel in the same position, `50` panel to a floor device (processor on the deck, camera at a position).
3. **Trunk strand**: length is the trunk cable's `length_ft`; the strand itself carries no separate length, only its index.
4. **Stock rounding**: `stock` = the smallest stock length ≥ derived from the type's stock list (SDI: 3, 6, 10, 15, 25, 50, 75, 100, 150, 200, 250; fibre tactical: 100, 250, 500, 1000; SMPTE: 100, 164, 328, 500, 1000; cat6: 3, 7, 15, 25, 50, 100, 150, 250; etherCon LED: 3, 6, 10, 25, 50). A derived length over the longest stock becomes two runs with a coupler, flagged `info`.
5. **Pinned** values override derived but keep both visible, so a field change ("the run is actually 240 ft") is recorded as a pin with a note, not a silent edit.
The cable's `length_ft` (the Physical layer total) becomes `Σ segments.stock` and is what `SIG-017` reach checks and the pull sheet read. A cable with one default segment and no panels still goes through this: port to port along the shortest path chain, rounded to stock.
Trunk plan at setup: for every stage-to-video-world SDI, cat6, and comms cable the profile expects, the shell proposes a tactical fibre trunk with FiDO pairs or a copper snake sized to the count, places a stage box at `pos_stage_sl` or `pos_stage_sr` and a breakout panel at `pos_video_world`, and routes the cables through them. Accepting it writes panels, trunk, and segments in one patch; declining leaves direct runs. Either way the user can drag a panel onto a path later and every cable on that path is re-segmented through it.
## Labeling and numbering
Labels are generated from the record and printed on the pull sheet and on the Build layer; a label is a view of the data, so renaming a device renames every label that mentions it on the next render. The user can override a label; the override is kept and marked.
| Thing | Pattern | Example | Rule |
| Cable | `<TYPE>-<nnn>` | `SDI-014`, `FIB-002`, `CAT-031`, `LED-107` | `nnn` sequential per type per show, assigned at creation, never reused within a revision |
| Segment | `<cable label>.<k>` | `SDI-014.1`, `SDI-014.2` | `k` from source end; a one-segment cable prints the cable label alone |
| Panel | `<POSITION>-<KIND>-<n>` | `SL-SB-1`, `VW-PP-1`, `FOH-SB-1`, `VW-FO-1` | SB stage box, PP SDI patch, FO fibre breakout, SM SMPTE bulkhead, NW network |
| Jack | `<panel label>:<jack number>` | `VW-PP-1:07` | Two-digit jack number |
| Both-ends tag | `<FROM device>:<port> → <TO device>:<port>` plus `via <jack>` | `SW-1:PGM OUT → PROC-1:SDI IN 1 via VW-PP-1:07` | Printed on both ends of every segment; the far-end jack is included so a tech at the panel knows where it continues |
| Redundant pair | suffix `-A` / `-B` on the cable label | `SDI-014-A`, `SDI-015-B` | From `signal.links[].path` |
| Trunk strand | `<trunk label>/<strand>` | `FIB-002/05` | Strand index two digits |

Colour conventions are offered, not enforced: by default path A labels are white, path B yellow, comms green, network blue, LED data orange, following the colour-band system in the Stencil Library. The Build layer uses the same colours for segment lines so a mixed-up A/B is visible before the pull sheet is printed.
## Checks and pull-sheet output
The physical layer adds a `PHY-` family to the catalog on the Signal graph tab. They run in the Signal module and use the same `Check` explanation contract.
| Code | Severity | Trigger | Fix offered |
| `PHY-001` Jack unterminated | warn | a jack has a cable on one side and nothing on the other | list the cables that could land here by type, or remove the panel from the path |
| `PHY-002` Trunk over capacity | block | more cables routed through a trunk than it has strands / channels | add a second trunk (patch attached) or move cables to a direct run |
| `PHY-003` Segment over stock | info | derived length exceeds longest stock; two runs + coupler assumed | pin a length or change route |
| `PHY-004` Reach exceeded on segment | block | a single copper segment exceeds the type's reach at its format (12G ≈ 230 ft, 3G ≈ 330 ft, cat6 328 ft, DP passive 15 ft) | insert a fibre pair or DA at the panel (device templates suggested) |
| `PHY-005` Path unmeasured | warn | a cable's path has `length_ft.state = unknown` | opens the Advance view on the path's source question |
| `PHY-006` A/B share a path | warn | redundancy group's A and B cables route over the same trunk or path | re-route B over another path, or accept risk |
| `PHY-007` Panel in wrong position | warn | a stage box has `positionId` at video world, or a rack panel has no rack | move it |
| `PHY-008` Device has no position | info | a device with cables has `positionId = null`, so lengths are defaults | set position from Rack, LED, or Signal |

Pull-sheet output (replaces the flat cable count the Binder printed before):
| Export | Rows | Columns | Consumer |
| **Cable pull** | one per segment, grouped by type then stock length | type, stock length, qty, labels, from → to, path, A/B | shop pull, RentalWorks diff |
| **Panel schedule** | one per jack | panel, jack, type, front cable, rear cable, far-end tag | panel build and label printing |
| **Trunk map** | one per strand | trunk, strand, cable, from → to | fibre tech |
| **Run list by path** | one per path | path, route, length, cable count by type, protection | load-in crew, venue |
| **Label sheet** | two per segment | both-ends tag, colour, cable label | label printer (CSV / Brady) |

Totals by type and stock length feed `derived.inventory.cableCountByType` so the first tab's inventory rollup now counts reels, not abstract cables. The Binder's `video-system` section embeds the cable pull and panel schedule as `auto` blocks.
## Record additions and ownership
One new slice, two extensions, and one new device class usage.
```ts
// new top-level slice, owned by Signal Flow
physical: {
  positions: Position[];          // seeded from event.*; Signal may add (camera lanes, village)
  paths: Path[];                  // length_ft is Confirmed<number>, mirrored from the advance field it came from
  trunks: string[];               // cable ids of type fiber / snake that carry strands
  stock: Record<CableType, number[]>;   // stock lengths per type; overlay-able like the device library
}

// extensions
devices[].positionId: string | null;            // set by Rack (racked), LED (walls, processors, distros), Signal (cameras, panels)
cables[].segments: Segment[];                   // empty = one default segment
cables[].pathChain: string[];                   // pinned path ids; empty = shortest
cables[].strands?: number;                      // trunks only
devices[class='patchPanel'].spec.jacks: Jack[]; // panel templates in the device library
```
| Path | Writer | Readers |
| `/physical/positions`, `/physical/paths` | Signal (values mirrored from `/event/*`; the advance remains the source of a path's length) | LED, Rack, Binder |
| `/physical/trunks`, `/physical/stock` | Signal | Binder, Prep |
| `/cables/*/segments`, `/cables/*/pathChain` | cable owner (Signal for signal cables, LED for LED data and tile power) | Binder, Prep, mobile |
| `/devices/*/positionId` | Rack for devices with `rackId`; LED for its classes; Signal for cameras and panels | all |
| `patchPanel` devices | Rack places rack-panel kinds; Signal places stage boxes, bulkheads, breakouts | all |

Derive additions: `deriveSegments()` runs inside the Signal module's `derive()` after paths or positions change, recomputing default segments and stock lengths for every cable not pinned, then `derived.inventory.cableCountByType` and `derived.physical.byPath[pathId] = { cables, byType, totalFt }`.
Mobile scan mode reads the label sheet: scanning a cable's barcode shows its both-ends tag and path, and marking it "landed" writes `segments[].landed = true` under the `mobile` writer, which is the first real as-built data in the record and feeds the strike punch list.
Add to the first tab's checklist after `store/cascade.ts`: `signal/physical.ts` (positions, paths, panels, segments, stock rounding, `PHY-` checks) and `fixtures/trunk-plan-arena.json` (the setup trunk plan with a test that one stage-to-video-world SDI cable yields three segments through `SL-SB-1` and `VW-FO-1` and a stock total that rounds correctly).