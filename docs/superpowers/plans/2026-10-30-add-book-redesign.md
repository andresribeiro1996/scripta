# Mobile Add a book redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the phone app's Add a book sheet to the agreed layout and let it record format, page count, genres and a cover before the book exists.

**Architecture:** Format and page count ride the library record as `_format` / `_pages` through the shared `buildManualBook` and the existing passthrough `POST /library/books/add`; search results gain an optional `pages`. The form's cover choice is a small pure draft model in `mobile/src/features/library/lib/addBookDraft.ts` (which cover wins, which upload to delete, how the record gets its cover); the screen is a rewrite of `AddBookForm.tsx` on existing UI pieces.

**Tech Stack:** TypeScript, Expo / React Native, `@scripta/shared`, Fastify backend, `node --test` via tsx.

**Spec:** `docs/superpowers/specs/2026-10-30-add-book-redesign-design.md` (mockup: `docs/superpowers/specs/2026-10-30-add-book-redesign-mockups/add-book.html`)

## Global Constraints

- Phone app only. `frontend/` is untouched.
- Theme tokens only (`useTheme().colors`, `spacing`, `radii`, `typography`); no hex literals. Must read right in a dark theme.
- No comments in code (repo rule).
- Format values exactly: `"hardcopy" | "ebook" | "audiobook" | "other"`; default `"hardcopy"`.
- Page count is optional; a stored `_pages` is a positive integer, otherwise the key is absent.
- Add as default is Reading (`readStatus` 1). Options in order: Reading (1), To read (0), Finished (2).
- A cover the user chose by hand (Find cover or Upload) survives a result pick, a scan and the one-result auto-select.
- Every photo uploaded from this form that does not end up as the saved book's cover is deleted from the gallery; a failed delete shows a toast.
- A cover that came only from a search result is preview-only: it is **not** written to the record (the saved book resolves its cover through the normal chain, at full size).
- Copy, verbatim: `Search for a book`, `Auto-fill title, author, pages & cover`, `Title, author or ISBN`, `Tap a result to fill the form`, `Filled from “<title>” · tap to search again`, `Cover image`, `No cover yet`, `From search`, `Chosen`, `Uploaded`, `Find cover`, `Upload`, `Title *`, `Author *`, `Format`, `Hardcopy`, `Ebook`, `Audiobook`, `Other`, `Total pages`, `Genre (optional)`, `Add as`, `Reading`, `To read`, `Finished`, `More details`, `ISBN`, `Publisher`, `Add to library`. Existing strings (Open Library pending/failed, no-matches, success toast "Added to your library") stay.
- Don't change `CoverPicker.tsx`'s layout (another session is editing it); reuse `FoundCovers` and `api/covers.ts` as they are.

## Review Focus

1. Upload a photo, then leave by Android back or swipe-down (not the ✕) → the photo is deleted. Owned by Task 4 (unmount clean-up) and pinned by Task 3's `abandonedUpload` tests.
2. Upload, tap Add, the save fails, then the user leaves → the photo is deleted (only a *successful* add keeps it). Task 3 test `abandonedUpload after a failed save`.
3. Total pages typed as `0`, `-3`, `310 pages`, `3.5`, or blank → no `_pages` is stored and the field shows no error-blocking state. Task 3 `parsePages` tests.
4. Upload photo A, then Upload photo B (or Find cover) → A is deleted, B (or the found cover) is kept. Task 3 `replacedUpload` tests.
5. Upload a photo, then search and tap a result with no cover, or one with a cover → the photo stays. Task 3 `coverAfterResult` tests.

---

### Task 1: Shared model — format, pages on manual books and search results

**Files:**
- Modify: `packages/shared/src/library/bookSearch.ts`
- Test: `packages/shared/src/library/bookSearch.test.ts`
- Test: `packages/shared/src/library/merge.test.ts`
- Test: `packages/shared/src/library/dedupe.test.ts`

