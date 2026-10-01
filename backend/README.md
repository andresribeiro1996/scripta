# Kobo Library Backend

A Node.js/Fastify/TypeScript backend, structured as a **modular monolith**: one deployable service, internally split into self-contained modules that only talk to each other through explicit public interfaces. Nine modules so far — `auth`, `library`, `gallery`, `books`, `socials`, `arena`, `murals`, `tierlists`, and `waitlist` — with more expected as the project grows. Consumed by the [frontend](../frontend/README.md), which replaces the old static, drag-your-own-file [viewer](../viewer/README.md).

Every module with a persistence dependency follows **hexagonal architecture** (ports & adapters): the module's business logic depends only on a repository *interface* it defines, never on a concrete database. See "Hexagonal architecture" below — this is a standing convention for this backend, not just how `auth` happened to be built.

## Modules at a glance

Skim layer over the detailed sections below — each module's own section has the full per-route table, decisions, and verification notes. "✓" means `Authorization: Bearer <accessToken>`.

| Module | What it owns | Routes |
|---|---|---|
| `auth` | Accounts and sessions — signup/login, JWT access + rotating refresh tokens, Google sign-in, username claim | `/auth/*` — mostly open; `me`/`logout-everywhere`/`username` ✓ |
| `library` | The account's single library document (opaque blob) plus a public share link | `GET`/`PUT /library` ✓; `POST /library/share`/`unshare` ✓; `GET /library/shared/:token` |
| `gallery` | Per-account uploaded-image pool — validated by real content, re-encoded to WebP, size/quota-capped | `GET`/`POST`/`DELETE /gallery*` ✓; `GET /gallery/:id/file` (redirect) |
| `books` | The book catalog — covers (ISBNdb → Open Library for users, Apple Books as a background upgrade, worker lanes, 600px thumbnails), details and search, all stored once and shared; admin cover fixes | `GET /covers/resolve` ✓; `GET /covers/cached/:id/{file,thumb}` (redirect); `GET /books/details` ✓; `GET /books/search` ✓; `GET /books/search/external` ✓; `GET /books/admin` ✓; `POST /books/cover/reject` ✓ admin; `PUT /books/cover` ✓ admin |
| `socials` | Platform connections (X/Instagram/Threads/TikTok OAuth, Bluesky app password), tokens encrypted at rest | `GET /socials`, link-session, bluesky, `DELETE` ✓; `connect`/`callback` open |
| `arena` | Anonymous-vote book bracket tournaments; duels settled by a 30s background sweep | create/seed/start/settle/tiebreak/delete/mine ✓; view/public-list/vote open |
| `murals` | Per-account freeform dashboard documents (block semantics live in the frontend) plus public share links | all `/murals*` ✓ except `GET /murals/shared/:token` |
| `tierlists` | Tier list ranking polls: owner-created private tier lists can open to community voting (anonymous or members-only), with live vote aggregation in three modes | create/list/get/update/delete/results ✓; open-voting/set-voting-state ✓; public-list/voting-board/ballot (submit/edit/get) open |
| `quizzes` | Game module storing quiz documents + seeded question sets + locked plays/answers in its own SQLite file, anonymous link challenges via vote codes | create/list/get/update/delete/publish/set-voting-state/results ✓; voting-board/play (submit/get)/results open |
| `waitlist` | Pre-launch email signups for the landing page — an address and when it signed up, nothing else | `POST /waitlist` open |

## Running it

```bash
cd backend
npm install
cp .env.example .env   # then fill in JWT secrets (see the comment in .env.example for how to generate them) and, optionally, Google OAuth credentials, an ISBNdb API key, and/or socials' encryption key + per-platform OAuth credentials
npm run dev
```

`GET /health` → `{"status":"ok"}` once it's up.

## Trying it out

**Three-user development fixture:** `npm run dev` (also `dev:mobile` and root `npm run backend`) automatically seeds Alice, Bob, and Charlie and starts the isolated development backend. All three use password `scripta123`; startup also updates older fixture passwords. Production `npm start` is unchanged. Reruns preserve progress; `npm run fixture -- --reset` restores the starting data. See [accounts, phone setup, and test checklist](scripts/three-users.md). Verify with `npm run test:fixture`.

**`http://localhost:3000/auth/console`** — a minimal test console (signup/login form, session panel with the issued tokens, buttons for `/auth/me`, refresh, logout, logout-everywhere, and a "Sign in with Google" link if that's configured). Not a real app screen — just the fastest way to poke the auth module from a browser instead of curl. Session is kept in `localStorage` so it survives a reload.

**`node scripts/test-auth-flow.mjs`** — runs the full auth flow (signup → duplicate rejection → login → wrong-password rejection → `/auth/me` → refresh rotation → replay detection → logout) against a running server and prints pass/fail for each step. Safe to re-run; it uses a fresh timestamped email every time.

`/library` doesn't have a UI yet (see "Not built") — exercise it with a bearer token from the console or the script above, e.g.:

```bash
curl -X PUT http://localhost:3000/library \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"data": {"source":"kobo-export","schema_version":1,"book_count":1,"books":[{"Title":"Stoner","Attribution":"John Williams"}]}}'
```

## What's here

### `auth`
- **Signup / login / logout** with email + username + password (hashed with argon2). Username is an alternate login identifier, not just a display name — `/auth/login` takes one `identifier` field checked against both email and username, either logs in the same account.
- **Google sign-in**, if `GOOGLE_CLIENT_ID`/`SECRET`/`CALLBACK_URL` are set in `.env` — the app boots and runs fine without them, it just skips registering the Google routes (and logs that it did). A Google sign-in has no username yet on its first login (Google doesn't hand you one) — `user.username` comes back `null`, and the caller is expected to prompt for one via `POST /auth/username` before treating the account as fully set up. Both the [frontend](../frontend/README.md) and the mobile app enforce this with a route guard.
- **JWT access tokens** (short-lived, 15m default) + **refresh tokens** (long-lived, 30d default, stored server-side as a salted hash — never in plaintext). Refresh rotates on every use: the old token is revoked and a new pair issued. Presenting an already-revoked refresh token is normally treated as a stolen/replayed token and revokes **every** session for that user, not just the one being used — **except** within a ~60s grace window after a normal rotation, where it's reissued instead (see `rotated_at`/`replaced_by` on `refresh_tokens`, and `service.ts`'s own comment on `refresh()`). This exists because the mobile client keeps its access token in memory only and refreshes on nearly every cold start; without the grace window, a rotation response merely lost in flight (backgrounded, network switch, process kill) would sign that account out on every device, desktop PWA included. A logout-revoked token never gets this grace window.
- **Google sign-in never puts tokens in a URL.** `GET /auth/google/callback` redirects with a short-lived (≤45s), single-use authorization code (`?code=...`) instead of the old `#access_token=...&refresh_token=...` fragment; `POST /auth/google/exchange` trades that code for the actual session, and it's the code that's TTL-bound and single-use, not the tokens it unlocks. A starting `GET /auth/google` request may optionally supply an S256 PKCE `code_challenge` (checked against a `codeVerifier` at exchange time) and a `redirect_target` naming which entry of the server-side `MOBILE_OAUTH_REDIRECT_ALLOWLIST` to redirect to instead of `OAUTH_SUCCESS_REDIRECT_URL` — this is what the mobile app uses (see `mobile/src/features/auth/googleSignIn.ts`); the desktop web flow sends neither and gets the old no-PKCE, fixed-redirect behavior.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| POST | `/auth/signup` | — | `{email, username, password}` → `{user, accessToken, refreshToken}` |
| POST | `/auth/login` | — | `{identifier, password}` — `identifier` is either the email or the username |
| POST | `/auth/refresh` | — | `{refreshToken}` → new `{accessToken, refreshToken}` |
| POST | `/auth/logout` | — | `{refreshToken}` → revokes that one session |
| POST | `/auth/logout-everywhere` | ✓ | revokes every session for the caller |
| POST | `/auth/delete-account` | ✓ | `{password}`, or `{confirmation}` (the username, else the email) for an account without a password → `204`. Signs out every session, then erases the account's data in every module through the `deleteUserData` erasers `app.ts` hands the auth plugin (votes and ballots on other people's games are unlinked, not deleted, so their results stand), then deletes the avatar file from the object store and removes the user row. A failure part-way leaves the account in place, so deleting again finishes the job. Rate-limited to 5/min |
| GET | `/auth/me` | ✓ | `{user}` |
| POST | `/auth/username` | ✓ | `{username}` → claims a username for the caller's account; `409` if taken. What a Google sign-in without one yet calls before it's treated as set up |
| POST | `/auth/avatar` | ✓ | multipart `image` field → `{user}` with the new `avatarId`. Same validation pipeline as gallery uploads (magic-byte sniff, EXIF strip), then square-cropped to 256×256 WebP; replaces any previous avatar |
| DELETE | `/auth/avatar` | ✓ | `{user}` — clears the avatar (back to the frontend's initial-letter fallback) |
| GET | `/auth/avatar/:id/file` | — | `301` to the avatar's object-store URL (see [Stored files](#stored-files)), which serves a plain `<img src>`; unauthenticated by unguessable UUID, `Cache-Control: immutable` there (the id regenerates on every replacement, so caching can't go stale) |
| GET | `/auth/google` | — | starts the Google OAuth redirect flow (only if configured). Optional `code_challenge`/`code_challenge_method=S256` and `redirect_target` (must exactly match a `MOBILE_OAUTH_REDIRECT_ALLOWLIST` entry) — the mobile app's own PKCE-bound flow |
| GET | `/auth/google/callback` | — | Google redirects here; ends by redirecting the browser to `<redirect target>?code=<one-time authorization code>` — never a token |
| POST | `/auth/google/exchange` | — | `{code, codeVerifier?}` → `{user, accessToken, refreshToken}`. `codeVerifier` is required only if the code was minted for a flow that sent a `code_challenge`; wrong/missing verifier, an expired code (≤45s), or a replayed one all `400` |
| GET | `/auth/providers` | — | `{google: boolean}` — lets a frontend show/hide the Google button without hardcoding it |
| GET | `/auth/console` | — | the test console, see "Trying it out" above |

