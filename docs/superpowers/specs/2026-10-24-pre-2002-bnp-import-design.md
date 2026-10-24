# Pre-2002 national bibliography import — design

**Date:** 2026-10-24. This extends `2026-10-18-national-bibliography-import-design.md`, whose decision 1 left the pre-2002 set out of scope. Every rule of that spec, as amended by `2026-10-18-held-bnp-details-design.md`, holds here unless a decision below changes it.

## Why

The catalog lacks most Portuguese editions from the 1990s. The 2002+ import made recent books findable, but a reader holding a 1995 edition still finds nothing by its ISBN or title. The national library's pre-2002 set lists those editions. The user chose to import it with **exact covers only**: a cover found by the book's own ISBN, never a cover from a search by title, which for an old edition is usually a different, later or foreign edition.

## Success

- After the run, `9789722014526` (*Terceiras pessoas*, 1998) is in the catalog and an inside search finds it. The first time it is displayed, its cover lookup stores the ISBNdb cover.
- `9789724610788` (*Hannibal*, 1999) is in the catalog. Its cover lookups make no title search on any source, so it shows the no-cover tile instead of the Spanish Debolsillo cover a title search returns today.
- `9789728334543` is stored with the title "O poeta e a pedra", not "<O >poeta e a pedra".
- The pre-2002 run never writes the `bnp` harvest cursor. Only the in-server 6-hourly sync moves it, and the sync's next log line after the run shows a normal window.
- A 2002+ BNP book without a scan still gets title searches, as today.

## The source (measured 2026-10-24)

- **Set `bibliografianacional2001`:** 445,110 records, same endpoint and `marcxchange` format as the 2002+ set.
  - **Datestamps:** 344,646 records carry 2013-06-13, the day the set was loaded. The other 100,464 changed later, 75,636 of them in 2026. None is earlier than 2013-06-13.
  - Month windows from 2013-06 therefore make one huge window, 2013-06, of about 1,150 pages (about 2.5 h at 8 s a page), and small windows after it.
  - **Identifiers:** `bn/1935-2001/<n>` for the 2013 load and `PT1749-…` for later records. Walking numbers through `GetRecord` would miss the latter, so the harvest stays on `ListRecords` windows.
- **Scope:** a random draw of 2,442 record numbers found 593 empty, so 1,849 records.
  - 200 of those (10.8%) pass `bnpSkipReason`. The rest are skipped for no ISBN (1,558), textbook (44), no person (26), institutional (18) and no publisher (3). That makes about **48k books**.
  - Of the 200, 153 are from the 1990s, 40 from 2000–01, 6 from the 1980s, and 1 has no year.
  - 48 of the 200 (24%) are already in the catalog: 26 from the seed, 16 from the BNP and 5 from publisher feeds. That leaves about **36k new books**.
- **Scans:** none in the sample, so every book's cover comes from the cover lookup.
- **Display markers:**
  - 32% of the first 900 records carry `<display= sort form>` markers (`<III= 3> Congresso`, `Europa <1992= 1992>`, `Textos <&=e> pretextos`) or `<article >` markers (`<O >desconhecido`, `<The >Beatles`, `<L' >hexagone`).
  - Neither `mapBnpRecord` nor `cleanCatalogText` strips them. They reach `title_key`, where `<I-= 1>` adds "i 1".
  - The 2002+ set uses U+0098/U+009C instead, but production holds one stored row with an `<A >` marker: `9789725653890`, from 2007.
- **Cover probe:** a read-only run of today's `findBestCover`, with all three sources, on the 200 sampled books in production.

  | Result | Books |
  |---|---|
  | Exact, by ISBN (all from ISBNdb; 34 under 400 px, mostly about 300×450) | 42 |
  | Guess, by title (Apple 10, ISBNdb 17, Open Library 2) | 29 |
  | Nothing | 110 |
  | Unfinished, after Open Library timed out | 19 |

  For the 152 books not yet in the catalog: 15% exact, 15% guess, 70% none. Apple matched none of the 200 by ISBN. The guesses include Spanish and French editions: *Hannibal* got Debolsillo's cover, and *História de Portugal* (1991) got an ebook with a French ISBN.
- **Existing books:** 3,521 BNP-created books already have a year before 2002, mostly late-catalogued 2002+ records. 3,381 of them have never had a cover lookup.

## Decisions

