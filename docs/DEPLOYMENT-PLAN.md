# Scripta — deployment plan

Working plan for taking Scripta from a local dev setup to a public, multi-user
web app. Written against commit `97077cf`.

A rendered version of this plan lives at
<https://claude.ai/code/artifact/aa90e665-d96c-475b-8fe4-8a5e8870242c> (private
link — same content, easier to read).

> **Scope note.** An earlier draft of this plan assumed Scripta was a personal
> install, because that is how the READMEs describe it. It is not: it is meant
> to be distributed and used by other people. Everything below assumes that.

## Status

| Phase | State |
|---|---|
| 1 — Normalise the library | **Done** (slices 1 & 2). Slice 3 deliberately deferred, see below. |
| 2 — Correctness gaps | **Done.** |
| 3 — State off the instance | **Partial.** `library` and `auth` are on Postgres and blobs are on object storage; `gallery`, `covers` and `socials` are still SQLite, so the volume is still required. |
| 4 — Domain, hosting, pipeline | **Pipeline and container done. Domain and hosting are yours to choose.** |
| 5 — Reconsider the frontend | Not started; a product decision, not a technical blocker. |

**What still needs a human, not a commit:**

- Buy the domain and decide the two hostnames. Nothing else in phase 4 can be
  finalised first — the OAuth redirect URIs depend on it.
- Choose and create the hosting accounts, then set `DEPLOY_ENABLED`, `API_URL`
  and the deploy secrets. The deploy workflow is inert until you do.
- Generate the three production secrets and store them in a password manager.
- Register the OAuth apps, one platform at a time. Google sign-in and the
  Hardcover lookup have still never run against real credentials.
- Schedule the backup (below) and store the three secrets somewhere that is not
  the backup.

**Deliberately not done, with reasons:**

- **Postgres adapters for `gallery`, `covers` and `socials`.** Until these
  exist the API cannot run more than one instance, so replicas and zero-downtime
  deploys are still out of reach. `auth` and `library` are done.

- **Slice 3 (retire the document endpoint and the legacy table).** The plan
  itself said "once the per-entity API has been live long enough to trust" —
  it has been live for zero minutes. Deleting the compatibility layer and the
  rollback path before either has seen production would remove the safety net
  precisely when it is most needed.

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

  **All six per-entity routes now exist** (`PUT`/`DELETE` for books, groups and
  murals), and every single-entity write on the frontend uses them: group CRUD
  and membership, mural CRUD and block editing, per-book style and covers.
  Renaming a group is a ~156-byte request instead of the whole library.

  **Deliberately still on the document endpoint**, because these genuinely span
  the whole document rather than one entity: the import merge, the drag reorder
  (which can renumber every book), the library-wide name and style, and the
  multi-book delete that must also scrub those books out of every group and
  mural in the same write. Splitting those would mean several requests that must
  either all land or all roll back — a transaction the document endpoint already
  gives for free.
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

Migrating an existing deployment: `scripts/sqlite-to-postgres.mjs --sqlite
<library.sqlite> --auth-sqlite <auth.sqlite>`, run with the app stopped (there is
no dual-write mode). Accounts are copied row-for-row rather than through the
repository port — `createUser` would mint fresh ids, breaking every foreign key
and every library row keyed on the old one. Live refresh tokens come across so
the migration doesn't sign everyone out; expired and revoked ones are left
behind, since they grant nothing. It reads through the SQLite adapter
and writes through the Postgres one — both via the same port and the same
document mapping the app itself uses, rather than a bespoke SQL-to-SQL copy that
could drift from either. Every account is verified after writing by reassembling
the document from Postgres and deep-comparing it to the SQLite original; a
mismatch fails that account rather than reporting success. Non-destructive and
re-runnable. Verified here against a seeded 3-account / 400-book / 1,197-highlight
database, and the app was then booted against Postgres and round-tripped over
HTTP.

**Object storage: done.** `adapters/s3/` in both `gallery` and `covers` implement
the existing `ImageBlobStore` / `CoverBlobStore` ports; set `S3_BUCKET` and both
move off local disk. Written against the S3 API, so R2, B2, MinIO and AWS all
work — R2 is the recommendation (zero egress, and covers are served on every page
view). Both ports had to become async for the same reason the library port did.

