# One Row per Book in Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A catalog search shows one row per book. This means:
- duplicate Open Library works merge;
- editions saved by a search join their book at once and get their cover looked up at once;
- a work's row shows an edition with a cover.

**Architecture:**
- **Pure planners:** `domain/duplicateWorks.ts` decides which keyed works are duplicates, and which keyed work a keyless one folds into when a title key has several. Both decide on the full title, not only the title key.
- **Repository:** it gains the reads, the `ol-duplicate` merge, and title-key grouping for chosen keys. Its undo leaves grouped editions alone for `ol-duplicate`.
- **Service and callers:** a service module (`duplicateWorks.ts`) applies the undone-merge and arena guards. It is called from `saveHits` for the saved keys, and from a paced script for the whole catalog.

The nightly wiring is a follow-up PR, kept out of this plan's checkboxes.

**Tech Stack:** Fastify/TypeScript, `node:sqlite`, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-21-fold-duplicate-works-design.md`

## Global Constraints

- `npm test --workspace backend` names its test files explicitly. Add every new `*.test.ts` to the `test` script in `backend/package.json`.
- API changes stay additive. This plan adds and removes no response fields.
- Cover lookups scheduled at save use the `normal` lane. The ISBNdb search spend is never used for covers.
- The merge source string is exactly `ol-duplicate`.
- "Full title" means `normalizeWords(title)` from `@scripta/shared`, with no colon cut and no bracket removal.
- These placeholder first authors are never merged. They are compared to `firstAuthor(author)`:
  `["anonymous", "anon", "anonimo", "unknown", "unknown author", "desconhecido", "desconocido", "inconnu", "autor desconhecido", "various", "various authors", "varios", "varios autores", "autores varios", "aa vv", "vv aa"]`
- Save-time grouping folds at most 50 works per request.
- No code comments (AGENTS.md). Put the reasons in commit messages.
- Verify each task with `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`.

## Review Focus

1. **A novel and its graphic novel, coloring book or companion** share a title key. Expected: no duplicate merge between them, and a keyless "X: The Graphic Novel" edition never folds into the novel when the graphic novel's work exists. Tested in Tasks 1 and 2.
2. **An undone `ol-duplicate` merge stays undone,** at save, in the walk, and through a third duplicate that would become the survivor. Undoing it leaves the survivor's own editions in place. Tested in Tasks 2 and 3.
3. **Two works in one arena tournament** are never merged, at save or in the walk. Tested in Tasks 3 and 5.
4. **A query matching only a translated title** keeps showing that edition. The swap only uses a covered edition with the same full title. Tested in Task 4.
5. **Save-time grouping touches only the saved keys and stops at 50 folds.** Another key's groupable pair stays apart until the nightly run. Tested in Tasks 2 and 5.

---

### Task 1: Planners for duplicate works and crowded-key folds

**Files:**
- Create: `backend/src/modules/books/domain/duplicateWorks.ts`
- Test: `backend/src/modules/books/domain/duplicateWorks.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `workTitleKey` (`domain/normalize.ts:123`), and `firstAuthor` and `normalizeWords` from `@scripta/shared`.
- Produces:
  - `export interface KeyedWork { titleKey: string; id: string; title: string; author: string; editions: number; createdAt: string }`
  - `export interface DuplicateSet { titleKey: string; into: string; from: string[] }`
  - `export function planDuplicateSets(works: KeyedWork[]): DuplicateSet[]`
  - `export interface KeyWork { titleKey: string; workId: string; title: string; keyed: boolean }`
  - `export function planCrowdedFolds(works: KeyWork[]): Array<{ source: string; target: string }>`

- [ ] **Step 1: Write the failing tests**

`KEY` is `workTitleKey("Fourth Wing", "Rebecca Yarros")`.

```ts
test("merges keyed works with the same full title into the one with the most editions", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 2, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-b", title: "Fourth WIng", author: "Rebecca Yarros", editions: 9, createdAt: "2026-09-02" }
  ]), [{ titleKey: KEY, into: "w-b", from: ["w-a"] }]);
});
test("keeps a graphic novel apart from the novel it shares a title key with", ...);
test("breaks an editions tie by the oldest work, then the lowest id", ...);
test("leaves out a work whose own title key differs from the shared edition key", ...);
test("never merges works with an empty or placeholder first author", ...);
test("folds a keyless work into the one keyed work with its full title", ...);
test("leaves a keyless work alone when no keyed work, or several, have its full title", ...);
```

