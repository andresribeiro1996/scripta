# Translation review reads at the post-BNP scale

Follow-up to PRs #312 and #316 (`2026-10-20-catalog-reads-at-scale.md`, `2026-10-20-search-and-author-reads.md`), same method: count cold pages on a production-shaped copy, time on Node 24.21, compare old against new results.

## Goal

`GET /books/translation-review` (admin) blocks the event loop for seconds. Make its reads read far fewer pages, with the same response. No route, client or `@scripta/shared` change.

## What production showed (deploy `24b2c2a0`, 2026-10-25 11:09:18Z, during the pre-2002 BNP import)

- `job blocked the event loop job=books:translationReviewRows blockedMs=5017`
- `job blocked the event loop job=books:matchCandidates blockedMs=2067`
- `handler blocked the event loop route=/books/translation-review blockedMs=7191`
- `event loop stalled maxMs=7197`

## What the copy shows

Built by a generator in the session scratchpad (not committed):
- 233,631 books: 78,051 pre-import, 155,580 `bnp`.
- 218,128 works, 112,176 of them live.
- `work_merges`: 100,000 `title-key` (498 undone), 2,967 `code` (79 undone), 1,768 `jev`, 1,146 `manual`, 702 `ol-duplicate` (54 undone).
- 39,420 `work_match_judgments`: 32,475 code/Jev no-match, 744 manual rejects, 80 open doubts, 40 blocked, and the judgments behind each translation merge.
- 241 held works.

The review returns 5,178 items: 5,060 merged, 80 possible and 40 blocked rows before the item filter. Old code on the copy, Node 24.21, first call: 2.0–2.6 s, of which `translationReviewRows` 1.2–1.4 s and `matchCandidates` 0.6–0.8 s. That is the same split as production's 5.0 s / 2.1 s. Warm (repeat calls in one process), old 240–315 ms, new prototype 113–160 ms.

**Cold pages** (Homebrew sqlite3 3.53.4, the version Node 24.21 bundles):

| read | old | new |
|---|---|---|
| `translationReviewRows` alone | 17,843 | 7,052 |
| `matchCandidates` (3,966 ids) alone | 23,822 | 7,356 |
| whole request, distinct pages | 36,829 | 11,590 |

Where the old pages go:
- **Arm 1 (doubts):** the planner reads `w.merged_into IS NULL` as a ten-row lookup in `idx_works_merged_into`, walks every live work, reads each work row for its `id`, and probes the judgments: 10,729 pages for 120 rows.
- **Arm 2 (merged):** no index has `source` first, so it scans all of `work_merges` (100k title-key rows): 11,070 pages for 5,060 rows.
- **`matchCandidates`:** reads every edition row of every proposed original for `MIN(year)`, `COUNT` and the languages.

What is left after the change is one works lookup per merged or proposed translation, about 6k works, and one index probe per proposed original. That is proportional to the answer: the page lists all of them in its total.

## Changes

All in `backend/src/modules/books/adapters/sqlite/`.

