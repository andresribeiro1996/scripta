# Search Scorecard and Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Jev-graded scorecard that measures catalog search quality, and ranking changes that raise its score on both the tuning and the hidden queries.

**Architecture:**
- **Scorecard (PR 2).** The pure scoring code and candidate pool live in `backend/src/modules/books/scorecard.ts`. Small scripts in `backend/scripts/search-scorecard/` use it.
  - **No local snapshot** (user decision, 2026-10-25: "just do it in prod"). Candidates and scores are computed on the production container over `railway ssh`, read-only, by bundled branch code (see Global Constraints, "Running branch code in production").
  - Jev grades the candidates on the production server, using the server's key. Grading reads no database. Nothing is written there.
  - Scores are measured on repaired data: after PR 1 is deployed and the user has run the repair runbook.
- **Ranking (PR 3).**
  - Moves `searchCatalog`'s hit-building out of `booksService.ts` into `catalogSearch.ts`, so the service and the scorer share it.
  - Adds series-first and a work-level ranking (`domain/searchRank.ts`) driven by edition count, language count, cover and a new Wikipedia count.

**Tech Stack:** TypeScript, `node:sqlite` (FTS5), `node:test` via `tsx`, TypeSafe Jev (`askJev`), Wikidata SPARQL.

**Spec:** `docs/superpowers/specs/2026-10-25-volume-joins-and-search-ranking-design.md` (Parts 2 and 3). Part 1 is `docs/superpowers/plans/2026-10-25-volume-safe-translation-joins.md`. Its Task 4 (the review) runs the guarded listing in production, and this plan's baseline waits until the user has applied that review's undo file in production.

## Global Constraints

- **Queries.** About 150 in total:
  - 50 hand-picked;
  - 50 from Wikipedia's best-selling books and best-selling book series lists;
  - 50 Portuguese (recent Bertrand, Wook and Fnac charts, plus well-known Portuguese authors).

  None comes from Scripta's own data.
- **Split.** One third of each source is hidden, chosen deterministically by the order of `sha1(q)` within the source (the last third is hidden).
- **No per-query rules.** Ranking code never names a book, author or query.
- **Candidates.** 40 per query.
- **Grades.** A three-way Jev choice, `named` = 2, `related` = 1, `unrelated` = 0, times Jev's confidence.
- **Score.** NDCG@10. Unlabelled works in a top 10 count as 0 and are listed.
- **Grading.** Runs only on the production server, through `railway ssh`, with the server's `TYPESAFE_API_KEY`.
  - The script reads no database and writes nothing on the server.
  - The key is never printed or copied.
  - It uses `askJev` from the deployed `dist` with a no-op `spend`.
- **Running branch code in production** (replaces the snapshot). Production only has deployed code, so for code that isn't deployed:
  - bundle the script into one file with esbuild (it ships with tsx);
  - upload it in base64 chunks under 100 KB to `/tmp` on the container (never `/data`), run it, then delete it;
  - open the catalog with `new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true })`;
  - print results to stdout only. No writes, and never print secrets.
- **Order.** (a) PR 1 merges. (b) The guarded listing runs in production and Claude writes the undo file (Plan 1 Task 4). (c) After the BNP import finishes and the user deploys, the user runs the repair runbook. (d) Then candidates, grading and the baseline run in production on repaired data. (e) Then ranking iterations are scored the same way.
- **Timing.** Keep production reads light while the pre-2002 BNP import runs; (d) and (e) wait until it has finished.
- **No deploy** while the deploy hold is in force. Merging to `main` is fine.
- **API stays additive.**
  - Result caps stay `SEARCH_LIMIT` 12 and `WORK_SEARCH_LIMIT` 20.
  - No response field is removed.
  - The old spec's "sorting results by series position" non-goal is superseded.
- **Ranking ship rule.** A ranking PR merges only when all of these hold:
  - the tuning mean is above the baseline's;
  - the hidden mean is above the baseline's;
  - the three hard examples pass;
  - search p95 in production is no more than 50 ms above the baseline's p95, with the baseline and branch runs made back to back in one session (live load makes runs hours apart incomparable).
- **Code style:**
  - No comments in code.
  - New `*.test.ts` files go into `backend/package.json`'s `test` script.
