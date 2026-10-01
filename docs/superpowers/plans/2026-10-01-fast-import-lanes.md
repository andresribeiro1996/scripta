# Fast Import Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user's import or on-screen cover never waits on Apple. Apple allows ~1 request / 3.2 s for the whole server, so concurrent imports would queue for hours. User-facing lookups use the catalog, ISBNdb and Open Library. Apple is used only in the background: to upgrade users' weak covers first, then for the seed.

**Architecture:**
- **Lanes.** The cover worker gains an **upgrade** lane, between normal and background. The `upgrade` and `background` lanes are the "Apple lanes": together they run at most 1 lookup at a time.
- **The worker passes the lane** to `processBook(bookId, lane)`. The books service picks a source set per lane and hands it to the unchanged `findBestCover`, whose order is Apple → ISBNdb → Open Library. A lane without Apple just passes a source that returns nothing.
  - **Fast** (front, normal): ISBNdb → Open Library.
  - **Upgrade:** Apple only.
  - **Background:** Apple → ISBNdb → Open Library.
- **When a fast lookup ends weak,** the book is queued on the upgrade lane. Weak means a missing or low-res cover, or an ISBNdb cover of a Portuguese or Brazilian edition.

**Tech Stack:** Fastify/TypeScript, `node:test`, backend `books` module.

**Spec:** the Decisions below (chat, 2026-10-01), building on `docs/superpowers/plans/2026-09-30-seed-runner.md`.

## Decisions

- **The user is on ISBNdb's cheapest paid plan:** about 1 request/s, and bulk lookup is assumed unavailable. `ISBNDB_GAP_MS` stays at 1,100.
- **Lanes, highest first:** `front` > `normal` > `upgrade` > `background`. `upgrade` and `background` together run at most 1 lookup at a time. `front` and `normal` may use all 3 slots.
- **Promotion:**
  - A `background` book asked for as `front` or `normal` is promoted to the fast lane, as today.
  - An `upgrade` book asked for as `front` or `normal` stays where it is: it already has a cover.
  - A book already queued `front`/`normal` or active ignores `upgrade` and `background` requests.
- **Source sets per lane:**
  - **Fast** (`front`, `normal`): `{ apple: none, isbndb, openlibrary }`.
  - **Upgrade:** `{ apple, isbndb: null, openlibrary: none }`.
  - **Background:** `{ apple, isbndb, openlibrary }`.

  `none` is a `CoverSource` whose `byIsbn` and `byTitle` both return `[]`. When `ISBNDB_API_KEY` is unset, `isbndb` is `null` as today, so the fast lane falls back to Open Library alone.
- **Upgrade trigger.** After a **fast**-lane `processBook` that completes (`outcome.complete`), queue the book on `upgrade` when any of these holds:
  - the final status is `missing` or `low_res`;
  - the final cover's `source === "isbndb"` and the book's ISBN is Portuguese or Brazilian.

  Portuguese or Brazilian means: normalized ISBN-13 starts with `97885`, `97865`, `978972` or `978989`; ISBN-10 starts with `85`, `65`, `972` or `989`.
- **Upgrade replacement.** An upgrade-lane lookup that finds an Apple cover stores it and moves the pointer when any of these holds:
  - there's no current cover;
  - Apple's width is greater than the current cover's;
  - the current cover is a Portuguese or Brazilian ISBNdb cover and Apple's is ≥ 400 px. That's the watermark case.

  Otherwise nothing changes. Either way, if the lookup completed, it records `cover_checked_at`. Upgrade results **never** queue another upgrade, so there are no loops.
- **Unchanged:**
  - The boot and 10-minute backfill still queue never-checked books on `background`.
  - The seed is still background.
  - Manual covers are never touched.

## Global Constraints

- Minimum code, no new code comments, no new dependencies (root `AGENTS.md`).
- Catch only the specific errors you expect. `SourceUnavailableError` keeps today's backoff behaviour.
- Every new `*.test.ts` file is appended to `backend/package.json` `"test"`. Tests run with `DOTENV_CONFIG_PATH=/nonexistent/.env`.
- Don't touch `http.ts`, `apple.ts`, the catalog adapters, `start-with-litestream.sh` or `litestream.yml`.

## Review Focus

1. **A user's 300-book import during a 38k seed backlog.** No Apple call happens on the import's behalf before every import book has had its fast lookup. Pinned in Tasks 1 and 2.
2. **A Portuguese ISBNdb cover gets replaced by Apple's,** even when Apple's is narrower but ≥ 400 px, and an English ISBNdb cover does not. Pinned in Task 2.
3. **A book Apple can't improve isn't queued again and again.** No upgrade loops. Pinned in Task 2.
4. **No ISBNdb key (`isbndb: null`).** The fast lane still answers through Open Library, and weak results upgrade through Apple. Pinned in Task 2.
5. **`upgrade` before `background`, and the Apple lanes together capped at 1.** Pinned in Task 1.

---

### Task 1: Upgrade lane in the worker, and the lane passed to `processBook`

**Files:**
- Modify: `backend/src/modules/books/worker.ts`
- Modify: `backend/src/modules/books/plugin.ts` (the `createCoverWorker` wiring)
- Test: `backend/src/modules/books/worker.test.ts`

