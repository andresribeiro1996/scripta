# Cover Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners pick a book's cover from what the catalog's sources find (stored covers, Kobo, ISBNdb, Open Library, then Apple), on web and mobile. A pick changes only their library. On web, the admin can also apply a pick to everyone.

**Architecture:**
- **Shared:** `@scripta/shared` gains the candidate types, `isAcceptableCover` (moved from the backend), and the pure logic both pickers use: which tiles to show, which is current, and the request shapes.
- **Backend:** the books module gains `listImages`, a `cover_images(book_id)` index, and a step builder extracted from `findBestCover`. Two service methods (`listCoverCandidates`, `pickCover`) back two routes. The service keeps an in-memory offer map, so a pick can only download a URL the server listed.
- **Clients:** each picker gets a Found covers section that loads the remote images directly and measures them. A personal pick writes `_coverUrl` through the save path gallery picks already use.

**Tech Stack:** Fastify + TypeScript + `node:sqlite` (backend); `@scripta/shared`; React/Vite (web); Expo/React Native (mobile); `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-26-cover-picker-design.md`

## Global Constraints

- **Names.** The catalog image id is always `coverImageId`, never `imageId`, because `CoverLookupParams.imageId` is the Kobo ImageId.
- **Limits:**
  - offers last 30 minutes (`COVER_OFFER_TTL_MS = 30 * 60 * 1000`)
  - a picked `url` is at most 2,000 characters
  - at most 3 candidates per step (the existing `CANDIDATES_PER_STEP`)
- **Picker lookups never change a book's cover state.** They never call `setCover`, `setAppleChecked`, `setUpgradeWanted` or `deps.warn`, and never touch `backoffUntil`. The one exception is `pickCover` with `everyone: true`.
- **HTTP statuses:**

  | Status | When |
  |---|---|
  | 400 | invalid input |
  | 403 | `everyone` from a non-admin |
  | 404 | no catalog book, or a `coverImageId` that isn't a usable row of that book |
  | 409 | a `url` not on offer to this account for this book |
  | 422 | an unusable image |
  | 502 | a failed download |

- **Copy, verbatim:**

  | Where | Text |
  |---|---|
  | Section title | "Found covers" |
  | Apple tile while waiting | "Checking Apple Books…" |
  | Per unavailable source | "`<label>` didn't answer." |
  | Admin action | "Use for everyone" |
  | 409 | "That cover offer expired. Reopen the picker." |
  | 422 | "That image can't be used as a cover." |
  | 502 | "Couldn't download that cover. Try again." |
  | Save failure (existing text) | "Couldn't save the cover change." |

- **Source labels:**

  | Source | Label |
  |---|---|
  | `kobo` | Kobo |
  | `isbndb` | ISBNdb |
  | `openlibrary` | Open Library |
  | `apple` | Apple Books |
  | `bnp` | National Library of Portugal |
  | `publisher` | Publisher |
  | `upload` | Admin upload |
  | anything else | the raw name |

- **Additive API only** (`backend/AGENTS.md`). No existing route, field or document key changes meaning.
- **Tests.** Every new backend `*.test.ts` goes into `backend/package.json`'s `test` list. Shared tests are picked up by glob.
- **Code.** No comments in code. Run `typecheck` in each package touched, and `lint` in `frontend`. Run `node scripts/gate.mjs` before claiming a task done.

## Review Focus

1. **Server-side request forgery.** `pickCover` downloads only a URL that `listCoverCandidates` offered to the same account for the same book within 30 minutes. A URL offered to another account, or for another book, gets a 409. Pinned in Task 4.
2. **No side effects from browsing.** Listing candidates, including a paused or spent ISBNdb, logs no warning, stamps nothing, and leaves `cover_status`, `cover_checked_at`, `apple_checked_at` and the backoff alone. Pinned in Task 4.
3. **A personal pick leaves the catalog cover alone.** Only an admin's `everyone: true` sets it, as `manual`. Pinned in Tasks 4 and 5.
4. **`findBestCover` behaves the same after the step extraction.** The existing `coverResolver.test.ts` cases pass unchanged. Pinned in Task 3.
5. **One stored row per `(book, source_url)`.** Picking an already-stored URL reuses its row and downloads nothing. Pinned in Task 4.
6. **Picker lookups use the urgent lane of the shared throttles.** They never get throttles of their own, which would double the request rate a source sees. Pinned in Task 5.

