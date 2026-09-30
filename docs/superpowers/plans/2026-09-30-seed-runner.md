# Seed Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the 40,000-book launch seed (35,000 most popular English editions and 5,000 Portuguese, from Open Library's reading-log ranking) into the production catalog, and let the production cover worker fetch their covers into R2 in the background. It runs entirely on Railway, never on the user's machine, and it never slows down real users.

**Architecture:**
- **Seeding:** a plain-ESM script, `backend/scripts/seed-catalog.mjs`, runs inside the production container under `nohup`. It builds the ranked list with the backend's compiled seed modules and inserts catalog rows, which have no cover yet, into `covers.sqlite` through the compiled repository. SQLite in WAL mode with `busy_timeout` handles the second writer.
- **Cover fetching:** the running server picks those rows up with a **periodic** backfill (every 10 minutes, not only at boot). It queues them on a new **background lane** that drains only when no user-triggered lookup is waiting.
- **Resuming:**
  - Deploys drop the in-memory queue, and the backfill refills it.
  - A killed seed script is simply rerun, because row creation is idempotent by catalog key.

**Tech Stack:** Fastify/TypeScript backend (`backend/src/modules/books`), `node:test`, `node:sqlite`, and the compiled `backend/dist` in production.

**Spec:** the Decisions below (chat, 2026-09-30), plus phase 5 of `docs/superpowers/plans/2026-09-30-launch-catalog-storage-backups.md`. This session owns phase 5; the backups session was told on 2026-09-30.

## Decisions