**Interfaces:**
- `export type CoverPriority = "front" | "normal" | "upgrade" | "background"`
- `createCoverWorker(processBook: (bookId: string, lane: CoverPriority) => Promise<void>, onError)`. The lane passed in is the one the item was **taken from**: `"front"` or `"normal"` for queue items. Track it per queued item, e.g. keep a `Map<string, CoverPriority>` for queue items, or store `{ id, lane }`. Keep `queued` dedupe and the O(1) lazy-deletion pattern already used for `background`, and apply it to `upgrade` too.
- `next()` order:
  1. `queue` (front and normal);
  2. `upgrade`, only when Apple-lane running is 0;
  3. `background`, only when Apple-lane running is 0.
- One counter, renamed from `backgroundRunning` to an Apple-lane counter, covers `upgrade` and `background` together.
- Promotion as in Decisions. `requeue` (front while active) is unchanged.

- [ ] **Step 1: Write failing tests**, using the file's held-slot style:
  - `upgrade` items run before `background` items queued earlier;
  - `upgrade` and `background` together never exceed 1 concurrent;
  - normal still uses 3 slots while an upgrade runs;
  - a `normal` request for an id queued in `upgrade` leaves it in `upgrade` and doesn't run it twice;
  - `processBook` receives the lane the item was taken from (`"front"`, `"normal"`, `"upgrade"`, `"background"`), including `"normal"` for a background item promoted by a normal request.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3:** Implement. Update `plugin.ts` to pass the lane through to `service.processBook(bookId, lane)`.
- [ ] **Step 4:** Run the focused tests, `npm run typecheck` and the full suite. Typecheck fails until Task 2 adds the `lane` parameter: if so, accept it as an optional second parameter in `BooksService.processBook` within this task, default `"background"` to keep today's behaviour, and say so.
- [ ] **Step 5: Commit.** Message: `Add an upgrade lane ahead of the seed and tell processBook which lane a book came from`.

---

### Task 2: Source sets per lane, the upgrade trigger and replacement

**Files:**
- Modify: `backend/src/modules/books/booksService.ts` (`processBook`, ~174-204)
- Modify: `backend/src/modules/books/domain/normalize.ts`: add `isPortugueseIsbn(isbn: string | null): boolean`, using the prefixes in Decisions.
- Test: `backend/src/modules/books/booksService.test.ts`, `backend/src/modules/books/domain/normalize.test.ts`

**Behaviour:**
- `processBook(bookId, lane)`:
  - Choose the source set from Decisions. Build the `none` source once.
  - Call `findBestCover` with it, as today.
  - **Fast lanes:** keep today's store / status / backoff logic. After a completed lookup, decide the upgrade trigger and call `schedule(bookId, "upgrade")`. Respect backoff the same way `schedule` does.
  - **Upgrade lane:**
    - Apply the replacement rule, comparing against the current image's width and `source` (`getImage`).
    - Store through the existing `storeImage`, blobs before rows.
    - Set status from the resulting width.
    - If the lookup didn't complete, keep today's backoff.
    - Never queue another upgrade.
  - **Background lane:** behaves exactly as today, with the full chain, then the store/status logic.
- `resolveCover`'s schedules stay `front`/`normal`, and `enqueueUnchecked` stays `background`. Add `"upgrade"` to the `schedule` priority type.
- The `rejectCover` admin flow requeues `front`, as today.

- [ ] **Step 1: Write failing tests**, following booksService.test.ts's fakes. Use per-source fakes that record calls.
  - A fast-lane lookup calls ISBNdb, and Open Library if needed, never Apple.
  - A fast lookup whose ISBNdb cover is ≥ 400 px on an English ISBN finishes `good` and queues no upgrade.
  - The same on a `97897…` ISBN queues `upgrade`.
  - A fast lookup ending `missing` or `low_res` queues `upgrade`.
  - An upgrade lookup calls only Apple. It replaces:
    - a missing cover;
    - a narrower cover;
    - a Portuguese ISBNdb cover with a ≥ 400 px Apple cover that is narrower.

    It keeps an English ISBNdb cover that's wider than Apple's. It queues nothing afterwards.
  - With `isbndb: null`, the fast lane uses Open Library, and a `low_res` result queues `upgrade`.
  - A background lookup calls Apple first.
  - `isPortugueseIsbn` covers both ISBN-13 and ISBN-10 prefixes, plus null and English cases.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3:** Implement. Remove any temporary default added in Task 1 if the plugin now always passes the lane.
- [ ] **Step 4:** Run the focused tests, typecheck and the full suite.
- [ ] **Step 5: Commit.** Message: `Answer users from ISBNdb and Open Library, and upgrade weak covers through Apple in the background`. The body explains that Apple's ~1 request / 3.2 s limit is shared by every user, so it can't sit in an import's path.

---

### Task 3: Docs

- [ ] `backend/README.md`, books section:
  - describe the four lanes, the per-lane source sets, the upgrade trigger and the replacement rule;
  - replace the line saying the exact-edition order is Apple → ISBNdb → Open Library with the per-lane version;
  - in "Known limitations…", note that a user's import is now bound by ISBNdb's plan rate (about 1/s on the cheapest plan, ~18 min per 1,000 uncatalogued books) and no longer by Apple.
- [ ] Commit: `Document the fast import lanes and Apple upgrades`.