- The graphic-novel test lists "Fourth Wing" and "Fourth Wing: The Graphic Novel", both under `KEY`, and expects `[]`.
- The misfiled test lists an "Iron Flame" work under `KEY` and expects it to appear in no set.
- The placeholder test uses authors "Anónimo", "AA.VV." and "".
- The fold tests use `KEY` rows: keyed "Fourth Wing" (`w-novel`), keyed "Fourth Wing: The Graphic Novel" (`w-gn`), keyless "Fourth wing" (`k-1`) and keyless "Fourth Wing: The Graphic Novel" (`k-2`). They expect `[{ source: "k-1", target: "w-novel" }, { source: "k-2", target: "w-gn" }]`.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test --workspace backend`
Expected: FAIL, functions not defined.

- [ ] **Step 3: Implement both planners**

- **`planDuplicateSets`:**
  1. Keep a work when `workTitleKey(title, author) === titleKey` and `firstAuthor(author)` is not a placeholder. Drop repeated ids.
  2. Group by `titleKey` plus full title. In a group of 2 or more, the survivor sorts first by `editions` descending, then `createdAt` ascending, then `id` ascending.
- **`planCrowdedFolds`:**
  1. Per `titleKey`, for each keyless work, find the keyed works whose full title equals its own.
  2. Exactly one match gives a fold. None or several give nothing.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/duplicateWorks.ts backend/src/modules/books/domain/duplicateWorks.test.ts backend/package.json
git commit -m "Plan duplicate-work merges and crowded-key folds by full title"
```

### Task 2: Repository reads, the duplicate merge, keyed grouping and a safe undo

**Files:**
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: Task 1's `KeyedWork` and `planCrowdedFolds`; the existing `mergeInto`, `GROUPABLE_KEYS_SQL`, `GROUPABLE_PAIRS_SQL`, `undoMerge` and `WorkMergeError`.
- Produces, added to `BooksRepository`:
  - `keyedWorksWithTitleKeys(keys: string[]): KeyedWork[]`. One row per live keyed work and matching edition key, counting only editions with `title_group_blocked_at IS NULL`. `editions` counts all of the work's editions; `createdAt` is `works.created_at`.
  - `groupableTitleKeys(after: string, limit: number): string[]`, which runs `GROUPABLE_KEYS_SQL`.
  - `undoneMergeAmong(workIds: string[]): boolean`. True when a `work_merges` row with `undone_at IS NOT NULL` joins any two of the ids.
  - `mergeDuplicateWork(fromId: string, intoId: string, at: string): string`. Runs in a transaction. It throws `WorkMergeError` unless both works are live and keyed, and differ. Then it calls `mergeInto(from, into, { source: "ol-duplicate", confidence: null, at, carrySummary: true })`.
  - `groupTitleKeys(keys: string[], limit: number, at?: string): number`. For exactly these keys:
    1. Run the existing `GROUPABLE_PAIRS_SQL` rule.
    2. For keys with 2 or more live keyed works, add the `planCrowdedFolds` pairs. Those are built from the same candidate rules: every edition shares one non-empty key, and none is blocked.
    3. Merge up to `limit` pairs in total with source `title-key`.

    `groupKeylessWorks(limit, at)` keeps its signature and runs `groupTitleKeys` per page of `GROUPABLE_KEYS_SQL` keys, so the nightly run gets the crowded rule too.
  - `undoMerge` reads the merge's `source`. For `ol-duplicate` it skips `moveGroupedBackStmt` and `repointGroupedBackStmt`.
- `MergeSource` (`domain/types.ts:109`) gains `"ol-duplicate"`.

- [ ] **Step 1: Write the failing tests**

