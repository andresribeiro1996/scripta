# BookArena — bracket tournament voting feature

## Context

Scripta (the Kobo Library Viewer) lets a user manage their personal book
library. BookArena adds a social, game-like layer on top: a user picks
books from their library, seeds them into a single-elimination bracket
(e.g. 16 books), and shares a public link so anyone can vote on each
head-to-head "duel." Each round runs on a timer; when it closes the
higher-vote book advances automatically, the round moves on, and this
repeats until one book is crowned champion. Ties are broken by the
tournament's owner, who can also close a duel early.

This is new territory for the codebase in two ways the design has to
account for:

1. **No shared "Book" entity exists.** Every book today lives only
   inside a user's own private, opaque `LibraryData` JSON blob
   (`backend` never looks inside it; `frontend` reads it as untyped
   records). BookArena needs book identity to cross into a
   shared/public context, so it must snapshot (title, author, cover,
   `bookKey`) at seed time rather than reference a shared table that
   doesn't exist.
2. **No scheduling and no anonymous/public surface exists.** Every
   existing feature is private-per-account, mutated via one
   authenticated `PUT /library` call, with no background jobs and no
   unauthenticated routes. BookArena needs anonymous, concurrent votes
   (ruling out the app's usual whole-document read-modify-write
   pattern) and a server-driven clock to close rounds — both are new
   primitives for this codebase, introduced here for the first time.

Given that, BookArena is built as a new, independent backend module
(`arena`) with its own SQLite database, following this repo's existing
hexagonal module convention, plus new frontend pages/components. It is
**not** implemented as another field on the account's library document.

## Decisions locked in with the user

- Voting is anonymous — no login required to vote.
- Rounds settle on a timer with auto-advance; the tournament owner can
  also settle a duel early.
- Ties are broken manually by the tournament owner (no auto coin-flip).
- Tournaments are public: a shareable link, and also listed in a public
  directory.
- Bracket size is configurable (any power of 2: 4/8/16/32/64…), chosen
  by the owner at creation.
- A vote is locked in once cast (no changing your vote on a duel).

## Backend design (`backend/src/modules/arena/`)

Follow the existing module shape exactly (see `modules/covers/` and
`modules/library/` as reference): `domain/{ports.ts,types.ts,errors.ts}`,
`service.ts`, `adapters/sqlite/{connection.ts,schema.sql,sqliteArenaRepository.ts}`,
`routes.ts`, `plugin.ts`, `index.ts`. New env var `ARENA_DB_PATH`
(default `./data/arena.sqlite`) added to `config/env.ts` alongside the
existing `*_DB_PATH` vars. Register the module from `app.ts` like the
others.

**Data model (arena.sqlite, raw SQL, no ORM — matches every other module):**

- `tournaments(id, owner_user_id, name, bracket_size, round_duration_minutes, status['seeding'|'active'|'completed'], current_round, created_at, updated_at)`
- `tournament_slots(tournament_id, slot_index, book_key, title, author, cover_url)` — the seeded pool, one row per bracket slot, filled during 'seeding'.
- `duels(id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_a_cover, book_b_key, book_b_title, book_b_author, book_b_cover, winner_key, status['active'|'tied_pending_tiebreak'|'settled'], opens_at, closes_at, settled_at)` — both books are denormalized directly onto the duel row (no join needed to render or vote on a duel).
- `votes(id, duel_id, voter_token, book_key, created_at, UNIQUE(duel_id, voter_token))` — `voter_token` is a random UUID the frontend generates once and stores in `localStorage`; the unique constraint is what makes a vote "lock in" (insert-or-ignore, same race-safe idiom the `covers` module already uses for first-write-wins). Vote tallies are computed with `COUNT(*) ... GROUP BY book_key` on read/settle rather than kept as incremented counters — avoids any counter-drift race entirely, and is cheap at this app's scale.

**Round lifecycle / scheduler:**

