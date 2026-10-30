# Device library for video systems
2026-10-30 · @David Bergfeld
The library is a versioned JSON catalog of device templates that every module instantiates from, so a processor added in LED Map and one added in Rack Build carry identical ports, power, and RU. Specs below are seeded from manufacturer published data where checked and marked approximate otherwise.
## DeviceTemplate schema
A template is a `devices[]` entry with no show-specific fields and a stable `templateId`. Instantiating one copies the template into `devices[]`, mints a `dev_` id and `p_` ids for every port, and records `templateId` so a later library update can be offered as a diff rather than silently applied.
```ts
interface DeviceTemplate {
  templateId: string;            // 'tpl_brompton_sx40' — slug of make+model, never changes
  class: DeviceClass;            // owning module is derived from class (see contracts tab)
  make: string;
  model: string;
  aliases?: string[];            // 'SX-40', 'Tessera SX40' — for search and RentalWorks description matching
  ru: number;                    // 0 for non-rack items (tiles, cameras, distros)
  powerW: number;                // typical draw at the inlet; tiles use spec.maxW / spec.avgW instead
  weightLb: number;
  ports: PortTemplate[];         // name, type, dir, count (expanded to numbered ports on instantiate)
  spec: Record<string, unknown>; // class-specific fields (next section)
  inventory?: { iCodes: string[]; caseModel?: string; caseWeightLb?: number };  // RentalWorks I-Codes seen for this item
  source: 'manufacturer' | 'measured' | 'approximate';
  verifiedAt?: string;           // ISO date the spec was last checked
}

interface PortTemplate { name: string; type: PortType; dir: 'in' | 'out' | 'bidir'; count: number; notes?: string }

// instantiate: template -> devices[] entry
function instantiate(t: DeviceTemplate, label: string, api: ShowAPI): Device {
  return { id: api.newId('dev'), templateId: t.templateId, class: t.class, make: t.make, model: t.model, label,
           qty: 1, rackId: null, ru: t.ru, powerW: t.powerW, weightLb: t.weightLb,
           ports: t.ports.flatMap(p => Array.from({ length: p.count }, (_, i) =>
             ({ id: api.newId('p'), name: p.count > 1 ? `${p.name} ${i + 1}` : p.name, type: p.type, dir: p.dir }))),
           spec: structuredClone(t.spec), inventoryRef: { system: 'RentalWorks', iCode: t.inventory?.iCodes[0] ?? '', barcode: '' } };
}
```
Port types are a closed enum so Signal Flow can validate a cable end: `12G-SDI`, `3G-SDI`, `HD-SDI`, `HDMI2.0`, `HDMI2.1`, `DP1.2`, `DP1.4`, `DVI`, `fiberLED` (processor-to-tile 10G), `etherCon` (tile data 1G), `fiber-SMPTE` (SMPTE 311M hybrid), `fiber-LC`, `fiber-ST`, `cat6`, `genlock`, `LTC`, `tally`, `intercom`, `AC-in`, `AC-out`, `DC-in`. A template may declare a port with `dir: 'bidir'` only for network and intercom.
## Classes and class-specific spec fields
`class` decides the owning module and which `spec` keys are required. The store validates `spec` against the class schema at instantiate time, so a tile with no `pitch_mm` cannot enter a show.
| Class | Owner | Required `spec` keys | Used by |
| `tile` | led | `pitch_mm`, `w_mm`, `h_mm`, `d_mm`, `px_w`, `px_h`, `maxW`, `avgW`, `nits`, `ip`, `curve` (concave/convex deg), `protocol` (Brompton / Novastar / Megapixel), `transparency_pct` | LED Map tile count, px canvas, power split, weight; Rack ignores |
| `processor` | led | `protocol`, `maxPx`, `pxPerPort8bit`, `pxPerPort10bit`, `outputs1G`, `outputs10G`, `inputs` (list), `maxCanvas` (w×h), `genlock` | LED Map port capacity check; Signal draws inputs |
| `distro` | led | `service` (3Ø / 1Ø), `inletAmps`, `outlets` (list of connector + amps + count), `phaseBalance` | LED Map circuit assignment; Rack power inlet |
| `ledPdu` | led | `inlet`, `outlets`, `ratedAmps` | LED Map per-circuit tile feed |
| `camera` | signal | `sensor`, `mount`, `formats` (list), `outputs`, `transport` (SMPTE / fiber / SDI), `ccuRequired`, `ptz` | Signal source node; Binder camera plot |
| `ccu` | signal | `cameraFamily`, `transport`, `outputs`, `returnFeeds`, `tally` | Signal; Rack RU |
| `switcher` | signal | `meLevels`, `inputs`, `outputs`, `auxOuts`, `formats`, `multiview`, `controlPanel` | Signal core node |
| `router` | signal | `size` (in×out), `formats`, `expandable` | Signal routing |
| `converter` | signal | `from` (port type), `to` (port type), `scaler`, `frameSync`, `poweredBy` (AC / USB / DC) | Signal link endpoints; Rack shelf items |
| `recorder` | signal | `channels`, `codecs`, `media`, `formats` | Signal record node |
| `monitor` | signal | `size_in`, `inputs`, `multiview`, `rackMount` | Signal sink; Rack RU |
| `fiber` | signal | `channels`, `connectors`, `distance_ft`, `direction` | Signal transport |
| `server` | servers | `platform`, `outputs` (count + type), `maxOutputRes`, `inputs`, `gpu`, `storage_tb`, `timecode`, `genlock` | Media Servers host; Signal source |
| `capture` | servers | `channels`, `type`, `formats` | Media Servers inputs |
| `kvm` / `tcGen` | servers | `ports` / `outputs`, `refSource` | Media Servers control / sync |
| `rackPdu` | rack | `inlet`, `outlets`, `ratedAmps`, `metered` | Rack power |
| `ups` | rack | `va`, `runtimeMin`, `outlets` | Rack power |
| `shelf` / `patchPanel` | rack | `depth_in` / `ports`, `type` | Rack layout |