Tests:
- `keyedWorksWithTitleKeys lists live keyed works with an edition under the key`. Add a query-plan assertion for its statement, as `sqliteBooksRepository.test.ts:1488` does for grouping: it must use `idx_books_title_work` and not scan `books`.
- `mergeDuplicateWork moves editions and logs an ol-duplicate merge`. Assert the `work_merges` row and `canonicalWorkIds([from]) → into`. Also assert that `setWorkKey(newEdition, fromKey)` files a new edition under `into`.
- `mergeDuplicateWork refuses a keyless or already merged work`
- `undoneMergeAmong is true after undoMerge, whichever way the ids are listed`
- `undoing an ol-duplicate merge keeps the survivor's own keyless editions`. Keyed B holds a keyless edition grouped before the merge and another grouped after it. Merge A into B, then undo. Assert that both keyless editions stay in B and that A gets back its own editions.
- `groupTitleKeys folds a keyless edition into the keyed work with its full title when a key has several keyed works`. Use the Piatkus "Fourth wing" and the graphic-novel case from Task 1.
- `groupTitleKeys groups only the keys it is given`, with two groupable pairs under different keys.
- `groupTitleKeys stops at its limit`

- [ ] **Step 2: Run them and see them fail**

Run: `npm test --workspace backend`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test --workspace backend`
Expected: PASS, including the existing `groupKeylessWorks` tests near `sqliteBooksRepository.test.ts:1191` and the grouping query-plan test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts
git commit -m "Merge duplicate keyed works, fold crowded keys by full title, and undo duplicates safely"
```

### Task 3: Merge duplicates for keys or the whole catalog, and allow undo

**Files:**
- Create: `backend/src/modules/books/duplicateWorks.ts`
- Test: `backend/src/modules/books/duplicateWorks.test.ts`
- Modify: `backend/src/modules/books/seriesMergeRepair.ts`
- Test: `backend/src/modules/books/seriesMergeRepair.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `planDuplicateSets` (Task 1); Task 2's repository methods; `undoReviewedMerges` (`seriesMergeRepair.ts:78`).
- Produces:
  - `export interface DuplicateDeps { repo: Pick<BooksRepository, "keyedWorksWithTitleKeys" | "groupableTitleKeys" | "undoneMergeAmong" | "mergeDuplicateWork">; sharesArena: (from: string, into: string) => boolean; now: () => number }`
  - `export interface DuplicateMerge { titleKey: string; from: string; into: string }`
  - `export interface DuplicateReport { merges: DuplicateMerge[]; undone: number; arena: number; gone: number }`. `merges` holds the merges made, or planned in a dry run; `gone` ones are excluded. `undone` counts skipped sets, and `arena` counts skipped pairs.
  - `export function mergeDuplicateWorks(deps: DuplicateDeps, titleKeys: string[], dryRun?: boolean): DuplicateReport`
  - `export async function walkDuplicateWorks(deps: DuplicateDeps, options: { dryRun: boolean; signal?: AbortSignal; pageSize?: number; pauseMs?: number }): Promise<DuplicateReport>`. `pageSize` defaults to 500 and `pauseMs` to 0.

- [ ] **Step 1: Write the failing tests**

Use a real repository, as `translationBacklog.test.ts` does:
- `merges duplicate keyed works for the given keys`
- `dry run reports the merge and changes nothing`
- `an undone duplicate merge stays undone`:
  1. Merge A into B, then undo with `undoReviewedMerges(repo, [A], …)`. Assert it succeeded.
  2. Add keyed C with more editions under the same key and full title.
  3. Run `mergeDuplicateWorks`, then `walkDuplicateWorks`. Expect zero merges and `undone: 1`, with A, B and C still apart.
- `skips works sharing an arena, at save and in the walk`, with `sharesArena: () => true` for both calls.
- `walk covers keys across pages`, with `pageSize: 1` and two duplicate keys.
- `walk stops when the signal is aborted`
- `walk pauses between pages when pauseMs is set`, using a fake timer or a measured delay of at least `pauseMs`.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test --workspace backend`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `duplicateWorks.ts` and extend undo**

- **`mergeDuplicateWorks`:**
  1. Plan from `keyedWorksWithTitleKeys(titleKeys)`.
  2. Skip a whole set when `undoneMergeAmong([into, ...from])`, and count it in `undone`.
  3. For each `from`, skip and count it in `arena` when `sharesArena(from, into)`. Otherwise, unless `dryRun`, call `mergeDuplicateWork(from, into, new Date(deps.now()).toISOString())`. A `WorkMergeError` there counts as `gone`; other errors propagate.