---

### Task 1: Shared candidate helpers, and move `isAcceptableCover` into shared

**Files:**
- Create: `packages/shared/src/library/coverCandidates.ts`
- Test: `packages/shared/src/library/coverCandidates.test.ts`
- Modify: `packages/shared/src/library/bookCovers.ts`
- Test: `packages/shared/src/library/bookCovers.test.ts`
- Modify: `packages/shared/src/library/index.ts`
- Modify: `backend/src/modules/books/domain/images.ts`
- Modify: `backend/src/modules/books/domain/images.test.ts`
- Modify: `backend/src/modules/books/coverResolver.ts`

**Interfaces:**
- Produces, from `@scripta/shared`:
  - `COVER_MIN_ASPECT_RATIO = 1.2` and `COVER_MAX_ASPECT_RATIO = 1.9`
  - `isAcceptableCover(source: string, width: number, height: number): boolean`. This is the same body as `backend/src/modules/books/domain/images.ts:249-253`, including the ISBNdb 200×248 placeholder.
  - `type CoverPickSource = "quick" | "apple"`
  - `interface CoverCandidateView { source: string; url: string; fullUrl: string; coverImageId: string | null; width: number | null; height: number | null }`
  - `interface CoverCandidatesResponse { candidates: CoverCandidateView[]; unavailable: string[] }`
  - `type CoverChoice = { coverImageId: string } | { url: string }`
  - `coverCandidatesQuery(params: CoverLookupParams, from: CoverPickSource): string`. It is `coverQueryKey(params)` with `&from=apple` appended only for `"apple"`, so the Kobo `imageId` is never sent.
  - `pickCoverBody(params: CoverLookupParams, choice: CoverChoice, everyone: boolean): { isbn?: string; title?: string; author?: string; coverImageId?: string; url?: string; everyone?: true }`. It never includes the Kobo `imageId`, and includes `everyone` only when true.
  - `visibleCandidates(candidates: CoverCandidateView[], measured: ReadonlyMap<string, { width: number; height: number } | null>): Array<{ candidate: CoverCandidateView; width: number | null; height: number | null }>`. Rules:
    - a stored candidate (`coverImageId !== null`) always shows, with its own size
    - a found candidate with no `measured` entry shows with null size, because it is still loading
    - a found candidate measured as `null` (it failed to load) is dropped
    - a found candidate measured with a size failing `isAcceptableCover` is dropped
    - order is preserved
  - `isCurrentCover(candidate: CoverCandidateView, coverUrl: unknown): boolean`. True when `coverUrl` is a non-empty string equal to `candidate.url` or `candidate.fullUrl`.
  - `coverSourceLabel(source: string): string`, using the label table in Global Constraints.
  - `setBookCoverUrl(book, url)` in `bookCovers.ts`. It returns the book without `_coverImageId` and with `_coverUrl: url`.