- **Verify** with `node scripts/gate.mjs` before each commit.
- **Running a backend script locally** needs the test environment preamble, because `config/env.ts` exits at import time: `AUTH_DB_PATH`, `LIBRARY_DB_PATH` and `GALLERY_DB_PATH` pointing at scratch files, `JWT_ACCESS_SECRET` set to 64 `a`s and `JWT_REFRESH_SECRET` set to 64 `b`s, plus `COVERS_DB_PATH`.
- **Matching titles and series names ignores a leading article.** One leading article (`the`, `a`, `an`, `o`, `os`, `as`, `um`, `uma`) is dropped from both sides after `normalizeWords`, so "lord of the rings" equals "The Lord of the Rings". Put this helper in `domain/searchRank.ts` as `export function withoutArticle(words: string): string` (it is created in Task 3).
- **Production access.** Use `railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "node --input-type=module -e \"\$(echo <base64> | base64 -d)\""`. If the permission classifier blocks Claude's call, hand the exact command to the user.

## Review Focus

1. **Short or one-word queries** ("it", "dune", "1984", "war"). A prefix match counts only by whole words, needs at least 3 characters, and leads only when no FTS work's title exactly matches the query. An exact series match always leads. Pinned in Task 5.
2. **A query that matches several series** ("harry potter" matches the Wikidata "Harry Potter" and an `ol-subject` variant). Entries are grouped by `name_key`, so one series leads with no duplicated works, and each work's position comes from its best source. Pinned in Task 5.
3. **Series members without a position, or with positions like "1.5" or "III".** They sort numerically where they can, unpositioned members go last, and nothing throws. Pinned in Task 5.
4. **Edition mode** (no `by=work`). A work's editions stay together, and the 12-result cap holds. Pinned in Task 5.
5. **A merged work in the series tables.** Series members resolve to canonical works, so a merged-away volume doesn't appear twice. Pinned in Task 5.

---

### Task 1: dropped

The local snapshot is dropped (user decision, 2026-10-25). Reads run in production; see the Global Constraints.

### Task 2 (main session): query set

**Files:**
- Create: `backend/scripts/search-scorecard/queries.json`

- [ ] **Write `queries.json`** as `[{ "q": string, "source": "hand" | "bestsellers" | "portuguese", "hidden": boolean }]`, about 50 per source.
  - `hand` includes "harry potter", "lord of the rings", "senhor dos anéis", "saramago", "dune", "it" and "1984".
  - `bestsellers` comes from the two Wikipedia lists, as titles and series names.
  - `portuguese` comes from current and recent chart titles and authors.
- [ ] **Set `hidden`** per the Global Constraints split rule. Compute it with a one-off `node -e` and paste the result. No script is committed for it.
- [ ] Commit: `Scorecard queries (tuning and hidden)`.

### Task 3: scoring module and candidate pool