- **`walkDuplicateWorks`:**
  1. Page through `groupableTitleKeys(after, pageSize)`, running `mergeDuplicateWorks` per page and summing the reports.
  2. Between pages, await `setImmediate`, then sleep `pauseMs` when it's above 0.
  3. Return early when `signal.aborted`.
- **`seriesMergeRepair.ts`:**
  1. Add `"ol-duplicate"` to `SOURCES` and `UNDOABLE`.
  2. Change "no active code or jev join" to "no active code, jev or ol-duplicate merge".
  3. Update the assertions at `seriesMergeRepair.test.ts:166` and `:181`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/duplicateWorks.ts backend/src/modules/books/duplicateWorks.test.ts backend/src/modules/books/seriesMergeRepair.ts backend/src/modules/books/seriesMergeRepair.test.ts backend/package.json
git commit -m "Merge duplicate Open Library works for chosen keys or the whole catalog"
```

### Task 4: A work's row shows an edition with a cover

**Files:**
- Modify: `backend/src/modules/books/domain/workSearch.ts`
- Test: `backend/src/modules/books/domain/workSearch.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `normalizeWords` from `@scripta/shared`.
- Produces:
  - `export function coveredFirst<T>(items: T[], workIdOf: (item: T) => string | null, hasCover: (item: T) => boolean, titleOf: (item: T) => string): T[]`. It returns a reordered copy. For each work, when its first item has no cover, that item swaps places with the work's first later item that has a cover and the same full title.
  - `firstEditionPerWork(rows, canonical)`, with the same signature. It applies `coveredFirst` (a cover is `cover_image_id` or `ol_cover_id`) before taking the first row per work.

- [ ] **Step 1: Write the failing tests**

- `shows the work's covered edition when the best match has no cover and the same full title`. Rows: "Fourth wing" (no cover), then "Fourth WIng" (cover), same work. Expect the covered one.
- `keeps the best match when the covered edition has another full title`. Cover both a Portuguese-titled best row and "Fourth Wing: The Graphic Novel".
- `keeps works in the order of their best match`
- `treats an Open Library cover id as a cover`
- `coveredFirst keeps every item and only swaps within a work`

- [ ] **Step 2: Run them and see them fail**

Run: `npm test --workspace backend`
Expected: FAIL.

- [ ] **Step 3: Implement `coveredFirst` and use it in `firstEditionPerWork`**

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/workSearch.ts backend/src/modules/books/domain/workSearch.test.ts backend/package.json
git commit -m "Show a covered edition of the same full title on a work's search row"
```

### Task 5: Join, cover and order search-saved editions at once

**Files:**
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/src/modules/books/routes.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Consumes:
  - `mergeDuplicateWorks` (Task 3) and `groupTitleKeys` (Task 2);
  - `coveredFirst` (Task 4);
  - the existing `lookupDue` and `schedule`.
- Produces: a new required `sharesArena: (from: string, into: string) => boolean` on `BooksServiceDeps`. `plugin.ts` passes the `sharesArena` from line 100. Test constructions pass `() => false`.

- [ ] **Step 1: Write the failing tests**

All tests go through `searchExternal`, with a fake catalog returning the hits:
- `a saved ISBNdb edition joins the keyed work with its title key in the same search`
- `a search that saves an edition merges two duplicate keyed works for its key`. The rows share one `workId`, and an `ol-duplicate` merge is logged.
- `a saved edition without a cover is queued on the normal lane`. The `enqueue` spy got `(bookId, "normal")`.
- `a saved edition that already has a cover is not queued`
- `works sharing an arena stay apart when a search saves an edition`
- `a search leaves another key's groupable pair apart`
- `a work's covered result comes first among results with its workId`. The ISBNdb coverless hit is first and an Open Library covered hit with the same full title comes later. Expect the covered one first among that `workId`.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test --workspace backend`
Expected: FAIL.

- [ ] **Step 3: Implement in `saveHits` (`booksService.ts:255`)**

After the save loop and before `canonicalWorkIds`:
1. Collect the saved books' distinct non-null `title_key`.
2. Call `mergeDuplicateWorks({ repo: deps.repo, sharesArena: deps.sharesArena, now: () => now().getTime() }, keys)`.
3. Call `deps.repo.groupTitleKeys(keys, 50, now().toISOString())`.
4. Call `schedule(book.id)` for each saved book with no `cover_image_id` where `lookupDue(book)` holds.
5. Apply `coveredFirst` to the final results by `workId`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/booksService.ts backend/src/modules/books/plugin.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/routes.test.ts
git commit -m "Join, queue covers for and order the editions a search saves, in the same request"
```