- [ ] **Step 1: Write failing tests.**
  - In `coverCandidates.test.ts`:
    - `isAcceptableCover`: move the cases from `backend/src/modules/books/domain/images.test.ts:54-62` verbatim.
    - `coverCandidatesQuery`: `{isbn:"9780441013593", imageId:"abc", title:"Dune"}` with `"quick"` gives `"isbn=9780441013593&title=Dune"`; with `"apple"` it ends in `"&from=apple"`.
    - `pickCoverBody`: the same params with `{url:"https://x/1.jpg"}` and `false` deep-equals `{isbn:"9780441013593",title:"Dune",url:"https://x/1.jpg"}`. With `{coverImageId:"id"}` and `true` it has `coverImageId:"id"` and `everyone:true`, and no `imageId` key.
    - `visibleCandidates`:
      - a stored candidate of 600×900 shows as 600×900 with no measurement
      - an unmeasured found candidate shows with null sizes
      - a found candidate measured `null` is dropped
      - a found ISBNdb candidate measured 200×248 is dropped
      - a found Apple candidate measured 1400×1400 is dropped (bad ratio)
      - order is preserved
    - `isCurrentCover`: it matches on `fullUrl`, matches on `url`, and is false for `undefined`, `""` and a different URL.
    - `coverSourceLabel`: every row of the table, plus `"mystery"` → `"mystery"`.
  - In `bookCovers.test.ts`: `setBookCoverUrl({Title:"A", _coverImageId:"g1", _coverUrl:"https://g/1"}, "https://c/2")` deep-equals `{Title:"A", _coverUrl:"https://c/2"}`.

- [ ] **Step 2: Run to verify failure.**
  Run: `npm test --workspace @scripta/shared`
  Expected: FAIL (the module is not found).

- [ ] **Step 3: Implement.**
  - Write `coverCandidates.ts` and `setBookCoverUrl`.
  - Export `coverCandidates.js` from `packages/shared/src/library/index.ts`, next to `covers.js`.
  - In `backend/src/modules/books/domain/images.ts`:
    - delete the local `MIN_ASPECT_RATIO`, `MAX_ASPECT_RATIO`, `ISBNDB_PLACEHOLDER` and `isAcceptableCover`
    - import `COVER_MIN_ASPECT_RATIO` and `COVER_MAX_ASPECT_RATIO` from `@scripta/shared` for the two remaining uses (`images.ts:235`, `:241`)
  - Switch `backend/src/modules/books/coverResolver.ts:4` to import `isAcceptableCover` from `@scripta/shared`.
  - Delete the moved cases from `images.test.ts`, along with its `isAcceptableCover` import.

- [ ] **Step 4: Run to verify pass.**
  Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && cd backend && npx tsx --test src/modules/books/domain/images.test.ts src/modules/books/coverResolver.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/shared/src/library/coverCandidates.ts packages/shared/src/library/coverCandidates.test.ts packages/shared/src/library/bookCovers.ts packages/shared/src/library/bookCovers.test.ts packages/shared/src/library/index.ts backend/src/modules/books/domain/images.ts backend/src/modules/books/domain/images.test.ts backend/src/modules/books/coverResolver.ts
  git commit -m "Add shared cover candidate helpers and move isAcceptableCover into shared"
  ```

### Task 2: `listImages` and the `cover_images(book_id)` index

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces, on `BooksRepository`: `listImages(bookId: string): CoverImageRow[]`. It returns the book's rows ordered `created_at DESC, rowid DESC`.

- [ ] **Step 1: Write failing tests** in `sqliteBooksRepository.test.ts`:
  - `listImages returns a book's images newest first`: insert three rows for book A, with `created_at` `…01`, `…03` and `…02`, and one row for book B. Assert A's ids come back in the order `03, 02, 01` and B's row is absent.
  - `listImages index exists`: `PRAGMA index_list(cover_images)` includes `idx_cover_images_book`.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add `CREATE INDEX IF NOT EXISTS idx_cover_images_book ON cover_images(book_id);` directly after the `cover_images` table in `books.sql`. That file runs on every boot (`connection.ts:32`).
  - Add the method to `ports.ts` beside `getImage`.
  - Add the prepared statement and method in `sqliteBooksRepository.ts`, next to `imageStmt` and `getImage` (`:857`).

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**
  Run: `npm run typecheck --workspace backend`
  ```bash
  git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts
  git commit -m "Add listImages and an index on cover_images(book_id)"
  ```

