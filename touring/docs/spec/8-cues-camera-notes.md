# Show-day cues and camera notes
2026-10-30 · @David Bergfeld
The setlist is the spine of show day. Every cue and camera note hangs on a song and a camera the record already knows, so the same notes a director types at rehearsal are what the operators read at show time, filtered to their camera and current to the last edit.
## Show mode at a glance
[embed: director screen, Show mode · current song, cue stack, camera strip, status, next song]
Everything on screen is read from `show.*` and the record: the camera tiles are the roster joined to this song's notes, the status column is the song's look and wall state plus live record status, and the highlighted cue is the next thing the director calls.
## Scope and the three moments
This is a sixth module, **Show Book** (`show`), owned by the Video Director. It holds the setlist, the cues the video department executes against it, and the notes each camera operator needs per song. It is the only module whose main use is during the show, so it is built for a dark room, a 15-inch screen, and one hand.
| Moment | Who | Device | What they do | What must be true |
| **Build** (advance / prep) | Video Director, Server Op | desktop | enter or import the setlist; attach cue intents, server content, and first-pass camera notes | cameras and servers exist in the record so notes bind to real ids |
| **Rehearsal** | Video Director at the switcher, operators on cameras | desktop + mobile | run the setlist in order, add and edit notes live, mark cues hit / missed / cut, capture timing | edits are instant on every operator's phone; nothing requires leaving the running view |
| **Show** | same | desktop (director), mobile (operators), printed card fallback | read; director advances songs; operators see their camera's notes for the current and next song | notes are frozen except by the director; the view survives Wi-Fi loss with the last synced setlist |

What it is not: a switcher cue-stack or a timecode-driven playback controller. Cues here are human-readable intentions ("wide on downbeat", "server to Look 4 on chorus", "cut to drums at bar 33") that a director calls and operators read. Where a cue maps to a device action the record knows (a server look, a HyperDeck record start), the cue carries that reference so a later integration can fire it, but the workflow does not depend on it.
## Data model
The setlist orders songs; songs hold cues and camera notes; every cue and note binds to an entity the record already has. A note about "CAM 3" is a note about `dev_cam3`, so renaming or re-numbering the camera renames the note's header, and a camera with no notes is visible as a gap.
```ts
show: {
  setlists: Setlist[];           // usually one; festivals or multi-night runs may hold several
  activeSetlistId: string | null;
  cameraRoster: CameraSlot[];    // which camera devices are operated and by whom, per show
  runLog: RunEvent[];            // rehearsal and show timing, append-only
}

interface Setlist { id: string; name: string; version: number; source: 'manual' | 'import' | 'copy'; songs: Song[]; setChanges: SetChange[] }

interface Song { id: string; order: number; title: string; durationSec?: number; bpm?: number; key?: string; tag?: 'opener' | 'ballad' | 'uptempo' | 'acoustic' | 'encore' | 'walk-on' | 'walk-off' | 'interstitial';
                 lookRef?: { serverId: string; lookName: string };     // what the servers play for this song
                 wallState?: { wallId: string; note: string }[];        // 'US Wall: live IMAG' / 'IMAG L/R: black'
                 cues: Cue[]; cameraNotes: CameraNote[]; directorNote?: string; flags: Flag[] }

interface Cue { id: string; order: number; at: string;                // 'intro' | 'verse 2' | 'bar 33' | '2:14' — free text, human-timed
                call: string;                                           // what the director says
                kind: 'camera' | 'server' | 'record' | 'wall' | 'lighting-sync' | 'safety' | 'other';
                target?: string;                                        // dev_, srv_, wall_ id when the cue is about a device
                action?: { type: 'look' | 'record-start' | 'record-stop' | 'blackout' | 'cue-ref'; ref: string };  // optional machine hook
                status?: 'hit' | 'missed' | 'cut' | null;               // per rehearsal / show run, stored in runLog, mirrored here for the active run
              }

interface CameraNote { id: string; cameraId: string;                   // dev_ id of the camera
                       shot: string;                                   // 'tight on guitar, hold through solo'
                       lens?: string; move?: 'static' | 'push' | 'pull' | 'pan' | 'track' | 'handheld';
                       priority: 'primary' | 'cover' | 'safety';       // what the director will likely take vs insurance
                       timing?: string;                                // 'from verse 2' | 'whole song'
                       warning?: string;                               // 'pyro SL at 3:10 — stay off the apron'
                       authored: { by: string; at: string; during: 'build' | 'rehearsal' | 'show' } }

interface CameraSlot { cameraId: string; operator: string; position: string; comms: string; active: boolean }   // operator = crew role key or contact id
interface SetChange { afterSongId: string; durationSec: number; notes: string; cameraMoves: { cameraId: string; to: string }[] }
interface Flag { kind: 'pyro' | 'strobe' | 'confetti' | 'crowd' | 'quick-change' | 'audience-lights' | 'custom'; at?: string; note: string }
interface RunEvent { at: string; run: 'rehearsal-1' | 'rehearsal-2' | 'show'; songId: string; event: 'start' | 'end' | 'cue' | 'note'; cueId?: string; status?: 'hit' | 'missed' | 'cut'; by: string; note?: string }
```
Bindings and what they buy:
- `cameraId` → `devices[]` of class `camera`: the camera roster is the Signal module's camera list, so a camera added to the system shows up as an empty column in the notes grid and a camera cut from the order removes its notes with a warning.
- `lookRef.serverId` → `servers.hosts[]`: Media Servers lists each song's look name beside its content spec so the content team and the director see one list.
- `wallState.wallId` → `led.walls[]`: a song that sends a wall to black or to live IMAG is readable from LED Map too.
- `cue.target` and `cue.action.ref` → any device: a `record-start` cue on `dev_hd1` is what the HyperDeck SOP would fire; the workflow stores the intent now and leaves the trigger to a later integration.
- `operator` → crew role or contact: operator views filter on it, and a roster change at call time re-routes the notes without editing them.
## Build mode
Build is a grid: songs down, cameras across, with a cue column on the left. It is designed so a setlist from management and a director's first pass of notes go in within an hour, before anyone is in the room.
| Step | Action | Writes |
| 1 | **Import setlist** from pasted text (one title per line, optional `— 3:45` duration), a CSV / sheet (title, duration, bpm, key, tag), or **Copy from show** (same tour) | `show.setlists[0].songs[]`, `source` |
| 2 | **Confirm roster**: the camera list from Signal appears pre-ticked; untick unused cameras, assign operator role and position | `show.cameraRoster[]` |
| 3 | **Looks and walls**: per song, pick the server look name (free text or from a pasted look list) and any wall state | `songs[].lookRef`, `songs[].wallState` |
| 4 | **Camera notes**: click a cell (song × camera), type the shot, set priority; tab moves across cameras, enter moves to the next song | `songs[].cameraNotes[]` |
| 5 | **Cues**: add cues per song with `at` and `call`; kind inferred from words ("server", "record", "black") and editable | `songs[].cues[]` |
| 6 | **Flags and set changes**: pyro, strobe, quick-change, audience lights; set-change durations and camera moves between songs | `songs[].flags`, `setlist.setChanges` |
| 7 | **Version**: Save marks `setlist.version + 1`; previous version kept in `revisions` on issue | `version` |

