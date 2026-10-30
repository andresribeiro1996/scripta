# Character Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readers can make a tier list or tournament of one series' (or one book's) characters from the book screen, publish it, and anyone can vote on it, on web and mobile.

**Architecture:**
- The books module gains `castOf(workId)`, the scope's cast with stable character ids. The works module exposes it as `GET /works/:id/cast`.
- Tier lists and tournaments gain a nullable `subject` that freezes the chosen cast. Their items are character ids, stored in the existing book-shaped snapshots.
- Clients turn a subject into library-shaped records (`characterBooks`), so the existing boards, decks and brackets render them through their usual `booksByWork` lookup. Only the tile components branch.

**Tech Stack:** Fastify + node:sqlite (backend), `@scripta/shared` (TS), Expo Router / React Native (mobile), React + Vite + Tailwind (web).

**Spec:** `docs/superpowers/specs/2026-10-30-character-games-design.md`. Decisions are cited below as "decision N".

## Global Constraints

- **Character id:**
  - The format is `ch:` + scope + `|` + `personNameKey(name)`.
  - The scope is `s:<series name_key>` or `w:<canonical work id>`.
  - Only the books module builds it; clients treat it as opaque.
- **Minimum cast:** 4 characters for any character game. For tournaments, `bracketSize` is a power of two with 4 ≤ size ≤ 128 and size ≤ the number of selected ids.
- **Tier list pool:** at most 500 characters, the existing cap.
- **Snapshot entry for a character:**
  - `{ key: id, workId: id, title: name, author: scope.label, isbn: null, imageId: null, coverUrl: null, readStatus: null }`
  - Arena slot: `work_id = id`, `title = name`, `author = scope.label`, `cover_url = null`.
- **Opt-in parameter:** `subjects=characters` on `GET /tierlists` and `GET /arenas/mine`. Without it, games with a subject are left out.
- **Copy:**
  - Book-screen action: "Make a character game".
  - Default game name: `"<label> characters"`.
  - Header caption: `"Characters · <label>"`.
  - Community card count: `"N characters"`.
  - A character tile's accessibility label is the name alone.
- **New boot migrations:** each is an `ALTER TABLE … ADD COLUMN subject TEXT` guarded by `PRAGMA table_info`. No new env var and no `*_DB_PATH`.
- **No comments in code** (AGENTS.md).
- **Backend test list:** every new backend `*.test.ts` is added to the explicit `test` script in `backend/package.json`.
- **No `CoverImage` call** and no server cover peek for a character item.

## Review Focus

1. **A cast whose members disagree on spelling**, such as "Harry Potter" vs "Potter, Harry" across volumes. Expected: one character, displayed with the spelling from the lowest series position. Pinned in Task 2.
2. **A book whose best series isn't the series row shared by its siblings**, such as Discworld vs "Discworld - Rincewind". Expected: the work belongs only to its best series' cast. Pinned in Task 2.
3. **A ballot or PUT carrying an id outside the frozen cast**, or a real work id smuggled into a character list. Expected: 400, with nothing stored. Pinned in Task 3.
4. **A title peek turning "Harry Potter" the character into a book cover** in feed covers or the voted-on preview. Expected: `covers` is only the scope cover, and preview entries keep `coverUrl: null`. Pinned in Task 3.
5. **Voting on a character duel when `canonicalWorkIds` returns nothing for the id.** Expected: the vote lands on its own side. Pinned in Task 4.

---

### Task 1: Shared character subject types and helpers

**Files:**
- Create: `packages/shared/src/characters/index.ts`
- Create: `packages/shared/src/characters/characters.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/tierlists/types.ts`
- Modify: `packages/shared/src/community/types.ts`
- Modify: `packages/shared/src/works/api.ts`
- Modify: `packages/shared/src/tierlists/api.ts`
- Modify: `packages/shared/src/arena/api.ts`
- Modify: `packages/shared/src/community/helpers.ts`
- Modify: `packages/shared/src/works/bookScreen.ts`
- Test: `packages/shared/src/community/helpers.test.ts`
- Test: `packages/shared/src/works/bookScreen.test.ts`
- Test: `packages/shared/src/tierlists/api.test.ts`
- Test: `packages/shared/src/arena/api.test.ts`

