# Held BNP Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The details backfill looks up `created_by = 'bnp'` books with no details whose work a library holds, ahead of the regular queue, and never touches un-held bnp books.

**Architecture:** A new repository read lists held bnp candidates by `work_id` (index `idx_books_work`). `backfillDetails` gets held work ids from an optional `heldWorkIds` dep, maps them to live works with `repo.canonicalWorkIds`, takes the held bnp ids first, and fills the rest of the batch from `listUncheckedDetailIds`. The plugin passes `heldWorkIds` from the `heldWorks` option it already receives.

**Tech Stack:** TypeScript, Fastify plugin, `node:sqlite`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-18-held-bnp-details-design.md`

## Global Constraints

- `UNCHECKED_DETAILS_SQL` and `idx_books_details_pending` stay exactly as they are; un-held bnp books are never selected by any background job.
- No change to `GET /books/details`, `GET /works/:id`, web, mobile or `@scripta/shared`.
- Without `heldWorkIds`, `backfillDetails` behaves exactly as today.
- No code comments (repo rule). Both test files below are already listed in `backend/package.json`'s `test` script.
- Verify: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend`, `npm test --workspace backend`.

## Review Focus

1. No library holds anything (`heldWorkIds` returns `[]`): the batch is today's batch. Task 2 test.
2. A held bnp book that already carries a BNP synopsis (`summary_source = 'bnp'`, `details_status` null): it is still looked up, and an Open Library or ISBNdb summary does not replace the BNP text. Task 2 test.
3. A held bnp book whose lookup keeps failing (outage stamps `details_checked_at`): it moves behind untried held books and can't starve them. Task 1 test.
4. Thousands of held works: the read goes through `idx_books_work`, not a scan of the bnp rows. Task 1 plan test.
5. The library database can't be read (`heldWorkIds` throws): the error propagates out of `backfillDetails` (the plugin's `onError` logs it), and no lookup runs. It is not swallowed into "nothing held". Task 2 test.

---

### Task 1: Repository read for held bnp books

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces: `BooksRepository.listHeldBnpDetailIds(workIds: string[], limit: number): string[]` in `ports.ts`, next to `listUncheckedDetailIds`. Exported SQL constant `HELD_BNP_DETAILS_SQL` in `sqliteBooksRepository.ts`, taking `(workIdsJson: string, limit: number)`.

- [ ] **Step 1: Write the failing tests** in `sqliteBooksRepository.test.ts`, after `"the details queue skips bnp books"`. Add `HELD_BNP_DETAILS_SQL` to the existing `await import("./sqliteBooksRepository.js")` destructuring.

```ts
test("listHeldBnpDetailIds returns unchecked bnp books in the given works, untried first, up to the limit", () => {
  const { repo } = freshRepo();
  const bnp = (title: string, at: string) => repo.createBook({ title, author: "X", isbn: null, createdBy: "bnp" }, [`ta:${title.toLowerCase()}|x|`], at);
  const failed = bnp("Failed", "2026-09-01T00:00:00.000Z");
  const older = bnp("Older", "2026-09-02T00:00:00.000Z");
  const newer = bnp("Newer", "2026-09-03T00:00:00.000Z");
  const found = bnp("Found", NOW);
  const missing = bnp("Missing", NOW);
  const elsewhere = bnp("Elsewhere", NOW);
  const plain = repo.createBook({ title: "Plain", author: "X", isbn: null }, ["ta:plain|x|"], NOW);
  repo.markDetailsAttempted(failed.id, NOW);
  repo.saveDetails(found.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  repo.markDetailsMissing(missing.id, NOW);
  const held = [failed, older, newer, found, missing, plain].map((book) => book.work_id!);

  assert.deepEqual(repo.listHeldBnpDetailIds(held, 10), [older.id, newer.id, failed.id]);
  assert.deepEqual(repo.listHeldBnpDetailIds(held, 1), [older.id]);
  assert.deepEqual(repo.listHeldBnpDetailIds([], 10), []);
  assert.ok(!repo.listHeldBnpDetailIds(held, 10).includes(elsewhere.id));
});

test("the held bnp read goes through the work index", () => {
  const { db } = freshRepo();
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${HELD_BNP_DETAILS_SQL}`).all("[]", 50) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(plan, /USING INDEX idx_books_work\b/, plan);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: FAIL, `repo.listHeldBnpDetailIds is not a function` / `HELD_BNP_DETAILS_SQL` undefined.

- [ ] **Step 3: Implement**

`HELD_BNP_DETAILS_SQL` selects `id FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND created_by = 'bnp' AND details_status IS NULL`, ordered as `UNCHECKED_DETAILS_SQL` minus the `created_by` term (`details_checked_at IS NOT NULL, details_checked_at, created_at, rowid`), `LIMIT ?`. `listHeldBnpDetailIds` returns `[]` for an empty list without querying, else runs a prepared statement with `JSON.stringify(workIds)`.

