# National bibliography import — design

**Date:** 2026-10-18. **Source facts:** memory `bnp-national-bibliography-source`; the sampling below was done the same day.

## Why

The catalog misses most Portugal editions. A search for Isabel Allende's *A Casa dos Espíritos* found no Portugal edition. ISBNdb was paused for quota, and the Porto Editora edition (9789720044457) had never entered the catalog. Today the catalog grows only through searches (12 saved hits each), user adds, and manual seed runs of 15 publisher feeds, which leave out the big groups (Porto Editora, LeYa, Bertrand). Of 740 ISBNs sampled from the national bibliography, 139 (18.8%) were in the production catalog.

The Biblioteca Nacional de Portugal publishes the national bibliography (legal deposit) openly over OAI-PMH, updated daily, with a cover scan on most recent books. Importing it once and then following its daily updates gives the catalog every trade book published in Portugal since 2002, with a good cover for most of them, and costs no ISBNdb or Apple quota.

## Success

- An "inside" catalog search for `casa dos espiritos` returns the Porto Editora edition, with the BNP cover.
- Scanning or typing a Portugal ISBN that the catalog lacks returns the BNP record with its cover, even while ISBNdb is paused.
- After the import, the cover queue (`UNCHECKED_COVERS_SQL`) and the details job (`UNCHECKED_DETAILS_SQL`) select no imported book. On the import day, ISBNdb pauses no earlier than on the days before.
- A book published yesterday is in the catalog within a day of the BNP adding it.

## The source (measured 2026-10-18)

- **OAI-PMH:** `https://oai.bnportugal.gov.pt/servlet/OAIHandler`.
  - Set `bibliografianacional` covers 2002 onward and holds 346,198 records.
  - Use the `marcxchange` format (UNIMARC). It carries name roles, structured names, the original language, the cover link and the classification. `oai_dc` lacks the roles.
  - A page holds 300 records, takes about 8 s and weighs about 1.3 MB. The whole set is about 1,150 pages, under 3 hours.
  - `resumptionToken`s expire about a minute after they are issued. A harvest pages straight through a window, and resumes by date window, never by a saved token.
  - `from` and `until` filter on the datestamp, which is the date a record last changed, with day granularity. The datestamps spread from 2013 to now, about 100 changed records a day (1,494 between 10-01 and 10-15). Many are corrections to old records.
  - Markers: the non-sorting markers arrive as real U+0098 and U+009C. `cleanCatalogText` already strips them.
  - One record: `?verb=GetRecord&metadataPrefix=marcxchange&identifier=oai:oai.bn.pt:bibliografianacional/<id>`. The OAI header's identifier has that form, and the datestamp is in the header.
- **Per ISBN:** `https://urn.porbase.org/isbn/unimarc/marcxchange?id=<isbn>`.
  - It returns the same marcxchange record shape and takes about 80 ms. It needs no key and has no known quota.
  - A miss is HTTP 200 with `<urn-response><error>Registo inexistente</error></urn-response>`.
  - It searches PORBASE, the union catalog, so it also knows books outside legal deposit.
  - Here the non-sorting markers arrive as literal `?` (`?A ?casa dos espíritos`). The parser must strip a leading `?word ?` pair.
- **Cover scans:** UNIMARC `856 $u` is `http://rnod.bnportugal.gov.pt/ImagesBN/winlibimg.aspx?skey=&doc=…&img=…&save=true`. It 301-redirects to the same URL on https.
  - Scans are JPEG, 400 px wide, 9–55 KB, and download in about 0.25 s.
  - Heights run 396–683. A ratio under 1.2 fails the existing `isAcceptableCover`, as with any other source (`domain/images.ts:9`).
- **Profile of 3,900 records** (datestamps from 2025):
  - 10% have no ISBN.
  - 9% are textbooks (UDC `(075`).
  - 12% match an institutional name pattern, before the pattern was tuned.
  - 2% have no publisher (`[s.n.]`).
  - Of the kept records, 69% have a scan, 18% carry an ISBN-10, and 11% have no main author (`700`/`701`).
- **Not in the records:** synopses. UNIMARC `330` appears in 1 of 3,900.

## Decisions