**Interfaces:**
- Produces (from `@scripta/shared`):
  - `type CharacterScope = { kind: "series" | "work"; key: string; label: string; coverUrl: string | null }`
  - `type CastCharacter = { id: string; name: string; works: number }`
  - `type WorkCast = { scope: CharacterScope & { workCount: number }; characters: CastCharacter[] }`
  - `type CharacterSubject = { kind: "characters"; scope: CharacterScope; characters: Array<{ id: string; name: string }> }`
  - `characterBooks(subject: CharacterSubject): Array<Record<string, unknown>>`. Each record is `{ Title: name, _workId: id, _character: true }`, in subject order.
  - `isCharacterBook(book: Record<string, unknown>): boolean`, true iff `book._character === true`.
  - `characterSnapshot(subject: CharacterSubject): PublicBookData[]`, the snapshot entries from Global Constraints, in subject order.
  - `Tierlist.subject` and `VotingBoard.subject`: `CharacterSubject | null`.
  - `VotedTierlist.subject?`: `{ kind: "characters"; label: string }`.
  - `TierlistSummary.subject` and `TournamentSummary.subject`: optional `{ kind: "characters"; label: string }`.
  - The `Tournament` type in `packages/shared/src/arena` gains `subject: CharacterSubject | null`.
  - Works API: `fetchWorkCast(workId: string): Promise<WorkCast>`, which is `GET /works/<id>/cast` with `auth: "optional"`, matching how `fetchWorkCharacters` declares auth.
  - Tierlists API:
    - `fetchTierlists()` requests `/tierlists?subjects=characters`.
    - `createCharacterTierlist(name: string, characters: { workId: string; characterIds: string[] }): Promise<Tierlist>` is `POST /tierlists` with body `{ name, characters }`.
  - Arena API:
    - `fetchMyTournaments()` requests `/arenas/mine?subjects=characters`.
    - `createCharacterTournament(input: { name: string; bracketSize: number; roundDurationMinutes: number; characters: { workId: string; characterIds: string[] } }): Promise<Tournament>` is `POST /arenas`.
  - Picker helpers in `characters/index.ts`, used by both clients:
    - `bracketSizes(count: number): number[]`, the powers of two from 4 up to `min(count, 128)`;
    - `defaultTicked(cast: CastCharacter[], mode: "tierlist" | "tournament", size: number): string[]`, the first 20 ids for a tier list or the first `size` for a tournament;
    - `canCreate(mode: "tierlist" | "tournament", ticked: number, size: number): boolean`, `ticked >= 4` for a tier list and `ticked === size` for a tournament.
  - `itemNoun(subject: unknown, count: number): string` returns "character"/"characters" when `subject` is truthy, else "book"/"books". It is the only place this copy is decided.
    - `contentDetail`, `contentStats` and `gameActionLabel` (`community/helpers.ts:23`, which gives "Rank characters") use it.
    - So do mobile `arenaHome.ts:196,214` and web `ArenaListPage.tsx:309` (the "-book bracket" line).
    - Examples: `"12 characters · 3 ballots"` and `"8-character bracket · active"`.
  - `bookTierlists<T extends { subject?: unknown }>(lists: T[]): T[]` keeps the lists without a subject, for the mural pickers.
  - In the book-screen model (`packages/shared/src/works/bookScreen.ts:121`), `characters` gains `canMakeGame: boolean`, true when the work's own list has ≥ 4 names.

- [ ] **Step 1: Write failing tests**
  - In `characters.test.ts`:
    - `characterBooks` maps a 2-character subject to `[{ Title: "Harry Potter", _workId: "ch:s:harry potter|harry potter", _character: true }, …]`.
    - `booksByWork(characterBooks(s)).get(id)?.Title === name`.
    - `isCharacterBook` is false for a library book.
    - `characterSnapshot` yields entries with `author === scope.label` and all four nullable fields `null`.
  - Picker helpers:
    - `bracketSizes(3)` is `[]`, `bracketSizes(10)` is `[4, 8]`, and `bracketSizes(300)` ends at 128.
    - `defaultTicked` for a tier list with 25 characters gives 20 ids; for a tournament at size 8 it gives 8.
    - `canCreate("tournament", 7, 8)` is false and `canCreate("tierlist", 4, 0)` is true.
  - `bookTierlists([{ subject: null }, { subject: {…} }])` has length 1.
  - In `bookScreen.test.ts`, `canMakeGame` is false with 3 names and true with 4.
  - In `helpers.test.ts`, a tier list summary with `subject: { kind: "characters", label: "Harry Potter" }`, `poolSize: 12` and `ballotCount: 3` gives `contentDetail` `"12 characters · 3 ballots"`. A book summary is unchanged.
  - In the two api tests, update the expected paths for `fetchTierlists` and `fetchMyTournaments`, and add rows for the two create calls.
