# Small saves (library changes): implementation plan

> **For agentic workers:** implement task by task, verify each, and commit
> each task separately. Steps use checkbox (`- [ ]`) syntax. After each task,
> run a spec review, then a quality review (`.claude/agents/`). Before each
> PR, run the branch review and the `security-review` skill.

**Goal.** Ticking a book in a group, setting a book's status or rating, and
adding a book send only the change. The apps show it at once and never lose
an edit. `PUT /library` keeps working for installed builds.

**Spec:** `docs/superpowers/specs/2026-10-02-small-saves-design.md`. Read it
first. The saver's rules in particular (confirmed and pending, the
`baseUpdatedAt` check, one queue) are the point of the design.

**Base.** `main` after PR #102. That PR added the rate-limit scopes,
`rateLimitKey`, `libraryWriteLimit`, the 10 MiB cap and `saveFailureMessage`.

**Rules.**
- Root `AGENTS.md` and each package's `AGENTS.md` apply.
- No code comments.
- Additive API only: new routes, and no response shape of an existing route
  changes.
- New `*.test.ts` files go into `backend/package.json`'s `test` list.
- Rebuild `@scripta/shared` before testing a package that uses it.
- In code the feature is **library changes**. "Small save" already names a
  `PUT` under 1 MiB (`LIBRARY_SMALL_SAVE_MAX_BYTES`).

**Two PRs.**
- **PR 1** is Tasks 1a, 1b, 2a and 2b: shared code and the server routes.
- **PR 2** is Tasks 3 and 4: the apps. It merges only after PR 1 is live on
  Railway. The gate is
  `curl -s -o /dev/null -w '%{http_code}' -X PATCH https://api.atmyshelf.com/library/books`
  printing 401, not 404.

The web and mobile's over-the-air update ship on the push to `main`, and
Railway deploys separately (and can be paused).

---

## Task 1a: Shared helpers

**Files.** In `packages/shared/src/library/`: `groups.ts` and `merge.ts`
(or a new `addPipeline.ts`), their tests, and the `index.ts` exports. Also
`frontend/src/pages/LibraryPage.tsx` (`mergeAndSave`) and
`mobile/src/features/library/lib/mergeAndSave.ts` with its test.

- [ ] **Key-based membership.** Add `addKeyToGroup(groups, id, key)` and
  `removeKeyFromGroup(groups, id, key)`.
  - On a no-op they return the **same array** and stamp no `updatedAt`: the
    key is already in, or already out, or the group is unknown.
  - `addBookToGroup` and `removeBookFromGroup` call them with
    `bookKey(book)`.
  - `removeBookFromGroup` therefore stops stamping a group the key wasn't
    in. Check that no caller depends on that stamp.
- [ ] **Make `deriveSeriesGroups` linear** (`groups.ts:155-170`) with
  identical output.
  - Use a `Map` from normalized name to the first matching group index,
    updated whenever a group is pushed.
  - Use a `Set` of keys per group it touches.
  - Pin it with the existing tests. Also compare old and new output on
    inputs of up to about 2,000 books, in both shapes: one series per book,
    and many books per series. The old version is a frozen copy run in the
    test, with ids and dates normalized. It is quadratic, about 100 s at
    20,000 books, so it never runs bigger than that.
  - The 20,000-book cases only time the new version, under 500 ms.
  - Measured today: 3.2 s at 20,000 books and 2,000 series, and 15.8 s at
    8,000 books with one series each.
- [ ] **Move the add pipeline into shared** as
  `buildMergedLibrary(existing, incoming)`. It is mobile's function, as is:
  `mergeLibraryData`, then `assignBookOrder`, then `deriveSeriesGroups`.
  Web's `mergeAndSave` updater and mobile's `mergeAndSave.ts` call it.
- [ ] **Delete stale comment paragraphs.** The ones saying this logic
  "lives entirely on the client" (`merge.ts:6-12`, `groups.ts:11-14`) are no
  longer true.
- [ ] **Verify.** Shared, web and mobile tests all pass. The apps' output
  is unchanged.