Every class also carries the common fields (`ru`, `powerW`, `weightLb`, `ports`). For tiles `powerW` is left 0 and the LED module uses `spec.maxW` / `spec.avgW` so the power calculation is explicit about peak versus average.
## LED processors
Port capacity is the number LED Map checks tiles against; it is per 1G output at 8-bit 60 Hz unless noted. Rows marked approximate need a datasheet pass before `source` is set to `manufacturer`.
| templateId | Make / model | Protocol | Inputs | Outputs | Px per 1G port (8-bit) | Max px | RU | W | lb | Source |
| `tpl_brompton_sx40` | Brompton Tessera SX40 | Brompton | 1× 12G-SDI, 1× HDMI 2.0 (+ thru), DMX in/thru, genlock | 4× 10G (copper or fibre) to XD units | via XD: 525k | 9M, 4096×2160 @60 | 2 | 140 (1.2 A @120 V) | 16.5 | manufacturer (datasheet) |
| `tpl_brompton_xd` | Brompton Tessera XD | Brompton | 3× 10G (copper or fibre) | 10× 1G etherCon | 525k | pass-through | 1 | 50 (0.4 A) | 22 | manufacturer (4Wall) |
| `tpl_brompton_s8` | Brompton Tessera S8 | Brompton | 12G-SDI, HDMI 2.0, DVI (4K60) | 8× 1G etherCon | 525k | 4.2M | 2 | 140 | 22 | manufacturer (nvision360) |
| `tpl_brompton_s4` | Brompton Tessera S4 | Brompton | 1× DVI-D (+ thru), 1080p60 max | 4× 1G etherCon | 525k | 2.1M | 1 | 50 | 6.8 | manufacturer (datasheet) |
| `tpl_brompton_sq200` | Brompton Tessera SQ200 | Brompton | 4K/8K, released Sep 2025 | 10G | — | — | — | — | — | approximate, datasheet pending |
| `tpl_novastar_mx40pro` | NovaStar MX40 Pro (COEX) | Novastar | 3× HDMI 2.0 (+ loop), 1× DP 1.2, 1× 12G-SDI (+ loop), genlock in/loop | 20× 1G RJ45, 4× 10G optical (2 primary + 2 backup) | 659,722 (8-bit); 494,791 (10-bit, A10s Pro) | 9M, max W/H 16,384 | 2 | 95 | 13 | manufacturer (spec summary, weight) |
| `tpl_novastar_mx30` | NovaStar MX30 (COEX) | Novastar | HDMI 2.0, DP 1.2, 12G-SDI | 10× 1G, 2× 10G | 659k | 4.5M | 2 | 80 | 12 | approximate |
| `tpl_megapixel_helios` | Megapixel HELIOS 4K | Megapixel | 4× 12G-SDI, HDMI 2.0, DP | 10G fibre to receiving cards | — | 8.8M | 2 | 150 | 17.6 | approximate (ROE comparison) |
| `tpl_megapixel_helios8k` | Megapixel HELIOS 8K | Megapixel | 4× 12G-SDI, DP 1.4 | 10G fibre | — | 35M | 2 | 180 | 17.6 | approximate |

