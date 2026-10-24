# Kobo CDN covers

From the 2026-10-24 search for more catalog feeds: the books our cover sources miss most are the big groups' Portugal editions (Leya, Porto Editora, Bertrand), which block automated reads and are absent from the publisher importer (`docs/publisher-catalog.md`, "Contact first").

Every Kobo import already carries a cover key that nothing on the server uses:

- Both importers keep each book's `ImageId` (`backend/src/modules/library/import/importChild.ts:15-18`, `frontend/src/lib/sqlite.ts:19`), and the library stores it per copy in `library_books.image_id` (`backend/src/modules/library/adapters/sqlite/schema.sql:39`).
- An import passes it on to the books module: `coverLookupsOf` builds lookups with `seedCoverLookup` (`packages/shared/src/arena/arenaSeed.ts:12-23`), which carries a UUID-checked `imageId`, into `enqueueCovers` (`backend/src/modules/library/service.ts:435`). `findOrCreateBook` drops it, since `BookLookup` has no such field (`backend/src/modules/books/domain/normalize.ts:40-44`).
- The static viewer uses it as its first cover tier, `https://cdn.kobo.com/book-images/{ImageId}/353/569/False/image.jpg` (`viewer/index.html:989-991`), and found 16 of 19 covers from it alone (`viewer/README.md:36`).
- Kobo's Portuguese store carries Leya's imprints (Dom Quixote, ASA) and Relógio d'Água through Kobo Plus e_LeYa (2021).

## Decision

1. **A catalog column, `books.kobo_image_id TEXT`.** It is in `books.sql` for new databases and added on boot to existing ones, as `apple_checked_at` is (`adapters/sqlite/connection.ts:36`). `BookRow` gets `kobo_image_id: string | null`.
2. **`BookLookup` gains `imageId?: string | null`.** The books module checks it again with `normalizeImageId` from `@scripta/shared` (`packages/shared/src/library/covers.ts:33-36`); an id that fails is ignored. The HTTP routes are unchanged: `lookupSchema` (`backend/src/modules/books/routes.ts:9-13`) still strips the field, so only server-side callers can pass one.
3. **Recording an id**, in `booksService.ts`:
   - If the id is valid and the book has no `kobo_image_id`, store it. The first id wins and is never overwritten.
   - A book **wants a Kobo upgrade** when its status is `missing` or `low_res`, or when it matches the existing watermark rule (`booksService.ts:392`): status `good`, current image from `isbndb`, and `isPortugueseIsbn(book.isbn)`. A `manual` book, a `good` cover from any other source, and a book with no status yet never do; a book with no status is already on the unchecked list.
   - **`enqueueCovers(lookups)`**, the import path, uses `findOrCreateBook` as today and records the id. A due book is scheduled on the normal lane exactly as today, with Kobo tried first. A book that is not due, whose id was just stored and which wants a Kobo upgrade, is marked upgrade-wanted (`setUpgradeWanted(book.id, now)`) and scheduled on the `upgrade` lane.
   - **A new `recordKoboImageIds(lookups)`**, the backfill, only touches books that already exist (`lookupIdentity` + `findExisting`, `domain/findOrCreate.ts:11-25`), so it never creates a catalog row. It records the id, and marks upgrade-wanted and schedules `upgrade` for a book whose id was just stored and which wants a Kobo upgrade, due or not. It never schedules the normal lane, so it spends no ISBNdb or Open Library quota. The whole pass runs in one `repo.transaction`.
4. **Lookup.** `findBestCover`'s book gains `koboImageId?: string | null`. When it is set, the first step is one candidate, `{ source: "kobo", url: koboCoverUrl(id) }`, before the ISBN steps, whatever the lane. It is an exact identifier, so there is no title or author check. Rejected URLs, `isAcceptableCover` and the 400 px stop apply as for any source.
   - `koboCoverUrl(id)` in a new `backend/src/modules/books/adapters/sources/kobo.ts` returns `https://cdn.kobo.com/book-images/${encodeURIComponent(id)}/1200/1800/False/image.jpg`: the viewer's proven URL, with the size raised past `encodeCover`'s 1600 px cap at a cover's usual 1.5 ratio.
   - `CoverSourceName` (`domain/types.ts:5`) gains `"kobo"`; `CoverCandidate.source` (`domain/ports.ts:143`) follows it.
   - `processBook` passes `book.kobo_image_id`.
   - **Apple's 30-day stamp stays honest.** A Kobo cover of 400 px or more ends the lookup before Apple is asked, so `processBook` doesn't stamp `apple_checked_at` when `outcome.found` is a Kobo candidate at least `MIN_GOOD_WIDTH` wide. Kobo is the first step, so that is exactly the case where Apple was skipped.
   - `fetchImage` (`plugin.ts`) throttles Kobo images to one request a second (`KOBO_COVER_GAP_MS = 1000`), as it already throttles Open Library's covers.
