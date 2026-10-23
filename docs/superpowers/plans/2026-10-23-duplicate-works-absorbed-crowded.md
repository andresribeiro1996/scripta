# Duplicate Works Absorbed Crowded Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A series whose name is not in `work_series` or `book_collections` can no longer collapse into one book one pair at a time, across search saves or repeated `scripts/merge-duplicate-works.mjs --apply` runs.

**Architecture:** The crowded guard from `2026-10-23-duplicate-works-series-guards.md` skips a duplicate set of 3+ works, but its input, `KEYED_WORKS_SQL`, keeps only unmerged works. So a survivor that already absorbed one duplicate looks like a single work, and the next same-title arrival makes a fresh pair. Each `KeyedWork` now carries `absorbed`, the number of its live aliases that arrived through a live `ol-duplicate` merge, and `planDuplicateSets` counts those toward the set size. A survivor that absorbed one duplicate, plus one new work, is then crowded. The count reads the existing `idx_works_merged_into` and `idx_work_merges_from` indexes, so there is no migration.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** this file. The parent session's brief is the source of the rules; the failure was reproduced by the branch review of the series-guards plan with three "Bone" / Jeff Smith works.

## The rule

- A work's `absorbed` is the count of its live aliases (works whose `merged_into` is its id) that have a `work_merges` row with `from_work` = the alias, `source = 'ol-duplicate'` and `undone_at IS NULL`.
- The count goes through aliases, not through `work_merges.into_work`, because a survivor can leave by a translation join: `mergeTranslation` accepts a keyed source and repoints the survivor's aliases to the new work, while the duplicate's `work_merges` row keeps the old survivor as `into_work`. Counting by `into_work` would give the new work `absorbed: 0`, and the next same-title arrival would merge into it. `undoMerge` repoints the aliases back, so the count follows an undo too.
- A set's size is the sum over its works of `1 + absorbed`. The set is crowded when that size is 3 or more.
- Only `ol-duplicate` merges count. Translation joins (`code`, `jev`, `manual`), `title-key` folds and `admin` merges are not same-title keyed works, and counting them would block real duplicates of translated books.
- `admin` and `title-key` merges refuse a keyed source, so they never carry a survivor onward. An `ol-duplicate` merge of a survivor that absorbed one is what this guard blocks.
- Unchanged: the series-name rule is checked first, a group of one work is never a set (whatever its `absorbed`), and the survivor order ignores `absorbed`.
- `crowded` is still counted in works left unmerged, which is the number of grouped (unmerged) works minus one, not the size above minus one. A survivor that absorbed one duplicate plus one new work counts `crowded: 1`; three fresh works still count `crowded: 2`.

## Global Constraints

- No comments in code. No new test files. Every test touched is already listed in `backend/package.json`.
- Nothing runs against production. No production numbers in this file or in commit messages; they go in the PR body only.
- No change to `duplicateWorks.ts` (service), `booksService.ts`, `ports.ts` or the script. The summary line stays `{ mode, merges, seriesName, crowded, undone, arena, gone }`.
- No migration and no new index.
- Rebuild shared before any backend run: `npm run build --workspace @scripta/shared`.
- Verify with `node scripts/gate.mjs` before committing.

## Review Focus

- **The count's filter.** Exactly `source = 'ol-duplicate' AND undone_at IS NULL`, reached through the work's live aliases. An undone duplicate merge must not count: its work is back among the grouped works, and the undone-merge check already keeps that pair apart.
- **The lookup cost.** `KEYED_WORKS_SQL` also feeds `crowdedFolds` in `groupTitleKeys`, the nightly grouping path, so the new correlated subquery must be index searches on `works` and `work_merges`, never a scan. Pin it in the `EXPLAIN QUERY PLAN` test for `KEYED_WORKS_SQL`.
- **The live-alias test.** "a work that shares an arena with one already merged into the survivor is skipped, by live aliases" builds exactly the sequence the new rule now calls crowded. Keep its coverage, an arena check that reads the survivor's live aliases, by making the alias come from a translation join instead of an `ol-duplicate` merge.

---