## Task 1b: `applyLibraryChange` and the saver

**Files.** In `packages/shared/src/library/`: a new `libraryChange.ts` and a
new `librarySaver.ts`, their tests, and the exports.

- [ ] **`applyLibraryChange(data, change)`.** It returns
  `{ data, changed } | { error: "no-group" | "no-book" }`.
  - `membership` uses the key helpers. `member: true` needs some book with
    that `bookKey()`, otherwise `"no-book"`. An unknown group gives
    `"no-group"`.
  - `book` applies `setReadStatus(book, readStatus, day)` and then
    `setRating` to every book whose `bookKey()` matches. No book gives
    `"no-book"`. `day` is part of the change. Rating range is validated by
    the route, not here.
  - `add` is `buildMergedLibrary(data, { books: [book] })`.
  - `changed` is `next !== data` for `membership` and `book`. `add` is always
    `true`.
- [ ] **`createLibrarySaver({ send, put, fetch, write })`.** Implement the
  spec's "Apps: one saver" section exactly. In particular:
  - `receive` applies at once and is not queued. Jobs call `fetch` directly.
  - A document at an equal version is ignored.
  - An add is never folded into `confirmed`.
  - `saveWhole` runs its updater on `confirmed`, keeps the same-data skip,
    and keeps one 409 replay.
  - Merges are queue jobs.
  - A reorder updater shows through `pending`.
  - Timeouts are 30 s for a change and 60 s for a whole save.
  - `dispose()` also stops the running job at its next await.
  - A new tap is applied to the current view; recompute from `confirmed`
    only when it is replaced or a change fails.
  - `confirmed` and `pending`.
  - `write(view)` after every change of either.
  - One FIFO queue for:
    - `submit(change)`, which resolves `{ ok: true }` or
      `{ ok: false, error }` when the server answers, and never throws;
    - `saveWhole(updater)`, which replaces each app's `updateLibrary` and
      keeps today's single 409 replay (fetch, re-run the updater, resend
      once);
    - merges.

    `receive(document)` is not a queue job (see above).
  - The `baseUpdatedAt` rule on success.
  - Drop the change and fetch on failure.
  - Always fetch after an add.
  - A `dispose()` that drops unsent jobs.
  - Share tokens are always applied.

  Model the tests on `frontend/scripts/test-library-update.mts`, with fake
  `send`, `fetch` and `write`.
- [ ] **Tests**, all from the spec's verification list, plus:
  - an add that seeds a series is replaced by the fetched document, so the
    server's group id is the one that ticks use;
  - a replay inside a whole save doesn't deadlock;
  - a hung request times out and later jobs run;
  - `dispose()` during a 409 replay sends nothing more;
  - a stale share token can't come back at an equal version.
  - copy behind (two devices, a stale service-worker fetch, a rename racing
    a tick): the next whole save gets a 409;
  - on-off-on never shows off after the last tap, and ends on when the first
    save fails;
  - pending survives a document landing mid-queue;
  - rollback without the fetch's help;
  - an older document is ignored;
  - `dispose` drops jobs.

  Mutation-check the base rule, the older-document guard and the queue
  ordering.

## Task 2a: Repository and service

**Files.** In `backend/src/modules/library/`: `domain/ports.ts`,
`adapters/sqlite/sqliteLibraryRepository.ts`, `service.ts`, and their tests.
Also `packages/shared/src/library/readerIdentity.ts`, or wherever the
glyph-only helper fits.

- [ ] **Measure first, without committing the script.** At 1 MiB and
  10 MiB, time the worst path of each kind:
  - membership in a series group, with the glyph recomputed;
  - status to 2, with glyph and event;
  - add, with the full derive.

  The 10 MiB fixture is 20,000 bare books in 2,000 series, which is the
  worst shape: parse about 30 ms, `readerIdentity` about 88 ms, stringify
  about 39 ms.

  Put the numbers in the commit message, with both buckets' combined
  per-account budget (changes plus 30/min of writes). If a 10 MiB membership
  or book change costs more than 100 ms, which is likely for this fixture,
  set the changes bucket to 60/min instead of 120. Record that in the commit
  message and carry on; don't stop for a decision.