- [ ] **Step 2: Run** `npm test --workspace @scripta/shared`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the types, helpers and API changes above. Export `./characters/index.js` from `packages/shared/src/index.ts`.
- [ ] **Step 4: Run** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`. Expected: PASS.
- [ ] **Step 5: Commit** `git add packages/shared && git commit -m "Add shared character subject types and helpers"`

### Task 2: Books `castOf` and `GET /works/:id/cast`

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/domain/cast.ts`
- Create: `backend/src/modules/books/domain/cast.test.ts`
- Modify: `backend/src/modules/books/works.ts`
- Modify: `backend/src/modules/books/index.ts`
- Modify: `backend/src/modules/works/service.ts`
- Modify: `backend/src/modules/works/plugin.ts`
- Modify: `backend/src/modules/works/routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/package.json`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/works/routes.test.ts`
- Test: `backend/src/modules/works/service.test.ts`

**Interfaces:**
- Consumes: `WorkCast` from Task 1; `personNameKey` (`books/domain/workSubjects.ts:27`); `bestSeriesOf` and `charactersOf` (`sqliteBooksRepository.ts:1520`, `:1649`).
- Produces:
  - `BooksRepository.castRows(workId: string): CastRows | undefined`, which returns `undefined` for an unknown id. `CastRows` is:

    ```
    { work: { id; title; coverImageId: string | null };
      series: { name; nameKey } | null;
      members: Array<{ id; position: string | null; people: string[] }> }
    ```

    - `work.id` is canonical.
    - The members are the canonical works whose best series has `series.nameKey`. Without a series, the member is the work alone.
    - `people` comes from the alias-aware `charactersOf`.
  - `buildCast(rows: CastRows, coverUrl: (imageId: string) => string): WorkCast` in `domain/cast.ts`, a pure function.
  - `getWorkCast(workId: string): WorkCast | undefined`, exported from `books/index.ts`.
  - The route `GET /works/:id/cast`: 200 with the `WorkCast`, 404 `{ error: "No book with that id." }`, `Cache-Control: no-store`, optional auth.

- [ ] **Step 1: Write failing `cast.test.ts` for `buildCast`.**
  - Ids are `ch:s:<nameKey>|<personNameKey>` for a series and `ch:w:<workId>|<personNameKey>` for a single work.
  - **Spelling:** "Potter, Harry" in position 2 and "Harry Potter" in position 1 give one character named "Harry Potter" with `works: 2`. This is Review Focus 1. The cleaned names in storage are already "First Last"; the test asserts the union by `personNameKey` and that the spelling comes from position 1.
  - **Order:** more `works` first, then the lower index inside its list, then the name.
  - **Scope:** `label` is the series name or the work title; `workCount` is `members.length`; `coverUrl` is built from `work.coverImageId` by the `coverUrl` function passed in (`buildCast(rows, coverUrl)`), the same way `getWorkPageWith` does (`books/works.ts:60,84`).
- [ ] **Step 2: Write a failing repository test for `castRows`.**
  - Work A's best series is "Discworld". Work B has rows for both "Discworld" and "Discworld - Rincewind", and its best is "Discworld - Rincewind" (seed sources so the ranking decides).
  - Expected: `castRows(A).members` excludes B. This is Review Focus 2.
  - An alias id resolves to its canonical work, and an unknown id returns `undefined`.
- [ ] **Step 3: Write a failing route test.** It covers 404 for an unknown id, a 200 body shape, and the `no-store` header.
- [ ] **Step 4: Run** `npm test --workspace backend`. Expected: the new tests FAIL.
- [ ] **Step 5: Implement.**
  - `castRows`:
    - Reuse `bestSeriesOf`. Add `nameKey` to its returned `SeriesEntry` if that is the smallest change; `top.nameKey` is already in scope at `:1544`.
    - Candidate members come from `work_series` rows with that `name_key`. Keep the canonical ids whose `bestSeriesOf` key matches.
    - `coverImageId` is the first edition's `cover_image_id` that is set, matching the book screen's fallback (`works/service.ts:98`). `getWorkCast` passes `(id) => coverUrlFor(id, "file")` the way `getWorkPage` does.
  - Wire `getWorkCast` through `WorksDeps` (wrapped in `WorkResolutionError` like `charactersOf` in `works/plugin.ts:23`) and `app.ts:225`.
  - Add `cast.test.ts` to `backend/package.json`'s test list.
  - Add `getWorkCast` to the `WorksDeps` fixture in `works/service.test.ts:46`.
- [ ] **Step 6: Run** `npm run typecheck --workspace backend && npm test --workspace backend`. Expected: PASS.
- [ ] **Step 7: Commit** `git commit -m "Add work cast read and GET /works/:id/cast"`, after staging the files above.

### Task 3: Character tier lists (backend)

**Files:**
- Modify: `backend/src/modules/tierlists/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts`
- Modify: `backend/src/modules/tierlists/domain/ports.ts`
- Modify: `backend/src/modules/tierlists/domain/types.ts`
- Modify: `backend/src/modules/tierlists/service.ts`
- Modify: `backend/src/modules/tierlists/routes.ts`
- Modify: `backend/src/modules/tierlists/wire.ts`
- Modify: `backend/src/modules/tierlists/plugin.ts`
- Modify: `backend/src/modules/tierlists/adapters/communityGameSource.ts`
- Test: `backend/src/modules/tierlists/service.test.ts`
- Test: `backend/src/modules/tierlists/routes.test.ts`
- Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`
- Test: `backend/src/modules/tierlists/wire.test.ts`