**Interfaces:**
- Produces (exported from `@scripta/shared`):
  - `export const BOOK_FORMATS = ["hardcopy", "ebook", "audiobook", "other"] as const;`
  - `export type BookFormat = (typeof BOOK_FORMATS)[number];`
  - `BookSearchResult.pages?: number | null`
  - `ManualBookFields.format?: BookFormat`, `ManualBookFields.pages?: number | null`, `ManualBookFields.genresEdited?: boolean`
  - When `genresEdited` is true, `_genres` is written **without** `_genresFrom`, so `withCatalogGenres` (`catalogGenres.ts`) treats them as the user's own and never overwrites them; otherwise unchanged (`_genresFrom: "catalog"`).
  - `buildManualBook` writes `_format` when `fields.format` is set, `_pages` when `fields.pages` is a positive integer; neither key otherwise.
  - `mapOpenLibraryDoc` sets `pages` from `doc.number_of_pages_median` when it is a positive integer, else `null`.

- [ ] **Step 1: Write failing tests** in `bookSearch.test.ts`:
  - `buildManualBook stores format and a positive page count` — fields with `format: "audiobook", pages: 310` → record has `_format === "audiobook"`, `_pages === 310`.
  - `buildManualBook omits format and pages when not given` — `"_format" in book === false`, `"_pages" in book === false`; also with `pages: null` and `pages: 0`.
  - `buildManualBook leaves hand-edited genres untagged` — `genres: ["Fantasy"], genresEdited: true` → `_genres` deep-equals `["Fantasy"]`, `"_genresFrom" in book === false`; without `genresEdited` → `_genresFrom === "catalog"`.
  - `mapOpenLibraryDoc reads the median page count` — `{ title: "Dune", number_of_pages_median: 412 }` → `pages === 412`; `{ title: "Dune" }` → `pages === null`; `number_of_pages_median: 0` → `null`.
