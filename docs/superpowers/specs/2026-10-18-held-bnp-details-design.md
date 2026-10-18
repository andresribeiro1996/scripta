# Details for held national-bibliography books

## Why

The BNP import (PR #304) adds about 240k books with `created_by = 'bnp'`. To protect ISBNdb quota, the background details job (`UNCHECKED_DETAILS_SQL`, partial index `idx_books_details_pending`) never selects them. The import spec's decision 7 assumed their synopsis, rating and genres would come from `getDetails` "when someone opens the book". That isn't true:

- `getDetails` runs only through `GET /books/details` (`backend/src/modules/books/routes.ts:76`). Its callers are `useGenreEnrichment` on web and mobile (library books with no genres yet) and the web mural's `useMuralBookMetadata`/`BookSummary`.
- The work screens read `GET /works/:id`, which never fetches.

So a bnp book that arrived with a UDC genre (poetry, children's, history, …) never gets a synopsis or rating, even once someone holds it. The same goes for books created by the BNP-first Portugal-ISBN lookup in `searchExternal` (a scanned Portugal book the catalog lacked becomes a bnp book).

## Success

- A bnp book with `details_status IS NULL` whose work any library holds is looked up by the details backfill on its next tick (boot, then every 10 minutes), ahead of the rest of the queue.
- A bnp book whose work no library holds is never looked up by any background job. The rule from the import spec stands unchanged.
- Nothing changes for any other book, or for `GET /books/details`.

## Decision (the user chose this)

**The details backfill takes held bnp books first.** Each batch of `backfillDetails` starts with bnp books that have no details and belong to a held work, then fills the rest of the batch from the existing queue. "Held" comes from the `heldWorks` callback the books plugin already receives (`backend/src/modules/books/plugin.ts:58`), the same one the genre, synopsis and translation jobs use.

Rejected:
- A hook on each library add path (`PUT /library`, `POST /library/books`, `POST /library/books/add`, the works sweep). Four places to wire, a separate pass for books already held, and a burst of lookups on a big import.
- Fetching when a work page opens. Browsing alone would spend the users' ISBNdb budget, anonymous viewers would need excluding, the first view still shows nothing, and a held book nobody opens never gets details.

## How it works

1. **Held works.** Per batch, read `heldWorks()` and map the ids to live works with `repo.canonicalWorkIds` (library rows can point at a work that has since been merged; merges move editions to the live work, so `books.work_id` is always live). Read once per batch, no cache: the batch runs at most every 10 minutes. *(Claude's call.)*
2. **Held bnp candidates.** A new repository read returns ids of books with `created_by = 'bnp'`, `details_status IS NULL` and `work_id` in that set, up to the batch limit. Order: never-attempted first, then by `details_checked_at`, `created_at`, `rowid`, matching `UNCHECKED_DETAILS_SQL` so a book whose lookup keeps failing doesn't starve the others. It should use `idx_books_work`, not scan the bnp rows. *(Shape and name are the builder's.)*
3. **Batch.** `backfillDetails(limit)` looks up the held bnp ids first, then up to `limit − (held count)` ids from `listUncheckedDetailIds`. Each id goes through the existing loop unchanged: `getBook`, skip if `details_status` is no longer null, `lookupDetails` with the strict `backgroundCatalog`, `onDetailsChecked`, `SourcePausedError` ends the batch, `SourceUnavailableError` stamps `details_checked_at` and is logged. *(Claude's call: held bnp first, one shared batch of 50.)*
4. **Wiring.** `BooksServiceDeps` gains an optional `heldWorkIds: () => string[]`. The plugin passes it when `options.heldWorks` is set, as it does for the Jev jobs. Without it, `backfillDetails` behaves exactly as today.
5. **Unchanged.** `UNCHECKED_DETAILS_SQL` and `idx_books_details_pending` keep excluding every bnp row. The ISBNdb limits apply as today: the backfill's 500-a-day cap and the shared 4,800 non-search budget. `GET /books/details`, `/works/:id`, the clients, and the cover and work-key jobs are untouched.

## Consequences the user accepted

- Details land within about 10 minutes of a book entering a library, not on first view.
- Holding is by work, so every bnp edition in a held work with no details is looked up, not only the edition the user has. A grouped Portugal title often has two or three such editions.
- A held bnp book will usually spend an ISBNdb call, because Open Library rarely has a Portuguese summary. That spending is the point.
- A book held and then removed keeps whatever details it got.
- A held bnp book whose lookup failed on an outage sorts behind untried held bnp books but still ahead of every regular book. Only 50 or more held bnp books failing on every attempt could keep the regular queue waiting, and an outage hits every book alike. *(Claude's call: accepted, not capped.)*

## Testing

- Repository: the new read returns only bnp books with null `details_status` in the given works, in the stated order, up to the limit; it ignores bnp books in other works, non-bnp books, and books with details. `EXPLAIN QUERY PLAN` shows `idx_books_work`.
- Service, with a recording background catalog:
  - a held bnp book is looked up before the regular queue, and the batch never exceeds the limit;
  - an un-held bnp book is never passed to the catalog;
  - a library row pointing at a merged work still counts (canonical mapping);
  - without `heldWorkIds`, the batch is what it was.
- Existing backfill, queue and BNP import tests stay green.

## Docs

`backend/README.md`'s details backfill paragraph says the backfill "checks every catalog book". Update it to say bnp-created books are left out unless a library holds their work, and that those held ones go first.

## Not in this design

- Better Portuguese synopsis sources (`todo/portuguese-synopses.md` in the main checkout).
- Retrying `missing` bnp books, or anything about `found` partial answers. Both behave as for every other book.
- The works-grouping speed fix that blocks the production import.