1. **`connection.ts`, three indexes**, next to the existing index lines:
   - Replace `CREATE INDEX IF NOT EXISTS idx_books_work ON books(work_id)` with:
     ```sql
     DROP INDEX IF EXISTS idx_books_work;
     CREATE INDEX IF NOT EXISTS idx_books_work_editions ON books(work_id, year, language);
     ```
     Same place in the function, so the migration helpers after it still have a `work_id` index. Every `work_id = ?` plan keeps its shape. The size grows about 2% (11.4 MB on the copy).
   - After `idx_work_merges_into`:
     ```sql
     CREATE INDEX IF NOT EXISTS idx_work_merges_translations ON work_merges(source) WHERE source IN ('code', 'jev', 'manual') AND undone_at IS NULL;
     CREATE INDEX IF NOT EXISTS idx_work_match_judgments_proposed ON work_match_judgments(work_id, into_work_id, model, confidence) WHERE into_work_id IS NOT NULL;
     ```
   - **Why the merges index is partial:** a plain `work_merges(source, undone_at)` index was tried first. Without stats, two equalities look more selective than one, so `KEYED_EDITIONS_SQL`'s correlated title-key check switched from `idx_works_merged_into` + `idx_work_merges_from` to walking every active title-key merge. With the partial index, only a query whose WHERE carries exactly `source IN ('code', 'jev', 'manual') AND undone_at IS NULL` can use it.
   - **Why the judgments index:** it holds only judgments with a proposal, about 6k of the 39k. Most judgments are no-matches, and the pre-2002 import adds more. `into_work_id` is listed as a column, so the index is covering (the partial-WHERE trap from #312).
   - **Checked:** the plans of all 163 statements the repository prepares, old schema against new. Only 4 differ:
     - this statement;
     - the three Portuguese-filter statements, whose per-language edition check becomes covering on `idx_books_work_editions`.

     `activeMergesStmt` and `KEYED_EDITIONS_SQL` keep their plans.
   - **Boot:** about 0.26 s once on the copy.
2. **`translationReviewRowsStmt`** (`sqliteBooksRepository.ts`). Both arms join with `CROSS JOIN`, so each is driven from its own table:
   ```sql
   FROM work_match_judgments j CROSS JOIN works w ON w.id = j.work_id
   ...
   FROM work_merges m CROSS JOIN works w ON w.id = m.from_work
   ```
   Everything else in the statement stays as it is.
   - **Plan:** `SCAN j USING COVERING INDEX idx_work_match_judgments_proposed`, then `SEARCH w USING INDEX sqlite_autoindex_works_1 (id=?)`; `SEARCH m USING INDEX idx_work_merges_translations (source=?)`, then the same works search.
3. **`matchCandidatesStmt`** (`sqliteBooksRepository.ts`). It becomes covering on `idx_books_work_editions`:
   - `COUNT(b.id)` becomes `COUNT(*)`. `b.id` is the primary key and never null, so the count is the same. Counting `b.id` needs the row, so it would block the covering read.
   - `json_group_array(DISTINCT COALESCE(b.language, ''))` becomes `json_group_array(COALESCE(b.language, '') ORDER BY b.rowid)`.
   - The mapper dedupes in JS: `languages: [...new Set(JSON.parse(row.languages) as string[])].filter(Boolean)`.
   - **Why:** the old `DISTINCT` kept languages in the order the plan visited editions. That was rowid order through `idx_books_work`. The new index visits by year, and `DISTINCT` dedupes in visit order, before an aggregate `ORDER BY` applies. Ordering all languages by rowid and keeping the first of each in JS gives the old order on purpose instead of by accident.
   - **Plan:** `SEARCH b USING COVERING INDEX idx_books_work_editions (work_id=?)`, with only `USE TEMP B-TREE FOR json_group_array(ORDER BY)`.

No change to `translationReview.ts`, `canonicalWorkIds` or `translationReviewWorks`: on the copy they add 176 and 0 pages after the two reads above.

**Checked on the copy:** old against new code on the same data, all identical (12 comparisons):
- `translationReviewRows` at four threshold pairs;
- `matchCandidates` for the 3,966 proposed originals, 3,000 random works, a list with repeated ids and a missing id, an empty list, and one id;
- the whole `translationReviewWith` response, items in order plus total, with the held list, none, and 20 held.

## Task 1: translation review reads in proportion to the review

- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/translationReview.test.ts`

Steps:
1. Apply changes 1–3 exactly as written.
2. Tests in `sqliteBooksRepository.test.ts`:
   - `assertWorkSchema`: check `PRAGMA index_info(idx_books_work_editions)` is `["work_id", "year", "language"]`, and that `idx_books_work` is gone. Check the test that uses it still reads right.
   - "the held bnp read probes the bnp details index by work and never the work index": the `doesNotMatch` becomes `/idx_books_work_editions\b/`. `\b` doesn't separate `work` from `_editions`, so the old `/idx_books_work\b/` would no longer catch the work index.
   - New migration test, like the existing dropped-index tests:
     - seed a database with the old `idx_books_work ON books(work_id)`;
     - run `applyBooksMigrations` twice;
     - check `idx_books_work` is gone, `idx_books_work_editions` has the three columns, and both partial indexes exist with their WHERE clauses (read `sql` from `sqlite_master`).
   - New plan test for the review rows statement:
     - capture its SQL with `mock.method(db, "prepare")` while the repository is created, as the given-works Portuguese plan test does (filter on `work_match_judgments j CROSS JOIN works w`);
     - run EXPLAIN QUERY PLAN with `{ $merge: 0.9, $review: 0.5 }`;
     - assert `SCAN j USING COVERING INDEX idx_work_match_judgments_proposed`, `SEARCH m USING INDEX idx_work_merges_translations (source=?)` and `SEARCH w USING INDEX sqlite_autoindex_works_1 (id=?)`;
     - assert no `idx_works_merged_into` and no `SCAN m\b`.
   - New plan test for `matchCandidates`, captured the same way: `SEARCH b USING COVERING INDEX idx_books_work_editions (work_id=?)`, and no `USE TEMP B-TREE FOR json_group_array(DISTINCT)`.
   - New repository test for `matchCandidates`:
     - one work whose editions are inserted with languages and years in this order: `en` 2001, `pt` 1999, `en` 1990, `null` with no year, `pt-PT` 2005;
     - it returns `languages` `["en", "pt", "pt-PT"]`: first-insert order, deduped, with the null left out. Year order would give a different list;
     - `editions` 5, `year` 1990, and the work's title and author;
     - a list with that work's id twice and a missing id returns that one work once;
     - a merged-away work, which has no editions left, returns nothing.
   - The existing "looking up keyed works and keyless candidates…" test already pins `idx_work_merges_from` for `KEYED_EDITIONS_SQL`. Keep it, as the guard against the plain-index regression above.
3. Test in `translationReview.test.ts`: "a merge whose original was later folded into another work is no longer listed as merged". This pins arm 2's `w.merged_into = m.into_work`, the condition the `CROSS JOIN` rewrite must keep:
   - merge a Portuguese work into its original with `mergeTranslation`;
   - fold that original into another keyed work with `repo.mergeDuplicateWork(from, into, at)`, which moves the Portuguese work's `merged_into` to the new target;
   - the review no longer lists the merged row.
   - If an existing test already covers this, skip it.
4. Verify:
   - `npm run build --workspace @scripta/shared`;
   - `npm run typecheck --workspace backend`;
   - `npm test --workspace backend`;
   - the two touched test files under `npx -y node@24.21.0` with the env preamble the tests set.
   - Commit.

## Verification after Task 1 (main session)

- **Copy:** re-run the cold pages, the Node 24.21 timings and the old-against-new comparison with the branch's code. They go in the PR description.
- **Deploy (batched by the user):**
  - no variables or `*_DB_PATH` changes;
  - the first boot drops `idx_books_work` and builds three indexes, about 0.3 s, once;
  - after the deploy, opening the translation review should log no `books:translationReviewRows` or `books:matchCandidates` stall above the 200 ms threshold outside an import. During an import, expect roughly a third of today's 7.2 s.

## Task 2: keep the old row order for full ties (review round 2)

The Codex branch review (r1) found the problem. `translationReviewWith` sorts with a stable sort whose last key is the title. Rows that tie on finished, holders, group, `mergedAt` and title therefore keep the order the SQL returned them in. The old statement had no `ORDER BY`. Its plans returned:
- arm 1 in works rowid order, through `idx_works_merged_into`;
- arm 2 in merge `id` order (`SCAN m`).

The new plans return arm 1 in `work_id` order and arm 2 by source. Two live works both titled "Poemas" in the possible group would swap places.

Making the old order explicit fixes it:
- the plans stay the same, each arm adding a small `USE TEMP B-TREE FOR ORDER BY` under `MERGE (UNION ALL)`;
- the copy still reads 7,052 cold pages;
- all 5,180 rows come back in exactly the old statement's order.

- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

Steps:
1. `translationReviewRowsStmt`:
   - arm 1 selects two more columns, `0 AS arm, w.rowid AS seq`;
   - arm 2 selects `1, m.id` in the same positions;
   - the statement ends with `ORDER BY arm, seq`;
   - the mapper stays as it is (it ignores the extra columns).
2. Tests in `sqliteBooksRepository.test.ts`:
   - **Plan test for the review rows:** keep every assertion, adding `MERGE (UNION ALL)` if useful, and still no `idx_works_merged_into` and no `SCAN m\b`.
   - **New repository test for `translationReviewRows` order:**
     - two live works with the same title, inserted so that their ids sort opposite to their insertion order (for example insert `works` rows `w-b` then `w-a` with SQL), each with an open Jev judgment (confidence between `MATCH_REVIEW_AT` and `MATCH_MERGE_AT`) proposing a live original;
     - they come back in insertion order;
     - two translation merges whose `from_work` ids sort opposite to their merge order come back in merge order.
     - The test must be deterministic, so no random ids decide the outcome. It must fail if `ORDER BY arm, seq` is removed.
3. Verify:
   - `npm run build --workspace @scripta/shared`;
   - `npm run typecheck --workspace backend`;
   - `npm test --workspace backend`;
   - the books repository test file under `npx -y node@24.21.0`.
   - Commit.
