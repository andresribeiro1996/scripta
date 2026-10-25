# Book Awards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prizes from Wikidata are stored per catalog work. They show as pills on the work page (web and mobile), and recent wins show as a dismissible mobile Home card.

**Architecture:**
- A `work_awards` table in the books DB.
- One fill (`seed/awardsFill.ts`), fed by a backfill script and by a daily server job that re-reads recent years.
- The Wikidata client and matching move out of the series fill and are shared with it.
- `GET /works/:id` gains `work.awards`, and a new `GET /awards/recent` feeds the card.

**Tech Stack:** Fastify/TypeScript + `node:sqlite`, `@scripta/shared` (`node:test` via `tsx`), Expo mobile, React/Vite web.

**Spec:** `docs/superpowers/specs/2026-10-24-book-awards-design.md`

## Global Constraints

**Prize keys**, exactly: `booker`, `international-booker`, `hugo-novel`, `nebula-novel`, `pulitzer-fiction`, `nobel-literature`, `camoes`, `leya`, `saramago`, `ape-novel`.
- Task 1 drops any key whose prize has no Wikidata item, here and in the spec.
- Labels and `honours` come from the spec's Prizes table. `nobel-literature` and `camoes` honour an author.

**Shared types**, in `packages/shared/src/works/types.ts`:
- `WorkAward = { prize: string; year: number; won: boolean }`
- `AwardWinner = { workId: string; title: string; author: string; coverUrl: string | null }`
- `AwardAnnouncement = { prize: string; year: number; announcedAt: string; winners: AwardWinner[]; nomineeWorkIds: string[]; honoree: { name: string; workIds: string[] } | null }`
- `RecentAwards = { announcements: AwardAnnouncement[] }`
- `WorkPage["work"]` gains `awards?: WorkAward[]`.

**The fill's row:** `AwardRow = { isbns: string[]; olWorkIds: string[]; prize: PrizeKey; year: number; won: boolean; honoree: string | null }`.

**Constants:**
- `ANNOUNCE_DAYS = 14`
- the daily job interval `24 * 60 * 60 * 1000`
- `FIRST_RUN_DELAY_MS.awardsRefresh = 165_000`

**Rules:**
- Additive API only (`backend/AGENTS.md`). Clients drop unknown prize keys.
- No comments in code.
- New backend `*.test.ts` files go into `backend/package.json`'s explicit `test` list. Mobile, shared and frontend `scripts/test-*.mts` are found by glob.
- Rebuild shared (`npm run build --workspace @scripta/shared`) before any consumer's checks. Run `node scripts/gate.mjs` before every commit.

## Review Focus

- **The series fill is unchanged** after Task 2's extraction: same SPARQL, same stdout report keys, same stderr progress lines, and `seriesFill.test.ts` not edited at all.
- **A win beats a nomination** whatever order the rows arrive in, across runs too: a later nomination never downgrades a stored win (Task 4).
- **An upgrade moves `created_at`:** a nomination later upgraded to a win counts as announced at the upgrade, so the card shows it (Task 4).
- **Merged works roll up:** awards on an alias work show on its canonical work's page, and duplicates collapse (Task 4).
- **The daily job uses the server's existing `openLibraryThrottle`**, never a new throttle, and nothing calls Wikidata before its first-run delay (Task 6).
- **`/awards/recent` returns only the current UTC year**, within `ANNOUNCE_DAYS` of the first stored win for that prize and year. Ties follow the prize list (Task 4, Task 7).
- **Unknown prize keys** are dropped by `knownAwards`, `bookScreenModel` and `awardCardModel` (Task 3, Task 7, Task 8, Task 9).

---

### Task 1: Check the prizes on Wikidata (a controller or user step)

This is not an implementer task. It needs `query.wikidata.org` and `www.wikidata.org`, which the agent proxy refused in the cloud session that wrote this plan.

**Probe first:**
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -G --data-urlencode 'query=ASK{}' https://query.wikidata.org/sparql
```
A `200` means run it here.

**Otherwise, either:**
- the user runs the queries on their own machine; or
- `deploy-ops` runs them from the Railway container: `railway ssh … node -e 'fetch(…)'`, read-only. The container needs Wikidata egress for Task 6 anyway.

Tasks 2, 3 and 4 don't depend on this task and can start without it. Task 5 can't.

The SPARQL below can be pasted into `https://query.wikidata.org/`, or sent with `curl -G --data-urlencode query@file.rq -H 'Accept: text/csv'`.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-book-awards-design.md`

