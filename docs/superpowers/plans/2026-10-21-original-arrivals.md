# Original Arrivals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a book arrives in the catalog through any path, the Portuguese works naming it as their original get the translation job's free code step again. The #317 guards hold, plus the #323 whole-title checks. Nothing reads the whole catalog per arrival.

**Architecture:**
1. **Indexed claims.** A stored, indexed `books.original_key`, equal to `originalKey(original_title)` and versioned by `ORIGINAL_KEY_VERSION`, lets the server find the claims of one key by index.
2. **A queue.** SQLite triggers record every new or changed `title_key`, and a book's first Open Library work key, in an `original_arrivals` queue.
3. **A drain.** A server job empties the queue every minute. For each key it:
   - turns the title key into an original key (`arrivalKey`);
   - loads that key's claims;
   - builds Guard 1 and the shared-original rule from those claims alone;
   - runs `planMatch` on the claimant works that still need a match;
   - applies only `code` joins into a work with an Open Library key, through the same helper `runCodeSteps` uses.

**Tech Stack:** Fastify/TypeScript backend, SQLite (`node:sqlite`), `@scripta/shared` (from `dist`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-21-original-arrivals-design.md`

## Global Constraints

- **No comments in code** (root `AGENTS.md`).
- **The worktree's `node_modules` is already linked** (`npm run dev:link-deps`). Before backend typecheck or tests, run `npm run build --workspace @scripta/shared`.
- **New test files** go in `backend/package.json`'s explicit `test` list.
- **`domain/translation.ts` is shared with the matcher-fix session** (branch `claude/eloquent-franklin-d0b337`). Only append new exports and move `sameWholeTitle` in. Don't change the body of any existing function there (`mainTitle`, `titlePattern`, `originalKey`, `claimGroups`, `seriesLikeOriginals`, …).
- **No `PRAGMA user_version` change.** The key backfill is gated on `ORIGINAL_KEY_VERSION`, stored in its own one-row table.
- **Reuse, don't copy:**
  - from `domain/translation.ts`: `originalKey`, `titlePattern`, `mainTitle`, `sameMainTitle`, `isPortuguese`, `surnameOf`, `evidenceOf`, `seriesLikeOriginals`, `originalTitleIn`, and the type `OriginalClaim`;
  - `normalizeTitle`, `normalizeWords`, `titleNumbers` from `@scripta/shared`;
  - `catalogTitleKey` from `domain/normalize.ts`;
  - `planMatch`, `TranslationDeps` from `translationJudgments.ts`;
  - `JEV_REJECTION_LIMIT` from `synopsisJudgments.ts`;
  - `startDetailsBackfill` from `backfill.ts`;
  - the repository's `getWorkView`.
- **Backend tests need the env preamble.** Set the env vars, then import modules dynamically, as `translationBacklog.test.ts:8-19` does.
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Guard 1 is exact.**
  - `seriesLikeOriginals(repo.originalClaimsOf(K))` is used only for works whose evidence original has `originalKey === K`. For those works it must equal the answer built from `originalTitleClaims()`.
  - That needs every writer of `original_title` to write `original_key` in the same statement, and the backfill to fill summary-derived originals first. A Task 1 test compares the two directly.
- **`manual` answers are never selected.** Claimants pass through `portugueseWorksNeedingMatch(ids, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, nowIso)`. Only `code` plans write.
- **Joins go only into a work with an Open Library key.** A later `setWorkKey` would otherwise split the original from its joined translation (`sqliteBooksRepository.ts:808-824`).
- **Reads are bounded.** The new reads are `originalClaimsOf`, `originalArrivals` and `getWorkView` on one target. None scans `books`; `originalClaimsOf` uses `idx_books_original_key`, which a test checks.
- **One transaction per key.** The checks, the joins and the queue delete commit together. Any error rolls back, and the key stays queued.
- **`arrivalKey` is right only while `title_key GLOB titlePattern(o)` holds exactly when `arrivalKey(title_key) === originalKey(o)`.** A test pins it.

### Task 1: Original keys and the arrivals queue

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/domain/translation.ts`
- Modify: `backend/src/modules/books/seed/summaryCleanup.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/domain/translation.test.ts`
- Test: `backend/src/modules/books/seed/summaryCleanup.test.ts`

**Interfaces:**
- **`domain/translation.ts`:** append two exports.
  - `export const ORIGINAL_KEY_VERSION = 1;`
  - `export function arrivalKey(titleKey: string): string | null`. It splits on `|`. It returns `` `${parts[0].slice(3)}|${parts[2]}` `` when the key starts with `ta:` and has exactly three parts, and null otherwise. For `"ta:to the lighthouse|virginia woolf|"` it returns `"to the lighthouse|"`.
- **`books.sql`:**
  - add `original_key TEXT` to `CREATE TABLE books`, right after `original_title`;
  - add `CREATE TABLE IF NOT EXISTS original_arrivals (title_key TEXT PRIMARY KEY);`;
  - add `CREATE TABLE IF NOT EXISTS original_key_version (version INTEGER NOT NULL);`.
- **`connection.ts`, in `applyBooksMigrations`:**
  1. After the existing column checks and index creations, create three triggers with `db.exec`:
     - `CREATE TRIGGER IF NOT EXISTS books_original_arrival AFTER INSERT ON books WHEN NEW.title_key <> '' BEGIN INSERT OR IGNORE INTO original_arrivals (title_key) VALUES (NEW.title_key); END`;
     - `CREATE TRIGGER IF NOT EXISTS books_original_retitle AFTER UPDATE OF title_key ON books WHEN NEW.title_key <> '' AND NEW.title_key IS NOT OLD.title_key BEGIN INSERT OR IGNORE INTO original_arrivals (title_key) VALUES (NEW.title_key); END`;
     - `CREATE TRIGGER IF NOT EXISTS books_original_keyed AFTER UPDATE OF ol_work_key ON books WHEN NEW.title_key <> '' AND OLD.ol_work_key IS NULL AND NEW.ol_work_key IS NOT NULL BEGIN INSERT OR IGNORE INTO original_arrivals (title_key) VALUES (NEW.title_key); END`.
  2. As the last call, after `clearNonTitleOriginals(db)`, call a new `keyOriginalTitles(db)`.
     - It reads `SELECT version FROM original_key_version`. When a row equals `ORIGINAL_KEY_VERSION`, it skips straight to the index.
     - Otherwise, in one `BEGIN IMMEDIATE`, with `COMMIT`/`ROLLBACK` as `clearNonTitleOriginals` does, it:
       1. runs `ALTER TABLE books ADD COLUMN original_key TEXT` when `PRAGMA table_info(books)` lacks it;
       2. for each `SELECT id, summary FROM books WHERE original_title IS NULL AND summary LIKE '%tulo original%'` row, sets `original_title` to `originalTitleIn(summary)` when that is non-null;
       3. for each `SELECT id, original_title FROM books WHERE original_title IS NOT NULL OR original_key IS NOT NULL` row, sets `original_key = original_title === null ? null : originalKey(original_title)`;
       4. runs `DELETE FROM original_key_version` then `INSERT INTO original_key_version (version) VALUES (?)` with the constant.
     - After `COMMIT` it logs `` console.log(`books: keyed ${n} original titles`) `` when n > 0, where n counts rows given a non-null key.
     - Always, it then runs `CREATE INDEX IF NOT EXISTS idx_books_original_key ON books(original_key) WHERE original_key IS NOT NULL`.
- **`domain/ports.ts`, `BooksRepository`:**
  - `originalClaimsOf(key: string): OriginalClaim[];`
  - `originalArrivals(limit: number): string[];`
  - `dropOriginalArrival(titleKey: string): void;`
- **`sqliteBooksRepository.ts`:**
  - `fillOriginalTitleStmt` becomes `UPDATE books SET original_title = ?, original_key = ? WHERE id = ? AND original_title IS NULL`. Both callers (`fillOriginalTitle` and `fillOriginalTitlesFromSummaries`) pass `originalKey(title)`.
  - `mergeDetailsStmt` adds `original_key = CASE WHEN ${takesSummary} AND original_title IS NULL THEN $original_key ELSE original_key END`. `mergeDetails` passes `$original_key`, which is `originalKey(originalTitle)` when the computed `$original_title` is non-null, and null otherwise.
  - `originalClaimsOf(key)`: `SELECT work_id, title, author, language, original_title FROM books WHERE original_key = ?`, mapped to `{ workId, title, author, language, originalTitle }`.
  - `originalArrivals(limit)`: `SELECT title_key FROM original_arrivals LIMIT ?`, mapped to strings.
  - `dropOriginalArrival(titleKey)`: `DELETE FROM original_arrivals WHERE title_key = ?`.
- **`seed/summaryCleanup.ts`, `applySummaryCleanup`:** `updateBook` adds `original_key = CASE WHEN original_title IS NULL THEN ? ELSE original_key END`. The new parameter is `originalKey(x)` for the original-title argument `x` it already passes, or null.

- [ ] **Step 1: Write the failing tests.**
  - **`translation.test.ts`:**
    - **`arrivalKey`:** malformed keys give null: `""`, `"isbn:9780000000000"`, `"ta:dune|frank herbert"` (two parts).
    - **Equivalence:** for each pair `[title, author, original]`, check that `title_key GLOB titlePattern(original)` holds exactly when `arrivalKey(catalogTitleKey(title, author)!) === originalKey(original)`. Evaluate GLOB with `new DatabaseSync(":memory:").prepare("SELECT ? GLOB ? AS hit")`. Cover both outcomes with:
      - `["To the Lighthouse", "Virginia Woolf", "To the Lighthouse"]`;
      - `["Dune: Messiah", "Frank Herbert", "Dune"]`;
      - `["Dune", "Frank Herbert", "Dune: Messiah"]`;
      - `["1984", "George Orwell", "1984"]`;
      - `["1984", "George Orwell", "1985"]`;
      - `["To the Lighthouse. A Novel", "Virginia Woolf", "To the Lighthouse"]`;
      - `["Le Petit Prince (illustré)", "Antoine de Saint-Exupéry", "Le Petit Prince"]`;
      - `["Harry Potter 2", "J. K. Rowling", "Harry Potter"]`;
      - `["L’Étranger", "Albert Camus", "L'Étranger"]`.
    - **Pin:** `["To the Lighthouse", "Dune: Messiah", "Les rois maudits. Le roi de fer", "Harry Potter 2", "Le Petit Prince (illustré)"].map(originalKey)` deep-equals the current outputs. The assertion message reads: "originalKey changed: bump ORIGINAL_KEY_VERSION so stored original_key values are recomputed". Also assert `ORIGINAL_KEY_VERSION === 1`.
  - **`sqliteBooksRepository.test.ts`:**
    1. **Existing test at `:1028`** ("the title key columns are added to an existing database once"): before its `DROP COLUMN title_key`, add `DROP TRIGGER books_original_arrival; DROP TRIGGER books_original_retitle; DROP TRIGGER books_original_keyed`. After its re-run of the migrations, assert the three triggers exist (`SELECT name FROM sqlite_master WHERE type = 'trigger'`).
    2. **Recording arrivals:**
       - `createBook` of "To the Lighthouse" by "Virginia Woolf" records `catalogTitleKey("To the Lighthouse", "Virginia Woolf")`, and `originalArrivals(10)` returns it;
       - `createBook` with author `""` records nothing;
       - `dropOriginalArrival` removes the key;
       - `fillIdentity` giving a blank-author row an author records its new key;
       - after dropping a row's queued key, a raw `UPDATE books SET title_key = title_key WHERE id = ?` records nothing;
       - after dropping a row's queued key, `setWorkKey(id, "OL5W")` on a row without a work key records its title key again. A second `setWorkKey` records nothing, since `setWorkKeyStmt` only writes a NULL key;
       - `originalArrivals(1)` returns one key when two are queued.
    3. **Keeping `original_key` current:**
       - `fillOriginalTitle(id, "To the Lighthouse")` sets `original_key` to `originalKey("To the Lighthouse")`;
       - `mergeDetails` (through whichever public method calls it, e.g. `saveDetails`) with a summary ending `Título original: Dune` on a row without an original sets both columns. On a row that already has an original title it changes neither;
       - `fillOriginalTitlesFromSummaries()` over a raw-SQL summary sets both columns.
    4. **`originalClaimsOf(originalKey("To the Lighthouse"))`** returns the pt edition's claim with `originalTitle` `"To the Lighthouse"` and its `workId`, `title`, `author` and `language`. The English edition has no original and isn't returned. `EXPLAIN QUERY PLAN` of `SELECT work_id FROM books WHERE original_key = ?` with a bound key mentions `idx_books_original_key`.
    5. **Guard 1 from the subset equals the full scan.** Set up these claims, then build the series rule two ways. For every claimed original and author, `seriesLikeOriginals(repo.originalClaimsOf(originalKey(o)!))(o, a)` equals `seriesLikeOriginals(repo.originalTitleClaims())(o, a)`.
       - three pt works with distinct titles by Janey Louise Jones claiming "Princess Poppy". One of them gets its original only as a raw-SQL summary `Título original: Princess Poppy`, then `applyBooksMigrations` is re-run after `DELETE FROM original_key_version`, so the backfill stores it;
       - two pt works claiming "To the Lighthouse".
    6. **Backfill:** on a fresh repo's `db`, insert one row with `original_title` "To the Lighthouse" and one with only a summary `Título original: Orlando`, both through raw SQL. Then simulate an old database: `DROP INDEX idx_books_original_key`, `ALTER TABLE books DROP COLUMN original_key` and `DELETE FROM original_key_version`. Run `applyBooksMigrations(db)` again. Then:
       - the first row's key is `originalKey("To the Lighthouse")`;
       - the second row's `original_title` is "Orlando" with a matching key;
       - the index exists;
       - `original_key_version` holds 1.

       Then:
       - with the version stored, a raw `UPDATE books SET original_key = 'x' WHERE id = ?` survives another `applyBooksMigrations(db)`, so there's no recompute;
       - after `UPDATE original_key_version SET version = 0`, the next `applyBooksMigrations(db)` restores the correct key, which is the recompute;
       - a row whose `original_title` was set to NULL with a stale key gets its key cleared by that recompute.
  - **`summaryCleanup.test.ts`:** where an existing test shows `applySummaryCleanup` filling `original_title` from the old summary, also assert `original_key` is `originalKey` of that title.
- [ ] **Step 2: Run them and watch them fail.**

  ```bash
  npm run build --workspace @scripta/shared && cd backend && npx tsx --test src/modules/books/domain/translation.test.ts src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/seed/summaryCleanup.test.ts
  ```

  They fail on the missing exports, column, triggers and methods.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass.
- [ ] **Step 5: Commit.** Message: `Key stored original titles and queue every arriving title key`. The body says why:
  - the arrival hook must find a title's claims by index, not by scanning 234k books;
  - triggers catch every writer, scripts included. The work-key trigger re-queues a title once its work is settled;
  - the recompute is gated on `ORIGINAL_KEY_VERSION`, not `user_version`, so a concurrent branch's version bump can't skip it, and a change to `originalKey` re-keys every row;
  - summary-derived originals are stored first, so a claim subset read by key gives Guard 1 its full count.

### Task 2: Shared whole-title helpers and the code-join helper

**Files:**
- Modify: `backend/src/modules/books/domain/translation.ts`
- Modify: `backend/src/modules/books/seed/originalsFill.ts`
- Modify: `backend/src/modules/books/translationBacklog.ts`
- Test: `backend/src/modules/books/domain/translation.test.ts`

**Interfaces:**
- **`domain/translation.ts`:**
  - Move `export function sameWholeTitle(title: string, originalTitle: string): boolean` here from `seed/originalsFill.ts`, unchanged.
  - Append `export function sharedOriginals(claims: OriginalClaim[]): SeriesLike`. It builds buckets exactly as `fillOriginals` does now (`originalsFill.ts:68-77`):
    - it skips claims that aren't `isPortuguese(claim.language)`, whose `originalKey(claim.originalTitle)` is null, whose `normalizeWords(claim.title)` is `""`, or where `sameMainTitle(claim.title, claim.originalTitle)`;
    - the key is `` `${originalKey(claim.originalTitle)}#${surnameOf(claim.author) ?? ""}` ``;
    - the sets are `titles` (`normalizeWords(claim.title)`) and `originals` (`normalizeWords(claim.originalTitle)`).

    The returned function `(originalTitle, author)` is true when `originalKey(originalTitle)` is non-null and the bucket `` `${originalKey(originalTitle)}#${surnameOf(author) ?? ""}` `` has `titles.size >= 2 || originals.size >= 2`.
- **`seed/originalsFill.ts`:**
  - import `sameWholeTitle` and `sharedOriginals` from `domain/translation.ts`;
  - delete the local `sameWholeTitle` and the `buckets` loop;
  - build `const isShared = sharedOriginals(claims);` next to `isSeriesLike`;
  - in the group loop, replace the bucket test with `isShared(group.originalTitle, group.author)`. `originalKey` and `surnameOf` are unchanged by `mainTitle` and `firstAuthor`, so the bucket is the same.

  Keep `pickOriginal` and the rest unchanged. Nothing outside the module imports `sameWholeTitle` today.
- **`translationBacklog.ts`:** extract the code-join branch of `runCodeSteps` as `export function joinByCode(deps: Pick<TranslationDeps, "repo" | "sharesArena">, workId: string, intoWorkId: string, at: string): boolean`. It returns true when merged and false when blocked by an arena. It keeps the same `deps.repo.transaction` around `saveWorkMatchJudgment` and `mergeTranslation`, and no new catch. `runCodeSteps` calls it and keeps its counts.

- [ ] **Step 1: Write the failing tests** in `translation.test.ts` for `sharedOriginals` over hand-made `OriginalClaim[]`:
  - "Passeio ao Farol" and "Rumo ao Farol" (pt-PT, Virginia Woolf, original "To the Lighthouse") → true for `("To the Lighthouse", "Virginia Woolf")`.
  - The same title twice from two works → false.
  - "Crónicas" claiming "Chronicles" and another "Crónicas" claiming "Chronicles: Dusk", both by Ana Silva → true for `("Chronicles", "Ana Silva")`.
  - An English claim and a `sameMainTitle` claim ("Orlando" claiming "Orlando") don't count.
  - Another surname's bucket is separate.
  - Also `sameWholeTitle`: `("Dune", "Dune: Messiah")` → false, `("Dune: Messiah", "Dune: Messiah")` → true.
- [ ] **Step 2: Run them and watch them fail** (same command as Task 1, `translation.test.ts` only).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. `originalsFill.test.ts` and `translationBacklog.test.ts` pass unchanged.
- [ ] **Step 5: Commit.** Message: `Share the whole-title checks and the code join with the arrival hook`.

### Task 3: The arrivals drain, its wiring and the README

**Files:**
- Create: `backend/src/modules/books/originalArrivals.ts`
- Test: `backend/src/modules/books/originalArrivals.test.ts`
- Modify: `backend/package.json`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`

**Interfaces:**
- **`originalArrivals.ts`:**
  - `export const ORIGINAL_ARRIVALS_BATCH = 500;`
  - `export const ORIGINAL_ARRIVALS_INTERVAL_MS = 60 * 1000;`
  - `export type ArrivalSteps = { arrivals: number; claimants: number; codeMerges: number; codeBlocked: number };`
  - `export type ArrivalDeps = Pick<TranslationDeps, "repo" | "sharesArena" | "now">;`
  - `export function joinArrivedOriginals(deps: ArrivalDeps, limit: number): ArrivalSteps` (synchronous). For each `titleKey` of `deps.repo.originalArrivals(limit)`, `arrivals++`, then inside one `deps.repo.transaction(() => { … })`:
    1. `const key = arrivalKey(titleKey)`. If it is null, go to step 6.
    2. `const claims = deps.repo.originalClaimsOf(key)`. If it is empty, go to step 6.
    3. `const seriesLike = seriesLikeOriginals(claims)`, `const shared = sharedOriginals(claims)` and `const at = new Date(deps.now()).toISOString()`.
    4. Find the claimant works:
       - `const ids = [...new Set(deps.repo.canonicalWorkIds(claims.flatMap((claim) => (claim.workId ? [claim.workId] : []))).values())]`;
       - `const works = deps.repo.portugueseWorksNeedingMatch(ids, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, at)`.
    5. For each `workId` of `works`:
       1. `rows = deps.repo.translationEvidence(workId)`. Skip the work when that is undefined.
       2. `evidence = evidenceOf(rows)`, `original = evidence.originalTitle` and `author = evidence.workAuthor || evidence.author`.
       3. Skip the work when:
          - `!original || originalKey(original) !== key`;
          - `normalizeWords(original) !== normalizeTitle(mainTitle(original))`;
          - `shared(original, author)`.
       4. `claimants++`, then `plan = planMatch(deps.repo, workId, seriesLike)`. Skip unless `plan?.kind === "code"`.
       5. `const target = deps.repo.getWorkView(plan.intoWorkId)`. Skip unless `target?.olWorkKey` and `target.editions.some((edition) => sameWholeTitle(edition.title, original))`.
       6. `if (joinByCode(deps, workId, plan.intoWorkId, at)) codeMerges++; else codeBlocked++;`
    6. `deps.repo.dropOriginalArrival(titleKey)`.

    There are no catches. An error rolls the key's transaction back, the key stays queued, and the error propagates.
  - `export function startOriginalArrivals(deps: ArrivalDeps & { info: (details: Record<string, unknown>, message: string) => void; onError: (error: unknown) => void }): () => void`. It returns `startDetailsBackfill(async () => { … }, deps.onError, ORIGINAL_ARRIVALS_INTERVAL_MS)`, whose batch:
    - runs `joinArrivedOriginals(deps, ORIGINAL_ARRIVALS_BATCH)`;
    - calls `deps.info({ ...steps }, "original arrivals joined")` when `steps.codeMerges + steps.codeBlocked > 0`;
    - returns `null`.
- **`backend/package.json`:** add `src/modules/books/originalArrivals.test.ts` to the `test` list after `src/modules/books/translationBacklog.test.ts`.
- **`plugin.ts`:**
  - after `sharesArena` is built, `const stopOriginalArrivals = startOriginalArrivals({ repo, sharesArena, now: Date.now, info: (details, message) => app.log.info(details, message), onError: (error) => app.log.error({ err: error }, "original arrivals failed") });`;
  - call `stopOriginalArrivals()` in the `onClose` hook.

  It starts whether or not `heldWorks` or a TypeSafe key is configured.
- **`backend/README.md`:**
  - in "Translation backlog", after the `fillIdentity` paragraph, add one paragraph:
    - every new or changed title key, and a book's first Open Library work key, is queued by a trigger, and the server drains the queue each minute;
    - for each key it runs the code step on the Portuguese works whose stored original title has that key, held or not, that are unjudged or answered "none" (not by the owner);
    - it joins only a clear single match into a work with an Open Library key that holds an edition carrying the whole original title. It skips originals with a subtitle part and originals two different Portuguese titles share;
    - it writes nothing else: an `ask` or `none` keeps the earlier answer;
    - every join is listed under "Merged" on `/admin/translations`, and the log line is `original arrivals joined`;
  - in "Fetching missing originals", add one sentence: the server also joins unheld works naming an added original within a minute, through the same queue.

- [ ] **Step 1: Write the failing tests** in `originalArrivals.test.ts`, with the env preamble and the `freshRepo` and `book` helpers copied from `translationBacklog.test.ts:8-41`.
  - Each test builds only the books it names.
  - Set original titles with `repo.fillOriginalTitle(id, title)`, not raw SQL, so `original_key` is written.
  - Every arriving original gets a `workKey` (so its work has an Open Library key) unless a test says otherwise. Every Portuguese edition gets `language` "pt-PT".
  - Save judgments with `askedAt` before `NOW`.
  - Before the arrival, empty the queue (`originalArrivals(1000)` then `dropOriginalArrival` each), so each test drains only the arrival it makes.
  - Drain with `joinArrivedOriginals({ repo, sharesArena: () => false, now: () => NOW }, 500)` unless a test says otherwise.

  The usual claimant is a pt "Passeio ao Farol" by Virginia Woolf with original "To the Lighthouse". The usual arrival is the English "To the Lighthouse" by Virginia Woolf, `workKey` "OL960W". Tests:
  1. **Jev "none" joined:** the claimant has a saved judgment `{ model: "jev-1", intoWorkId: null, confidence: 0.2 }`. The result is `{ arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 }`:
     - `canonicalWorkIds` maps the pt work to the English work;
     - the judgment is `code` into that work;
     - `originalArrivals(10)` is empty.
  2. **Unjudged:** the same with no judgment. It is joined.
  3. **`manual` is final:** a saved `manual` none. `claimants` is 0, `codeMerges` is 0, the judgment is still `manual`, and the queue is empty.
  4. **A named answer is untouched:** a saved Jev answer `{ intoWorkId: <another work's id>, confidence: 0.7 }` gives `claimants` 0, and the judgment is unchanged.
  5. **Guard 1 and the shared rule:** three pt works with distinct titles, "Poppy e o Pónei", "Poppy no Mar" and "Poppy na Neve", by Janey Louise Jones, each with original "Princess Poppy". The English "Princess Poppy" arrives. `codeMerges` is 0, and no judgment is written.
  6. **Guard 2:** a lone pt "O Farol, Vol. 1" by Virginia Woolf with original "To the Lighthouse". The result has `claimants` 1 and `codeMerges` 0 (the plan is `ask`), and no judgment is written.
  7. **Shared original:** "Passeio ao Farol" and "Rumo ao Farol" both claim "To the Lighthouse". `claimants` is 0, and nothing is joined.
  8. **Series-name original:** pt "Capitão Grisam" by Elisabetta Gnone has original "Fairy Oak". Pt "O Segredo das Gémeas" by Elisabetta Gnone has original "Fairy Oak: Il segreto delle gemelle". The Italian "Fairy Oak" by Elisabetta Gnone arrives. `claimants` is 0, and nothing is joined.
  9. **Subtitle:**
     - a lone claimant with original "Dune: Messiah", with "Dune: Messiah" by Frank Herbert arriving: `claimants` 0;
     - in a separate test, a lone claimant "Duna" with original "Dune", with only "Dune: Messiah" by Frank Herbert arriving: `claimants` 1 and `codeMerges` 0, since the target's whole title differs.

     No judgment is written in either case.
  10. **Arena:** `sharesArena: () => true`. The result is `codeBlocked` 1. The judgment is `code` with `intoWorkId` set, and the pt work is still its own canonical work.
  11. **Another original in the evidence:** a lone pt work with two editions (same `workKey` "OL77W", pt-PT). The first, created first, has original "Orlando"; the second has original "To the Lighthouse". The English "To the Lighthouse" arrives: `claimants` 0.
  12. **Ask:** the English "To the Lighthouse" by Virginia Woolf exists in two works (`workKey` "OL1W" and "OL2W"). The plan is `ask` (`claimants` 1, `codeMerges` 0), and nothing is written.
  13. **No claims:** "Some Other Book" arrives: `arrivals` 1, `claimants` 0, and the queue is empty.
  14. **Limit:** three queued keys and a limit of 2. Two are drained and one is left.
  15. **`fillIdentity` arrival:** a keyed blank-author row (title "To the Lighthouse", author `""`, `workKey` "OL960W") filled with author "Virginia Woolf" is joined.
  16. **Unkeyed target waits for its key:** the English "To the Lighthouse" arrives with no `workKey`.
      - The first drain gives `claimants` 1 and `codeMerges` 0, the queue is empty, and no judgment is written.
      - Then `repo.setWorkKey(<English id>, "OL960W")` re-queues it, and the next drain joins the claimant into the now-keyed work (`codeMerges` 1).
  17. **Rollback:** a repo wrapper (`{ ...repo, mergeTranslation: () => { throw new Error("boom"); } }`) makes `joinArrivedOriginals` throw. The arrival is still queued, and the pt work has no judgment saved.
  18. **`startOriginalArrivals`** with fixture 1: the first tick runs at start. After `await new Promise(setImmediate)`, `info` was called once with `codeMerges` 1 and the message `"original arrivals joined"`. Then call the stop function.
- [ ] **Step 2: Run them and watch them fail.**

  ```bash
  npm run build --workspace @scripta/shared && cd backend && npx tsx --test src/modules/books/originalArrivals.test.ts
  ```

- [ ] **Step 3: Implement** the module, the wiring and the README paragraphs.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass.
- [ ] **Step 5: Commit.** Message: `Join translations when their original arrives`. The body says:
  - only `code` joins are written, so Jev's and the owner's answers stand;
  - both #317 guards run, plus the #323 whole-title and shared-original checks, because Guard 1 needs three titles and counts colon volumes as one;
  - joins wait for the target work's Open Library key, because a later `setWorkKey` would split an unkeyed work;
  - the drain reads in proportion to each key's claims, one transaction per key.