Port definitions seeded per template: every input above is a `ports[]` entry with `dir: in`; every 1G output is `type: etherCon, dir: out`; every 10G output is `type: fiberLED, dir: out`. Genlock and DMX are `genlock` / `dmx` inputs so Signal can draw the reference chain. SX40 systems always instantiate with at least one XD paired, since tiles never connect to the SX40 directly.
## LED tiles
All values per panel. `maxW` drives circuit sizing; `avgW` drives distro and generator planning. ROE Carbon and Vanish rows are from ROE's published brochures; the rest are approximate pending a datasheet pass.
| templateId | Make / model | Pitch mm | W×H×D mm | Px W×H | Max / avg W | lb | Nits | IP | Curve | Protocol | Source |
| `tpl_roe_cb5` | ROE Carbon CB5 | 5.77 | 600×1200×77 | 104×208 | 500 / 250 | 30.5 | 6000 | outdoor | concave 15° / convex 10° | Brompton | manufacturer (ROE brochure) |
| `tpl_roe_cb5_mkii` | ROE Carbon CB5 MKII | 5.77 | 600×1200×79 | 104×208 | 480 / 240 | 29.9 | 6000 | IP65 | concave 15° / convex 10° | Brompton | manufacturer (ProAV) |
| `tpl_roe_cb5_half` | ROE Carbon CB5 Half | 5.77 | 600×600×77 | 104×104 | 250 / 125 | 15.3 | 6000 | outdoor | as CB5 | Brompton | approximate (half of CB5) |
| `tpl_roe_cb3` | ROE Carbon CB3 | 3.75 | 600×1200×77 | 160×320 | 540 / 270 | 29.1 | 1500 | indoor | concave 15° / convex 10° | Brompton | manufacturer (ROE brochure) |
| `tpl_roe_cb8` | ROE Carbon CB8 | 8.33 | 600×1200×77 | 72×144 | 430 / 220 | 28.0 | 5000 | outdoor | concave 15° / convex 10° | Brompton | manufacturer (same brochure) |
| `tpl_roe_v8t` | ROE Vanish V8T | 8.9 | 1000×1000×95 | 112×112 | 480 / 240 | 40.1 | 4000 | IP65 outdoor | yes | Brompton | manufacturer (V8T brochure); 50% transparency |
| `tpl_roe_v8t_h` | ROE Vanish V8T-H (half) | 8.9 | 1000×500×95 | 112×56 | 260 / 130 | 24.7 | 4000 | IP65 outdoor | yes | Brompton | manufacturer (same brochure) |
| `tpl_roe_v8s` | ROE Vanish V8S | 8.9 | 1000×1000×67 | 112×112 | 440 / 220 | 20.5 | 3500 | indoor | yes | Brompton | manufacturer (Vanish specs) |
| `tpl_roe_bm4` | ROE Black Marble BM4 (floor) | 4.6 | 1000×500×— | 208×104 | 450 / 225 | 48 | 1500 | indoor | no | Brompton | approximate |
| `tpl_roe_dm2_6` | ROE Diamond DM2.6 | 2.6 | 500×500×— | 192×192 | 230 / 115 | 17.6 | 1200 | indoor | concave / convex | Brompton | approximate |
| `tpl_absen_pl3_9` | Absen PL3.9 Pro | 3.9 | 500×500×— | 128×128 | 200 / 80 | 17 | 1200 | indoor | yes | Novastar | approximate |
| `tpl_infiled_db5` | INFiLED DB5 | 5.2 | 500×500×— | 96×96 | 180 / 70 | 15 | 5000 | outdoor | yes | Novastar | approximate |

