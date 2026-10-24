# Book awards — design

## Why

Home shows what the people you follow did. When the circle is quiet, or empty for a new reader, there is little to open it for. Literary prizes are short, recurring moments that any reader recognises, and the catalog can tie them to the reader's own library: "Booker Prize 2026: on your to-read shelf". That intersection is the part a prize website can't offer.

## Decisions

**From the user (2026-10-24):**
- Prizes: Booker, International Booker, Hugo, Nebula, Pulitzer Prize for Fiction, Nobel Prize in Literature, and the Portuguese prizes (Prémio LeYa, Prémio José Saramago, the APE novel prize, Prémio Camões).
- Scope: award badges on the work page, and a Home card for recent wins.
- Wikidata is the only source. No hand-kept shortlist file and no scraping of prize websites.

**Builder's calls (Claude's, each open to the user's override):**
1. **Book prizes and author prizes.** The Nobel and the Camões honour an author, not a book. They reach a work through Wikidata's author property (P50) on works that match the catalog by ISBN or Open Library ID, the same way series do. They are never matched by name. They are shown under the author's name, not as a book badge, so a reader doesn't read "Nobel Prize 1998" as the book's own prize.
2. **Won and nominated.** "Award received" (P166) means won. "Nominated for" (P1411) means nominated. Wikidata doesn't reliably tell a longlist from a shortlist, so the app says "nominee" and claims nothing more. For a given work, prize and year, a win beats a nomination.
3. **The year is the statement's "point in time" (P585), as Wikidata records it.** A statement without one is dropped and counted in the report. A badge with no year can't be placed in a season, and the report shows how much that loses.
4. **Hugo and Nebula: Best Novel only.** Novellas are books too. Adding Best Novella is one more entry in the prize list, if the user wants it.
5. **Exact prize items only.** A statement counts only when its value is one of the listed Wikidata items. Subclasses are not followed. The generic "Hugo Award" item is not "Hugo Award for Best Novel", for example.
6. **Add-only, like the series fill.** Rows are added or upgraded from nominated to won, and never deleted by a fill. A wrong row is deleted by hand (README).
7. **The history comes from a script; the server refreshes recent years every day.** This follows the BNP harvest: the full history never runs inside the server.
   - `scripts/fill-awards.mjs` backfills every year once, with `--dry-run` first.
   - A daily server job re-reads the current and previous year, so a new winner reaches Home within a day of appearing on Wikidata. The previous year catches late Wikidata edits, and prizes whose year label and ceremony fall in different years.
   - There is no `--skip` review. The series fill needed one because Wikidata series names include publisher collections. Here the prize list is a fixed allow-list, and matching is by exact identifier.
8. **The Home card is mobile-only.** The web Home has no card slot today (`RecapHomeCard` is mobile-only too). The web work page does get the badges, since it renders the same `BookScreenModel` as mobile.
9. **The card covers wins only.** Nominations reach Wikidata late or not at all, so a "shortlist announced" card would usually be weeks stale. Nominees still count toward the card's "N nominees in your library" line.

## Prizes

The labels live in `@scripta/shared`, because web and mobile both render them. The Wikidata items live in the backend.

| Key | Label | Honours | Wikidata item |
|---|---|---|---|
| `booker` | Booker Prize | work | Q160082 |
| `international-booker` | International Booker Prize | work | Q2052291 |
| `hugo-novel` | Hugo Award | work | Q255032 (Best Novel) |
| `nebula-novel` | Nebula Award | work | Q266012 (Best Novel) |
| `pulitzer-fiction` | Pulitzer Prize for Fiction | work | Q833633 |
| `nobel-literature` | Nobel Prize in Literature | author | Q37922 |
| `camoes` | Prémio Camões | author | ? |
| `leya` | Prémio LeYa | work | ? |
| `saramago` | Prémio José Saramago | work | ? |
| `ape-novel` | Grande Prémio de Romance e Novela APE | work | ? |

**None of these item IDs was checked against Wikidata**, because `query.wikidata.org` couldn't be reached from the session that wrote this spec. The IDs shown are from memory. The `?` IDs are resolved in the plan's first task. The dry run prints each item's English label next to its key, so a wrong ID shows up before anything is written.

