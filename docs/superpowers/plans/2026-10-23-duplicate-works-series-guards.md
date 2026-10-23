# Duplicate Works Series Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The duplicate Open Library work merge from PR #324 never collapses a series into one book. That covers the catalog-wide pass (`scripts/merge-duplicate-works.mjs`) and the merge at search save (`saveHits`).

**Architecture:** `planDuplicateSets` in `domain/duplicateWorks.ts` drops two kinds of duplicate set and counts them. It asks an injected `isSeriesName` predicate about each set's full title. The repository answers that predicate from `work_series` and `book_collections`, using two new `name_key` indexes. `mergeDuplicateWorks` and `walkDuplicateWorks` carry the two counts into `DuplicateReport`. `saveHits` already calls `mergeDuplicateWorks`, so the guards apply at save with no change there.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** this file. The parent session's brief is the source of the rules and the evidence.

## Evidence

The production dry run on 2026-10-23 planned merges that would fold whole series into one book: Open Library often files a series as one work per volume, each titled with only the series name ("Big Nate", "The Vampire Diaries", "Wings of Fire"). The counts are in the PR description, not here, because production results stay out of the repo.

## The rules

A duplicate set is a survivor plus the works that would merge into it. The planner skips the whole set when either rule holds:
1. **Series name:** the set's full title, `normalizeWords(title)`, equals any `name_key` in `work_series` or `book_collections`, whatever its source. Every work in a set has the same full title, because the planner groups by it.
2. **Crowded:** the set has 3 or more works, a survivor plus 2 or more others.

Both counts are in works left unmerged, `set size − 1`, the unit the dry-run review used. The series-name rule is checked first, so a set caught by both counts once, as `seriesName`. Both rules run in the planner, before the service's undone-merge check and its arena check.

## Global Constraints

- No comments in code. No new test files. Every test touched is already listed in `backend/package.json`.
- Nothing runs against production. Besides the two `CREATE INDEX IF NOT EXISTS` lines, there is no migration.
- `name_key` is written by `seriesNameKey` (`domain/series.ts`), which is `normalizeWords(name) || null`. That is the same `normalizeWords` from `@scripta/shared` that the planner groups by, so the comparison is exact. Don't add another normaliser.
- Rebuild shared before any backend run: `npm run build --workspace @scripta/shared`.
- Verify with `node scripts/gate.mjs` before committing.

## Review Focus

- **The save path** gets the guards only through `mergeDuplicateWorks`. `booksService.ts` must not need a change. If a test fake of `BooksRepository` breaks typecheck, add the method to the fake and change nothing else.
- **The lookup cost.** `isSeriesName` is called at most once per group of two or more works, and never for a single work. Both lookups use the new indexes, not a scan. Check this with `EXPLAIN QUERY PLAN` while implementing; no test is needed for it. The dry run opens the database read-only and creates no indexes, but the deploy's first boot creates them before anyone runs it.
- **Existing tests built on three-work sets** now describe crowded sets. Rewrite them so each one still tests its own behaviour with pairs. Don't delete what they cover.

---

### Task 1: Series-name and crowded guards for duplicate sets

**Files:**
- Modify: `backend/src/modules/books/domain/duplicateWorks.ts`
- Test: `backend/src/modules/books/domain/duplicateWorks.test.ts`
- Modify: `backend/src/modules/books/duplicateWorks.ts`
- Test: `backend/src/modules/books/duplicateWorks.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/scripts/merge-duplicate-works.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- `domain/duplicateWorks.ts`:
  - `export interface DuplicatePlan { sets: DuplicateSet[]; seriesName: number; crowded: number }`
  - `export function planDuplicateSets(works: KeyedWork[], isSeriesName: (fullTitle: string) => boolean): DuplicatePlan`
  - Grouping, the `mergeable` filter, the survivor order and `DuplicateSet` are unchanged.
- `domain/ports.ts`: `BooksRepository` gains `isSeriesName(nameKey: string): boolean`.
- `sqliteBooksRepository.ts`: `isSeriesName` is one prepared statement. It is true when `work_series` or `book_collections` has a row with that `name_key`, for example `SELECT EXISTS (SELECT 1 FROM work_series WHERE name_key = ?) OR EXISTS (SELECT 1 FROM book_collections WHERE name_key = ?) AS found`.
- `connection.ts` (`applyBooksMigrations`):
  - `CREATE INDEX IF NOT EXISTS idx_work_series_name_key ON work_series(name_key)`
  - `CREATE INDEX IF NOT EXISTS idx_book_collections_name_key ON book_collections(name_key)`
- `duplicateWorks.ts` (service):
  - `DuplicateReport` becomes `{ merges, seriesName, crowded, undone, arena, gone }`.
  - The `repo` `Pick` gains `"isSeriesName"`.
  - `mergeDuplicateWorks` passes `(title) => deps.repo.isSeriesName(title)` and starts its report from the plan's two counts.
  - `walkDuplicateWorks` sums both counts across pages.
- `scripts/merge-duplicate-works.mjs`: the summary line becomes `{ mode, merges, seriesName, crowded, undone, arena, gone }`.
- `backend/README.md`, section "Duplicate Open Library works":
  - Add both rules, why they exist (a series-named Open Library work, and one title shared by many volumes), how they are counted, and that a set caught by both counts as `seriesName`.
  - Update the summary line under "The whole catalog".

**Tests:**
- `domain/duplicateWorks.test.ts`:
  - **Series-name set:** two keyed "Big Nate" works by Lincoln Peirce, with `isSeriesName` true only for `"big nate"`, give `{ sets: [], seriesName: 1, crowded: 0 }`. Assert the predicate was called with `"big nate"`.
  - **Crowded set:** three works with the same full title give `{ sets: [], seriesName: 0, crowded: 2 }`.
  - **Both rules:** a three-work set whose title is a series name gives `seriesName: 2, crowded: 0`.
  - **Normal pair:** the existing first test still merges, in the new return shape.
  - Update the other existing tests to the new signature and return shape. "breaks an editions tie by the oldest work, then the lowest id" uses a three-work set, so test the lowest-id tie-break with a pair.
- `duplicateWorks.test.ts`, with the real SQLite repo:
  - **Series-name set:** a keyed pair stays apart when its full title is a `work_series` name (`repo.addWorkSeries` on any work). A second pair stays apart when its full title is a `book_collections` name (`repo.addBookCollection` on any edition). Both are counted as `seriesName`, with no `ol-duplicate` merge.
  - **Crowded set:** a survivor plus two others stay apart, counted `crowded: 2`, in `mergeDuplicateWorks` and in `walkDuplicateWorks`.
  - **Normal pair:** it still merges.
  - Rewrite the existing tests that use three-work sets:
    - "merges duplicate keyed works for the given keys": use one pair under the key, and keep the other key's pair untouched.
    - "an undone duplicate merge stays undone": use a pair, reporting `undone: 1`. The third-duplicate case now reports `crowded: 2` with nothing merged.
    - "a work that shares an arena with one already merged into the survivor is skipped, by live aliases": merge `a` into the survivor in a first call, as a pair. Then add `b` and run again, so `b` is checked against the survivor's live aliases.
  - Every report `deepEqual` gains `seriesName` and `crowded`.

- [ ] Write the failing tests above and watch them fail.
- [ ] Implement the planner, the port, the repository read, the indexes, the service, the script and the README.
- [ ] Check with `EXPLAIN QUERY PLAN` that `isSeriesName` searches both indexes.
- [ ] Run `node scripts/gate.mjs`, then commit.