**Interfaces:**
- Consumes: `getWorkCast` (Task 2); `characterSnapshot` and `CharacterSubject` (Task 1).
- Routes: the tier list routes canonicalize every id through the works layer: `knownWorkIds` at `routes.ts:292`, plus `boardBooks`, `canonicalFirst` and `canonicalBoard` in `wire.ts`.
  - For a list with a subject, every route uses the identity mapping instead.
  - `characterView(pool: string[]): { canonical: Map<string, string>; first: Set<string> }` in `wire.ts` returns an identity map and `new Set(pool)`.
  - The vote board's `books` is `characterSnapshot(subject)` in pool order.
  - Ballot submit checks each placement id is in the pool, with no `knownWorkIds`.
  - The owner `GET`/`PUT /tierlists/:id` and `open-voting` routes skip works canonicalization.
- Produces:
  - `TierlistWorks.castOf(workId: string): WorkCast | undefined`.
  - `TierlistRow.subject: string | null`.
  - `createTierlist(userId, { name, characters: { workId, characterIds } })`.
  - The list route honours `?subjects=characters`.

- [ ] **Step 1: Write failing service tests.**
  - **Create:**
    - With 4 known cast ids, it stores `subject` with the frozen names and a default-preset board whose pool is the ids in cast order.
    - 3 ids is invalid. An id not in the cast is invalid. An unknown work is invalid.
  - **PUT `data`:**
    - A board containing an id outside `subject.characters`, or a real work id, is rejected. This is Review Focus 3.
    - Duplicates are rejected.
    - `knownWorkIds` is never called for a character list; assert it with a throwing stub.
  - **Publish (`openVoting`):** `public_books` equals `characterSnapshot(subject)` restricted to the pool, even when `publicBooksByWork` returns nothing and `knownWorkIds` throws.
  - **Cover peeks:** with a `peekCovers` stub that returns a URL for anything:
    - the published card's `covers` is `[scope.coverUrl]`;
    - the `emitVotedOn` ranking entries keep `coverUrl: null`;
    - `fillRankingCovers` returns the ranking unchanged;
    - `participationByOwner` covers are `[scope.coverUrl]`.

    This is Review Focus 4.
- [ ] **Step 2: Write failing repository, wire and route tests.**
  - **Repository:**
    - inserting, updating and publishing a list with a subject writes no `tierlist_works` rows;
    - the `shelfFacts` source leaves out a list with a subject;
    - `listParticipation` rows carry `subject`.
  - **`wire.test.ts`:** `characterView(["a", "b"])` maps each id to itself.
  - **Routes (`routes.test.ts`, real wire layer), on a published character list:**
    - `GET /tierlists/voting/:code` returns `books` with the character names in pool order;
    - `POST /tierlists/voting/:code/ballot` with pool ids returns 200;
    - the same with an id outside the pool, or a real work id, returns 400.

    This is Review Focus 3.
  - `GET /tierlists` leaves out character lists without `subjects=characters` and includes them with it.
  - The voting board and summaries carry `subject`, as `{kind, label}` on the summary and on `GET /tierlists/voted`'s `VotedTierlist`.
  - The migration adds `subject` to a database without it.