- [ ] **Step 1: Labels of the known items.** These must read Booker Prize, International Booker Prize, Hugo Award for Best Novel, Nebula Award for Best Novel, Pulitzer Prize for Fiction, and Nobel Prize in Literature:
  ```sparql
  SELECT ?item ?label WHERE {
    VALUES ?item { wd:Q160082 wd:Q2052291 wd:Q255032 wd:Q266012 wd:Q833633 wd:Q37922 }
    ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  }
  ```
- [ ] **Step 2: Find the four unknown items** with `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=pt&search=<name>` for "Prémio Camões", "Prémio LeYa", "Prémio José Saramago" and "Grande Prémio de Romance e Novela". Confirm each pick by its description. A prize with no item is dropped (Global Constraints).
- [ ] **Step 3: Measure each shape**, with every confirmed item in `VALUES`:
  ```sparql
  SELECT ?prize
    (COUNT(DISTINCT ?a) AS ?onWork) (COUNT(DISTINCT ?b) AS ?onPersonForWork) (COUNT(DISTINCT ?c) AS ?onPrizeForWork)
    (COUNT(DISTINCT ?p) AS ?onPerson) (COUNT(DISTINCT ?ay) AS ?onWorkWithYear)
  WHERE {
    VALUES ?prize { wd:Q160082 wd:Q2052291 wd:Q255032 wd:Q266012 wd:Q833633 wd:Q37922 }
    { ?a p:P166|p:P1411 ?s . ?s ps:P166|ps:P1411 ?prize . ?a wdt:P31/wdt:P279* wd:Q47461344 . }
    UNION { ?a2 p:P166|p:P1411 ?s2 . ?s2 ps:P166|ps:P1411 ?prize . ?a2 wdt:P31/wdt:P279* wd:Q47461344 . ?s2 pq:P585 ?y . BIND(?a2 AS ?ay) }
    UNION { ?person p:P166|p:P1411 ?s3 . ?s3 ps:P166|ps:P1411 ?prize ; pq:P1686 ?b . }
    UNION { ?prize p:P1346 ?s4 . ?s4 pq:P1686 ?c . }
    UNION { ?p wdt:P31 wd:Q5 ; p:P166 ?s5 . ?s5 ps:P166 ?prize . }
  }
  GROUP BY ?prize
  ```
  If it times out, run one `UNION` branch at a time. Then run two more queries:
  - For each prize, how many works shape (b) and shape (c) name that shape (a) doesn't already have. Use `FILTER NOT EXISTS { ?b p:P166|p:P1411 [ ps:P166|ps:P1411 ?prize ] }`.
  - For each prize, how many of its last three years' winning works carry P648 or an ISBN, directly or on an edition (P629). The Home card can only fire for these.
- [ ] **Step 4: Update the spec.**
  - Fill the Prizes table's item IDs, and drop any prize with no item.
  - Replace the first two bullets of "Unverified at spec time" with what was measured, dated.
  - State the shapes the fill queries: (a), plus (b) and/or (c) for each that adds at least one work. For author prizes, the person shape is `onPerson`.
  - Write down any near-zero counts (shapes, or recent winners with identifiers) for the user's keep-or-drop call, raised at the post-merge dry-run review.
- [ ] **Step 5:** Commit the spec. Task 5's queries implement exactly the shapes recorded here.

### Task 2: Share the Wikidata client and matching with the series fill

**Files:**
- Create: `backend/src/modules/books/adapters/wikidata/sparql.ts`
- Test: `backend/src/modules/books/adapters/wikidata/sparql.test.ts`
- Create: `backend/src/modules/books/seed/wikidataMatch.ts`
- Test: `backend/src/modules/books/seed/wikidataMatch.test.ts`
- Modify: `backend/src/modules/books/seed/seriesFill.ts`
- Modify: `backend/scripts/fill-series.mjs`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `sparql.ts` exports:
  - `type Binding` and `listOf(binding, name)`;
  - `queryWikidata(query, { log, sleep?, signal? })`;
  - `queryAllPages(page: (offset: number) => string, { log, sleep?, signal?, onPage? })`. It pages 3000 rows at a time until a short page, with a 5 s gap between pages.