### Task 3: Extract cover steps from `findBestCover`

**Files:**
- Modify: `backend/src/modules/books/coverResolver.ts`
- Test: `backend/src/modules/books/coverResolver.test.ts`

**Interfaces:**
- Produces, from `coverResolver.ts`:
  - `type CoverBook = { isbn: string | null; title: string; author: string; koboImageId?: string | null; isbnOnly?: boolean }`. This is the existing first parameter of `findBestCover`, now named.
  - `coverSteps(book: CoverBook, sources: CoverSources): Array<() => Promise<CoverCandidate[]>>`. The steps are, in order:
    - Kobo, when `koboImageId` is set
    - by ISBN, for each source in `[apple, isbndb, openlibrary]` that is not null
    - by title, for the same sources, unless `isbnOnly` is set or the normalized title is empty

    Title steps use the existing title and author `accept` function.
  - `offerable(candidates: CoverCandidate[], rejected: Set<string>): CoverCandidate[]`. It drops rejected URLs, then keeps the first `CANDIDATES_PER_STEP`.
  - `findBestCover` keeps its exact signature and behaviour, built on the two functions above.

- [ ] **Step 1: Write failing tests** in `coverResolver.test.ts`:
  - `coverSteps orders Kobo, then ISBN, then title, skipping null sources`: record calls on fake sources, with `isbndb: null`.
  - `coverSteps with isbnOnly has no title steps`.
  - `coverSteps with an empty normalized title has no title steps`.
  - `offerable drops rejected URLs before capping at 3`: given 5 candidates with the first rejected, it returns candidates 2, 3 and 4.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/coverResolver.test.ts`
  Expected: FAIL (the functions are not exported).

- [ ] **Step 3: Implement.** Refactor without changing what `findBestCover` does. The existing tests must pass untouched.

- [ ] **Step 4: Run to verify pass.**
  Run: `cd backend && npx tsx --test src/modules/books/coverResolver.test.ts src/modules/books/booksService.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**
  Run: `npm run typecheck --workspace backend`
  ```bash
  git add backend/src/modules/books/coverResolver.ts backend/src/modules/books/coverResolver.test.ts
  git commit -m "Extract cover steps from findBestCover"
  ```

### Task 4: `listCoverCandidates` and `pickCover` in the books service

