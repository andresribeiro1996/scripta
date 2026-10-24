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
- Labels and `honours` come from the spec's Prizes table.
- `nobel-literature` and `camoes` honour an author.

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
- New backend `*.test.ts` files go into `backend/package.json`'s explicit `test` list.
- Rebuild shared (`npm run build --workspace @scripta/shared`) before any consumer's checks. Run `node scripts/gate.mjs` before every commit.

## Review Focus

- **The series fill is unchanged** after Task 2's extraction: same SPARQL, same stdout report keys, same stderr progress lines, and `seriesFill.test.ts` assertions unchanged apart from moved cases.
- **A win beats a nomination** whatever order the rows arrive in, across runs too: a later nomination never downgrades a stored win (Task 4).
- **Merged works roll up:** awards on an alias work show on its canonical work's page, and duplicates collapse (Task 4).
- **The daily job uses the server's existing `openLibraryThrottle`**, never a new throttle (Task 6).
- **`/awards/recent` returns only the current UTC year**, within `ANNOUNCE_DAYS` of the first stored win for that prize and year (Task 4, Task 7).
- **Unknown prize keys** are dropped by `bookScreenModel` and by `awardCardModel` (Task 3, Task 8, Task 9).

---

### Task 1: Check the prizes on Wikidata

Needs `query.wikidata.org` and `www.wikidata.org`. They are blocked in the cloud environment that wrote this plan, so run this from the user's machine, or from a cloud environment with both domains allowed. It touches no code. The SPARQL queries below are what to run; paste each into `https://query.wikidata.org/` or `curl -G --data-urlencode query@file.rq -H 'Accept: text/csv'`.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-book-awards-design.md`

- [ ] **Step 1: Labels of the known items.** These must read Booker Prize, International Booker Prize, Hugo Award for Best Novel, Nebula Award for Best Novel, Pulitzer Prize for Fiction, and Nobel Prize in Literature:
  ```sparql
  SELECT ?item ?label WHERE {
    VALUES ?item { wd:Q160082 wd:Q2052291 wd:Q255032 wd:Q266012 wd:Q833633 wd:Q37922 }
    ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  }
  ```
- [ ] **Step 2: Find the four unknown items** with `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=pt&search=<name>` for "Prémio Camões", "Prémio LeYa", "Prémio José Saramago" and "Grande Prémio de Romance e Novela". Confirm each pick by its description.
- [ ] **Step 3: Measure each shape.** Use all ten items in `VALUES`:
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
  If it times out, run one `UNION` branch at a time. Then run one more query: for each prize, how many works shape (b) and shape (c) name that shape (a) doesn't already have. Use `FILTER NOT EXISTS { ?b p:P166|p:P1411 [ ps:P166|ps:P1411 ?prize ] }`.
- [ ] **Step 4: Update the spec.**
  - Fill the Prizes table's item IDs.
  - Replace the first two bullets of "Unverified at spec time" with what was measured, dated.
  - State the shapes the fill queries: (a), plus (b) and/or (c) for each that adds at least one work. For author prizes, the person shape is `onPerson`.
  - If an author-prize count or a Portuguese prize count is near zero, write that down for the user's keep-or-drop call, raised at the post-merge dry-run review.
- [ ] **Step 5:** Commit the spec. Task 5's queries implement exactly the shapes recorded here.

### Task 2: Share the Wikidata client and matching with the series fill

**Files:**
- Create: `backend/src/modules/books/adapters/wikidata/sparql.ts`
- Test: `backend/src/modules/books/adapters/wikidata/sparql.test.ts`
- Create: `backend/src/modules/books/seed/wikidataMatch.ts`
- Test: `backend/src/modules/books/seed/wikidataMatch.test.ts`
- Modify: `backend/src/modules/books/seed/seriesFill.ts`
- Modify: `backend/src/modules/books/seed/seriesFill.test.ts`
- Modify: `backend/scripts/fill-series.mjs`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `sparql.ts` exports `type Binding`, `listOf(binding, name)`, `queryWikidata(query, { log, sleep?, signal? })` and `queryAllPages(page: (offset: number) => string, { log, sleep?, signal?, onPage? })`. The last pages 3000 rows at a time until a short page, with a 5 s gap between pages.
- Produces: `wikidataMatch.ts` exports `inBatches(repo, items, write)`, `followRedirects(repo, fetchWork, olWorkKey)`, and `matchWorkIds(repo, fetchWork, rows: Array<{ isbns: string[]; olWorkIds: string[] }>)`. The last returns `{ workIds: Array<Set<string>>; redirected: number; failedKeys: string[] }`, with `workIds[i]` belonging to `rows[i]`.

