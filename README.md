# OnCue: Advance

A touring production advance-management workspace for live concert/touring video departments.

- **Phase 1** delivered the app shell, a flat per-stop data model, and editable advance forms backed by a JSON file.
- **Phase 2** (this pass) replaces that with a real relational core (PostgreSQL + Prisma) and adds three operational modules — **Requirement Matrix**, **Issue Tracking**, and **Advance Timeline** — plus an **AI Service Layer** with one live-wired service (**Risk Engine**).

Phase 2 was scoped deliberately: the full spec behind it describes a multi-month enterprise platform (12 modules, 8+ AI services, a rules engine with admin UI, CAD/drawing parsing, vendor/travel/communication-hub integrations, React Flow/AG Grid/TipTap, Redis, Supabase Auth, multi-format document export). Building all of that in one pass would mean a pile of shallow stubs. Instead, this pass builds a smaller set of things for real — see **"What's Deferred"** below for the explicit list and why.

## Stack

- **Client**: React 18 + TypeScript + Vite + Tailwind CSS + React Router
- **Server**: Node + Express + TypeScript + **Prisma** ORM
- **Database**: **PostgreSQL** (26 relational models — see `server/prisma/schema.prisma`)
- **AI**: Anthropic API via a dedicated service layer (`server/src/services/ai/`) — never called directly from routes or UI

## Project Structure

```
oncue-advance/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma        # The relational core — 26 models, see below
│   │   ├── migrations/          # Prisma migration history
│   │   └── seed.ts              # Seeds 1 tour, 4 venues, 4 shows at different advance stages
│   ├── src/
│   │   ├── prisma.ts            # PrismaClient singleton
│   │   ├── audit.ts             # Writes AuditLog rows on create/update/delete
│   │   ├── middleware/actor.ts  # Dev-mode "acting as" identity (see Assumptions)
│   │   ├── routes/              # core (tour/venue/show), requirements, issues, timeline,
│   │   │                        # schedule, documents, notes, collab (comments/attachments/
│   │   │                        # tags/audit-log), ai
│   │   ├── services/ai/
│   │   │   ├── AIService.ts     # Anthropic client wrapper + structured-JSON call helper
│   │   │   ├── types.ts         # Contracts for all 8 planned AI services
│   │   │   └── RiskEngine.ts    # The one service implemented and wired to a live model
│   │   └── index.ts             # Express app
│   └── .env                     # DATABASE_URL, ANTHROPIC_API_KEY (gitignored; see .env.example)
│
├── client/
│   └── src/
│       ├── types/index.ts       # Mirrors the API's response shapes (see server/prisma/schema.prisma)
│       ├── api/client.ts        # Fetch wrapper — attaches x-user-id, typed per-endpoint calls
│       ├── context/
│       │   ├── UserContext.tsx  # Dev-mode "acting as" user picker (see Assumptions)
│       │   └── ShowContext.tsx  # Loaded shows, selected show, refetch-after-write
│       ├── utils/
│       │   ├── completion.ts    # Deterministic completion % + missing-item detection
│       │   └── status.ts        # Status/department/priority/severity label + color maps
│       ├── components/
│       │   ├── layout/          # AppShell, Sidebar, Header, AdvanceStatusPanel
│       │   ├── collab/          # CommentThread, AttachmentList — reused by Requirements + Issues
│       │   └── ui/               # Card, StatusBadge, StatusSelect, Field inputs, icons, etc.
│       └── pages/                # Dashboard, Shows, VenueInfo, Schedule, RequirementMatrix,
│                                  # Issues, Timeline, Documents, Notes, Settings
│
└── package.json                  # Root convenience scripts (runs both apps together)
```

## Setup

Requires Node 18+ and a local PostgreSQL server.

```bash
# 1. Create a database + role (adjust to your local Postgres setup)
psql -c "CREATE ROLE oncue_app WITH LOGIN PASSWORD 'oncue_dev_local' CREATEDB;"
psql -c "CREATE DATABASE oncue_advance OWNER oncue_app;"

# 2. Install dependencies
npm run install:all

# 3. Configure the server
cp server/.env.example server/.env
# edit server/.env — set DATABASE_URL to match step 1, and optionally ANTHROPIC_API_KEY (see below)

# 4. Migrate + seed
cd server
npm run db:migrate   # applies prisma/migrations/
npm run db:seed      # seeds the tour/venues/shows (also runs automatically after db:reset)
cd ..

# 5. Run both apps together
npm run dev           # API on :4000, client on :5173
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api/*` to Express, so no CORS config is needed in development.