**Files:**
- Create: `backend/src/modules/books/scorecard.ts`
- Test: `backend/src/modules/books/scorecard.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Create: `backend/scripts/search-scorecard/candidates.mjs`
- Create: `backend/src/modules/books/catalogSearch.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Create: `backend/src/modules/books/domain/searchRank.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces, in `catalogSearch.ts`: `export function catalogHits(repo: BooksRepository, tokens: string[], byWork: boolean): Hit[]`.
  - It is moved verbatim from `booksService.ts` (`searchCatalog`'s hit building, `seriesHits`, `collectionHits`, `canonicalHits`, `representativeEdition`), with `Hit` moved too.
  - `searchCatalog` becomes `resultsOf(catalogHits(deps.repo, tokens, byWork))`.
  - This is a refactor with no behaviour change: the existing `booksService.test.ts` search tests pass untouched. It is what `score.mjs` calls, so the baseline measures today's ranking.
- Produces, in `domain/searchRank.ts`: `withoutArticle(words: string): string` (see Global Constraints).
- Produces, on `BooksRepository`:
  - `matchingSeries(tokens: string[]): Array<{ nameKey: string; name: string; exact: boolean; members: Array<{ workId: string; position: string | null }> }>`.
  - Candidates come from `series_fts` with the same MATCH expression as `searchSeriesWorks`. This adds no `books_fts` statement.
  - Let `q = withoutArticle(tokens.join(" "))` and `k = withoutArticle(name_key)`. An entry is `exact` when `k === q`. It is a prefix entry when `q` is at least 3 characters and `k` starts with `q + " "`, so the match is by whole words.
  - Entries are grouped by `name_key` across sources. Members are canonical work ids, each listed once, and a work's position comes from its best source by `SERIES_SOURCE_RANK`.
  - Order: exact entries first, then more members.
  - `work_series` only. Publisher collections don't make a series.
- Produces, in `scorecard.ts`:
  - `export type Grade = { workId: string; grade: "named" | "related" | "unrelated"; confidence: number };`
  - `export function gainOf(grade: Grade): number`: 2, 1 or 0, times `confidence`.
  - `export function ndcgAt(ranked: string[], gains: Map<string, number>, k: number): number`. The ideal ordering comes from all of that query's gains. It returns 0 when every gain is 0.
  - `export type QueryScore = { q: string; hidden: boolean; ndcg: number; unlabelled: string[] };`
  - `export function scoreQueries(queries: Array<{ q: string; hidden: boolean }>, ranked: Map<string, string[]>, grades: Map<string, Grade[]>): { perQuery: QueryScore[]; tune: number; hidden: number }`
  - `export function scorecardCandidates(repo: Pick<BooksRepository, "searchBooks" | "canonicalWorkIds" | "matchingSeries" | "matchCandidates">, query: string, limit = 40): Array<{ workId: string; title: string; author: string; year: number | null }>`. In order:
    1. members of the first `matchingSeries` entry;
    2. FTS works from `searchBooks(tokens, 500)` in bm25 order, deduplicated by canonical id;
    3. the 10 FTS works with the most `editions`.

    It deduplicates and cuts to `limit`.
- Script:
  - `backend/scripts/search-scorecard/candidates.mjs` reads `queries.json` and prints `{ [q]: candidates[] }` JSON, opening `COVERS_DB_PATH` read-only.
  - It is bundled with esbuild and run on the production container, per the Global Constraints. Its queries are embedded in the bundle.

- [ ] **Tests in `scorecard.test.ts`:**
  - `ndcgAt(["a","b"], new Map([["a",2],["b",1]]), 10)` → `1`.
  - `ndcgAt(["b","a"], …same…, 10)` is strictly between 0 and 1.
  - `ndcgAt(["x"], new Map(), 10)` → `0`.
  - `scoreQueries` averages the tuning and hidden sets separately and lists ungraded ids found in the top 10 as `unlabelled`.
  - `withoutArticle("the lord of the rings")` → `"lord of the rings"`; `withoutArticle("theory")` → `"theory"`.
  - `scorecardCandidates` on a fixture with a "Harry Potter" series of 3 Rowling works (positions 1–3) whose titles don't all contain the query, plus 2 other "Harry Potter" titles: all 5 appear, series members first.
- [ ] **Repository test** for `matchingSeries`:
  - exact beats prefix;
  - `["lord","of","the","rings"]` matches "The Lord of the Rings" as `exact`;
  - `["war"]` doesn't match "Warriors" (whole words only);
  - a 2-character query gets no prefix matches;
  - a member merged into another work comes back as the canonical id, once.
- [ ] **Implement,** and add `scorecard.test.ts` to the `test` script. Run `node scripts/gate.mjs`.
- [ ] **Commit** with message `Scorecard scoring and candidate pool`.

### Task 4: grading and scoring scripts; baseline

**Files:**
- Create: `backend/scripts/search-scorecard/grade.mjs`
- Create: `backend/scripts/search-scorecard/score.mjs`
- Create: `backend/scripts/search-scorecard/grades.json` (generated, committed)
- Create: `backend/scripts/search-scorecard/README.md`

**Interfaces:**
- `grade.mjs`:
  - It reads a JSON batch `{ [q]: candidates[] }` from the base64 text embedded at its top. The runner (the main session) substitutes it.
  - It imports `askJev` from the deployed `dist/modules/books/adapters/typesafe/jevRequest.js`. Find the container path with `pwd`/`ls` first.
  - It asks, for each pair, with `state: { query, book: candidateLabel(candidate) }` (`candidateLabel` from `jevWorkMatch.js`). The question:

    ```js
    { relevance: { type: "choice", instructions: "`query` is what a reader typed into a book search box. How does `book` relate to what they want?", criteria: { named: "It is what the query asks for: the titled book, a book of the named series, or a book by the named author", related: "It is about or bundles what the query asks for (an omnibus, box set, companion, guide, study or adaptation) but is not the book itself", unrelated: "It only shares words with the query" } } }
    ```

  - It prints `Grade` JSON lines.
  - Batches stay under 100 KB of base64, so the `node -e` argument fits.
- `score.mjs [--set tune|hidden|all]`:
  - It defaults to `tune`. It is bundled with esbuild together with `queries.json` and `grades.json`, and run on the production container, read-only, per the Global Constraints.
  - For each query it runs `catalogHits(repo, searchTokens(q), true)` (Task 3) and takes the canonical `workId`s in order.
  - It prints a table of `q`, NDCG@10 and unlabelled count, then `tune` and `hidden` means, then search p50 and p95 in ms.

Steps:
- [ ] **Wait for repaired data.** Production must carry PR 1's deploy and the user's run of the repair runbook (Plan 1 Task 4). Until then, write and test the scripts but don't grade.
- [ ] **Candidates.** Run the bundled `candidates.mjs` in production and save stdout to `$HOME/.cache/scripta/candidates.json`. Expected: about 150 keys, most with 40 candidates.
- [ ] **Grade on the server,** in batches, as in the spec's production-read command.
  - Collect the output into `grades.json` as `{ [q]: Grade[] }`.
  - Record the number of calls and the TypeSafe spend reported for the day.
- [ ] **Baseline.** Run the bundled `score.mjs --set all` in production on today's ranking.
  - Grade any `unlabelled` ids with one more server batch, then rerun.
  - Save the printed output for the PR description.
- [ ] **README.** Write `README.md` with the four commands (candidates, grade batch, score, top-up) and the ship rule.
- [ ] **Commit** `grade.mjs`, `score.mjs`, `grades.json`, `README.md` with message `Search scorecard: Jev grades and baseline`.
- [ ] **Open PR 2** with the baseline table in its description.

### Task 5: work-level ranking with series first

**Files:**
- Modify: `backend/src/modules/books/catalogSearch.ts`
- Modify: `backend/src/modules/books/domain/searchRank.ts`
- Test: `backend/src/modules/books/domain/searchRank.test.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/normalize.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `matchingSeries` (Task 3).
- Produces:
  - On `BooksRepository`: `workSignals(workIds: string[]): Map<string, { editions: number; languages: number; hasCover: boolean; wikipediaSites: number | null }>`. Counts span all editions of the canonical work. `wikipediaSites` stays `null` until Task 6.
  - In `domain/searchRank.ts`:
    - `export type RankCandidate = { workId: string; textScore: number; exactTitle: boolean; signals: { editions: number; languages: number; hasCover: boolean; wikipediaSites: number | null } };`
    - `export function rankWorks(candidates: RankCandidate[]): string[]`
    - `export function seriesOrder(members: Array<{ workId: string; position: string | null }>): string[]`. It sorts by a numeric position: a decimal, or a Roman numeral converted to a number. Unpositioned members go last, in their stored order.
  - `catalogHits` (Task 3) keeps its signature and gains the ranking below.
  - On `BooksRepository`: `searchBooks(tokens, limit)` returns `Array<BookRow & { search_score: number }>`. `searchStmt` also selects `hits.score AS search_score`. It stays the single `books_fts MATCH` statement, which the pinned repository test checks. Existing callers keep working, since the type is a superset.
  - In `normalize.ts`: a new `CATALOG_SCAN_LIMIT` for the catalog FTS scan in both modes. Use the smallest value that puts "Harry Potter e a Pedra Filosofal" inside the scan in production (read-only), capped at 500. `WORK_SCAN_LIMIT` stays 100, because the games search, `searchSeriesWorks` and `collectionHits` also use it.

