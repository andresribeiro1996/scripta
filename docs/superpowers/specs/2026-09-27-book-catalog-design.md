# Book Catalog — a self-filling book database

## Context

The backend's `covers` module already keeps a global cover cache: one
re-encoded WebP per ISBN, shared by every account. Three problems remain:

- **Quality.** The chain keeps the first image any source returns, and
  Open Library runs first. All 131 cached covers came from Open Library;
  none is 400px wide (median ~300px, smallest 95×142).
- **Repeat requests.** A miss is never recorded, so a coverless book re-runs
  the whole chain every session for every account. Books without an ISBN
  (95 of the 283 unique books across all libraries) are never cached at all.
- **Details and search are uncached.** The detail sheet and Add Book search
  call Open Library straight from the web and mobile clients on every use.

The user wants quality covers, few books without one, and book data kept in
Scripta's own database instead of re-requested from third parties.

## Decisions locked in with the user

- **Self-filling, not pre-loaded.** Any book an account touches is looked up
  once and stored; no bulk catalog import.
- **Stored per book:** cover, details (summary, rating, rating count,
  genres), and Add Book search results.
- **Quality over exact edition.** The exact edition's cover wins when it is
  ≥400px wide; otherwise a high-res cover of the same book (another edition,
  matched on title + author) is used.
- **Only the owner fixes shared covers**, and the fix applies to everyone:
  reject a cover, or upload a replacement.
- **One `books` module** that absorbs `covers`.
- **Different editions stay separate books** (one row per ISBN).
- **Free-text search is local-first**: saved books that match are returned
  without calling Open Library; there is no "search Open Library" button. A
  book that shares a title with a saved one is reached by ISBN search or
  manual entry.
- **Sources: ISBNdb → Apple Books → Open Library.** Google Books, Kobo CDN
  and Hardcover leave the chain.

## Source evidence

Measured 2026-09-27 on 65 books sampled from the real libraries (40 with
ISBN, 25 without), plus the 127 cached covers under 400px:

| Source | Found (of 65) | ≥400px | Median width | Notes |
|---|---|---|---|---|
| Apple Books (iTunes Search API, keyless) | 43 | 43 | 921 | Often a different (ebook) edition's art; needs `pt`/`br` storefronts for Portuguese books |
| ISBNdb (paid, `image_original`) | 50 | 30 | 742 | Exact edition at high res for most English books; Portuguese covers are ~250px copies of Bertrand's; returns a 200×248 "BOOK COVER NOT AVAILABLE" placeholder; occasionally a wrong image (a 1030×773 photo of a book's back) |
| Open Library | 32 | 0 | 325 | Usually the exact edition, always small |
| Google Books | 11 | 0 | 128 | Thumbnails only; larger sizes are upscaled or wide "not available" banners |

Kobo CDN serves store books only; every Kobo `ImageId` in the data is a
sideloaded file path. ISBNdb's FAQ requires stored data to be deleted if the
subscription ends, so each stored cover keeps its `source`.

## Architecture

`backend/src/modules/covers` becomes `backend/src/modules/books`. It keeps
its SQLite file (`COVERS_DB_PATH`) and blob directory
(`COVERS_STORAGE_PATH`) so no production data moves, and it keeps the
`/covers/*` routes so no stored URL changes. Kobo, Google Books and
Hardcover adapters, `CoverLookupPort`, and `HARDCOVER_API_KEY` are removed.

Cover sources are passed to the service as a list (`CoverSource` objects
with a name and `findByIsbn` / `findByTitle` functions) instead of being
imported directly, so tests can use fakes; `plugin.ts` wires the real ones.

## Storage

New tables in the existing covers SQLite file:

- **`books`** — `id`, `title`, `author`, `year`, `publisher`, `isbn`,
  `ol_work_key`, `ol_cover_id`, `summary`, `rating`, `rating_count`,
  `genres` (JSON), `source_url`, `details_status` (`found` | `missing` |
  null = never fetched), `details_checked_at`, `cover_image_id`,
  `cover_status` (`good` | `low_res` | `missing` | `manual` | null = never
  resolved), `cover_checked_at`, `created_at`.