LED Map derives per wall: `tiles = cols × rows`, `px = (cols × px_w) × (rows × px_h)`, `ft = (cols × w_mm × 0.00328) × (rows × h_mm × 0.00328)`, `maxW = tiles × spec.maxW`, `weightLb = tiles × weightLb + headers`, `portsNeeded = ceil(tiles × px_w × px_h / processor.pxPerPort8bit)` (redundant runs double it). A CB5 wall of 25×7 (the Sombr rehearsal wall) therefore reads 175 tiles, 2600×1456 px, 49.2×27.6 ft, 87.5 kW max / 43.75 kW avg, 5,343 lb of panel, 3.79 Mpx, 8 data ports on Brompton (16 with redundancy).
## Cameras and CCUs
A system camera template always pairs with a CCU template; `instantiate` of a `ccuRequired` camera prompts for its CCU and links the two with a `fiber-SMPTE` cable in the same patch. Values are approximate working numbers for planning (head weight without lens or viewfinder) until each is checked against the current datasheet.
| templateId | Make / model | Class | Sensor / mount | Formats | Transport / outputs | CCU | RU | W | lb | Source |
| `tpl_sony_hdc3500` | Sony HDC-3500 | camera | 3× 2/3" CMOS, B4 | 1080p59.94, 1080i, 4K via CCU | SMPTE 311M fibre to HDCU | `tpl_sony_hdcu3500` | 0 | 60 | 11 | approximate |
| `tpl_sony_hdcu3500` | Sony HDCU-3500 | ccu | — | 1080p / 4K out | 4× 12G/3G-SDI out, return in, tally, intercom | — | 2 | 200 | 20 | approximate |
| `tpl_sony_hdc5500` | Sony HDC-5500 | camera | 3× 2/3" 4K CMOS, B4 | 1080p59.94, 2160p59.94 | SMPTE 311M fibre to HDCU-5500 | `tpl_sony_hdcu5500` | 0 | 80 | 13 | approximate |
| `tpl_sony_hxcfb80` | Sony HXC-FB80 | camera | 3× 2/3" CMOS, B4 | 1080p59.94, 1080i | SMPTE 311M fibre to HXCU-FB80 | `tpl_sony_hxcufb80` | 0 | 45 | 9 | approximate |
| `tpl_pana_uc4000` | Panasonic AK-UC4000 | camera | 4.4K MOS, B4 | 1080p, 2160p | SMPTE 311M fibre to AK-UCU600 | `tpl_pana_ucu600` | 0 | 70 | 12 | approximate |
| `tpl_bmd_ursabroadcast_g2` | Blackmagic URSA Broadcast G2 | camera | 6K S35, B4 / EF | 1080p59.94, 2160p59.94 | 12G-SDI out; optional Camera Fiber Converter | optional `tpl_bmd_studioconverter` | 0 | 40 | 6.5 | approximate |
| `tpl_bmd_studio4kpro_g2` | Blackmagic Studio Camera 4K Pro G2 | camera | 4/3" 4K, MFT | 1080p59.94, 2160p59.94 | 12G-SDI out, SDI in return, tally | none (ATEM control over SDI) | 0 | 30 | 3.5 | approximate |
| `tpl_pana_ue160` | Panasonic AW-UE160 PTZ | camera (ptz) | 1" MOS | 1080p59.94, 2160p59.94 | 12G-SDI, HDMI, NDI, SMPTE ST 2110 | none (IP control) | 0 | 50 | 10 | approximate |
| `tpl_sony_brcx1000` | Sony BRC-X1000 PTZ | camera (ptz) | 1" CMOS | 1080p59.94, 2160p29.97 | 3G-SDI, HDMI, VISCA over IP | none | 0 | 40 | 7 | approximate |
| `tpl_marshall_cv568` | Marshall CV568 POV | camera (pov) | 1/2.5" CMOS, M12 / CS | 1080p59.94 | 3G-SDI, HDMI, Genlock | none | 0 | 5 | 0.4 | approximate |

