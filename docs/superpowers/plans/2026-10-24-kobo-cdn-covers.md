# Kobo CDN Covers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog books learn the Kobo `ImageId` that Kobo imports already carry, and the cover lookup tries Kobo's own CDN first for them; libraries imported before this get the same through a daily backfill.

**Architecture:** Books module only for the lookup (a `books.kobo_image_id` column, a `kobo` step at the head of `findBestCover`, recording in `enqueueCovers` and a new `recordKoboImageIds`). The library module exposes one read (`koboCoverLookups`) that `app.ts` injects into the books plugin, as it already injects `heldWorks`. No route or client changes.

**Tech Stack:** TypeScript, Fastify, `node:sqlite`, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-24-kobo-cdn-covers-design.md`

## Global Constraints

- `koboCoverUrl(id)` returns exactly `https://cdn.kobo.com/book-images/${encodeURIComponent(id)}/1200/1800/false/image.jpg`.
- An id is used only if `normalizeImageId` from `@scripta/shared` returns it non-empty. Use that function; don't write another UUID check.
- `books.kobo_image_id` is written only when it is NULL. Nothing ever overwrites or clears it.
- `recordKoboImageIds` never schedules a book because it is due. Only a book whose id was just recorded, whose status is `missing` or `low_res`, and which is not due, is marked upgrade-wanted and scheduled on `upgrade`.
- `enqueueCovers` keeps today's due-book scheduling on the normal lane unchanged.
- `lookupSchema` in `routes.ts` is not changed.
- No comments in code. New `*.test.ts` files go into `backend/package.json`'s `test` script; prefer adding to the existing test files listed below.
- Verify each task with `node scripts/gate.mjs` before committing (it runs `npm run build --workspace @scripta/shared`, backend typecheck and tests).

## Review Focus

- **No quota spent by the backfill on merely-due books.** Task 1 tests that `recordKoboImageIds` on a due book with no id (status NULL) records the id and enqueues nothing.
- **First id wins.** Task 1 tests that a second, different id for the same book leaves the first.
- **Good and manual covers untouched.** Task 1 tests that recording an id on a `good` or `manual` book marks nothing and enqueues nothing.
- **Kobo first, exact.** Task 1 tests that a Kobo candidate of 400 px or more ends `findBestCover` before any other source is asked, that a title mismatch doesn't block it, and that a rejected Kobo URL is skipped.
- **Junk ids ignored.** A sideloaded file path in `ImageId` records nothing (Task 1 in books, Task 2 in `koboCoverLookups`).

---

### Task 1: Kobo cover step and id recording in the books module

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/domain/normalize.ts`
- Create: `backend/src/modules/books/adapters/sources/kobo.ts`
- Modify: `backend/src/modules/books/coverResolver.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`
- Test: `backend/src/modules/books/adapters/sources/sources.test.ts`
- Test: `backend/src/modules/books/coverResolver.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

- [ ] **Schema.** Add `kobo_image_id TEXT` to the `books` table in `books.sql`, and in `applyBooksMigrations` add it to an existing database with the same `columns.some(...)` / `ALTER TABLE books ADD COLUMN` pattern as `apple_checked_at` (`connection.ts:36`). Add `kobo_image_id: string | null` to `BookRow` in `domain/types.ts`. Repository test: an old database (drop the column, as `sqliteBooksRepository.test.ts` does for other columns) gets it back on `applyBooksMigrations`.
- [ ] **Repository.** Add `setKoboImageId(bookId: string, imageId: string): boolean` to `BooksRepository` (`domain/ports.ts`) and the SQLite repository: `UPDATE books SET kobo_image_id = ? WHERE id = ? AND kobo_image_id IS NULL`, returning whether a row changed. Test: it sets a NULL column, returns `true`; a second call with another id returns `false` and leaves the first.
- [ ] **Types.** `CoverSourceName` (`types.ts:5`) gains `"kobo"`, and so does `CoverCandidate.source` (`ports.ts`). `BookLookup` (`normalize.ts:40-44`) gains `imageId?: string | null`.
- [ ] **URL.** Create `adapters/sources/kobo.ts` exporting `koboCoverUrl(imageId: string): string` per the Global Constraints. Test it in `sources.test.ts`.
- [ ] **Resolver.** `findBestCover`'s first parameter becomes `{ isbn; title; author; koboImageId?: string | null }`. When `koboImageId` is set, push a first step returning `[{ source: "kobo", url: koboCoverUrl(koboImageId) }]` ahead of the ISBN steps. Tests in `coverResolver.test.ts` (use its helpers): a ≥400 px Kobo image is returned and no source's `byIsbn`/`byTitle` is called; a Kobo image under 400 px is kept as best while the other sources are still asked and a wider one wins; a Kobo URL in `rejected` is skipped; no `koboImageId` means no Kobo candidate.
- [ ] **processBook.** Pass `koboImageId: book.kobo_image_id` to `findBestCover`. Test in `booksService.test.ts` with the `harness()`: a book with an id and a `sizes` entry for its Kobo URL gets a `good` cover whose `cover_images.source` is `kobo`.
- [ ] **Recording.** In `createBooksService`, a helper takes a `BookRow` and a lookup. When `normalizeImageId(lookup.imageId)` is non-empty and `repo.setKoboImageId(book.id, id)` returns `true`, and `book.cover_status` is `missing` or `low_res`, and `!lookupDue(book)`, call `repo.setUpgradeWanted(book.id, now().toISOString())` and `schedule(book.id, "upgrade")`. `enqueueCovers` calls it for each book before its existing due check. Add `recordKoboImageIds(lookups: BookLookup[]): void` to the `BooksService` interface: for each lookup, `findOrCreateBook`, then the helper, nothing else. Tests:
  - `enqueueCovers` with a new book and an id: the row has the id, and the book is enqueued `normal` once.
  - `recordKoboImageIds` on a book `missing` and checked yesterday: id stored, `cover_upgrade_wanted_at` set, enqueued `upgrade`.
  - `recordKoboImageIds` on a book with no status (due): id stored, nothing enqueued.
  - `recordKoboImageIds` on a `good` book and on a `manual` book: id stored, nothing marked or enqueued.
  - A junk id (`file____mnt_onboard_x.epub`): nothing stored.
  - A second, different id: the first stays, nothing enqueued the second time.