- Produces: `wikidataMatch.ts` exports:
  - `inBatches(repo, items, write)`;
  - `followRedirects(repo, fetchWork, olWorkKey)`;
  - `matchWorkIds(repo, fetchWork, rows: Array<{ isbns: string[]; olWorkIds: string[] }>)`, returning `{ workIds: Array<Set<string>>; redirected: number; failedKeys: string[] }` with `workIds[i]` belonging to `rows[i]`;
  - `createWorkFetcher({ log, sleep? })`, the script's Open Library fetcher (1 s gap, 429 retry, progress every 100) moved verbatim.

- [ ] **Step 1: Write the failing tests.**
  - `sparql.test.ts`, with `fetch` stubbed on `globalThis` and a no-op `sleep`:
    - "queryWikidata posts the query with the shared User-Agent and returns the bindings"
    - "queryWikidata retries a 429, a 5xx, a timeout and invalid JSON up to three attempts, then throws naming the last cause"
    - "queryWikidata throws at once on a 4xx other than 429"
    - "queryAllPages stops on a short page and waits between pages"
    - "queryWikidata stops when the signal aborts"
    - "listOf splits on | and drops blanks"
  - `wikidataMatch.test.ts`:
    - "matchWorkIds matches by ISBN and by Open Library ID"
    - "matchWorkIds follows a redirect through two hops"
    - "a 404 or a non-redirect record matches nothing"
    - "a non-429 failure goes to failedKeys and a 429 is rethrown"
    - "each Open Library key is fetched once"
    - "createWorkFetcher retries a 429 after its wait and gives up after three attempts"
  - Leave `seriesFill.test.ts` exactly as it is.
- [ ] **Step 2:** `npm test --workspace backend` fails on the missing modules.
- [ ] **Step 3: Implement.**
  - Move `queryWikidata`, its constants, `isRetryable` and `reasonOf` from `fill-series.mjs` into `sparql.ts`, unchanged except for the injectable `sleep` and `signal`. `listOf` and `Binding` move there from `seriesFill.ts`.
  - Move `inBatches`, `followRedirects`, `redirectTarget` and the matching block of `fillFromWikidata` into `wikidataMatch.ts`, along with `createWorkFetcher` from `fill-series.mjs`.
  - `fillFromWikidata` filters `kept` rows as today, then calls `matchWorkIds` on them.
  - `fill-series.mjs` imports `queryWikidata` and `queryAllPages` from `../dist/modules/books/adapters/wikidata/sparql.js`, and `createWorkFetcher` from `../dist/modules/books/seed/wikidataMatch.js`. It keeps its `log` lines, `{ kind, offset, bindings, rows }` through `onPage`, and its report.
  - Add both test files to `backend/package.json`.
- [ ] **Step 4: Verify.**
  - `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run build --workspace backend`. All pass, with `seriesFill.test.ts` untouched.
  - Then check the script's `dist` imports resolve:
    ```bash
    node --input-type=module -e "const s = await import('./backend/dist/modules/books/adapters/wikidata/sparql.js'); const m = await import('./backend/dist/modules/books/seed/wikidataMatch.js'); for (const [mod, n] of [[s,'queryWikidata'],[s,'queryAllPages'],[m,'createWorkFetcher']]) if (typeof mod[n] !== 'function') throw new Error(n)"
    ```
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 3: Prize list and types in shared

**Files:**
- Create: `packages/shared/src/works/awards.ts`
- Test: `packages/shared/src/works/awards.test.ts`
- Modify: `packages/shared/src/works/types.ts`
- Modify: `packages/shared/src/works/index.ts`
- Modify: `packages/shared/src/works/api.ts`
- Modify: `packages/shared/src/works/api.test.ts`

**Interfaces:**
- Produces: `PrizeKey`, `PRIZES: Record<PrizeKey, { label: string; honours: "work" | "author" }>` in the spec's table order, and `isPrizeKey(value)`.
- Produces: `awardLabel(award: WorkAward): string`, which gives "Hugo Award 1993" for a win and "Booker Prize 2019 · nominee" for a nomination.
- Produces: `knownAwards(awards: WorkAward[] | undefined): Array<WorkAward & { prize: PrizeKey }>`. It drops unknown keys, and puts wins first, then nominations, each newest year first.
- Produces: the Global Constraints types, and `fetchRecentAwards(): Promise<RecentAwards>` on `createWorksApi` (GET `/awards/recent`, `auth: "none"`, as `fetchRecapIndex` is).