5. **Backfill from libraries already imported.**
   - `koboCoverLookups()` in `backend/src/modules/library/workHolders.ts` reads `SELECT DISTINCT isbn, title, author, image_id FROM library_books WHERE image_id IS NOT NULL`. It keeps the rows whose id passes `normalizeImageId` and returns `{ isbn, title, author, imageId }` lookups. It is exported from the library index like `heldWorks`.
   - `app.ts` passes it to the books plugin as the option `koboCoverLookups` (`BooksPluginOptions`, beside `heldWorks`).
   - With the option set, the books plugin runs `service.recordKoboImageIds(koboCoverLookups())` as the job `kobo covers`, once a day, with its own first-run delay `FIRST_RUN_DELAY_MS.koboCovers = 165_000`, after `bnpSync`. After the first run it only reads: recorded ids are not rewritten and no book is scheduled again.

## Behaviour

- **A new Kobo import:** each store book's catalog row gets its id. Books that are due run on the normal lane with Kobo tried first, so a Kobo cover of 400 px or more costs no ISBNdb call.
- **A book imported before this change** that is `missing` or `low_res`, or has a watermarked Portuguese ISBNdb cover: the first `kobo covers` run marks it upgrade-wanted, and the upgrade lane fetches Kobo before asking Apple. The watermarked cover is replaced by a Kobo cover of 400 px or more through the existing `replacesWatermark` rule (`booksService.ts:378`).
- **Other `good` covers and `manual` covers are never touched.**
- **A book with no status yet** keeps its place on the unchecked list; when the background lane reaches it, Kobo is tried first.
- **An ISBN-less copy of the same work** borrows the Kobo cover through the existing sibling lending (`domain/siblingCover.ts`).
- **"Wrong cover"** rejects a Kobo URL like any other, and the next best cover is looked up.

## Accepted risk

The id comes from a user's library file, and the cover it points at is shown to every account for that catalog book. A crafted file can attach another Kobo product's cover to a book. The host is fixed and the id must be a UUID, so the worst case is a wrong book cover, which an admin removes with "Wrong cover". Because the first id wins, a later correct import doesn't fix it on its own.

Kobo's covers are copied into the object store, as Apple's artwork already is.

## Verify before merge

The session that wrote this could not reach `cdn.kobo.com`. A Kobo answer of 400 px or more is stored as `good` and never retried, and the first backfill run sends every eligible book through it, so these are checked before merge, from a machine that can reach the CDN:

```
curl -sS -o real.jpg -w '%{http_code} %{content_type}\n' https://cdn.kobo.com/book-images/<a real ImageId>/1200/1800/False/image.jpg && file real.jpg
curl -sS -o none.jpg -w '%{http_code} %{content_type}\n' https://cdn.kobo.com/book-images/00000000-0000-4000-8000-000000000000/1200/1800/False/image.jpg && file none.jpg
```

- **The real id** should answer 200 with a JPEG near 1200 wide or 1800 tall. A small original that comes back upscaled to fill the box is acceptable but worth knowing.
- **The unknown id** must answer 404. A 200 placeholder would be stored as a cover; a 5xx would leave every such book's lookup incomplete and retried every 10 minutes. Either result blocks the merge until the design handles it.

If bad covers are stored anyway, the repair is to point each affected book back at its newest non-`kobo` `cover_images` row (images are never deleted) and add its Kobo URL to `cover_rejections`, leaving `kobo_image_id` set. The resolver skips a rejected URL, and a set id is never rewritten. Clearing the id instead would undo itself: the next `kobo covers` run reads the same `library_books.image_id` and records it again.

## Not in scope

- Any client change, or a resolve route that accepts an image id.
- Kobo's affiliate product feed.
- Replacing `good` covers with Kobo's, beyond the watermark rule.
- Asking Kobo again after a miss sooner than the book's next lookup, or letting a later id replace a recorded one.
