# Game Rules In Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tier-list, quiz and tournament save/publish rules live in each game's service behind a works port, tested without Fastify; routes parse and map outcomes.

**Architecture:** One task per game. Each adds a `*Works` port to the game's `domain/ports.ts`, built from `library/index.ts` in `plugin.ts` and passed as the service's second argument; moves the route's rules into the service; and moves the pure half of `wire.ts` that the service needs into `domain/`, so `service.ts` reaches the library only through the port.

**Tech Stack:** TypeScript, Fastify, `node:test` via `tsx --test`, zod.

**Spec:** `docs/superpowers/specs/2026-10-24-game-rules-in-services-design.md`

## Global Constraints

- Constructors: `createTierlistsService(repo, works, emitPublished?, emitVotedOn?, peekCovers?)`, `createQuizzesService(repo, works, emitPublished?, emitPlayed?)`, `createArenaService(repo, works, emitPublished?, emitVotedOn?)`. Each `plugin.ts` exports its production port (`tierlistWorks`, `quizWorks`, `arenaWorks`), built from `../library/index.js`, and passes it to every construction there, including the `create*PublicApi` one.
- Service tests pass an in-memory fake port. Route tests and SQLite repository tests that construct a service pass the exported production port, since they drive the real catalog for their merge and 503 cases.
- A game's `service.ts` imports neither `../library/index.js` nor `./wire.js`. `wire.ts` keeps the response-side translation and may import the library.
- Outcomes: `{ ok: false, reason: "not-found" | "invalid", error }` or `{ ok: false, reason: "duplicate-work", title: string | null }` (plus quizzes' existing `already-published`). Routes map `not-found` → 404, `invalid` → 400, `duplicate-work` → 409 with `duplicateWorkMessage({ workId: null, title })`, `already-published` → 409. Every error string, status and body is unchanged.
- Check order inside each method is the route's order today: ownership and state checks, then local checks on the request, then work lookups, then writes. The one order change the spec lists (a publish of an already-published quiz while the catalog is down answers 409, not 503) is the only one allowed.
- `UnknownWorkError` and `WorkResolutionError` stay thrown from the port and are mapped where they are today (`sendWorksError`, arena's catch).
- Every changed return type updates its callers in tests. Where a test only needs the created game, use a local `created(outcome)` helper that asserts `ok` and returns it.
- No comments in code. No new test files. Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **A catalog outage during create, update, publish or slot-setting** answers 503 and writes nothing. The existing route tests ("… 503 and no write", for example `tierlists/routes.test.ts:506`) stay and must pass.
- **A name-only tier-list or quiz update while the catalog is down** is still a 503 with no write: the service computes the canonical map through the port before writing.
- **A public tier list whose book left the library** answers 400 "A selected book is no longer in your library." — newly tested at the service (Task 1).
- **Two editions of one work** are silently deduped in a quiz create and a 409 in an update. Task 2 tests both.
- **A non-owner sending an unknown work to PUT slots** gets 404, not 400 (`arena/routes.test.ts:182`). The ownership check runs before the works lookup. Task 3.

---

### Task 1: Tier lists

**Files:**
- Modify: `backend/src/modules/tierlists/domain/ports.ts`
- Create: `backend/src/modules/tierlists/domain/board.ts`
- Modify: `backend/src/modules/tierlists/wire.ts`
- Modify: `backend/src/modules/tierlists/service.ts`
- Modify: `backend/src/modules/tierlists/routes.ts`
- Modify: `backend/src/modules/tierlists/plugin.ts`
- Test: `backend/src/modules/tierlists/service.test.ts`
- Test: `backend/src/modules/tierlists/routes.test.ts`
- Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`
- Test: `backend/src/modules/tierlists/wire.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TierlistWorks {
    knownWorkIds(ids: string[]): string[];
    canonicalByKey(ids: Map<string, string>): Map<string, string>;
    publicBooksByWork(ownerUserId: string, workIds: string[]): Map<string, PublicBookData>;
  }
  export type TierlistWriteOutcome =
    | { ok: true; tierlist: Tierlist; data: TierlistData }
    | { ok: false; reason: "not-found" | "invalid"; error: string }
    | { ok: false; reason: "duplicate-work"; title: string | null };
  createTierlist(userId: string, input: { name: string; data?: TierlistData; access?: VoteAccess; ranksWorstFirst?: boolean }): TierlistWriteOutcome;
  updateTierlist(userId: string, id: string, patch: { name?: string; data?: TierlistData }): TierlistWriteOutcome;
  openVoting(userId: string, id: string, access: VoteAccess): { tierlist: Tierlist; known: Map<string, string> } | undefined;
  booksInOrder(ownerUserId: string, workIds: string[]): PublicBookData[];
  ```
  `data` in the ok outcome is the canonical board the route sends today (`board.data`, or `canonicalBoard(owned.data)` on a name-only update). `known` is the map the open-voting route passes to `canonicalBoard` today. `booksInOrder` is today's route helper, now on the service, so the public voting-board route (`routes.ts:312`) keeps its live fallback.
- `domain/board.ts` holds the pure helpers `storedIds(data)` and `canonicalBoard(data, known)` (with `known` required), moved from `wire.ts`. `wire.ts` imports them and keeps `boardCanonical`, the `canonicalBoard(data, known?)` wrapper and the other response-side helpers.

- [ ] **Step 1: Write the failing service tests**, with a fake `TierlistWorks` (a `Map` of id → canonical id and a `Map` of work → `PublicBookData`):
  - "a create with access but no board is invalid: Choose books and tiers before publishing."
  - "a create with two tiers sharing an id is invalid: Duplicate tier or book."
  - "a public create needs every book in the pool and no tier filled: Public tier lists need an unranked book pool."
  - "a public create whose book the library no longer holds is invalid: A selected book is no longer in your library."
  - "a create with two editions of one work is a duplicate-work outcome with no title"
  - "a create stores canonical work ids and snapshots the pool's public books in order"
  - "an update of a public or someone else's list is not-found; a bad board is invalid"
  - "a name-only update returns the stored board in canonical ids"
  - "open voting snapshots the board's books from the owner's library"
- [ ] **Step 2:** Run `npx tsx --test src/modules/tierlists/service.test.ts` in `backend/` and see them fail.
- [ ] **Step 3: Implement.** Add `TierlistWorks`; create `domain/board.ts` and point `wire.ts` at it. Move `storedBoard` into the service as a private helper over `works`, and move `booksInOrder` onto the service. Move the create, update and open-voting rules out of the handlers, in today's order. The handlers keep:
  - zod parsing;
  - mapping each outcome to a status;
  - `answer`/`canonicalBoard` for responses;
  - the `sendWorksError` catch.

  The voting-board route calls `service.booksInOrder`. `getTierlistData` in the public API, which calls `wire.ts`'s `canonicalBoard` today, uses `board.ts`'s `canonicalBoard(data, works.canonicalByKey(…))` instead. `plugin.ts` exports `tierlistWorks = { knownWorkIds, canonicalByKey, publicBooksByWork: resolvePublicBooksByWork }` and passes it to both constructions. Delete the `LIBRARY_DB_PATH` setup from `service.test.ts` (lines 17-20) if nothing else there needs it.
- [ ] **Step 4: Route tests.** Every route test keeps its assertions; update the calls that read `createTierlist`'s return value. Delete only route tests whose single assertion is a rule now covered in Step 1, keeping at least one test per status (201, 200, 400, 404, 409, 503).
- [ ] **Step 5:** `npm test --workspace backend` passes; `rg -n "library/index|\./wire" backend/src/modules/tierlists/service.ts` prints nothing; `node scripts/gate.mjs`; commit.

### Task 2: Quizzes

**Files:**
- Modify: `backend/src/modules/quizzes/domain/ports.ts`
- Modify: `backend/src/modules/quizzes/domain/types.ts`
- Create: `backend/src/modules/quizzes/domain/quizWorks.ts`
- Modify: `backend/src/modules/quizzes/wire.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Modify: `backend/src/modules/quizzes/routes.ts`
- Modify: `backend/src/modules/quizzes/plugin.ts`
- Test: `backend/src/modules/quizzes/service.test.ts`
- Test: `backend/src/modules/quizzes/routes.test.ts`
- Test: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface QuizWorks {
    knownWorkIds(ids: string[]): string[];
    resolveTitleWorks(books: Array<{ title: string; author: string }>): Array<string | null>;
    canonicalByKey(ids: Map<string, string>): Map<string, string>;
    publicBooksByWork(ownerUserId: string, workIds: string[]): Map<string, PublicBookData>;
  }
  export type QuizWriteOutcome =
    | { ok: true; quiz: Quiz; canonical: Map<string, string> }
    | { ok: false; reason: "not-found" | "invalid"; error: string }
    | { ok: false; reason: "duplicate-work"; title: string | null };
  createQuiz(userId: string, name: string, data: QuizInput): QuizWriteOutcome;
  updateQuiz(userId: string, id: string, patch: { name?: string; data?: QuizInput }): QuizWriteOutcome;
  publishQuiz(userId: string, id: string): PublishOutcome; // ok variant gains `canonical: Map<string, string>`
  ```
  `QuizInput` is declared in `domain/types.ts` as the shape `createQuizSchema`'s `data` parses to today (books with optional `workId`, `title`, `author`, plus the existing fields). `canonical` is the map each route passes to `quizToWorks` today. `storedIds` moves from `wire.ts` to a new `quizzes/domain/quizWorks.ts`, which both `wire.ts` (`canonicalForQuiz`) and the service import. `quizBookWorks` moves into the service over the port. `wire.ts` keeps `quizToWorks` and `canonicalForQuiz` for the read routes.

- [ ] **Step 1: Write the failing service tests** with a fake `QuizWorks`:
  - "a create resolves books by work id or by title and keeps the first book per work"
  - "a create with a book the catalog can't place is invalid: That book isn't in the catalog."
  - "an update with two editions of one work is a duplicate-work outcome carrying the second book's title"
  - "an update of a published quiz is not-found"
  - "a name-only update returns the canonical map of the stored books"
  - "publish fills a missing cover from the owner's library copy of that work and keeps a cover the book already has"
  - "publish counts one book per work after two editions merge"
- [ ] **Step 2:** Run `npx tsx --test src/modules/quizzes/service.test.ts` and see them fail.
- [ ] **Step 3: Implement.** Add `QuizWorks` and `QuizInput`; move the create, update and publish rules out of the handlers. `publishQuiz` checks ownership and published state first, then computes `needCover`, `canonical` and the covers through the port. The handlers keep parsing, outcome mapping, `quizToWorks(outcome.quiz, outcome.canonical)` and the `sendWorksError` catch. `plugin.ts` exports `quizWorks` from `../library/index.js` and passes it to both constructions. Update every `createQuiz`/`updateQuiz`/`publishQuiz` caller in the three test files.
- [ ] **Step 4: Route tests.** Every route test keeps its assertions except the spec's one order change. If a test covers it, its expectation becomes 409. Keep at least one test per status, including "publish fills a missing cover from the owner's library copy of that work" end to end.
- [ ] **Step 5:** `npm test --workspace backend` passes; `rg -n "library/index|\./wire" backend/src/modules/quizzes/service.ts` prints nothing; `node scripts/gate.mjs`; commit.

### Task 3: Arena

**Files:**
- Modify: `backend/src/modules/arena/domain/ports.ts`
- Modify: `backend/src/modules/arena/service.ts`
- Modify: `backend/src/modules/arena/routes.ts`
- Modify: `backend/src/modules/arena/plugin.ts`
- Test: `backend/src/modules/arena/service.test.ts`
- Test: `backend/src/modules/arena/routes.test.ts`
- Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ArenaWorks {
    knownWorkIds(ids: string[]): string[];
    canonicalWorkIds(ids: string[]): Map<string, string>;
  }
  ```
  `setSlotsManual` and `randomFill` keep their signatures and take wire work ids. Each runs its ownership and seeding-state checks, then resolves through `works.knownWorkIds`, then runs its existing slot checks. `seedingSlots` is removed from `ArenaService`, since its only caller was the route's gate.

- [ ] **Step 1: Tests.** Add to `service.test.ts`, with a fake `ArenaWorks`:
  - "slots store canonical work ids"
  - "a non-owner's slots are refused before any work is looked up" (the fake throws if called)

  The existing "two editions of one work can't fill two slots" test (line 382) already covers the duplicate case: keep it, passing wire ids through the fake. Keep the random-fill test at line 395 the same way. Fold "seedingSlots answers only the owner of a tournament still seeding" (line 830) into the non-owner test above and a started-tournament case on `setSlotsManual`, then delete it.
- [ ] **Step 2:** Run `npx tsx --test src/modules/arena/service.test.ts` and see the new tests fail.
- [ ] **Step 3: Implement.** Add `ArenaWorks`. `createArenaService(repo, works, emitPublished?, emitVotedOn?)`; `sideOf` uses `works.canonicalWorkIds`; delete the `canonicalWorkIds` import. The two handlers drop `seedingSlots` and the lookups, and keep their catch blocks. `plugin.ts` exports `arenaWorks = { knownWorkIds, canonicalWorkIds }` and passes it to both constructions.
- [ ] **Step 4: Tests.** Replace `service.test.ts`'s env block and dynamic import (lines 29-37) with static imports and a local `newService(repo, …)` helper that passes the fake, used by every construction. The route tests stay unchanged: "slots reject an unknown work and two editions of one work", "random fill keeps one slot per work", the 503 test and the non-owner 404 test.
- [ ] **Step 5:** `npm test --workspace backend` passes; `rg -n "library/index" backend/src/modules/arena/service.ts` prints nothing; `node scripts/gate.mjs`; commit.
