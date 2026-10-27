# Cover picker — design

## Why

When the automatic cover is wrong or blurry, an owner's only fix today is to upload an image to their gallery and assign it. The backend already knows where to look (Kobo, ISBNdb, Open Library, Apple, and the images it has stored for the book), but it keeps only the first image that reaches 400px (`findBestCover`, `backend/src/modules/books/coverResolver.ts:38-77`). The admin can't choose among sources either: "Wrong cover" rejects the current image and waits for the worker to find another, and "Replace cover" takes an upload (`backend/src/modules/books/routes.ts:112-135`, `frontend/src/components/book/BookScreen.tsx:116-146`).

MyBibliotheca's picker shows every cover its sources found, at their sizes, and lets the reader choose one. This design adds that to both clients' existing cover pickers.

## Decisions

**From the user (2026-10-26):**
- **An owner's pick changes only their own library.** It works like a gallery cover does today. The admin also gets **Use for everyone**, which sets the shared catalog cover.
- **Fast sources first, Apple after.** Kobo, ISBNdb, Open Library and stored covers show within a few seconds. Apple's covers add themselves when its slower lookup finishes.
- **The per-field details merge from the same comparison is dropped.** Swapping a summary by length alone is unsafe. Dates are stored as a year only (`books.year INTEGER`, `backend/src/modules/books/adapters/sqlite/books.sql:17`). In the details flow, pages come only from ISBNdb. That leaves the rule nothing to compare.

**Builder's calls (Claude's, each open to the user's override):**
1. **Clients measure the found covers, not the server.** The list returns URLs, and each client loads them directly and reads their natural size. The server downloads nothing until a pick. Open Library cover downloads go through a 3.1 s throttle (`backend/src/modules/books/plugin.ts:49`), so measuring on the server would take seconds per candidate.
2. **A picked cover is stored in the shared catalog store, not the picker's gallery.** It becomes a `cover_images` row of the book, so two readers who pick the same Apple cover share one copy. It also doesn't count against the gallery quota, and the gallery stays "images I uploaded".
3. **The server only downloads URLs it handed out.** It keeps the URLs it listed, per account and book, in memory for 30 minutes. A pick for any other URL is refused. That closes server-side request forgery without keeping a list of allowed hosts, which ISBNdb's image URLs wouldn't fit. A deploy clears the list; the client then says "Reopen the picker".
4. **User lookups take the urgent lane.** Today cover sources always queue behind the worker (`backend/src/modules/books/adapters/sources/isbndb.ts:43`, `apple.ts:44`, `openLibrary.ts:12`). The picker builds its own source instances whose throttle calls `throttle(task, { urgent: true })`. The throttles and the ISBNdb gate and budget stay shared. The adapters don't change.
5. **The same limits as the resolver apply.** That means at most 3 candidates per step (`CANDIDATES_PER_STEP`), the title and author check on title steps, rejected URLs hidden, and the ISBN-only rule for pre-2002 BNP books.
6. **Use for everyone is web-only.** Mobile has no admin flag (`mobile/src/features/works/WorkScreen.tsx:81`), and the admin's existing cover tools are web-only too.
7. **Wrong cover and Replace cover stay.** Wrong cover is still the fix when no candidate is right. Installed web builds also call those routes.

## Backend

All of this lives in `backend/src/modules/books`.

### `GET /covers/candidates`

The route is authenticated. Both picker routes share their own rate-limit scope of 30 requests a minute, because each listing can spend ISBNdb's shared daily budget.

Its query is the same lookup as `GET /covers/resolve` (`isbn`, `title`, `author`), plus `from`, which is `quick` (the default) or `apple`. A lookup with neither an ISBN nor a title gets a 400. The route finds or creates the catalog book the way `uploadCover` does (`findOrCreateBook`).

