# Small saves: send the change, not the library

Date: 2026-10-02
Status: scope approved in conversation (group checkboxes, read status and
rating, adding a book); design awaiting review

## Problem

Every library change in both apps uploads the whole library: `PUT /library`
with the full document. Some actions fire once per tap, so a burst of taps is
a burst of whole-library uploads:

| Action | Web | Mobile | Cadence |
|---|---|---|---|
| Tick a book in a group | `GroupsPage.tsx:186-195` | `GroupDetail.tsx:79-85` | every tap |
| Set read status | `LibraryPage.tsx:243-258`, `PickNextSheet.tsx:27` | `useLibraryActions.ts:67-71` | every tap |
| Rate a book | `LibraryPage.tsx:260-275` | `useLibraryActions.ts:73-76` | every tap |
| Add a book (form or search) | `LibraryPage.tsx:152-164` (`mergeAndSave`) | `lib/mergeAndSave.ts:14-18` | every submit |

What that costs:

- **The user waits.** Each tap uploads the library and the server answers
  with all of it again, and the checkbox only changes when that round trip
  ends. Neither app is optimistic, except web drag-reorder.
- **Taps collide.** The apps don't queue saves, so a second tap while the
  first is in flight sends the same `updatedAt` and gets a 409. The apps then
  re-download the library and upload it again. Eighteen quick ticks made 30
  uploads and 12 downloads in the branch review.
- **The server pays for the whole library every time.** At the 10 MiB cap a
  save costs 0.3–0.65 s of the single thread: parse, derive, rewriting up to
  20,000 match-key rows, and the echo. That is why big saves are limited to
  30 a minute (load-safety spec, workstream 1).

Today's libraries are small: the largest in production is 67 KB. This is
about making the common actions cheap before libraries grow, and making taps
feel instant now.

## What changes

Three new endpoints. Each takes only the change and answers
`{ updatedAt }`. They are additive: `PUT /library` stays as it is for
installed builds and for every other action.

| Endpoint | Body | Effect |
|---|---|---|
| `POST /library/groups/:groupId/books` | `{ bookKey, member: boolean }` | Puts the book in the group, or takes it out. The body carries the state the checkbox shows, not a toggle, so a retry is harmless |
| `PATCH /library/books` | `{ bookKey, readStatus?, rating?, day? }` | Sets fields on every book with that `bookKey()`, as the apps do today |
| `POST /library/books/add` | `{ book }` | Merges one book into the library through the same pipeline the apps run before their `PUT`: `mergeLibraryData`, `assignBookOrder`, `deriveSeriesGroups` |

- **`bookKey` travels in the body.** Keys can be long titles with `|` and
  spaces, and Fastify's default `maxParamLength` is 100.
- **One function applies a change, everywhere.** `@scripta/shared` gains
  `applyLibraryChange(data, change)`, where `change` is one of:
  - `{ kind: "membership", groupId, bookKey, member }`
  - `{ kind: "book", bookKey, readStatus?, rating?, day? }`
  - `{ kind: "add", book }`

  It is built from the helpers the apps use today: `addBookToGroup` and
  `removeBookFromGroup` (`groups.ts:77,83`), with key-based variants so a
  dangling key can be removed; `setReadStatus` (`libraryView.ts:63`);
  `setRating` (`finish.ts:13`); and the add pipeline. The server runs it on the
  stored document and the apps run it on their cache, so both hold the same
  library. The add pipeline exists twice today, as web's `mergeAndSave` in
  `LibraryPage.tsx:152-164` and mobile's `buildMergedLibrary` in
  `lib/mergeAndSave.ts`. It moves into `@scripta/shared` once, and both apps
  and the server use that copy.
- **Last write wins per change.** A small save reads the stored document,
  applies the change and writes it back in one synchronous step. Two apps
  ticking different boxes no longer conflict.
- **`updatedAt` still moves.** An old build holding the previous `updatedAt`
  gets a 409 on its next `PUT` and replays, as it does today.