- On `POST /arenas/:id/start` (owner, requires all slots filled): pair slots sequentially (0v1, 2v3, …) into round-1 duels with `opens_at = now`, `closes_at = now + round_duration_minutes`, set tournament `status='active'`.
- A new in-process interval (started once in `arena/plugin.ts`, the first background timer in this codebase) sweeps periodically for `status='active'` duels past `closes_at` and settles them via one shared internal `settleDuel(duel, {force})` function:
  - votes differ → mark `settled`, set `winner_key`.
  - votes tie → mark `tied_pending_tiebreak` (removed from the sweep's candidate set; waits for the owner).
  - After any settle, check whether the whole round is now fully settled; if so, generate the next round's duels from the winners (same pairing logic), or, if that was the final duel, set the tournament `status='completed'`.
- `POST /arenas/:id/duels/:duelId/settle` (owner-only) calls the same settle logic with `force:true`, bypassing the `closes_at` check — this is the "admin can settle early" path, and reuses the identical tie-handling logic.
- `POST /arenas/:id/duels/:duelId/tiebreak` (owner-only, `{winnerBookKey}`) is the only way a `tied_pending_tiebreak` duel resolves; sets the winner and re-runs the round-completion check.

**Routes (zod-validated bodies, `authGuard` preHandler only where noted, matching existing `routes.ts` conventions):**

| Route | Auth | Purpose |
|---|---|---|
| `POST /arenas` | owner | create tournament (name, bracketSize, roundDurationMinutes) → `seeding` |
| `PUT /arenas/:id/slots` | owner | manual seed: full-replace all slot assignments (same "whole-document PUT" semantics `PUT /library` already uses) |
| `POST /arenas/:id/random-fill` | owner | random seed: server shuffles a supplied book pool into all slots |
| `POST /arenas/:id/start` | owner | validate full seeding → generate round 1, go `active` |
| `GET /arenas/:id` | public | full bracket/duel state + vote counts, plus the plain `ownerUserId` string (not sensitive — same opaque-id trust level already used elsewhere) and, when a `voterToken` query param is given, `hasVoted` per duel. The frontend computes "am I the owner" itself by comparing its own session's user id, so this route needs no new auth primitive. |
| `GET /arenas/public` | public | paginated directory of listed tournaments |
| `GET /arenas/mine` | owner | the caller's own tournaments |
| `POST /arenas/:id/duels/:duelId/vote` | public | `{voterToken, bookKey}`; rejects if duel isn't `active`/past `closes_at`/token already voted; scoped `@fastify/rate-limit` (mirrors `covers`' per-route limiting) since this is the app's first anonymous write endpoint |
| `POST /arenas/:id/duels/:duelId/settle` | owner | early settle |
| `POST /arenas/:id/duels/:duelId/tiebreak` | owner | resolve a tie |
| `DELETE /arenas/:id` | owner | cancel/delete |

## Frontend design

**New API/data layer** (mirrors `api/gallery.ts` + `hooks/useGalleryImages.ts` — a standalone backend resource, not a field on the library document):
- `src/api/arena.ts` — types + thin wrapper functions over `apiFetch`/`publicFetch` for every route above.
- `src/hooks/useArena.ts` (single tournament, with voting) / `useMyTournaments.ts` / `usePublicTournaments.ts` — react-query hooks; `useArena` sets `refetchInterval` while `status !== 'completed'`, since this app has no realtime/websocket layer and polling is the simplest fit here.
- `src/lib/arenaVoter.ts` — get-or-create the anonymous `voterToken` UUID in `localStorage`.

**New components** (`src/components/arena/`), reusing `CoverImage` from `components/BookCard.tsx` and `BookSearchList` from `components/murals/pickers.tsx` rather than rebuilding either:
- `DuelCard.tsx` — two-book head-to-head with a vote button per side, live vote tally, countdown to `closes_at`, disabled/"voted" state once the local token has a row for this duel.
- `BracketTree.tsx` — the round-by-round bracket visualization (CSS layout, not SVG — simple enough at this app's scale).
- `SeedSlotGrid.tsx` — the seeding UI: an empty-slot grid, a "Random fill" action, and per-slot manual assignment via `BookSearchList`.

**New pages/routes** (`src/App.tsx`, following the existing `MuralsListPage → MuralEditorPage` list/detail pattern):
- Authed, under the existing `DashboardLayout`/`RequireAuth` block (new "Arena" entry in `DashboardLayout`'s `NAV_ITEMS`):
  - `/dashboard/arena` — owner's own tournaments + create form.
  - `/dashboard/arena/:id/seed` — seeding screen (random fill or manual), "Start Tournament" once full.
- **New top-level public routes, outside `RequireAuth`** — the first unauthenticated pages in this app:
  - `/arena` — public directory (from `GET /arenas/public`).
  - `/arena/:id` — the bracket + voting page anyone can open from a shared link; shows owner-only controls (settle early, tie-break) inline when the viewer's own session user id matches the tournament's `ownerUserId`.

## Known simplifications (worth stating explicitly, not hidden)

- A seeded book's title/author/cover is a snapshot at seed time; if the owner edits that book in their library afterward, the tournament won't reflect the change.
- Anti-abuse is a `localStorage` token, not account- or IP-based — matches the "anyone, anonymous" requirement, but a voter can clear storage to vote again. Rate-limiting the vote route bounds bot-style abuse; nothing here tries to stop a single determined human from casting a few extra votes.
- A tie that the owner never resolves blocks that duel (and therefore that whole round) indefinitely — acceptable given "owner breaks ties" was the explicit choice, but worth surfacing in the owner's dashboard UI (e.g. a "needs your action" badge) so it doesn't get missed. Not built in the first pass; noted here for a later iteration.

## Verification

- Backend: `cd backend && npm run typecheck && npm test`; manually exercise the new routes with `curl`/httpie against `npm run dev` — create a tournament, seed it (both random-fill and manual paths), start it, cast votes from a couple of different `voterToken`s, force-settle a duel, trigger a tie and resolve it via `/tiebreak`, and let one duel's timer actually expire to confirm the scheduler sweep auto-advances it end-to-end to a completed tournament.
- Frontend: `cd frontend && npm run typecheck && npm run lint`; run `npm run dev` against the dev backend and walk the full flow in the browser — create → seed → start → open the public `/arena/:id` link in an incognito window (no auth) and vote → confirm polling reflects the new tally and the round advances/completes without a manual refresh.