- [ ] **Step 1: Write the failing tests.**
  - `awards.test.ts`: "PRIZES lists the prizes in order with their labels", "only the Nobel and the Camões honour an author", "awardLabel names a win and a nomination", "knownAwards drops unknown keys and sorts wins first, newest first", "knownAwards of undefined is empty".
  - `api.test.ts`: "fetchRecentAwards requests /awards/recent without auth", in the file's existing style.
- [ ] **Step 2:** `npm test --workspace @scripta/shared` fails.
- [ ] **Step 3:** Implement. Export from `works/index.ts`.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 4: `work_awards` storage

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces, on `BooksRepository`:
  - `addWorkAward(row: { workId: string; prize: string; year: number; won: boolean; honoree: string | null }, at: string): boolean`. True only when it inserts a row or upgrades one from nominated to won.
  - `awardsOf(workIds: string[]): Map<string, WorkAward[]>`, keyed by each given id, with aliases rolled up as `bestSeriesOf` does. Duplicate prize and year pairs collapse, and won wins.
  - `recentAwards(year: number, since: string): Array<{ prize: string; year: number; announcedAt: string; winnerWorkIds: string[]; nomineeWorkIds: string[]; honoree: string | null }>`. Work ids are canonical (`COALESCE(merged_into, id)`) and deduplicated. Ordered by `announcedAt` descending.

- [ ] **Step 1: Write the failing tests** in `sqliteBooksRepository.test.ts`:
  - "addWorkAward inserts once and reports nothing new on a repeat"
  - "addWorkAward upgrades a nomination to a win, and a later nomination never downgrades it"
  - "addWorkAward keeps created_at on a repeat and moves it on an upgrade"
  - "awardsOf rolls an alias work's awards up to its canonical work and collapses duplicates"
  - "recentAwards keeps prizes of the given year whose first win is on or after since"
  - "recentAwards dates an upgraded nomination from its upgrade"
  - "recentAwards ignores prize years with nominations only, and lists nominees beside winners"
  - "recentAwards reports canonical work ids"
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - The table and index go into `books.sql` exactly as in the spec.
  - The upsert is `INSERT … ON CONFLICT(work_id, prize, year) DO UPDATE SET won = 1, created_at = excluded.created_at WHERE won = 0 AND excluded.won = 1`. Return `changes > 0`.
  - `awardsOf` reuses `aliasesOf` and `canonicalWorkIds`.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 5: The awards fill and the backfill script

**Start only when** the spec's Prizes table has no `?` and Task 1's shapes are recorded in the spec.

**Files:**
- Create: `backend/src/modules/books/domain/awards.ts`
- Create: `backend/src/modules/books/seed/awardsFill.ts`
- Test: `backend/src/modules/books/seed/awardsFill.test.ts`
- Create: `backend/scripts/fill-awards.mjs`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `queryAllPages`, `listOf` and `Binding` (Task 2), `matchWorkIds`, `inBatches` and `createWorkFetcher` (Task 2), `addWorkAward` (Task 4), and `PrizeKey`, `PRIZES` and `isPrizeKey` (Task 3).
- Produces: `domain/awards.ts` exports `PRIZE_ITEMS: Record<PrizeKey, string>` (Wikidata item IDs from Task 1).
- Produces: `awardsFill.ts` exports:
  - `awardQueries(minYear?: number): Array<{ kind: string; page: (offset: number) => string }>`, one per identifier kind and shape;
  - `awardRowsOf(bindings: Binding[]): { rows: AwardRow[]; noYear: Partial<Record<PrizeKey, number>> }`;
  - `fillAwards(repo, fetchWork, rows, at, { dryRun }): Promise<{ matched; added; redirected; failedKeys; prizes }>`;
  - `refreshAwards({ repo, query, fetchWork, now, info }, signal): Promise<void>`, used by Task 6. It runs every query through `queryAllPages` (`query` is the per-page fetch), so nothing is truncated at 3000 rows.