Seeded `ports[]` by template: system cameras carry one `fiber-SMPTE` bidir port; CCUs carry `fiber-SMPTE` (camera side), 4× SDI out, 1× SDI return in, `tally`, `intercom`, `genlock`; SDI-only cameras carry 12G-SDI out and a return in. PTZ templates carry `cat6` bidir for control and PoE++ where the model supports it, so Signal's network slice can place them on the Control VLAN. Lens, viewfinder, tripod, and build-up kit live in `inventory.iCodes` as companion items so the pull-sheet diff can flag a camera ordered without its lens.
## Converters, distribution, and transport
Converters are the one class where `from` / `to` port types matter more than make and model: Signal Flow validates a cable end against them, so a template with the wrong `to` type breaks the format check downstream. Power and weight are approximate planning values.
| templateId | Make / model | From → to | Scaler / frame sync | Powered | RU (shelf) | W | lb | Notes |
| `tpl_aja_hi5_12g` | AJA Hi5-12G | 12G-SDI → HDMI 2.0 | no / no | DC 5 V | 0 | 6 | 0.5 | LED processor HDMI input feed, monitor taps |
| `tpl_aja_ha5_12g` | AJA HA5-12G | HDMI 2.0 → 12G-SDI | no / no | DC 5 V | 0 | 6 | 0.5 | Laptop / server HDMI into SDI plant |
| `tpl_aja_fido_4t` | AJA FiDO-4T-12G | 4× 12G-SDI → fiber-LC (4 ch) | — | DC 5 V | 0 | 8 | 0.6 | Long-run SDI; pairs with FiDO-4R |
| `tpl_aja_fido_4r` | AJA FiDO-4R-12G | fiber-LC (4 ch) → 4× 12G-SDI | — | DC 5 V | 0 | 8 | 0.6 | Receive end of FiDO-4T |
| `tpl_bmd_teranex_12g` | Blackmagic Teranex Mini 12G-SDI to HDMI 8K HDR | 12G-SDI → HDMI 2.0 | no / no | AC | 0 | 10 | 1.2 | Dual on-screen scopes; monitor feeds |
| `tpl_bmd_teranex_av` | Blackmagic Teranex AV | SDI / HDMI → SDI / HDMI, any-to-any | yes / yes | AC | 1 | 20 | 3 | Standards conversion; low-latency presenter switch |
| `tpl_decimator_mdhx` | Decimator MD-HX | 3G-SDI ↔ HDMI | yes / yes | USB / DC | 0 | 4 | 0.3 | Cross-converter with scaling; front-row utility box |
| `tpl_decimator_12g_cross` | Decimator 12G-CROSS | 12G-SDI ↔ HDMI 2.0 | yes / yes | USB / DC | 0 | 6 | 0.4 | 4K cross-converter |
| `tpl_bmd_da_12g` | Blackmagic Mini Converter SDI Distribution 12G | 12G-SDI → 8× 12G-SDI | — | DC 12 V | 0 | 6 | 0.7 | Reclocking DA |
| `tpl_aja_12gda` | AJA 12GDA | 12G-SDI → 4× 12G-SDI | — | DC 5 V | 0 | 6 | 0.5 | Reclocking DA |
| `tpl_bmd_optical_12g` | Blackmagic Mini Converter Optical Fiber 12G | 12G-SDI ↔ fiber-LC (SFP) | — | DC 12 V | 0 | 6 | 0.7 | Single-channel fibre |
| `tpl_bmd_studioconverter` | Blackmagic Studio Fiber Converter | SMPTE fibre ↔ SDI / return / talkback / tally (URSA Broadcast) | — | AC | 1 | 40 | 6 | Base station for URSA fibre |
| `tpl_smpte_fiber_reel` | SMPTE 311M hybrid fibre, 328 ft reel | fiber-SMPTE | — | — | 0 | 0 | 45 | Instantiates as a `fiber` device with `distance_ft = 328` |
| `tpl_tac12_fiber` | 12-ch tactical fibre, 500 ft reel (opticalCON / LC) | fiber-LC | — | — | 0 | 0 | 30 | Trunk for FiDO / Brompton 10G runs |
| `tpl_netgear_m4250` | Netgear M4250-26G4XF-PoE+ | cat6 × 24 PoE+, 4× SFP+ | — | AC | 1 | 60 (+PoE budget) | 9 | Control / media switch; Signal network slice |

