# Work cover for ISBN-less library copies

## Problem

On 2026-10-20 the library copy of *Dicionário da Erosão* (John Freeman) showed no cover. The copy has no ISBN, so the app keys it by title and author. That leads to an old catalog record with no ISBN and `cover_status = 'missing'`. Its only possible lookup was a title search, run on 2026-09-30, and it found nothing. The same work also has the Tinta-da-China edition (ISBN 9789896716844, added by the national bibliography import) with a good library scan. 75 library books across 4 readers are in this state.

## Decision (user, 2026-10-20)

When a library copy has no ISBN and its own catalog record has no cover, show the cover of the work it belongs to.

## Behaviour

- `resolveCover` returns the work's first covered edition (`workCoverImageIds`, the same rule as the work-level cover) as `url`/`fullUrl` with `pending: false`, `upgrading: false`. It does so when the found book has no ISBN and no `cover_image_id`, and its work has an edition with a cover. That cover takes the place of `NO_COVER`/`PENDING`.
- The book's own lookup is scheduled exactly as before. A cover found later replaces the borrowed one, because nothing is written to the book's row.
- A found book that has an ISBN, and a book with its own cover, are unchanged. A lookup whose ISBN the catalog lacks can still land on an ISBN-less title-keyed record, and then it borrows too.
- Public pages (`peekCachedCoverUrl(s)`) use the same rule through one shared function.

## Out of scope

- Writing the borrowed cover to the row.
- Language matching between editions.
- Batching the extra query in `peekCachedCoverUrls`.