- [ ] **Step 3: Run** `npm test --workspace backend`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - The zod create schema becomes `name` + (`data` | `characters: { workId: string, characterIds: string[].min(4).max(500) }`), never both.
  - `storedBoard` branches on the row's subject.
  - The cover helpers (`fillMissingCovers`, `fillPublicBooks`, `publishedCovers`, `fillRankingCovers`, the participation covers) skip peeks when a subject is set.
  - `setWorks` (`sqliteTierlistsRepository.ts:150`) is skipped for rows with a subject.
  - The repository owner-list statement takes an `includeCharacters` flag. The shelf statements add `AND t.subject IS NULL`.
  - Profiles (`listByOwner` in `communityGameSource.ts`) always include character lists.
  - `plugin.ts` wires `castOf: getWorkCast`.
- [ ] **Step 5: Run** `npm run typecheck --workspace backend && npm test --workspace backend`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add character tier lists"`

### Task 4: Character tournaments (backend)

**Files:**
- Modify: `backend/src/modules/arena/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/arena/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts`
- Modify: `backend/src/modules/arena/domain/ports.ts`
- Modify: `backend/src/modules/arena/domain/types.ts`
- Modify: `backend/src/modules/arena/service.ts`
- Modify: `backend/src/modules/arena/routes.ts`
- Modify: `backend/src/modules/arena/plugin.ts`
- Modify: `backend/src/modules/arena/adapters/communityGameSource.ts`
- Test: `backend/src/modules/arena/service.test.ts`
- Test: `backend/src/modules/arena/routes.test.ts`
- Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`

**Interfaces:**
- Consumes: `getWorkCast` (Task 2); `CharacterSubject` (Task 1).
- Produces:
  - `ArenaWorks.castOf(workId: string): WorkCast | undefined`.
  - `createTournament(ownerUserId, { name, bracketSize, roundDurationMinutes, characters? })`. With `characters` it returns the started `Tournament`.
  - `GET /arenas/mine` honours `?subjects=characters`.

- [ ] **Step 1: Write failing service tests.**
  - **Create:**
    - With 8 cast ids and `bracketSize: 8`, the tournament is `active`, has 8 slots with `work_id` = character ids, `author = scope.label` and `cover_url` null, and round-1 duels exist.
    - With 10 ids and size 8, 8 distinct ids from the selection are used.
    - Size 2, size 6, size 16 with 10 ids, and an id outside the cast are each rejected.
  - Duplicate `characterIds` are rejected.
  - `emitPublished` fires once for the new tournament.
  - The published card's `covers` is `[scope.coverUrl]`, from `previewFromSlots` (`service.ts:118`).
  - **Seeding:** `setSlotsManual` and `randomFill` on a character tournament throw `TournamentAlreadyStartedError`.
  - **Votes:** voting with `workId` = a character id lands on its side when the `canonicalWorkIds` stub returns an empty map. This is Review Focus 5. A tiebreak by character id settles.
- [ ] **Step 2: Write failing repository and route tests.**
  - `topShelfFacts` leaves out a tournament with a subject.
  - `discoverByWorks([realWorkId])` doesn't return a character tournament.
  - `GET /arenas/mine` opt-in, as in Task 3.
  - `listPublishedByOwner`, which feeds profiles, includes character tournaments without the parameter.
  - `TournamentSummary.subject` is `{kind: "characters", label}`.
  - The migration adds `subject`.
- [ ] **Step 3: Run** `npm test --workspace backend`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - The zod create schema gains optional `characters: { workId, characterIds: string[].min(4).max(128) }`. When it is present, `bracketSize` is checked for a power of two, ≥ 4 and ≤ the number of ids.
  - Extract the Fisher-Yates shuffle (`service.ts:392-397`) into `shuffled<T>(items: T[]): T[]`, and the start body (`service.ts:410-423`) into a local `startSeeded(tournament)`. `randomFill`, `start` and the character create all call them.
  - Add `ArenaRepository.transaction<T>(fn: () => T): T`, in the shape of the existing adapter transactions, so create, slots and start commit together.
  - `plugin.ts` wires `castOf: getWorkCast`.
- [ ] **Step 5: Run** `npm run typecheck --workspace backend && npm test --workspace backend`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add character tournaments"`