### Task 6: Catalog-wide script and docs

**Files:**
- Create: `backend/scripts/merge-duplicate-works.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `walkDuplicateWorks` (Task 3); `matchCandidates` (`ports.ts:108`); `createWorkHolders(...).heldWorks()` (`library/workHolders.ts`); `arenaCheck` and `createSqliteArenaRepository`, used as in `translation-backlog.mjs:19-29`.
- Produces: `node scripts/merge-duplicate-works.mjs --dry-run | --apply`.
  - It requires `COVERS_DB_PATH`, `LIBRARY_DB_PATH` and `ARENA_DB_PATH`, as `translation-backlog.mjs:10` does.
  - `--dry-run` opens `COVERS_DB_PATH` read-only.
  - `--apply` uses `openBooksDb()`, then `PRAGMA busy_timeout = 120000`, then walks with `pageSize: 100, pauseMs: 250`.
  - It prints one summary line `{ mode, merges, undone, arena, gone }`, then a JSON array with one item per merge: `{ titleKey, held, from: { id, title, author, year, editions, languages }, into: { … } }`. `held` is true when either side, canonicalised, is on a reader's shelf.

- [ ] **Step 1: Write the script and the README section**

The README section goes under works grouping. It covers:
- the duplicate rule and the crowded-key fold;
- the `ol-duplicate` source;
- undo through `scripts/undo-series-merges.mjs --undo`, and what that undo leaves in place;
- the translation-review caveat from the spec.

- [ ] **Step 2: Check the script runs**

Run, from `backend/`: `npm run build && COVERS_DB_PATH=data/dev/covers.sqlite LIBRARY_DB_PATH=data/dev/library.sqlite ARENA_DB_PATH=data/dev/arena.sqlite node scripts/merge-duplicate-works.mjs --dry-run`
Expected: a summary line with `"mode":"dry-run"`, and exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/merge-duplicate-works.mjs backend/README.md
git commit -m "Add a reviewed dry run and paced apply for merging duplicate Open Library works"
```

## Stop here

Open the PR for Tasks 1–6 and stop. The nightly wiring below is **not** part of this plan's execution. It ships as its own PR only after the production apply has been reviewed and run.

## Follow-up PR, after the production apply (not a task of this plan)

- `startWorksGrouping` (`backfill.ts:109`) gains `mergeDuplicates: (signal: AbortSignal) => Promise<number>`, which runs before the keyless drain. A non-zero count logs `"merged duplicate Open Library works"`.
- `plugin.ts:182` passes `(signal) => walkDuplicateWorks({ repo, sharesArena, now: Date.now }, { dryRun: false, signal }).then((report) => report.merges.length)`.
- Test in `backfill.test.ts`: `works grouping merges duplicate works before grouping keyless ones`.

## Production runbook (after the PR deploys)

1. List the `ol-duplicate` merges that searches have made since the deploy: `SELECT * FROM work_merges WHERE source = 'ol-duplicate'`. Review them.
2. With the user's OK, start the dry run right after a `bnp sync` log line:
   `cd /app/backend && node scripts/merge-duplicate-works.mjs --dry-run > /data/duplicate-works.json`
3. The main session reviews:
   - every merge with `held: true`;
   - every merge where both sides have 5 or more editions;
   - a random 100 of the rest.

   Anything wrong goes back to the plan before applying.
4. Hold deploys, then run `node scripts/merge-duplicate-works.mjs --apply > /data/duplicate-works-applied.json`.
5. Search "fourth wing". Expect one novel row with a cover, and the graphic novel on its own row.
6. Undo one `ol-duplicate` merge with `scripts/undo-series-merges.mjs --undo`. Search its title, and check after the next nightly run that it stayed apart.
7. Open the follow-up PR.
