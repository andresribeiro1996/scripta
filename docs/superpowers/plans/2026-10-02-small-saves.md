# Small saves: implementation plan

> **For agentic workers:** implement task by task, verify each, and commit
> each task separately. Steps use checkbox (`- [ ]`) syntax. After each task,
> run a spec review and then a quality review (`.claude/agents/`). Run the
> branch review and the `security-review` skill once before merge.

**Goal:** ticking a book in a group, setting a book's status or rating, and
adding a book send only the change. The apps show it at once. The server does
a fraction of a whole-library save. `PUT /library` keeps working for installed
builds.

**Spec:** `docs/superpowers/specs/2026-10-02-small-saves-design.md`.

**Base:** `main` after PR #102 (rate-limit scopes, `rateLimitKey`, the
10 MiB cap and `saveFailureMessage` are there).

**Rules:**
- Root `AGENTS.md` and each package's `AGENTS.md` apply. No code comments.
- API changes are additive: new routes only, and no response shape of an
  existing route changes.
- New `*.test.ts` files go into `backend/package.json`'s `test` list.
- Rebuild `@scripta/shared` before testing a package that uses it.

**Order:**
1. Task 1.
2. Task 2.
3. Tasks 3 and 4, in parallel worktrees.
4. Task 5.

---

## Task 1: One shared function for a change, and a save queue

**Files:**
- `packages/shared/src/library/`: `groups.ts`, a new `libraryChange.ts`, a
  new `saveQueue.ts`, and the `index.ts` exports, with their tests.
- `frontend/src/pages/LibraryPage.tsx` (`mergeAndSave`).
- `mobile/src/features/library/lib/mergeAndSave.ts` and its test.

**Steps:**
- [ ] **Key-based group helpers.** Add `addKeyToGroup(groups, id, key)` and
  `removeKeyFromGroup(groups, id, key)` to `groups.ts`. Make
  `addBookToGroup` and `removeBookFromGroup` call them with `bookKey(book)`,
  so their behaviour doesn't change.
- [ ] **The add pipeline moves into shared.** Move mobile's
  `buildMergedLibrary(existing, incoming)` there as is:
  `mergeLibraryData`, then `assignBookOrder`, then `deriveSeriesGroups`.
  Web's `mergeAndSave` updater and mobile's `mergeAndSave.ts` both call it.
  Their output must stay identical: keep the existing tests passing and add
  one per client that pins it.
- [ ] **`applyLibraryChange`.** Add `applyLibraryChange(data, change, day)`
  in `libraryChange.ts`. `day` is the reader's local `YYYY-MM-DD` for
  `setReadStatus`. The change kinds:
  - `membership`: `member: true` adds the key if some book has that key, and
    otherwise reports `"no-book"`. `member: false` removes the key, even a
    dangling one. An unknown group reports `"no-group"`.
  - `book`: applies `setReadStatus` and then `setRating` to every book whose
    `bookKey()` matches. No book reports `"no-book"`. Rating must be 1–5.
  - `add`: `buildMergedLibrary(data, { books: [book] })`.

  Return `{ data, changed }`, or the error. A change that changes nothing
  returns the same `data` object, as the helpers already do.
- [ ] **`createSaveQueue()`.** It runs async jobs one after another, in call
  order. A failed job rejects its own promise and doesn't stop the queue.
  `createShelfSession` (`packages/shared/src/murals/finish.ts:64-130`) is the
  precedent.
- [ ] **Tests:**
  - For each kind, the result equals what today's client code produces from
    the same input. Freeze `Date` so group `updatedAt` stamps match.
  - Applying the same change twice equals applying it once.
  - A dangling key is removed.
  - The errors are reported.
  - The queue keeps order with a failure in the middle.

## Task 2: The three endpoints

**Files:**
- `backend/src/modules/library/`: `routes.ts`, `service.ts`,
  `domain/ports.ts`, `adapters/sqlite/sqliteLibraryRepository.ts`, and their
  tests.
- `backend/README.md`, the library section.

**Steps:**
- [ ] **Measure first, without committing the script.** Time a whole
  `PUT /library` and the small-save path at 1 MiB and 10 MiB: read, parse,
  `applyLibraryChange`, stringify, and the data-only write.
  - Put the numbers in the commit message.
  - Keep the 120/min bucket unless a 10 MiB small save costs more than
    100 ms. In that case stop and report back.
- [ ] **Repository: write data without the derived rows.** Add
  `updateDocumentData(userId, json, expectedUpdatedAt, glyph | "keep")`.
  - It writes `data` and `updated_at` under the same precondition and
    `updated_at` rule as `upsertDocument` (`sqliteLibraryRepository.ts:69-83`).
  - With a glyph, it also writes `library_derived` with the new version. With
    `"keep"`, it only moves `library_derived.source_updated_at` to the new
    version, so the startup re-derive skips it.
  - It never touches `library_match_keys`.
- [ ] **Service: `applyChange(userId, change, day)`.** In one synchronous
  step:
  1. Read the stored document. If there is none, `membership` and `book`
     are 404 and `add` starts from `{ books: [] }`, as `addBook` does.
  2. Parse it and run `applyLibraryChange`.
  3. Check the size with `serializeWithinLimit`.
  4. Write: `add` through `upsertDocument` with full derive; the others
     through `updateDocumentData` with the current `updated_at` as the
     precondition.
  5. Return `{ updatedAt }`.

  If nothing changed, return the stored `updatedAt` without writing.

  Recompute the glyph only when its inputs can change: a membership change in
  a `series` group, or a status moving to or from 2. Otherwise pass
  `"keep"`.

  Events, through the existing `emitBookEvents`: `book_finished` when a
  `book` change moves a book to 2; `book_added` when `add` creates a book.
  Use the ContentID-keyed `diffBookEvents` (`service.ts:81-106`) on the
  before and after documents, as `saveLibrary` does.
