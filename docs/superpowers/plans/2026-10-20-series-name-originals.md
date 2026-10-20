# Series-Name Originals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the free translation matcher from joining books whose original title is a series name, or whose own title is a volume. List the joins it already made that way so they can be reviewed and undone.

**Architecture:** Two guards in `planMatch`:
- **Guard 1:** an original title is series-like when 3 or more distinct Portuguese main titles claim it for one author. `planMatch` then returns `none`.
- **Guard 2:** when the edition's own title has a volume marker, the free step can't join it, and it goes to the paid `ask`.

The series rule is built from one repository read and passed down from each caller. A repair script lists candidates, then undoes a reviewed list.

**Tech Stack:** Fastify/TypeScript backend, SQLite (`node:sqlite`), `@scripta/shared` (from `dist`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-20-series-name-originals-design.md`

## Global Constraints

- **No comments in code** (root `AGENTS.md`).
- **Before backend typecheck or tests,** run `npm run build --workspace @scripta/shared`.
- **New test files** go in `backend/package.json`'s explicit `test` list.
- **Reuse:**
  - `normalizeTitle`, `titleNumbers` (`@scripta/shared`).
  - `mainTitle`, `sameMainTitle`, `surnameOf`, `hasVolumeMarker`, `originalTitleIn`, `isPortuguese` (`domain/translation.ts`).
  - `repo.undoMerge`, `repo.saveWorkMatchJudgment`, `repo.transaction`.
- **Backend tests need the env preamble** that existing repo tests use. Import `connection.ts` dynamically after setting env, as `sqliteBooksRepository.test.ts` does.
  - The `freshRepo`/`book`/`seedCatalog` helpers in `translationBacklog.test.ts` are file-private, and `book` has no original-title or language option.
  - Task 2 may copy what it needs, or both tasks may move them into one shared `*.test-helpers.ts` beside the tests. Pick one; don't duplicate twice.
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Every `planMatch` caller passes the rule:**
  - `translationDryRun`, `runCodeSteps` and `runTranslationBacklog`/`matchWork` (`translationBacklog.ts`);
  - `judgeWorkMatch` (`translationJudgments.ts`);
  - `translationSample` (`calibration.ts:86`).

  Batch callers build it once per call. The live path builds it lazily, after `judgeWorkMatch`'s early returns, and caches it for about 10 minutes.
- **The rule's titles are compared exactly as `sameMainTitle` does.** It counts only Portuguese claims, groups by original key plus `surnameOf(author)`, and leaves out claims whose own main title equals the original.
- **The repair writes nothing in `--list`.** `--undo` touches only `code` or `jev` joins (never `manual`) whose `from_work` is in the given file, and undoes them newest first globally.

### Task 1: The two guards in the matcher

**Files:**
- Modify: `backend/src/modules/books/domain/translation.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/translationJudgments.ts`
- Modify: `backend/src/modules/books/translationBacklog.ts`
- Modify: `backend/src/modules/books/calibration.ts`
- Modify: `backend/README.md`
- Test: `backend/src/modules/books/domain/translation.test.ts`
- Test: `backend/src/modules/books/translationJudgments.test.ts`
- Test: `backend/src/modules/books/translationBacklog.test.ts`
- Test: `backend/src/modules/books/calibration.test.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- **`domain/translation.ts`:**
  - `export const SERIES_LIKE_TITLES = 3;`
  - `export function originalKey(title: string): string | null` returns `normalizeTitle(mainTitle(title))` plus `"|"` plus `titleNumbers(mainTitle(title))`, or null when the normalized main title is empty.
  - `export type OriginalClaim = { title: string; author: string; language: string | null; originalTitle: string };`
  - `export function seriesLikeOriginals(claims: OriginalClaim[]): (originalTitle: string, author: string) => boolean`.
    - Ignore claims whose language isn't Portuguese (`isPortuguese`) and claims where `sameMainTitle(title, originalTitle)` is true.
    - Group by `originalKey(originalTitle)` plus `"#"` plus `(surnameOf(author) ?? "")`, collecting distinct `originalKey(title)` values.
    - The returned function is true when the group has at least `SERIES_LIKE_TITLES` distinct titles.
- **Repository** (`sqliteBooksRepository.ts`, with its port in `ports.ts`):
  - `originalTitleClaims(): OriginalClaim[]` runs one read: `SELECT title, author, language, original_title, summary FROM books WHERE (original_title IS NOT NULL AND original_title <> '') OR summary LIKE '%tulo original%'`. It maps `originalTitle = original_title || originalTitleIn(summary)` and drops rows where that's null.
- **`planMatch(repo, workId, isSeriesLike: (originalTitle: string, author: string) => boolean)`**, where the third argument is required. Keep the existing `original` check first, then add:
  - **Guard 1:** if `evidence.originalTitle && isSeriesLike(evidence.originalTitle, evidence.workAuthor || evidence.author)`, return `{ kind: "none" }`.
  - **Guard 2:** the existing code branch also requires `!hasVolumeMarker(evidence.title)`. A volume title falls through to `ask`.
- **Callers:**
  - `translationDryRun` builds the rule once and gains a `seriesLike` count.
  - `runCodeSteps` builds it once, after `fillOriginalTitlesFromSummaries()`.
  - `runTranslationBacklog` builds it once and passes it to each `matchWork` call. `matchWork` takes it as a parameter.
  - `judgeWorkMatch` builds it lazily, after its early returns, and caches it for 10 minutes. Model the cache on `heldCache`, keep it in closure, and keep the injected clock testable.
  - `calibration.ts` `translationSample` builds it once per sample.
- **`backend/README.md`:** add one sentence each on Guard 1 and Guard 2, where the translation code step is described.

- [ ] **Step 1: Write the failing tests.**
  - **`translation.test.ts`:**
    - four different Portuguese titles claiming "Princess Poppy" by Jones make it series-like;
    - "O Principezinho" ×3 (pt-PT) plus "El principito" (es) and "The Little Prince" (en) claiming "Le petit prince" don't, because only Portuguese titles count and there's 1 distinct one;
    - the same original under two different author surnames groups separately;
    - an edition titled like its original doesn't count.
  - **`translationJudgments.test.ts`:**
    - a series-like original plans `none`, even with exactly one title candidate and a matching surname;
    - with the rule returning false, the same evidence still plans `code`, which pins today's behaviour;
    - an edition titled "Alix Senator, Vol. 2 – O Último Faraó" with exactly one candidate plans `ask`, not `code`;
    - a 2-title original still plans `code`.
  - **`translationBacklog.test.ts`:**
    - `runCodeSteps` makes no join for 3 Portuguese volumes claiming a series name, and still joins a genuine translation;
    - the dry run reports `seriesLike`.
  - **`calibration.test.ts`:** any test that calls `translationSample` still passes with the new argument wired.
  - **Repo test:** `originalTitleClaims` returns column and summary-derived originals, and skips rows with neither.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass.
- [ ] **Step 5: Commit.** Message: `Never join a translation on a series name or a volume title in code`. The body cites *Princess Poppy*, *CHERUB*, *Alix Senator* and Ferrante collapsing on 2026-10-20, and the production check from the spec.

### Task 2: List, then undo, collapsed series

**Files:**
- Create: `backend/src/modules/books/seriesMergeRepair.ts`
- Test: `backend/src/modules/books/seriesMergeRepair.test.ts`
- Create: `backend/scripts/undo-series-merges.mjs`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/package.json`
- Modify: `backend/README.md`

**Interfaces:**
- **Repository**, with its port:
  - `activeMerges(source: "code" | "jev" | "manual"): Array<{ id: number; fromWork: string; intoWork: string; movedBookIds: string[]; mergedAt: string }>`. It reads `work_merges` where `source = ? AND undone_at IS NULL`, ordered by `id DESC`.
  - For editions by work or by id, reuse an existing read such as `translationEditionsStmt`, or the edition list `getWorkView` returns. Add `editionsOf(workIds: string[])` (title, language, ISBN, original title, work id) only if nothing fits.
- **`seriesMergeRepair.ts`:**
  - `listSeriesCollapses(repo)` returns `Array<{ intoWork: string; title: string; author: string; editions: Array<{ title: string; language: string | null; isbn: string | null; originalTitle: string | null }>; joined: Array<{ fromWork: string; mergeId: number; source: "code" | "jev" | "manual"; editions: Array<{ title: string; isbn: string | null; originalTitle: string | null }>; why: "series-like" | "volume" }> }>`.
    - A target is listed when it received at least one active `code` join whose moved editions match Guard 1, using `seriesLikeOriginals(repo.originalTitleClaims())`, or Guard 2, `hasVolumeMarker(title)`.
    - The output includes all of that target's active joins of every source, so the reviewer sees the whole picture.
  - `undoReviewedMerges(repo, fromWorks: string[], now)` returns `{ undone: number; failures: Array<{ fromWork: string; reason: string }> }`.
    - It considers only active `code` and `jev` joins (never `manual`) whose `fromWork` is in the list, in global `id DESC` order.
    - Each one runs in one `repo.transaction`: `undoMerge(fromWork, at)`, then `saveWorkMatchJudgment(fromWork, { model: "code", intoWorkId: null, confidence: null, askedAt: at })`.
    - `WorkMergeError` goes to `failures`; any other error propagates.
- **`backend/scripts/undo-series-merges.mjs --list | --undo <file.json>`:**
  - Follows `translation-backlog.mjs`: env check for `COVERS_DB_PATH`, dynamic imports from `../dist`.
  - `--list` opens the DB read-only (`new DatabaseSync(path, { readOnly: true })`, as `fill-authors-isbndb.mjs` does) and prints the list as JSON.
  - `--undo` uses `openBooksDb()`. It reads `{ "undo": ["<fromWork>", …] }` and prints the result as JSON.
  - Exactly one mode is required; otherwise print usage and exit 1.

- [ ] **Step 1: Write the failing tests** in `seriesMergeRepair.test.ts`, on a fresh repo with the env preamble:
  - three Portuguese volumes code-joined into a series-named work are listed as `series-like`;
  - two "Vol. N" editions code-joined into one work are listed as `volume`;
  - a genuine 2-title translation join isn't listed;
  - a `jev` join into a listed target appears in its `joined` with `source: "jev"`;
  - `undoReviewedMerges` with two of the three volume works restores exactly those two, each with a `code`/null judgment, and leaves the third joined;
  - a `jev` join passed to `undoReviewedMerges` is undone too, and a `manual` one is ignored;
  - a chain X→A→T passed as `[X, A]` undoes both, newest first;
  - a join that can no longer be undone lands in `failures`;
  - `listSeriesCollapses` leaves `work_merges` and `books.work_id` unchanged.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.**
  - Add the test file to `backend/package.json`.
  - Add a runbook paragraph to `backend/README.md`, next to the translation backlog section:
    - run `--list` to `/data/series-collapses.json` over the same `railway ssh … setsid` form;
    - a reviewer writes `/data/series-undo.json`;
    - then run `--undo /data/series-undo.json`;
    - a deploy kills a running job.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`.
- [ ] **Step 5: Commit.** Message: `List and undo translation joins that collapsed a series`.