- [ ] **Step 1: Write the failing tests** in `awardsFill.test.ts`, with an in-memory repository as `seriesFill.test.ts` builds one:
  - "awardRowsOf reads P166 as won and P1411 as nominated"
  - "awardRowsOf counts statements with no year per prize and leaves them out"
  - "awardRowsOf ignores an unlisted item"
  - "awardRowsOf takes the honoree's English label, else Portuguese, else any"
  - "awardQueries makes P585 optional without minYear and filters on it with one"
  - "awardQueries covers each identifier kind for every shape Task 1 recorded"
  - "fillAwards writes an author prize on every matched work of its honoree"
  - "a dry run makes the same lookups and writes nothing"
  - "fillAwards reports per prize rows, works, won and nominated"
  - "refreshAwards queries from last year, pages until a short page and logs one summary line"
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - The queries follow the spec's Wikidata queries section and Task 1's recorded shapes, with `?when` from `pq:P585`.
  - Each page query selects `?prize`, `?won`, `?year`, the grouped identifiers, and the honoree labels for author prizes.
  - `awardRowsOf` maps `?prize` back to a key through `PRIZE_ITEMS`.
  - `fill-awards.mjs` follows `fill-series.mjs`:
    - `parseArgs` takes `--dry-run`, wrapped so that an unknown option prints the usage and exits 1;
    - it needs `COVERS_DB_PATH`;
    - the dry run opens the DB read-only, and a real run uses `openBooksDb` behind `waitForBnpLock`;
    - it imports `createWorkFetcher` from `dist`;
    - every Wikidata query runs before any Open Library request;
    - a JSON report on stdout: `prizes` (each with `item` and the item's English `label`, fetched by one labels query), `noYear`, `pages`, `rows`, `matched`, `added`, `redirected` and `failedKeys`.
  - Add the test file to `backend/package.json`.
- [ ] **Step 4: Verify.**
  - `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run build --workspace backend`. All pass.
  - `node backend/scripts/fill-awards.mjs --bogus` prints its usage and exits 1.
  - Check every name `fill-awards.mjs` imports from `dist` resolves to a function, with the same `node --input-type=module -e` check as Task 2, listing those names.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 6: Daily refresh job

**Files:**
- Modify: `backend/src/modules/books/plugin.ts`
- Test: `backend/src/booksWiring.test.ts`

**Interfaces:**
- Consumes: `refreshAwards` (Task 5), `queryWikidata` (Task 2), the plugin's existing `openLibraryThrottle` and `fetchJson`.

- [ ] **Step 1: Write the failing test.** In `booksWiring.test.ts`:
  - the first-run delays table gains `awardsRefresh: 165_000` and is armed once;
  - the boot `requests` regex gains `wikidata`, so a Wikidata call before the first-run delay fails the test.
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - Add `awardsRefresh: 165_000` to `FIRST_RUN_DELAY_MS`.
  - Register:
    ```ts
    jobs.every("awards refresh", 24 * 60 * 60 * 1000, (signal) => refreshAwards({
      repo,
      query: (q) => queryWikidata(q, { log: (line) => app.log.warn(line), signal }),
      fetchWork: (key) => openLibraryThrottle(() => fetchJson("openlibrary", `https://openlibrary.org/works/${key}.json`)),
      now: Date.now,
      info: (details, message) => app.log.info(details, message)
    }, signal), FIRST_RUN_DELAY_MS.awardsRefresh)
    ```
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 7: Awards in the API

**Files:**
- Modify: `backend/src/modules/books/works.ts`
- Modify: `backend/src/modules/books/index.ts`
- Test: `backend/src/modules/books/works.test.ts`
- Modify: `backend/src/modules/works/service.ts`
- Test: `backend/src/modules/works/service.test.ts`
- Modify: `backend/src/modules/works/routes.ts`
- Test: `backend/src/modules/works/routes.test.ts`
- Modify: `backend/src/modules/works/plugin.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `awardsOf` and `recentAwards` (Task 4), and `knownAwards`, `PRIZES` and the types (Task 3).
- Produces:
  - `CatalogWorkPage.awards?: WorkAward[]` (optional, like `series?`);
  - `getRecentAwardsWith(books, coverUrl, now): AwardAnnouncement[]` and `getRecentAwards()` in `books/works.ts`, exported from `books/index.ts`;
  - `WorksDeps.getRecentAwards`;
  - `WorksService.recentAwards(): RecentAwards`;
  - `GET /awards/recent`.

