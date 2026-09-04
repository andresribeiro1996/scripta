# Arena Tier Lists + Mural Proportional Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone tier lists under Arena (backend module, tabs, full-page editor, mural block becomes reference+renderer) plus proportional zoom for the mobile mural canvas.

**Architecture:** New `tierlists` backend module mirroring `murals` (opaque JSON document, owner-scoped CRUD, cross-module public getter for shared-mural resolution). Frontend: api/hooks pair, Arena tabs, editor page at `/dashboard/arena/tierlist/:id`, mural `tierlist` block payload reduced to `{tierlistId}` with a pure renderer fed by a threaded data map. Proportional zoom is a small independent frontend change.

**Tech Stack:** Fastify/TS/SQLite (backend), React 19/react-query/Tailwind (frontend), tsx --test (backend tests), oxlint/tsc.

**Spec:** `docs/superpowers/specs/2026-09-04-arena-tierlists-design.md` (feature) and the amendment in `docs/superpowers/specs/2026-09-04-mobile-mural-editor-design.md` (zoom).

## Global Constraints

- Frontend: `cd frontend && npm run typecheck && npm run lint` after every task; both must pass.
- Backend: `cd backend && npm run typecheck && npm test` after every backend task.
- `noUnusedLocals`/`noUnusedParameters` are ON (both packages) — every binding declared in a task is used in that task.
- No comments in code unless an edit site already has one that stays true.
- Mural `blocks` JSON: the `tierlist` payload becomes `{type:"tierlist", tierlistId}`; no other block type's payload changes. `GRID_COLUMNS`/`ROW_HEIGHT` semantics unchanged on desktop (scale 1).
- Start clean: no migration for embedded tier-list data.

---

### Task 1: Proportional zoom on touch (frontend)

**Files:**
- Modify: `frontend/src/components/murals/MuralCanvas.tsx`
- Modify (as needed): `frontend/src/components/murals/blocks/*.tsx` (rem→em sweep)

**Interfaces:**
- Produces: touch-branch `rowHeight = Math.max(1, Math.round(28 * scale))` with `scale = canvasWidth / 1200`; block inline `fontSize: style.fontSize * scale` on touch only; phone default zoom 2.

- [ ] **Step 1:** In `MuralCanvas.tsx`: change phone zoom default `1.5` → `2`. Add `const scale = canvasWidth / 1200;` after `canvasWidth`. Make `gridProps.rowHeight` conditional: `rowHeight: touchMode ? Math.max(1, Math.round(ROW_HEIGHT * scale)) : ROW_HEIGHT`. In `blockNodes`'s block `<div>` style, make fontSize conditional: `fontSize: `${touchMode ? Math.round(style.fontSize * scale) : style.fontSize}px`` (keep the existing comment attached).
- [ ] **Step 2:** Sweep `components/murals/blocks/*.tsx` for rem-based utilities that visibly size content (`h-24 w-16` tier tiles, and any similar fixed `h-*`/`w-*` on covers/tiles) → convert to em equivalents (`h-24`→`h-[6em]`, `w-16`→`w-[4em]`, min-h-16→`min-h-[4em]` etc.). Leave layout containers that don't track content size alone.
- [ ] **Step 3:** Verify: typecheck+lint. Manual (emulated touch): zoom in/out — blocks scale uniformly (width AND height AND text); covers grow with zoom; desktop unchanged.
- [ ] **Step 4:** Commit `feat(frontend): proportional canvas scaling on touch`.

### Task 2: Backend `tierlists` module

**Files:**
- Create: `backend/src/modules/tierlists/{domain/types.ts,domain/ports.ts,service.ts,adapters/sqlite/connection.ts,adapters/sqlite/schema.sql,adapters/sqlite/sqliteTierlistsRepository.ts,routes.ts,plugin.ts,index.ts}`
- Create: `backend/src/modules/tierlists/service.test.ts`
- Modify: `backend/src/config/env.ts` (add `TIERLISTS_DB_PATH`), `backend/src/app.ts` (register), `backend/package.json` (test script file list)

