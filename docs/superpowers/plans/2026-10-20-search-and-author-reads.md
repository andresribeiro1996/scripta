# Inside search and author candidates at 233k books

Follow-up to PR #312 (`docs/superpowers/plans/2026-10-20-catalog-reads-at-scale.md`), same method: count cold pages on a production-shaped copy, time on Node 24.21, and compare old against new results.

## Goal

Two reads still scale with the catalog. Make them read pages in proportion to their answer, with the same results. No route, client or `@scripta/shared` change.

- **`searchBooks`** (`GET /books/search`): stalled 356 and 437 ms in production at 08:11Z and 08:26Z on 10-20, after the import. These were the only stalls after 04:02Z.
- **`authorCandidates`** (translation matching): 2,086 ms once at boot. It runs once per Portuguese work the translation queue matches, which means after each details lookup of a Portuguese book.

## What the copy shows

The copy is the #312 copy (233,631 books, 2,800 held works). Its titles and authors were rewritten from 7,301 real BNP records, so word frequencies are real Portuguese ones. It has 225,771 FTS rows (every confirmed book) and real `workTitleKey` keys. Old code is main at 35675dd2, on Node 24.21.

- **`searchBooks`:** p50 2 ms, but 75–87 ms for common words ("o" matches 33,149 titles, "mar" 31,079). It reads a `books` row for every match, including `summary`, before it sorts. Cold, "o" reads 8,917 pages.
- **`authorCandidates`:** 34 ms on every call. The pattern `ta:*|<author>|*` has only `ta:` as a literal prefix, and every key starts with `ta:`, so it scans all of `idx_books_title_work`. Cold, it reads 6,159 pages.
- **No change for these:**
  - `titleCandidates`: 0.07 ms. Its pattern has a long literal prefix.
  - `canonicalWorkIds(held)`: 9 ms, one lookup per held work.
  - `worksNeedingSynopsisJudgment(held)`: 19 ms, once a day, proportional to the held works' editions.
  - `synopsesNeedingJudgment([one])`: 0.03 ms.
  - `groupKeylessWorks`: its 1,788 ms boot stall was real merge work from the post-import backlog (`grouped=2581` in the same log). PR #305 measured calls with nothing to merge at 26–30 ms at 240k.

## Changes

1. **`searchStmt`** (`sqliteBooksRepository.ts`). Rank inside FTS first, then read `books` only for the rows returned:
   ```sql
   SELECT books.* FROM (
     SELECT rowid AS fts_row, bm25(books_fts) AS score FROM books_fts
     WHERE books_fts MATCH ? ORDER BY score, fts_row LIMIT ?
   ) AS hits
   JOIN books_fts ON books_fts.rowid = hits.fts_row
   JOIN books ON books.id = books_fts.book_id
   ORDER BY hits.score, hits.fts_row
   ```
   - **Tie-break:** `fts_row` breaks bm25 ties in FTS insertion order. That is the order the old query's sort produced: identical rows for all 46 queries × limits 12 and 100 on the copy.
   - **Cold pages, old → new:** "o" 8,917 → 803; "mar" 8,944 → 804; "historia" 7,424 → 761; "saramago" 825 → 306.
   - **Warm time:** max 87 → 20 ms, p90 16 → 4 ms.
   - **What's left:** FTS5 scoring every match, which `bm25` ranking needs.
2. **`authorCandidatesStmt`** (`sqliteBooksRepository.ts`) and **`authorPattern`** (`domain/translation.ts`).
   - **Index:** add `idx_books_author_key ON books(substr(title_key, instr(title_key, '|') + 1))`, built at boot in `connection.ts` next to the other index lines: 0.15 s and 6 MB on the copy.
   - **Query:** the statement's `WHERE b.title_key GLOB ?` becomes `WHERE substr(b.title_key, instr(b.title_key, '|') + 1) GLOB ?`. The rest of the statement is unchanged.
   - **Pattern:** `authorPattern` returns `${globLiteral(first)}|*` instead of `ta:*|${globLiteral(first)}|*`.
   - **Why the results are the same:** a title key is `ta:<title>|<first author>|<numbers>`, and none of the three parts can contain `|` (`normalizeWords`). So both patterns match exactly when the author part equals the first author.
   - **Index use:** SQLite turns the GLOB's literal prefix into a range on the expression index, `SEARCH b USING INDEX idx_books_author_key (<expr>>? AND <expr><?)`. This holds with a bound parameter on Node 24.21.
   - **Checked:** old against new for 10,163 authors on the copy, identical; p50 34 → 0.1 ms; cold pages 6,159 → 73.

## Task 1: search ranks inside FTS, author candidates read by author

- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/domain/translation.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/domain/translation.test.ts`

Steps:
1. Apply changes 1 and 2 exactly as written.
2. Tests:
   - `translation.test.ts`: `authorPattern("Virginia Woolf, Ana Lima")` is now `"virginia woolf|*"`.
   - New repository test for `searchBooks` order:
     - Three searchable books whose titles contain the term. One is a closer match, for example the title is only the term. The other two have identical title and author, so their bm25 scores tie.
     - The closer match comes first, and the tied pair keeps insertion order.
     - With a limit that cuts between the tied pair, the first inserted is kept.
   - New plan test for the search statement: the plan has `CO-ROUTINE hits`, the FTS scan and its sort come before `SCAN hits`, and the `books` lookup by id comes after `SCAN hits`. Bind real values: a match expression and a limit.
   - New repository test for `authorCandidates(authorPattern(...))`:
     - The first author must match exactly. A work by "Ana Lima" is returned; one by "Ana Limao" or "Ana Lima Costa" is not. Use a co-author written after a comma, so `firstAuthor` is exercised.
     - A work needs at least one non-Portuguese edition.
     - Results are ordered by edition count descending, then id.
     - A merged work reports its live work.
     - If an existing test in `translationJudgments.test.ts` already covers part of this through `planMatch`, keep it and add only the missing cases here.
   - New plan test for the author statement: capture its SQL with `mock.method(db, "prepare")` while the repository is created (as the given-works Portuguese plan test in this file does). Run EXPLAIN QUERY PLAN with a bound `"x|*"` and assert `SEARCH b USING INDEX idx_books_author_key (<expr>>? AND <expr><?)`.
3. Verify: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend`, `npm test --workspace backend`, and the books repository and translation test files under `npx -y node@24.21.0`. Commit.

## Verification after Task 1 (main session)

Re-run the copy's timings, cold pages and old-against-new comparisons with the branch's code. They go in the PR description.
