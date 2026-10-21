# One row per book in search

## Why

On 2026-10-21 the user searched "fourth wing" in the mobile Search tab. *Fourth Wing* appeared three times:
- "Fourth WIng", with its cover and "The Empyrean · 1";
- the Hugo Roman 2024 edition (French, which keeps the English title), with no cover;
- the Piatkus 2023 edition, with no cover.

Below them were the coloring book, a 3-book set and the graphic novels.

Reading the code (no production data yet; Railway was down) gives these causes:

1. **Editions saved by a search stay apart for up to a day.** `saveHits` (`backend/src/modules/books/booksService.ts:255`) gives a new ISBNdb edition a new work with no Open Library key. The title-key grouping that folds it into its book runs only at boot and then every 24 h (`backfill.ts:51`, `plugin.ts:182`).
2. **Those editions have no cover for a long time.** Nothing looks a cover up at save, and ISBNdb hits arrive without one (`adapters/isbndb/isbndbCatalog.ts:33`). The background cover enqueue walks the whole catalog oldest-first (`booksService.ts:340`), so new saves wait behind it.
3. **Grouping gives up when a title key has several keyed works.** It folds a keyless work into a keyed one only when exactly one keyed work has that title key (`GROUPABLE_PAIRS_SQL`, `adapters/sqlite/sqliteBooksRepository.ts:81`).

   The title key `ta:<normalised title>|<first author>|<numbers in the title>` (`domain/normalize.ts:118`) drops everything after a colon and anything in brackets. So "Fourth Wing", "Fourth Wing: The Graphic Novel" and a duplicate Open Library work "Fourth Wing" all share one key. Any one of them as a second keyed work blocks the fold for good.

   Open Library has several works for *Fourth Wing*, and popular recent books often do. Only translation joins merge keyed works today (`mergeTranslation`, `sqliteBooksRepository.ts:857`). The admin merge refuses a keyed source (`sqliteBooksRepository.ts:848`).

## Goals

- **One row per book.** A search shows one row for a book even when the catalog holds several editions or several Open Library works for it.
- **A search-saved edition joins its book at once,** in the same request, not at the next nightly run.
- **A search-saved edition without a cover gets its cover looked up at once,** ahead of the catalog-wide backlog.
- **The row shows an edition with a cover** when the work has one with the same full title.
- **Duplicate Open Library works merge automatically.** The user decided this on 2026-10-21: "merge Open Library records with the same title and author automatically, logged and undoable."

## Non-goals

- Ranking changes. Once the duplicates merge, the novel's short title already ranks above the coloring book, the set and the graphic novels.
- Fixing title casing such as "Fourth WIng". An automatic fix would break names like "McCarthy" and "iPhone".
- Fixing derivative-work authors such as the coloring book's "Entangled".
- Changing the existing title-key rule for a key with one keyed work. It already folds "X: A Novel" into "X", which is what it is for.
- An ISBN search answered by the national library (`booksService.ts:485`). It doesn't go through `saveHits`, and those editions are Portuguese ones the BNP import already groups.
- A mobile change. Rows show the server's result. A cover found after the response appears on the next search.

## Anti-goals

- **Never merge two different books.** A novel and its graphic novel, coloring book or companion share a title key, so a title key alone never decides a merge between two keyed works, or a fold into one of several keyed works. Both also need the same **full title**: the whole title after `normalizeWords`, which lowercases and strips accents and punctuation but keeps subtitles and bracketed words.
- **Never redo an undone merge.** If a person undoes a duplicate merge, no later pass puts those two works together again. That includes passes through a third duplicate.
- **Never merge two works that share an arena tournament.** That's the existing `arenaCheck` rule (`plugin.ts:100`).
- **Search must not slow down noticeably.** The new work in the external search request only touches the title keys of the editions that request saved, at most 12 (`compositeCatalog.ts:105`). It is also capped per request.
- **Don't starve the server.** The catalog-wide script paces its writes, because back-to-back writes from a second process starve the server's 5 s busy timeout (measured 2026-10-19).
- **Don't spend the ISBNdb search budget** on covers. Cover lookups use the existing `normal` lane.

