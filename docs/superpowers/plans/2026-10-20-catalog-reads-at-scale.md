# Background catalog reads at 233k books

## Goal

Four background reads in the books repository read pages in proportion to the catalog, not to their answer. After the BNP import (233,631 books, 155,580 of them `bnp`), they blocked the event loop for 0.2–4 s while the page cache was cold. Make each one read a few pages for the rows it returns, with the same results. No route, client or `@scripta/shared` change.

## What production showed (deploy `bb20d510`, 2026-10-19 22:53Z → 2026-10-20 10:03Z)

| job | stalls | max ms | when |
|---|---|---|---|
| `books:listWorkLookupIds` | 6 | 3,205 | 22:53Z–03:33Z, on the 10-minute tick |
| `books:portugueseWorksNeedingMatch` | 3 | 4,088 | 22:53Z (boot sweep), 23:03Z, 01:24Z |
| `books:listHeldBnpDetailIds` | 2 | 530 | 23:03Z, 23:13Z |
| `books:listUncheckedDetailIds` | 1 | 202 | 01:13Z |
| `books:spendTypesafe` | 1 | 3,032 | 22:54:01.655Z |

All of them fall between the boot (22:53Z, with a forced truncate checkpoint of a 248 MB WAL) and the end of the import (04:02Z). None after. A cold page cost about 4 ms then: the work-key lookup reads 759 pages on the scratch copy below (3.2 s in production), and the details queue 55 (about 200 ms).

`spendTypesafe` is a primary-key upsert on `typesafe_usage` (0.02 ms p50 on the copy). Its one stall ended 6 ms before Litestream logged `wal restarted by passive checkpoint` on a 69 MB WAL: it was waiting for the write lock within its 5 s `busy_timeout`. No change.

## Changes

All in `backend/src/modules/books/adapters/sqlite/`.

1. **Work-key lookup (`WORK_LOOKUP_SQL`).** Its rows are `idx_books_work_lookup` in `(work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at)` order. The due rows are not one range of that order: rows checked in the last 30 days by users sit between the due user rows and the due seed/bnp rows. When nothing is due the scan walks the whole index. The new query asks for four short ranges: `IN (0, 1)` on each flag and a range on `coalesce(work_checked_at, '')`. `''` sorts before every ISO time, so it also covers the never-checked rows. The index also leaves out publisher rows, so rows that aren't due are skipped without reading the table. It doesn't carry `id` (see change 2), so the rows returned are read from the table, one each.
   ```sql
   SELECT id FROM books
   WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL
     AND (created_by IS NULL OR created_by <> 'publisher')
     AND (work_checked_at IS NOT NULL) IN (0, 1) AND (created_by IS NOT NULL) IN (0, 1)
     AND coalesce(work_checked_at, '') < ?
   ORDER BY work_checked_at IS NOT NULL, created_by IS NOT NULL, coalesce(work_checked_at, ''), created_at, rowid
   LIMIT ?
   ```
   Index: `idx_books_work_queue ON books(work_checked_at IS NOT NULL, created_by IS NOT NULL, coalesce(work_checked_at, ''), created_at) WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL AND (created_by IS NULL OR created_by <> 'publisher')`, replacing `idx_books_work_lookup` (dropped).
2. **Details queue: no change** (revised after review, see Task 2). Task 1 added `id` to its index so the 50 ids came from the index. But `id` then sits between `created_at` and the `rowid` tie-break, so every call sorts its whole `created_at` tie group. `resolveWorksWith` (`works.ts:16`) stamps a whole library import with one `created_at`. With 10k tied imports at the front of a drained queue, that version read 119 pages a call against 13 for `idx_books_details_pending`, whose tied rows sit together in the table. The same holds for `id` in `idx_books_work_queue` (120 pages against 13). Both indexes go without `id`, so `rowid` order comes straight from the index with no sort.
3. **Held bnp details (`HELD_BNP_DETAILS_SQL`, text unchanged).** Today it reads every edition of every held work through `idx_books_work`. New `idx_books_bnp_details ON books(work_id, created_by, details_status, details_checked_at, created_at, id) WHERE created_by = 'bnp' AND details_status IS NULL`. `created_by` and `details_status` are in the column list only so the planner sees the index as covering; without them it keeps `idx_books_work`. One probe per held work, no table reads.
4. **Portuguese check for given works (`somePortugueseNeedingMatchStmt`).** Without statistics the planner reads `w.merged_into IS NULL` as a ten-row lookup in `idx_works_merged_into`, so it walks every live work and filters by the id list, even for one id. It is called once per Portuguese book after each details lookup, and by the daily sweep. The new text starts from the ids:
   ```sql
   SELECT w.id FROM (SELECT DISTINCT value FROM json_each($ids)) AS ids CROSS JOIN works w ON w.id = ids.value
   WHERE ${portugueseWorkFilter} ORDER BY w.created_at, w.rowid LIMIT $limit
   ```
   `DISTINCT` keeps `IN`'s one row per work. `allPortugueseNeedingMatchStmt` (only `scripts/translation-backlog.mjs` calls it) and `portugueseWorkFilter` are unchanged.