- [ ] **`updateDocumentData(userId, json, expectedUpdatedAt, glyph | "keep")`.**
  - Precondition and `updated_at` rule as in `upsertDocument`
    (`sqliteLibraryRepository.ts:69-83`). If the precondition fails, return
    `undefined` and let the service throw `LibraryConflictError`.
  - With a glyph, write `library_derived` with the new version, only where
    the derived row was current for the previous version, since that version
    also vouches for the match keys. A stale row stays stale for the boot
    backfill.
  - With `"keep"`, update `source_updated_at` only where it equals the
    previous `updated_at`.
  - Never touch `library_match_keys`.
  - Mutation-check the precondition at this level, since the service can't
    make it fail.
- [ ] **Glyph-only helper.** A function that computes the glyph
  (`readerIdentity` over the fields `textFields` keeps, `service.ts:30-41`)
  without building match keys. `deriveLibraryData` uses it too.
- [ ] **`applyChange(userId, change)`**, in one synchronous step:
  1. Read the stored document. Unreadable throws, as in `addBook`. If there
     is none: `membership` and `book` give 404, and `add` starts from
     `{ books: [] }`.
  2. Parse it and run `applyLibraryChange`.
  3. If nothing changed, return `{ updatedAt: stored, baseUpdatedAt: stored }`.
  4. `serializeWithinLimit` (413).
  5. Write:
     - `add` goes through `upsertDocument` with `deriveLibraryData`.
     - The others go through `updateDocumentData` with the glyph only for a
       membership change in a `series` group or a status moving to or from
       2, and `"keep"` otherwise.
  6. Emit events through `emitBookEvents` from the already-parsed books.
     There are events only for a status reaching 2 and for an add, with no
     second parse of the stored string. Diff an add against `{ books: [] }`
     when there was no document, and keep the cap of 10 per save.
  7. Return `{ updatedAt, baseUpdatedAt }`.
- [ ] **Tests.**
  - For each kind, the stored document equals `applyLibraryChange` on the
    previous one. Normalize the random ids an add's series seeding creates.
  - No-op membership and book changes don't write.
  - Match keys are untouched except on add.
  - Glyph against `"keep"`, and the boot backfill re-deriving nothing
    afterwards.
  - Events, including a first add.
  - 404, 409 (repository) and 413.

## Task 2b: Routes, buckets and docs

**Files.** `backend/src/modules/library/routes.ts` and `routes.test.ts`.
This task owns `backend/README.md` and the load-safety spec's rate-limit
table; no other task edits them.

- [ ] **A new `changes` scope:** `fastifyRateLimit`
  `{ max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey }`, with
  `preHandler: authGuard` and `bodyLimit: 64 * 1024` on each route.
  (60, not 120: Task 2a measured a 10 MiB change at 140–200 ms; see a6ab168.)
  - `POST /library/groups/:groupId/books`:
    `{ bookKey: string 1–2000, member: boolean }`.
  - `PATCH /library/books`:
    `{ bookKey: string 1–2000, readStatus?: 0|1|2, rating?: 1–5, day?: YYYY-MM-DD }`.
    At least one of `readStatus` and `rating` must be present. `day` is
    required when `readStatus` is 2. Otherwise 400.
- [ ] **`POST /library/books/add`** goes in the existing `writes` scope.
  `libraryWriteLimit` gives POSTs 30. The body is
  `{ book: object with a non-empty string Title }`, with
  `bodyLimit: 64 * 1024`.
- [ ] **Answers.**
  - 200 `{ updatedAt, baseUpdatedAt }`.
  - 400.
  - 401.
  - 404 `{ error }`.
  - 409 `{ error }`.
  - 413 with `libraryTooLargeBody()`.
- [ ] **Tests.**
  - Each route's success and error answers.
  - The 121st change in a minute gets 429.
  - Changes and whole-library saves don't share a bucket.
  - Add shares the writes bucket.
  - An old build's flow: a `PUT` with the `updatedAt` it held before a
    change gets 409 and its replay succeeds.