Shelf-mounted converters are seeded with `ru: 0` and placed on a `shelf` template inside Rack Build, which counts them against the shelf's `depth_in`, not the rack's RU. Every converter carries `AC-in` or `DC-in` so Rack's PDU outlet count includes wall-wart loads.
## Common endpoints
Switchers, routers, recorders, servers, monitors, and power. These are the nodes Signal Flow draws links between and Rack Build stacks; the RU and power columns are what the rack rollups consume. Approximate planning values unless marked.
| templateId | Make / model | Class | Key spec | I/O seeded | RU | W | lb |
| `tpl_ross_carbonite_ultra` | Ross Carbonite Ultra | switcher | 2 ME (up to 5 MiniME), 1080p / UHD | 24× 12G-SDI in, 14× 12G-SDI out, multiview, tally, cat6 | 2 | 150 | 18 |
| `tpl_ross_ultrix_fr1` | Ross Ultrix FR1 | router | 36×36 12G-SDI, software-defined, optional Acuity/Carbonite inside | 36 in, 36 out, cat6 | 1 | 120 | 15 |
| `tpl_bmd_atem_constellation_8k` | Blackmagic ATEM Constellation 8K | switcher | 4 ME, 40× 12G-SDI in, 24 out | 40 in, 24 out, 4 multiview, cat6 | 2 | 110 | 13 |
| `tpl_bmd_atem_4me_constellation_4k` | Blackmagic ATEM 4 M/E Constellation 4K | switcher | 4 ME, 40× 12G-SDI in, 24 out, 4 multiview | as above | 2 | 110 | 13 |
| `tpl_bmd_videohub_40x40_12g` | Blackmagic Smart Videohub 40×40 12G | router | 40×40 12G-SDI | 40 in, 40 out, cat6 | 2 | 60 | 10 |
| `tpl_bmd_hyperdeck_4kpro` | Blackmagic HyperDeck Studio 4K Pro | recorder | 1 ch 12G-SDI / HDMI, ProRes / DNx / H.264 / H.265, 2× SSD + SD | 12G-SDI in, 12G-SDI out, HDMI out, LTC, cat6 | 1 | 25 | 6 |
| `tpl_bmd_hyperdeck_extreme_8k` | Blackmagic HyperDeck Extreme 8K HDR | recorder | 8K / 4K, CFast, H.265 | 12G-SDI in/out × 4, HDMI, LTC, cat6 | 3 | 60 | 14 |
| `tpl_disguise_vx2` | disguise vx 2 | server | 4× DP 1.2 outputs to 4K60, 4× 12G-SDI capture optional, genlock, LTC | 4× DP1.4 out, 4× 12G-SDI in, genlock, LTC, cat6 | 4 | 800 | 45 |
| `tpl_disguise_vx4` | disguise vx 4 | server | 4× DP 1.4 outputs to 4K60 10-bit, 4× 12G-SDI capture | as vx 2, higher output depth | 4 | 1000 | 55 |
| `tpl_resolume_server` | Resolume Arena server (custom build, 4× DP) | server | 4× DP 1.4 4K60, 1× 12G-SDI capture (Decklink) | 4× DP1.4 out, 12G-SDI in, cat6 | 4 | 700 | 40 |
| `tpl_hippo_boreal_plus` | Green Hippo Hippotizer Boreal+ MK2 | server | 4× DP 1.2 4K outputs, 2× 12G-SDI in | 4× DP1.2 out, 2× 12G-SDI in, genlock, LTC, cat6 | 3 | 600 | 35 |
| `tpl_pixera_two` | AV Stumpfl PIXERA two | server | 4× DP 1.4 4K60, capture optional | 4× DP1.4 out, cat6 | 3 | 650 | 40 |
| `tpl_bmd_decklink_8k` | Blackmagic DeckLink 8K Pro | capture | 4× 12G-SDI in/out, PCIe | 4× 12G-SDI bidir | 0 | 25 | 1 |
| `tpl_evertz_5601` | Evertz 5601MSC master sync | tcGen | tri-level / black burst, LTC, NTP | 6× genlock out, LTC out, cat6 | 1 | 40 | 8 |
| `tpl_tvlogic_lum_181h` | TVLogic LUM-181H 18" 4K rack monitor | monitor | 12G-SDI, HDMI, quad-view | 2× 12G-SDI in, HDMI in | 8 | 60 | 15 |
| `tpl_bmd_smartview_4k` | Blackmagic SmartView 4K G3 | monitor | 15.6" 12G-SDI rack monitor | 2× 12G-SDI in, cat6 | 6 | 45 | 10 |
| `tpl_surgex_sx1120` | SurgeX SX-1120-RT | rackPdu | 20 A inlet, 9 outlets, surge + filtering | AC-in ×1, AC-out ×9 | 1 | 0 | 8 |
| `tpl_apc_ap7900b` | APC AP7900B switched PDU | rackPdu | 20 A, 8 outlets, metered, network switched | AC-in ×1, AC-out ×8, cat6 | 1 | 0 | 6 |
| `tpl_apc_smt1500rm` | APC Smart-UPS SMT1500RM2U | ups | 1500 VA / 1000 W, ~8 min at 60% load | AC-in ×1, AC-out ×6 | 2 | 30 (losses) | 60 |
| `tpl_motionlabs_200a` | Motion Labs 200 A 3Ø distro, cam-lok in | distro | 200 A 3Ø in; 6× L21-30, 12× L5-20 / Edison | AC-in cam-lok ×5, AC-out per outlet | 0 | 0 | 180 |
| `tpl_motionlabs_400a` | Motion Labs 400 A 3Ø distro, cam-lok in | distro | 400 A 3Ø in; 12× L21-30, 24× L5-20 | as above | 0 | 0 | 320 |

