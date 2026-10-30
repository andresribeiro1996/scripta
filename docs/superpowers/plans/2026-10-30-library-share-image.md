# Library Share Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile Library tab's Share action opens `ContentShareSheet` with the link controls plus "Share as image" in four layouts (Wall · Summary · Reading · This shelf).

**Architecture:** Pure book-picking helpers in `mobile/src/features/library/lib/libraryShareBooks.ts` (node-tested). One `LibraryShareImage` component renders the chosen layout and reports cover readiness, copying `TierlistShareImage`'s loaded-set pattern. `LibraryScreen` hosts the sheet (it owns the shelf/search/sort state), and the old `/share` form-sheet route is deleted.

**Tech Stack:** Expo / React Native, `@expo/ui` BottomSheet via `ContentShareSheet`, `react-native-view-shot` (already wired), `@scripta/shared` library helpers, `node --test` + tsx.

**Spec:** `docs/superpowers/specs/2026-10-30-library-share-image-design.md`

## Global Constraints

- Phone app only. No website, backend or `@scripta/shared` changes (every helper needed already exists there; the new helpers have one consumer, so they live in `mobile/`).
- Layout button labels, in this order: `Wall`, `Summary`, `Reading`, `This shelf`.
- Library title falls back to `"Library"` when `library.data.name` is empty.
- Every layout ends with the footer `Created with: Atmyshelf`, styled as in `mobile/src/features/tierlists/TierlistShareImage.tsx:56-58`.
- Summary: 4 fan covers; counts books / finished / reading; top 3 genres as names. Reading: every reading book, then the 5 newest finished.
- Finished books without a parseable `DateLastRead` sort after all dated ones.
- Save/Send stay disabled (`imageReady` false) until every cover in the current layout has called `onLoadEnd`.
- No comments in code (repo rule). Colours, spacing and type come from `useTheme()`, `spacing`, `radii`, `typography` (see `DESIGN.md`).
- Verify from the worktree root: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace mobile`, `npm test --workspace mobile`.

## Review Focus

1. Switching layout while covers are still loading: Save/Send must go disabled and stay disabled until the new layout's covers load. Owned by Task 3 (reset on switch) and checked in Task 4.
2. A library with finished books that have no `DateLastRead` (Goodreads imports often lack it): they must still appear, after dated ones. Owned by Task 1's `newestFinished` tests.
3. This shelf with a search that matches nothing: the preview says the shelf is empty and Save/Send stay disabled. Owned by Task 2 (empty branch) and checked in Task 4.
4. Creating a link and then stopping it without closing the sheet: the sheet must flip back to "Create share link". Owned by Task 3 and checked in Task 4.
5. Opening Share from the Collections tab: no "This shelf" button, preview opens on Wall. Owned by Task 3 and checked in Task 4.

---

### Task 1: Book-picking helpers

**Files:**
- Create: `mobile/src/features/library/lib/libraryShareBooks.ts`
- Test: `mobile/src/features/library/lib/libraryShareBooks.test.ts`

**Interfaces:**
- Consumes: `filterBooks`, `parseBookDate`, `type LibraryBook` from `@scripta/shared`.
- Produces:
  - `export type LibraryShareLayout = "wall" | "summary" | "reading" | "shelf";`
  - `export const LIBRARY_SHARE_LAYOUTS: ReadonlyArray<{ value: LibraryShareLayout; label: string }>` — `wall`/`Wall`, `summary`/`Summary`, `reading`/`Reading`, `shelf`/`This shelf`, in that order.
  - `export function newestFinished(books: LibraryBook[], limit: number): LibraryBook[]` — `ReadStatus` 2 only (via `filterBooks(books, "", "finished")`), newest `DateLastRead` first, undated after all dated in their input order, at most `limit`.
  - `export function summaryCoverBooks(ordered: LibraryBook[]): LibraryBook[]` — `newestFinished(ordered, 4)`, or `ordered.slice(0, 4)` when that is empty.
  - `export function readingNow(ordered: LibraryBook[]): LibraryBook[]` — `filterBooks(ordered, "", "reading")`.

- [ ] **Step 1: Write the failing tests**

Use the style of `mobile/src/features/tierlists/tierlistShareData.test.ts` (`node:test`, `node:assert/strict`, import from `./libraryShareBooks.js`). Fixture helper `book(title, ReadStatus, DateLastRead?)` returning `{ Title, ReadStatus, DateLastRead }`.

- `newestFinished orders finished books newest first` — finished A `2026-01-05`, B `2026-03-01`, C `2025-12-31`, reading D `2026-04-01` → titles `["B", "A", "C"]` with limit 5.
- `newestFinished puts undated finished books last in input order` — finished U1 (no date), A `2026-01-05`, U2 (`""`) → `["A", "U1", "U2"]`.
- `newestFinished stops at the limit` — six dated finished books, limit 5 → length 5, the oldest one missing.
- `summaryCoverBooks takes the four newest finished` — five finished dated books → the four newest.
- `summaryCoverBooks falls back to library order with nothing finished` — five to-read books → the first four in input order.
- `summaryCoverBooks returns what exists with fewer than four finished` — two finished + three to-read → only the two finished (no padding from to-read).
- `readingNow keeps library order` — reading R2, to-read X, reading R1 (input order) → `["R2", "R1"]`.
- `LIBRARY_SHARE_LAYOUTS lists the four layouts in order` — labels deep-equal `["Wall", "Summary", "Reading", "This shelf"]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace mobile`
Expected: FAIL — cannot find module `./libraryShareBooks.js`.

- [ ] **Step 3: Implement the module per the Interfaces block**

`newestFinished`: sort a copy by `parseBookDate(book.DateLastRead)?.getTime()`, descending, with `null` ranked after every number; `Array.prototype.sort` is stable so ties keep input order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace mobile`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/library/lib/libraryShareBooks.ts mobile/src/features/library/lib/libraryShareBooks.test.ts
git commit -m "Add library share image book pickers"
```

### Task 2: `LibraryShareImage` component

**Files:**
- Create: `mobile/src/features/library/components/LibraryShareImage.tsx`
- Modify: `mobile/src/features/library/components/BookCard.tsx`

**Interfaces:**
- Consumes: Task 1's `LibraryShareLayout`, `summaryCoverBooks`, `readingNow`, `newestFinished`. From `@scripta/shared`: `bookKey`, `statusCounts`, `calculateShelfTheme`, `effectiveCardStyle`, `plural`, `type LibraryStyleSettings`, `type PerCardStyle`, `type Group`. `TierCover` from `mobile/src/features/tierlists/TierBoard.tsx`. `libraryGridColumns` from `mobile/src/features/library/lib/gridColumns.ts`.
- Produces:
  ```ts
  export function LibraryShareImage(props: {
    layout: LibraryShareLayout;
    name: string;
    ordered: LibraryBook[];
    shelf: { label: string; query: string; books: LibraryBook[] } | null;
    style: LibraryStyleSettings;
    seriesGroups: Map<string, Group>;
    onReadyChange: (ready: boolean) => void;
  }): ReactElement
  ```
  `ordered` is `orderLibraryBooks(...)` output (the whole library). `shelf` is null on the Collections tab. `seriesGroups` is `LibraryScreen`'s `bookSeriesGroup` (`seriesGroupByBookKey` returns `Map<string, Group>`).
  BookCard gains an optional `onLoadEnd?: () => void` prop forwarded to its `CoverImage`.

- [ ] **Step 1: Add `onLoadEnd` passthrough to `BookCard`**

Optional prop, passed straight to `<CoverImage … onLoadEnd={onLoadEnd} />` at `BookCard.tsx:89`. Existing callers don't pass it, so the library grid keeps polling and its 150 ms transition (`CoverImage.tsx:71,106`).

- [ ] **Step 2: Implement `LibraryShareImage`**

Outer frame, readiness and footer as in `TierlistShareImage.tsx:10-60`: a `loaded` `Set<string>` keyed by `bookKey`, `expected` = the keys of every cover the layout renders, and an effect calling `onReadyChange(expected.length > 0 && expected.every(loaded.has))`. The one exception is Summary, which is ready when `expected.every(loaded.has)` even with zero covers, since its counts still make a valid card. Title = `name`; footer per Global Constraints. Per layout:

- **wall**: subtitle `plural(ordered.length, "book", "books")`; every book of `ordered` as a `TierCover` in a `flexWrap` row, 8 per row, 2pt gap, 2:3 cells sized from the measured row width (`onLayout`).
- **summary**: a fan of `summaryCoverBooks(ordered)` as overlapping `TierCover`s, each rotated (about −10°, −3°, 4°, 11°); three stat tiles from `statusCounts(ordered)` — `all` "books", `finished` "finished", `reading` "reading" (tile look: `TierlistShareImage.tsx:37-44`); then "Top genres" with `calculateShelfTheme(ordered, 3).genres` as a ranked list, the section omitted when the list is empty.
- **reading**: "Reading now" with `readingNow(ordered)` 4 per row, then "Recently finished" with `newestFinished(ordered, 5)` 5 per row; omit an empty section; with both empty, one caption line "Nothing being read or finished yet." and not ready.
- **shelf**: subtitle `shelf.label`, then `“${shelf.query.trim()}”` when non-empty, then `plural(shelf.books.length, "book", "books")`, joined with ` · `. Grid as `LibraryGrid` lays it out (`LibraryGrid.tsx:10-16,55-69`) but as a plain `flexWrap` `View`, not a FlatList: `backgroundColor`, `contentPaddingX/Y`, `cardGap` between columns, `rowGap` between rows, columns = `libraryGridColumns(windowWidth, measuredWidth - 2 * style.contentPaddingX, style)`. Each cell is `<BookCard book style={effectiveCardStyle(style, seriesGroups.get(bookKey(book))?.style, book._style as PerCardStyle | undefined)} onPress={() => {}} onLoadEnd={…} />`. When `shelf.books` is empty, a caption "This shelf is empty." and not ready. `layout === "shelf"` with `shelf === null` never happens (Task 3 hides it); render nothing and stay not ready.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace mobile`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/features/library/components/LibraryShareImage.tsx mobile/src/features/library/components/BookCard.tsx
git commit -m "Add library share image layouts"
```

### Task 3: Host the share sheet on the Library tab, delete the old route

**Files:**
- Modify: `mobile/src/features/library/LibraryScreen.tsx`
- Modify: `mobile/src/app/(app)/(library)/_layout.tsx`
- Delete: `mobile/src/app/(app)/(library)/share.tsx`
- Delete: `mobile/src/features/library/components/ShareSheet.tsx`
- Delete: `mobile/src/features/socials/ShareActions.tsx`
- Modify: `mobile/src/features/socials/index.ts`

**Interfaces:**
- Consumes: Task 1's `LIBRARY_SHARE_LAYOUTS`, `LibraryShareLayout`; Task 2's `LibraryShareImage`; `ContentShareSheet` props (`ContentShareSheet.tsx:13-28`); `useLibrary()`'s `share()` / `unshare()` (`useLibrary.ts:35-47`).
- Produces: nothing later tasks import.

- [ ] **Step 1: Wire the sheet into `LibraryScreen`**

- Take `share`, `unshare` from the existing `useLibrary()` call (`LibraryScreen.tsx:56`).
- New state: `sharing: boolean`, `shareLayout: LibraryShareLayout`, `shareImageReady: boolean`.
- The "Share" action (`:149`) sets `shareLayout` to `onCollectionsTab ? "wall" : "shelf"`, `shareImageReady` false, `sharing` true — no `router.push`.
- Mount `<ContentShareSheet>` next to the other sheets, outside the `books.length > 0` branch:
  - `visible={sharing}`, `onClose={() => setSharing(false)}`, `title` = library name with the `"Library"` fallback.
  - `url={library?.shareUrl ?? null}`.
  - `onEnableLink={async () => (await share()).shareUrl ?? undefined}`, `onDisableLink={async () => { await unshare(); }}`. Errors propagate to the sheet's own error note (`ContentShareSheet.tsx:52-59`).
  - `imageReady={shareImageReady}`.
  - `previewControls`: a wrapping row of `Button`s from `LIBRARY_SHARE_LAYOUTS`, minus `shelf` when `onCollectionsTab`; the selected one `variant="primary"`, the rest `"secondary"`; pressing an unselected one sets `shareImageReady` false and then `shareLayout` (same as `TierlistEditorScreen.tsx:177`).
  - Child: `<LibraryShareImage key={shareLayout} layout={shareLayout} name=… ordered={ordered} shelf={onCollectionsTab ? null : { label: LIBRARY_TABS.find(t => t.value === statusFilter)!.label, query, books: sortBooks(filterBooks(ordered, query, statusFilter), sortKey) }} style={style} seriesGroups={bookSeriesGroup} onReadyChange={setShareImageReady} />`. `filterBooks` needs a `StatusFilter`, so narrow `statusFilter` (a `LibraryTab`, `LibraryScreen.tsx:50`) with the `onCollectionsTab` check first.

- [ ] **Step 2: Delete the old screen**

Remove the `share` `Stack.Screen` (`_layout.tsx:28`), `share.tsx` and `ShareSheet.tsx`. `ShareActions` has no other user once `ShareSheet.tsx` is gone (`rg -n ShareActions mobile/src` to confirm): delete the file and its export line in `socials/index.ts:3`.

- [ ] **Step 3: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile && rg -n '"/share"|ShareSheetBody|ShareActions' mobile/src`
Expected: typecheck and tests pass; `rg` prints nothing (exit 1).

