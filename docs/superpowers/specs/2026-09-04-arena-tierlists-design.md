# Arena Tier Lists — standalone ranking entity

## Context

Tier lists today are embedded mural content: the mural's `tierlist`
block carries `tiers[]` and `pool[]` inline (lib/murals.ts), edited
in-canvas (a ranking board squeezed into a grid cell, HTML5
drag-and-drop only) and via BlockConfigPanel's tier-structure section.
That makes ranking cramped on desktop, near-unusable on touch, and
unreusable — a ranking can't exist outside the mural that hosts it.

Decision: tier lists become their own entity under **Arena**
(alongside tournaments), with a full-page editor; the mural block
becomes a reference plus a pure renderer.

## Decisions locked in with the user

- **Start clean** — no migration; tier lists embedded in existing
  mural blocks are dropped (those blocks render an "unavailable" state).
- Arena gets **segmented tabs** (Tournaments | Tier lists) — most
  mobile-friendly; matches the segmented control Arena already uses.
- The editor is a **full page**, `/dashboard/arena/tierlist/:id`, not a
  modal.
- Mural block: **pick + display only**; all creation/editing happens in
  Arena.
- No standalone tier-list sharing in v1 — a tier list surfaces publicly
  only inside a shared mural, resolved server-side.

## Backend design — new `tierlists` module

Same hexagonal shape as `arena`/`murals`: `domain/{ports.ts,types.ts}`,
`service.ts`, `adapters/sqlite/{connection.ts,schema.sql,
sqliteTierlistsRepository.ts}`, `routes.ts`, `plugin.ts`, `index.ts`.
New env `TIERLISTS_DB_PATH` (default `./data/tierlists.sqlite`),
registered from `app.ts` like the others.

- **Table**: `tierlists(id TEXT PK, owner_user_id TEXT, name TEXT,
  data TEXT, created_at, updated_at)`.
- **`data`** is one opaque JSON blob — `{tiers: TierDefinition[],
  pool: string[]}` — the same "store and return the document without
  understanding its internals" stance `murals` takes with `blocks`;
  all book-key semantics live in the frontend.
- **Service**: list/create/get/update (`name?`/`data?`, at least
  one)/delete, owner-scoped, murals-style `undefined`-on-unowned.
- **Routes** (all `authGuard`, zod bodies): `GET /tierlists` →
  `{tierlists}`; `POST /tierlists` `{name}` → `201 {tierlist}`;
  `GET /tierlists/:id` → `{tierlist}` or `404`; `PUT /tierlists/:id`
  `{name?, data?}` → `{tierlist}`; `DELETE /tierlists/:id` → `204`.
- **Cross-module public interface**: app.ts passes tierlists'
  `getTierlistData(ownerUserId, id)` into `registerMuralsModule`, so
  `GET /murals/shared/:token` can resolve a `tierlist` block's
  reference server-side into the raw `{name, tiers, pool}` (book keys
  resolved to redacted public shapes by the existing library
  publicResolver path). A dangling reference (deleted tier list) is
  omitted; the block renders its unavailable state.
- **Tests**: `tierlists/service.test.ts` following
  `arena/service.test.ts`'s shape, added to the backend `npm test`
  script's file list.

## Frontend design

- **`src/api/tierlists.ts` + `src/hooks/useTierlists.ts`** — mirrors
  `api/murals.ts`/`useMurals`: react-query list + CRUD mutations with
  cache updates.
- **Arena tabs**: `ArenaListPage` gains a segmented control
  (Tournaments | Tier lists), deep-linkable via `?tab=`; default
  Tournaments. The Tier lists tab lists saved tier lists with create +
  rename/delete via `OptionsMenu`, following MuralsListPage's row
  conventions.
- **Editor page**: `/dashboard/arena/tierlist/:id` (authed) — the full
  ranking board at page size: tier rows (label strip + tiles), pool +
  BookSearchList add-to-pool, tier structure controls
  (add/rename/recolor/reorder/delete), drag ranking on desktop and
  per-tile `⋮` menus on touch. Persists per change via whole-document
  `PUT` (same save stance the mural ranking board had).
- **Mural block becomes a reference** (lib/murals.ts): payload
  `{type:"tierlist", tierlistId}`; `addBlock` opens the picker; the
  in-canvas ranking UI, `mural-tierlist-editor` RGL carve-out,
  BlockConfigPanel's tier-structure section, and the `tierlist` case
  of `scrubBooksFromMurals` are all deleted. `BlockConfigPanel`'s
  tierlist section becomes a picker over `useTierlists`.
- **Rendering**: `TierListBlockView` is pure — it takes resolved
  tier-list data as a prop. The authenticated editor resolves it from
  `useTierlists`; `SharedMuralPage` receives it via a
  `statsOverride`-style threaded prop. Missing/unavailable data renders
  the existing `EmptyBlockState`.

## Known simplifications (stated, not hidden)

- Existing embedded tier-list data is intentionally dropped (user's
  "start clean"); those blocks show "Tier list unavailable".
- Deleting a tier list leaves mural blocks dangling (unavailable
  state) — no reference counting or cross-module scrubbing in v1.
- Tab state isn't persisted beyond the URL param.
- Tier lists have no own share links, covers, or folders — they're not
  murals; those can come later if wanted.

## Verification

- Backend: `cd backend && npm run typecheck && npm test`; manual curl
  walkthrough of the five routes (create, list, get, put, delete,
  unowned-id 404s).
- Frontend: `cd frontend && npm run typecheck && npm run lint && npm
  run build`; manual pass — create a tier list in Arena, rank books
  (desktop drag + touch menus), reference it from a mural block
  (authed render + shared-mural render), delete it and see the mural
  block fall back to the unavailable state; Arena tabs on phone and
  desktop.