- **Answers:**
  - Unknown group: 404.
  - No book with that key, when adding to a group or patching: 404. Removing
    a key that isn't there succeeds, so a dangling key can be cleaned up.
  - Body invalid: 400.
  - The added book would take the library over the cap: 413, with the same
    body as today.
- **Book events** follow today's rules. `book_finished` is emitted when a
  patch moves a book to finished, and `book_added` when an add creates a new
  book. The per-save and per-day caps apply.
- **The existing `POST /library/books`**, the public-page add with
  `{key, updated}`, is unchanged.

### Server cost

A small save still parses and re-serialises the stored document, so it costs
O(library) in JSON work. It skips everything else a `PUT` does:

- **Match keys** depend only on ISBN, title and author. A group change, a
  status or a rating leaves them as they are. Only `add` rewrites them.
- **The reader glyph** is recomputed only when its inputs can change:
  membership of a series group, and a status moving to or from finished.
  Otherwise the derived row's version moves with the document, so the
  startup re-derive doesn't redo it.
- **No upload, no echo.** The response is `{ updatedAt }`.

The expected cost is a fraction of a `PUT` at the same size. Task 1 of the
plan measures it at 1 MiB and 10 MiB before the limits below are fixed.

The O(library) part goes when library rows become the source of truth (the
library-rows spec, phase D). These endpoints keep their contract then; only
their inside changes.

### Rate limits

The small saves share their own bucket per account: **120 a minute**. A tap
there costs a fraction of a whole-library save, so the 30-a-minute tier for
big saves does not apply. Task 1's measurement confirms the number.

## The apps

Both apps send these three actions as small saves. Everything else still uses
`PUT /library`.

- **Optimistic.** The app applies the same shared helper to its cached
  library at once, so the checkbox, status or rating changes on tap. Then it
  sends the small save.
- **One at a time, in order.** Small saves go through a queue: the next is
  sent when the previous one has answered. A fast on-off-on stays on.
  `createShelfSession` (`packages/shared/src/murals/finish.ts:64-130`) is the
  precedent for a serialised chain. The queue itself lives in
  `@scripta/shared`, and each app's cache glue stays in its own hook.
- **On success** the app re-applies the change to whatever the cache holds
  now, and takes the newer `updatedAt`. The helpers are idempotent, so
  re-applying is safe, and a whole-library response that landed in between
  can't undo the tick.
- **Cache writes are latest-wins by `updatedAt`.** A `PUT` response older than
  what the cache holds no longer replaces it. Today every response overwrites
  the cache unconditionally.
- **On failure** the app refetches the library, which undoes the optimistic
  change, and shows `saveFailureMessage`.
- **Order of release.** The backend deploys first. Web ships from `main` with
  it. Mobile uses the endpoints from its next build. Installed builds keep
  uploading the whole library, which the server keeps accepting.

## Not in this phase

Group create, rename, delete and style; book and library style; renaming the
library; notes and undo-finish; reorder; covers; deleting books; import;
duplicates; the gallery scrub; genre enrichment. They stay on `PUT /library`.
Style edits are already debounced, and none of the rest fires once per tap.
Candidates for later small saves, in order of how often they fire.

## Fit with the other specs

- **Library rows** (phase B). Rows are kept in step on every path that writes
  the document. These endpoints are such paths, so whichever of the two ships
  second covers the other.
- The library-rows spec's phase table lists per-book writes as phase C. This
  spec is that phase, and it doesn't wait for phase B.

## Verification

- **Server.** For every endpoint and every change, the stored document must
  equal what the app would have uploaded: apply the same helper to the same
  document and compare. Also test:
  - idempotency (the same body twice);
  - 404 and 400 cases, and 413 at the cap;
  - book events and their caps;
  - match keys untouched except on add;
  - the glyph recomputed only when its inputs change;
  - the rate limit.
- **Apps.**
  - The queue keeps order: on-off-on ends on, also when an earlier save fails.
  - The optimistic change survives a whole-library response landing in between.
  - A failure rolls back and shows the message.
  - A stale `PUT` response no longer overwrites a newer cache.
- **Device pass on both apps.** Tick a run of boxes quickly in a group, set
  status and rating, and add a book. Each change shows at once and is still
  there after a reload.