`from=quick` returns these groups, in order:
1. **Stored:** every `cover_images` row of the book, newest first, except rows whose `source_url` is in `cover_rejections`. Each has `coverImageId`, the thumbnail and file URLs (`publicUrlFor`), `width` and `height`. The name is `coverImageId` everywhere, because `imageId` in a cover lookup already means the Kobo ImageId.
2. **Found:** these steps, in order:
   - Kobo (when `kobo_image_id` is set)
   - ISBNdb by ISBN
   - Open Library by ISBN
   - ISBNdb by title
   - Open Library by title

   A found candidate has `coverImageId: null`, `url` and `fullUrl` both set to the source URL, and `width: null`, `height: null`. A URL already listed, as a stored row's `source_url` or by an earlier step, is dropped.

`from=apple` returns only Apple's steps: by ISBN, then by title. It drops URLs that match a stored row's `source_url`, just as `quick` does.

The response is `{ candidates: CoverCandidateView[], unavailable: CoverSourceName[] }`. `unavailable` names each source that failed (`SourceUnavailableError`, including a paused or spent ISBNdb). The service doesn't log those failures as warnings (`deps.warn`), because a picker is not a lookup the worker owes the book. The shared ISBNdb gate and budget still log their own pause lines.

The steps reuse `findBestCover`'s step building. The list of steps (sources by ISBN, then by title, with the accept function, the rejection filter and the per-step cap) moves into one function that both `findBestCover` and the candidate list call.

Each found URL is merged into the offer map, keyed by account and book id, for 30 minutes. It merges rather than replaces, because the client's quick and apple listings run in parallel. Expired entries are pruned on each write.

### `POST /covers/pick`

The body is the lookup plus exactly one of `coverImageId` (a UUID) or `url` (at most 2,000 characters), and optionally `everyone: boolean`.

Checks, in order:
- `everyone` from anyone but the admin → 403.
- No catalog book for the lookup → 404.
- `coverImageId` that isn't a row of this book, or whose `source_url` is rejected → 404.
- `url` that isn't in this account's offers for this book → 409, "That cover offer expired. Reopen the picker."

For a `url`:
- If a stored row of this book already has that `source_url`, the pick reuses it.
- Otherwise the server downloads the image on the urgent lane, through the same per-source throttles as `fetchImage`.
  - A download that fails → 502.
  - An image that is missing or fails `isAcceptableCover` → 422, "That image can't be used as a cover."
  - An image that passes is stored with `storeCoverImage(deps, book.id, offer.source, url, image, at)`.
  - Two picks of the same URL for the same book at once share one download and one row.

With `everyone: true`, the book's cover is set to the image with status `manual`, its upgrade mark is cleared, and its backoff is dropped. That is the same tail `uploadCover` runs (`backend/src/modules/books/booksService.ts:509-522`); both call one helper. Without `everyone`, the catalog cover is untouched.

The response is `coverOf(imageId, false)`: `{ url, fullUrl, pending: false, upgrading: false }`.

### Storage

There is no new table or column. The changes are:
- **A new repository query, `listImages(bookId)`.**
- **A new index, `CREATE INDEX IF NOT EXISTS idx_cover_images_book ON cover_images(book_id)`.** It goes in `books.sql`, which runs on every boot. Nothing reads `cover_images` by book today, and the table holds every BNP scan.

## Shared (`@scripta/shared`)

- **`isAcceptableCover`** and its constants (aspect-ratio limits and the ISBNdb placeholder size) move from `backend/src/modules/books/domain/images.ts:249` into the shared library module. The backend imports them from there, and the clients use them to hide found covers that fail once loaded.
- **`setBookCoverUrl(book, url)`** goes beside `setBookCover` in `packages/shared/src/library/bookCovers.ts`. It sets `_coverUrl` and removes `_coverImageId`, because a catalog pick is not a gallery image. `clearBookCover` already reverts either kind.
- **`CoverCandidateView`** and the two response types are added, with the two request wrappers as pure query and body builders. Each client's API layer does the fetch.

## Clients

Both pickers get a **Found covers** section above **Your gallery**:
- web: `frontend/src/components/CoverPickerModal.tsx`
- mobile: `mobile/src/features/library/components/CoverPicker.tsx`

The section shows only when the caller passes the book's cover lookup. That is the same `CoverLookupParams` the caller already uses with the cover resolver. On web the callers are the library page, the book screen and the groups page; pickers opened for a group or mural cover are unchanged.