### Task 1: Count live `ol-duplicate` merges toward the crowded guard

**Files:**
- Modify: `backend/src/modules/books/domain/duplicateWorks.ts`
- Test: `backend/src/modules/books/domain/duplicateWorks.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/duplicateWorks.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- `domain/duplicateWorks.ts`:
  - `KeyedWork` gains `absorbed: number` (required).
  - `planDuplicateSets` keeps its signature. A group of 2+ works whose `group.length + sum(absorbed)` is 3 or more adds `group.length - 1` to `crowded` and is skipped. This replaces the `group.length > 2` test; the series-name check still runs first.
- `sqliteBooksRepository.ts`:
  - `KEYED_WORKS_SQL` selects `(SELECT COUNT(*) FROM works AS alias JOIN work_merges ON work_merges.from_work = alias.id WHERE alias.merged_into = works.id AND work_merges.source = 'ol-duplicate' AND work_merges.undone_at IS NULL) AS absorbed`.
  - `keyedWorksWithTitleKeys` maps it to `absorbed`.
  - `crowdedFolds` is unchanged.
- `backend/README.md`, section "Duplicate Open Library works":
  - In the **Crowded** bullet, say that each work's live `ol-duplicate` merges count as works of the set, so a survivor that already absorbed a duplicate plus one new work is crowded. Say why: a series would otherwise collapse a pair at a time as its volumes arrive at save or across runs. Say that the count follows the work's aliases, so a survivor joined into another work as a translation brings its duplicates with it. Say that other merges into a work (translation joins, `title-key` folds, `admin` merges) don't count, and why.
  - Fix "Both are counted in works left unmerged, the set's size minus one" so it no longer reads as the size including absorbed works: the count is the set's unmerged works minus one.
  - Check the rest of the section, including "The whole catalog", for any sentence the new rule makes false, and fix only those.

**Tests:**
- `domain/duplicateWorks.test.ts`:
  - **Absorbed survivor:** a pair where the work with more editions has `absorbed: 1` gives `{ sets: [], seriesName: 0, crowded: 1 }`.
  - **Absorbed other:** the same pair with `absorbed: 1` on the other work gives the same result.
  - **Absorbed single work:** one work with `absorbed: 2` and no other work under its full title gives an empty plan with `crowded: 0`.
  - Every existing `KeyedWork` literal gains `absorbed: 0`, and every existing test keeps its expected result.
- `sqliteBooksRepository.test.ts`:
  - **The count:** a new test with the real repo.
    - One keyed work `T` is the target of each of these, in this order:
      - a `title-key` fold from `groupTitleKeys`, done first, while `T` is the only keyed work under its key, since a second keyed work with the same full title would stop the fold;
      - a `mergeWorks` (admin) merge of a keyless work;
      - a `mergeTranslation` join;
      - two `mergeDuplicateWork` merges, then `undoMerge` of one of them.
    - `keyedWorksWithTitleKeys` reports `absorbed: 1` for `T` and `absorbed: 0` for the restored duplicate.
    - **Chain:** a keyed survivor `S` absorbs a duplicate with `mergeDuplicateWork`, then `S` joins another keyed work `O` with `mergeTranslation(S, O, "code", …)`. `O` reports `absorbed: 1`. After `undoMerge(S)`, `S` reports `absorbed: 1` and `O` reports `absorbed: 0`.
  - "keyedWorksWithTitleKeys lists live keyed works with an edition under the key": its rows gain `absorbed: 0`. Its translation-joined `merged` work makes it a second check that a translation join isn't counted.
  - "looking up keyed works and keyless candidates for a title key reads through the title index, never a scan of books": it loops over both SQLs with the same assertions, so add the new ones for `KEYED_WORKS_SQL` alone. The aliases are a `SEARCH` on `works` using `idx_works_merged_into (merged_into=?)`, and the merges a `SEARCH work_merges USING INDEX idx_work_merges_from (from_work=?)`. Assert there's no `SCAN` of either.
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
- [ ] Implement the planner rule, the `KEYED_WORKS_SQL` column and the README.
- [ ] Run `node scripts/gate.mjs`, then commit.