Server templates seed `spec.timecode = LTC` and `spec.genlock = true`; Media Servers raises a `warn` check if a show has a server with genlock but no `tcGen` device. Distros seed one `ckt_` per 3Ø leg per L21-30 outlet so LED Map can assign tiles the moment the distro is placed.
## Library file, versioning, and consumption
The library ships as `device-library.json` inside the app and is loaded by the shell at boot; shows never embed it. A user-level overlay file holds Fuse-specific additions and I-Code mappings so a library update does not overwrite them.
```json
{
  "libraryVersion": "2026.10.1",
  "schemaVersion": "1.0.0",
  "templates": [ { "templateId": "tpl_roe_cb5", "class": "tile", "make": "ROE Visual", "model": "Carbon CB5", "aliases": ["CB5", "ROE CB5", "Carbon 5"],
                   "ru": 0, "powerW": 0, "weightLb": 30.53, "ports": [ { "name": "DATA", "type": "etherCon", "dir": "bidir", "count": 2 }, { "name": "PWR", "type": "AC-in", "dir": "in", "count": 2 } ],
                   "spec": { "pitch_mm": 5.77, "w_mm": 600, "h_mm": 1200, "d_mm": 77, "px_w": 104, "px_h": 208, "maxW": 500, "avgW": 250, "nits": 6000, "ip": "outdoor", "curve": { "concave": 15, "convex": 10 }, "protocol": "Brompton", "transparency_pct": 0 },
                   "inventory": { "iCodes": [], "caseModel": "ROE CB5 dolly (8)", "caseWeightLb": 0 },
                   "source": "manufacturer", "verifiedAt": "2026-10-30" } ],
  "overlayPath": "device-library.fuse.json"
}
```
Rules:
- `libraryVersion` is `YYYY.MM.n`. A show records `meta.libraryVersion` at create and on every instantiate, so a device's origin is traceable.
- Updating the library never mutates a show. When a template a show uses has changed (compared by `templateId` + a content hash), the shell offers **Review library updates** listing the changed fields per device; accepting writes a normal `patch` under `reason = "library:update"`.
- The overlay (`device-library.fuse.json`) uses the same shape and is merged on `templateId`: overlay fields win, `inventory.iCodes` arrays are unioned. New templates in the overlay are allowed; deleting a base template is not (set `deprecated: true` instead so existing shows still resolve).
- RentalWorks matching: the Order Intelligence import tries `inventory.iCodes` first, then `aliases` against the line description, then make + model. A hit under a deprecated template still instantiates and files an `info` check.
- Every `approximate` row in this tab is a `source: approximate` template; the LED Map and Rack modules show a small "≈" badge beside derived power and weight whenever any contributing device is approximate, so a planning total is never mistaken for a verified one.
- Modules consume the library only through `shell.library.find({ class, protocol, make, text })` and `instantiate()`; no module reads the JSON file directly, which keeps the overlay merge in one place.
Sources checked for this seed: Brompton SX40 datasheet, Brompton S4 datasheet, ROE Carbon brochure, Jul 2024, ROE Vanish V8T brochure, Jun 2024, ROE Vanish specifications, Dec 2022, NovaStar MX40 Pro spec summary, NovaStar MX40 Pro weight and power.