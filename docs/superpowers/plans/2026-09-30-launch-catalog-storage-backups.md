# Launch plan: backups, image storage and a seeded book catalog

Target: public launch in 1–2 months. Written 2026-09-30.

## Why

A tester imported 167 books and waited about 20 minutes for covers. The server was never slow (`/covers/resolve` p50 1 ms). Two things were:
- **The cover lookups.** An unknown book costs 4–10 s of rate-limited Apple / Open Library calls, one book at a time.
- **An almost empty catalog.** It held 246 books, 167 of them the tester's own, so a new user hits the network for nearly everything.

Launching with a big seeded catalog avoids that. Two prerequisites come first:
- **Room for the images.** Covers average 212 KB (full + thumb) and the Railway volume is 500 MB, so it can't hold more than about 2,200 covers.
- **Backups.** Nothing backs up `/data` today, so losing the volume loses every account and library.

Details and measurements for the cover pipeline are in `backend/README.md`, "Known limitations of covers, details and search".

## Decisions made

- **SQLite stays.** Every module is already in WAL mode, and one server with SQLite comfortably covers launch scale. Move to Postgres only when one of these shows up:
  - we need a second server instance,
  - synchronous queries visibly stall the API,
  - another service needs the data, or
  - we need managed features such as point-in-time restore or replicas.
- **Every file moves to R2:** covers, gallery uploads and avatars. The Railway volume keeps only the SQLite databases.
  - On 2026-09-30, `/data` held 30 MB in total, of which covers were about 22 MB. That leaves the databases at about 8 MB.
  - Estimates, to measure after phase 1: about 1–3 KB per seeded catalog book with genres and summary (so 50,000 books is about 50–150 MB), and about 1–2 KB per book in a user's library.
  - The 500 MB volume therefore holds a 50,000-book catalog plus thousands of users. Railway can also grow the volume when that stops being true.
  - Litestream keeps its snapshots in R2, not on the volume.
- **Old image URLs may break.** The app is pre-launch, so there is no redirect route and no copy of existing files; covers re-resolve.
- **Backups are Litestream streaming every SQLite file to R2,** not Railway's daily volume snapshots.

## Open decisions (needed before phase 5)

- **Seed size:** about 10,000 books or about 50,000. At Apple's rate limit that's about 1,000 books/hour, so roughly overnight versus about two days.
- **Seed languages and markets:** English plus Portuguese? Others?
- **Seed source lists:** which bestseller or most-read lists, per language.

## Phases

### 0. Put the quizzes database on the volume. Done 2026-09-30.
`QUIZZES_DB_PATH` wasn't set on Railway, so it defaulted to `./data/quizzes.sqlite` inside the container. That is outside `/data`, and every deploy wiped it. It's now set to `/data/quizzes.sqlite` on the `scripta` service. Quizzes created before this were already lost. `WAITLIST_DB_PATH` is fine: it defaults beside `AUTH_DB_PATH`. After this, every `*_DB_PATH` must point into `/data`. Phase 1's config should fail the deploy if one doesn't.

### 1. R2 setup and Litestream backups. Done 2026-09-30.
Buckets `atmyshelf-images` (on `images.atmyshelf.com`) and `atmyshelf-backups`, both WEUR, were created. PR #80 added Litestream 0.5.17. PR #83 added the rollback runbook and 14-day retention. Deployed at `139268d4`: all 11 databases replicate. A restore of all 11 from R2 into `/tmp` in the container passed `PRAGMA integrity_check`. The original steps follow for reference.

- **User:**
  - Create two R2 buckets: one for images, public, on a custom domain such as `covers.atmyshelf.com`; one for backups, private.
  - Create an R2 API token scoped to both buckets.
  - Set the key id, secret, account endpoint and bucket names as Railway variables.
- **Litestream in the image.**
  - Railway builds with Railpack (`railway.json`). Either download the pinned Litestream release binary in `buildCommand`, or switch the service to a Dockerfile.
  - Pick whichever keeps the build simplest, and pin the version.
- **Config.**
  - `litestream.yml` lists every SQLite file under `/data`: auth, waitlist, library, gallery, murals, covers, socials, arena, tierlists, quizzes and community.
  - Each replicates to the backups bucket through R2's S3 endpoint, with credentials from env.