Before 2016 the International Booker was an author prize. Those statements sit on people, not works, so the work-level query skips them, which is correct.

## Data

### Wikidata queries

The fill uses the same three identifier kinds as the series fill (`fill-series.mjs:25-29`): works with an Open Library work ID (P648), works with an ISBN that aren't edition items, and works whose edition items (P629) carry an ISBN. It runs them for two statement shapes:

- **Book prizes:** `?work` has a P166 or P1411 statement whose value is a listed book prize, with a P585 qualifier.
- **Author prizes:** a `?person` has a P166 statement whose value is a listed author prize, with P585, and `?work wdt:P50 ?person`. The row also carries the person's English label, else their Portuguese one, else any label, as `honoree`.

That is six queries, plus three for each extra shape the Wikidata check finds (see Unverified at spec time). They are paged 3000 rows at a time, as the series queries are. Each row is `{ isbns, olWorkIds, prize, year, won, honoree }`. The query builder takes an optional `minYear`, filtering on `YEAR(?when) >= minYear`. The script passes none; the daily job passes the current UTC year minus 1.

### Reuse from the series fill

Nothing here should be written twice:

- **The query client.** `queryWikidata` (its retry, timeout and User-Agent) and the page loop move from `fill-series.mjs` into `backend/src/modules/books/adapters/wikidata/sparql.ts`, with timers and an abort signal that can be injected. `fill-series.mjs` imports it from `dist`, with no change in behaviour.
- **The matching.** `inBatches`, `followRedirects`, `listOf` and the ISBN/Open Library matching block inside `fillFromWikidata` (`seriesFill.ts:99-163`) move to `backend/src/modules/books/seed/wikidataMatch.ts`. The block becomes `matchWorkIds(repo, fetchWork, rows)`, which returns each row's work ids plus `{ redirected, failedKeys }`. `fillFromWikidata` calls it; its report and its tests don't change. Tests of the moved code move with it.

### Storage

A new table in the books DB (`books.sql`, `CREATE TABLE IF NOT EXISTS`, the same database as `work_series`):

```sql
CREATE TABLE IF NOT EXISTS work_awards (
  work_id    TEXT NOT NULL,
  prize      TEXT NOT NULL,
  year       INTEGER NOT NULL,
  won        INTEGER NOT NULL,
  honoree    TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, prize, year)
);
CREATE INDEX IF NOT EXISTS idx_work_awards_recent ON work_awards(year, prize);
```

- **Writes:** `addWorkAwards(rows, at)` inserts, or on conflict sets `won = MAX(won, excluded.won)` and fills `honoree` when it was NULL. It keeps `created_at`. Writes go in transactions of 300 rows with 100 ms pauses (`inBatches`).
- **Reads:** `awardsOf(workIds)` rolls merged works up to their canonical work, as `bestSeriesOf` does (`sqliteBooksRepository.ts:1295-1299`). A translation joined to its original therefore shows the original's prizes.
- **Recent reads:** `recentAwards(year, since)` returns each `(prize, year)` with at least one win, with `announcedAt` = the earliest `created_at` among its wins, when that falls on or after `since`. It also returns the winner work ids, the nominee work ids and the honoree.

## Refresh

### Backfill script

`node scripts/fill-awards.mjs [--dry-run]` reads every year, matches, and writes. It prints a JSON report on stdout and progress on stderr, as `fill-series.mjs` does. It shares that script's rules:

- the dry run opens the DB read-only and makes the same requests;
- Open Library redirect lookups run at a 1 s gap, after every Wikidata query has finished;
- a 429 is waited out up to three attempts, then ends the run; any other failure puts the ID in `failedKeys` and the run goes on;
- it waits for the database lock;
- it can be re-run safely.

The report:
- `prizes`: for each key, `{ key, item, label, rows, works, won, nominated }`. `label` is the item's English label, which is how a wrong item ID is caught.
- `noYear`: statements dropped for lacking P585, per key.
- `pages`, `rows`, `matched`, `added`, `redirected`, `failedKeys`.