`user` in every response above is `{id, email, username}` — `username` is `null` only for a Google-signed-in account that hasn't claimed one yet.

### `library`
- **One JSON document per account** — the same shape the [exporter](../exporter/export.py) produces (`{source, schema_version, book_count, books}`). Full replace, not a merge: saving overwrites whatever was there before, same mental model as the old viewer's drag-and-drop.
- Validation is deliberately light: the body must be `{"data": {"books": [...], ...}}` — an object with a `books` array. What's *inside* each book isn't checked; this module treats the document as an opaque blob it stores and returns, not something it understands the internals of.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/library` | ✓ | `{data, updatedAt, shareToken, shareUrl}`, or `404` if this account hasn't saved one yet |
| PUT | `/library` | ✓ | `{data: {...}}` → stores it (replacing any previous document) and echoes back `{data, updatedAt, ...}` |
| POST | `/library/share` | ✓ | Mints a share token (idempotent — an already-shared library keeps its existing token, so retries never invalidate a link someone already has) and returns the document with `shareUrl` pointing at the frontend's `/shared/library/:token` page. `404` if nothing's saved yet |
| POST | `/library/unshare` | ✓ | Revokes the token; the shared route immediately `404`s for it |
| GET | `/library/shared/:token` | — | The public, redacted view (`toPublicLibraryData` — highlights and other private per-book data never leave the server). A LIVE view of whatever the owner currently holds, so `Cache-Control: no-store`, and its own tight rate limit in a separate scope. Same "unguessable random UUID" trust model as `gallery`'s file route |

Each account only ever sees its own document — verified in testing with two separate accounts. One cosmetic thing worth knowing: the top-level key *order* of what you `PUT` isn't guaranteed to match what a later `GET` returns (the validation library reorders keys during parsing). The values are always identical — this only affects raw string/byte comparison of the JSON, never anything that actually parses it.

"Auth required" means: `Authorization: Bearer <accessToken>`.

### `gallery`
- **A per-account pool of uploaded images**, primarily meant to be assignable as custom book covers by the [frontend](../frontend/README.md#gallery-and-custom-book-covers) — but the module itself is generic; it doesn't know anything about books.
- Unlike `library`, this module does NOT treat uploads as an opaque blob it just stores — every upload goes through a real validation/normalization pipeline before anything is trusted:
  1. **Size cap** (20 MB) — checked twice: `@fastify/multipart`'s own `fileSize` limit aborts an oversized upload stream before it's even fully buffered, and `service.ts` re-checks the buffered size as a backstop.
  2. **Real-format sniff, not the client's word for it** — `sharp(buffer).metadata()` reads the file's actual header. The client-supplied MIME type and the original filename's extension are never trusted; a non-image or corrupt file fails here with `422`.
  3. **Input dimension cap** (8000×8000) — guards against a decompression-bomb-style file: small on disk, huge once decoded, which would otherwise be an easy way to spike server memory/CPU with one request.
  4. **Re-encode to a fixed output** (WebP, quality 85, capped at 1600px on the long edge — a book cover is never usefully bigger) — this is also what strips ALL metadata: EXIF, GPS, ICC profiles. `sharp` only preserves that if the code calls `.withMetadata()`, which nothing here does, so it's dropped by default, not by an explicit strip step. `.rotate()` (no args) applies the EXIF orientation tag *before* that tag is discarded, so a photo taken sideways doesn't end up permanently sideways.
  5. **Per-account storage quota** (500 MB) — checked against the account's current total both before the (comparatively expensive) re-encode, so an already-over-quota account fails fast, and again after, against the real re-encoded size.
- **Stored under a server-generated id**, never the original filename — the object key is `gallery/<id>.webp`, built only from a `randomUUID()` (server-controlled), so there's nothing attacker-influenced in the key at all; the original filename is kept only as display metadata in the DB row. The file lives in the object store (see [Stored files](#stored-files)); a failed save creates no row.
- **The image URL is deliberately NOT behind `authGuard`** — `GET /gallery/:id/file` now just `301`s to the object-store URL, which every `GalleryImage.url` already points at. It needs to work as a plain `<img src>` with no `Authorization` header attached, the same trust model this app already has for the Kobo CDN / Open Library cover URLs the frontend loads directly. Access control here is "the id is an unguessable random UUID," not a session check. Every other route (`list`/`upload`/`delete`) IS auth-gated and scoped to `request.user.id`.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/gallery` | ✓ | `{images: GalleryImage[]}` for the caller's own account |
| POST | `/gallery` | ✓ | `multipart/form-data`, one `image` field → `{image}`, `201`. `413` if the file or the account's quota is too large, `422` if it's not a valid/acceptable image |
| DELETE | `/gallery/:id` | ✓ | `204`, or `404` if no such image is owned by the caller |
| GET | `/gallery/:id/file` | — | `301` to `gallery/<id>.webp` in the object store, which serves the re-encoded bytes with `Cache-Control: immutable` (the output never changes post-upload). Kept so URLs stored before the move keep working |

