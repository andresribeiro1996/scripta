# Re-titling lossy catalog text — design

Follows the catalog mojibake repair (PR #266, plan `docs/superpowers/plans/2026-10-15-catalog-mojibake.md`), which repairs text that round-trips and leaves the rest under `stillBroken`.

## Goal

Some Open Library records, imported from Better World Books, lost every accented letter to `©`: `N©o Abras Este Livro Outra Vez` for *Não Abras Este Livro Outra Vez* (ISBN 9789898895240, source record `bwb:9789898895240`). The letter can't be recovered from the string. This re-titles those books from a source tied to the same book, and only when that source spells the same text with a real letter at each `©`.

Production on 2026-10-15 (read-only count, repaired text, same test as `stillBroken`):
- 77,927 books. 25 have a title or author matching `\p{L}©\p{L}`: 21 titles, 9 authors.
- All 25 have an ISBN, all Portugal ISBNs.
- 13 were created by the publisher importer and have a `publisher_url`: Orfeu Negro 4, Penguin Livros 4, Presença 3, Saída de Emergência 2. The importer took Open Library's edition title and author for them, because those shops' feeds list no author. The feed product at that URL has the publisher's own title.
- 12 are seed rows with an ISBN and no `publisher_url`.
- 25 works are lossy, and each holds exactly the text of one lossy edition.
- 1 more book has a `�` and no `©`.

Public shop listings checked on 2026-10-15:
- Exact match apart from `©`: Presença *Não Abras Este Livro Outra Vez*, Orfeu Negro *Mamã Raposa*, Penguin *Espaço para Sonhar*.
- Capitalization only: Presença *Respostas Simples às Perguntas Difíceis dos Nossos Filhos*; the catalog holds `Respostas Simples ©s Perguntas Dif©ceis DOS Nossos Filhos`. Open Library's BWB titles often capitalize `Do`, `Da`, `Na`, `DOS`, and the shops don't.
- No match: Penguin lists two of the books under a series prefix (`Maria Lua 1: A Escola Vai Começar!`).

## Non-goals

- **Rows whose only `©` sits at a word edge** (`Mam© Raposa` with a clean author). `hasMojibake` doesn't flag them either. A selected row's edge `©` is fixed, though (below).
- **The `�` row.** One book; not worth a rule.
- **Two characters for one letter** (`Tri©Øngulo` for *Triângulo*) and source typos (`B©rbara Ramso Dias`). They stay and are listed.
- **New lossy rows at intake.** Lookups and search can still bring them in. The script can be re-run.
- **Other sources.** Open Library is where the damage came from. Other catalog rows that share an author's name aren't tied to this book.
- **A saved plan replayed by the real run.** At most 25 ISBNdb calls a run don't justify a file format and a second entry point.

## Decisions

1. **Only sources tied to this book:** the shop product at the book's `publisher_url`, and the ISBNdb record for its ISBN.
2. **Only `©` positions change letters.** Every other character must match, ignoring case, and the source's text is written, capitals included. The owner chose case-insensitive over strict on 2026-10-15.
3. **Live lookups on both runs.** The dry run asks the same sources the real run will.
4. **Writes go through `applyMojibakeRepairs`**, so the derived data is updated exactly as the repair updates it.
5. **No `data_sources` tag.** The README's ISBNdb takedown keeps title and author as bibliographic facts. A tag would make it clear these books' synopses and genres.

## Targets

- A book is a target when its stored title or author matches `/\p{L}©\p{L}/u`, the lossy half of `hasMojibake`. Stored text, not repaired text: run it after the repair's real run (Rollout).
- In a target, every field and every author name that contains a `©` is a candidate for change, edge `©` included. A field or name without `©` is never changed.
- A target with neither a valid ISBN (`canonicalIsbn`) nor a `publisher_url` is reported and left. Today there are none.

## Sources

Asked in this order, per target.

### Shop feed (rows with a `publisher_url`)

- `readSiteFeed` from the publisher importer: robots.txt, its 3 s politeness and its skip rules, as `--fill-titles` uses it.
- Only the shops that hold targets are read: a `PUBLISHERS` site whose host, ignoring a leading `www.`, is the host of a target's `publisher_url`. Today that is 4 shops, about 5 minutes, most of it Penguin's feed.
- A target matches a product whose `productUrl` equals its `publisher_url` exactly, as `--fill-titles` matches.
- The product gives a title candidate, and its `author`, when the feed has one, gives author name candidates (split on `, `). None of today's 4 shops lists authors.

### ISBNdb (rows with a field still lossy)

- Asked only when the target still has a `©` in a field or name after the feed step, and only with a valid ISBN.
- `createIsbndbCatalog(key, throttle, gate, false).search({ isbn })`: the existing `GET /book/{isbn}` path, which returns the record's title and its `authors` array.
- The script builds its own gate (`createIsbndbGate`, pauses logged to stderr) and throttle at the server's 1.1 s gap. They don't see the server's, so a run adds about one request a second to the server's ISBNdb traffic for half a minute.
- A required `--max <n>` caps the requests a run makes, as `genre-backlog --max` does. `--max 0` asks the feeds only. Targets past the cap are reported as not asked.
- `ISBNDB_API_KEY` must be set; the script exits with a usage error otherwise.
- ISBNdb's `authors` format is unverified (the fixtures are hand-written "First Last"). The report shows every candidate a target was compared against, so the dry run shows it.

## The match rule

`fillLossy(stored, candidate)` returns the text to write, or nothing:

1. `stored` is NFC and trimmed. `candidate` goes through `repairMojibake`, then NFC, then trim.
2. Both have the same number of code points.
3. At each position where `stored` has `©`, `candidate` has a letter (`\p{L}`) that isn't ASCII. An accent-stripped `Nao` never replaces `N©o`.
4. At every other position the characters are equal ignoring case.
5. A candidate with no lowercase letter is refused when `stored` has one, so an all-caps record can't replace a mixed-case title.
6. The result is `candidate` (after step 1).

This is the regex rule (`©` → one letter, everything else literal, anchored) done position by position, with no escaping.

- **Title:** the first candidate that `fillLossy` accepts: the feed's title, then ISBNdb's.
- **Author:** the stored author is split on `, `. Each name that contains `©` takes the first candidate name `fillLossy` accepts: the feed's names, then ISBNdb's `authors`. The names are joined back with `, `. Names without `©`, and names no candidate fixes, are kept as stored.
- A target is planned when its title or author changed. A target that still has a `©` after both sources is listed as still lossy.

## Writes

- After every lookup, the planned rows go to `applyMojibakeRepairs` as `{ id, title, author, repairedTitle, repairedAuthor, origin }`, with `origin` the source that supplied the change (`publisher`, `isbndb`, or `publisher+isbndb`). From the merged repair, unchanged:
  - one transaction per book;
  - `title`, `author` and `title_key` (`workTitleKey`) updated only where the stored title and author still equal the scanned ones; a book edited since the scan is skipped and counted;
  - the corrected `ta:` key added only when the book holds the old one, which stays;
  - the search index updated by rowid, with the rowids read in one query before any write.
- `applyMojibakeRepairs` takes only the `books` and `works` it applies (a type change; the repair's own call is unchanged).
- A planned book's work (`books.work_id`) is planned too when the work's stored title and author equal the book's old ones. A work planned twice is planned once.
- Editions that now share a title key join one work at the next works grouping (boot, daily, or `POST /books/works/group`).
- The dry run opens the database read-only (`new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true })`), as the repair's does.

## Report

One JSON document on stdout; progress lines on stderr.

- `dryRun`, `targets`.
- `feeds`: per shop read, `{ products, matched }` or `{ skipped: reason }`.
- `isbndb`: `{ max, asked, unavailable, notAsked, pausedUntil }`.
- `retitles`: every planned change, `{ id, isbn, from, to, source }`, with `from` and `to` as `title — author`. The real run's output keeps the original text, so save it.
- `stillLossy`: every target left with a `©`, `{ id, isbn, text, isbndb, candidates: { titles, authors } }`. `isbndb` is `answered`, `no record`, `unavailable` or `not asked` (no valid ISBN, past `--max`, or paused).
- `applied`: `{ books, works, skipped }`, or `null` on the dry run.

## Error handling

- **ISBNdb paused** (`SourcePausedError`: daily quota or key): no more ISBNdb requests this run; `pausedUntil` is reported and the remaining targets count as not asked.
- **Other ISBNdb failures** (`SourceUnavailableError`: a per-second 429, 5xx, timeout, bad JSON): that target counts as unavailable and the run goes on. A 404 is no record.
- **A shop that can't be read** (`SiteSkipped` or `SourceUnavailableError` from `readSiteFeed`): reported as skipped; its targets go on to ISBNdb.
- **Anything else propagates.** Every lookup runs before the first write, so a failure while looking up writes nothing. A failure while writing leaves earlier books committed.
- **Reruns are safe:** a fixed book no longer matches, so a second run asks only about what is left.

## Code

- `backend/src/modules/books/seed/lossyRetitle.ts`: `fillLossy`, the target scan, the lookups, the plan and the report. SQL stays in the seed module, as in `mojibakeRepair.ts`.
- `backend/scripts/retitle-lossy.mjs`: `--dry-run`, required `--max <n>`. Builds the ISBNdb catalog and the feed fetcher from `dist`.
- The importer script's `guarded`, `fetchText` and `fetchBytes` move from `scripts/import-publisher-covers.mjs` into `backend/src/modules/books/seed/siteFetch.ts`, so both scripts share them.
- `mojibakeRepair.ts`: the `applyMojibakeRepairs` parameter type.
- `backend/package.json`: the new test file in the `test` list.
- `backend/README.md`: a "Lossy titles" subsection after "Mojibake repair", with the commands.

## Testing

Synthetic strings only, never titles from the catalog.

- **`fillLossy`:**
  - a `©` takes a non-ASCII letter; an ASCII letter is refused;
  - a different length is refused (two characters for one letter);
  - other characters equal ignoring case are accepted; a different letter is refused;
  - an all-caps candidate is refused against a mixed-case stored text, and accepted against an all-caps one;
  - a decomposed candidate is accepted (NFC), surrounding spaces are trimmed, a mis-decoded candidate is repaired first;
  - `©` at the start and end of a word;
  - stored text without `©` is never changed.
- **Authors:** only names with `©` change; names in a different order and a missing name; the feed's names split on `, `.
- **Plan** (in-memory database through `applyBooksMigrations`, stubbed `fetchText` as in `fillBlankTitles.test.ts`, a fake ISBNdb catalog):
  - a feed title fixes a publisher target and ISBNdb isn't asked when nothing is left;
  - ISBNdb is asked for a lossy author the feed couldn't fix;
  - only shops holding targets are read, ignoring `www.`; matching is by exact URL;
  - a skipped shop's targets go to ISBNdb;
  - `--max` stops at exactly N requests and reports the rest as not asked;
  - a pause stops further requests and reports `pausedUntil`;
  - an unavailable target is counted and the run goes on;
  - each still-lossy target's `isbndb` status;
  - an unexpected error propagates and nothing is written;
  - a work is planned only when it holds its edition's old text.
- **Apply:** title, author, `title_key`, the new `ta:` key (only when the old one is held), the search row and the work are updated; a book edited since the scan is skipped; the dry-run path leaves every table unchanged.
- **Moved fetch helpers:** a 429 or 5xx and a network error become `SourceUnavailableError`; a 404 is returned to the caller.

## Rollout

The owner runs every production command; Claude reads the pasted reports.

1. Merge. The owner deploys `main`, which also brings the mojibake repair.
2. The repair, as its README section says: `repair-mojibake.mjs --dry-run`, then the real run, output saved.
3. `retitle-lossy.mjs --dry-run --max 30`. The owner pastes the report; every `retitles` entry and the `stillLossy` list are reviewed before the real run.
4. `retitle-lossy.mjs --max 30`, output saved.
5. Hold deploys during steps 2–4, since a deploy kills `railway ssh` jobs. Each re-title run takes about 5 minutes.
6. **Check:** rerun the 2026-10-15 count. The 25 lossy books should drop to the real run's `stillLossy`.