- **Start command.**
  - `litestream replicate -exec "node dist/server.js"`, so replication runs alongside the server and stops with it.
  - Before that, restore each database that's missing locally (`litestream restore -if-db-not-exists -if-replica-exists`). A fresh volume then comes back from R2 on its own.
- **Checkpoints.** Litestream needs to own WAL checkpointing. Check the connection pragmas in each `adapters/sqlite/connection.ts` for anything that conflicts: explicit `wal_checkpoint` calls, or a `wal_autocheckpoint` setting.
- **Verify.**
  - Deploy, and confirm objects appear in the backups bucket.
  - Restore every database into a scratch directory from a laptop with `litestream restore`, and open each read-only to check row counts.
  - Write the restore procedure into `backend/README.md`.

### 2. Images to R2
- **Covers.** Add an R2 implementation of `CoverBlobStore` (`backend/src/modules/books/domain/ports.ts`).
  - The port is synchronous today, and R2 isn't, so the port and its callers become async.
  - Upload with `Cache-Control: public, max-age=31536000, immutable`.
- **URLs.** `publicUrlFor` returns the R2 public-domain URL, and `GET /covers/cached/:id/:size` is removed.
- **Gallery uploads and avatars** move to the same bucket the same way, each behind its own module's port. Modules stay isolated: each gets its own adapter instance, and nothing crosses module boundaries.
- **Clean up.** Delete `COVERS_STORAGE_PATH`, `GALLERY_STORAGE_PATH` and `AVATAR_STORAGE_PATH` and their files from the volume once it's verified.
- **Clients.** Check them for hard-coded `/covers/cached/` paths, and for cached URLs that need a one-time cache bust. The covers resolver cache in AsyncStorage keeps URLs for 7 days.

### 3. Faster lookups
- **Worker slots.** Run 2–3 worker slots. The per-source throttles still hold each source to its rate limit, so the gain comes from overlapping different sources.
- **Apple fan-out.** Trim Apple's storefront fan-out (pt, us, br), for example by trying the storefront matching the book's language first and stopping at the first hit.
- **Separate throttle.** Give the catalog (`/books/details`) its own Open Library throttle, so genre lookups stop slowing cover lookups.

### 4. Genres from Open Library's bulk data
Import subjects from Open Library's CC0 works dump into the catalog. Seeded and future books then get genres with no network call. Keep only what the catalog uses, so the database stays small.

### 5. Seed runner
- **Command.** A backend command that reads a list of `{isbn?, title, author}`, creates catalog rows through the same `lookupIdentity` / `findOrCreate` path, and queues their covers at the back.
- **Resilience.** It's safe to stop at any point: the boot backfill (PR #76) re-queues never-checked books after a deploy.
- **Pacing.** Run it off-peak, and keep it at the back of the queue so real users' on-screen covers always jump ahead.
- **The list** comes from the open decisions above.

### 6. Measure and repeat
After seeding, measure how many of a new user's books are already in the catalog. Use a real import, or a sample library through the read-only count script (`railway ssh`, run by the user). Seed further where coverage is thin, particularly books without ISBNs, which match on title + author only.

### Before 2026-12-01: move Railway config off `railway.json`
- **Why:** Railway's CLI warns that Config as Code (`railway.json`) stops working on 2026-12-01, inside the launch window. After that, deploys would lose the build command, the start command (Litestream) and the health check.
- **Seen on 2026-09-30:** a redeploy triggered by a variable change already ran without them and failed with "No start command detected".
- **Options:**
  - migrate with `railway config migrate` to `.railway/railway.ts`, or
  - set the build command, start command and health check path in the service settings.
- **Verify** with a deploy triggered both by a commit and by a variable change.

## Already done
- PR #75: covers queued at import, and one batched poll every 3 s.
- PR #76: never-checked covers re-queued on boot, plus the limitations write-up.
- PR #77: inside/outside book search.
- PR #79: ISBNdb feeds book details and external search, not only covers, and every catalog row records its sources in `books.data_sources`. `ISBNDB_API_KEY` was set on Railway on 2026-09-30. The integration still has to be checked against real responses: a search by ISBN, a search by title, and a details view.