- [ ] **Routes.** Add the three routes in their own scope:
  `fastifyRateLimit` `{ max: 120, timeWindow: "1 minute", keyGenerator: rateLimitKey }`,
  `preHandler: authGuard` on each, and `bodyLimit: 64 * 1024`.
  - `POST /library/groups/:groupId/books`: `{ bookKey: string 1–2000, member: boolean }`.
  - `PATCH /library/books`: `{ bookKey, readStatus?: 0|1|2, rating?: 1–5, day?: YYYY-MM-DD }`.
    At least one of `readStatus` and `rating` is required.
  - `POST /library/books/add`: `{ book: object with a non-empty string Title }`.

  Answers:
  - success: 200 `{ updatedAt }`;
  - bad body: 400;
  - `no-group` or `no-book`: 404 with `{ error }`;
  - over the cap: 413 with `libraryTooLargeBody()`;
  - no session: 401.
- [ ] **Tests:**
  - For each kind, the stored document equals `applyLibraryChange` on the
    previous document.
  - The same body twice gives one change.
  - Match keys are untouched except on add.
  - The glyph is recomputed for series membership and finish changes, and
    `"keep"` otherwise. Check with the startup backfill that nothing is
    re-derived.
  - The events.
  - 400, 401, 404 and 413.
  - The 121st small save in a minute gets 429, and it doesn't use up the
    whole-library bucket, nor the other way round.
  - Mutation-check the glyph condition, the precondition and the bucket.

## Task 3: Web uses small saves

**Files:**
- `frontend/src/api/library.ts`.
- `frontend/src/hooks/useLibrary.ts`.
- `frontend/src/pages/GroupsPage.tsx`, `LibraryPage.tsx`.
- `frontend/src/components/PickNextSheet.tsx`.
- A `frontend/scripts/test-*.mts` for the cache logic.

**Steps:**
- [ ] **API functions.** Add `saveGroupMembership`, `patchBook` and
  `addLibraryBook`, each returning `{ updatedAt }`.
- [ ] **`useLibrary().applyChange(change)`.** It works like this:
  1. Run `applyLibraryChange` on the cached document now, with
     `setQueryData`.
  2. Queue the request on one module-level `createSaveQueue()`.
  3. On success, re-apply the change to whatever the cache holds and keep
     the later `updatedAt`.
  4. On failure, `invalidateQueries(["library"])` and rethrow, so the caller
     toasts `saveFailureMessage`.
- [ ] **Latest-wins cache.** `updateLibrary` (the `PUT` path) no longer
  overwrites a cache whose `updatedAt` is newer than the response's.
- [ ] **Switch the callers.**
  - The group checkbox: `handleToggleBook`.
  - Read status and rating: `LibraryPage.tsx:243-275`, `PickNextSheet.tsx:27`.
  - Add a book: `handleAddBook`.

  Import and Goodreads sync stay on `mergeAndSave` and `PUT`.
- [ ] **Tests:**
  - The optimistic change survives a `PUT` response landing in between.
  - on-off-on ends on.
  - A failure rolls back through the refetch.
  - A stale `PUT` response doesn't overwrite a newer cache.
- [ ] **Browser pass.** Tick ten boxes quickly, then set status and rating,
  then add a book. Each change shows at once and is still there after a
  reload.

## Task 4: Mobile uses small saves

**Files:**
- `mobile/src/features/library/api/client.ts`.
- `hooks/useLibrary.ts`, `hooks/useLibraryActions.ts`.
- `components/GroupDetail.tsx`.
- `features/home/PickNextSheet.tsx`, `app/(app)/(library)/add-book.tsx`.
- Their tests.

**Steps:**
- [ ] **Same design as Task 3.** Mobile's `updateLibrary` also replays on a
  409 and has no same-reference short-circuit. Leave both as they are.
- [ ] **Switch the callers.**
  - The group row toggle: `GroupDetail.tsx:79-85`.
  - Status and rating: `useLibraryActions.ts:67-76`.
  - Add a book: `useLibraryActions.ts:57-59`.

  Errors keep going through `attemptUpdate` and `saveFailureMessage`.
- [ ] **Tests:** the same four as Task 3, against the mobile hook.
- [ ] **Device pass with the `emulator-verify` skill.** Same script as the
  web pass.

## Task 5: Docs

**Steps:**
- [ ] **`backend/README.md`, library section.** Describe:
  - the three routes, their bodies and answers;
  - the 120/min bucket;
  - that they skip match keys and recompute the glyph only when needed;
  - that `PUT /library` is unchanged.
- [ ] **`docs/superpowers/specs/2026-10-01-library-rows-design.md`.**
  - The phase C row points to this spec.
  - Phase B's writing section lists the small-save paths among the paths
    that keep rows in step.
- [ ] **`docs/superpowers/specs/2026-10-01-load-safety-design.md`.** Add a
  rate-limit table row for the small saves.

## Done when

- Every package's verify commands pass. CI's full sequence passes on Node 26.
- Both apps pass their browser and device runs.
- The branch review and the security review find nothing blocking.
- An installed build saving with `PUT /library` behaves as before. A route
  test sends today's mobile `PUT` after a small save and expects the existing
  409 and replay.