The user decided 1, 2, 3 and 9 and approved the direction of the rest in conversation. Items marked *(Claude's call)* are open to change in review.

1. **Scope: trade books only.** The user is "not interested in institutional material". A record is imported only if all of these hold:
   - It has a valid ISBN: some `010 $a` that is an ISBN-10 or ISBN-13 with a correct check digit, then made canonical by `canonicalIsbn`. `canonicalIsbn` checks neither length nor check digit (`packages/shared/src/library/bookMatch.ts:55`), so the importer checks first.
   - It is not a textbook, meaning no `675 $a` contains `(075`.
   - Its publisher (`210 $c`) is named, so not `[s.n.]` and not empty *(Claude's call)*.
   - Its publisher does not match the institutional deny-list: municipalities and their companies, parishes and unions of parishes, intermunicipal communities, universities, faculties, polytechnics and colleges, school clusters, ministries, directorates-general, regional governments and their secretariats, the Assembleia, associations, research centres, museums, dioceses and parishes, bands, choirs and philharmonics.
     - The list leans towards keeping a book. A name pattern that would catch known trade publishers stays out of it: "Clube do Autor", "Fundação Francisco Manuel dos Santos", "Fundação Calouste Gulbenkian" and "Instituto Piaget" were all caught by a naive pattern. A few obscure books slipping through costs less than losing real ones.
     - The dry run's publisher report is how the list gets checked.
   - It has at least one person to credit (decision 4) *(Claude's call)*. Colloquia and exhibition catalogues with no person are dropped.
   - The pre-2002 set (`bibliografianacional2001`, 445k records) is out of scope. Its ISBNs come mostly from the 1990s, and the sample showed no scans.
   - Expected result: about 70% of the set, roughly **240k books**. The catalog has 78k today.
2. **Imported books are searchable at once.** New books get `created_by = 'bnp'`, which is confirmed under `CONFIRMED_SQL` and searchable through `books_fts`. A matched existing book that is not yet confirmed becomes confirmed (decision 6).
3. **Covers.** The scan is downloaded once, encoded through the existing pipeline (`storeCoverImage`, `covers/<id>.webp` plus `-thumb`) and stored as cover source `bnp`.
   - Its status follows the usual rule: width at least `MIN_GOOD_WIDTH` means `good`, otherwise `low_res`.
   - The book gets `cover_checked_at = now`.
   - **On an existing book, the scan replaces the cover when the book has no cover image, when its status is `low_res`, or when the current image is an ISBNdb image on a Portugal ISBN.** The user chose to always replace low-res. Replacing the watermarked ISBNdb Portugal covers is Claude's call, matching the existing `replacesWatermark` rule.
   - `manual` covers (uploads and publisher feeds) and every other `good` cover are never touched.
   - A matched existing book whose record has no usable scan keeps its cover state exactly as it was, with no `cover_checked_at` stamp *(Claude's call)*. Today's queue behaviour for the existing 78k books doesn't change.
   - A scan that fails `isAcceptableCover` counts as no scan.
   - The covers are stored in R2 *(Claude's call)*, even though the scan URL also works over https. The app serves every cover from R2 with thumbnails and colours, and pages should not depend on the BNP's uptime or load.
4. **Record mapping (UNIMARC).** Text goes through `cleanCatalogText`, then trim.

   | Book field | From |
   |---|---|
   | `isbn` | the first valid `010 $a` (on the lookup path, the ISBN that was asked for); the record's other ISBNs are not used (decision 6) |
   | `title` | `200 $a` (several `$a` joined with " ; "), plus the part number `$h` and part title `$i` when present, so volumes stay distinct (`title_key` includes title numbers); no subtitle `$e` *(Claude's call)* |
   | `author` | every `700` then `701`, whatever its `$4` (these fields are main responsibility by definition, and picture-book illustrators count as authors, as in the authors fill), each as `$b $a` ("Isabel Allende"), dates `$f` dropped, joined ", "; if none, `702` with `$4 070` (author); if none, `702` with `$4 340` (editor); if none, the record is dropped (on the lookup path, kept with an empty author) |
   | `translator` | `702` with `$4 730`, formatted like `author`, joined the way existing sources store several translators |
   | `original_title` | `304 $a` text after "Tít. orig.:". This needs a new extractor: `originalTitleIn` only matches "Título original" (`domain/translation.ts:3`). It is stored with `fillOriginalTitle`. |
   | `publisher` | first `210 $c`, brackets and "[distrib.]" removed |
   | `year` | `100 $a` positions 9–12 when four digits, else the first four-digit year in `210 $d` |
   | `pages` | `215 $a`, the main page count ("169, [7] p." → 169) |
   | `language` | `editionLanguage(101 $a codes, isbn)` (`por` on a Portugal ISBN gives `pt-PT`, `eng` gives `en`) |
   | `genres` | decision 5 |
   | `summary` | `330 $a` when present, `summary_source = 'bnp'`, with no source link (`summaryLink` returns `""` for `bnp`); the user asked for whatever synopses exist, and 1 in 3,900 records has one |

   `givenNameFirst` is not used. UNIMARC already splits surname (`$a`) and given names (`$b`), so "Miguel Serras Pereira" comes out right.
5. **Genres from the classification (UDC, `675 $a`), at import, with no outside call.**
   - A fixed table maps UDC codes to `BOOK_GENRES`:
     - children's (`-93`, age auxiliaries `(0.053.2…)`/`-053.2`);
     - young adult (`-053.6`);
     - poetry (`821…-1`);
     - crime (`-312.4`), science fiction (`-312.9`), historical fiction (`-311.6`);
     - biography & memoir (`-94`, `929`);
     - travel (`-992`, `91`);
     - comics (`741.5`);
     - history (`93`/`94`), philosophy (`1` except `159.9`), psychology (`159.9`), religion (`2`), politics (`32`), business (`33`, `65`), science (`5`), technology (`004`, `62`), cooking (`641.5`).
   - The builder verifies each code against the UDC summary and the sample before relying on it, and drops any that doesn't hold.
   - **A plain novel (`-31`), short story (`-32`/`-34`), drama, essay, or any unmapped code gets no genre** *(Claude's call)*. That leaves it to the existing Jev classifier once someone holds the work.
   - These genres are library subjects, so `genres_source` stays NULL, the same as Open Library and ISBNdb subjects.
   - On an existing book they replace only `[]` or Jev genres. That is the precedence `saveDetails` applies, but the import must not call `saveDetails`: it sets `details_status = 'found'`, and `getDetails` would then never look the book up.
6. **Dedupe on ISBN, never overwrite.**
   - A record matches the book that holds its ISBN (above) as a key (`isbn:<13>`). That book is updated. It fills empty fields only:
     - author and title through `fillMissingIdentity`, which also helps the remaining authorless books;
     - pages, year, publisher and translator through `mergeDetails`, which `COALESCE`s them; summary through its CASE rule, which takes a summary only where there is none;
     - original title, language and genres as above;
     - the cover rule from decision 3.
   - A record's other ISBNs are neither matched nor added as keys *(Claude's call)*.
     - Some records list a whole collection, with up to 10 volume ISBNs, or a pair of per-volume ISBNs (`010 $b v. 1`). Keying them all would fold every volume into one book.
     - The catalog already treats each ISBN as its own edition. A barcode for another of the record's ISBNs still finds the record through the lookup (decision 9).
   - An ISBN-less book with the same title and author is not adopted *(Claude's call)*. Which edition it is can't be known, and `seedBook` doesn't adopt either.
   - `createBook`/`NewBook` carry none of pages, translator, summary, language or original title, so new books are created and then filled through the same fill path as matched books. New repository methods are expected; the builder chooses their shape.
   - If that book was not confirmed, it becomes confirmed. The import adds `bnp` to its `data_sources`; `DataSource` gains `"bnp"`.
   - Otherwise a new book is created with the `ta:` key added only when it is free, as `seedBook` does.
   - Different editions stay separate books. The nightly `groupKeylessWorks` folds same-title editions into one work. Translation linking uses the stored `original_title` through the existing machinery.
7. **No background job calls an outside source for an imported book.**
   - Covers: a book with no usable scan gets `cover_status = NULL` and `cover_checked_at = now`. `UNCHECKED_COVERS_SQL` then skips it, while `resolveCover` still schedules a normal lookup the first time it is displayed (a NULL status is not `missing`).
   - Details: `UNCHECKED_DETAILS_SQL` excludes `created_by = 'bnp'`. Synopsis and genre lookups run through `getDetails` when someone opens the book, as for any never-seen book.
     - The partial index `idx_books_details_unchecked` (`connection.ts:58`) must carry the same exclusion in its `WHERE`, and the query must state it in a form SQLite can match to the index. Otherwise every batch walks up to 240k excluded rows once the other candidates run out.
   - Work keys: `WORK_LOOKUP_SQL` already requires `details_status IS NOT NULL`, so an imported book enters it only after someone opens it.
   - Retitle, works backfill and cover colours make no outside calls for these books. `encodeCover` computes the colour.
8. **The daily sync runs inside the server** *(Claude's call)*.
   - A books-plugin job runs once at boot and then every 6 hours. It harvests `from=<cursor>&until=<today UTC>` in `marcxchange` and applies every record with the same filter, mapping and rules.
   - The cursor is the last `until` that finished, kept in a one-row-per-feed state table in `covers.sqlite`. It advances only after the whole window succeeds.
   - Re-reading the cursor day is harmless, because everything is idempotent by ISBN.
   - **With no cursor, the sync does nothing.** The import script writes the cursor when it finishes, so a deploy can never start the full harvest inside the server.
   - Corrections only fill empty fields and can add a scan that appeared later. Deleted records are ignored.
9. **ISBN lookups ask the BNP first for Portugal ISBNs.** The user said yes; the details are Claude's call.
   - In `searchExternal`'s ISBN branch, an ISBN for which `isPortugalIsbn` holds (978-972, 978-989) is looked up through the per-ISBN endpoint before the composite catalog. This happens unless the catalog already holds that ISBN from the BNP.
   - A hit goes through the same mapping and rules as the import, including the scan as the cover. It is saved under the ISBN that was asked for, made searchable and returned as the only result.
   - None of the scope filters apply (institutional, textbook, no publisher, no person), because someone scanning a barcode has the book in hand. The ISBN obviously exists.
   - A miss, or a `SourceUnavailableError`, falls through to the composite catalog as today. Other ISBNs are unchanged.
   - This lives in `booksService`, not `compositeCatalog`, so it doesn't collide with the separate ISBNdb-first search change. The plan rebases on that change if it has merged.

## The one-time import

`backend/scripts/import-bnp.mjs [--dry-run] [--from YYYY-MM-DD] [--until YYYY-MM-DD]`, run in the production container like the other scripts (`backend/README.md`).

- It harvests month-sized datestamp windows from `--from` (default: the set's earliest datestamp) to `--until` (default: today). Each window is paged straight through.
- It applies each page's records, then prints a JSON line per finished window with that window's counts and `through`, so a killed run resumes with `--from <through>`.
- **Each window is paged straight through into mapped records first, then applied.** A `resumptionToken` lasts about a minute, and applying a page's scans takes longer than that.
- Records are applied with at most 2 in flight *(Claude's call)*, and never two that share an ISBN at once.
  - Each record is planned right before it is applied, so a book created earlier in the window is matched.
  - Each record writes in its own short transactions. The write lock is never held across a network call.
- Production runs Node 24, where a regex substring keeps its whole page alive (#295). Every value the reader keeps is copied with `structuredClone`.
- A failed scan download leaves the book without a cover but with `cover_checked_at` set. It is counted, and re-running that window retries it, since the book still has no cover.
- At the end, if this was not a dry run and `--until` was today, it writes the sync cursor.
- **The dry run** opens the database read-only, harvests and maps everything, and downloads no images, which takes about 3 hours. Read-only means `new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true })` as in `scripts/repair-mojibake.mjs:11`; `openBooksDb()` is read-write and runs migrations. It reports:
  - counts per filter rule (no ISBN, textbook, no publisher, institutional, no person, kept);
  - new versus existing, and the cover actions it would take (new with scan, new without, replace by reason, keep);
  - the top 50 kept publishers, and the top 50 dropped publishers per rule;
  - genre counts by genre;
  - 20 sample mapped books.
- It reads the XML with the same small reader the sync and the lookup use, with no new dependency *(Claude's call, the builder may overrule)*. The format is machine-written, flat datafield/subfield XML.
- Estimates for the real run: about a day in total (3 h of harvesting plus about 165k scans at 2 in flight).
  - `covers.sqlite` grows by about 540 MB, at today's 2.2 KB per book. `/data` has 4.1 GB free.
  - R2 grows by about 8 GB (two WebP files per scan), about $1.50 in PUTs once and cents a month.

## Components

- `seed/bnpRecord.ts`: the marcxchange reader (datafield/subfield/controlfield, entities, both namespace forms) and the mapping, filter and UDC table. Pure functions, so they are testable on fixtures.
- `seed/bnpImport.ts`: OAI window harvesting and the "apply record" step (match or create, fill, cover rule), shared by the script, the sync and the lookup.
- The books plugin: the sync job and the cursor table.
- `booksService.searchExternal`: the Portugal-ISBN lookup.
- Types: `BookCreator`, `DataSource` and `CoverSourceName` gain `"bnp"`. `UNCHECKED_DETAILS_SQL` gets its exclusion.
  - The builder checks every switch over these unions, such as summary links, cover attribution and admin views.
- `backend/scripts/import-bnp.mjs` and a `backend/README.md` section. `docs/portuguese-book-sources.md` moves PORBASE out of "Unexplored".

## Testing

- **Reader and mapping** against fixtures cut from real responses. The endpoints are open, so the builder fetches the fixtures with the URLs above: an OAI page with a `resumptionToken`, the 1704776 (Arendt) and 2047928 (municipal) records, the per-ISBN Allende record (`?A ?casa`) and a "Registo inexistente" reply. They cover:
  - each filter rule, and a known trade publisher the deny-list must keep;
  - names with dates, multi-word surnames, the 070 and 340 fallbacks, and no person;
  - translators, original title, year from `100` and from `210 $d`, pages, ISBN-10, language;
  - every UDC mapping and a plain novel with none.
- **Apply:**
  - A new book has its fields and a `good` `bnp` cover with `cover_checked_at` set. It is searchable, and neither `UNCHECKED_COVERS_SQL` nor `UNCHECKED_DETAILS_SQL` returns it.
  - A new book without a scan has a NULL status and `cover_checked_at` set, and `resolveCover` schedules it.
  - An existing book gets its empty fields filled and no field overwritten. Its cover is replaced for none, `low_res` and ISBNdb-on-Portugal, and kept for `manual`, Apple and Open Library `good` covers. An unconfirmed book becomes searchable.
  - A matched book whose record has no scan keeps its cover state untouched. A record with several ISBNs creates and keys only its first. An ISBN-less book with the same title is not adopted.
  - A rejected-ratio scan counts as none, and a re-run is idempotent.
  - `EXPLAIN QUERY PLAN` for `UNCHECKED_DETAILS_SQL` uses the partial index.
- **Sync:** with no cursor, nothing happens. With a cursor, it harvests from the cursor through today and advances. A failure mid-window leaves the cursor where it was.
- **Lookup:** a Portugal-ISBN miss is saved with its scan, under the asked ISBN, and returned. A textbook or a record with no person is still saved. A BNP miss or outage falls through. A non-Portugal ISBN and an ISBN already held from the BNP are not asked.

## Production (one runbook entry, run after the deploy that ships this)

1. `import-bnp.mjs --dry-run`, about 3 h with nohup. The user reads the publisher lists and the counts. A deny-list change means a new deploy and a new dry run.
2. `import-bnp.mjs`, about a day with nohup.
   - Before it, check `railway volume list --json` for room for about 540 MB of growth plus WAL and Litestream.
   - Avoid a production deploy while it runs, since deploys kill ssh jobs (`backend/README.md`). If one happens, rerun with `--from <last through>` and no `--until`.
   - If the report lists failed windows, rerun from the first failed window's `from` with no `--until`, so the run ends today and writes the cursor.
3. The next day:
   - check the server log for the sync's first window;
   - spot-check `casa dos espiritos`;
   - compare `railway logs --filter "ISBNdb paused"` on the import day with the days before (success criterion 3).

## Risks

- **Search ranking.** Local search ranks only by `bm25` over title and author, with no popularity signal. With about 3× more books, one-word queries may put an obscure edition above the expected one. This is not addressed here; measure after the import.
- **Nightly works grouping.** `groupablePairsStmt` aggregates over every keyless work. Each call holds the write lock (`BEGIN IMMEDIATE`) and blocks the event loop. The plan must time it, and the first night's merges, on a database of about 320k books before the production run. Each call must stay under 1 s, well below the 5 s `busy_timeout` that the import's connection waits for.
- **Translation backlog.** `translation-backlog.mjs` selects every Portuguese work, so its next run sees about 240k more. Held works still go first, and `--max` caps the spend. Check its dry-run counts before that paid run.
- **The institutional deny-list is a heuristic.** The dry run is the check, and the cost of a miss in either direction is small.
- **The BNP's own load.** About 1,150 OAI pages and about 165k images, at most 2 in flight. The script uses the existing `Atmyshelf/1.0` user agent.

## Not in this design

- Synopsis sources for Portugal editions (more publisher sites, Google Books, translating the original work's synopsis). This is a follow-up, kept in the main checkout's `todo/portuguese-synopses.md`.
- The pre-2002 set; the BNP as a cover source for books the import didn't cover; changes to search ranking; deleting catalog books.
- The search-side fixes (ISBNdb first, quota reserve, publisher in result rows), which another session handles.
