# Small saves: send the change, not the library

Date: 2026-10-02
Status: scope approved in conversation (group checkboxes, read status and
rating, adding a book); revised after the plan review of the same day

"Small saves" is the conversation's name for this. In code it is **library
changes** (`applyLibraryChange`, the change routes), because "small save"
already names a `PUT /library` under 1 MiB (`LIBRARY_SMALL_SAVE_MAX_BYTES`).

## Problem

Every library edit in both apps uploads the whole library: `PUT /library`
with the full document. Four common actions do it once per tap or submit:

| Action | Web | Mobile | Cadence |
|---|---|---|---|
| Tick a book in a group | `GroupsPage.tsx:186-195` | `GroupDetail.tsx:79-85` | every tap |
| Set read status | `LibraryPage.tsx:243-258`, `PickNextSheet.tsx:27` | `useLibraryActions.ts:67-71` | every tap |
| Rate a book | `LibraryPage.tsx:260-275` | `useLibraryActions.ts:73-76` | every tap |
| Add a book (form or search) | `LibraryPage.tsx:152-164` (`mergeAndSave`) | `lib/mergeAndSave.ts`, `useLibraryActions.ts:57-59` | every submit |

What that costs:

- **The user waits.** A tap uploads the library and gets all of it back.
  The checkbox changes only when the round trip ends; neither app is
  optimistic, except web drag-reorder.
- **Taps collide.** Neither app queues saves. A second tap while the first
  is in flight sends the same `updatedAt`, gets a 409, then downloads and
  uploads the library again. Eighteen quick ticks made 30 uploads and 12
  downloads in the branch review.
- **The server pays for the whole library every time.** At the 10 MiB cap a
  save costs 0.3–0.65 s of the single thread: parse, derive, up to 20,000
  match-key rows, and the echo.

Today the largest library in production is 67 KB. The point is that taps feel
instant now, and stay cheap when libraries grow.

## Server: three change routes

All three are additive. `PUT /library` stays as it is, for installed builds
and for every other action.

| Route | Body | Effect | Rate-limit bucket |
|---|---|---|---|
| `POST /library/groups/:groupId/books` | `{ bookKey, member }` | Puts the book in the group or takes it out. `member` is the state the checkbox now shows, so a retry is harmless | new **changes** bucket, 120/min |
| `PATCH /library/books` | `{ bookKey, readStatus?, rating?, day? }` | Sets the fields on every book whose `bookKey()` matches, as the apps do today. `day` is the reader's local `YYYY-MM-DD` and is required when `readStatus` is 2 | changes, 120/min |
| `POST /library/books/add` | `{ book }` | Merges one book in through the add pipeline (`mergeLibraryData`, `assignBookOrder`, `deriveSeriesGroups`) | the existing **writes** bucket: 30/min, like add-book and merge |

- **`bookKey` travels in the body.** Fastify's default `maxParamLength` is
  100 characters, and keys can be long titles with `|` and spaces.
- **One function applies a change.** `@scripta/shared` gains
  `applyLibraryChange(data, change)`, where `change` is one of:
  - `{ kind: "membership", groupId, bookKey, member }`
  - `{ kind: "book", bookKey, readStatus?, rating?, day? }`
  - `{ kind: "add", book }`

  The server runs it on the stored document, and the apps run it on their
  copy. It is built from the helpers the apps use today: key-based variants
  of `addBookToGroup` and `removeBookFromGroup`, `setReadStatus`, `setRating`,
  and the add pipeline. The add pipeline exists twice today (web
  `mergeAndSave`, mobile `buildMergedLibrary`); it moves into
  `@scripta/shared` and all three callers use that copy.
- **A change that changes nothing writes nothing.** The membership helpers
  return the same array and stamp no `updatedAt` when the key is already in
  (or already out). `setReadStatus` and `setRating` already return the same
  book. A membership or book change that alters nothing therefore returns the
  same `data`, the server skips the write, and `updatedAt` does not move.
  A book change that alters no matched book also returns the same `data`.
  `add` always writes. Re-adding a book you already have replaces its
  ContentID with a new `manual:` id, so it emits `book_added` again, as it
  does today.
- **Answers.**
  - Success: 200 `{ updatedAt, baseUpdatedAt }`. `baseUpdatedAt` is the
    stored `updated_at` the change was applied to (`null` when there was no
    stored document); it equals `updatedAt` on a no-op.
  - 400 for an invalid body: `day` missing with `readStatus: 2`, a rating
    outside 1–5, or a `bookKey` outside 1–2000 characters.
  - 404 for an unknown group, or for no book with that key on membership-in
    and book changes. Taking out a key that has no book succeeds, so a
    dangling key can be cleaned up.
  - 413 with today's `LIBRARY_BODY_TOO_LARGE` body if the result would pass
    the cap.
  - A body over the routes' 64 KiB limit gets Fastify's own 413.
  - An unreadable stored document throws (500), as `addBook` does.
  - 409 if the stored document changed under the write. Everything runs in
    one synchronous step, so only another process can cause this. The app
    treats it as a failure.