- [ ] **Step 1: Write the failing tests.**
  - `works.test.ts`:
    - "getWorkPageWith includes the work's awards, wins first, newest first"
    - "getRecentAwardsWith builds book-prize winners with title, author and the first edition cover"
    - "getRecentAwardsWith gives an author prize its honoree and work ids and no winners"
    - "getRecentAwardsWith asks for the current UTC year and ANNOUNCE_DAYS back"
    - "getRecentAwardsWith breaks announcedAt ties in prize-list order"
  - `service.test.ts`: "getPage passes awards through".
  - `routes.test.ts`: "GET /awards/recent returns the announcements with no-store and needs no sign-in".
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - `getWorkPageWith` sets `awards: knownAwards(books.awardsOf([rows.work.id]).get(rows.work.id))`.
  - `getRecentAwardsWith` reads `recentAwards(year, since)` and sorts by `announcedAt` descending, then by `PRIZES` key order.
  - For each book-prize winner, it builds a winner from `workPageRows`: the title and author of the work, and the first edition with a cover. A winner whose work is gone is skipped.
  - `honoree` is `{ name, workIds: winnerWorkIds }` for an author prize. A row with a null honoree name falls back to the first winner work's author.
  - `getPage` sets `awards: work.awards`.
  - The route goes in `buildWorkRoutes`, beside `/works/:id`, with `Cache-Control: no-store`.
  - In `works/plugin.ts`, `getRecentAwards` is wrapped in `WorkResolutionError` as `getWorkPage` is.
  - Wire `getRecentAwards` in `app.ts`'s `registerWorksModule` call.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 8: Award pills on the work page

**Files:**
- Modify: `packages/shared/src/works/bookScreen.ts`
- Test: `packages/shared/src/works/bookScreen.test.ts`
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Test: `frontend/scripts/test-work-page.mts`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: `knownAwards`, `awardLabel` and `PRIZES` (Task 3).
- Produces: `BookScreenModel.awards: Array<{ label: string; won: boolean }>`, holding book prizes only, and `BookScreenModel.authorAwards: string | null`. The latter is the author prizes' "Label Year" parts joined with " · ", or null.

- [ ] **Step 1: Write the failing tests.**
  - `bookScreen.test.ts`:
    - "awards lists book prizes as labelled pills, wins first"
    - "authorAwards joins author prizes and leaves them out of awards"
    - "unknown prizes are dropped"
    - "a page without awards has none"
  - `test-work-page.mts`: "the work page shows a win pill, a nominee pill and the author prize line", rendering a page that carries one of each.
- [ ] **Step 2:** `npm test --workspace @scripta/shared` fails.
- [ ] **Step 3: Implement.**
  - **Mobile:** the `authorAwards` caption goes under the author `Text`, in `typography.caption` and `textDim`, centred. A pills row goes above the genre chips: a win is an `accentSoft` background with `accent` text and the `champion` icon; a nomination reuses the genre chip's border style.
  - **Web:** the same, in `BookScreen.tsx`. The caption is `text-xs text-(--color-text-dim)` under the author; the pills reuse the genre `li` classes, with a win using `bg-(--color-accent-soft) text-(--color-accent)` and the trophy `ArenaIcon` from `components/NavIcons.tsx` at `size={12}`.
  - **`DESIGN.md`:** one component line for the award pill.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 9: Home card on mobile