To run them separately: `npm run dev:server` / `npm run dev:client`. Production build (typechecks + builds both): `npm run build`.

### Resetting demo data

```bash
cd server && npm run db:reset
```

This drops and re-applies all migrations, then re-seeds from `prisma/seed.ts`. Unlike Phase 1's in-app "Reset" button, this is a deliberate CLI step now that there's real relational data to lose.

### Enabling live AI Risk Analysis

The Dashboard's **Run Risk Analysis** button calls a real Anthropic API request. Without a key it fails gracefully (503, with a clear message pointing back here) rather than crashing or faking a response. To enable it:

1. Set `ANTHROPIC_API_KEY=sk-ant-...` in `server/.env`
2. Restart the API server
3. Optionally set `ANTHROPIC_MODEL` (defaults to `claude-sonnet-5`)

Settings → **AI Risk Engine** shows live configuration status.

### Configuring Supabase Auth

Without a Supabase project configured, the app runs in **demo mode**: the header's "acting as" picker (same as Phase 1/2) stands in for sign-in, and the server trusts a `x-user-id` header. This needs zero setup and is what local dev uses by default.

To enable real authentication:

1. Create a Supabase project. Its Postgres connection string can also replace your local `DATABASE_URL` if you want a single source of truth (the schema is plain PostgreSQL — see "Assumptions Made"), or you can keep using local Postgres for data and Supabase only for Auth.
2. Server — add to `server/.env`:
   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   ```
3. Client — copy `client/.env.example` to `client/.env` and set:
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```
4. Restart both. The header/Settings picker is replaced by a sign-in screen; signing up/in with an email that matches a seeded `User.email` links to that existing record (and its role/`isAdmin`), otherwise a new `User` is auto-provisioned on first sign-in.

Note: for local Supabase projects, disable "Confirm email" (Authentication → Providers → Email) so `signUp` doesn't require inbound email delivery you likely haven't configured.

## The Relational Core

`server/prisma/schema.prisma` defines 26 models. Every core operational entity carries `id` (UUID), timestamps, `createdBy`/`updatedBy`, and participates in the generic relationship primitives:

- **Comment** — polymorphic (`entityType` + `entityId`), used for both threaded discussion on a Requirement/Issue *and*, when scoped to a Show with a `category`/`noteStatus` set, doubles as the Phase 1 "Advance Notes" module. One model, two use cases, documented in the schema.
- **Attachment** — polymorphic, metadata-only (no object storage wired up — see Deferred)
- **Tag** / **EntityTag** — polymorphic many-to-many tagging
- **AuditLog** — polymorphic, written by `server/src/audit.ts` on every create/update/delete of a core entity; readable via `GET /api/audit-log?entityType=&entityId=`
- **Contact** — a single polymorphic model for both Venue and Vendor contacts, rather than two near-identical tables

Domain models: `User`, `Tour`, `Venue`, `Show`, `Requirement`, `Task`, `Issue`, `TimelineStageDefinition` + `ShowTimelineEntry`, `ScheduleItem`, `Document`, `Vendor`, `Communication`, `Approval`, `Deliverable`, `CrewMember` + `CrewAssignment`, `Equipment`, `TravelLeg`, `HotelBooking`.

**Fully wired to UI this pass:** Tour, Venue, Show, Requirement, Issue, TimelineStageDefinition/ShowTimelineEntry, ScheduleItem, Document, Comment (as Notes), Comment/Attachment/Tag on Requirement + Issue.

**Modeled, not yet wired to UI:** Vendor, Communication, Approval, Deliverable, CrewMember/CrewAssignment, Equipment, TravelLeg, HotelBooking. These exist with real relations (a `Show` has `travelLegs`, `hotelBookings`, `crewAssignments`, etc.) so adding their pages later is additive, not a schema rework.

## The Requirement Matrix (replaces Phase 1's per-department pages)