- **Server cost.**
  - Membership and book changes parse and re-serialise the document and
    write only `data` and `updated_at`.
  - Match keys depend on ISBN, title, author, cover and position, so these
    changes leave them alone.
  - The reader glyph reads only series groups and `ReadStatus === 2`
    (`readerIdentity.ts:78`, `bookGenres.ts:84-86`). It is recomputed, with
    a glyph-only helper that builds no match keys, only for a membership
    change in a series group or a status moving to or from 2.
  - Otherwise the derived row's version moves with the document, so the
    startup re-derive skips it. That holds only where the derived row was
    current for the previous version; a row that was already stale stays
    stale for the backfill.
  - Book events come from the already-parsed books, and only for a change
    to status 2 or an add. With no stored document, the add is diffed
    against `{ books: [] }`, so the first add emits `book_added`, as
    `addBook` does.
  - `add` runs the full derive. It sits in the 30/min bucket for the same
    reason add-book and merge do. Its `deriveSeriesGroups` is quadratic today
    (3.2 s for 20,000 books in 2,000 series), so it is made linear first,
    with identical output.

  The plan measures the worst path of each kind at 1 MiB and 10 MiB and
  records the per-account budget of both buckets together. The O(library)
  JSON work goes when library rows become the source of truth (library-rows
  phase D); these routes keep their contract then.

## Apps: one saver, shared

The hard part is keeping the app's copy right while changes are in flight. It
lives once, in `@scripta/shared`, as a saver with injected `send`, `put`,
`fetch` and `write`, tested without React. Each app's hook is a thin adapter.

**What it keeps**
- `confirmed`: the last document from the server, with its `updatedAt`.
- `pending`: the changes not yet confirmed, in order.

What the app shows (the `["library"]` cache) is always `confirmed` with
`pending` applied. A tap adds to `pending` and is applied to the current view
at once. The view is recomputed from `confirmed` only when `confirmed` is
replaced or a change fails; at 20,000 books one change costs about 9 ms to
apply.

**One queue for the app's library writes.** Changes, whole-library saves and
merges go through one queue, one at a time, in order. A rename waits behind
ticks already sent. Share, unshare and the public-page add
(`POST /library/books`) stay outside it. They don't send the copy's
`updatedAt` as a precondition, and the public-page add doesn't touch the
cache.

**A change succeeds**
- If `baseUpdatedAt` equals `confirmed.updatedAt`, the server applied the
  change to exactly the app's copy. `confirmed` becomes `confirmed` plus the
  change, with the new `updatedAt`, and the change leaves `pending`. This
  does not apply to an add (below).
- Otherwise the app's copy was behind: a stale-first service-worker response,
  or another device. The app keeps its old `updatedAt`, marks the change as
  saved at the new one, and fetches. The change stays applied until a
  document at least that new arrives. If `confirmed` is already at least that
  new, the change leaves `pending` at once.
- **An add is never folded into `confirmed`.** `deriveSeriesGroups` creates
  groups with random ids and the current time, so the app's copy and the
  server's differ after an add that seeds a series. The add stays in
  `pending`, marked as saved at its `updatedAt`, and the app fetches. The
  fetched document is newer than `confirmed`, so it replaces it and the add
  leaves `pending`. With no stored document, `baseUpdatedAt` is `null`.

Taking a new `updatedAt` without the base check would let the next
whole-library save pass the precondition and silently undo changes the copy
never had.

**Every server document goes through `receive`.** That means fetches, `PUT`
echoes and merge responses.
- It applies at once and is not a queue job. A job that needs a document,
  such as the 409 replay, calls the injected `fetch` directly and passes the
  result to `receive`.
- A document older than `confirmed`, or at the same version, is ignored.
  When there is no `confirmed` yet, any document is accepted.
- A newer one replaces `confirmed` and drops the pending changes it already
  contains.
- Share and unshare don't move `updatedAt`; their `shareToken` and `shareUrl`
  are always applied. Because an equal version is ignored, a stale
  service-worker copy can't bring an old token back.
- The query function of `["library"]` is the saver's fetch, and it resolves to
  the saver's view after `receive`, never to the fetched document. That
  includes mobile's four screens with their own raw `GET`:
  `QuizCreateScreen.tsx:49`, `TierlistCreateScreen.tsx:28`,
  `TierlistEditorScreen.tsx:46` and `ArenaSeedScreen.tsx:25`. A 404 means no
  library, and those screens then show an empty shelf instead of "couldn't be
  loaded".