1. **Same import rules.** The pre-2002 set goes through the same skip rules, mapping, first-ISBN dedupe, fill-empty-only matching and searchable-at-once rule. New books get `created_by = 'bnp'`, and no background job calls an outside source for them. The user approved the import; reusing the rules unchanged is *Claude's call*.
2. **Exact covers only for old BNP books** (the user's call). A book with `created_by = 'bnp'` and a `year` before 2002 gets covers by ISBN only. `findBestCover` runs its `byIsbn` steps and none of its `byTitle` steps, in every lane: front, normal, upgrade and background.
   - The rule is keyed on `created_by` and `year`, not on the set the record came from, because no column records the set *(Claude's call)*. It also covers the 3,521 existing old BNP books, which share the same problem.
   - The barcode lookup rarely creates an old edition today: `urn.porbase.org` misses pre-2002 books by ISBN-13 and finds them only by ISBN-10, while `lookupBnpIsbn` sends the 13-digit form. Retrying with the ISBN-10 is a separate follow-up.
   - A NULL year keeps today's rules.
   - Existing covers are not touched. The rule only changes future lookups.
   - A low-res exact hit follows today's rules: an upgrade-lane pass and a 30-day recheck. Under this rule, both look up by ISBN only.
3. **Display markers are stripped at mapping** *(Claude's call)*. Every text value the mapper cleans goes through two rewrites:
   - `<display=sort>` becomes `display` (`<III= 3>` → `III`, `<&=e>` → `&`).
   - `<text >`, whose inner text ends in a space, becomes `text ` (`<O >desconhecido` → `O desconhecido`).
   - A bracket with neither form, such as the existing test's `<jardim>`, stays. This applies to both sets. The per-ISBN endpoint marks articles as `?O ?poeta`, which the existing leading-marker rule already handles.
   - `<L' >hexagone` comes out as "L' hexagone", with a stray space but the same title key. `<&=e>` comes out as "&", so a "Textos e pretextos" edition keys apart from "Textos & pretextos". Both are rare and accepted.
   - The one stored production row is fixed by hand (runbook step 4) rather than by a migration.
4. **The script selects the set** *(Claude's call)*. `import-bnp.mjs --pre-2002` harvests `bibliografianacional2001`, defaults `--from` to `2013-06-01`, and never writes the harvest cursor. Without the flag, the script behaves exactly as today. `--dry-run` and `--until` work with or without it.
5. **Harvest stays window-then-apply** *(Claude's call)*.
   - The 2013-06 window holds about 38k kept books plus a `[reason, publisher]` pair for each skipped record. That's less than the 78k-record 2002+ month the first import held.
   - With no scans, applying per page would save nothing but memory. It would also add a second code path.
   - A failed 2013-06 chain is retried once inside the run, then listed in `failedWindows` for a rerun of that window alone.
6. **No sync for the pre-2002 set** (non-goal). Corrections are picked up by rerunning the script with `--pre-2002 --from <date>`. The 6-hourly sync stays on the 2002+ set and its cursor.

## Components

- `seed/bnpImport.ts`: the OAI set becomes a parameter of harvesting (`firstUrl`, `harvestOnce`, `harvestWindow`) and of `BnpImportOptions`. `syncBnp`, `fillBnpCollections` and the per-ISBN lookup keep the 2002+ set.
- `seed/bnpRecord.ts`: marker stripping in the mapper's text cleaning.
- `coverResolver.ts`: `findBestCover` can skip its title steps. `booksService.processBook` asks for that when decision 2's rule holds for the book.
- `backend/scripts/import-bnp.mjs`: `--pre-2002`.
- `backend/README.md`:
  - The BNP section gains the pre-2002 run.
  - The cover rules paragraph (the "Covers, exact edition first" bullet) gains decision 2.

## Testing

- **Mapping:** real pre-2002 records, fetched with `GetRecord` for `bn/1935-2001/231671` ("<O >poeta e a pedra") and a record with `<n= n>` and `<III= 3>` markers, map to clean titles. Their `title_key` carries no marker text. The existing `<jardim>` test is unchanged.
- **Harvest:** a run with the pre-2002 set requests `set=bibliografianacional2001` and writes no cursor even when `cursorOnSuccess` is asked for. A default run requests `set=bibliografianacional` and writes the cursor exactly as today.
- **Covers:**
  - With title steps off, `findBestCover` calls no `byTitle` on any source and still returns an ISBN hit.
  - `processBook` makes no title call for a `bnp` book from 1999, in the background lane and in the upgrade lane.
  - It still makes title calls for a `bnp` book from 2005, a `bnp` book with no year, and a `seed` book from 1999.
- **Script:** the script has no unit tests. The production dry run (runbook step 1) is its check.

## Production (one runbook entry, after the deploy that ships this)

1. **Dry run:** `node scripts/import-bnp.mjs --pre-2002 --dry-run`, detached, about 3.5 h. Its first window line must read `2013-06-01..2013-06-30`, with about 344k records and `failed: null`. That line is the go/no-go for the real run: the window is one chain of about 1,150 pages, four times the longest chain the 2002+ import walked. The user reads:
   - the kept and dropped publisher lists, since old institutional names may slip past the deny-list;
   - the samples, which should carry no markers;
   - the counts: expect about 48k kept and about 36k new.
2. **Real run:** `node scripts/import-bnp.mjs --pre-2002`, detached, about 6 h: 3.5 h of harvesting plus about 48k paced writes.
   - Before it, check the volume has room for about 80 MB plus WAL.
   - Hold deploys until it finishes.
3. **Failed windows:** rerun each one with `--pre-2002 --from <from> --until <until>`.
4. **One stored title:** with the user's OK, fix `9789725653890`'s title by hand by dropping its `<A >`.
5. **Next day:**
   - Check the success ISBNs.
   - Read the boot and works-grouping stall logs, since the catalog grows about 15%.

## Risks

- **The 2013-06 window is one chain of about 1,150 single-use tokens.** A dropped page restarts it, at most twice per run. The mitigation is a rerun of that window alone.
- **Nightly works grouping and startup** grow with about 36k books. #352 yields inside the grouping pass, and the next-day check above measures it.
- **The paid translation backlog** sees about 36k more Portuguese works. Check its dry-run counts before its next paid run.
- **Search ranking:** more old editions compete for one-word queries, the same open risk as the 2002+ import.
- **ISBNdb:** cover lookups happen when a book is displayed and spend the 4,800 daily non-search calls. An old BNP book now costs one call instead of up to two, and nothing drains the budget in bulk.