**Remove custom cover** shows when the book has a gallery cover **or** any `_coverUrl`. Today it keys only on the gallery id, which would leave a found-cover pick with no way back.

- **Loading.** On open, the picker sends `from=quick` and `from=apple` in parallel. Quick results show first. Until Apple answers, a muted "Checking Apple Books…" tile sits at the end. Each name in `unavailable` adds one muted line, for example "ISBNdb didn't answer."
- **Tiles.** A found tile loads its remote URL and reads the natural size. It hides itself if the image fails to load or fails `isAcceptableCover`. Each tile shows `width × height` and the source name. Stored tiles show their stored size.
- **Current pick.** The tile whose `url` or `fullUrl` equals the book's `_coverUrl` is marked as current.
- **Choosing a tile.** Tapping a tile posts the pick, then applies `setBookCoverUrl(book, response.fullUrl)` through the same save path a gallery pick uses (`frontend/src/hooks/useBookActions.ts:108-134`, `mobile/src/features/library/hooks/useLibraryActions.ts:97-101`). The picker then closes. A 409 shows "Reopen the picker"; a 422 or 502 shows the server's message on the tile.
- **Admin, web only.** When `GET /books/admin` says `isAdmin`, each tile has a second action, **Use for everyone**. It posts with `everyone: true`, calls the resolver's `remember(lookup, response)` so the admin sees the new cover at once, and clears the admin's own custom cover on that book with `clearBookCover`. Other accounts see the change when their 7-day cache entry for the book expires, as after an admin upload today.

The picker stays owners-only, as it is today.

## Not in this release

- The details merge rule (dropped, above).
- Use for everyone on mobile.
- A picker for books the viewer doesn't own.
- Deleting unpicked stored images, which are never deleted today.
- Measuring candidate sizes on the server.
- Folding Wrong cover and Replace cover into the picker.
- Series covers.

## Deploy impact

- **Backend:**
  - The new routes only add to the API.
  - Installed clients never call them, and no existing route or field changes. This follows the installed-client rule in `backend/AGENTS.md`.
  - There are no new environment variables.
  - The boot index build on `cover_images` adds a one-time pause at the first boot after deploy.
  - R2 grows by one image per first pick of a URL.
- **Web:** ships with the Pages deploy.
- **Mobile:** JS only, since `expo-image` is already installed, so it ships over the air to builds with a matching native fingerprint.
- **ISBNdb:** each picker open can spend up to 2 calls from the shared 4,800-a-day budget, and the 30-a-minute scope bounds how fast one account can spend it. When the budget is spent, ISBNdb shows as unavailable and the rest of the list still works.

## Tests

- **Backend service:**
  - The candidate list returns stored covers first, newest first.
  - Rejected URLs are hidden.
  - Duplicates across steps and against stored rows are dropped.
  - The cap of 3 per step holds.
  - The ISBN-only rule skips title steps.
  - `from=apple` asks only Apple; `from=quick` never asks Apple.
  - Failed and paused sources land in `unavailable`.
  - Picker lookups use the urgent lane.
  - Offers expire after 30 minutes.
- **Pick:**
  - A URL never offered, or offered to another account → 409.
  - An already-stored `source_url` is reused without a download.
  - An unacceptable image → 422, and nothing is stored.
  - A failed download → 502.
  - A non-admin `everyone` → 403.
  - `everyone` sets a `manual` cover and clears the upgrade mark.
  - A personal pick leaves the catalog cover alone.
- **Routes:** validation errors (no ISBN or title, both or neither of `coverImageId` and `url`, a bad `from`) and the auth guard.
- **Shared:**
  - The `isAcceptableCover` cases move with it from `backend/src/modules/books/domain/images.test.ts:54-62`.
  - `setBookCoverUrl` drops `_coverImageId`.
  - The request builders.
- **Clients:** the tile rules (unacceptable or failed tiles hide, the current pick is marked) are shared helpers, tested in `@scripta/shared`. The clients are checked by typecheck, lint, and one device pass on mobile.

Every new `*.test.ts` file goes into `backend/package.json`'s test list.
