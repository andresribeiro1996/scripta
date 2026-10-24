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
3. **Recording an id**, in `booksService.ts`, for each lookup whose book `findOrCreateBook` returns:
   - If the id is valid and the book has no `kobo_image_id`, store it. The first id wins and is never overwritten.
   - If the id was just stored, the book's status is `missing` or `low_res`, and the book is not due (`lookupDue`), mark it upgrade-wanted (`setUpgradeWanted(book.id, now)`) and schedule it on the `upgrade` lane. A `good` or `manual` book, and a book with no status yet, is left as it is.
   - `enqueueCovers(lookups)` records, then schedules due books on the normal lane exactly as today.
   - A new `recordKoboImageIds(lookups)` only records. It never schedules a book because it is due, so a run over every library spends no ISBNdb or Open Library quota on books that only happened to be due.
4. **Lookup.** `findBestCover`'s book gains `koboImageId?: string | null`. When it is set, the first step is one candidate, `{ source: "kobo", url: koboCoverUrl(id) }`, before the ISBN steps, whatever the lane. It is an exact identifier, so there is no title or author check. Rejected URLs, `isAcceptableCover` and the 400 px stop apply as for any source.
   - `koboCoverUrl(id)` in a new `backend/src/modules/books/adapters/sources/kobo.ts` returns `https://cdn.kobo.com/book-images/${encodeURIComponent(id)}/1200/1800/false/image.jpg`. The path is Kobo's own image template, `{ImageId}/{Width}/{Height}/false/image.jpg`; 1200×1800 asks for more than `encodeCover`'s 1600 px cap needs at a cover's usual 1.5 ratio.
   - `CoverSourceName` (`domain/types.ts:5`) and `CoverCandidate.source` (`domain/ports.ts`) gain `"kobo"`.
   - `processBook` passes `book.kobo_image_id`.
   - `fetchImage` (`plugin.ts`) throttles Kobo images to one request a second (`KOBO_COVER_GAP_MS = 1000`), as it already throttles Open Library's covers.
5. **Backfill from libraries already imported.**
   - `koboCoverLookups()` in `backend/src/modules/library/workHolders.ts` reads `SELECT DISTINCT isbn, title, author, image_id FROM library_books WHERE image_id IS NOT NULL`. It keeps the rows whose id passes `normalizeImageId` and returns `{ isbn, title, author, imageId }` lookups. It is exported from the library index like `heldWorks`.
   - `app.ts` passes it to the books plugin as the option `koboCoverLookups` (`BooksPluginOptions`, beside `heldWorks`).
   - With the option set, the books plugin runs `service.recordKoboImageIds(koboCoverLookups())` as the job `kobo covers`, once a day, with its own first-run delay `FIRST_RUN_DELAY_MS.koboCovers = 165_000`, after `bnpSync`. After the first run it only reads: recorded ids are not rewritten and no book is scheduled again.

## Behaviour

- **A new Kobo import:** each store book's catalog row gets its id. Books that are due run on the normal lane with Kobo tried first, so a Kobo cover of 400 px or more costs no ISBNdb call.
- **A book imported before this change** that has no good cover: the first `kobo covers` run marks it upgrade-wanted, and the upgrade lane fetches Kobo before asking Apple.
- **`good` and `manual` covers are never touched.** The one exception follows the existing rule (`replacesWatermark`, `booksService.ts:378`): an ISBNdb cover on a Portuguese ISBN that is already wanted for an upgrade is replaced by a Kobo cover of 400 px or more, because those ISBNdb covers carry a watermark.
- **An ISBN-less copy of the same work** borrows the Kobo cover through the existing sibling lending (`domain/siblingCover.ts`).
- **"Wrong cover"** rejects a Kobo URL like any other, and the next best cover is looked up.

## Accepted risk

The id comes from a user's library file, and the cover it points at is shown to every account for that catalog book. A crafted file can attach another Kobo product's cover to a book. The host is fixed and the id must be a UUID, so the worst case is a wrong book cover, which an admin removes with "Wrong cover". Because the first id wins, a later correct import doesn't fix it on its own.

Kobo's covers are copied into the object store, as Apple's artwork already is.

## Unverified

The session that wrote this could not reach `cdn.kobo.com`. These are unknown:

- What the CDN answers for an id it doesn't have. A 404 is expected, since the viewer falls through on an image error; a 200 placeholder would be stored as a cover.
- Whether it upscales a small original to fill 1200×1800.

Check both after deploy from the first `cover_images` rows with `source = 'kobo'` (width, height, and a look at a few).

## Not in scope

- Any client change, or a resolve route that accepts an image id.
- Kobo's affiliate product feed.
- Replacing `good` covers with Kobo's.
- Asking Kobo again after a miss, or letting a later id replace a recorded one.