**Ranking (the shape is fixed, the weights are tuned):**
1. **Series first.** The first `matchingSeries(tokens)` entry's `seriesOrder` members lead when either:
   - it is `exact`; or
   - it is a prefix entry and no FTS work's `withoutArticle(normalizeWords(title))` equals `withoutArticle(tokens.join(" "))`.
2. **Remaining FTS works** follow, ordered by `rankWorks`.
   - `textScore` is that work's best bm25, negated, so higher is better.
   - `exactTitle` means `withoutArticle(normalizeWords(title)) === withoutArticle(tokens.join(" "))`.
   - Combine them: `exactTitle` adds a fixed bonus, and the signals are added as weighted `log1p` terms.
   - Start with every weight at 1 and the bonus at 1. Adjust only by running `score.mjs --set tune`.
3. **Collection hits** come last, as today.
4. **Edition mode.** It scans `CATALOG_SCAN_LIMIT` rows too, not 12. Each work's editions are grouped in that work order, keeping their bm25 order within the work, and cut to the cap.

- [ ] **Tests in `booksService.test.ts` (hard examples)**, using the existing search-test harness:
  - **harry potter.** Seven Rowling works with Wikidata series "Harry Potter" at positions 1–7 and 3 editions each, plus four one-edition works titled "Harry Potter" by other authors. `search("harry potter", { byWork: true })` lists the seven Rowling works first, in positions 1–7.
  - **lord of the rings.** "The Fellowship of the Ring", "The Two Towers" and "The Return of the King" with series "The Lord of the Rings" at 1–3, plus the omnibus "The Lord of the Rings" (4 editions) and "2024 The Lord of the Rings Wall Calendar" (1 edition). The order starts with the three volumes, then the omnibus, then the calendar.
  - **dune.** "Dune" by Frank Herbert (6 editions, series "Dune" position 1), "Dune Messiah" (series position 2), and a one-edition "Dune" by another author. Herbert's "Dune" is first.
  - **Review Focus items 1–5** each get one test:
    - "it" (2 characters) gets no series prefix lead;
    - two matching series yield one leading series with no duplicate works;
    - positions "1.5" and "III" sort correctly, and unpositioned members go last;
    - edition mode groups editions and returns at most 12;
    - a merged-away member appears once, as its canonical work.
