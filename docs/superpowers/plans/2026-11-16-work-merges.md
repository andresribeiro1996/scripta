# Work Merges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Series ranking becomes pure functions in `domain/series.ts`. Work merging moves to its own port, `WorkMerges`, and its own adapter file, `sqliteWorkMerges.ts`. Behaviour does not change.

**Architecture:** `BooksRepository extends WorkMerges`. `createSqliteBooksRepository` composes `createSqliteWorkMerges(db, helpers)` into the object it returns, so wiring, `timedMethods` and `transaction` are untouched.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-16-work-merges-design.md`

**Base:** `main`. This lane touches only `backend/src/modules/books/`, `backend/package.json` and `backend/README.md`.

`A` is `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` and `T` is its test file. Line numbers are as of `231b94f3`. Find tests by their titles, which are quoted below; the line numbers are only a hint.

## Global Constraints

- No behaviour change. Assertions in moved tests stay word for word; only imports and setup change.
- No comments in code. No new fakes: tests use SQLite `:memory:` with migrations, like `freshRepo()` (`T:29-32`).
- Every new `*.test.ts` goes into the explicit `test` list in `backend/package.json`.
- Read `docs/glossary.md` (Work merging, Series) before naming anything.
- Statements that both sides need are prepared on both sides. Each side prepares its own copy with the same SQL, rather than passing statements across.
- Drop imports that become unused. `WorkMergeError` stays in `A` for `detachEdition`.
- Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **A merge inside an outer `transaction(...)`** (as `seriesMergeRepair.ts` and `translationReview.ts` do) still joins it, because `inTransaction` is one function passed to both sides. Task 2.
- **`setWorkKey` still carries genre state** through the returned `carryGenreState`. The proof is T "setWorkKey's emptied work hands its genre state…" (`T:2608`), which stays in `T`. Task 2.
- **The EXPLAIN QUERY PLAN test** (`T:1601-1625`) imports the SQL constants from their new home and still asserts the covering index. Task 2.
- **The edition-collection query** still doesn't run when a work has no stored series (the `stored.length === 0` early return, A:754). Task 1.
- **`timedMethods`** still wraps every merge method as `books:<name>`, because they are spread onto the repository object. Task 2.

---

### Task 1: Pure series ranking

**Files:**
- Modify: `backend/src/modules/books/domain/series.ts`
- Test: `backend/src/modules/books/domain/series.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces, in `domain/series.ts`:
  - `type SeriesRow = { root: string; name: string; nameKey: string; position: string | null; source: SeriesSource; createdAt: string }`. The adapter maps `work_id` to its root before building these.
  - `type CollectionRow = { root: string; name: string; nameKey: string; position: string | null; createdAt: string }`.
  - `pickSeries(rows: SeriesRow[], collections: CollectionRow[]): Map<string, SeriesEntry & { nameKey: string }>`.
  - `rankSeriesMatches(names: Map<string, { name: string; exact: boolean }>, rows: Array<{ workId: string; nameKey: string; position: string | null; source: SeriesSource }>): SeriesMatch[]`. Its `rows` carry canonical work ids.
  - `SeriesMatch` moves from `ports.ts:32` into `series.ts`, and `ports.ts` imports it from there. That way `series.ts` doesn't import `ports.ts`.

- [ ] **Step 1:** Add in-process tests to `series.test.ts`, and watch them fail:
  - `pickSeries`:
    - wikidata beats hardcover;
    - an uncorroborated collection is ignored;
    - a corroborated collection becomes `ol-edition`;
    - equal rank goes to the earliest `createdAt`;
    - the position comes from the first same-`nameKey` row that has one.
  - `rankSeriesMatches`:
    - exact matches come before prefix matches, then more members first, then best rank;
    - the lowest rank is kept per work.
- [ ] **Step 2:** Cut the post-load logic of `bestSeriesWithKey` (A:756-774) into `pickSeries`, keeping the early return at A:754 in the adapter. Cut the matching, aggregation and sort of `searchSeries` (A:1613-1648) into `rankSeriesMatches`. The adapter keeps the statements and the `rootOf`/`canonicalWorkIds` resolution, and calls the two functions.
- [ ] **Step 3:** Delete only the adapter tests whose sole subject is the ranking rule: those at `T:3457`, `T:3465` and `T:4184`, which Step 1 now covers. Every other series test in `T` stays, because it needs SQLite (aliases, merge and undo following, canonical ids, diacritics, matching).
- [ ] **Step 4:** Run the backend typecheck and `npm test --workspace backend`. Run `node scripts/gate.mjs`, then commit.