**Files:**
- Create: `mobile/src/features/awards/awardCardModel.ts`
- Test: `mobile/src/features/awards/awardCardModel.test.ts`
- Create: `mobile/src/features/awards/AwardHomeCard.tsx`
- Modify: `mobile/src/features/works/api.ts`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/README.md`

**Interfaces:**
- Consumes: `fetchRecentAwards`, `PRIZES`, `isPrizeKey` and `bookKey` from `@scripta/shared`, and `LibraryDocument`.
- Produces:
  - `awardCardModel(announcement, library: LibraryDocument | null)`. It returns `{ key: string; title: string; subtitle: string; shelfLine: string | null; coverUrl: string | null; target: { kind: "work"; id: string } | { kind: "search"; query: string } } | null`. `key` is `awardDismissed:<prize>:<year>`, and the result is null for an unknown prize.
  - `firstUndismissed(announcements, dismissed: ReadonlySet<string>)`.

- [ ] **Step 1: Write the failing tests** in `awardCardModel.test.ts`:
  - "a book prize card names the prize and year and the winner's title and author"
  - "joint winners read 'and 1 more' and target the first winner"
  - "the shelf line says read, reading or to-read for a held winner"
  - "the shelf line counts held nominees when the winner isn't held, with singular and plural"
  - "an author prize card names the honoree, counts their held books and targets Search"
  - "no library gives no shelf line"
  - "a book whose work isn't resolved isn't counted"
  - "an unknown prize gives null"
  - "firstUndismissed skips dismissed keys and unknown prizes"

  Copy, exactly:
  - "You've read it", "You're reading it", "On your to-read shelf";
  - "1 nominee in your library" / "N nominees in your library";
  - "1 of their books in your library" / "N of their books in your library";
  - subtitle `Title · Author`, plus ` and N more` for joint winners.
- [ ] **Step 2:** `npm test --workspace mobile` fails.
- [ ] **Step 3: Implement.**
  - Add `fetchRecentAwards` to the destructuring in `mobile/src/features/works/api.ts`.
  - **`AwardHomeCard`** mirrors `RecapHomeCard`:
    - `useQuery({ queryKey: ["recentAwards"], queryFn: fetchRecentAwards, retry: false })`;
    - it reads the dismissal keys with `AsyncStorage.multiGet`, logging a read failure as the recap card does;
    - it renders nothing until both have loaded;
    - a 40×60 `BookCover` shows when `coverUrl` is set;
    - the body `Pressable` opens `/work/<id>` or `router.navigate(seriesSearchHref(query, Date.now(), "navigate"))`;
    - dismissing writes the key, and the next announcement shows;
    - the card takes the library from `useLibrary()`.
  - Mount it after `<RecapHomeCard />` in `HomeScreen.tsx`.
  - In `mobile/README.md`, add the card to the Home description.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.
- [ ] **Step 6: Device pass** (gates merge, not the PR).
  - Insert into the dev books DB (the data dir from `node scripts/dev-status.mjs --json`): a current-year `booker` win on a work in the fixture library, a `booker` nomination on another fixture work, and a `nobel-literature` win with an honoree. Use `created_at` = now.
  - Dispatch `device-checker` for Home (the card, its dismiss revealing the next, and the tap opening the work) and for that work's page (pills and the author line).
  - Skip it if `node scripts/dev-status.mjs --json` shows another worktree holds the emulator, and say so in the PR.

### Task 10: Docs

**Files:**
- Modify: `backend/README.md`
- Modify: `docs/services.md`

- [ ] **Step 1: `backend/README.md`** gets a "Book awards" section after "Series and collection fills". It covers:
  - `fill-awards.mjs` and its report fields;
  - dry run first, then review of the `prizes` list (labels and zero-work prizes) with the user before the real run;
  - re-running it after large imports, since works added later get older prizes only from the script;
  - the daily `awards refresh` job (current and previous year), which writes from its first run after deploy;
  - deleting a wrong row by hand: `DELETE FROM work_awards WHERE work_id = ? AND prize = ? AND year = ?`;
  - the `railway ssh` commands, modelled on the series ones (`setsid`, report to `/data/fill-awards*.json`), with production deploys held while it runs.
- [ ] **Step 2: `docs/services.md`:** add a Wikidata row under Production (SPARQL, keyless, free, rate-limited, a daily refresh plus manual fills, `books/adapters/wikidata/sparql.ts`).
- [ ] **Step 3:** `node scripts/gate.mjs`, then commit.

## After merge

These steps go through `deploy-ops`, once the branch is deployed:
1. The daily job writes the current and previous year about 165 s after boot. Task 1's label check is what gates those writes.
2. Run `fill-awards.mjs --dry-run` on Railway, as `backend/README.md` describes.
3. Bring the report's `prizes` list, `noYear` and `failedKeys` to the user. Any wrong label, or a prize with no works, is decided then: fix its item ID in a follow-up, or drop it.
4. With the user's go-ahead, run the real backfill. Hold production deploys while it runs.