- [ ] **`searchRank.test.ts`:**
  - `seriesOrder` with positions `["2","1","III",null,"1.5"]` → order 1, 1.5, 2, III, null.
  - `rankWorks` puts a 30-edition, 8-language work above a 1-edition work with a slightly better `textScore`.
- [ ] **Implement.** Then add `searchRank.test.ts` to `test`.
- [ ] **Run `node scripts/gate.mjs`,** then the bundled `score.mjs --set tune` in production.
  - Tune the weights until the tuning mean is above the baseline's.
  - Then run `--set hidden` once. If the hidden mean isn't above the baseline's, step back toward simpler weights. Don't tune on the hidden set.
- [ ] **Commit** with message `Rank catalog search by work, series first`. Record the before and after means and p95 in the commit message.

### Task 6: Wikipedia count signal

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/domain/searchRank.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Create: `backend/scripts/wikidata.mjs`
- Modify: `backend/scripts/fill-series.mjs`
- Create: `backend/scripts/fill-wikipedia-counts.mjs`

**Interfaces:**
- **Column.** `works.wikipedia_sites INTEGER` (nullable), added with the `PRAGMA table_info(works)` / `ALTER TABLE works ADD COLUMN` pattern.
- **Repository.**
  - `setWikipediaSites(rows: Array<{ olWorkKey: string; sites: number }>): number` updates the canonical work holding each key and returns the count updated.
  - `workSignals` reads the column.
- **`backend/scripts/wikidata.mjs`** exports `wikidataQuery(sparql: string): Promise<unknown[]>`, the fetch-with-retry function moved out of `fill-series.mjs` (`fill-series.mjs:87-109`, with its constants). `fill-series.mjs` imports it with no behaviour change. Each script keeps its own paging loop.
- **`fill-wikipedia-counts.mjs [--dry-run]`.**
  - It pages `?work wdt:P648 ?id . ?work wikibase:sitelinks ?n . FILTER(REGEX(?id, "^OL[0-9]+W$"))`, with no label OPTIONALs.
  - It writes via `setWikipediaSites`.
  - It prints matched and updated counts.

- [ ] **Repository tests.**
  - An old database gets the column on `applyBooksMigrations`.
  - `setWikipediaSites` writes to the canonical work when the key's work was merged.
  - `workSignals` returns the value.
- [ ] **Implement,** then run `node scripts/gate.mjs`.
- [ ] **Measure.**
  - Production can't be written for a measurement, so run `fill-wikipedia-counts.mjs --dry-run` locally (Wikidata is public) with an option that writes the `{ olWorkKey: sites }` map to a file instead of the database.
  - Bundle that map with `score.mjs`, which overlays it on `workSignals`' `wikipediaSites` in memory (keys resolved to canonical works read-only). Nothing is written.
  - Add a `log1p(wikipediaSites)` term to `rankWorks`, with `null` treated as 0, and rerun `score.mjs --set tune`.
  - Keep the term only if the tuning mean rises. Then run `--set hidden` once.
  - If the term is dropped, revert the whole task with `git reset --hard` to the Task 5 commit, since YAGNI. Record the measured numbers in the PR description instead.
- [ ] **Commit** with message `Wikipedia count as a ranking signal`, with the numbers, if the term is kept.

### Task 7 (main session): PR 3

- [ ] **Final scorecard.** Run `score.mjs --set all`.
  - Grade any unlabelled ids first.
  - Paste the tuning mean, the hidden mean and p95 against the baseline into the PR description. Also paste the hard-example orders, as run in production.
- [ ] **Check the ship rule** in the Global Constraints. If it fails, don't merge; bring the numbers to the user.
- [ ] **Runbook entry** for the user, after the deploy:
  1. if Task 6 kept the signal, `fill-wikipedia-counts.mjs --dry-run`, then the real run on production, with the expected matched count from the local dry run;
  2. a read-only check of the "harry potter" and "lord of the rings" orders.