- **Size:** 40,000 books, as 35k English plus 5k Portuguese. The list comes from `backend/src/modules/books/seed/` (`rankedWorks.ts`, `seedList.ts`), already on `main` (PR #82, #84).
- **It runs on Railway,** not on the user's machine. Claude may start it over `railway ssh` when the user asks; the user's settings allow `railway ssh`.
- **Real users first.** Seed and backfill lookups use a background lane. An on-screen resolve (front) and an import (normal) always go first. A background book that a user asks for is promoted.
- **Source order is Apple → ISBNdb → Open Library** for the exact edition. The user decided this for quality: Apple covers are larger and cleaner. It also keeps ISBNdb to gaps.
- **Gate:** the seed run doesn't start until the ISBNdb trial verdict is in (workflow run 36750726800 and any continuation).
  - If the verdict is **don't subscribe**, the user removes `ISBNDB_API_KEY` on Railway before the run. No ISBNdb covers get stored under the trial's delete-on-cancel terms.
  - If **subscribe**, the key stays, and ISBNdb only fills gaps.
- **Genres from subjects are out of scope.** That's phase 4 of the launch plan.

## Global Constraints

- Minimum code, no new code comments, no new dependencies (root `AGENTS.md`).
- Catch only the specific error you expect. Seed failures are logged with the entry and counted. They never stop the whole run; a failed page aborts only after its retries.
- Open Library politeness, as in `build-seed-list.ts`: 1 request/second, `User-Agent: Atmyshelf/1.0 (book covers)`, a 60 s timeout, and up to 3 attempts on 5xx/429/timeout.
- Every new `*.test.ts` file is appended to `backend/package.json` `"test"`. Backend tests run with `DOTENV_CONFIG_PATH=/nonexistent/.env`.
- Production has no `tsx`. Anything run in the container is `.mjs` importing from `backend/dist/...`, and resolves `@scripta/shared` from a file under `/app/backend`.
- Don't touch `backend/scripts/start-with-litestream.sh`, `backend/litestream.yml`, `http.ts`, `apple.ts` or the catalog adapters.

## Review Focus

1. **A user imports a library while 38,000 seed books are queued.** Their covers are looked up before any remaining seed book. Pinned in Task 1.
2. **A seed book appears on a user's screen.** It's promoted and looked up next, not after the seed. Pinned in Task 1.
3. **Running the seed script twice, or after a crash.** No duplicate catalog rows; existing books are skipped and counted. Pinned in Task 3.
4. **A deploy mid-seed.** The next boot and every 10-minute tick requeue the remaining unchecked books on the background lane, once each. Pinned in Task 2.
5. **ISBNdb isn't first for exact editions.** An ISBN book Apple has never calls ISBNdb. Pinned in Task 2's resolver test.

---

### Task 1: A background lane in the cover worker

**Files:**
- Modify: `backend/src/modules/books/worker.ts`
- Modify: `backend/src/modules/books/booksService.ts:33,97-100,169-171` (`enqueue` dep, `schedule`, `enqueueUnchecked`)
- Modify: `backend/src/modules/books/plugin.ts:59` (wiring)
- Test: `backend/src/modules/books/worker.test.ts`, `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- `CoverWorker.enqueue(bookId: string, priority?: "front" | "normal" | "background"): void`. The default is `"normal"`. It replaces the `front?: boolean` parameter. Update every caller: `"front"` where `true` was passed, and the default elsewhere.
- `BooksServiceDeps.enqueue: (bookId: string, priority?: "front" | "normal" | "background") => void`
- `schedule(bookId, priority = "normal")` in `booksService.ts`. `resolveCover(lookup, front)` maps `front === true` to `"front"`. `enqueueUnchecked()` uses `"background"`.

**Behaviour of the worker:**
- **Two arrays:** `queue` (front and normal, as today) and `background`.
- **Draining:** a slot takes from `queue` first, and from `background` only when `queue` is empty. `SLOTS = 3` and the requeue-on-front logic stay as they are.
- **Enqueueing a book that's already queued in background:**
  - with `"front"` or `"normal"`: move it out of `background` into `queue` (unshift for front, push for normal);
  - with `"background"`: no-op.
- **`"background"` for a book already in `queue` or active:** no-op.
- `stop()` clears both arrays.

- [ ] **Step 1: Write failing tests in `worker.test.ts`**, following the file's existing style. Use a `processBook` that records order and resolves on demand, with `SLOTS` in mind. Keep enough slots busy, or enqueue while the slots are held, so ordering is observable.
  - Background items run only after all normal items queued before or while they wait.
  - A normal item enqueued after 5 background items runs before the remaining background items.
  - Enqueueing a background-queued id as `"front"` runs it next.
  - Enqueueing the same id twice as background runs it once.
  - `stop()` drops background items.
- [ ] **Step 2: Run the tests and see them fail.** Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/worker.test.ts`
- [ ] **Step 3: Implement the worker change, and move callers to the priority parameter.** In `booksService.test.ts`, the existing "enqueueUnchecked queues only the unchecked books, oldest first, with front: false" test becomes `priority "background"`. Its backoff test keeps passing.
- [ ] **Step 4: Run the worker and booksService tests, then `npm run typecheck` and the full suite.**
- [ ] **Step 5: Commit.** Message: `Give seed and backfill lookups a background lane behind users' covers`. The body says that a 40k seed at the back of a single FIFO would have put every new user's import ~2 days behind it.

---

### Task 2: Periodic backfill, and Apple before ISBNdb

**Files:**
- Modify: `backend/src/modules/books/plugin.ts:68` (boot call), plus a timer
- Modify: `backend/src/modules/books/coverResolver.ts:44` (`exactOrder`)
- Test: `backend/src/modules/books/coverResolver.test.ts`, plus a plugin-level test only if the module already has one. Otherwise test the interval function in isolation (see below).

**Behaviour:**
- **Periodic backfill:** `plugin.ts` keeps the boot `service.enqueueUnchecked()`. It also runs it every `BACKFILL_INTERVAL_MS = 10 * 60 * 1000` with `setInterval(...).unref()`, and clears the interval in the existing `onClose` hook.
  - The worker dedupes (Task 1), so repeated ticks don't grow the queue.
  - `schedule` still skips books in backoff.
  - If `enqueueUnchecked` throws (a DB error), let it propagate to the process's normal unhandled-error path. Don't swallow it.
- **Source order:** `exactOrder = [sources.apple, sources.isbndb, sources.openlibrary]`, filtered for null. `titleOrder` is unchanged, and is already Apple-first.

- [ ] **Step 1: Write a failing test in `coverResolver.test.ts`** (follow its fakes). Given an ISBN book where Apple returns a ≥400px candidate and ISBNdb would too, only Apple's `byIsbn` is called, and ISBNdb's `byIsbn` never is. Update any existing test that asserted ISBNdb-first order.
- [ ] **Step 2: Test the interval.** Export the tick scheduling as a small function from `plugin.ts`, e.g. `startBackfill(enqueueUnchecked, intervalMs, timers = { setInterval, clearInterval })` returning a stop function. Test it with fake timers: it fires every interval, the stop function clears it, and the timer is `unref`'d. Use the lightest pattern the module already uses; if there's none, pass the timer functions in.
- [ ] **Step 3: Implement, then run the focused tests, typecheck and the full suite.**
- [ ] **Step 4: Commit.** Message: `Requeue never-checked covers every ten minutes, and try Apple before ISBNdb`. The body says that seed rows inserted by another process need no restart, and that the user chose Apple-first for cover quality, keeping ISBNdb to gaps.

---

### Task 3: The seed script that runs in the container

**Files:**
- Create: `backend/src/modules/books/seed/fetchRankedWorks.ts`. Move the fetch-with-retry and `collect` logic out of `backend/scripts/build-seed-list.ts` so it compiles into `dist`. Export `collectRanked(lang: SeedLanguage, wanted: number, log: (line: string) => void): Promise<SeedEntry[]>`, using the same `PAGE = 1000`, 60 s timeout, `[10_000, 30_000]` retry delays, the 1 s throttle via `createThrottle`, and the `wanted * 1.1` margin.
- Modify: `backend/scripts/build-seed-list.ts`. Import `collectRanked` and keep its CLI behaviour identical.
- Create: `backend/src/modules/books/seed/seedCatalog.ts`. `seedCatalog(entries: SeedEntry[], repo: Pick<BooksRepository, "findBookByKey" | "createBook">, now: () => Date): { created: number; existing: number; invalid: number }`. For each entry:
  1. compute `lookupIdentity({ isbn, title, author })`;
  2. if it's null, count it as `invalid`;
  3. else if `repo.findBookByKey(identity.key)` finds a book, count `existing`;
  4. else `repo.createBook({ title, author, isbn }, identity.key, now().toISOString())` and count `created`. This is the same row `findOrCreate` makes in `booksService.ts:58-63`.

  If a helper there can be shared without restructuring the service, reuse it.
- Test: `backend/src/modules/books/seed/seedCatalog.test.ts`, using the real SQLite repository on a temp `COVERS_DB_PATH`, the way `sqliteBooksRepository.test.ts` does:
  - The first run creates N rows with `cover_status` null, and they show up in `listUncheckedCoverIds()`.
  - A second run creates 0 and reports N existing.
  - An entry with an unusable ISBN and an empty title counts as invalid.
  - Two entries that normalize to the same key create one row.
- Create: `backend/scripts/seed-catalog.mjs`, plain ESM, run from `/app/backend`:
  - Import `collectRanked` and `mergeSeedLists` from `../dist/modules/books/seed/*.js`, the repository and `openBooksDb` from `../dist/modules/books/adapters/sqlite/*.js`, and `seedCatalog` from `../dist/...`. `openBooksDb` reads `COVERS_DB_PATH` from the env the container already has.
  - Flags: `--eng 35000`, `--por 5000`, and `--status`.
    - **Normal run:** build the list with the same Portuguese-first merge as `build-seed-list.ts`. Log progress lines, insert in chunks of 500 (log after each chunk), and print the final `{created, existing, invalid}`.
    - **`--status`:** print counts from `covers.sqlite` of all books grouped by `cover_status` (null, good, low_res, missing, manual), plus how many have a cover image, then exit. Open the database read-only for this.
  - Exit non-zero if the list build fails after retries.
- [ ] **Step 1: Write `seedCatalog.test.ts` first, and see it fail.**
- [ ] **Step 2: Implement `seedCatalog.ts` and `fetchRankedWorks.ts`, and switch `build-seed-list.ts` to `collectRanked`.** Check the switch with `cd backend && npx tsx scripts/build-seed-list.ts --eng 5 --por 5 --out /tmp/seed-smoke.jsonl`, which makes a few real Open Library requests, then delete the file.
- [ ] **Step 3: Write `seed-catalog.mjs`.** Check it:
  1. `cd backend && npm run build` to produce `dist`.
  2. `node --check scripts/seed-catalog.mjs`.
  3. A local run against a temp database: `COVERS_DB_PATH=/tmp/seed-test/covers.sqlite node scripts/seed-catalog.mjs --eng 5 --por 5`, then `--status` on the same path. You should see 10 created, 10 with a null status, and on a rerun 0 created and 10 existing.
  4. Delete `/tmp/seed-test`.

  If `dist` imports fail because of env validation at import time (`config/env.ts`), set the minimum env the error names for this local check only, and report which.
- [ ] **Step 4: Typecheck and run the full suite. Commit.** Message: `Add a seed script that loads the ranked launch list into the catalog from inside the container`.

---

### Task 4: Docs

**Files:**
- Modify: `backend/README.md`:
  - In the `books` section, add the background lane, the 10-minute backfill and the Apple-first exact order. Update the existing bullets that say "ISBNdb → Apple → Open Library" and "on boot the plugin re-queues…".
  - Add a short "Seeding the catalog" subsection with the run and status commands (below), the ISBNdb gate, and that rerunning is safe.
  - In "Known limitations…", point the "catalog is small" bullet at the seed.
- [ ] Commit: `Document the seed runner, background lane and Apple-first cover order`.

---

### Task 5: Run it (controller, after the gate)

1. **Wait for the ISBNdb trial verdict.** If it's "don't subscribe", the user removes `ISBNDB_API_KEY` on Railway, and the next deploy picks that up.
2. **Merge and deploy.** Merge the branch. Confirm Railway deployed the merge commit: `deployment list`, and the redirect probe still answers 301.
3. **Start the seed in the container,** detached so it survives the ssh session:

   ```bash
   cd /Users/andreribeiro/Documents/scripta && npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && nohup node scripts/seed-catalog.mjs > /data/seed-catalog.log 2>&1 & echo started'
   ```

   The log goes to `/data`, so it survives a restart. A deploy during the list build kills the script: rerun it, and the rows already created are skipped.
4. **Check progress** any time:

   ```bash
   cd /Users/andreribeiro/Documents/scripta && npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'tail -3 /data/seed-catalog.log; cd /app/backend && node scripts/seed-catalog.mjs --status'
   ```

   Covers then fill at roughly 1,000–3,000 books an hour. That's Apple's rate limit, with 3 worker slots overlapping sources. So the full 40k takes about 1–2 days.
5. **Afterwards,** measure how much of a real library the catalog covers (launch plan phase 6).