**Files:**
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/domain/errors.ts`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Consumes: `coverSteps` and `offerable` (Task 3), `listImages` (Task 2), and `CoverCandidateView`, `CoverCandidatesResponse`, `CoverChoice` and `CoverPickSource` (Task 1).
- Produces:
  - **New optional deps on `BooksServiceDeps`:**
    - `pickerSources?: CoverSources`, defaulting to `deps.sources`
    - `fetchPickedImage?: FetchCoverImage`, defaulting to `deps.fetchImage`
  - **Errors in `domain/errors.ts`:**
    - `CoverOfferExpiredError`, with message "That cover offer expired. Reopen the picker."
    - `UnusableCoverError`, with message "That image can't be used as a cover."
  - **On `BooksService`:**
    - `listCoverCandidates(userId: string, lookup: BookLookup, from: CoverPickSource): Promise<CoverCandidatesResponse>`
    - `pickCover(userId: string, lookup: BookLookup, choice: CoverChoice, everyone: boolean): Promise<ResolvedCover>`
  - **Internal helpers:**
    - `isbnOnlyFor(book: BookRow): boolean`, extracted from `booksService.ts:343` (`created_by === "bnp" && year !== null && year < ISBN_ONLY_BEFORE_YEAR`). `processBook` uses it too.
    - `setManualCover(bookId: string, imageId: string, at: string)`, extracted from the tail of `uploadCover` (`setCover` manual, `setUpgradeWanted(null)`, `backoffUntil.delete`). `uploadCover` uses it too.

**Behaviour:**
- **`listCoverCandidates`:**
  - It finds or creates the book with `findOrCreateBook(deps.repo, lookup, at)`, and throws `BookNotFoundError` when that returns nothing.
  - It reads `rejected = listRejectedUrls(book.id)` and `stored = listImages(book.id)` once, keeping only rows whose `source_url` is null or not rejected. The `seen` set starts as the stored rows' `source_url`s.
  - With `from === "quick"`, it returns the stored rows first, as `{ source, url: publicUrlFor(id, "thumb"), fullUrl: publicUrlFor(id, "file"), coverImageId: id, width, height }`.
  - It builds `coverSteps({ isbn, title, author, koboImageId: book.kobo_image_id, isbnOnly: isbnOnlyFor(book) }, sources)`:
    - for `"quick"`, sources are `{ ...pickerSources, apple: NO_SOURCE }`
    - for `"apple"`, sources are `{ apple: pickerSources.apple, isbndb: null, openlibrary: NO_SOURCE }`, and the Kobo step is dropped by passing `koboImageId: null`
  - It runs the steps in order, one at a time:
    - a step that throws `SourceUnavailableError` (including `SourcePausedError`) adds `error.source` to `unavailable` (de-duplicated) and is skipped
    - any other error propagates
    - from each step's `offerable(result, rejected)`, every URL not in `seen` becomes `{ source, url, fullUrl: url, coverImageId: null, width: null, height: null }` and is added to `seen`
  - It records every found URL in the offer map, keyed `${userId}\n${book.id}`, mapping url → `{ source, expiresAt: now + COVER_OFFER_TTL_MS }`. On each write, entries whose `expiresAt` has passed are removed, and so are keys left empty.
- **`pickCover`:**
  - It finds the book with `findByIdentity(lookupIdentity(lookup))` and throws `BookNotFoundError` when there is none.
  - With `coverImageId`: the row must exist, have `book_id === book.id`, and have a `source_url` that is null or not rejected; otherwise `BookNotFoundError`.
  - With `url`:
    - The URL must be in the offer map for this user and book and not expired, or the method throws `CoverOfferExpiredError`.
    - If `listImages(book.id)` has a row with `source_url === url`, it reuses that row.
    - Otherwise it calls `fetchPickedImage({ source, url })`. A `SourceUnavailableError` propagates. A `null` result, or one failing `isAcceptableCover`, throws `UnusableCoverError`. A usable image is stored with `storeCoverImage(deps, book.id, source, url, image, at)`.
  - With `everyone`, it calls `setManualCover(book.id, imageId, at)`.
  - It returns `coverOf(imageId, false)`.

- [ ] **Step 1: Write failing tests** in `booksService.test.ts`, using its `harness`, the `sizes` map and the fake sources:
  - `candidates list stored covers first, newest first, hiding rejected ones`.
  - `candidates drop duplicate URLs across steps and against stored source URLs`.
  - `candidates cap each step at 3`.
  - `candidates skip title steps for a pre-2002 BNP book`.
  - `quick candidates never ask Apple; apple candidates ask only Apple and skip Kobo`.
  - `apple candidates drop a URL already stored for the book`.
  - `an unavailable source is reported, not warned, and stamps nothing`:
    - ISBNdb throws `SourcePausedError`, and the response has `unavailable: ["isbndb"]`
    - `warnings` is empty
    - the book's `cover_status`, `cover_checked_at` and `apple_checked_at` are unchanged
    - `enqueued` is empty
  - `pick downloads an offered URL and stores it without touching the catalog cover`.
  - `pick reuses a stored row for the same source URL without downloading`. Assert `fetchPickedImage` is not called.
  - `pick refuses a URL never offered, offered to another user, offered for another book, or older than 30 minutes`. Each throws `CoverOfferExpiredError`; advance the harness clock for the last case.
  - `pick throws UnusableCoverError for a placeholder or missing image and stores nothing`.
  - `pick lets a download failure propagate as SourceUnavailableError`.
  - `pick with everyone sets a manual cover and clears the upgrade mark`.
  - `pick by coverImageId refuses another book's image or a rejected one`.
  - `uploadCover still sets a manual cover`. This existing behaviour must stay green after the `setManualCover` extraction.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/booksService.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** as described above.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**
  Run: `npm run typecheck --workspace backend`
  ```bash
  git add backend/src/modules/books/booksService.ts backend/src/modules/books/domain/errors.ts backend/src/modules/books/booksService.test.ts
  git commit -m "Add cover candidate listing and picks to the books service"
  ```