## The how: decided

### Which Open Library works are duplicates (my call, within the user's rule)

Two live keyed works are duplicates when:
- each has an edition with the same title key;
- each work's own title and author give that key (`workTitleKey(work.title, work.author)`);
- their full titles are equal.

The second check stops one misfiled edition from linking two different books. The third keeps "Fourth Wing: The Graphic Novel" apart from "Fourth Wing", while "Fourth WIng" and "Fourth Wing" still merge.

They are never duplicates when:
- either work's first author is empty;
- the first author is a placeholder: "anonymous", "anon", "anónimo", "unknown", "unknown author", "desconhecido", "desconocido", "inconnu", "autor desconhecido", "various", "various authors", "vários", "vários autores", "autores varios", "AA.VV.", "VV.AA.".

The surviving work is the one with the most editions, then the oldest `created_at`, then the lowest id. The others merge into it with the existing `mergeInto`, which moves editions, aliases the old id and logs a `work_merges` row with the new source `ol-duplicate`. Each merged work keeps its `ol_work_key`, and `workByKeyStmt` (`sqliteBooksRepository.ts:109`) resolves that key to the survivor, so later work-key lookups file new editions correctly.

If any two works in a set of duplicates have an undone merge between them, the whole set is left alone.

### Folding a keyless edition when a key has several keyed works

Today grouping skips the key. Instead, it folds the keyless work into the one keyed work with the same full title. It still skips when no keyed work has that full title, or more than one does. The Piatkus "Fourth wing" folds into the novel, and "Fourth Wing: The Graphic Novel" from ISBNdb folds into the graphic novel's work.

### When merges and folds run

- **At search save,** for the title keys the request saved:
  1. Duplicates merge.
  2. Then grouping runs for those keys, with both the existing rule and the full-title rule, capped at 50 folds per request.
- **Once over the whole catalog,** from a script with `--dry-run` that lists every planned duplicate merge. We review it, then run a paced `--apply` (my call). Production can't be copied locally (no local R2 credentials), and this would be the largest merge since the series collapse on 2026-10-20.
- **Nightly, after that backlog is applied:** the same pass runs before the keyless grouping. This is a separate, later PR, because once it ships it runs at every boot.

### Undo

`backend/scripts/undo-series-merges.mjs --undo <file>` undoes reviewed merges through `undoReviewedMerges`, and accepts `ol-duplicate` merges too.

Undoing an `ol-duplicate` merge moves back the editions that merge moved, plus any edition carrying the source's `ol_work_key`. It does **not** run the grouped move-back that translation undos use (`sqliteBooksRepository.ts:154-165`). Both works share the key, so that step would take the survivor's own keyless editions. Keyless editions folded in after the merge stay with the survivor.

A code or Jev translation join into a work later merged as a duplicate drops out of the translation review's "merged" list (`sqliteBooksRepository.ts:205`), and can't be undone until the duplicate merge is. The README says so.

### Covers at save

After saving, each saved edition with no cover whose lookup is due (`lookupDue`) is scheduled on the `normal` lane, which tries ISBNdb, then Open Library by ISBN.

### Which edition a row shows

- **In `by=work` search,** a work keeps its place from its best-matching edition. When that edition has no cover, the row shows the work's first scanned edition that has a cover and the same full title. A query for the Portuguese title still shows the Portuguese edition, and the graphic novel's cover never stands in for the novel.
- **In the external search results,** the same swap applies within each work, because mobile keeps the first result per work (`mobile/src/features/search/searchModel.ts:131`).

## Left to the builder

- Repository method names, and how the grouping is shared between the nightly run and the save-time call.
- Paging, and the pause the script takes between writes.

## Done looks like

- On production, "fourth wing" shows one *Fourth Wing* row with a cover. The Piatkus and Hugo Roman editions sit in its edition strip, and the graphic novel keeps its own row.
- The dry run's merge list has been reviewed and applied.
- One `ol-duplicate` merge has been undone and stayed undone through a search and a nightly run.
