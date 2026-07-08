# OnCue: Advance — Phase 1

A touring production advance-management workspace for live concert/touring video departments. Phase 1 delivers the app shell, core data model, tour stop dashboard, and editable advance forms for a Video Director / Crew Chief prepping each tour stop.

## Stack

- **Client**: React 18 + TypeScript + Vite + Tailwind CSS + React Router
- **Server**: Node + Express + TypeScript, backed by a flat JSON file (`server/data/db.json`)
- No database, auth, or file storage yet — intentional for Phase 1 (see "Assumptions" below)

## Project Structure

```
oncue-advance/
├── server/                     # Express API — JSON-file-backed REST layer
│   ├── src/
│   │   ├── data/seed.ts        # Seed tour + 4 tour stops (varying advance states)
│   │   ├── types/index.ts      # Shared data model (mirrors client/src/types)
│   │   ├── db.ts                # Read/write/reset the JSON store
│   │   └── index.ts             # Express app + routes
│   └── data/db.json             # Generated at runtime from seed.ts (gitignored)
│
├── client/                     # React app
│   └── src/
│       ├── types/index.ts       # Core TypeScript data model
│       ├── api/client.ts        # Fetch wrapper for the Express API
│       ├── context/TourContext.tsx   # Global state: tour stops, selection, edits, debounced save
│       ├── utils/
│       │   ├── completion.ts    # Per-section + overall completion %, missing-item detection
│       │   ├── status.ts        # Status color/label helpers, status rollup
│       │   └── format.ts        # Date formatting, local id generation
│       ├── components/
│       │   ├── layout/          # AppShell, Sidebar, Header, AdvanceStatusPanel
│       │   └── ui/               # Card, StatusBadge, StatusSelect, Field inputs, icons, etc.
│       └── pages/                # Dashboard, TourStops, VenueInfo, Schedule, VideoPackage,
│                                  # Labor, Power, Rigging, Signal, Documents, Notes, Settings
│
└── package.json                 # Root convenience scripts (runs both apps together)
```

## Setup

Requires Node 18+.

```bash
# from the repo root
npm run install:all   # installs server + client dependencies

npm run dev            # runs the API (port 4000) and the client (port 5173) together
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api/*` to the Express server, so no CORS configuration is needed in development.

To run them separately:

```bash
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

Production build (typechecks + builds both):

```bash
npm run build
```

### Resetting demo data

Edits are written to `server/data/db.json` (created on first run from `server/src/data/seed.ts`). Use the **Reset to Seed Data** button on the Settings page, or delete `server/data/db.json` and restart the server, to return to the original seed.

## Data Model

Defined once in `client/src/types/index.ts` and mirrored in `server/src/types/index.ts` (the server treats the file as an opaque JSON document, so it doesn't need the client's build tooling — see Assumptions). Core types:

- `Tour` — top-level tour metadata (artist, name, season)
- `TourStop` — one stop on the tour; owns a `Venue`, `ScheduleItem[]`, `VideoPackageItem[]`, `LaborPlan`, `PowerAdvance`, `RiggingAdvance`, `SignalAdvance`, `DocumentItem[]`, and `AdvanceNote[]`
- `Status` — the universal confirmation state: `"confirmed" | "needs-review" | "missing" | "not-started"` (green / yellow / red / gray)
- `SignalLine` — modeled as a flat list (`category`, `source`, `destination`, `status`) rather than a single blob, so a Phase 2 node-based routing graph can consume the same records as graph edges without a data migration

## Completion & Blocker Logic

`client/src/utils/completion.ts` computes, per tour stop:

- A completion percentage for each of 8 sections (Venue, Schedule, Video Package, Labor, Power, Rigging, Signal, Documents) — based on required fields filled or line items marked `confirmed`
- An overall advance completion percentage — the equal-weighted average of all 8 section percentages
- A list of human-readable **missing critical items** (blockers) surfaced on the Dashboard and in the right-hand Advance Status panel

This logic is pure and framework-agnostic, so it's covered implicitly by exercising the UI — there's no hidden state it depends on beyond the `TourStop` object.

## State Management

`TourContext` (`client/src/context/TourContext.tsx`) holds the loaded tour + all tour stops and the currently selected stop. Edits:

1. Apply to local state immediately (optimistic, so typing feels instant and edits are preserved across page navigation within the session)
2. Persist to the API on a 600ms debounce per tour stop, so rapid edits don't flood the network

If the API call fails, the optimistic local edit is kept (not lost) but won't survive a server restart — acceptable for a Phase 1 prototype.

## Assumptions Made

- **Single tour, single user, no auth.** Phase 1 is a prototype for one video department working one tour; there's no login, no multi-tenant isolation, no permissions model.
- **JSON file instead of a real database.** `server/data/db.json` is the entire persistence layer. It's swappable for Supabase/Postgres later because the server only touches it through `db.ts` (`readDb`/`writeDb`) — the REST contract (`GET /api/data`, `PUT /api/tourstops/:id`) doesn't need to change.
- **Types are duplicated, not shared via a package.** `client/src/types` and `server/src/types` are identical copies today. The server doesn't validate against them at runtime — it's a flat pass-through store. Phase 2 should extract a shared `packages/types` workspace (or generate server-side validation from the same source) once there's real persistence to validate against.
- **`PUT /api/tourstops/:id` replaces the whole tour stop.** Simpler than partial PATCH semantics for a Phase 1 prototype; the client always sends a full, locally-updated `TourStop` object.
- **Document and file upload are placeholder-only**, as specified — the Documents page tracks a status enum (`uploaded` / `not-uploaded` / `not-applicable`) and notes, with a disabled "Upload" button, no actual file handling.
- **Signal is a flat, editable list of routed lines**, not a canvas/graph — deliberately structured (`SignalLine[]` with `source`/`destination`) so Phase 2 can lay these out as node-graph edges without changing the underlying records.
- **"Critical" fields/documents are opinionated defaults** (e.g., Venue Packet, Rigging Plot, Stage Plot, Power Plot, and Labor Sheet are treated as blocking documents; the others are tracked but not blocking). These thresholds live in `client/src/utils/completion.ts` and are easy to retune.
- **Desktop-first, not fully responsive.** The app shell assumes a minimum ~1024px viewport (matches the "responsive desktop-first" requirement, not a mobile-first one) — this is a crew-chief-at-a-laptop tool, not a phone app.
- **Seed data is fictional** (artist "Nova Sterling," fictional venue contacts) to avoid implying any real tour, artist, or venue relationship, while still using accurate touring video terminology and realistic gear (ATEM Constellation, Disguise, Brompton, ROE, Panasonic UC4000/UE-150, etc.).

## What's Structured for Later Phases

- **Supabase / Postgres**: swap `db.ts` for a real client; the REST contract and `TourStop` shape don't need to change.
- **File uploads**: `DocumentItem` already has a `status` field distinct from a future `fileUrl`; the Documents page's disabled upload button is the intended attachment point.
- **PDF generation**: the `TourStop` object is already a single, complete, serializable advance — a print/export view can consume it directly.
- **AI advance assistant**: `missingCriticalItems()` already produces a structured blocker list; that's a natural prompt-context source.
- **Node-based signal/routing graph**: `SignalLine[]` records map 1:1 onto graph edges (`source` → `destination`) today.
- **Validation engine**: completion logic is centralized in `utils/completion.ts` — a stricter schema-based validator can sit alongside or replace it without touching the pages.
- **Slack/email + vendor/venue contact automation**: `Contact` is a normalized shape (`name`, `role`, `email`, `phone`) reused across `Venue`, `PowerAdvance`, and `RiggingAdvance` — a good integration seam.
