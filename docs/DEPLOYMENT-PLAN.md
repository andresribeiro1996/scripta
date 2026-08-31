# Scripta — deployment plan

Working plan for taking Scripta from a local dev setup to a public, multi-user
web app. Written against commit `97077cf`.

A rendered version of this plan lives at
<https://claude.ai/code/artifact/aa90e665-d96c-475b-8fe4-8a5e8870242c> (private
link — same content, easier to read).

> **Scope note.** An earlier draft of this plan assumed Scripta was a personal
> install, because that is how the READMEs describe it. It is not: it is meant
> to be distributed and used by other people. Everything below assumes that.

---

## The headline finding

Each user's **entire library is a single JSON blob** in one row:

```sql
library_documents ( user_id TEXT PRIMARY KEY, data TEXT, updated_at TEXT )
```

It is rewritten in full on every change — mark a book read, drag one mural
block, and the whole document is serialised, sent over the wire, and written
back.

This is the thing to fix, and **it is not a SQLite problem**. Move the same blob
to Postgres and you get the same rewrite-everything write path with network
latency added. Four of the five modules (`auth`, `gallery`, `covers`, `socials`)
are already properly normalised with real columns and indexes. Only `library` is
a blob, which makes this a contained fix rather than a rewrite.

## Is SQLite viable for multiple users?

Yes — it is not the ceiling. WAL is enabled on all five databases, and `argon2`
uses its async API so password hashing runs on the libuv threadpool rather than
blocking. Those are the two things people usually get wrong and they are already
right here.

What actually breaks, in the order you will hit it:

| # | Problem | Where |
|---|---------|-------|
| 1 | **Large libraries fail to save.** `PUT /library` declares no `bodyLimit`, so Fastify's 1 MB default applies. A few hundred books with highlights exceeds it → `413`, silently. Live bug at one user. | `modules/library/routes.ts` |
| 2 | **Two devices overwrite each other silently.** `updateLibrary()` reads the React Query cache and PUTs the whole document. No version, ETag, or precondition — unconditional last-write-wins. | `frontend/src/hooks/useLibrary.ts` |
| 3 | **`DatabaseSync` blocks the event loop.** `node:sqlite`'s sync API + a multi-MB `JSON.stringify` + a blocking disk write, all on Node's single thread. Every other request waits behind it. | `modules/library/adapters/sqlite/` |
| 4 | **Every mural drag rewrites the whole library.** `handleLayoutChange` fires per `react-grid-layout` drop, no debounce. | `frontend/src/pages/MuralEditorPage.tsx` |
| 5 | **One instance = downtime on every deploy.** A file-on-a-volume DB can only attach to one machine, so no replicas, no rolling deploys, no failover. | architectural |

**Verdict:** normalise the library into rows and SQLite carries you into the
thousands of accounts — the read-heavy card-grid workload is what it is good at.
Keep the blob and no database saves you. The reason to eventually move to
Postgres is not throughput; it is the operational properties a single volume
cannot provide (replicas, zero-downtime deploys, point-in-time restore).

## Is Vite viable for multiple users?

Yes, and it is not the piece to reconsider. Vite is a build tool, not a server:
`vite build` emits static assets that a CDN serves with no per-user work. Ten
users and ten million are the same request to an edge node.

The real question underneath is **server-side rendering**, which is a product
decision, not a capacity one:

- Staying behind a login → the current SPA is correct. Nothing to index.
- Wanting public shareable pages (a library or mural link that renders a preview
  card or gets indexed) → an SPA serves crawlers a blank document, and that is
  when Next.js/Remix earns its keep. Plausible eventually, given the `socials`
  module.

Minor: `sql.js` is statically imported by `LibraryPage`, so its JS glue lands in
the main bundle on the busiest route. The WASM is already lazily fetched via
`locateFile` (the important half); a dynamic `import()` would finish the job.

---

## Plan

### Phase 1 — Normalise the library *(in progress)*

Replace the one-blob table with real rows, mirroring what `gallery` and `covers`
already do correctly. Removes the 1 MB ceiling, shrinks writes enough that the
synchronous driver stops mattering, makes per-block mural saves possible, and
gives us somewhere to put a version column.

Do it on SQLite first — migrating one file you can copy is far easier than
migrating a live Postgres.

**Design constraint:** book records have **no fixed schema**. The exporter emits
whatever columns the Kobo device happened to have (`existing_columns()` filters
against the real table), Goodreads CSV imports carry different fields again, and
the app adds its own `_`-prefixed fields (`_coverUrl`, `_order`, `_style`). So
the design is a **hybrid**: real columns for what the app queries and sorts on,
plus a JSON column for the open-ended remainder. Normalising the *structure* is
what removes the rewrite-everything problem; the leaf attributes genuinely have
no fixed shape and JSON is the right answer for them.