- [ ] **Step 4: Commit**

```bash
git add -A mobile/src/features/library/LibraryScreen.tsx "mobile/src/app/(app)/(library)/_layout.tsx" "mobile/src/app/(app)/(library)/share.tsx" mobile/src/features/library/components/ShareSheet.tsx mobile/src/features/socials/ShareActions.tsx mobile/src/features/socials/index.ts
git commit -m "Share the library as an image from the Library tab"
```

### Task 4: Device pass

**Files:**
- Test: `mobile/src/features/library/LibraryScreen.tsx`

Dispatch `device-checker` (never `general-purpose`) on the 24-book dev fixture, screenshots into the session scratchpad. Per repo memory, the device pass gates merge, not the PR: push and open the PR first.

- [ ] **Step 1: Run the pass and check each line**

1. Library tab → ⋯ → Share opens the bottom sheet with "Share as image" and "Create share link".
2. Create share link → Send link / QR code appear; Stop sharing link → back to "Create share link", sheet still open.
3. Share as image from the Finished tab → opens on "This shelf", subtitle "Finished · N books", cards drawn in the library style; Save/Send enable once covers load.
4. Each of Wall, Summary, Reading: tap it → Save/Send disable, then re-enable after load; screenshot each layout.
5. Save image → "Image saved to Photos." notice. Send image → system share sheet opens.
6. Search a nonsense query, then Share as image → "This shelf is empty.", Save/Send disabled.
7. Collections tab → Share as image → no "This shelf" button, opens on Wall.

Expected: all seven as described; any miss goes back to the owning task.