- [ ] **Step 2: Write tests pinning the merge rules** (expected to pass without code changes — they pin the spec's "already in the library" call):
  - `merge.test.ts` `re-adding a book takes the incoming format and keeps an existing page count when none is sent` — existing `{…, _format: "ebook", _pages: 300}`, incoming same identity `{…, _format: "hardcopy"}` → merged `_format === "hardcopy"`, `_pages === 300`. Use the same merge entry point the file's existing tests use.
  - `dedupe.test.ts` `combineBooks fills format and pages from the other copy` — keep `{_format: "ebook"}`, other `{_format: "hardcopy", _pages: 120}` → `_format === "ebook"`, `_pages === 120`.
- [ ] **Step 3: Run** `npm test --workspace @scripta/shared` — Step 1 tests FAIL (no `_format` / `pages`), Step 2 tests PASS.
- [ ] **Step 4: Implement** the Interfaces above in `bookSearch.ts`. If a Step 2 test failed, fix `merge.ts`/`dedupe.ts` to the stated rule (incoming-if-present else existing; dedupe fills blanks from the other copy) and add that file to this task's commit.
- [ ] **Step 5: Run** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared` — PASS.
- [ ] **Step 6: Commit** `Add format and page count to manual books and search results`.

### Task 2: Backend — page count on search results

**Files:**
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`

**Interfaces:**
- Consumes: `BookSearchResult.pages` (Task 1).
- Produces: `GET /books/search` results carry `pages` from `books.pages` (null when unknown); `GET /books/search/external` Open Library results carry `pages` from `number_of_pages_median`.

- [ ] **Step 1: Write failing tests:**
  - `booksService.test.ts` `catalog search results carry the edition's page count` — seed a book row with `pages: 310` and one with `pages: null`, search → results' `pages` are `310` and `null`. Follow the file's existing search-test setup.
  - `openLibraryCatalog.test.ts` `a search asks for the median page count and maps it` — the request URL's `fields` param includes `number_of_pages_median`; a doc with `number_of_pages_median: 288` maps to `result.pages === 288`.
- [ ] **Step 2: Run** the two files with the backend env preamble the suite uses (see `backend/AGENTS.md`) — FAIL.
- [ ] **Step 3: Implement:** `toSearchResult` adds `pages: book.pages`; the Open Library `search` `fields` list gains `number_of_pages_median`.
- [ ] **Step 4: Run** `npm run typecheck --workspace backend && npm test --workspace backend` — PASS.
- [ ] **Step 5: Commit** `Return page counts on book search results`.

### Task 3: Mobile draft model — cover choice, upload clean-up, page parsing

**Files:**
- Create: `mobile/src/features/library/lib/addBookDraft.ts`
- Test: `mobile/src/features/library/lib/addBookDraft.test.ts`

**Interfaces:**
- Consumes: `GalleryImage`, `setBookCover`, `setBookCoverUrl` from `@scripta/shared`.
- Produces:
  ```ts
  export type DraftCover =
    | { kind: "none" }
    | { kind: "search"; url: string }
    | { kind: "found"; url: string }
    | { kind: "upload"; image: GalleryImage };
  export function coverAfterResult(current: DraftCover, resultCoverUrl: string | null): DraftCover;
  export function replacedUpload(previous: DraftCover, next: DraftCover): string | null;
  export function abandonedUpload(cover: DraftCover, added: boolean): string | null;
  export function withDraftCover(book: Record<string, unknown>, cover: DraftCover): Record<string, unknown>;
  export function parsePages(text: string): number | null;
  export function coverStatusLabel(cover: DraftCover): "No cover yet" | "From search" | "Chosen" | "Uploaded";
  ```

- [ ] **Step 1: Write failing tests** (`node:test`, `assert/strict`, like `lib/coverUrl.test.ts`):
  - `coverAfterResult keeps a hand-chosen cover` — `found` and `upload` currents are returned unchanged for result cover `"x"` and `null`.
  - `coverAfterResult replaces an empty or search cover` — `none` + `"x"` → `{kind:"search", url:"x"}`; `search("a")` + `null` → `{kind:"none"}`.
  - `replacedUpload names the upload being replaced` — `upload(A)` → `upload(B)` gives `A.id`; `upload(A)` → `found` gives `A.id`; `upload(A)` → same `upload(A)` gives `null`; `none` → `upload(B)` gives `null`.
  - `abandonedUpload after a failed save` — `abandonedUpload(upload(A), false) === A.id`; `abandonedUpload(upload(A), true) === null`; `abandonedUpload(found, false) === null`.
  - `withDraftCover writes only hand-chosen covers` — `upload(A)` → `_coverImageId === A.id`, `_coverUrl === A.url`; `found("u")` → `_coverUrl === "u"`, no `_coverImageId`; `search` and `none` → record returned without `_coverUrl` / `_coverImageId`.
  - `parsePages accepts positive whole numbers only` — `"310"` → 310, `" 42 "` → 42; `""`, `"0"`, `"-3"`, `"3.5"`, `"310 pages"` → null.
  - `coverStatusLabel` — one assertion per kind, matching the four labels.
- [ ] **Step 2: Run** `npm run build --workspace @scripta/shared && npm test --workspace mobile` — FAIL (module missing).
- [ ] **Step 3: Implement** `addBookDraft.ts` to the signatures; `withDraftCover` uses `setBookCover(book, image.id, image.url)` and `setBookCoverUrl(book, url)`.
- [ ] **Step 4: Run** `npm test --workspace mobile && npm run typecheck --workspace mobile` — PASS.
- [ ] **Step 5: Commit** `Add the add-book draft cover model`.

### Task 4: Mobile Add a book screen

**Files:**
- Modify: `mobile/src/features/library/components/AddBookForm.tsx`
- Create: `mobile/src/features/library/components/GenreChoices.tsx`
- Modify: `mobile/src/features/murals/ContentTab.tsx`
- Modify: `mobile/src/ui/icon.tsx`
- Modify: `mobile/README.md`

**Interfaces:**
- Consumes: Task 1 (`BOOK_FORMATS`, `BookFormat`, `ManualBookFields.format/pages`, `BookSearchResult.pages`), Task 3 (all of `addBookDraft.ts`), existing `FoundCovers` (`lookup`, `onPick(cover: ResolvedCoverResponse)` — use `cover.fullUrl ?? cover.url`), `uploadGalleryImage` / `deleteGalleryImage` (`mobile/src/features/gallery/api.ts`), `Chip` (`StyleControls.tsx`), `Input`, `Button`, `Sheet` (`mobile/src/ui/components.tsx`), `useToast`.
- Produces:
  - `export function GenreChoices({ value, onChange }: { value: readonly BookGenre[]; onChange: (next: BookGenre[]) => void }): JSX.Element` — the multi-select chip grid over `BOOK_GENRES`, lifted from `ContentTab.tsx`'s profile block (same look and `checkbox` a11y role); `ContentTab` uses it instead of its inline copy.
  - `AddBookForm`'s props are unchanged (`onAdd`, `onClose`, `initialQuery`, `initialScanning`); the route file is unchanged.
  - New `Icon` names: `ebook` (ios `ipad`, android `tablet_android`), `audiobook` (ios `headphones`, android `headphones`), `otherFormat` (ios `square.on.circle`, android `category`). Hardcopy uses the existing `book`.

Layout and behaviour are the spec's "The screen, top to bottom" and "Behaviour" sections and the mockup; the decisions not in the spec:

- Search card: expanded on open (and when `initialQuery` or `initialScanning` is set); folds after a result is picked (tap or auto-select); header tap toggles. Scan button toggles the existing `IsbnScanner` inside the card; the separate "Scan again" button goes away.
- Picking a result: set title, author, ISBN, publisher, genres, pages (`String(pages)` or `""`), then `setCover(coverAfterResult(cover, result.coverUrl))`. Scanning clears those fields and does `setCover(coverAfterResult(cover, null))`.
- One `setCover(next)` helper is the only way the cover changes; it calls `replacedUpload(cover, next)` and deletes that id (toast `Couldn't remove the replaced photo from your gallery.` on failure).
- Find cover: disabled until title or ISBN is non-blank; opens a `Sheet` with `FoundCovers` keyed by `{ isbn, title, author }` at open time; a pick → `setCover({ kind: "found", url })` and closes the sheet.
- Upload: same permission / picker / `uploadGalleryImage` sequence as `CoverPicker.handlePickAndUpload` (copy it, don't import from `CoverPicker`); success → `setCover({ kind: "upload", image })`. Show an uploading state on the button.
- Genres: a `genresEdited` flag turns true when the user changes genres in the form and resets to false on a result pick or scan.
- Save: `withDraftCover(buildManualBook({ …, format, pages: parsePages(pagesText), genres, genresEdited }, id), cover)` → `onAdd`. Set an `added` ref to `true` only after `onAdd` resolves.
- Clean-up: an unmount effect reads the latest cover and `added` from refs and deletes `abandonedUpload(cover, added)`; this covers ✕, Android back and swipe-down. Failure → toast `Couldn't remove the uploaded photo from your gallery.`
- Format and Add as: rows of `Chip`s (format chips with icon + label; Add as as three equal-width chips). Genres: selected genres as chips plus an `+ Add` chip that expands `GenreChoices` inline.
- More details: folded by default; expands to the ISBN and Publisher inputs. Opens automatically if a scan fills the ISBN.
- `Add to library` sits outside the `ScrollView`, pinned at the bottom of the sheet; disabled until title and author are non-blank; save error text directly above it.
- `mobile/README.md`: update the Add Book paragraph (around line 183) to describe the new fields and the upload clean-up.

- [ ] **Step 1:** Add the three icon names; extract `GenreChoices` and switch `ContentTab.tsx` to it.
- [ ] **Step 2:** Rewrite `AddBookForm.tsx` to the layout and decisions above.
- [ ] **Step 3: Run** `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile` — PASS.
- [ ] **Step 4: Commit** `Redesign the mobile Add a book sheet`.
- [ ] **Step 5: Device pass** — dispatch `device-checker` (after `node scripts/dev-status.mjs --json` shows the emulator free) on the Add a book sheet, light and dark theme: empty form; search "hobbit" and pick a result (fields, pages, cover preview fill; card folds); Upload then Android back (photo gone from You → Gallery); Upload then pick a result with a cover (upload kept, status `Uploaded`); add the book and open it in the library. Fix what it reports in this task.