- [ ] **Throttle.** In `plugin.ts`, add `KOBO_COVER_GAP_MS = 1000` beside the other gaps and a `createThrottle(KOBO_COVER_GAP_MS)` that `fetchImage` uses for `candidate.source === "kobo"`, the way it uses `openLibraryCoverThrottle` for `openlibrary`.
- [ ] **README.** In `backend/README.md`'s `books` section, say in the covers bullets that a book with a Kobo image id (`books.kobo_image_id`, recorded from Kobo imports, first id wins) tries `cdn.kobo.com` first in every lane, as an exact match, 1 request/s.
- [ ] Run `node scripts/gate.mjs`, then commit.

### Task 2: Backfill from imported libraries

**Files:**
- Modify: `backend/src/modules/library/workHolders.ts`
- Modify: `backend/src/modules/library/index.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/README.md`
- Modify: `docs/publisher-catalog.md`
- Test: `backend/src/modules/library/workHolders.test.ts`
- Test: `backend/src/booksWiring.test.ts`

- [ ] **Library read.** In `createWorkHolders` (`workHolders.ts`), add a prepared `SELECT DISTINCT isbn, title, author, image_id FROM library_books WHERE image_id IS NOT NULL` and `koboCoverLookups(): Array<{ isbn: string | null; title: string | null; author: string | null; imageId: string }>`, keeping only rows where `normalizeImageId(image_id)` is non-empty (returning the normalized id). Add the module-level `koboCoverLookups()` wrapper the same way `heldWorks()` has one (`workHolders.ts:79-82`), and export it from `library/index.ts`. Test in `workHolders.test.ts` with its existing setup: two users holding the same Kobo book give one lookup; a sideloaded path and a NULL `image_id` give none.
- [ ] **Books plugin job.** Add `koboCoverLookups?: () => BookLookup[]` to `BooksPluginOptions`. Add `koboCovers: 165_000` to `FIRST_RUN_DELAY_MS`. When the option is set, register `jobs.every("kobo covers", <24 h>, () => timeSync(app.log, "kobo-covers", () => service.recordKoboImageIds(koboCoverLookups())), FIRST_RUN_DELAY_MS.koboCovers)`. Reuse an existing 24-hour constant if one fits (`GROUPING_INTERVAL_MS` in `backfill.ts` is a works-grouping name; prefer a local `KOBO_COVERS_INTERVAL_MS = 24 * 60 * 60 * 1000`).
- [ ] **Wiring.** In `app.ts`, import `koboCoverLookups` from the library index and pass it in `registerBooksModule`'s options next to `heldWorks`.
- [ ] **Boot test.** In `booksWiring.test.ts`'s "every books job arms its first run with its own delay…" test, add `koboCovers: 165_000` to `expected`. Its no-network assertion stays as is, and add `cdn.kobo.com` to its URL pattern so a Kobo fetch before a first run fails the test.
- [ ] **Docs.** In `backend/README.md`, add the `kobo covers` job to the background jobs description (daily, after its first-run delay, records ids from every library and marks books with a `missing` or `low_res` cover for an upgrade, spending no ISBNdb or Open Library quota). In `docs/publisher-catalog.md`'s "Automatic sources" table, add a **Kobo** row: used for covers of books imported from Kobo, keyed by `ImageId`, first in every lane, no key, 1 request/s, and that what the CDN answers for an unknown id and whether it upscales are unverified.
- [ ] Run `node scripts/gate.mjs`, then commit.