**Whole-library saves.** `saveWhole(updater)` replaces each app's
`updateLibrary`.
- When its turn comes, it runs the updater on `confirmed`, not on the view,
  so taps queued after it aren't uploaded early.
- It keeps today's single 409 replay: fetch, `receive`, then run the updater
  on that document and resend once. It also keeps web's skip when the updater
  returns the same data (`saveLibraryUpdate.ts:13`), in both apps.
- A reorder (`reorderOnDrop`, a pure updater) also joins `pending` so the
  card moves at once, as drag-reorder does today. Other whole saves don't,
  because some updaters create ids each time they run (`makeGroup` at
  `GroupsPage.tsx:134`).

**Failures and timeouts**
- A change that fails leaves `pending`, the view is recomputed, the app
  fetches, and the caller shows `saveFailureMessage`. Rollback doesn't depend
  on the fetch, which may return an older copy.
- Every queued request is aborted after a timeout and treated as a failure:
  30 s for a change, 60 s for a whole save. A hung request can't hold later
  edits behind it.
- On the web, `beforeunload` asks the reader to stay while `pending` is not
  empty.

**Callers learn the outcome.** A submitted change resolves `true` or `false`
when the server answers. The finish sheet opens on the status change's
result (`LibraryPage.tsx:763`, `book/[key]/index.tsx:28-29`).

**One saver per signed-in user.** Each app already makes its query client per
user (`frontend/src/main.tsx:14`, `mobile/src/app/_layout.tsx:19`). The saver
lives beside it, provided through a context next to `QueryClientProvider`.
`dispose()` drops unsent jobs and stops the running one at its next await:
no fetch, replay, resend or `write` after it. Both apps read the token on
every request, so an old account's job could otherwise send under the new
one.

## Release order

Mobile's JavaScript ships over the air on any push to `main` that touches
`mobile/**` or `packages/shared/**` (`mobile/.eas/workflows/production-update.yml`).
The web ships from the same push. Railway deploys the backend separately, and
deploys can be paused. So there are two PRs:

1. **Shared helpers and the server routes.** The apps' only changes are the
   shared add pipeline, which gives identical output, and the membership
   helpers no longer stamping a group on a no-op. The over-the-air update it
   triggers is harmless.
2. **Both apps' saver adapters and callers.** This merges only after the
   routes answer in production:
   `curl -s -o /dev/null -w '%{http_code}' -X PATCH https://api.atmyshelf.com/library/books`
   returns 401, not 404.

Installed builds keep uploading whole libraries, which the server keeps
accepting. A build that has the saver but meets a 404 rolls back every change
and says so, so the gate matters.

## Not in this phase

These stay on `PUT /library`:
- group create, rename, delete and style;
- book and library style;
- renaming the library;
- notes and undo-finish;
- reorder and covers;
- deleting books;
- import and duplicates;
- the gallery scrub and genre enrichment.

Style edits are already debounced, and none of the rest fires once per tap.
They now go through the same queue, so they no longer collide with ticks.

## Fit with the other specs

- **Library rows, phase B.** Rows are kept in step on every path that writes
  the document, and these routes are such paths. Whichever ships second
  covers the other. B's `library_summary` counts change on any status
  change, so "the derived row's version moves with the document" holds only
  for today's glyph-only derived row. Once B lands, a status change updates
  the summary counts too.
- **Phase C.** The library-rows spec lists this as phase C. It doesn't wait
  for B.

## Verification

- **Server.**
  - For each kind, the stored document equals `applyLibraryChange` on the
    previous one.
  - A membership or book change sent twice writes once.
  - Match keys are untouched except on add.
  - The glyph is recomputed only when its inputs change, and the boot
    backfill then re-derives nothing.
  - Events.
  - 400, 404, 409 (at the repository) and 413.
  - Both buckets.
  - `deriveSeriesGroups` gives the same output as before on the existing
    tests and on a 20,000-book case, and runs in linear time.
- **Saver.**
  - A copy that is behind doesn't take the new `updatedAt`, and the next
    whole save gets a 409. Cover the two-device case, the
    stale-service-worker case, and a rename racing a tick.
  - on-off-on never shows off after the last tap, and still ends on when
    the first save fails.
  - Pending ticks survive a document landing mid-queue.
  - Failure rolls back without the fetch's help.
  - Jobs are dropped on a user change.
- **Apps.** In a browser and on a device:
  - tick a run of boxes quickly, then set status and rating, then add a
    book;
  - each change shows at once and is still there after a reload;
  - the same while another device edits the library.