### Task 5: Mobile: cast picker and book-screen entry

**Files:**
- Create: `mobile/src/features/characters/CastPickerScreen.tsx`
- Create: `mobile/src/app/(app)/(home,arena,library,search,you)/work/[id]/characters.tsx`
- Modify: `mobile/src/features/works/workPath.ts`
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `mobile/src/features/works/api.ts`
- Modify: `mobile/src/features/tierlists/api.ts`
- Modify: `mobile/src/features/arena/api.ts`

**Interfaces:**
- Consumes:
  - `fetchWorkCast`, `createCharacterTierlist` and `createCharacterTournament` (Task 1), re-exported from the feature `api.ts` files the same way `fetchWorkCharacters` is.
  - `bracketSizes`, `defaultTicked` and `canCreate` (Task 1).
- Produces: `workCharactersPath(id: string, segments: readonly string[]): string`, which returns `${workPath(id, segments)}/characters`.

This task adds no new unit test. Its logic is the Task 1 helpers; what's left is UI wiring, checked by typecheck here and by the device pass in Task 6.

- [ ] **Step 1: Implement.**
  - **Book screen:** the "Make a character game" button under the Characters line in `BookScreen.tsx`. It shows only when `model.characters.canMakeGame` (Task 1) is true and the viewer is signed in, and pushes `workCharactersPath(page.work.id, segments)`.
  - **Picker screen:**
    - header: the scope cover, the label and "N books" for a series;
    - a tier list / tournament segmented control;
    - a bracket-size control for a tournament;
    - the cast as a ticked list;
    - a name `Input` prefilled `"<label> characters"`;
    - the round duration control reused from the arena create flow;
    - a create button.
  - **After create:** `router.replace` to the tier list editor route (`tierlist/[id]`) or the arena view route (`arena/[id]`).
  - Use `ui/` components only.
- [ ] **Step 2: Run** `npm run typecheck --workspace mobile && npm test --workspace mobile`. Expected: PASS.
- [ ] **Step 3: Commit** `git commit -m "Add mobile cast picker"`

### Task 6: Mobile: render character games

**Files:**
- Modify: `mobile/src/features/tierlists/TierBoard.tsx`
- Modify: `mobile/src/features/arena/BookCover.tsx`
- Modify: `mobile/src/features/tierlists/TierlistEditorScreen.tsx`
- Modify: `mobile/src/features/tierlists/VoteTierlistScreen.tsx`
- Modify: `mobile/src/features/tierlists/TierlistShareImage.tsx`
- Modify: `mobile/src/features/arena/ArenaViewScreen.tsx`
- Modify: `mobile/src/features/arena/ArenaHomeScreen.tsx`
- Modify: `mobile/src/features/community/DiscoverRow.tsx`
- Modify: `mobile/src/features/arena/arenaHome.ts`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`
- Create: `mobile/src/features/characters/CharacterHeader.tsx`
- Test: `mobile/src/features/arena/arenaHome.test.ts`

**Interfaces:**
- Consumes: `characterBooks` and `isCharacterBook` (Task 1).

Mobile tests are node logic tests with no renderer, so the tile itself is checked in the device pass.

- [ ] **Step 1: Write a failing test** in `arenaHome.test.ts`. `votedTierlistDetail` (`arenaHome.ts:195`), for a `VotedTierlist` with a subject, `poolSize: 12` and `ballotCount: 3`, reads `"12 characters · 3 ballots"`.
- [ ] **Step 2: Run** `npm test --workspace mobile`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `TierCover` renders the character tile when `isCharacterBook(book)`:
    - the same footprint;
    - `accentSoft` background, using DESIGN.md tokens;
    - the name up to 3 lines, with no author line;
    - no `CoverImage`;
    - it calls `onLoadEnd` on mount, so `TierlistShareImage` becomes ready (`TierlistShareImage.tsx:24-25`).
  - Arena `BookCover` needs no change, because `cover: null` already renders the title.
  - **The editor:**
    - uses `characterBooks(tierlist.subject)` in place of library books when there is a subject;
    - hides "add books";
    - shows `CharacterHeader`, which has the scope cover and `"Characters · <label>"`.
  - The vote screen, results, share image and arena view pass `characterBooks(subject)` when there is a subject, and show `CharacterHeader`.
  - The arena slot and duel snapshots already carry the name as the title.
  - Community cards get their copy from Task 1's `contentDetail`/`contentStats`. In `DiscoverRow.tsx:53`, "See all N books" reads "See all N characters" when there is a subject.
  - Every "book" string in these flows comes from `itemNoun` (Task 1).
  - The `MuralEditorScreen` tier list block picker uses `bookTierlists(...)`.
- [ ] **Step 4: Run** `npm run typecheck --workspace mobile && npm test --workspace mobile`. Expected: PASS.
- [ ] **Step 5: Device pass.** Use `device-checker` with these screens:
  - the book screen action on a Harry Potter book from the fixture, or any fixture work with 4+ characters;
  - the picker;
  - the editor;
  - the vote page;
  - an arena duel.

  Expected: name tiles everywhere, no book covers on tiles, and a header caption. Per the "device pass gates merge, not PR" rule, the PR can open before the pass.
- [ ] **Step 6: Commit** `git commit -m "Render character games on mobile"`

### Task 7: Web: cast picker and book-screen entry

**Files:**
- Create: `frontend/src/pages/CharacterGamePage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Modify: `frontend/src/api/works.ts`
- Modify: `frontend/src/api/tierlists.ts`
- Modify: `frontend/src/api/arena.ts`