- [ ] **Docs.**
  - `backend/README.md`, library section: the three routes, bodies,
    answers, buckets, what they skip, and that `PUT /library` is unchanged.
    Correct `:14` and `:83` (the document as an "opaque blob"), and `:317`
    ("always saved whole").
  - Load-safety spec: a rate-limit row for the changes bucket.

**PR 1 ends here.** Run the branch review and security review, then merge.
Wait for the Railway deploy, then check the gate.

## Task 3: Web adapter and callers

**Files.**
- `frontend/src/api/library.ts`, `frontend/src/hooks/useLibrary.ts`,
  `frontend/src/main.tsx`.
- `frontend/src/pages/GroupsPage.tsx`, `frontend/src/pages/LibraryPage.tsx`.
- `frontend/src/components/PickNextSheet.tsx`,
  `frontend/src/components/DuplicatesSheet.tsx`, and every other writer of
  `["library"]`.

- [ ] **One saver per signed-in user**, next to the QueryClient
  (`main.tsx:14`), provided through a context beside `QueryClientProvider`.
  `dispose()` it when the user changes.
  - `beforeunload` asks the reader to stay while `pending` is not empty.
  - `write` is `setQueryData(["library"], view)`.
  - The query function of `["library"]` is the saver's fetch.
- [ ] **Route every writer of `["library"]` through the saver**:
  - `updateLibrary` becomes `saveWhole`;
  - merge responses;
  - share and unshare;
  - drag-reorder's optimistic write. A reorder becomes a `saveWhole` whose
    updater shows through `pending`, so the card still moves at once.
  - Duplicate merges become queue jobs.
- [ ] **Switch the callers to `submit`.**
  - Group checkbox: `handleToggleBook`.
  - Status and rating: `LibraryPage.tsx:243-275`, `PickNextSheet.tsx:27`.
    The finish sheet opens on `submit`'s `true`.
  - Add: `handleAddBook`.

  Import and Goodreads sync stay on `mergeAndSave` through `saveWhole`.
- [ ] **Browser pass.** Use Playwright against `npm run dev`; see
  `docs/dev-workflow.md`.
  - Tick ten boxes quickly.
  - Set status and rating.
  - Add a book.
  - Reload: everything is still there.
  - Repeat while a second tab edits the library.

## Task 4: Mobile adapter and callers

**Files.**
- `mobile/src/features/library/api/client.ts`, `hooks/useLibrary.ts`,
  `hooks/useLibraryActions.ts`, `components/GroupDetail.tsx`,
  `components/DuplicatesSheet.tsx`.
- `mobile/src/app/_layout.tsx`.
- The four raw-`GET` screens: `QuizCreateScreen.tsx:49`,
  `TierlistCreateScreen.tsx:28`, `TierlistEditorScreen.tsx:46`,
  `ArenaSeedScreen.tsx:25`.

- [ ] **Same as Task 3**, minus `beforeunload`. The saver is created next to
  the QueryClient (`_layout.tsx:19`) and provided through a context.
  - The four screens use the saver's fetch, which resolves to the view, as
    their query function.
  - With no library (404) they now show an empty shelf instead of "couldn't
    be loaded"; that is accepted.
- [ ] **Callers.**
  - Group row: `GroupDetail.tsx:79-85`.
  - Status and rating: `useLibraryActions.ts:67-76`.
  - Add: `useLibraryActions.ts:57-59`.

  `PickNextSheet` and `add-book.tsx` need no edits. Add errors keep going to
  `AddBookForm`'s inline message, and the others to `attemptUpdate` with
  `saveFailureMessage`.
- [ ] **Device pass with the `emulator-verify` skill.** Same script as the
  browser pass.

**PR 2** goes after the gate. Run the branch review and security review
before merge.

## Done when

- Every package's verify commands pass, and CI's full sequence passes on
  Node 26.
- The browser and device passes pass, including the second-device run.
- Both PRs had their branch and security reviews with nothing blocking.
- Installed builds behave as before. The `PUT` replay test in Task 2b passes.