### Task 5: Routes, urgent-lane wiring and docs

**Files:**
- Modify: `backend/src/modules/books/routes.ts`
- Test: `backend/src/modules/books/routes.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `listCoverCandidates` and `pickCover` (Task 4).
- Produces:
  - `GET /covers/candidates`. It takes `lookupSchema` plus `from: z.enum(["quick","apple"]).default("quick")`, and returns `CoverCandidatesResponse`.
  - `POST /covers/pick`. Its body is `lookupSchema` plus `coverImageId: z.string().uuid().optional()`, `url: z.string().url().max(2000).optional()` and `everyone: z.boolean().optional()`. Exactly one of `coverImageId` and `url` is allowed. It returns `ResolvedCover`.
  - Both routes are added to `buildCatalogRoutes` behind `authGuard`.

- [ ] **Step 1: Write failing tests** in `routes.test.ts`, using `makeService` and `call`:
  - `candidates require auth` → 401.
  - `candidates reject a lookup without isbn or title, and a bad from` → 400.
  - `candidates return the service response` (a fake source with one URL, plus a stored image).
  - `pick rejects both or neither of coverImageId and url, and a non-URL url` → 400.
  - `pick everyone from a non-admin` → 403, and the service is not called (no image stored).
  - `pick maps errors`:
    - `BookNotFoundError` → 404
    - `CoverOfferExpiredError` → 409, with its message
    - `UnusableCoverError` → 422
    - `SourceUnavailableError` → 502, with "Couldn't download that cover. Try again."
  - `pick returns the stored cover's URLs` for an offered URL.
  - `pick everyone from the admin sets the catalog cover`. A following `GET /covers/resolve` returns the picked image.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/routes.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement the routes.**
  - Validate `isLookable`.
  - For `everyone` from a non-admin, return 403 before calling the service.
  - Map the errors as listed. Rethrow anything else.

- [ ] **Step 4: Wire the urgent lane in `plugin.ts`.**
  - Hoist the Apple throttle into `const appleThrottle = createThrottle(APPLE_GAP_MS)`, and use it for the worker's Apple source.
  - Add `const urgentLane = (throttle: Throttle): Throttle => (task) => throttle(task, { urgent: true })`.
  - Pass `pickerSources` built from the same throttles, the same `isbndbGate` and the same `isbndbSpend`:
    - `isbndb: isbndbConfigured ? createIsbndbSource(env.ISBNDB_API_KEY, urgentLane(isbndbThrottle), isbndbGate, isbndbSpend) : null`
    - `apple: createAppleSource(urgentLane(appleThrottle))`
    - `openlibrary: createOpenLibraryCoverSource(urgentLane(openLibraryThrottle))`
  - Turn the `fetchImage` body into `makeFetchImage(openLibraryCover: Throttle, koboCover: Throttle): FetchCoverImage`. `fetchImage` is `makeFetchImage(openLibraryCoverThrottle, koboCoverThrottle)`, and `fetchPickedImage` is `makeFetchImage(urgentLane(openLibraryCoverThrottle), urgentLane(koboCoverThrottle))`.

- [ ] **Step 5: Docs.** In `backend/README.md`, under `books`:
  - Add both routes to the module table row and the route table.
  - Add one bullet, "**The cover picker lists and stores candidates on demand**", covering:
    - the order of the stored and found groups
    - the 30-minute offer guard and why (the server only fetches URLs it listed)
    - the urgent lane
    - no stamps
    - reuse by `source_url`
    - `everyone` being admin-only and setting a `manual` cover
    - ISBNdb's budget cost (up to 2 calls per open)

