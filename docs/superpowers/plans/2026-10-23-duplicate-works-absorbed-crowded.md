# Duplicate Works Absorbed Crowded Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A series whose name is not in `work_series` or `book_collections` can no longer collapse into one book one pair at a time, across search saves or repeated `scripts/merge-duplicate-works.mjs --apply` runs.

**Architecture:** The crowded guard from `2026-10-23-duplicate-works-series-guards.md` skips a duplicate set of 3+ works, but its input, `KEYED_WORKS_SQL`, keeps only unmerged works. So a survivor that already absorbed one duplicate looks like a single work, and the next same-title arrival makes a fresh pair. Each `KeyedWork` now carries `absorbed`, the number of live `ol-duplicate` merges into it, and `planDuplicateSets` counts those toward the set size. A survivor that absorbed one duplicate, plus one new work, is then crowded. A new covering index on `work_merges(into_work, source, undone_at)` serves the count.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** this file. The parent session's brief is the source of the rules; the failure was reproduced by the branch review of the series-guards plan with three "Bone" / Jeff Smith works.

## The rule

- A work's `absorbed` is the count of `work_merges` rows with `into_work` = that work's id, `source = 'ol-duplicate'` and `undone_at IS NULL`.
- The count is direct, not through the work's aliases. A survivor can leave by a translation join (`mergeTranslation` accepts a keyed source and repoints the survivor's aliases), but counting through aliases would then charge the survivor's duplicates to the work it joined. A Portuguese "Quarta Asa" that absorbed its own duplicate and joined "Fourth Wing" would block Fourth Wing's real duplicates, which is the case the rule must not block. Counting through aliases also costs a lookup per alias, and `KEYED_WORKS_SQL` runs on the nightly grouping path.
- **Accepted gap:** when the translation matcher joins a survivor into a work with the same full title and first author, that work's next same-title arrival can still merge. That join has already folded two same-title works, and the translation matcher's own series guards own that path.
- A set's size is the sum over its works of `1 + absorbed`. The set is crowded when that size is 3 or more.
- Only `ol-duplicate` merges count. Translation joins (`code`, `jev`, `manual`), `title-key` folds and `admin` merges are not same-title keyed works, and counting them would block real duplicates of translated books.
- Unchanged: the series-name rule is checked first, a group of one work is never a set (whatever its `absorbed`), and the survivor order ignores `absorbed`.
- `crowded` is still counted in works left unmerged, which is the number of grouped (unmerged) works minus one, not the size above minus one. A survivor that absorbed one duplicate plus one new work counts `crowded: 1`; three fresh works still count `crowded: 2`.

## Global Constraints

- No comments in code. No new test files. Every test touched is already listed in `backend/package.json`.
- Nothing runs against production. No production numbers in this file or in commit messages; they go in the PR body only.
- No change to `duplicateWorks.ts` (service), `booksService.ts`, `ports.ts` or the script. The summary line stays `{ mode, merges, seriesName, crowded, undone, arena, gone }`.
- Besides one `CREATE INDEX IF NOT EXISTS` line, there is no migration.
- Rebuild shared before any backend run: `npm run build --workspace @scripta/shared`.
- Verify with `node scripts/gate.mjs` before committing.

## Review Focus

- **The count's filter.** Exactly `into_work = works.id AND source = 'ol-duplicate' AND undone_at IS NULL`. An undone duplicate merge must not count: its work is back among the grouped works, and the undone-merge check already keeps that pair apart.
- **The lookup cost.** `KEYED_WORKS_SQL` also feeds `crowdedFolds` in `groupTitleKeys`, the nightly grouping path, so the new correlated subquery must be one covering-index search on `work_merges`, never a scan. Pin it in the `EXPLAIN QUERY PLAN` test for `KEYED_WORKS_SQL`.
- **The live-alias test.** "a work that shares an arena with one already merged into the survivor is skipped, by live aliases" builds exactly the sequence the new rule now calls crowded. Keep its coverage, an arena check that reads the survivor's live aliases, by making the alias come from a translation join instead of an `ol-duplicate` merge.

---

### Task 1: Count live `ol-duplicate` merges toward the crowded guard

**Files:**
- Modify: `backend/src/modules/books/domain/duplicateWorks.ts`
- Test: `backend/src/modules/books/domain/duplicateWorks.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Test: `backend/src/modules/books/duplicateWorks.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- `domain/duplicateWorks.ts`:
  - `KeyedWork` gains `absorbed: number` (required).
  - `planDuplicateSets` keeps its signature. A group of 2+ works whose `group.length + sum(absorbed)` is 3 or more adds `group.length - 1` to `crowded` and is skipped. This replaces the `group.length > 2` test; the series-name check still runs first.