Book identity is `bookKey()` from `frontend/src/lib/merge.ts` — `isbn:<isbn>`,
falling back to `ta:<title>|<author>`. Groups and mural blocks reference books by
that key, not by a row id, so it has to survive as a first-class column.

Shipped in three slices so nothing breaks at any point:

- **Slice 1 — storage layer.** New normalised schema, per-entity repository port,
  SQLite adapter, and a migration that explodes existing blob rows into it. The
  existing `GET`/`PUT /library` document API is kept as a compatibility layer
  over the rows, so the frontend keeps working untouched.

  **Found while building slice 1:** `groups`, `murals` and `mural_blocks` were
  first written with `id` alone as the primary key. Those ids are generated
  *client-side*, so with two accounts on one server, user B saving a group
  whose id matched user A's hit `ON CONFLICT(id)` and overwrote A's row — and
  for `mural_blocks` the conflict update reassigned `user_id`, handing one
  user's block to another. Deliberately triggerable by picking someone else's
  id. The primary keys are now `(user_id, id)`, with regression tests. Worth
  remembering as the shape of bug this rework exists to surface: invisible
  with one user, unavoidable with many.

- **Slice 2 — optimistic concurrency + the first per-entity endpoint.** *(done)*
  Every write now quotes the version it edited; a stale write is refused with
  `409` carrying the server's current document, and `updateLibrary` re-applies
  its updater to that document rather than losing the edit — the updater is a
  pure `(current) => next`, so re-running it against fresh state *is* the merge.
  All nine call sites that previously issued raw unconditional `saveLibrary`
  calls (LibraryPage's seven, the gallery-image scrub) were routed through that
  funnel, so the protection is account-wide rather than partial.

  `PUT /library/murals/:muralId/blocks/:blockId/layout` is the first per-entity
  route, backing a debounced `useMuralBlockLayout` hook: dropping a block is now
  a ~56-byte request instead of re-sending every book, highlight, group and
  mural the account has.

  **Still on the document endpoint:** every other write (book style, covers,
  reorder, delete, groups CRUD, mural CRUD, library style/name, import). They are
  correct and now conflict-safe, just not yet proportional in size. Moving them
  needs one route per entity plus a frontend change per call site, and the
  repository port already exposes `upsertBook`/`upsertGroup`/`upsertMural`/
  `delete*` for exactly that — deliberately left unrouted rather than shipped as
  unused endpoints.
- **Slice 3 — retire the blob.** Delete the document endpoint and the legacy
  table once nothing reads them.

### Phase 2 — Correctness gaps (before any launch)

- Optimistic concurrency on writes; `409` on stale version with a real merge path
  in the UI (`frontend/src/lib/merge.ts` is the place to build on).
- Debounce mural layout saves; surface save failures instead of swallowing them.
- `npm run build` does not copy `schema.sql` or `auth/public/console.html` into
  `dist/`, so `npm start` will not boot at all. (Already noted in
  `backend/README.md` line 201.)
- `trustProxy` is unset in `buildApp()`, so behind a load balancer all four rate
  limiters collapse into one bucket keyed on the proxy's IP — which defeats the
  login brute-force protection specifically.
- `GET /auth/console` is unauthenticated and publicly routable; gate it behind
  `NODE_ENV !== "production"`.
- `VITE_API_URL` is baked in at build time and silently falls back to
  `localhost:3000` if unset. Consider throwing when `import.meta.env.PROD`.

### Phase 3 — Move state off the instance (before public launch)

**Database: done.** `adapters/postgres/` implements the same
`LibraryRepository` port as `adapters/sqlite/`; `service.ts` and `domain/` were
not touched, which is what the hexagonal structure was for. Set `DATABASE_URL`
and the `library` module uses Postgres — that is the entire switch
(`modules/library/plugin.ts`). The other four modules are still SQLite-only.

The port had to become **async** first: it was written around `node:sqlite`'s
synchronous API, and a network-backed store cannot answer synchronously. The
SQLite adapter now returns already-resolved promises. That change is also what
makes it possible to later get the blocking driver off the event loop.

Migrating an existing deployment: `scripts/sqlite-to-postgres.mjs`, run with the
app stopped (there is no dual-write mode). It reads through the SQLite adapter
and writes through the Postgres one — both via the same port and the same
document mapping the app itself uses, rather than a bespoke SQL-to-SQL copy that
could drift from either. Every account is verified after writing by reassembling
the document from Postgres and deep-comparing it to the SQLite original; a
mismatch fails that account rather than reporting success. Non-destructive and
re-runnable. Verified here against a seeded 3-account / 400-book / 1,197-highlight
database, and the app was then booted against Postgres and round-tripped over
HTTP.

**Object storage: not done.** Gallery uploads and the cover cache still write to
local disk (`GALLERY_STORAGE_PATH`, `COVERS_STORAGE_PATH`), which pins the API to
one machine just as surely as the database did — so Postgres alone does *not*
yet unlock replicas. Both blob stores are already behind ports
(`ImageBlobStore`, `CoverBlobStore` in their modules' `domain/ports.ts`), so this
is a new adapter, not a refactor. It was deliberately not written blind: no
S3-compatible endpoint was reachable from the environment this was built in, and
an unverified storage adapter handling user uploads is worse than none. Do it
against a real R2/S3 bucket (or MinIO) with the same
same-behaviour-through-one-port tests the Postgres adapter has.

Storage sizing is its own argument: the gallery quota is **500 MB per account**
(`modules/gallery/service.ts`), so a thousand users is potentially half a
terabyte — priced very differently as a block volume than as object storage.

Do it before there is other people's data. With three users it is an afternoon;
with three thousand it is a dual-write period, a migration window, and a rollback
plan.

### Phase 4 — Domain, hosting, pipeline

**Domain.** One apex, two hostnames: `scripta.app` (frontend) and
`api.scripta.app` (API), `www` redirecting to the apex. Settle this *first* —
Google, X, Instagram, Threads and TikTok each require an exact redirect URI
registered in their developer console before OAuth works, and several review the
app. Registering against a temporary URL means redoing all of it. Bluesky is the
exception (app password, no registration).

Every optional integration degrades cleanly when unconfigured and logs which ones
it skipped at boot, so launch with none and add them one at a time. Note that
Google sign-in and the Hardcover lookup have **never run against real
credentials** (per `backend/README.md`) — budget for the first live attempt at
each to need a fix.

**Hosting.**

| Piece | Recommendation | Roughly |
|---|---|---|
| Frontend | Cloudflare Pages / Netlify / Vercel. Needs SPA fallback to `index.html`, and short cache TTLs on `index.html`, the manifest and the service worker so the PWA's `autoUpdate` doesn't pin people to a stale build. | free |
| API | Fly.io or Render. Once stateless, ≥2 machines for rolling deploys. `GET /health` already exists. | ~$10–15/mo |
| Database | Neon or Supabase — usable free tiers, and point-in-time restore rather than snapshot-and-pray. | free → ~$20/mo |
| Blobs | Cloudflare R2 — zero egress, which matters when serving cover images on every page view. | ~$0.015/GB/mo |

Roughly $15–35/month all-in at small scale, against ~$8 for the single-volume
version. The difference buys deploys without downtime and a database you can
rewind.

**Pipeline.**

- On every PR: backend `typecheck` + `build` (the build step catches the
  missing-`schema.sql` class of problem), frontend `lint` + `typecheck` + `build`.
  Node pinned to the same 22.x as production.
- **Tests.** There were none. Phase 1 adds the first ones (`node:test`, no new
  dependency) because a data migration is exactly the code you cannot ship
  untested.
- On merge to `main`: deploy, with database migrations as an explicit ordered
  step — with multiple instances, a migration that isn't backward-compatible with
  the still-running old version breaks requests mid-deploy.
- Add error tracking (e.g. Sentry). With real users you no longer find out about
  failures by being the only person using the app.
- No `Dockerfile` yet: needs a pinned `node:22-bookworm-slim` multi-stage build,
  and `sharp`'s native binaries must match the deploy architecture.

No staging, matrix builds, or private registry needed.

### Phase 5 — Reconsider the frontend

Only if public shareable pages matter. Vite is not what's holding anything back.

---

## Notes for whoever picks this up

- Phases 1 and 2 are non-negotiable — they are correctness bugs that lose user
  data. Phase 3 is the deferrable one: launching an early beta on
  SQLite-with-rows and a volume is defensible, accepting deploy downtime and
  restore-from-backup as the worst case. It stops being defensible once
  someone's reading history is irreplaceable to them.
- `node:sqlite` works unflagged on Node 22.22 (experimental warning only). Pin
  the exact Node minor in the image so a base-image bump can't take the database
  layer with it.
- Tokens live in `localStorage`, not cookies, so the two-origin split needs no
  `SameSite` or cookie-domain work.
- CORS allows exactly one origin, so preview deploys of the frontend will be
  rejected by the API.
- Secrets to generate fresh at deploy time and store in a password manager, not
  only in the host's env panel: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `SOCIALS_ENCRYPTION_KEY`. Losing the last one makes every stored social token
  permanently undecryptable; rotating the JWT secrets signs everyone out.