- [ ] **Step 6: Run, typecheck, commit.**
  Run: `cd backend && npx tsx --test src/modules/books/routes.test.ts && cd .. && npm run typecheck --workspace backend && node scripts/gate.mjs`
  ```bash
  git add backend/src/modules/books/routes.ts backend/src/modules/books/routes.test.ts backend/src/modules/books/plugin.ts backend/README.md
  git commit -m "Add cover candidate and pick routes on the urgent lane"
  ```

### Task 6: Web picker section

**Files:**
- Modify: `frontend/src/api/covers.ts`
- Create: `frontend/src/components/FoundCovers.tsx`
- Modify: `frontend/src/components/CoverPickerModal.tsx`
- Modify: `frontend/src/hooks/useBookActions.ts`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx`

**Interfaces:**
- Consumes: the shared helpers (Task 1), the routes (Task 5), `apiFetch`, `rememberResolvedCover` and the `["books-admin"]` query (`frontend/src/components/book/BookScreen.tsx:72`).
- Produces:
  - In `api/covers.ts`:
    - `fetchCoverCandidates(params: ResolveCoverParams, from: CoverPickSource): Promise<CoverCandidatesResponse>`
    - `pickCover(params: ResolveCoverParams, choice: CoverChoice, everyone: boolean): Promise<ResolvedCoverResponse>`
  - On `useBookActions`: `saveCoverUrl(book, url)` (via `setBookCoverUrl`) and `useCoverForEveryone(book, cover)`:
    - it calls `rememberResolvedCover(coverParamsFor(book), cover)`
    - if the book has `_coverUrl`, it saves `clearBookCover`
  - On `CoverPickerModal`, new optional props:
    - `lookup?: ResolveCoverParams`
    - `coverUrl?: string | null`
    - `isAdmin?: boolean`
    - `onPickFound?: (cover: ResolvedCoverResponse, everyone: boolean) => void`

    `FoundCovers` renders only when `lookup` and `onPickFound` are both set, so the group and mural pickers are unchanged.

- [ ] **Step 1: `FoundCovers.tsx`.**
  - **Loading:** on mount it fires `fetchCoverCandidates(lookup, "quick")` and `fetchCoverCandidates(lookup, "apple")` in parallel, and appends Apple's candidates when they arrive.
  - **Tiles:** each tile renders an `<img>`:
    - `onLoad` records `naturalWidth` and `naturalHeight` in a `measured` map
    - `onError` records `null`
    - the tiles shown are `visibleCandidates(all, measured)`
    - each tile shows its size (when known) and `coverSourceLabel`
    - a tile for which `isCurrentCover(candidate, coverUrl)` holds gets the current-pick ring the gallery uses for `currentImageId`
  - **Waiting and failures:**
    - while the Apple request is pending, the "Checking Apple Books…" tile shows
    - one muted line per de-duplicated name in both responses' `unavailable`
    - a failed list request shows the error text in place of the section
  - **Choosing:**
    - clicking a tile calls `pickCover(lookup, choice, false)`, where the choice is `coverImageId` when set, otherwise `url`, then `onPickFound(cover, false)`
    - with `isAdmin`, a second button, "Use for everyone", does the same with `true`
    - errors show on that tile, using the server's message (`ApiError` message)
  - Match the gallery grid's markup, sizes and keyboard handling in `CoverPickerModal.tsx`.

- [ ] **Step 2: Mount it.**
  - Render `FoundCovers` above the gallery grid in `CoverPickerModal.tsx`, under the heading "Found covers".
  - In `BookScreen.tsx:407` and `LibraryPage.tsx:549`, pass:
    - `lookup={coverParamsFor(book)}`
    - `coverUrl={book._coverUrl}`
    - `isAdmin`, from the `["books-admin"]` query (add the same `useQuery` to `LibraryPage`)
    - `onPickFound`, which calls `saveCoverUrl(book, cover.fullUrl)` for a personal pick or `useCoverForEveryone(book, cover)` for `everyone`, then closes the modal

- [ ] **Step 3: Verify.**
  Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && node scripts/gate.mjs`
  Expected: PASS.