The dry run's `prizes` list is reviewed with the user before the real run: a wrong label, or a prize with 0 works, is raised then.

### Daily job

`jobs.every("awards refresh", DAY_MS, …, FIRST_RUN_DELAY_MS.awardsRefresh)` in `books/plugin.ts`, with `awardsRefresh: 165_000` added to the table (the first-run delay test counts its entries).

- It runs the six queries with `minYear` = current UTC year − 1. These are small, unpaged in practice, so at most a few hundred rows.
- It follows redirects with the server's shared `openLibraryThrottle` and `fetchJson`, so it never adds load beyond the server's Open Library gap.
- It writes through the server's repository.
- It logs one info line: `{ rows, matched, added, redirected, failedKeys: <count> }`.
- A Wikidata failure, after the client's retries, or an Open Library 429 throws. `jobs.every` logs "awards refresh failed", and the next day's run tries again.
- A deploy restart runs it again after its first-run delay (`startJob` keeps no last-run time). That costs a few queries.

This makes Wikidata a runtime dependency of production for the first time. Until now it was script-only (`docs/services.md`).

## API

Both changes are additive (`backend/AGENTS.md`):

- **`GET /works/:id`** gains an optional `work.awards?: WorkAward[]`, where `WorkAward = { prize: string; year: number; won: boolean }`. Author prize rows use the same shape. The client looks up `honours` in the prize list. Wins come first, then nominations, each newest year first. Older clients ignore the field.
- **`GET /awards/recent`**, registered by the works module, needs no auth: it carries catalog facts only. It returns `{ announcements: AwardAnnouncement[] }`:
  - `AwardAnnouncement` is `{ prize, year, announcedAt, winners, nomineeWorkIds, honoree }`.
  - `winners` is `{ workId, title, author, coverUrl }[]` for a book prize (usually one; the 2019 Booker had two), and empty for an author prize.
  - `honoree` is `{ name, workIds }` for an author prize, and null for a book prize.
  - Only the current UTC year counts, with `announcedAt` within the last 14 days (`ANNOUNCE_DAYS`, one constant). Newest first, ties in prize-list order.
- **Unknown prize keys are skipped by clients**, as `isKnownDigestItem` skips unknown row kinds, so a prize added later never breaks an installed build.

Shared (`packages/shared/src/works/`):
- the `WorkAward` and `AwardAnnouncement` types;
- `PRIZES` (key → `{ label, honours }`);
- `awardLabel`;
- `BookScreenModel.awards` (book prizes) and `BookScreenModel.authorAwards` (author prizes), unknown keys dropped;
- `fetchRecentAwards`.

## Work page

Mobile `BookScreen.tsx` and web `components/book/BookScreen.tsx`, both from `BookScreenModel`:

- **Author prizes:** one caption line under the author, `text-dim`, joined with " · ". For example, "Nobel Prize in Literature 1998 · Prémio Camões 1995".
- **Book prizes:** a wrapping row of pills, above the genre chips.
  - A win is an `accent-soft` pill with `accent` text and the `trophy` icon: "Hugo Award 1993".
  - A nomination is a `border` pill with `text-dim` text: "Booker Prize 2019 · nominee".
- No cap. Ten prizes give few books more than three or four pills.
- The pills aren't tappable (see Later).

## Home card

In `HomeScreen.tsx`'s list header, after `RecapHomeCard`. It shows whether or not the reader has a library: without one it is still news, just without the shelf line.

- **The query:** `["recentAwards"]` with `fetchRecentAwards` and `retry: false`. While it loads, or if it fails, the card renders nothing, as the recap card does.
- **One card at a time:** the newest announcement not yet dismissed.
- **Dismissal:** stored per device in AsyncStorage as `awardDismissed:<prize>:<year>`, mirroring `topShelfRecapDismissed:<month>`. Dismissing reveals the next announcement, if there is one.
- **A book prize card:**
  - a 40×60 cover, the prize and year in bold ("Booker Prize 2026"), and "Title · Author";
  - a shelf line in `accent`: "You've read it", "You're reading it" or "On your to-read shelf" when the winner is in the library. Otherwise "N nominees in your library" when N > 0. Otherwise no line.
  - Tapping it opens `/work/<first winner id>`.