- `sqliteBooksRepository.ts`:
  - `KEYED_WORKS_SQL` selects `(SELECT COUNT(*) FROM work_merges WHERE into_work = works.id AND source = 'ol-duplicate' AND undone_at IS NULL) AS absorbed`.
  - `keyedWorksWithTitleKeys` maps it to `absorbed`.
  - `crowdedFolds` is unchanged.
- `connection.ts` (`applyBooksMigrations`), next to `idx_work_merges_from`: `CREATE INDEX IF NOT EXISTS idx_work_merges_into ON work_merges(into_work, source, undone_at)`.
- `backend/README.md`, section "Duplicate Open Library works":
  - In the **Crowded** bullet, briefly: each work's live `ol-duplicate` merges into it count as works of the set, so a survivor that already absorbed a duplicate plus one new work is crowded; without it a series would collapse a pair at a time as its volumes arrive. Only `ol-duplicate` merges count. Keep it short.
  - Fix "Both are counted in works left unmerged, the set's size minus one" so it no longer reads as the size including absorbed works: the count is the set's unmerged works minus one.
  - Check the rest of the section, including "The whole catalog", for any sentence the new rule makes false, and fix only those.

**Tests:**
- `domain/duplicateWorks.test.ts`:
  - **Absorbed survivor:** a pair where the work with more editions has `absorbed: 1` gives `{ sets: [], seriesName: 0, crowded: 1 }`.
  - **Absorbed other:** the same pair with `absorbed: 1` on the other work gives the same result.
  - Every existing `KeyedWork` literal gains `absorbed: 0`, and every existing test keeps its expected result.
- `sqliteBooksRepository.test.ts`:
  - **The count:** a new test with the real repo.
    - One keyed work `T` is the target of each of these, in this order:
      - a `title-key` fold from `groupTitleKeys`, done first, while `T` is the only keyed work under its key, since a second keyed work with the same full title would stop the fold;
      - a `mergeWorks` (admin) merge of a keyless work;
      - a `mergeTranslation` join;
      - two `mergeDuplicateWork` merges, then `undoMerge` of one of them.
    - `keyedWorksWithTitleKeys` reports `absorbed: 1` for `T` and `absorbed: 0` for the restored duplicate.
    - **A joined survivor's duplicates stay with it:** a keyed "Quarta Asa" survivor `S` absorbs a "Quarta Asa" duplicate with `mergeDuplicateWork`, then joins a keyed "Fourth Wing" `O` with `mergeTranslation(S, O, "code", …)`. `O` reports `absorbed: 0`. After `undoMerge(S)`, `S` reports `absorbed: 1`.
  - "keyedWorksWithTitleKeys lists live keyed works with an edition under the key": its rows gain `absorbed: 0`. Its translation-joined `merged` work makes it a second check that a translation join isn't counted.
  - "looking up keyed works and keyless candidates for a title key reads through the title index, never a scan of books": it loops over both SQLs with the same assertions, so add the new ones for `KEYED_WORKS_SQL` alone. The merges are a `SEARCH work_merges USING COVERING INDEX idx_work_merges_into` on `into_work`, `source` and `undone_at`. Assert there's no `SCAN work_merges`.
- `duplicateWorks.test.ts`, with the real repo:
  - **One pair at a time:**
    - Two keyed "Bone" / Jeff Smith works merge with `mergeDuplicateWorks` (one merge).
    - A third keyed "Bone" work is added. `mergeDuplicateWorks` for the key reports `{ merges: [], ...counts, crowded: 1 }`, and so does `walkDuplicateWorks` with `dryRun: false`.
    - The third work keeps its own id, and `activeMerges("ol-duplicate")` still holds only the first merge.
  - **The live-alias test**, reworked:
    - Instead of an `ol-duplicate` merge, `a` joins the survivor through `repo.mergeTranslation(a.work_id, survivor.work_id, "code", …)`. Give `a` a translated title, so it is plainly not a duplicate.
    - `b` is the survivor's same-title duplicate and shares a tournament with `a`.
    - The report is `{ merges: [], ...counts, arena: 1 }`, which also shows a translation join doesn't make the pair crowded.
    - `a` still resolves to the survivor, `b` keeps its own id, and `activeMerges("ol-duplicate")` is empty.

- [ ] Write the failing tests above and watch them fail.
- [ ] Implement the planner rule, the `KEYED_WORKS_SQL` column, the index and the README.
- [ ] Run `node scripts/gate.mjs`, then commit.