- [ ] **Step 4: Commit.**
  ```bash
  git add frontend/src/api/covers.ts frontend/src/components/FoundCovers.tsx frontend/src/components/CoverPickerModal.tsx frontend/src/hooks/useBookActions.ts frontend/src/components/book/BookScreen.tsx frontend/src/pages/LibraryPage.tsx
  git commit -m "Add found covers to the web cover picker"
  ```

### Task 7: Mobile picker section

**Files:**
- Modify: `mobile/src/features/library/api/covers.ts`
- Create: `mobile/src/features/library/components/FoundCovers.tsx`
- Modify: `mobile/src/features/library/components/CoverPicker.tsx`
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts`
- Modify: `mobile/src/app/(app)/(home,arena,library,search,you)/book/[key]/cover.tsx`

**Interfaces:**
- Consumes: the shared helpers (Task 1), the routes (Task 5), `apiClient.request(..., { auth: true })` and `coverParamsFor` (`mobile/src/features/library/components/CoverImage.tsx:18`).
- Produces:
  - In `api/covers.ts`: `fetchCoverCandidates` and `pickCover`, with the same signatures as on web. `pickCover` always sends `everyone: false`, and mobile has no admin action.
  - On `useLibraryActions`: `saveBookCoverUrl(book, url)`, via `setBookCoverUrl`, with the message "Couldn't save the cover change."
  - On `CoverPicker`, new optional props `lookup?` and `coverUrl?`, and `onPickFound?: (cover: ResolvedCoverResponse) => void`.

- [ ] **Step 1: `FoundCovers.tsx`.**
  - It has the same behaviour as web Task 6 Step 1, without the admin button.
  - Tiles use `expo-image`'s `Image` with `onLoad={(e) => measure(e.source.width, e.source.height)}` and `onError`.
  - It uses the theme tokens, `minimumTouchTarget` and the gallery tile size from `CoverPicker.tsx`.
  - Every tile has an `accessibilityLabel`, "`<label>` cover, `<w>` by `<h>`", and the current tile has `accessibilityState={{ selected: true }}`.

- [ ] **Step 2: Mount it.**
  - Render `FoundCovers` above the gallery list in `CoverPicker.tsx`, under "Found covers".
  - In `cover.tsx`, pass:
    - `lookup={coverParamsFor(book)}`
    - `coverUrl={book._coverUrl}`
    - `onPickFound={(cover) => { void saveBookCoverUrl(book, cover.fullUrl ?? ""); router.back(); }}`, skipping the save when `fullUrl` is null

- [ ] **Step 3: Verify.**
  Run: `npm run typecheck --workspace mobile && npm test --workspace mobile && node scripts/gate.mjs`
  Expected: PASS.
  Then dispatch `device-checker` for the cover sheet of a book with an ISBN. It checks:
  - found tiles show with their sizes
  - the Apple tile resolves
  - tapping a tile closes the sheet and the book shows the picked cover
  - Remove custom cover reverts it

  Run `node scripts/dev-status.mjs --json` first. If another worktree holds the emulator, skip the device pass and say so.

- [ ] **Step 4: Commit.**
  ```bash
  git add mobile/src/features/library/api/covers.ts mobile/src/features/library/components/FoundCovers.tsx mobile/src/features/library/components/CoverPicker.tsx mobile/src/features/library/hooks/useLibraryActions.ts "mobile/src/app/(app)/(home,arena,library,search,you)/book/[key]/cover.tsx"
  git commit -m "Add found covers to the mobile cover picker"
  ```
