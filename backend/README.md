# Kobo Library Backend

A Node.js/Fastify/TypeScript backend, structured as a **modular monolith**: one deployable service, internally split into self-contained modules that only talk to each other through explicit public interfaces. Six modules so far — `auth`, `library`, `gallery`, `covers`, `socials`, and `arena` — with more expected as the project grows. Consumed by the [frontend](../frontend/README.md), which replaces the old static, drag-your-own-file [viewer](../viewer/README.md).

Every module with a persistence dependency follows **hexagonal architecture** (ports & adapters): the module's business logic depends only on a repository *interface* it defines, never on a concrete database. See "Hexagonal architecture" below — this is a standing convention for this backend, not just how `auth` happened to be built.

## Running it

```bash
cd backend
npm install
cp .env.example .env   # then fill in JWT secrets (see the comment in .env.example for how to generate them) and, optionally, Google OAuth credentials, a Hardcover API key, and/or socials' encryption key + per-platform OAuth credentials
npm run dev
```

`GET /health` → `{"status":"ok"}` once it's up.

## Trying it out

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
- **Google sign-in**, if `GOOGLE_CLIENT_ID`/`SECRET`/`CALLBACK_URL` are set in `.env` — the app boots and runs fine without them, it just skips registering the Google routes (and logs that it did). A Google sign-in has no username yet on its first login (Google doesn't hand you one) — `user.username` comes back `null`, and the caller is expected to prompt for one via `POST /auth/username` before treating the account as fully set up. The [frontend](../frontend/README.md) enforces this with a route guard.
- **JWT access tokens** (short-lived, 15m default) + **refresh tokens** (long-lived, 30d default, stored server-side as a salted hash — never in plaintext). Refresh rotates on every use: the old token is revoked and a new pair issued. Presenting an already-revoked refresh token is treated as a stolen/replayed token and revokes **every** session for that user, not just the one being used.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| POST | `/auth/signup` | — | `{email, username, password}` → `{user, accessToken, refreshToken}` |
| POST | `/auth/login` | — | `{identifier, password}` — `identifier` is either the email or the username |
| POST | `/auth/refresh` | — | `{refreshToken}` → new `{accessToken, refreshToken}` |
| POST | `/auth/logout` | — | `{refreshToken}` → revokes that one session |
| POST | `/auth/logout-everywhere` | ✓ | revokes every session for the caller |
| GET | `/auth/me` | ✓ | `{user}` |
| POST | `/auth/username` | ✓ | `{username}` → claims a username for the caller's account; `409` if taken. What a Google sign-in without one yet calls before it's treated as set up |
| GET | `/auth/google` | — | starts the Google OAuth redirect flow (only if configured) |
| GET | `/auth/google/callback` | — | Google redirects here; ends by redirecting the browser to `OAUTH_SUCCESS_REDIRECT_URL#access_token=...&refresh_token=...` |
| GET | `/auth/providers` | — | `{google: boolean}` — lets a frontend show/hide the Google button without hardcoding it |
| GET | `/auth/console` | — | the test console, see "Trying it out" above |

`user` in every response above is `{id, email, username}` — `username` is `null` only for a Google-signed-in account that hasn't claimed one yet.

### `library`
- **One JSON document per account** — the same shape the [exporter](../exporter/export.py) produces (`{source, schema_version, book_count, books}`). Full replace, not a merge: saving overwrites whatever was there before, same mental model as the old viewer's drag-and-drop.
- Validation is deliberately light: the body must be `{"data": {"books": [...], ...}}` — an object with a `books` array. What's *inside* each book isn't checked; this module treats the document as an opaque blob it stores and returns, not something it understands the internals of.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/library` | ✓ | `{data, updatedAt}`, or `404` if this account hasn't saved one yet |
| PUT | `/library` | ✓ | `{data: {...}}` → stores it (replacing any previous document) and echoes back `{data, updatedAt}` |

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
- **Stored under a server-generated id**, never the original filename — `adapters/fs/fsImageBlobStore.ts`'s file paths are built only from a `randomUUID()` and the account's own id (both server-controlled), so there's nothing attacker-influenced in the path at all; the original filename is kept only as display metadata in the DB row.
- **`GET /gallery/:id/file` is deliberately NOT behind `authGuard`** — it needs to work as a plain `<img src>` with no `Authorization` header attached, the same trust model this app already has for the Kobo CDN / Open Library cover URLs the frontend loads directly. Access control here is "the id is an unguessable random UUID," not a session check. Every other route (`list`/`upload`/`delete`) IS auth-gated and scoped to `request.user.id`.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/gallery` | ✓ | `{images: GalleryImage[]}` for the caller's own account |
| POST | `/gallery` | ✓ | `multipart/form-data`, one `image` field → `{image}`, `201`. `413` if the file or the account's quota is too large, `422` if it's not a valid/acceptable image |
| DELETE | `/gallery/:id` | ✓ | `204`, or `404` if no such image is owned by the caller |
| GET | `/gallery/:id/file` | — | the raw (re-encoded) image bytes, `Cache-Control: immutable` (the output never changes post-upload) |

Rate-limited (30 requests/minute, scoped to this module's routes only) and given its own SQLite file (`GALLERY_DB_PATH`) plus its own on-disk blob directory (`GALLERY_STORAGE_PATH`, one subdirectory per account) — same module-isolation convention as everything else here.

### `covers`
- **The entire cover-resolution chain, and a persistent GLOBAL cache in front of it** — this module started as a single proxy endpoint just for Hardcover's API key (see below for why that part still exists), but grew into something bigger once it became clear the real complaint wasn't "one more source to try," it was "why does the SAME slow/rate-limited lookup happen again on every single page load, for every account." Reported live, in exactly those terms: *"we should create a sort of database for bookcovers, so when they load the first time we save them in a db, and when the user loads a second time instead we check our db if the bookcover already exists and avoid requesting cdn."* Kobo CDN, Open Library, Google Books, and Hardcover — the WHOLE chain the frontend used to run client-side — now lives here, behind one cache-aware endpoint.
- **`cover_cache` is GLOBAL, not per-account** — one row per book identifier (`isbn:<isbn>` or `kobo:<imageId>`, whichever's available; ISBN wins when both are), shared by every account on this install. The same public book has the same cover for everyone, so the first account to view a given book resolves it for every account after. A fuzzy title+author match (no ISBN/imageId at all) is deliberately NEVER written to this cache — see `service.ts`'s own comment: trusting a "probably this book" guess as a permanent, shared-forever entry is a real correctness risk the ISBN/imageId-backed entries don't have; that one case gets handed back the source's own external URL directly instead, same as before this cache existed.
- **Downloads and stores the actual image bytes, not just a remembered URL** — a cache HIT genuinely avoids ever contacting Kobo/Open Library/Google/Hardcover again for that book, on ANY device, for ANY account, forever (barring the extremely narrow one-time write race described below). A MISS runs the full chain (same priority order the frontend's own `lib/covers.ts` established before this moved: exact-identifier attempts — Kobo by imageId, Open Library/Hardcover/Google Books by ISBN — before either's own fuzzy title+author fallback), and the first candidate that actually pans out gets downloaded and put through the EXACT SAME validate-then-re-encode pipeline `gallery`'s own `uploadImage` uses (real-format sniff via `sharp` reading actual bytes, a decompression-bomb dimension cap, re-encode to a fixed WebP output — which as a side effect strips all metadata) before being written to `COVERS_STORAGE_PATH`/`cover_cache`.
- **A genuine concurrency race, found and fixed, not assumed away** — two requests resolving the exact same uncached book at once (two browser tabs; React StrictMode's own double-effect firing in dev; two different accounts happening to load the same new book within the same second) can both read the cache as empty before either has written, since that read is separated from the eventual write by real `await`ed network calls. Caught live, stress-tested with 2- and 3-way concurrent resolves for a never-before-seen ISBN and confirmed via a direct SQLite query that only ONE row (and thus only one downloaded blob) ever actually gets persisted per book. Fixed with `INSERT OR IGNORE` plus a `changes > 0` check in the SQLite adapter — the loser of the race reads back whichever row the winner wrote instead of throwing on the `cache_key` UNIQUE constraint, and every concurrent caller converges on the identical served URL regardless of which one happened to finish first. The one accepted trade-off: the loser's own freshly-downloaded blob is a harmless orphan file on disk (no DB row references it, no cleanup mechanism exists for it) — self-limiting to at most one small stray file per book, ever, not worth adding blob deletion machinery to close.
- **Two routes, two SEPARATE rate limits, in two Fastify encapsulation scopes** — found live, loading a real 26-book test library: a resolve on a MISS can mean 4-5 sequential external requests plus a `sharp` re-encode, genuinely worth protecting; a cached-file read is a single local disk lookup, the exact same cost profile `gallery`'s own (unlimited) `GET /gallery/:id/file` already has. A real page load fires roughly one of EACH per book, nearly simultaneously — a single limit tight enough to matter for the expensive route starved the cheap one too, and a browser treats a JSON rate-limit body served in place of an expected image as a hard, unrecoverable failure (`ERR_BLOCKED_BY_ORB`), not something it retries. `GET /covers/resolve` gets its own 300 requests/minute; `GET /covers/cached/:id/file` gets none at all, same as `gallery`'s file route.
- **Kobo/Open Library/Google Books are plain functions, not ports** — the one deliberate exception to "everything outside-world goes behind an injected port" this backend otherwise follows. Unlike Hardcover (which genuinely anticipates a swappable/alternative provider — see `domain/ports.ts`'s own comment), each of these three has exactly one real implementation, is keyless, and needs no configuration — there's nothing to swap and nothing a fake double would ever stand in for that a real integration check against the live API wouldn't already need anyway. `service.ts`'s own header comment explains this in full.
- **Hardcover is still the one source that needs a real secret** — the ENTIRE reason this module has a backend component at all, rather than the whole chain just living in `lib/covers.ts` the way it originally did. An API key can never be handed to the browser the way a plain image URL can — anyone opening devtools could read it straight out of a request header. `hardcoverLookup` is simply `null` when `HARDCOVER_API_KEY` is unset, and `resolveCover`'s own candidate list skips that one step entirely in that case — the module registers and the cache works fully regardless (Kobo/Open Library/Google Books need no key at all), just without that one extra source in the chain.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/covers/resolve?isbn=&imageId=&title=&author=` | ✓ | All four query params optional (at least one required). `{url: string \| null}` — `null` is a normal "nothing anywhere has a cover for this book" answer, not an error. Behind auth since a MISS spends this deployment's own external quota (Hardcover, Google Books). |
| GET | `/covers/cached/:id/file` | — | The raw re-encoded image bytes for a cached cover, `Cache-Control: immutable` (never changes once cached — no "edit" operation, only ever written once per `cache_key`). Same "id is an unguessable random UUID" trust model as `gallery`'s own file route, not a session check. |

**Getting a Hardcover key** (optional): sign in at [hardcover.app](https://hardcover.app), open Settings, and generate an API key from there — see `.env.example`'s own comment. Every other cover source, and the cache itself, work fully without one.

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

`better-sqlite3` needs a native C++ toolchain (node-gyp) to compile on install, which isn't available on every machine this might run on — it failed outright on the machine this was built on. Node 22.5+ ships a built-in `node:sqlite` module with a very similar synchronous API and no native build step at all. It's still flagged experimental by Node itself (a runtime warning, not an error) — worth knowing, and easy to swap later: thanks to the hexagonal split above, that would mean a new `adapters/sqlite/` implementation (or, given the name would no longer fit, a rename) rather than touching `service.ts` or `routes.ts` in either module.

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
- Same story for `covers`/Hardcover: verified live that the route correctly doesn't exist (`404`) with no key configured, and that the frontend's own fallback chain degrades cleanly through that — but the actual Hardcover GraphQL call (query shape, response parsing) hasn't been exercised against a real API key yet, since that also needs an account/key only the person deploying this can obtain.
- No migration framework — each module's `schema.sql` runs via `CREATE TABLE IF NOT EXISTS` on every boot. Fine for additive schema changes; would need a real migration tool before making breaking ones against real data.
- No test-double/fake repository written for `auth`/`library`/`gallery`/`covers`/`socials` yet — the hexagonal split makes one easy to add, but there's no test suite exercising any of THOSE yet, just the manual scripts under "Trying it out". `arena` is the first exception: `service.test.ts` hands `createArenaService` exactly this kind of in-memory fake, using the seam every other module has had all along.
- `gallery` has no separate thumbnail size — the same re-encoded (already capped at 1600px) image is served for both a gallery grid thumbnail and a full book cover. Fine at this app's scale; a real thumbnail variant would mean a second re-encode + a second file on disk per upload.
- No image editing (crop/rotate-by-hand/etc.) — re-encoding auto-applies EXIF orientation and downsizes, but there's no way to crop a cover to a different aspect ratio after upload; re-uploading is the only option.
- `socials` connect/disconnect and the Bluesky app-password flow are what's built and verified — the actual *use* of a connection (posting, reading, anything that would call an X/Instagram/Threads/TikTok/Bluesky API on the user's behalf) is intentionally not built yet; that was scoped out explicitly, not an oversight.
- X/Instagram/Threads/TikTok's real OAuth exchanges haven't been run against live developer credentials — verified instead is everything that doesn't need them: correct `enabled: false` gating with no crash when unconfigured, the link-session flow's own logic, and (via the shared `saveConnection`/encryption path) the exact same storage Bluesky's real, live-verified flow already exercises end-to-end. The first real `.env` credentials for each of those four is the actual integration test for that platform's own endpoint/scope/profile-shape details in `providerConfig.ts`.
- Disconnecting a platform deletes Scripta's own copy of the token; it does not separately call that platform's revoke endpoint to invalidate the token on their end. Most of these tokens are short-lived by platform design anyway, and a user can always revoke from that platform's own connected-apps settings — but a real revoke-on-disconnect call (where each platform's API supports one) would be a natural small follow-up, not implemented here.
- No admin/owner-facing view of which accounts have connected what — `GET /socials` is scoped to `request.user.id` like everything else, there's no cross-account listing.
- `npm run build`/`npm start` (as opposed to `npm run dev`) aren't verified — `tsc` only compiles `.ts` files, so each module's `schema.sql` and `auth/public/console.html` (all read from disk at runtime, relative to the reading file's own location) wouldn't be copied into `dist/` by the current build script. `npm run dev` (via `tsx`, which reads `.ts` straight from `src/`) is what's been tested and is fine for now; a build fix (copy those files into `dist/` alongside the compiled output) is needed before this runs anywhere other than `tsx watch`.