**Interfaces:**
- Produces: `registerTierlistsModule(app)`; `Tierlist` DTO `{id, name, data: {tiers: TierDefinition[], pool: string[]}, createdAt, updatedAt}` (dates ISO strings); routes as in the spec; exported `createTierlistsPublicApi(repo/service)` style helper returning `getTierlistData(ownerUserId, id): {name, tiers, pool} | undefined` for app.ts to hand to the murals module (exact shape: whatever `registerMuralsModule` accepts as its new optional param in Task 6 — coordinate: it's `(ownerUserId: string, tierlistId: string) => { name: string; tiers: Array<{id,label,color,bookKeys}>; pool: string[] } | undefined`).

- [ ] **Step 1:** Study `backend/src/modules/murals/` (types, ports, service, sqlite adapter, routes, plugin, index) and mirror it exactly: table `tierlists(id TEXT PK, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`. Service: `listTierlists`, `createTierlist(userId, name)`, `getTierlist`, `updateTierlist(userId, id, patch {name?, data?})`, `deleteTierlist` — murals' undefined-on-unowned convention. Routes: `GET /tierlists`, `POST /tierlists`, `GET/PUT/DELETE /tierlists/:id` — copy murals' authGuard/zod/404 conventions verbatim.
- [ ] **Step 2:** env.ts: `TIERLISTS_DB_PATH: z.string().min(1).default("./data/tierlists.sqlite")` beside `ARENA_DB_PATH`. app.ts: register like arena. package.json test script: append `src/modules/tierlists/service.test.ts`.
- [ ] **Step 3:** `service.test.ts` mirroring `murals/service.test.ts`'s in-memory-repo style: create→get roundtrip, list scoping by user, update name-only and data-only, unowned update/delete → undefined/false, delete→get undefined.
- [ ] **Step 4:** Verify: `cd backend && npm run typecheck && npm test` — all pass. Commit `feat(backend): tierlists module`.

### Task 3: Frontend api + hooks

**Files:**
- Create: `frontend/src/api/tierlists.ts`, `frontend/src/hooks/useTierlists.ts`

**Interfaces:**
- Consumes: Task 2's routes.
- Produces: `Tierlist` type as in Task 2's DTO; `useTierlists()` → `{ data: Tierlist[] | undefined, isLoading, create(name): Promise<Tierlist>, rename(id, name), saveData(id, data), remove(id) }` with react-query cache updates, mirroring `useMurals.ts` exactly (same keys structure: query key `["tierlists"]`).

- [ ] **Step 1:** Write both files mirroring `api/murals.ts` + `hooks/useMurals.ts` (apiFetch, same error/comment conventions).
- [ ] **Step 2:** Verify typecheck+lint; wire nothing yet (no unused-export complaints — hooks files export, that's fine).
- [ ] **Step 3:** Commit `feat(frontend): tierlists api and hooks`.

### Task 4: Arena tabs + Tier lists list

**Files:**
- Modify: `frontend/src/pages/ArenaListPage.tsx`

**Interfaces:**
- Consumes: `useTierlists`.
- Produces: `?tab=tierlists` deep link; segmented control; tier-list rows with create + rename/delete `OptionsMenu`.

- [ ] **Step 1:** Add a segmented control at the top (Tournaments | Tier lists), tab state from `useSearchParams` (`?tab=`, default tournaments; `setSearchParams` on switch — copy the segmented control classes from ArenaViewPage's round control). Tournaments tab = existing content untouched. Tier lists tab: `useTierlists()`; create via a "+" tile mirroring the tournaments one (or a name input + Add button if simpler — follow whatever ArenaListPage already does for tournaments); rows show name + updated date; `⋮` per row (Rename → inline input, Delete → `ConfirmDialog` like MuralsListPage uses). Clicking a row navigates to `/dashboard/arena/tierlist/:id`.
- [ ] **Step 2:** Verify typecheck+lint; manual: tabs switch, create/rename/delete work against the dev backend.
- [ ] **Step 3:** Commit `feat(frontend): Arena tabs with tier lists list`.

### Task 5: Tier list editor page

**Files:**
- Create: `frontend/src/pages/TierListEditorPage.tsx`
- Modify: `frontend/src/App.tsx` (route), `frontend/src/components/murals/blocks/BookBlocks.tsx` (extract/reuse)

**Interfaces:**
- Consumes: `useTierlists`, `BookSearchList` from `components/murals/pickers.tsx`, `MiniBookTile` (export it from BookBlocks.tsx if not exported).
- Produces: `/dashboard/arena/tierlist/:id` — full-page ranking editor. `TierListBlockView` stays in BookBlocks.tsx but Task 6 changes its props.

- [ ] **Step 1:** Build the page: header (back link ← Arena, editable name like MuralEditorPage's), tier rows (label strip w/ color, recolor/rename/reorder/delete-tier controls — adapt BlockConfigPanel's existing tier-structure JSX), tiles grid per tier with HTML5 drag ranking + per-tile `⋮` ("Move to X…", "Return to pool") — the same interactions TierListBlockView's edit mode has today, at page width — plus pool panel with BookSearchList to add books. Every mutation calls `saveData(id, nextData)` (whole-document PUT, immediate — same stance as the in-mural board). Empty state: "No tiers yet — add one" + create-tier form.
- [ ] **Step 2:** App.tsx: `<Route path="/dashboard/arena/tierlist/:id" element={<TierListEditorPage />} />` beside the arena routes.
- [ ] **Step 3:** Verify typecheck+lint/build; manual: create tiers, add books, rank by drag (desktop) and menus, rename/recolor/reorder tiers; back link returns to Arena with the tier lists tab.
- [ ] **Step 4:** Commit `feat(frontend): tier list editor page`.

### Task 6: Mural block becomes reference + renderer

**Files:**
- Modify: `frontend/src/lib/murals.ts`, `frontend/src/components/murals/MuralCanvas.tsx`, `frontend/src/components/murals/BlockRenderer.tsx`, `frontend/src/components/murals/blocks/BookBlocks.tsx`, `frontend/src/components/murals/BlockConfigPanel.tsx`, `frontend/src/pages/MuralEditorPage.tsx`, `frontend/src/pages/SharedMuralPage.tsx`
- Modify: `backend/src/modules/murals/routes.ts` (+ wherever the shared-token handler resolves blocks), `backend/src/app.ts` (pass the public getter), `backend/src/modules/murals/index.ts` (accept optional param)

**Interfaces:**
- Consumes: Task 2's `getTierlistData(ownerUserId, tierlistId)`, Task 3's `useTierlists`.
- Produces: `MuralBlock` tierlist variant `{type:"tierlist"; tierlistId: string}`; `TierListBlockView({ tierlist: {name,tiers,pool} | undefined, books })` pure; `MuralCanvas` new optional prop `tierlistData?: (id: string) => {name,tiers,pool} | undefined`; shared mural GET response resolves `tierlist` blocks' data server-side.

- [ ] **Step 1:** lib/murals.ts: change the tierlist variant to `{ type: "tierlist"; tierlistId: string }`; delete `TierDefinition`-based inline payload fields from the block type (keep `TierDefinition` exported — the tierlists feature owns it now conceptually; move if cleaner to a shared `lib/tierlists.ts` and re-export); update `addBlock`'s tierlist case (default w/h unchanged); delete the tierlist case in `scrubBooksFromMurals`; fix `MURAL_BLOCK_EXAMPLES`/labels if present.
- [ ] **Step 2:** BookBlocks.tsx: `TierListBlockView` becomes pure — props `({ tierlist, books })` where `tierlist: {name, tiers, pool} | undefined`; renders title (tierlist name) + tier rows (view-mode JSX of TierRow, no drop props, no pool panel, no DraggableTierTile); `undefined` → `EmptyBlockState("Tier list unavailable.")`. Delete the edit-mode machinery from it (pool panel, dropZoneProps/tileDropProps/moveBook, DraggableTierTile if unused after Task 5 — coordinate: Task 5 may have moved/ reused these; whatever remains unused dies).
- [ ] **Step 3:** MuralCanvas/BlockRenderer: thread `tierlistData?: (id) => data | undefined` down to `TierListBlockView` (same pattern as `statsOverride`). MuralEditorPage passes a lookup closure over `useTierlists()`'s cache. BlockConfigPanel's tierlist section: replace tier-structure UI with a picker — list from `useTierlists()` (radio-style select, sets `tierlistId`), plus a "Create in Arena" link to `/dashboard/arena?tab=tierlists`.
- [ ] **Step 4:** Backend: `registerMuralsModule` accepts optional `getTierlistData`; the shared-token handler, where it already resolves public book shapes, resolves each `tierlist` block's `tierlistId` through it and includes `{name, tiers, pool}` in the response's resolved payload (omitted when undefined). app.ts wires tierlists' getter in. SharedMuralPage: pass `tierlistData` built from that response into MuralCanvas.
- [ ] **Step 5:** Delete the `mural-tierlist-editor` selector from MuralCanvas's `draggableCancel` (both branches).
- [ ] **Step 6:** Verify: backend typecheck+test, frontend typecheck+lint+build. Manual: mural + tierlist block → picker lists tier lists → renders; ranking only in Arena; shared mural renders the tier list; deleted tier list → unavailable state; desktop whole-block drag works over the tier list area.
- [ ] **Step 7:** Commit `feat: mural tierlist block references Arena tier lists`.

### Task 7: Full verification matrix

- [ ] Automated: backend `npm run typecheck && npm run test`; frontend `npm run typecheck && npm run lint && npm run build`.
- [ ] Manual phone (6173 instance) + desktop: proportional zoom; Arena tabs; tier list create/rank/delete; mural block pick/render (authed + shared); desktop regressions (mural drag/resize/tier-drag arena unaffected).

---

## Self-Review (performed)

- Spec coverage: proportional zoom (T1), backend module+tests+env+registration (T2), api/hooks (T3), tabs+list (T4), editor page (T5), block reference+renderer+config picker+scrub deletion+draggableCancel cleanup+share resolution (T6), verification (T7). Simplifications (no migration, no ref counting, no own sharing) are encoded as behaviors/omissions, matching the spec.
- Interfaces cross-check: `getTierlistData(ownerUserId, tierlistId) -> {name, tiers, pool} | undefined` identical in T2 and T6; `Tierlist` DTO identical in T2/T3; `tierlistData` lookup-prop identical in T6's producer/consumers.
- Task 5/6 share `TierRow`/`DraggableTierTile`/`MiniBookTile` — coordination noted in both tasks (T5 may export/reuse; T6 deletes what remains unused).
- No placeholders: steps name exact files, props, routes, and behaviors; code-level detail is "mirror murals/arena file X", which these repos treat as exact instructions.