**The API is not stateless yet**, though it is closer. `DATABASE_URL` now
switches **`library` and `auth`** to Postgres, and `S3_BUCKET` moves the blobs.
Still SQLite-only: `gallery` metadata, the `covers` cache rows, and `socials`
(encrypted platform tokens).

So **the volume is still required** and the app still cannot run more than one
instance. But the nature of what's left changed: `auth` was the one whose loss
was unrecoverable and whose divergence across two instances would have been
catastrophic. What remains is one cache (`covers`, genuinely disposable),
image metadata, and social connections.

An earlier draft of this plan claimed setting `DATABASE_URL` and `S3_BUCKET`
made the app stateless. It did not, and `fly.toml`/`Dockerfile` had turned that
into an instruction to delete the volume — which would have destroyed every
account. Both are fixed.

Migrating existing local files: `scripts/files-to-object-storage.mjs`, run with
the app stopped. It writes through the same adapters the app uses, so the keys
are guaranteed to be the ones the app will later look for, and verifies each file
by reading the object back and comparing bytes. It never deletes local files —
verify the app serves images from the bucket before removing them, because
gallery uploads are user-supplied and exist nowhere else.

**Residual gap worth knowing:** the adapters are tested against `s3rver`, a real
S3-protocol server, so request signing, path-style addressing, content types,
missing-key handling and body streaming are genuinely exercised — but `s3rver` is
not R2. Providers differ in how they report a missing key (AWS returns 403 rather
than 404 without ListBucket permission, which `shared/s3/client.ts` handles). Do
one real upload/read/delete against the actual bucket before launch; that is now
a smoke test rather than the code's first ever run.

Storage sizing is its own argument: the gallery quota is **500 MB per account**
(`modules/gallery/service.ts`), so a thousand users is potentially half a
terabyte — priced very differently as a block volume than as object storage.

Do it before there is other people's data. With three users it is an afternoon;
with three thousand it is a dual-write period, a migration window, and a rollback
plan.

### Backups *(done)*

`scripts/backup.mjs` (`npm run backup`) takes a consistent, verified snapshot of
everything this deployment stores:

- **All four-or-five SQLite databases**, via SQLite's online `backup()` API
  rather than a file copy — a plain copy of a live database can capture a torn
  page, and copying the `.sqlite` without its `-wal` silently loses the most
  recent writes. Each snapshot is then opened, taken out of WAL mode (so it is
  one self-contained file, not three that must travel together) and checked with
  `PRAGMA integrity_check` before being counted as good.
- **Postgres**, via `pg_dump`, when `DATABASE_URL` is set.
- **Blob directories**, tarred, when they are on local disk. When they are in
  object storage they are deliberately *not* copied: R2/S3 already replicate, and
  the real risk is an accidental delete, which a nightly copy doesn't protect
  against either — **enable bucket versioning** instead.
- A **manifest** recording what was captured and, importantly, what was not:
  `SOCIALS_ENCRYPTION_KEY` (without which every social token in the snapshot is
  undecryptable) and the JWT secrets. Keep those in a password manager, not in
  the backup.

`--upload` pushes the snapshot to the bucket under `backups/<timestamp>/`;
`--keep N` prunes old local snapshots. The script exits non-zero if any target
fails, so a scheduled run surfaces as a failure rather than a green tick over a
partial backup.

**Verified by actually restoring**: the test suite snapshots live WAL databases
and reads the data back, and a full disaster drill was run by hand — wipe the
volume, drop the Postgres database, restore from the snapshot, and confirm all
five modules' data came back intact.

Scheduling it is host-specific and is yours to set up:

```
# Fly: a scheduled machine, separate from the one serving traffic
fly machine run --schedule daily --volume scripta_data:/data \
  <image> npm run backup -- --upload --keep 7

# Anywhere with cron
0 3 * * *  cd /app && npm run backup -- --upload --keep 7
```

Whatever you choose, **test a restore before you need one**. An untested backup
is a guess.

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