- **An author prize card:**
  - the prize and year in bold, and the honoree's name;
  - "N of their books in your library" when N > 0.
  - Tapping it opens Search with the honoree's name (`seriesSearchHref`, as the series line does).
- **The library intersection** is a pure function, `awardCardModel(announcement, library)`, in `mobile/src/features/awards/`. It reads `library.data.books`, `library.works[bookKey(book)]` and `book.ReadStatus` (0 to-read, 1 reading, 2 finished). A book with no resolved work isn't counted.

**Known consequence:** the first backfill stores every current-year win at once, so for 14 days Home offers this year's earlier prizes one after another. That happens once, and reads as a catch-up.

## Error handling

- **Job and script:** as described above. Errors are logged, never swallowed. A failed Open Library lookup is reported per ID, as in the series fill.
- **Home card:** a failed `/awards/recent` hides the card, following the recap precedent. The card is optional and the rest of Home is unaffected.
- **Work page:** awards arrive in the same payload as the rest of the page, so there is no new failure mode.

## Testing

- **Backend** (`npm test --workspace backend`; new files go into its explicit list):
  - row parsing: P166 → won, P1411 → nominated, a missing year dropped and counted, an unknown item ignored, the honoree label fallback;
  - the query builder's `minYear` clause;
  - `matchWorkIds` (moved tests): ISBN, Open Library ID, a redirect followed, a failed key reported;
  - a win upgrading a nomination; an author prize landing on every matched work; a dry run writing nothing;
  - `awardsOf` rolling up merged works; `recentAwards`' year and window filters and its grouping;
  - `getPage` returning sorted `awards`; the `/awards/recent` shape;
  - the first-run delay entry; the series fill tests still passing unchanged.
- **Shared:** prize labels, `awardLabel`, unknown keys dropped, `BookScreenModel.awards` and `authorAwards`.
- **Mobile:** `awardCardModel` with a winner on to-read, reading, finished and not held; held nominees; an author prize with N held; no library; an unknown prize.
- **Checks:** typecheck and lint in every touched package; `node scripts/gate.mjs`.
- **Device pass** (`device-checker`), with award rows inserted into the dev books DB: the work page's pills and author line, and the Home card with its dismiss and its tap.

## Docs

- `backend/README.md`: a "Book awards" section (the backfill script and its review, the daily job, deleting a wrong row by hand) and the `railway ssh` commands, modelled on the series fill's.
- `docs/services.md`: Wikidata as a production dependency (keyless, free, rate-limited, one daily refresh).
- `DESIGN.md`: the award pill, in the component list.
- `mobile/README.md`: the Home card.

## Unverified at spec time

`query.wikidata.org` was blocked for the session that wrote this, so these are checked in the plan's first task, by a dry run on Railway:
- the prize item IDs, and the four unknown ones;
- where a book prize is recorded. There are three possible shapes:
  - (a) P166/P1411 on the work;
  - (b) P166/P1411 on the author, with a "for work" (P1686) qualifier naming the book;
  - (c) "winner" (P1346) on the prize item, with P1686.

  The fill queries every shape that adds works beyond (a). An author prize has the matching person-level shapes;
- per-prize coverage. A prize with near-zero matched works goes back to the user: keep it (costs nothing, rarely shows) or drop it.

## Later

- **Predict the winner:** a tournament or tier list built from a shortlist before the announcement. It needs hand-kept shortlists (declined for v1) and a game no reader owns. `owner_user_id` is `NOT NULL` on both tables, and `__app__` is only reached through `promote`.
- **A prize page** listing every winner, opened by tapping a pill.
- **ISFDB** for Hugo and Nebula finalists, if Wikidata's nominations prove thin.
- **More categories:** Best Novella.
- **The card on the web Home.**
- **A Top Shelf record or feed row,** such as "Ana has read 4 of the 6 finalists".