Phase 1 had five bespoke pages — Video Package, Labor, Power, Rigging, Signal — each with a hand-rolled shape. Phase 2 generalizes this into one `Requirement` model (`department`, `name`, `status`, `owner`, `priority`, `riskLevel`, `approvalStatus`, ...) spanning all nine spec departments (Video, Lighting, Audio, Rigging, Automation, Backline, Production, Merch, Transportation), rendered as one grouped, filterable matrix. The seed script ports Phase 1's Denver/Salt Lake City/Phoenix/Las Vegas requirement data into this shape so the four shows still demonstrate the full status spectrum (fully confirmed → blocked). Power-related items live under the `PRODUCTION` department, since the spec's department enum doesn't include "Power" as its own department.

## The AI Service Layer

`server/src/services/ai/` — routes and UI never call the Anthropic API directly.

- **`AIService.ts`** — the shared client wrapper: sends a system + user prompt, requires a single JSON object back, parses it. Throws `AIServiceNotConfiguredError` if no key is set, `AIServiceParseError` if the model doesn't return valid JSON.
- **`types.ts`** — TypeScript contracts for all 8 services named in the spec (RiskEngine, PacketAnalyzer, PacketComparison/DependencyEngine, EmailGenerator, SummaryGenerator, RequirementsExtractor, DrawingAnalyzer, DocumentParser). Only `RiskEngineResult` is implemented; the rest are real interfaces, not mocked function bodies — a fake "AI" response that never calls a model would be more misleading than an honestly-unimplemented contract.
- **`RiskEngine.ts`** — the one implemented service, wired to `POST /api/shows/:id/risk-analysis`.

**Design choice worth calling out:** RiskEngine does *not* ask the model to compute completion percentages. Department health (`X/Y requirements confirmed`) is computed deterministically in code — that's exact arithmetic, and LLMs are the wrong tool for it. The model is given that computed data as context and asked to do the part judgment is actually good at: assigning a risk score that weighs severity + dependencies + days-until-show together, prioritizing recommendations, and drafting venue/vendor questions. The system prompt explicitly instructs it not to fabricate venue details or requirements beyond what's provided, and the response includes a self-reported `confidence` score — this maps directly to the spec's "AI Operational Rules" (validate data → identify missing information → calculate risk → recommend → return confidence, never assume/fabricate).

## Completion & Blocker Logic

Two layers, intentionally:

- **`client/src/utils/completion.ts`** — deterministic, instant, no AI call. Computes per-department requirement completion, schedule/document completion, and a `missingCriticalItems()` list. Powers the Dashboard summary cards and the right-hand Advance Status panel without waiting on anything.
- **`server/src/services/ai/RiskEngine.ts`** — judgment layer on top of the same category of data (recomputed server-side against the live DB), adds a risk score, recommendations, and suggested questions.

## State Management

- **`UserContext`** — dual-mode identity provider (Phase 3). If `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (server) and `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (client) are set, it wraps real Supabase Auth sessions: sign-in/sign-up (`pages/SignIn.tsx`), `supabase.auth.onAuthStateChange`, and the session's access token sent as `Authorization: Bearer <token>` on every request. If unset, it falls back to the Phase 1/2 demo mode — a dev "acting as" picker (persisted to `localStorage`) that sends the picked user's id as a trusted `x-user-id` header instead. Either way, the server resolves a single `req.actorId` (`server/src/middleware/auth.ts`) and every route attributes `createdBy`/`updatedBy`/`AuditLog.actorId` to it — the write-attribution path doesn't change between modes. Non-GET `/api` requests are rejected with 401 if no actor resolves (`requireAuth`).
- **`ShowContext`** — loads the show list once, loads the *selected* show's full detail (all requirements/issues/timeline/schedule/documents/notes) on selection, and exposes `refreshSelectedShow()`. Mutations call `api.xxx(...)` then `refreshSelectedShow()` — a manual refetch-after-write model, not optimistic local patching or a cache library (TanStack Query was in the target stack but wasn't installed this pass — see Deferred). Text/textarea fields commit on blur rather than per-keystroke, since every keystroke would otherwise trigger a refetch.

## Assumptions Made