**Interfaces:**
- Consumes: Task 1's API functions and picker helpers.

Web tests are `frontend/scripts/test-*.mts` helper scripts with no renderer, and the logic here lives in Task 1's helpers. So this task is checked by typecheck, lint and a browser-preview pass.

- [ ] **Step 1: Implement.**
  - Add the route `/work/:id/characters` inside the signed-in route group in `App.tsx`.
  - Add the "Make a character game" link in the web `BookScreen.tsx` under the Characters line, shown when `model.characters.canMakeGame` is true and the viewer is signed in.
  - The page has the same controls as Task 5.
- [ ] **Step 2: Run** `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`. Expected: PASS.
- [ ] **Step 3: Preview.** Sign in with the dev fixture account in the browser pane (dev-account-fixture flow). Open `/work/<id>/characters` for a fixture work with 4+ characters, then create a tier list. Expected: the tier list is created and the editor opens with the selected count in its pool. Name tiles arrive in Task 8.
- [ ] **Step 4: Commit** `git commit -m "Add web cast picker"`

### Task 8: Web: render character games

**Files:**
- Modify: `frontend/src/components/murals/blocks/BookBlocks.tsx`
- Modify: `frontend/src/components/murals/BlockConfigPanel.tsx`
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/components/arena/DuelCard.tsx`
- Modify: `frontend/src/components/arena/BracketMap.tsx`
- Modify: `frontend/src/pages/TierListEditorPage.tsx`
- Modify: `frontend/src/pages/VoteTierlistPage.tsx`
- Modify: `frontend/src/components/tierlist/TierlistResultsView.tsx`
- Modify: `frontend/src/pages/ArenaViewPage.tsx`
- Create: `frontend/src/components/CharacterHeader.tsx`

**Interfaces:**
- Consumes: `characterBooks`, `isCharacterBook` and the community copy (Task 1).

There is no web renderer test harness, so this task is checked by a browser-preview pass.

- [ ] **Step 1: Implement** the same rules as Task 6, Step 3:
  - the tile branch in `MiniBookTile` (`BookBlocks.tsx:43`) and `DraggableTierTile` (`:264`), and in the vote page's own `CoverImage` tile (`VoteTierlistPage.tsx:89`);
  - `DuelCard` and `BracketMap` take a `character: boolean` from `tournament.subject !== null` and render the character tile instead of building a book for `CoverImage` (`BracketMap.tsx:41-43`);
  - the `BlockConfigPanel` tier list picker uses `bookTierlists(...)`;
  - `ArenaListPage.tsx:309` uses `itemNoun`;
  - `characterBooks(subject)` in the editor, vote page, results and arena view;
  - "add books" hidden;
  - `CharacterHeader`;
  - community cards already take their copy from Task 1;
  - the "book" → "character" copy.
- [ ] **Step 2: Run** `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`, then `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 3: Preview.** In the browser pane:
  - publish the Task 7 tier list and open its vote page signed out;
  - create an 8-character tournament and vote in one duel.

  Expected: name tiles with no `<img>` inside them, checked with `read_page`; the "Characters · <label>" header; the vote recorded.
- [ ] **Step 4: Commit** `git commit -m "Render character games on web"`