Grid conventions: a `primary` note is bold, `cover` regular, `safety` muted; an empty cell on an active camera is a visible gap, not blank; cells show the first line only, full text on focus. Bulk tools: fill a camera's column with one shot across a tag ("all ballads: CAM 2 tight on vocal"), copy a song's notes to another song, shift all songs after a point when management inserts a title.
Import tolerance: titles are matched case-insensitively against the tour's previous setlists so notes carry over when the same song returns (`Copy notes from last show` per song), and unmatched titles are flagged as new. Walk-on, interstitials, and encore are ordinary songs with tags so cues and notes attach to them too.
## Rehearsal mode
Rehearsal runs the setlist as a live list and turns the director's reactions into notes without stopping. The screen is the show-mode layout (below) with editing on; every change writes immediately and reaches operators' phones within a second on the show network.
Director controls, all one key or one tap:
- **Start / next / back** advances the current song and logs `runLog` start/end with wall-clock time, so song durations are measured rather than typed.
- **Note to camera n** (`1`–`9`, then type, enter): adds or amends that camera's note for the current song, `authored.during = rehearsal`. Operators see the change highlighted for 10 seconds.
- **Cue hit / missed / cut** (`h` / `m` / `x` on the highlighted cue): writes `status` for this run and advances to the next cue.
- **Quick cue** (`c`, type the call, enter): inserts a cue at the current moment with `at` = elapsed time in the song.
- **Flag** (`f`): drops a flag at the elapsed time with a one-word kind.
- **Hold** pauses the clock for a stop-and-fix without losing the position.