In `connection.ts`, next to the existing lines: `DROP INDEX IF EXISTS idx_books_work_lookup`, then `CREATE INDEX IF NOT EXISTS` the two new ones (`idx_books_work_queue`, `idx_books_bnp_details`). Each built in 0.1–0.2 s on the 233k copy.

**Not in scope:** `spendTypesafe`; `canonicalWorkIds`, `groupKeylessWorks`, `authorCandidates` and `worksNeedingSynopsisJudgment`, which each stalled once at boot only; the all-works Portuguese read used by the backlog script; a `(work_id, language)` index that would halve the daily sweep's remaining reads (it would replace the central `idx_books_work`).

## Scratch copy and results so far

Built with a generator in the session scratchpad (not committed): 78,051 pre-import books (seed 40%, publisher 35%, user 25%; 45% keyed; details found/missing/null 55/30/15%) and 155,580 bnp books (95% `pt`, 96% without details), 233,631 works with 151k live, 2,800 held works, 22k match judgments. Two variants: some work-key rows due, and none due (every check under 30 days old, the likely state in production).

Old against new SQL on both copies and on 40 random 1,500-book fixtures (ties on `created_at`, `''` and null stamps, merged and repeated ids, publisher, keyed and bnp rows), across limits and recheck dates: 16,971 comparisons, all identical, on Node 24.21.

Pages read on a cold connection (sqlite3 `.stats`), old → new (final design, without `id`): work lookup 759 → 9 (none due) and 57 → 57 (50 due, one table read per row returned); details queue unchanged (55); held bnp 6,637 → 2,133; Portuguese check for one work 7,190 → 24; daily held sweep 13,680 → 10,091.

## Task 1: faster reads, plan-pinning tests

- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

Steps:
1. Apply changes 1–4 exactly as written above.
2. Tests in `sqliteBooksRepository.test.ts`:
   - Update "every backfill query reads through its own partial index, with no temp sort": the details queue expects `idx_books_details_queue` and the work lookup `idx_books_work_queue`. `id` sits between `created_at` and the `rowid` tie-break, so the plan may sort that last term: assert no `TEMP B-TREE FOR ORDER BY` (a full sort) instead of no `TEMP B-TREE`, and rename the test. Also pin the work lookup as `SEARCH books USING INDEX idx_books_work_queue (<expr>=? AND <expr>=? AND <expr><?)`.
   - Replace "the held bnp read goes through the work index": `SEARCH books USING COVERING INDEX idx_books_bnp_details (work_id=?`, and no `idx_books_work\b`.
   - New plan test for the given-works Portuguese read: capture its SQL with `mock.method(db, "prepare")` while the repository is created (as `shippedPlan` does in `community/adapters/sqlite/sqliteCommunityRepository.test.ts`), then assert the plan has `SEARCH w USING INDEX sqlite_autoindex_works_1 (id=?)` and no `idx_works_merged_into`.
   - New repository test for `listWorkLookupIds` order across all groups: never-checked user editions (two with the same `created_at`, in insertion order), never-checked seed, user editions checked 40 and 35 days before the recheck date, then seed/bnp editions checked 45 and 33 days before it. Excluded: a user edition checked 5 days before, a publisher edition, a keyed edition, one without details, one without ISBN. Check a small limit too.
   - New repository test for the given-works Portuguese read: a repeated id returns its work once, a merged work's id returns nothing, and works come oldest first up to the limit.
   - New migration test like "the old title key index is dropped from an existing database": create `idx_books_details_pending` and `idx_books_work_lookup` with their old definitions, run `applyBooksMigrations` twice, and check both are gone and the three new indexes exist.
3. Verify: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend`, `npm test --workspace backend`. Commit.

## Verification after Task 1 (main session)

- Re-run the scratch timings and page counts on Node 24.21 with the branch's code, against the numbers above, plus boot time for the three index builds on the 233k copy. They go in the PR description.

## Task 2: drop `id` from the queue indexes (review round 2)

The Codex branch review (r1) found the tie-group cost described in change 2. The quality review's minor points 1 and 3 are folded in.

- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

Steps:
1. `connection.ts`: restore the original `CREATE INDEX IF NOT EXISTS idx_books_details_pending …` line exactly as on main, and remove `DROP INDEX IF EXISTS idx_books_details_pending` and the `idx_books_details_queue` line (that index never shipped). Remove `, id` from `idx_books_work_queue`. Keep the `idx_books_work_lookup` drop and `idx_books_bnp_details` as they are.
2. Tests:
   - The backfill plan test goes back to its original name and its original `assert.doesNotMatch(plan, /TEMP B-TREE/, plan)`. The details queue expects `idx_books_details_pending` again, and the work lookup `idx_books_work_queue`.
   - Rename "the work lookup reads four short ranges of its index" to say what it pins: a seek on both flags and the check time.
   - The migration test only seeds the old `idx_books_work_lookup`. It checks that index is gone, that `idx_books_work_queue` and `idx_books_bnp_details` exist, and that `idx_books_details_pending` is still there. Rename it to match.
3. Verify as in Task 1, plus the books repository test file under `npx -y node@24.21.0`. Commit.