- **`book_keys`** — `key` (primary key) → `book_id`. Keys are `isbn:<isbn>`
  and `ta:<normalized title>|<normalized author>`. A lookup carrying an ISBN
  uses and records the `isbn:` key; one without uses the `ta:` key.
- **`cover_images`** — replaces `cover_cache`: `id`, `book_id`, `source`
  (`isbndb` | `apple` | `openlibrary` | `upload`), `source_url` (null for
  uploads and migrated rows), `width`, `height`, `byte_size`, `created_at`.
  Each image is two files in the blob directory: `<id>.webp` (the existing
  pipeline, ≤1600px long edge, quality 85) and `<id>-thumb.webp` (≤600×900,
  quality 80). Images are never deleted or overwritten: a better cover adds
  a row and moves the book's pointer, so every `/covers/cached/:id/file` URL
  already stored (arena snapshots, client caches) keeps serving.
- **`cover_rejections`** — `book_id`, `source_url`: images the admin
  rejected for that book.
- **`books_fts`** — FTS5 index over `books.title` and `books.author`
  (verified available in the backend's `node:sqlite`).

**Normalization** (shared by `ta:` keys and title matching): NFKD, strip
diacritics, lowercase, drop parenthesized/bracketed text (series info like
"(Red Rising Saga, #1)"), cut at the first `:`, collapse non-alphanumerics
to single spaces. An author matches when the last word of **any**
comma-separated name in the record appears in the candidate's author
names, since records often list the translator first.

## Cover resolution

`GET /covers/resolve?isbn=&title=&author=` (auth required) now answers from
the database only and returns
`{ url: string | null, fullUrl: string | null, pending: boolean }`
immediately. `url` is the thumbnail (`/covers/cached/:id/thumb`), used by
every grid, card, arena and share view; `fullUrl` is the full image
(`/covers/cached/:id/file`), used only by the book detail views. The new
`/thumb` route has the same trust model, headers and (absent) rate limit as
`/file`, and serves the full file when an image has no thumbnail (migrated
images, which are ~300px anyway).

1. Find the book by key, creating the row if needed.
2. If it has a cover, return it (`pending: false`). If the cover is
   `low_res` and `cover_checked_at` is more than 30 days old, also enqueue a
   background upgrade.
3. If it has no cover: when `missing` and checked within 30 days, return
   `{url: null, pending: false}`; otherwise enqueue it and return
   `{url: null, pending: true}`.

`imageId` is dropped from the route and from both clients' calls.

**Worker.** One in-process queue, deduplicated by book id, processed one
book at a time — the same "plain in-process timer, no job queue" approach
as the arena sweep. Each source is throttled by a minimum spacing between
its calls: ISBNdb 1.1s (Basic plan: 1 call/sec), Apple 3.2s (~20
calls/min), Open Library 1s. The queue lives in memory; after a restart the
next client request re-enqueues any book still due.

**Chain for one book**, stopping at the first acceptable image ≥400px wide:

- Exact edition (needs an ISBN): ISBNdb by ISBN → Apple lookup by ISBN
  (`pt`, `us`, `br` storefronts) → Open Library by ISBN (`-L`,
  `default=false`).
- Same book, other edition: Apple search by title + author (`media=ebook`;
  `pt`, `us`, `br`) → ISBNdb title search → Open Library search. A result is
  used only if title and author match after normalization.

Acceptance rules for every downloaded image, applied after the existing
validate-and-re-encode pipeline:

- Portrait only: height between 1.2× and 1.9× the width. Rejects back-of-book
  photos and banner images; the rare square cover becomes an admin upload.
- ISBNdb images of exactly 200×248 are its placeholder and are rejected.
- A URL listed in `cover_rejections` for this book is skipped.
- Apple artwork URLs are requested at `1400x1400bb`.

The accepted image is written as both files (full and thumbnail) before
the book's pointer moves to it.

If nothing reaches 400px, the largest acceptable image is stored as
`low_res`. If nothing is acceptable, the book is `missing`. Both are
retried after 30 days. A `manual` cover is never retried or replaced.

**Source failures vs. misses.** Each source distinguishes "answered, no
cover" from "failed" (network error, timeout, 429, 5xx). If any source in
the chain failed and no ≥400px image was found, the book keeps its previous
status and `cover_checked_at` is not advanced, so the next request retries
it instead of recording a false miss.

`ISBNDB_API_KEY` is optional, like `HARDCOVER_API_KEY` was: unset means the
ISBNdb steps are skipped.

## Details

`GET /books/details?isbn=&title=&author=` (auth required) returns the
existing `BookMetadata` shape, or `null`.

- Finds or creates the book. Stored details are returned directly.
- Never fetched, or `missing` and older than 30 days: runs today's two-step
  Open Library lookup (search, then work), moved from the clients into the
  backend and reusing `findOpenLibraryMatch` and `buildBookMetadata` from
  `@scripta/shared`. Found details are stored and never re-fetched; a miss
  is stored with its timestamp.
- An Open Library failure returns an error (the clients already show
  "Book information is unavailable") and records nothing.

## Search

`GET /books/search?q=` (auth required) returns `BookSearchResult[]`.

- **ISBN query** (`looksLikeIsbnQuery`): a saved book with that `isbn:` key
  is returned without any external call; otherwise Open Library is searched
  by ISBN.
- **Free text:** FTS5 match over saved books' title and author (every token
  must match). Any match returns those books (up to 12) without calling Open
  Library. No match calls Open Library.