- **Supabase Auth, with a demo fallback.** Real sessions when a Supabase project is configured (see "Configuring Supabase Auth" below); otherwise the Phase 1/2 dev "acting as" picker + trusted `x-user-id` header, so local dev needs zero setup. `User.isAdmin` is the only authorization check today — it gates deleting another user's comment/attachment (`server/src/routes/collab.ts`); `User.role` remains a free-text job title (cosmetic, unrelated to permissions). Broader ownership/permission rules (e.g. on Requirement/Issue deletes) are intentionally not added — those entities don't have a reliable single owner yet.
- **Types are hand-mirrored, not shared via a package.** `client/src/types/index.ts` mirrors what the API actually returns (Prisma models + each endpoint's `include`), not the raw Prisma schema. A real monorepo tool (Turborepo, npm workspaces types package) would remove this duplication; skipped here to keep the two apps independently buildable without added tooling.
- **Refetch-after-write, not optimistic updates or websockets.** The spec says "everything updates in real time" — this pass does a manual refetch on every mutation (typically sub-100ms locally), not a websocket/SSE push. Multiple browser tabs won't see each other's edits without a manual refresh.
- **"Critical" documents/departments are opinionated defaults**, same as Phase 1 (Venue Packet, Rigging Plot, Stage Plot, Power Plot, Labor Sheet are blocking; others are tracked but not blocking) — see `CRITICAL_DOCUMENTS` in `client/src/utils/completion.ts`.
- **Local dev Postgres, not Supabase.** The schema is plain PostgreSQL via Prisma — pointing `DATABASE_URL` at a Supabase Postgres instance works unchanged; Supabase's *Auth* product is the separate, deferred piece.
- **Seed data is fictional** (artist "Nova Sterling," fictional venue contacts), reusing Phase 1's Denver/Salt Lake City/Phoenix/Las Vegas advance states so the new modules still demonstrate the full status spectrum.

## What's Deferred (and why)

Explicitly out of scope for this pass — each is a scoped, addable follow-up, not a redesign:

| Item | Status | Why deferred |
|---|---|---|
| File uploads | `Attachment`/`Document` are metadata-only | Needs an object storage decision (S3/Supabase Storage); UI already has the "Attach"/"Upload" buttons as disabled placeholders |
| Rules Engine (admin UI) | Not built | A configurable dependency-rule system with its own admin UI is a project-sized feature on its own; the Timeline page does show a soft (non-blocking) warning when a stage's predecessor isn't complete, as a taste of the concept |
| Node-based Signal/Routing graph | Not modeled | Requirement Matrix covers signal readiness at a checklist level (department-scoped requirements); a `SignalLine`-style graph model would need real design work on what "routing" means without a Phase 1 SDI/fiber-specific model to build from |
| Drawing Manager | Not built | Drawings are plain `Attachment` rows typed by `mimeType`; CAD/Vectorworks parsing needs a real parsing library decision |
| Vendor / Travel / Communication Hub UI | Schema only | `Vendor`, `TravelLeg`, `HotelBooking`, `Communication`, `Approval`, `Deliverable`, `CrewMember` tables exist and are relationally wired to `Show`, but have no pages |
| Document Generator | Not built | PDF/Excel/Markdown export of packets/summaries/risk reports — a real feature once there's more content worth exporting |
| Redis / real-time updates | Not used | Current model is refetch-after-write (see State Management); Redis would matter for caching/pub-sub at a scale this prototype doesn't have yet |
| React Flow / AG Grid / TipTap | Not installed | Timeline uses a plain vertical stepper instead of a dependency graph; Requirement Matrix uses plain HTML tables instead of AG Grid; Notes/descriptions use plain textareas instead of rich text — allswappable later without a data model change |
| 7 of 8 AI services | Contracts only (`services/ai/types.ts`) | PacketAnalyzer, DependencyEngine, EmailGenerator, SummaryGenerator, RequirementsExtractor, DrawingAnalyzer, DocumentParser have real TypeScript response shapes defined but no implementation — see "The AI Service Layer" above for why they're contracts, not mocks |

## What Phase 1 Had That Changed

- The five per-department pages (Video Package, Labor, Power, Rigging, Signal) are gone, replaced by the Requirement Matrix — see above.
- `TourStop` is now `Show`, and `Venue` is a standalone, reusable entity (not embedded in the stop) so a venue's history persists across tours.
- Status enum values changed from Phase 1's `"confirmed" | "needs-review" | ...` to Prisma's `"CONFIRMED" | "NEEDS_REVIEW" | ...` (uppercase, matching Prisma enum convention).
