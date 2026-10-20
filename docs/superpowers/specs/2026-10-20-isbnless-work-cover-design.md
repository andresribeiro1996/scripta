# Work cover for ISBN-less library copies

## Problem

On 2026-10-20 the library copy of *Dicionário da Erosão* (John Freeman) showed no cover. The copy has no ISBN, so the app keys it by title and author. That leads to an old catalog record with no ISBN and `cover_status = 'missing'`. Its only possible lookup was a title search, run on 2026-09-30, and it found nothing. The same work also has the Tinta-da-China edition (ISBN 9789896716844, added by the national bibliography import) with a good library scan. 75 library books across 4 readers are in this state.

## Decision (user, 2026-10-20)

When a library copy has no ISBN and its own catalog record has no cover, show the cover of the work it belongs to.

## Behaviour

- `resolveCover` returns the work's first covered edition (`workCoverImageIds`, the same rule as the work-level cover) as `url`/`fullUrl` with `pending: false`, `upgrading: true`. It does so when the found book has no ISBN and no `cover_image_id`, and its work has an edition with a cover. That cover takes the place of `NO_COVER`/`PENDING`.
- A borrowed cover is sent as `upgrading: true`. The shared client (`packages/shared/src/library/coverResolver.ts`) caches an `upgrading` answer in memory for 10 minutes and never persists it, where any other answer is persisted for 7 days. A borrowed cover must not look final, or the client would keep it for a week and never show the real cover the copy's own lookup finds later. The flag changes only caching; neither the web nor the mobile `CoverImage` reads it.
- "Wrong cover" on a copy that borrows records a rejection of the borrowed image's `source_url` for the copy, then re-queues the copy as before. The borrow rule never lends an image whose `source_url` the copy has rejected, and does not try another edition instead. An image with no `source_url` (an admin upload) cannot be rejected this way. A lookup already running when the rejection is recorded re-reads the copy's rejections before it stores a cover, and drops a found cover that is now rejected.
- The book's own lookup is scheduled exactly as before. A cover found later replaces the borrowed one, because nothing is written to the book's row.
- A found book that has an ISBN, and a book with its own cover, are unchanged. A lookup whose ISBN the catalog lacks can still land on an ISBN-less title-keyed record, and then it borrows too.
- Public pages (`peekCachedCoverUrl(s)`) use the same rule through one shared function. `peekCachedCoverUrls` asks for the work covers of all its rows in one query.
- `enqueueCovers` only schedules lookups and does not look for borrowed covers.

## Out of scope

- Writing the borrowed cover to the row.
- Language matching between editions.