- Every Open Library result is saved as a book (title, author, year,
  publisher, ISBN, genres, `ol_cover_id`) under its `isbn:` key, or its
  `ta:` key when it has no ISBN. Covers are not resolved at search time.
- A result's `coverUrl` is the book's stored cover if it has one, else the
  Open Library `-M` thumbnail from `ol_cover_id`, else null.
- An Open Library failure returns an error ("Search is unavailable right
  now").

## Admin

- `ADMIN_USER_ID` (optional env var) names the owner's account id. An id,
  not an email, because an unregistered email could be claimed by anyone
  signing up with it. Unset means nobody is admin.
- `isAdmin` is added to the user object auth already returns (`publicUser`
  and `getAuthenticatedUserFromAccessToken`), computed per request, not
  stored in the JWT.
- `POST /books/cover/reject` `{isbn?, title, author}`: records the current
  image's `source_url` in `cover_rejections` (an upload has none; rejecting
  it just clears it), clears the book's cover pointer and status, and
  enqueues it at the front of the queue. Migrated images have no recorded
  URL, so rejecting one may re-select the same image once; its URL is known
  after that.
- `PUT /books/cover` (multipart: `image` plus `isbn?`, `title`, `author`):
  runs gallery's validation pipeline (size cap, real-format sniff, dimension
  cap, WebP re-encode), writes the full and thumbnail files, stores a
  `cover_images` row with source `upload`, and sets the book's status to
  `manual`. Returns `{url, fullUrl}`.
- Both return 403 for any account other than `ADMIN_USER_ID`.
- The web `BookDetailSheet` shows **Wrong cover** and **Replace cover** when
  `isAdmin` is true. Mobile is unchanged.

## Cross-module peek

`peekCachedCoverUrl` (used by `library/publicResolver.ts` for public share
views) keeps its synchronous, database-only contract but reads
`book_keys` → `books.cover_image_id`, returns the thumbnail URL, and gains
`title`/`author` parameters so books without an ISBN get covers on shared
pages too.

## Clients (web and mobile)

- `fetchBookMetadata` calls `/books/details`; `searchBooks` calls
  `/books/search`. Both clients stop calling Open Library directly.