Operator view during rehearsal: own camera's notes for current and next song, large type; a **⚑** button posts a one-line note back ("can't see drums from here on this one") that lands as a `cover`-priority note tagged with the operator and flagged for the director to accept or edit. Operators do not edit the director's notes.
After the run, **Rehearsal review** lists cues `missed` or `cut`, songs with no `primary` note on any camera, songs with notes on cameras marked `active: false`, and measured durations against typed ones; each row opens the song in Build. Accepting the review bumps `setlist.version` and clears per-run statuses so the show starts clean while `runLog` keeps the history.
## Show mode
Show mode is rehearsal mode with editing reduced to what a director changes mid-set and with every screen sized for distance and darkness.
**Director screen** (desktop or tablet at the switcher): current song large, elapsed and expected duration, the next cue highlighted with the following two visible, the camera strip (one tile per active camera: number, operator, primary shot for this song), server look and wall state for the current song, record status, and the next song's title and first cue. Keys: next / back song, cue hit / missed, quick note to a camera, and **Skip song** (management cut it) which logs the skip and shifts the list. Nothing else is editable; Build is a separate view.
**Operator screen** (phone, one hand): camera number and operator name, current song title, this camera's notes for the song in large type with `primary` first, any `warning` in a red band, the next song's first note in smaller type below, and a count of cues remaining in the song. Swipe reveals the full setlist with this camera's note per song. The ⚑ button posts a one-line note as in rehearsal. No other editing.
**Freeze and change rules:** at `lockShow()` the active setlist is frozen for everyone except the director's quick-note and skip actions, each logged in `runLog` with `during = show`. A show-time edit is shown to operators with a highlight and a soft chime; the previous text stays visible for one song so a mid-set change is never a silent swap.
**Offline:** both screens cache the active setlist, roster, and notes on open and on every change. If the show network drops, the screen keeps working from cache with an "offline since 20:14" badge; the director's next/back and cue statuses queue locally and sync when the link returns. Operators never block on connectivity; a stale cache is still the last version they saw at rehearsal.
**Fallback:** the camera card export (below) is printed at line check and clipped to each camera, so the paper copy is the same content as the phone.
## Outputs
All outputs are Binder `auto` exports from `show.*`, generated per setlist version; the footer carries `showCode · setlist v<n> · printed <time>` so a stale card is recognisable.
| Export | For | Rows / layout | Filter |
| **Camera card** | each operator | one page per camera: song order, this camera's shot, move, timing, warning; flags for the song in the margin | `cameraId` from the roster; one file per active camera, or all cameras in one PDF |
| **Director book** | Video Director | one page per song: cues in order with `at` and call, camera strip with every camera's primary shot, look and wall state, flags, set change into the next song | none |
| **Operator strip** | tape-on strip for CCU or shader positions | one line per song: title, look, wall state, record cue | role = shader / server op |
| **Set-change sheet** | camera and stage crew | one row per set change: after song, duration, camera moves, notes | none |
| **Server look list** | content team / server op | one row per song: title, server, look name, wall state | sorted by server |
| **Record log** | post / archive | one row per `record-start` and `record-stop` cue with run times from `runLog` | run = show |
| **Run report** | Video Director, PM | measured song durations vs typed, cues missed or cut, notes added at show time, skipped songs | run = show or a rehearsal |

The Binder's `cameras` section embeds the camera card set, and a new `show-book` section embeds the director book; both are `required: false` so a rehearsal-only show is not blocked by them. Camera cards and the director book are also the two things mobile can render offline as PDFs, so a dead venue network still produces paper from any phone that has the cache.
## Record additions, ownership, and lifecycle
**Slice**: `show` as defined above, owned by the Show Book module (`show`). It reads `devices[]` (cameras), `servers.hosts[]`, `led.walls[]`, and `crew`; it writes only `/show/*`. Operators' ⚑ notes are written under the `mobile` writer into `cameraNotes[]` with `priority = cover` and `authored.by` = the operator, which is the one place mobile adds content rather than status.
**Module contract** (`ModuleContract` fields):
- `owns: ['/show']`, `reads: ['/devices', '/servers/hosts', '/led/walls', '/crew', '/binder/schedule']`
- `seed()`: one empty setlist named from `event.dates[0]`, `cameraRoster` from every `camera` device with `active: true`, operator from `crew.cameraLead` for CAM 1 and blank otherwise.
- `derive()`: `derived.show = { songsWithoutPrimary[], camerasWithoutNotes[], cuesByKind, measuredDurations, totalRunSec }`.
- `validate()`: `SHW-001` camera note on an inactive or removed camera (warn); `SHW-002` song with no primary note on any active camera (info, warn once the show is `locked`); `SHW-003` `record-start` cue with no matching `record-stop` (warn); `SHW-004` look reference to a server with `role = backup` only (info); `SHW-005` cue `action.ref` to a device not in the record (block).
- `exports[]`: camera card, director book, operator strip, set-change sheet, server look list, record log, run report.

**Lifecycle behaviour** differs from other modules because the show slice is most active after the record is otherwise frozen:
| Show status | `/show/*` writes allowed | Why |
| `draft`, `issued` | all, by the `show` module and mobile ⚑ notes | setlist work runs in parallel with the advance and is not part of the issued revision gate |
| `locked` | director quick notes, cue statuses, skip song, `runLog` appends; mobile ⚑ notes | show-time changes must land; structural edits (reorder, add song) require **Unfreeze setlist**, which is logged like `unlockShow()` |
| `archived` | none | `runLog` and the final setlist version become the tour's reference for the next show's **Copy from show** |

The `E_FROZEN` rule on the first tab gains one clause: paths under `/show/` follow the table above instead of the general rule. `issueShow()` snapshots the active setlist version into `revisions[N].setlist` but does not require it to be complete.
**Tour carry-over**: `copyShow()` within a `tourId` copies the setlist with notes and cues, re-binding `cameraId` by camera label (CAM 3 → CAM 3) and clearing `runLog` and statuses, so night two starts from night one's book. Where a label has no match (the new show has no CAM 7), its notes are kept under an `unbound` list and surfaced as `SHW-001` until reassigned or deleted.
Add to the first tab: `show` as the sixth row of the ownership matrix (owns `/show/*`, reads devices / servers / led / crew / schedule), and `modules/show-book/` to the implementation checklist after the Show Binder port, with `fixtures/setlist-arena.json` (14 songs, 6 cameras, 2 servers) and a test that a ⚑ note from mobile lands as `cover` on the right camera and song.