### Task 2: `WorkMerges` port and adapter

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Create: `backend/src/modules/books/adapters/sqlite/sqliteWorkMerges.ts`
- Create: `backend/src/modules/books/adapters/sqlite/sqliteWorkMerges.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces:
  - `interface WorkMerges` with these methods, signatures unchanged: `mergeWorks`, `mergeDuplicateWork`, `addWorkAlias`, `mergeTranslation`, `undoMerge`, `groupTitleKeys`, `undoneMergeAmong`, `activeMerges`, `groupableTitleKeys`, `keyedWorksWithTitleKeys`, `isSeriesName`.
  - `BooksRepository extends WorkMerges`.
  - `type MergeHelpers = { inTransaction<T>(write: () => T): T; refreshSeriesAuthor(workId: string): void; applyJoinedJudgment(workId: string): void; liveWorkId(id: string): string | null; insertWork(workKey: string | null, title: string, author: string, createdAt: string): string }`. Check each signature against today's closure function and use the real one if it differs.
  - `createSqliteWorkMerges(db: DatabaseSync, helpers: MergeHelpers): WorkMerges & { carryGenreState(from: string, into: string): void }`.

- [ ] **Step 1: Move the merge tests.** Move these tests from `T` to `sqliteWorkMerges.test.ts`, by title, with their bodies unchanged:
  - `mergeWorks`, plus the one-hop and refusal cases around `T:1115-1170`;
  - `T:1236` "a keyless work joins the single keyed work…";
  - the title-grouping and `groupTitleKeys` cases (skip, limit, undo veto) in `T:1247-1489` and `T:3019-3244`;
  - the covering-index plan test (`T:1601-1625`);
  - the merge carry cases for summary, genre judgment, rejection and record in `T:2392-2399`, `T:2540-2607`, `T:2609-2673`, `T:2675-2760` and `T:2796-3018`;
  - the `undoMerge` and `undoneMergeAmong` cases.

  Leave these in `T`:
  - the ISBN-10 pass tests (`T:1490-1542`);
  - publisher URLs (`T:2400`);
  - `T:2608`;
  - editions of works (`T:2674`);
  - the retitle tests (`T:3245`, `T:3257`);
  - `setWorkKey` (`T:1172`) and `detachEdition` (`T:1184-1210`).

  Copy (don't move) the env preamble and dynamic imports (`T:8-24`), `freshRepo`, and the helpers the moved tests use: `groupingFixture`, `mergedPairs`, `AT`, `mergeRows`, `fourthWing`, `lupin`, `blockedBooks`, `foldAsTitleKey`, `heldNeedle`. Delete each helper from `T` only if nothing left in `T` uses it.

  Add the new file to the `backend/package.json` `test` list. Both files pass before any source change. The test count across the two files equals the count before.
- [ ] **Step 2:** In `ports.ts`, declare `WorkMerges`, move those method signatures into it, and make `BooksRepository extends WorkMerges`.
- [ ] **Step 3:** Create `sqliteWorkMerges.ts`. Move into it:
  - **Merge-only statements:**
    - `recordMergeStmt`, `latestMergeStmt`, `moveBackStmt`, `moveGroupedBackStmt`, `repointGroupedBackStmt`, `unmergeStmt`, `repointBackStmt`, `clearCarriedSummaryStmt`, `markUndoneStmt`;
    - `markMergedStmt`, `carryWorkSummaryStmt`, `moveWorkEditionsStmt`, `workEditionIdsStmt`, `undoneMergeAmongStmt`, `fillWorkFromEditionsStmt`, `activeMergesStmt`, `isSeriesNameStmt`;
    - the six genre-carry statements.
  - **The planner:** `groupableKeysStmt`, `keyedWorksStmt`, `keyedEditionsStmt`, `keylessCandidatesStmt`, `GROUPABLE_CANDIDATES_CTE`, the four exported SQL constants and `titleWorks`.
  - **Its own copies** of `workLinkStmt`, `workStmt`, `aliasStmt` and `repointMergedStmt`, with the `WorkLink` type. `A` keeps its copies for `liveWorkId`, `detachEdition`, `setWorkKey` and A:1394.
  - **`MergeRecord`, `mergeInto`, `carryGenreState`, `groupTitleKeys`,** using `planTitleFolds` and `TitleWork`, and the `WorkMerges` methods.

  In `createSqliteBooksRepository`, build `helpers`, call `createSqliteWorkMerges(db, helpers)`, and spread every method except `carryGenreState` into the returned repository. `setWorkKey` calls the returned `carryGenreState`. Point the test imports of the SQL constants at the new file.
- [ ] **Step 4:** Run the backend typecheck and `npm test --workspace backend`. Run `node scripts/gate.mjs`, then commit.

### Task 3: Merge callers depend on `WorkMerges`

**Files:**
- Modify: `backend/src/modules/books/duplicateWorks.ts`
- Modify: `backend/src/modules/books/seriesMergeRepair.ts`
- Modify: `backend/src/modules/books/seed/awardBooksImport.ts`
- Modify: `backend/README.md`

- [ ] **Step 1:** In `duplicateWorks.ts` (:8, :81), `seriesMergeRepair.ts` (:14-17, :35) and `seed/awardBooksImport.ts` (:123), split `Pick<BooksRepository, ...>` so the merge methods come from `Pick<WorkMerges, ...>` and the rest, including `transaction`, stays on `BooksRepository`. `translationJudgments.ts`, `translationBacklog.ts`, `translationReview.ts` and `saveHits.ts` take the whole `BooksRepository` and are not changed.
- [ ] **Step 2:** In `backend/README.md`, add `sqliteWorkMerges.ts` (merge rules) to the books module layout block around `:938-955`, and note `domain/series.ts` as the home of series ranking.
- [ ] **Step 3:** Run the backend typecheck and tests. Run `node scripts/gate.mjs`, then commit.