- `resolveCover` (`frontend/src/api/covers.ts`,
  `mobile/src/features/library/api/covers.ts`):
  - Stored entries become `{url, fullUrl, at}` under storage key
    `…resolved.v2`, and
    an entry older than 7 days is re-asked. This is what carries background
    upgrades and admin replacements to devices, which today keep a URL
    forever. The key bump makes every device re-ask once after deploy.
  - A `pending: true` answer is not cached; the client re-asks after 5s,
    doubling to a 5-minute cap, and gives up after 10 tries (the next mount
    asks again). The in-flight map still de-duplicates.
  - The TTL and backoff schedule live in `@scripta/shared`
    (`library/covers.ts`) so both clients use the same values.
- `CoverImage` (web `BookCard.tsx`, mobile `CoverImage.tsx`) renders `url`
  by default; the book detail views (web `BookDetailSheet`, mobile
  `BookDetail`) ask it for `fullUrl`.
- Because `/covers/resolve` no longer calls third parties inside the
  request, its rate limit rises from 300 to 1200 per minute; details and
  search share a separate 300/min scope.

## Storage and bandwidth

Measured by re-encoding the cover the chain would pick for 58 of the 65
sampled books (Pillow's WebP output matched the backend's `sharp` within
3% on the existing cache):

| | Today (Open Library) | Full (≤1600px) | Thumbnail (≤600×900) |
|---|---|---|---|
| Average per cover | 22 KB | 105 KB (p90 212 KB) | 42 KB |
| Typical dimensions | ~300×460 | 933×1400 | 600×900 |

At ~150 KB per book (both files, plus ~10% for superseded images kept
alive) and a few KB of rows: 283 books ≈ 45 MB, 1,500 ≈ 240 MB, 15,000 ≈
2.3 GB, 100,000 ≈ 15 GB. The current cache is 2.9 MB. Railway volumes
default to 5 GB (Hobby) and cost $0.15/GB-month.

A 283-book grid's first load is ~12 MB with thumbnails, against ~30 MB if
grids used full images and ~6 MB today. Each device downloads a cover once:
URLs are immutable, and the PWA's `media-covers` cache keeps up to 400
entries for 60 days.

## Migration and rollout

At startup, in one transaction, only if `cover_cache` still exists: copy
each row into `cover_images` with the same id, create a book with an
`isbn:` key pointing at it, set `cover_status` to `good` (≥400px wide) or
`low_res`, set `cover_checked_at` to the epoch so the first request after
deploy queues an upgrade, then drop `cover_cache`. Running it again is a
no-op.

## Testing

Backend (`node:test`, fake sources and in-memory repositories, injected
clock; new files added to `backend/package.json`'s `test` list):

- The first acceptable image ≥400px wins, in chain order; the largest
  acceptable image is kept as `low_res` when none reaches 400px.
- Non-portrait images and ISBNdb's 200×248 placeholder are rejected.
- Rejected URLs are skipped; `manual` covers are never replaced.
- `missing`/`low_res` retry only after 30 days; a failed source does not
  record a miss.
- Title matching: subtitle and series stripping, translator-first authors,
  and rejection of a near-miss title ("Illness as Metaphor" vs "Illness as
  Metaphor and AIDS and Its Metaphors").
- Resolve returns `pending` for a new book and the URL once the worker
  finishes; the queue de-duplicates.
- Search: a saved ISBN makes no external call; a free-text local match makes
  no external call; a local miss saves every Open Library result.
- Details: stored details make no external call; a failure records nothing.
- Every stored image gets both files; `/thumb` falls back to the full file
  when the thumbnail is missing.
- Migration: copies rows with their ids, and running it twice is a no-op.
- Admin routes return 403 for a non-admin account.

Then typecheck and lint in backend, frontend and mobile, and run the
frontend and mobile test suites.

## Out of scope

- Bulk pre-loading a catalog.
- Automated fetching from bookshops such as Bertrand (no API; they block
  non-browser clients). The admin can download a cover there and upload it.
- Extracting covers of sideloaded Kobo books from the device.
- Merging editions or refreshing stored details.
- Admin actions on mobile.