- [ ] **Step 1: Write the failing tests.**
  - `sparql.test.ts`, with an injected `fetch` via `globalThis.fetch` stubbing and a no-op `sleep`:
    - "queryWikidata posts the query with the shared User-Agent and returns the bindings"
    - "queryWikidata retries a 429, a 5xx, a timeout and invalid JSON up to three attempts, then throws naming the last cause"
    - "queryWikidata throws at once on a 4xx other than 429"
    - "queryAllPages stops on a short page and waits between pages"
    - "queryWikidata stops when the signal aborts"
  - Move the redirect and matching cases out of `seriesFill.test.ts` into `wikidataMatch.test.ts`, driving them through `matchWorkIds`. Keep them asserting the same outcomes: ISBN match, Open Library match, a redirect followed through two hops, a 404 and a non-redirect matching nothing, a non-429 failure going to `failedKeys`, a 429 rethrown, and each key fetched once.
- [ ] **Step 2:** `npm test --workspace backend` fails on the missing modules.
- [ ] **Step 3: Implement.**
  - Move `queryWikidata`, its constants, `isRetryable` and `reasonOf` from `fill-series.mjs` into `sparql.ts`, unchanged except for the injectable `sleep` and `signal`.
  - Move `inBatches`, `followRedirects`, `redirectTarget`, `listOf` and the matching block of `fillFromWikidata` into `wikidataMatch.ts`.
  - `fillFromWikidata` filters `kept` rows as today, then calls `matchWorkIds` on them.
  - `fill-series.mjs` imports `queryWikidata` and `queryAllPages` from `../dist/modules/books/adapters/wikidata/sparql.js`. It keeps its `log` lines, `{ kind, offset, bindings, rows }` through `onPage`, and its report.
  - Add both test files to `backend/package.json`.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass, with `seriesFill.test.ts`'s remaining cases unchanged.
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
- Produces: the Global Constraints types, and `fetchRecentAwards(): Promise<RecentAwards>` on `createWorksApi` (GET `/awards/recent`, `auth: "optional"`).

- [ ] **Step 1: Write the failing tests.**
  - `awards.test.ts`: "PRIZES lists the ten prizes in order with their labels", "only the Nobel and the Camões honour an author", "awardLabel names a win and a nomination", "knownAwards drops unknown keys and sorts wins first, newest first", "knownAwards of undefined is empty".
  - `api.test.ts`: "fetchRecentAwards requests /awards/recent with optional auth", in the file's existing style.
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
  - `addWorkAward(row: { workId: string; prize: string; year: number; won: boolean; honoree: string | null }, at: string): boolean`. True when it inserts a row or upgrades one from nominated to won.
  - `awardsOf(workIds: string[]): Map<string, WorkAward[]>`, keyed by each given id, with aliases rolled up as `bestSeriesOf` does. Duplicate prize and year pairs collapse, and won wins.
  - `recentAwards(year: number, since: string): Array<{ prize: string; year: number; announcedAt: string; winnerWorkIds: string[]; nomineeWorkIds: string[]; honoree: string | null }>`. Work ids are canonical (`COALESCE(merged_into, id)`) and deduplicated. Ordered by `announcedAt` descending.

- [ ] **Step 1: Write the failing tests** in `sqliteBooksRepository.test.ts`:
  - "addWorkAward inserts once and reports nothing new on a repeat"
  - "addWorkAward upgrades a nomination to a win, and a later nomination never downgrades it"
  - "addWorkAward fills a missing honoree and keeps created_at"
  - "awardsOf rolls an alias work's awards up to its canonical work and collapses duplicates"
  - "recentAwards keeps prizes of the given year whose first win is on or after since"
  - "recentAwards ignores prize years with nominations only, and lists nominees beside winners"
  - "recentAwards reports canonical work ids"
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - The table and index go into `books.sql` exactly as in the spec.
  - Upsert: `INSERT … ON CONFLICT(work_id, prize, year) DO UPDATE SET won = MAX(won, excluded.won), honoree = COALESCE(honoree, excluded.honoree) WHERE won < excluded.won OR (honoree IS NULL AND excluded.honoree IS NOT NULL)`. Return `changes > 0`.
  - `awardsOf` reuses `aliasesOf` and `canonicalWorkIds`.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 5: The awards fill and the backfill script