- [ ] **Step 4: Run to verify they pass**

Same command. Expected: PASS, including every existing queue test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts
git commit -m "List unchecked bnp books in held works"
```

---

### Task 2: The details backfill takes held bnp books first

**Files:**
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Consumes: `repo.listHeldBnpDetailIds(workIds, limit)` (Task 1); `repo.canonicalWorkIds(ids): Map<string, string>` (existing).
- Produces: `BooksServiceDeps.heldWorkIds?: () => string[]`.

- [ ] **Step 1: Write the failing tests** in `booksService.test.ts`, after the existing details-backfill tests. Use an inline background catalog that pushes bare `lookup.title` and returns `spiceAnswer`, as the existing backfill tests do (not `recordingCatalog`, which records `details:<isbn or title>`), and a local helper `bnpBook(h, title, at)` that calls `h.repo.createBook({ title, author: "X", isbn: null, createdBy: "bnp" }, [\`ta:${title.toLowerCase()}|x|\`], at)`.

  - `"the details backfill looks up held bnp books before the queue"`: one regular unchecked book from `backfillBooks(h, 1)` (older) and one bnp book; `heldWorkIds: () => [bnp.work_id!]`; `backfillDetails(2)` → seen `[<bnp title>, "Book 0"]`, both `details_status === "found"`.
  - `"held bnp books fill the batch before the queue gets any of it"`: two held bnp books and `backfillBooks(h, 1)`; `backfillDetails(2)` → seen is the two bnp titles only; the regular book stays `null`.
  - `"the details backfill never looks up a bnp book whose work nobody holds"`: a held and an un-held bnp book; `backfillDetails(50)` → seen is the held title only; the un-held book's `details_status` and `details_checked_at` stay `null`.
  - `"a held work that was merged still counts"`: a plain keyless book `a` and a bnp book `b` in separate works; `h.repo.mergeWorks(a.work_id!, b.work_id!)`; `heldWorkIds: () => [a.work_id!]` (the stale id); `backfillDetails(50)` → `b` is looked up.
  - `"with nothing held, or no heldWorkIds, the batch is the regular queue"`: once with `heldWorkIds: () => []` and once with no `heldWorkIds`; a bnp book plus `backfillBooks(h, 2)`; `backfillDetails(50)` → seen `["Book 0", "Book 1"]`.
  - `"a held bnp book keeps its BNP synopsis when looked up"`: held bnp book with `h.repo.mergeDetails(id, { summary: "Sinopse da BNP.", pages: null, year: null, publisher: null, translator: null }, "bnp")`; after `backfillDetails(50)` → `summary === "Sinopse da BNP."`, `summary_source === "bnp"`, `details_status === "found"`.
  - `"a failing held-works read propagates and looks nothing up"`: `heldWorkIds: () => { throw new Error("library db locked"); }`; `backfillBooks(h, 1)`; `await assert.rejects(h.service.backfillDetails(50), /library db locked/)`; seen is `[]`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/booksService.test.ts`
Expected: every new test FAILS except the nothing-held one, which passes already (bnp books are never looked up and `heldWorkIds` is ignored).

- [ ] **Step 3: Implement**

In `booksService.ts`: add `heldWorkIds?: () => string[]` to `BooksServiceDeps`. In `backfillDetails(limit, signal)`, before the loop, build the id list: if `deps.heldWorkIds` is set, `held = deps.repo.listHeldBnpDetailIds([...new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values())], limit)`, else `[]`; then `[...held, ...deps.repo.listUncheckedDetailIds(limit - held.length)]`. Skip the second read when `held.length === limit`. The loop body is unchanged.

In `plugin.ts`: pass `heldWorkIds: () => heldWorks().map((work) => work.workId)` to `createBooksService` when `heldWorks` is set, as the Jev jobs do.

In `backend/README.md`, in the paragraph starting **"The details backfill fetches every book's details before anyone asks."**: say that books the BNP import or BNP lookup created (`created_by = 'bnp'`) are left out of that queue unless a library holds their work, and that those held ones come first in every batch (their own order: untried first, then by last attempt). In the **"Details and search are cached the same way."** paragraph, qualify "the details backfill (below) checks every catalog book" the same way.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/booksService.ts backend/src/modules/books/plugin.ts backend/README.md backend/src/modules/books/booksService.test.ts
git commit -m "Look up held bnp books in the details backfill"
```

---

## Final check (main session)

- `node scripts/gate.mjs` against the branch (it sees only uncommitted changes; compute the Verify commands from `origin/main...HEAD` if it says nothing changed), plus frontend and mobile verify as the task requires: `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend`, `npm test --workspace frontend`, `npm run typecheck --workspace mobile`, `npm test --workspace mobile`.