Rate-limited (30 requests/minute, scoped to this module's routes only) and given its own SQLite file (`GALLERY_DB_PATH`) and its own object-store instance (the shared `src/storage/` infrastructure, keys under `gallery/`) — same module-isolation convention as everything else here.

### `books`
- **The book catalog** — one row per book, keyed by ISBN when there is one, else by a normalized title+author pair (`book_keys`: `isbn:<isbn>` or `ta:<title>|<author>`). Any account that looks a book up stores it once, in `books` (title, author, year, publisher, ISBN, summary, rating, rating count, genres) and `cover_images` (each stored cover: `source`, `source_url`, dimensions, byte size). Absorbed the old `covers` module — same SQLite file (`COVERS_DB_PATH`), so nothing already stored moves and no `/covers/*` URL changes (the cover files themselves are in the object store now, and the old route redirects).
- **Covers, exact edition first, from the sources of the lane the book runs on** (below). A same-book, other-edition match (title + author, normalized) is tried next, in the same source order, if the exact edition doesn't reach 400px wide. Portrait images only (height 1.2–1.9× the width); ISBNdb's 200×248 "no cover" placeholder and any URL already recorded in `cover_rejections` are skipped. If nothing reaches 400px, the largest acceptable image is kept as `low_res`; if nothing is acceptable, the book is `missing`. Both retry after 30 days; a `manual` (admin-uploaded) cover is never replaced or retried. A source that fails outright (timeout/429/5xx) doesn't count as a checked miss, and gives the book a 10-minute in-memory backoff so a flaky source isn't hammered by polling clients.
- **One background worker** resolves covers — a plain in-process queue (no job queue), deduplicated by book id, up to three books at a time (`SLOTS` in `worker.ts`; a book is never processed twice concurrently), throttled per source (ISBNdb 1.1s apart, Apple 3.2s, Open Library 1s). A throttle is a FIFO with a second, urgent lane: the catalog (`GET /books/details`, search) queues in the urgent lane and runs before any queued cover lookup, still after the source's minimum gap. `GET /covers/resolve` reads the database only and answers immediately with `{url, fullUrl, pending}`, enqueuing the book on the front lane if it has nothing to show yet (a book inside its 10-minute source backoff also answers `pending: true`, and is retried once the backoff ends); clients poll `POST /covers/resolve/batch` while `pending` is true. A `PUT /library` with `source: "import"` queues every book on the normal lane, so covers start before any cell renders.
- **Four lanes, and which sources each one asks.** A free slot always takes from the highest lane with anything waiting: `front` (a user is looking at the book), `normal` (a library import), `upgrade`, `background` (the seed and the backfill). The two Apple lanes, upgrade and background, together run one lookup at a time, so Apple's 3.2 s throttle never holds up a user's book; a background book is promoted to the front or normal lane when a user resolves or imports it, and an upgrade book to the front lane when a user resolves it. The sources are per lane (`sourcesFor` in `booksService.ts`): `front` and `normal` ask ISBNdb → Open Library and never Apple; `upgrade` asks Apple only; `background` asks Apple → ISBNdb → Open Library.
- **Apple upgrades the covers a user got without it.** When a `front` or `normal` lookup finishes, the book is marked as wanting an upgrade, `books.cover_upgrade_wanted_at`, if its cover isn't `good` (under 400px or `missing`), or if ISBNdb supplied it for a Portuguese ISBN (`isPortugueseIsbn`: `978-85`, `978-65`, `978-972`, `978-989`, or the ISBN-10 equivalents), and is queued on the upgrade lane. The `upgrade` lookup replaces the cover only when Apple's is wider, or when it's at least 400px and the current cover is ISBNdb's for a Portuguese ISBN, since those carry a watermark; either way it clears the mark once Apple's answer is complete, and a failed lookup keeps it. An upgrade requested while the book is being processed is remembered and runs right after it, and a front request meanwhile wins over it. The queue lives in memory, so a deploy drops it; on boot, and again every 10 minutes (`startBackfill`, `backfill.ts`), the plugin re-queues every book whose cover was never checked (`cover_image_id` and `cover_status` both null), oldest first, on the background lane, and every book with `cover_upgrade_wanted_at` set on the upgrade lane, each queued once. A book already being processed only re-runs if it's re-enqueued on the front lane (the admin reject flow, below) — an ordinary resolve during processing just waits on the result already in flight.
- **Every stored cover is two objects** in the object store, `covers/<id>.webp` and `covers/<id>-thumb.webp` (see [Stored files](#stored-files)); the old `GET /covers/cached/:id/:size` (`size` is `file` or `thumb`) now `301`s to them. The full image (≤1600px, WebP quality 85) and a thumbnail (≤600×900, quality 80) used everywhere except the book detail views. Images are never deleted or overwritten — a better cover adds a new `cover_images` row and moves the book's pointer, so a URL already handed out keeps serving. A cover is saved to the store before its `cover_images` row, so a failed upload leaves no row pointing at nothing.
- **Details and search are cached the same way.** `GET /books/details` returns stored details, or — the first time, or again once a `missing` result is more than 30 days old — runs Open Library's search-then-work lookup and stores whatever it finds (or records the miss). When `ISBNDB_API_KEY` is set and the book has an ISBN, ISBNdb (`GET /book/{isbn}`: synopsis and subjects) fills the summary and genres Open Library left empty, or supplies the whole record when Open Library found nothing, with `source_url` `https://isbndb.com/book/<isbn13>` (Open Library's rating, rating count and `source_url` are kept when it found the book). `books.data_sources` is a JSON array of the sources whose data ended up in the row's details and genres (`["openlibrary"]`, `["isbndb"]` or both), and of the source of the search hit that created the row; rows that predate it, and rows only a cover created, have `[]`. It is added to an existing database on boot. Covers keep recording theirs in `cover_images.source`. A source that fails outright doesn't hide the other's answer, and a miss isn't recorded when a source was unavailable. `GET /books/search` is the **inside** search and never calls Open Library: a saved book matching an ISBN query, or every token of a free-text query matching an FTS5 index of saved titles/authors, or `[]`. `GET /books/search/external` is the **outside** search: it always calls Open Library (an exact `isbn=` lookup for an ISBN query, free text otherwise) and saves every result under its own key, so the next inside search finds it. With `ISBNDB_API_KEY` set, an ISBN query asks ISBNdb first and Open Library only if ISBNdb finds nothing, and a text query asks both in parallel: the two lists are interleaved (Open Library first), repeats dropped, capped at 12 in all. Clients call both on every submit and merge the lists. Search only ever answers from saved external search results, plus an exact ISBN a saved book already has — a book that only exists because some account resolved its cover or details (a sideloaded personal document included) is never indexed, so one account's library can never surface in another's search.
- **`ISBNDB_API_KEY`** (optional) enables the ISBNdb cover step (the first source for users' covers) and ISBNdb's part in details and external search (one throttle, 1.1 s apart, shared by all three, since ISBNdb's limit is per key; the two catalog uses take its urgent lane); unset, they just skip it, the same as `HARDCOVER_API_KEY` used to. **`ADMIN_USER_ID`** (optional, an account id rather than an email — an unclaimed email could be signed up by anyone) names the one account allowed to fix a shared cover: `POST /books/cover/reject` clears the book's cover, records its source URL so it's never picked again, and re-queues the book at the front of the worker; `PUT /books/cover` uploads a replacement through gallery's own validation pipeline and marks the book `manual`. Both `403` for any other account.
- **ISBNdb's terms require deleting its data if the subscription lapses.** First, unset `ISBNDB_API_KEY` so the chain stops calling it. Then delete the actual image files too, not just the rows: the bucket serves `covers/<id>.webp`/`covers/<id>-thumb.webp` publicly with no database check, so removing only the rows would leave those files still directly fetchable. Concretely: list the affected ids (`SELECT id FROM cover_images WHERE source = 'isbndb'`), delete each id's `covers/<id>.webp` and `covers/<id>-thumb.webp` object from the `atmyshelf-images` bucket (Cloudflare dashboard or `aws s3 rm` against `R2_ENDPOINT`), clear the pointers (`UPDATE books SET cover_image_id = NULL, cover_status = NULL, cover_checked_at = NULL WHERE cover_image_id IN (…)`), then delete the rows (`DELETE FROM cover_images WHERE source = 'isbndb'`) — the affected books re-resolve from Apple/Open Library on their next view. Deleting an object doesn't remove it from Cloudflare's edge cache until it's evicted, so also purge those URLs in the Cloudflare cache (a cache rule caps the edge TTL for `/gallery/*` and `/avatars/*`, which bounds it for those two prefixes only). Details and search results count too: every row tagged with ISBNdb in `books.data_sources` (details ISBNdb supplied or filled in, or a row an ISBNdb search hit created) is cleared so it re-resolves from Open Library on its next view: `UPDATE books SET summary = NULL, genres = '[]', details_status = NULL, details_checked_at = NULL, source_url = NULL, data_sources = '[]' WHERE EXISTS (SELECT 1 FROM json_each(books.data_sources) WHERE value = 'isbndb')`. A row an ISBNdb search created keeps its title, author, ISBN, year and publisher, which are bibliographic facts.
- **Rate limits**: `GET /covers/resolve` and `POST /covers/resolve/batch` 1200/min; `GET /books/details`, `GET /books/search` and `GET /books/search/external` 300/min, shared, so one search costs two; the two admin cover routes (`POST /books/cover/reject`, `PUT /books/cover`) 30/min; the `GET /covers/cached/:id/:size` redirect has no limit of its own.

| Route | Auth | Response |
|---|---|---|
| `GET /covers/resolve?isbn=&title=&author=` | ✓ | `{url, fullUrl, pending}`; 400 without isbn and title |
| `POST /covers/resolve/batch` | ✓ | Body: up to 100 `{isbn?, title?, author?}` lookups → `{results}` in the same order, each shaped like the single route; 400 if any lacks isbn and title |
| `GET /covers/cached/:id/file`, `/thumb` | — | WebP bytes, `Cache-Control: public, max-age=31536000, immutable`; 404 unknown; 400 non-UUID |
| `GET /books/details?isbn=&title=&author=` | ✓ | `{metadata}`; 502 `{error: "Book information is unavailable."}` |
| `GET /books/search?q=` | ✓ | Inside, saved books only: `{results}` |
| `GET /books/search/external?q=` | ✓ | Outside, Open Library (plus ISBNdb when configured), results saved: `{results}`; 502 `{error: "Search is unavailable right now — try again."}` |
| `GET /books/admin` | ✓ | `{isAdmin}` |
| `POST /books/cover/reject` body `{isbn?, title?, author?}` | ✓ admin | `{url, fullUrl, pending}`; 403; 404 |
| `PUT /books/cover?isbn=&title=&author=` multipart `image` | ✓ admin | `{url, fullUrl, pending}`; 403; 404; 413; 422 |

#### Seeding the catalog

`scripts/seed-catalog.mjs` builds the ranked launch list (35,000 English and 5,000 Portuguese works from Open Library's reading-log ranking, `--eng` and `--por` override the counts) and inserts a catalog row for each. It runs inside the production container from `/app/backend`, on the compiled `dist`, never on a dev machine. The rows have no cover yet; the periodic backfill queues them on the background lane, behind every user's lookups.

Start it detached, logging to `/data`:

```bash
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && nohup node scripts/seed-catalog.mjs > /data/seed-catalog.log 2>&1 & echo started'
```

Check progress (log tail plus cover counts by status):

```bash
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'tail -3 /data/seed-catalog.log; cd /app/backend && node scripts/seed-catalog.mjs --status'
```

- **Rerunning is safe.** Rows are created by catalog key, so a rerun after a crash or a deploy skips the existing books and counts them. Entries that fail are logged and counted without stopping the run.
- **ISBNdb gate.** Run the seed only after the ISBNdb trial verdict. If the subscription isn't taken, remove `ISBNDB_API_KEY` first, so no trial-licensed covers are stored (see the terms note above); if it is, the key stays and ISBNdb only fills what Apple Books lacks.
- **Pace.** Covers fill at roughly 1,000–3,000 books an hour, bound by Apple's rate limit and the one-at-a-time Apple lanes, so the full list takes one to two days.

#### Known limitations of covers, details and search, and the options for each

Measured on production on 2026-09-30, after a tester imported a 167-book library and waited about 20 minutes for covers. The server itself was never slow: `/covers/resolve` p50 was 1 ms and `PUT /library` about 5 ms. The time goes into the pipeline around it. Recheck the numbers below before relying on them.

- **External rate limits bound throughput.** The worker runs three books at once, but each source's throttle still serializes its own calls, so the gain comes from different books using different sources at the same time; it is not three times the rate of any one source. A user's import now runs on ISBNdb → Open Library, so it is bound by ISBNdb's plan rate (about 1 request a second on the cheapest plan, so at least about 18 minutes per 1,000 uncatalogued books: an exact-edition ISBNdb cover under 400 px costs a second ISBNdb call by title, and catalog and details lookups share the same throttle), not by Apple; Apple's rate bounds only the upgrades and the seed, which run behind it. Apple's storefront order follows the ISBN's registration group (Brazilian `978-85`/`978-65` try br, pt, us; Portuguese `978-972`/`978-989` try pt, br, us; English `978-0`/`978-1` try us only; anything else, and every title search, try us, pt, br), stopping at the first storefront with hits, so a book Apple doesn't have costs one 3.2 s call if it is English and three otherwise. The old "about 4–10 s per unknown book" estimate predates these changes; the ISBNdb figure comes from the plan's published rate and hasn't been re-measured on an import.
  - *Options:* a pricier ISBNdb plan for a higher rate; without `ISBNDB_API_KEY`, users' covers come from Open Library alone until Apple upgrades them; remeasure an import before adding more slots or trimming storefronts further.
- **Genre and details lookups compete with covers.** `GET /books/details` is synchronous and shares the Open Library throttle (1 s) with the cover worker's title searches, and the ISBNdb throttle with its cover lookups. A separate throttle would have doubled the request rate to each service and broken its per-client or per-key limit, so the catalog instead takes the throttle's urgent lane: it jumps ahead of queued cover lookups but still waits out the minimum gap, so it is delayed by at most one in-flight call plus the gap, however many covers are queued. Mobile's genre enrichment (`useGenreEnrichment`) runs 20 books per batch, 4 at a time, and saves the whole library after each batch. That's at least 5 minutes for 150 books. If every lookup in a batch fails, enrichment stops until the hook remounts. Enrichment's own calls are all urgent, so they also queue FIFO behind each other and behind other users' catalog calls.
  - *Options:* skip the work lookup when the search result already has the subjects.
- **The catalog is small, so a new user mostly misses it.** On 2026-09-30 it held 246 books, 111 with covers. The tester's 167 books were 167 of those 246, so almost nothing was already there for them. 54 of the 167 had no ISBN, so they could only match by title + author.
  - *Seeding:* `scripts/seed-catalog.mjs` loads the ranked launch list (see below); the backfill then fills the covers on the background lane. Apple's rate limit allows about 1,000 books an hour. Open Library's bulk data (CC0) could fill genres without any network calls.
  - *Blockers:* none on storage. Cover files live in the R2 bucket, not on the Railway volume, so seeding at scale adds no volume usage (Litestream backs up only the SQLite files). Measure first how many of a new user's books the catalog already has: a read-only script against `COVERS_DB_PATH`/`LIBRARY_DB_PATH` over `railway ssh`, using `seedCoverLookup` + `lookupIdentity` to compute keys.
- **Matching is an exact key.** It's either `isbn:<isbn>` or a normalized `ta:<title>|<author>`. Kobo titles such as "Wool Omnibus (Silo, #1)" miss a catalog entry saved without the series suffix.
  - *Option:* normalize series suffixes out of titles. The risk is false matches between different books.
- **Search is split into inside and outside.** A single local-first endpoint only reached Open Library on zero local hits, so "Dune" returned just a saved *Dune Messiah*. `GET /books/search` (saved books) and `GET /books/search/external` (Open Library) are now separate, and clients run both and merge, so a partial local match can't hide the catalog.
  - *Decided 2026-09-30: every text search always calls Open Library too.* Inside matches words, so an inside hit doesn't mean the searched book is saved: "Dune" finds a saved *Dune Messiah* and not *Dune*. The cost is one Open Library request per search, even when the saved result was the right one, and those requests also grow the catalog. Only an ISBN query that inside already answers skips outside, because an ISBN identifies one book.
  - *Rejected alternatives:*
    - **Outside only on demand:** automatic when inside is empty, otherwise a "Not here? Search more" row. No wasted requests, but a user who misses the row thinks the book doesn't exist.
    - **Skip outside on an exact inside title match:** fails when several books share a title ("It", "Emma").
  - *Revisit if* outside becomes metered (ISBNdb is paid per request; with a key set, every text search also spends one, and details spend one for each book Open Library left incomplete), or if the 300/min catalog limit, shared by details, inside and outside, starts to bind.
  - *Known quirk:* results are inside first, then new outside rows appended. The best match can therefore sit below a weaker saved one until someone adds ranking, e.g. exact title matches first once outside lands.
- **The client stops waiting after 30 minutes.** The shared resolver (`packages/shared/src/library/coverResolver.ts`) gives up on a cover after 30 minutes without caching the miss. For an import that takes longer than that, the remaining covers appear the next time their cell mounts.

### `socials`
- **Connects X/Instagram/Threads/TikTok/Bluesky to an account**, one row per `(user, platform)`, so a later feature (not built yet — see "Not built") can act on the user's behalf. Asked for as: *"we should define socials, which will be a list of socials such as tiktok, threads, X, instagram, etc and those items should be enabled or disabled, when trying to enable it requires that the user makes an auth so we can save a key."* This module is deliberately scoped to exactly that: the connect/disconnect handshake and encrypted storage. Nothing here posts, reads, or otherwise calls out to a connected platform beyond the one profile lookup made right after connecting (to show "Connected as @handle").
- **Four real OAuth2 connections, one very different fifth one.** X/Instagram/Threads/TikTok each need the person deploying this to register a real developer app on that platform and drop a client id/secret/callback URL into `.env` — exactly the same "optional, quietly skipped if blank" shape `GOOGLE_CLIENT_ID`/`SECRET` already has in `auth` (`GET /socials` still lists a not-configured platform, just with `enabled: false`; its connect routes simply aren't registered — see the boot log for `[socials] X client id/secret/callback URL not set`). Bluesky is the odd one out: AT Protocol's real OAuth is per-repo and DPoP-bound, more than a personal project's "connect an account" needs, so Bluesky is connected with a handle + **app password** instead (generated by the user at Bluesky's own Settings → App Passwords, never their real account password) — verified live against Bluesky's real `com.atproto.server.createSession` endpoint, both the failure path (a fake handle/password pair correctly rejected with `401`, surfaced in Settings as *"That handle/app password combination was rejected by Bluesky"*) and, with a manually-seeded row standing in for a real successful session, the success path (`Connected as @handle` renders, and disconnecting really deletes the row).
- **A worked-example caveat, stated plainly rather than glossed over**: Instagram/Threads/TikTok's exact authorize/token endpoints, scopes, and profile-response shapes in `providerConfig.ts` are a correct-as-of-this-writing starting point, not something exercised against a real developer app — nobody has real credentials for any of the three yet, and each platform's own OAuth product does shift over time. X is the most standard of the four (built on `@fastify/oauth2`'s own `X_CONFIGURATION` preset) and least likely to need adjustment. The first real connect attempt once credentials exist is the actual test for each platform; see "Not built."
- **No session cookie exists to bind an OAuth redirect back to a user** — this backend is pure Bearer-token auth (see `auth` above), but starting an OAuth flow means a top-level browser navigation to the platform's own site, which can't carry an `Authorization` header. Solved with a short-lived, single-use **link session**: `POST /socials/:provider/link-session` (a normal authenticated call) mints a `linkId` tied to `request.user.id` and expiring in 10 minutes; the frontend then navigates the browser to `GET /socials/:provider/connect?linkId=...`, which hands that `linkId` to `@fastify/oauth2` as the OAuth `state`. The library still independently round-trips that same value through its own signed cookie and checks it back on callback (`defaultCheckStateFunction`, untouched) — so CSRF protection is exactly as strong as Google's login flow already gets in `auth`; the link session only adds "and it's bound to OUR user," not a replacement for that check. See `linkSessions.ts`'s own top comment for the full design.
- **Every token is encrypted at rest** (AES-256-GCM, `crypto.ts`), gated behind `SOCIALS_ENCRYPTION_KEY` — unlike a password (hashed one-way in `auth`, never needed back in plaintext), a platform's access token has to come back out in the clear to ever actually call that platform's API on the user's behalf, so a hash can't do the job here; real (reversible) encryption is genuinely new to this backend. Leaving the key unset doesn't just skip one platform the way a blank client id/secret does — it disables every platform's write path, Bluesky included, since Bluesky's only "configured" gate is that key.
- **Disconnecting asks for confirmation and deletes the stored row** — the frontend's confirm dialog reads *"Scripta will delete the [platform] access token it has stored. You'll need to reconnect and re-authorize to use it again."* This module does not additionally call the platform's own revoke endpoint before deleting; see "Not built" for why that's a stated gap rather than an assumed one.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/socials` | ✓ | `{socials: SocialStatus[]}` — one entry per platform, always, whether or not this server has credentials for it (`enabled`) or the caller has connected it (`connected`, `handle`, `connectedAt`) |
| POST | `/socials/:provider/link-session` | ✓ | X/Instagram/Threads/TikTok only. `{linkId}` — pass as `?linkId=` to the `connect` route below. `503` if that platform isn't configured |
| GET | `/socials/:provider/connect` | — | Only registered for a configured platform (see above). Redirects to that platform's own consent screen |
| GET | `/socials/:provider/callback` | — | The platform redirects here. Ends by redirecting the browser to `SOCIALS_SUCCESS_REDIRECT_URL?social=<provider>&social_status=connected\|error` — no tokens ride this redirect, unlike `auth`'s Google callback; the frontend just re-fetches `GET /socials` |
| POST | `/socials/bluesky/connect` | ✓ | `{handle, appPassword}` → verifies against Bluesky's own API and stores the session on success; `401` on a rejected handle/password, `503` if `SOCIALS_ENCRYPTION_KEY` isn't set |
| DELETE | `/socials/:provider` | ✓ | Deletes the caller's stored connection for that platform (a no-op, not an error, if it wasn't connected) → `{socials: SocialStatus[]}` |

### `arena`

- **BookArena**: an owner-created, single-elimination book bracket tournament that anyone with the link can vote on, no account required — the account's library seeds the bracket (random-fill or manual per-slot assignment), and once started, duels settle on a timer (a background sweep, checked every 30s) or via the owner's early-settle action; a tied duel (equal votes) waits for the owner to break it by hand rather than auto-deciding.
- **Its own SQLite file** (`ARENA_DB_PATH`), same one-module-one-database isolation as every other module — `tournaments`/`tournament_slots`/`duels`/`votes`, with seeded books denormalized as a snapshot (title/author/cover) rather than referencing a shared Book table, since none exists anywhere in this app (see `library`'s own section above).
- **The first background timer in this codebase** — a plain `setInterval` sweep, no job queue: the simplest thing that could work at this app's scale, same "no new dependency for something this small" instinct as `node:sqlite` itself.
- **This repository's first automated test suite** (`backend/src/modules/arena/service.test.ts`, via Node's built-in `node:test` — zero new dependencies) exercises the bracket/duel/round state machine against a hand-written in-memory fake of `ArenaRepository`, finally using the "seam is there" testability this hexagonal split has always had (see "Not built," below).

### `murals`

- **Per-account freeform dashboards** — the backend half of the frontend's Murals feature (see the [frontend README](../frontend/README.md)'s "Murals" section for what a mural *is*: ten block types, the snap-to-grid canvas, tier lists, the lot). A `Mural` is `{id, name, blocks, coverImageId?, coverImageUrl?, shareToken, shareUrl, createdAt, updatedAt}`; each mural's `blocks` are stored as one opaque JSON blob, the same "the module stores and returns the document without understanding its internals" stance `library` takes — all block-type semantics live in the frontend's `lib/murals.ts`.
- **Cover assignment from the gallery pool** — `PUT`/`DELETE /murals/:id/cover` set/clear a mural's card cover the same way `setBookCover` does for a book, so the same gallery-image deletion scrubbing applies (`scrubImageFromMurals` on the frontend; the cover fields just clear here).
- **Public share links, same shape as `library`'s** — `POST /murals/:id/share` mints an unguessable UUID token (idempotent, like `library`'s); `POST /murals/:id/unshare` revokes it. `GET /murals/shared/:token` is the public, unauthenticated view — registered in its own scope with its own tight rate limit, `Cache-Control: no-store` (a live view, unshareable at any moment), and block/book references resolved server-side into redacted public shapes (no highlights, no private book fields).
- **Nested mural folders** — a `mural_folders` adjacency list (`parent_id`) plus a nullable `folder_id` on each mural. Deleting a folder splices its children and murals up one level (never deletes content); moving a folder into itself/descendants is rejected. Folders never surface on the public share view.
- **Its own SQLite file** (`MURALS_DB_PATH`), same one-module-one-database isolation as every other module.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/murals` | ✓ | `{murals: Mural[]}` for the caller's account |
| POST | `/murals` | ✓ | `{name}` → `{mural}`, `201` |
| GET | `/murals/:id` | ✓ | `{mural}`, or `404` |
| PUT | `/murals/:id` | ✓ | `{name?, blocks?}` (at least one) → `{mural}` |
| DELETE | `/murals/:id` | ✓ | `204`, or `404` |
| PUT | `/murals/:id/cover` | ✓ | `{imageId, url}` (a gallery image and its served URL) → `{mural}` |
| DELETE | `/murals/:id/cover` | ✓ | clears the cover → `{mural}` |
| POST | `/murals/:id/share` | ✓ | mints/reuses the share token → `{mural}` carrying `shareUrl` |
| POST | `/murals/:id/unshare` | ✓ | revokes it → `{mural}` |
| GET | `/murals/shared/:token` | — | the redacted public view (see above); `404` for unknown OR unshared tokens, indistinguishably |
| GET | `/murals/folders` | ✓ | `{folders: MuralFolder[]}` for the caller's account |
| POST | `/murals/folders` | ✓ | `{name, parentId?}` → `{muralFolder}`, `201` (400 if parentId isn't yours) |
| PUT | `/murals/folders/:id` | ✓ | `{name? \| parentId?}` at least one (`parentId: null` = root) → `{muralFolder}` (400 on cycle) |
| DELETE | `/murals/folders/:id` | ✓ | children/murals splice up one level → `204`, or `404` |

### `tierlists`

- **One tier list through its full lifecycle** — an account can edit a private tier list. Publishing adds a vote code to that same row and freezes its name, tiers, pool, and book details. The creator can manage voting and delete it until promotion. At 100 distinct signed-in, noncreator ballots with at least one placement, it becomes an app-owned permanent reference. The origin creator remains attributed; the creator can no longer edit or delete it.
- **Two vote access modes and their guarantees about deduplication**:
  - **Anonymous**: anyone with the link can vote; no account required. Behind the scenes, a `ballotId` is stored in the voter's browser `localStorage` and sent with their next submission, so a return visit edits that same ballot instead of casting a second one. **The honest limitation**: an anonymous ballot is deduped only by the browser-held id, so the vote counts are a vibe poll, not an election. A person with two browsers or cleared `localStorage` each counts as a separate voter.
  - **Members-only**: requires an account (`user.id`) to vote. One vote per account, deduped by user id across all devices and browsers. A genuine community consensus measure, not browser-dependent.
- **Three aggregation modes, computed from a vote histogram** (per-book × per-tier vote counts; the size depends on pool/tier count but not voter count):
  - **Average** (`average`): mean tier index per book (0 = top tier). Ties break toward the higher tier. Books unranked by everyone score `null` and drop to the bottom.
  - **Most-voted** (`plurality`): whichever tier got the most votes for that book. Ties break toward the higher tier. Most aligned with "which tier do voters most agree on."
  - **Median** (`median`): the middle-ranked tier when walking voters' ballots in tier order. Ties break toward the higher tier (for an even vote split, stops at the higher half's tier, not the lower).
- **The voting board** (`getVotingBoard`) resolves a public tier list by its vote code: name, frozen tiers and pool, access mode, open/closed state, ballot count, and the histogram (per-book vote counts in each tier). The public route withholds that histogram while voting is open; a voter gets the current tally back with their own ballot, and the owner reads it through `GET /tierlists/:id/results` until promotion.
- **The public directory** (`GET /tierlists/public`) lists published tier lists with vote code, name, pool size, ballot count, and promotion status. Links route to `/vote/:code`.
- **A ballot is exactly what the voter placed** — anything still in the pool (unranked books) is recorded as "no opinion" for that book. Results carry per-book vote counts, never per-book response rates, so the same three aggregation modes work regardless of which books each voter ranked.
- **Its own SQLite file** (`TIERLISTS_DB_PATH`), same one-module-one-database isolation as every other module.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/tierlists` | ✓ | `{tierlists: Tierlist[]}` for the caller's account |
| POST | `/tierlists` | ✓ | `{name, data?, access?}` → `{tierlist}`, `201`. Omit `data` for default tiers; `access` publishes immediately and requires a nonempty pool |
| GET | `/tierlists/:id` | ✓ | `{tierlist}`, or `404` |
| PUT | `/tierlists/:id` | ✓ | `{name?, data?}` (at least one) → `{tierlist}`. Published lists reject both edits |
| DELETE | `/tierlists/:id` | ✓ | `204`, or `404` |
| POST | `/tierlists/:id/open-voting` | ✓ | `{access: "anonymous" \| "members"}` → publishes the same tier list and seeds the owner's existing ranking as a ballot, `201 {tierlist, voteCode}` |
| PUT | `/tierlists/:id/voting` | ✓ | `{access?, open?}` (at least one) → `{tierlist}` for an owned, published, unpromoted list |
| GET | `/tierlists/:id/results` | ✓ | `{histogram: HistogramCell[], ballotCount: number}` for the published list's owner until promotion |
| POST | `/tierlists/:id/share-video` | ✓ | Multipart `image` (PNG of any shape, up to 4 MB; scaled to fit and centred on a 1080×1920 canvas padded with its top-left pixel colour) → `{base64}` containing a six-second MP4 for the published list's owner. `400 {error}` for a missing, oversized or non-PNG image, `500 {error}` if ffmpeg fails |
| GET | `/tierlists/public?limit=50&offset=0` | — | `{tierlists: PublicTierlistSummary[]}` listing published tier lists, newest first; `limit` 1–100 (default 50), `offset` for pagination |
| GET | `/tierlists/voting/:code` | — | The public voting board, nested: `{board: {name, tiers, pool, access, votingOpen, ballotCount, eligibleVoteCount, promotedAt, histogram?}, books}`. `histogram` is present once voting is closed. `books` come from the snapshot taken at publication. `404 {error}` for an unknown code |
| POST | `/tierlists/voting/:code/ballot` | — | `{placements: [{bookKey, tierId}, ...]}` → creates or replaces a ballot (by user id if the request carries a token, else by the browser-held ballot id). Success is `{ballotId, placements, results: {histogram, ballotCount}}` — the service's internal `BallotOutcome` union is never serialized. Rejections are `{error}` at `404` (unknown code) / `409` (voting closed) / `401` (members-only, no token) / `400` (placements outside the frozen structure) |
| PUT | `/tierlists/voting/:code/ballot/:ballotId` | — | Same validation, same success/failure shapes as POST; for UI simplicity `PUT` is also allowed (the backend resolves both to an edit of the existing ballot, never creating duplicates) |
| GET | `/tierlists/voting/:code/ballot/:ballotId` | — | `{ballotId, placements, results}` for the voter to see their current ballot; same voter-identification as POST/PUT (token if present, else the browser-held id). `404 {error}` if that voter has no ballot |

### `waitlist`

- **Exactly one thing**: an email address and when it was submitted, for the landing page's "Notify me when Atmyshelf launches" form. No accounts, no relation to any other module.
- **No enumeration and no read route over HTTP** — `POST /waitlist` always answers `204` for any address that passes validation, whether it's brand new or already on the list (insert-or-ignore on the unique `email` column), so the response never reveals whether an address was already signed up. There's no `GET`/list endpoint either.
- **One confirmation email per address** — the first time an address is stored (the insert actually added a row), the module sends a short "you're on the launch list" email through the same Resend sender `auth` uses, handed in from `app.ts`. The route doesn't wait for the send, so a new and an already-listed address get the same `204` at the same speed; re-submitting never sends a second email. A send failure is logged (`[waitlist] confirmation email failed`) and the signup still stands. With email unconfigured (no `RESEND_API_KEY`/`AUTH_EMAIL_FROM`, or a non-HTTPS `FRONTEND_URL`) the module warns at boot and stores signups without confirming them.
- **Exporting is a command, not a route** — the list is only readable from a shell on the machine that holds the database, so nothing new is reachable from the internet. On Railway, from a shell in the backend service (`railway ssh`):

  ```bash
  npm run -s waitlist:export --workspace backend > waitlist.csv
  ```

  It runs the built backend (`dist/`), resolves `WAITLIST_DB_PATH` exactly as the server does, prints `email,created_at` CSV oldest first to stdout, and reports the count and the database path it read on stderr. Keep `-s`: without it npm prints its own banner into the CSV.
- **Stored beside the accounts database** — `WAITLIST_DB_PATH` defaults to `waitlist.sqlite` in the same directory as `AUTH_DB_PATH`, not to `./data`. Accounts already have to live on the deployment's persistent disk, so the launch list inherits that location without a separate volume or env var and survives redeploys. Set `WAITLIST_DB_PATH` to put it somewhere else.
- **Open route, its own rate limit** — no `authGuard` (anyone visiting the landing page can join), so it gets a tight per-IP limit (5 requests/minute, this module's own `@fastify/rate-limit` scope) against script abuse, the same shape every other unauthenticated write route in this app uses (e.g. `arena`'s vote route).

| Method | Path | Auth required | Notes |
|---|---|---|---|
| POST | `/waitlist` | — | `{email}` → `204` for any syntactically valid address (trimmed, lowercased, max 254 chars), new or already listed. `400 {error, field: "email"}` if invalid or missing. `429` past the rate limit |

## Stored files

Every stored image (book covers, gallery uploads, avatars) lives in one object store, `src/storage/`: shared infrastructure like `src/config/`, not a module. Each module builds its own instance in its `plugin.ts` and keys its own prefix; modules never import each other's storage code. The Railway volume holds only the SQLite databases.

| Key | What |
|---|---|
| `covers/<id>.webp` | a book's full-size cover (≤1600px) |
| `covers/<id>-thumb.webp` | its thumbnail (≤600×900) |
| `gallery/<id>.webp` | a gallery upload, re-encoded |
| `avatars/<id>.webp` | an avatar, 256×256 |

Keys are flat and account-free; `<id>` is the server-generated UUID. Every object is uploaded with `Content-Type: image/webp` and `Cache-Control: public, max-age=31536000, immutable`: ids are never reused, so a cached copy is never stale. The flip side: a deleted object stays in Cloudflare's edge cache until evicted, so deleting under a licence or privacy obligation also means purging those URLs in the Cloudflare cache. A cache rule caps the edge TTL for `/gallery/*` and `/avatars/*`, so those age out on their own.

- **Two implementations, picked at boot by `R2_IMAGES_BUCKET`.**
  - *Set:* Cloudflare R2 over the S3 API (signed with `aws4fetch`). Objects are served publicly from `R2_IMAGES_PUBLIC_URL` (`https://images.atmyshelf.com`, the custom domain of the `atmyshelf-images` bucket), so the API never proxies image bytes.
  - *Unset (local dev, tests):* the filesystem under `FILES_STORAGE_PATH` (default `./data/files`), served by `GET /files/*` at `PUBLIC_API_URL`. Local dev never touches R2.
- **Production needs R2.** On Railway (`RAILWAY_VOLUME_MOUNT_PATH` set), and whenever `R2_IMAGES_BUCKET` is set, `config/env.ts` exits at boot unless all five are set: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_IMAGES_BUCKET`, `R2_IMAGES_PUBLIC_URL`. Production can't silently fall back to disk. (The `R2_*` credentials are the same ones the backups use; `R2_BACKUPS_BUCKET` is separate.)
- **Failures are loud.** An R2 error (non-2xx, network) propagates; only a `404` on a read means "missing". The blob is saved before the database row, so a failed upload creates no row pointing at nothing.
- **Old URLs redirect.** Absolute image URLs are stored in library documents, community events, tier-list snapshots, quizzes, arena slots and mural covers, so the three old routes stay as permanent `301`s to the new URLs instead of rewriting that data: `GET /covers/cached/:id/:size`, `GET /gallery/:id/file` and `GET /auth/avatar/:id/file`.
- **Account deletion removes files before rows.** `POST /auth/delete-account` and the gallery eraser await the file deletes; if storage fails the deletion fails with the account intact, so it can be retried.
- **Web service worker.** The frontend's `CacheFirst` media cache also matches `VITE_IMAGES_URL` (default `https://images.atmyshelf.com`); set it at build time if the public URL differs.

### Copying existing files to R2

`scripts/copy-files-to-r2.mjs` is the one-time copy of the files the volume held before the move (`/data/covers-files`, `/data/gallery-files`, `/data/avatar-files`; override with `--covers`, `--gallery`, `--avatars`). It uploads each one under the same id, so every stored absolute URL keeps resolving through the redirects, and uploads the full image as the thumbnail for covers that never had one. It reads the `R2_*` variables from the environment, skips a directory that doesn't exist, and is safe to re-run. It has to run on the service, where the volume is mounted:

```bash
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'ls /data && cd /app/backend && node scripts/copy-files-to-r2.mjs'
```

`ls /data` first lists the real directory names; pass the `--covers`/`--gallery`/`--avatars` flags if they differ. After it finishes and the new deploy is live, the old directories on the volume can be deleted.

## Hexagonal architecture — the standing convention for dependencies like a database

Every module that needs persistence (or, in principle, any other "the outside world" dependency — an email provider, a payment processor, etc.) is split into three layers:

```
modules/<name>/
  domain/
    ports.ts        ← the interface(s) the module's logic needs — e.g. AuthRepository,
                        LibraryRepository. Defined in terms the DOMAIN cares about
                        (findUserByEmail, saveDocument), never in terms SQL does
                        (no "table", no "query" in this file).
    types.ts, errors.ts
  service.ts          ← business logic. Takes a port implementation as a plain argument
                          (createAuthService(repo), createLibraryService(repo)) and is
                          written ONLY against the port interface — it has no idea SQLite
                          is involved, and doesn't import anything from adapters/.
  adapters/
    sqlite/
      connection.ts     ← opens this module's own SQLite file
      schema.sql         ← this module's own tables
      sqlite<Name>Repository.ts   ← implements the port using node:sqlite. The ONLY
                                      file in the module that contains SQL.
  routes.ts            ← HTTP layer. Takes the already-built service as a plain argument
                          too — knows nothing about SQLite either.
  plugin.ts             ← the composition root: the ONE place that creates the concrete
                          adapter and wires it into the service. Swapping SQLite for
                          Postgres later means writing a new adapters/postgres/ and
                          changing the two lines in plugin.ts that instantiate it —
                          domain/, service.ts, and routes.ts don't change at all.
  index.ts              ← public interface (see "The module boundary" below)
```

Concretely, in `modules/auth/plugin.ts`:

```ts
const db = openAuthDb();                              // adapter-specific
const authRepository = createSqliteAuthRepository(db);  // concrete adapter
const authService = createAuthService(authRepository);  // domain, sees only the port
```

`modules/library` follows the identical shape. This is also what makes each module's business logic unit-testable without a real database — hand `createAuthService`/`createLibraryService` an in-memory object implementing the port instead of a SQLite-backed one, no test database required (not set up yet for the other modules, but the seam is there — see `arena`'s own `service.test.ts` for the first module to actually use it).

## The module boundary — how it's actually enforced, not just named

Two things make this a real boundary, not just a folder-naming convention:

1. **`index.ts` is the only public surface.** Everything else in a module — `domain/`, `adapters/`, `service.ts`, `routes.ts`, `plugin.ts` — is that module's private implementation. `app.ts` is the only file that imports a module's `index.ts` purely to register it into the app. Modules *can* import each other's `index.ts` when they genuinely depend on one another — e.g. `modules/library/routes.ts` imports `authGuard` from `modules/auth/index.ts`, since a library document belongs to a signed-in user — but never reach past `index.ts` into another module's internals.
2. **Fastify's plugin encapsulation backs this up technically**, not just by convention. Everything a module's `plugin.ts` registers (routes, its rate limiter, its error handler) lives in its own encapsulated Fastify context — invisible outside the plugin unless explicitly decorated onto the parent instance. `modules/library` has no path to `modules/auth`'s database handle or JWT secrets; `authGuard` and the `AuthenticatedUser` type are the entire exposed surface it gets.

Adding a third module means repeating both shapes: its own `domain/ports.ts` + `adapters/sqlite/`, its own `service.ts`/`routes.ts`/`plugin.ts`/`index.ts`, registered from `app.ts` the same way. If it needs to know who's signed in, it takes `authGuard` from `modules/auth/index.ts` and nothing else.

## Why node:sqlite instead of better-sqlite3

`better-sqlite3` needs a native C++ toolchain (node-gyp) to compile on install, which isn't available on every machine this might run on — it failed outright on the machine this was built on. Node 22.5+ ships a built-in `node:sqlite` module with a very similar synchronous API and no native build step at all — though this backend requires Node 24+, since the books module's FTS5 table needs a `node:sqlite` build with FTS5 compiled in, which only later releases have. It's still flagged experimental by Node itself (a runtime warning, not an error) — worth knowing, and easy to swap later: thanks to the hexagonal split above, that would mean a new `adapters/sqlite/` implementation (or, given the name would no longer fit, a rename) rather than touching `service.ts` or `routes.ts` in either module.

## Backups

Litestream 0.5.17 streams every SQLite file on the Railway volume to the private R2 bucket `R2_BACKUPS_BUCKET`, one prefix per file: `/data/auth.sqlite` goes to `s3://atmyshelf-backups/auth.sqlite/`. `litestream.yml` lists the databases (auth, waitlist, library, gallery, murals, covers, socials, arena, tierlists, quizzes, community), the binary is downloaded and checksum-verified into `bin/` by `scripts/install-litestream.sh` during the build, and `scripts/start-with-litestream.sh` is Railway's start command. Uploaded files (covers, gallery, avatars) are not covered: they are not SQLite.

- **Boot:** the script refuses to start unless `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BACKUPS_BUCKET` are set, and unless every `*_DB_PATH` in the environment is in `litestream.yml`. It then restores each database that is missing locally (`-if-db-not-exists -if-replica-exists`) and runs `litestream replicate -exec "node dist/server.js"`, so replication starts and stops with the server. A failed check fails the healthcheck and Railway keeps the previous deployment.
- **Fresh or empty volume:** every database comes back from R2 on boot, no manual step. If the bucket has nothing for a database (the very first deploy), it starts empty and is replicated from then on.
- **Volume check:** on Railway (`RAILWAY_VOLUME_MOUNT_PATH` set), `config/env.ts` exits at boot if any `*_DB_PATH` is outside the volume.
- **Snapshots:** a full snapshot every 24h, kept for 14 days (`snapshot.retention: 336h` in `litestream.yml`; Litestream's default is 24h). Changes replicate about every second; restores within the last few minutes are exact to the transaction, older ones land on Litestream's compacted levels and so are coarser.
- **Local dev** never touches Litestream: `npm run dev` starts the server directly.

Verify objects are appearing (any machine with the four `R2_*` values exported, and Litestream 0.5.17 installed):

```sh
litestream ltx -config backend/litestream.yml /data/auth.sqlite
```

Each database should list level 0 files with a recent `created`. The bucket's Objects tab in the Cloudflare dashboard shows the same prefixes.

Restore into a scratch directory, without touching the volume:

```sh
mkdir -p /tmp/restore
for db in auth waitlist library gallery murals covers socials arena tierlists quizzes community; do
  litestream restore -config backend/litestream.yml -o /tmp/restore/$db.sqlite /data/$db.sqlite
done
sqlite3 -readonly /tmp/restore/auth.sqlite 'select count(*) from users'
```

Add `-timestamp <RFC3339>` or `-txid <hex>` to restore to an earlier point. To make a restored file the live database, see the next section.

### Rolling back production to a point in time

Modules reference each other by id (murals to books, community to users, and so on), and each database is rolled back on its own. Rolling back one database can leave references dangling in the others. Roll back every database to the same time unless you know the one you are touching is self-contained.

The restore is staged on the volume while the server keeps running, and `scripts/start-with-litestream.sh` swaps it in on the next start. For each file in `/data/restore/` named like a database in `litestream.yml` it deletes the live file, its `-wal`/`-shm` and its `.<name>-litestream` metadata directory, moves the staged file into place and removes `/data/restore/`. Litestream then finds the database behind the replica, fetches the replica's last position and writes a full snapshot on top of it, so the replica's history stays linear: rolled-back and newer writes replicate normally, and the pre-rollback history stays in R2 and is still restorable by timestamp until the retention window passes. A file in `/data/restore/` that is not a database in `litestream.yml` makes the script exit before touching anything.

All commands below use the explicit project, environment and service flags. Keep the `-- sh -c '...'` form: a bare quoted command string fails with "error decoding response body". Times are UTC (RFC3339 with `Z`), for the `created` column and for `-timestamp`.

1. Find the time. Snapshots (level 9) show how far back you can go, and level 0 files show each replicated change:

   ```sh
   railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && bin/litestream ltx -level 9 -config litestream.yml /data/auth.sqlite'
   ```

   Pick a time after the oldest snapshot's `created` and before the damage. Use `date -u +%Y-%m-%dT%H:%M:%SZ` for now.

2. Stage one database (here `auth`, at `2026-10-01T09:30:00Z`). This only reads from R2 and leaves the live database alone:

   ```sh
   railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'set -e; cd /app/backend && export PATH=$PWD/bin:$PATH && mkdir -p /data/restore && litestream restore -config litestream.yml -timestamp 2026-10-01T09:30:00Z -integrity-check quick -o /data/restore/auth.sqlite /data/auth.sqlite'
   ```

   Or stage all of them, the usual case:

   ```sh
   railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'set -e; cd /app/backend && export PATH=$PWD/bin:$PATH && mkdir -p /data/restore && for db in $(litestream databases -config litestream.yml | awk "NR > 1 { print \$1 }"); do litestream restore -config litestream.yml -timestamp 2026-10-01T09:30:00Z -integrity-check quick -o /data/restore/$(basename $db) $db; done'
   ```

   `litestream restore -o` refuses an existing output file, so to re-stage, delete `/data/restore` first (see abort below). Check what is staged, one file per database:

   ```sh
   railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- ls -l /data/restore
   ```

3. Restart. Nothing changes until this step:

   ```sh
   railway redeploy --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta --yes
   ```

   The deployment log shows `start-with-litestream: rolled back /data/<name>.sqlite to the staged restore` per database. If the script exits instead, the log says why and nothing was swapped; fix or delete `/data/restore` and redeploy again.

4. Verify:
   - `curl -fsS https://<backend host>/health`.
   - The content is at the chosen time: look at the app, or on the service `sqlite3 /data/<name>.sqlite ...` if installed.
   - Writes replicate: make a change in the app, then on a laptop with the four `R2_*` values exported restore the database fresh and check that it has the rolled-back state plus the new change, not the pre-rollback state:

     ```sh
     litestream restore -config backend/litestream.yml -o /tmp/verify/auth.sqlite /data/auth.sqlite
     ```

To abort before step 3, delete the staged files; the next start then does nothing extra:

```sh
railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'rm -rf /data/restore'
```

Adding a database: add its `*_DB_PATH` (under `/data`) to `litestream.yml`. The start script reads the restore list from that file, and refuses to boot if a `*_DB_PATH` in the environment is missing from it.

Checkpointing: nothing here sets `wal_checkpoint` or `wal_autocheckpoint`. Litestream's tips page recommends `busy_timeout = 5000` on the app's connections, so every module's `connection.ts` sets it, and disabling autocheckpoint only for high write load servers, which this is not.

## Security notes

- Passwords hashed with argon2 (its default parameters — no manual tuning done here).
- Refresh tokens stored as a sha256 hash, never plaintext; they're high-entropy random data with no embedded claims, so there's nothing sensitive to protect in the hash algorithm choice itself, just an unlinkability-from-a-DB-leak concern.
- Same generic error for "no such account" and "wrong password" on login, to avoid account-enumeration.
- `/auth/signup`, `/auth/login`, `/auth/refresh`, and `/auth/logout` share a 20-requests-per-minute rate limit, scoped to just those routes.
- Refresh token rotation + replay detection (above).
- Every `library` route requires a valid access token, and only ever reads/writes the row for `request.user.id` — confirmed in testing that a second account cannot see the first's document.
- `gallery` uploads are validated by actual file content (magic bytes via `sharp`), not client-supplied MIME type/extension; re-encoded (stripping EXIF/GPS/ICC metadata) rather than stored as-is; capped per-file and per-account; and stored under server-generated ids rather than user-supplied filenames — see the `gallery` section above for the full pipeline. `GET /gallery/:id/file` is the one intentionally unauthenticated route in this app, by design (see that section) — everything else in `gallery` is scoped to `request.user.id` the same as `library`.
- `arena` deliberately breaks this app's usual "everything requires a session" pattern: `GET /arenas/:id`, `GET /arenas/public`, and `POST /arenas/:id/duels/:duelId/vote` are all unauthenticated by design — the whole point of BookArena is that anyone with a tournament's link can view and vote with no account. The vote route is this app's first anonymous WRITE endpoint, and carries its own tighter, separately-scoped rate limit (20/min) for exactly that reason. Every OTHER `arena` route (create/seed/start/settle/tiebreak/delete/mine) requires `authGuard`, and each additionally re-checks ownership server-side via `getOwnedTournament` inside the service layer — not just at the route's `preHandler` — so even a route that someday forgot its `authGuard` couldn't act on someone else's tournament.
- `socials`' platform tokens are the one genuinely reversible secret this backend stores (AES-256-GCM, gated behind `SOCIALS_ENCRYPTION_KEY` — see that section above for why a hash, like passwords get, can't be used here). The OAuth connect flow binds a redirect back to the right user via a short-lived, single-use link session layered on top of `@fastify/oauth2`'s own signed-cookie CSRF state check, not in place of it.

## Not built (flagged, not silently skipped)

- Password reset and email verification — out of scope for what was asked ("basic": signup/login/logout + OAuth).
- No username *change* endpoint — `POST /auth/username` only works while the account has none yet (the check is "is this account's username null", not "is the caller allowed to overwrite their existing one"). Fine for its one real use case (Google's first-login prompt); would need a small tweak to also serve as a general "change my username" feature.
- Google sign-in is implemented and unit-verified in isolation (correctly skipped when unconfigured, correctly issues `username: null` for a new account), but the live end-to-end flow with real Google credentials hasn't been exercised yet — that needs an actual `GOOGLE_CLIENT_ID`/`SECRET` from Google Cloud Console, which only the person deploying this can obtain.
- Same story for `books`/ISBNdb: verified that the chain correctly skips the ISBNdb step with no key configured — but ISBNdb's actual response shape hasn't been exercised against a real API key yet, since that also needs an account/key only the person deploying this can obtain.
- No migration framework — each module's `schema.sql` runs via `CREATE TABLE IF NOT EXISTS` on every boot. Fine for additive schema changes; would need a real migration tool before making breaking ones against real data.
- No test-double/fake repository written for `auth`/`library`/`gallery`/`socials` yet — the hexagonal split makes one easy to add, but there's no test suite exercising any of THOSE yet, just the manual scripts under "Trying it out". `arena` and `books` are the exceptions: their own `*.test.ts` files hand their services in-memory fakes, using the seam every other module has had all along.
- `gallery` has no separate thumbnail size — the same re-encoded (already capped at 1600px) image is served for both a gallery grid thumbnail and a full book cover. Fine at this app's scale; a real thumbnail variant would mean a second re-encode + a second object per upload.
- No image editing (crop/rotate-by-hand/etc.) — re-encoding auto-applies EXIF orientation and downsizes, but there's no way to crop a cover to a different aspect ratio after upload; re-uploading is the only option.
- `socials` connect/disconnect and the Bluesky app-password flow are what's built and verified — the actual *use* of a connection (posting, reading, anything that would call an X/Instagram/Threads/TikTok/Bluesky API on the user's behalf) is intentionally not built yet; that was scoped out explicitly, not an oversight.
- X/Instagram/Threads/TikTok's real OAuth exchanges haven't been run against live developer credentials — verified instead is everything that doesn't need them: correct `enabled: false` gating with no crash when unconfigured, the link-session flow's own logic, and (via the shared `saveConnection`/encryption path) the exact same storage Bluesky's real, live-verified flow already exercises end-to-end. The first real `.env` credentials for each of those four is the actual integration test for that platform's own endpoint/scope/profile-shape details in `providerConfig.ts`.
- Disconnecting a platform deletes Scripta's own copy of the token; it does not separately call that platform's revoke endpoint to invalidate the token on their end. Most of these tokens are short-lived by platform design anyway, and a user can always revoke from that platform's own connected-apps settings — but a real revoke-on-disconnect call (where each platform's API supports one) would be a natural small follow-up, not implemented here.
- No admin/owner-facing view of which accounts have connected what — `GET /socials` is scoped to `request.user.id` like everything else, there's no cross-account listing.
- `npm run build`/`npm start` (as opposed to `npm run dev`) aren't verified — `tsc` only compiles `.ts` files, so each module's `schema.sql` and `auth/public/console.html` (all read from disk at runtime, relative to the reading file's own location) wouldn't be copied into `dist/` by the current build script. `npm run dev` (via `tsx`, which reads `.ts` straight from `src/`) is what's been tested and is fine for now; a build fix (copy those files into `dist/` alongside the compiled output) is needed before this runs anywhere other than `tsx watch`.