**Files:**
- Create: `backend/src/modules/books/domain/awards.ts`
- Create: `backend/src/modules/books/seed/awardsFill.ts`
- Test: `backend/src/modules/books/seed/awardsFill.test.ts`
- Create: `backend/scripts/fill-awards.mjs`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `queryAllPages` and `listOf` (Task 2), `matchWorkIds` and `inBatches` (Task 2), `addWorkAward` (Task 4), `PrizeKey`, `PRIZES` and `isPrizeKey` (Task 3).
- Produces: `domain/awards.ts` exports `PRIZE_ITEMS: Record<PrizeKey, string>` (Wikidata item IDs from Task 1).
- Produces: `awardsFill.ts` exports:
  - `awardQueries(minYear?: number): Array<{ kind: string; page: (offset: number) => string }>`, one per identifier kind and shape;
  - `awardRowOf(binding): AwardRow | null`;
  - `fillAwards(repo, fetchWork, rows, at, { dryRun }): Promise<{ matched; added; redirected; failedKeys; prizes; noYear }>`;
  - `refreshAwards({ repo, query, fetchWork, now, info }, signal)`, used by Task 6.

- [ ] **Step 1: Write the failing tests** in `awardsFill.test.ts`, with an in-memory repository as `seriesFill.test.ts` builds one:
  - "awardRowOf reads P166 as won and P1411 as nominated"
  - "awardRowOf drops a statement with no year or an unlisted item"
  - "awardRowOf takes the honoree's English label, else Portuguese, else any"
  - "awardQueries filters on minYear only when given"
  - "awardQueries covers each identifier kind for every shape Task 1 recorded"
  - "fillAwards writes an author prize on every matched work of its honoree"
  - "fillAwards counts dropped no-year statements per prize"
  - "a dry run makes the same lookups and writes nothing"
  - "fillAwards reports per prize rows, works, won and nominated"
  - "refreshAwards queries from last year and logs one summary line"
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - The queries follow the spec's Wikidata queries section and Task 1's recorded shapes, with `?when` from `pq:P585`.
  - Each page query selects `?prize`, `?won`, `?year`, the grouped identifiers, and the honoree labels for author prizes.
  - `awardRowOf` maps `?prize` back to a key through `PRIZE_ITEMS`. A missing year makes it return null; the fill counts these as `noYear` from the raw bindings before mapping.
  - `fill-awards.mjs` follows `fill-series.mjs`:
    - `parseArgs` takes `--dry-run`;
    - it needs `COVERS_DB_PATH`;
    - the dry run opens the DB read-only, and a real run uses `openBooksDb` behind `waitForBnpLock`;
    - it moves `createWorkFetcher` across as is: a 1 s gap, 429 retry, and progress every 100;
    - every Wikidata query runs before any Open Library request;
    - a JSON report on stdout: `prizes` (each with `item` and the item's English `label`, fetched by one labels query), `noYear`, `pages`, `rows`, `matched`, `added`, `redirected` and `failedKeys`.
  - Add the test file to `backend/package.json`.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run build --workspace backend`. All pass. `node backend/scripts/fill-awards.mjs --bogus` prints its usage and exits 1.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 6: Daily refresh job

**Files:**
- Modify: `backend/src/modules/books/plugin.ts`
- Test: `backend/src/booksWiring.test.ts`

**Interfaces:**
- Consumes: `refreshAwards` (Task 5), `queryWikidata` (Task 2), the plugin's existing `openLibraryThrottle` and `fetchJson`.

- [ ] **Step 1: Write the failing test** in `booksWiring.test.ts`: the first-run delays table gains `awardsRefresh: 165_000` and is armed once.
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - Add `awardsRefresh: 165_000` to `FIRST_RUN_DELAY_MS`.
  - Register `jobs.every("awards refresh", 24 * 60 * 60 * 1000, (signal) => refreshAwards({ repo, query: (q) => queryWikidata(q, { log: (line) => app.log.warn(line), signal }), fetchWork: (key) => openLibraryThrottle(() => fetchJson("openlibrary", \`https://openlibrary.org/works/${key}.json\`)), now: Date.now, info: (details, message) => app.log.info(details, message) }, signal), FIRST_RUN_DELAY_MS.awardsRefresh)`.
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
- Consumes: `awardsOf` and `recentAwards` (Task 4), and the types (Task 3).
- Produces:
  - `CatalogWorkPage.awards: WorkAward[]`;
  - `getRecentAwardsWith(books, coverUrl, now): AwardAnnouncement[]` and `getRecentAwards()` in `books/works.ts`, exported from `books/index.ts`;
  - `WorksDeps.getRecentAwards`;
  - `WorksService.recentAwards(): RecentAwards`;
  - `GET /awards/recent`.

- [ ] **Step 1: Write the failing tests.**
  - `works.test.ts`:
    - "getWorkPageWith includes the work's awards"
    - "getRecentAwardsWith builds book-prize winners with title, author and the first edition cover"
    - "getRecentAwardsWith gives an author prize its honoree and work ids and no winners"
    - "getRecentAwardsWith asks for the current UTC year and ANNOUNCE_DAYS back"
  - `service.test.ts`: "getPage passes awards through".
  - `routes.test.ts`: "GET /awards/recent returns the announcements with no-store and needs no sign-in".
- [ ] **Step 2:** `npm test --workspace backend` fails.
- [ ] **Step 3: Implement.**
  - `getRecentAwardsWith` reads `recentAwards(year, since)`.
  - For each book-prize winner, it builds a winner from `workPageRows`: the title and author of the work, and the first edition with a cover. A winner whose work is gone is skipped.
  - `honoree` is `{ name, workIds: winnerWorkIds }` for an author prize. A row with a null honoree name falls back to the first winner work's author.
  - `getPage` sets `awards: work.awards`.
  - The route goes in `buildWorkRoutes`, beside `/works/:id`, with `Cache-Control: no-store`.
  - Wire `getRecentAwards` in `app.ts`'s `registerWorksModule` call.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 8: Award pills on the work page

**Files:**
- Modify: `packages/shared/src/works/bookScreen.ts`
- Test: `packages/shared/src/works/bookScreen.test.ts`
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: `knownAwards`, `awardLabel` and `PRIZES` (Task 3).
- Produces: `BookScreenModel.awards: Array<{ label: string; won: boolean }>`, holding book prizes only, and `BookScreenModel.authorAwards: string | null`. The latter is the author prizes' "Label Year" parts joined with " · ", or null.

- [ ] **Step 1: Write the failing tests** in `bookScreen.test.ts`:
  - "awards lists book prizes as labelled pills, wins first"
  - "authorAwards joins author prizes and leaves them out of awards"
  - "unknown prizes are dropped"
  - "a page without awards has none"
- [ ] **Step 2:** `npm test --workspace @scripta/shared` fails.
- [ ] **Step 3: Implement.**
  - **Mobile:** the `authorAwards` caption goes under the author `Text`, in `typography.caption` and `textDim`, centred. A pills row goes above the genre chips: a win is an `accentSoft` background with `accent` text and the `trophy` icon; a nomination reuses the genre chip's border style.
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
  - the daily `awards refresh` job (current and previous year);
  - deleting a wrong row by hand: `DELETE FROM work_awards WHERE work_id = ? AND prize = ? AND year = ?`;
  - the `railway ssh` commands, modelled on the series ones (`setsid`, report to `/data/fill-awards*.json`).
- [ ] **Step 2: `docs/services.md`:** add a Wikidata row under Production (SPARQL, keyless, free, rate-limited, a daily refresh plus manual fills, `books/adapters/wikidata/sparql.ts`).
- [ ] **Step 3:** `node scripts/gate.mjs`, then commit.

## After merge

These steps go through `deploy-ops`, once the branch is deployed:
1. Run `fill-awards.mjs --dry-run` on Railway, as `backend/README.md` describes.
2. Bring the report's `prizes` list, `noYear` and `failedKeys` to the user. Any wrong label, or a prize with no works, is decided then: fix its item ID in a follow-up, or drop it.
3. With the user's go-ahead, run the real backfill.
