# Mobile Book Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the phone app's book page as a calm, tall page: clean bigger cover, spaced title block with a status badge, labelled tabs, editions / characters / cover as rows that open sheets, and a fixed "Want to read" bar for books you don't own.

**Architecture:** All presentation stays in `mobile/src/features/works/`. The shared `bookScreenModel` gains one field (`year`). Small pure helpers go in a new `bookPage.ts` with node tests; the three sheets are new components built on the existing `Sheet`. `ActionSheet`'s close-then-act logic is extracted into a hook the new sheets reuse.

**Tech Stack:** Expo / React Native, expo-router, TanStack Query, `@scripta/shared`, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-30-mobile-book-page-design.md`

## Global Constraints

- Phone app only. No change to `frontend/`, the backend, or the `/work` payload.
- Tokens from `mobile/src/ui/theme.tsx` / `DESIGN.md`; no new colours, no new type token.
- Hero and section text at `typography.body` (14) or larger; `caption` (12) only for small hints.
- Every tappable control ≥ `minimumTouchTarget` (44), hit slop allowed.
- No glyph characters ("▾", "→", "★") as UI on this page — use `Icon`.
- Nothing drawn on the cover.
- Light and dark themes.
- `BookRoute` (`book/[key]`, `page = null`) still renders: cover band, title block with badge, Highlights.
- No code comments (repo rule).

## Review Focus

1. Long title / author / series names wrapping — no clipped last word on Android (one-line `Text` + `lineHeight` trap). Pinned in Task 7's device checklist.
2. Work with exactly 1 edition (no editions row) and works with many editions (sheet scrolls). Task 2 test for `otherEditionCovers`; Task 7 checklist.
3. Fewer than 4 characters (row shows, no game button) and no characters (no row). Reviewed in Task 4; not reachable with the fixture (see Task 7).
4. Signed-out viewer: no badge, "Want to read" opens the sign-in sheet, never calls the API. Task 5 step; Task 7 checklist.
5. Add fails (offline): error toast, bar stays and is tappable again, page not blanked. Task 5 step; Task 7 checklist.

---

### Task 1: `year` on the shared book screen model

**Files:**
- Modify: `packages/shared/src/works/bookScreen.ts`
- Test: `packages/shared/src/works/bookScreen.test.ts`

**Interfaces:**
- Produces: `BookScreenModel.year: number | null` — the selected edition's year when an edition is picked, else the work's year, else `null`.

- [ ] **Step 1: Write the failing tests** in `bookScreen.test.ts`, using the file's `page()` / `edition()` helpers:

```ts
test("year: work year by default, picked edition's year when an edition is selected", () => {
  assert.equal(bookScreenModel(page(), null, { isAdmin: false }).year, 1965);
  assert.equal(bookScreenModel(page(), null, { isAdmin: false }, "e3").year, 1968);
  assert.equal(bookScreenModel(page({ year: null }), null, { isAdmin: false }).year, null);
  assert.equal(bookScreenModel(null, { Title: "Loose" }, { isAdmin: false }).year, null);
});
```

- [ ] **Step 2: Run** `npm test --workspace @scripta/shared` — expect the new test to FAIL (`year` undefined).
- [ ] **Step 3: Add `year: number | null` to `BookScreenModel`** and set it to `selected ? selected.year : work?.year ?? null` in `bookScreenModel`.
- [ ] **Step 4: Run** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared` — expect PASS; then `npm run typecheck --workspace frontend` still passes.
- [ ] **Step 5: Commit** `Add the selected edition's year to the book screen model`.

---

### Task 2: Pure helpers, icons, and the close-then-act hook

**Files:**
- Create: `mobile/src/features/works/bookPage.ts`
- Test: `mobile/src/features/works/bookPage.test.ts`
- Modify: `mobile/src/ui/icon.tsx`
- Modify: `mobile/src/ui/components.tsx`

**Interfaces:**
- Produces (in `bookPage.ts`):
  - `statusBadgeLabel(model: Pick<BookScreenModel, "status" | "feeling">): string | null` — `null` when `model.status` is null; else the status label, plus `" · " + label` of the selected feeling option when one is selected (no feeling part when finished but unrated).
  - `otherEditionCovers(editions: WorkEdition[], currentUrl: string | null): string[]` — non-null `coverUrl`s in edition order, de-duplicated, excluding `currentUrl`.
- Produces (icons): `chevronDown` (ios `chevron.down`, android `expand_more`), `star` (ios `star.fill`, android `star`), `characters` (ios `theatermasks`, android `theater_comedy`).
- Produces (ui): `useDismissThen(visible: boolean, onClose: () => void): { then: (action: () => void) => void; onDismiss: () => void }` exported from `components.tsx`. `then(action)` calls `onClose()` and runs `action` immediately on Android, or from `onDismiss` (pass it to `Sheet`) on iOS — the behaviour `ActionSheet.run` has today. Its double-tap guard resets whenever `visible` becomes true, so a parent-controlled sheet reopened later accepts taps again. `ActionSheet` keeps its own `visible` state and uses the hook with no behaviour change.

- [ ] **Step 1: Write the failing tests** in `bookPage.test.ts`:

```ts
test("statusBadgeLabel", () => {
  const opts = (sel: number | null) => [1, 2, 3, 4, 5].map((r) => ({ rating: r, label: ["Not for me", "Fine", "Good", "Loved it", "All-time"][r - 1], selected: r === sel }));
  assert.equal(statusBadgeLabel({ status: null, feeling: null }), null);
  assert.equal(statusBadgeLabel({ status: { label: "Reading", options: [] }, feeling: null }), "Reading");
  assert.equal(statusBadgeLabel({ status: { label: "Finished", options: [] }, feeling: { label: "How did it land?", options: opts(null) } }), "Finished");
  assert.equal(statusBadgeLabel({ status: { label: "Finished", options: [] }, feeling: { label: "All-time", options: opts(5) } }), "Finished · All-time");
});

test("otherEditionCovers skips missing, duplicate and current covers", () => {
  const ed = (bookId: string, coverUrl: string | null) => ({ bookId, title: "T", language: null, year: null, isbn: null, coverUrl, coverColor: null, pages: null, mine: false });
  assert.deepEqual(otherEditionCovers([ed("a", "u1"), ed("b", null), ed("c", "u2"), ed("d", "u1"), ed("e", "u3")], "u2"), ["u1", "u3"]);
  assert.deepEqual(otherEditionCovers([ed("a", "u1")], "u1"), []);
  assert.deepEqual(otherEditionCovers([], null), []);
});
```

(Cast the option objects as needed for the `FinishRating` type.)

- [ ] **Step 2: Run** `npm test --workspace mobile` — expect FAIL (module missing).
- [ ] **Step 3: Implement** both helpers in `bookPage.ts`, add the three icons, extract `useDismissThen` from `ActionSheet` and switch `ActionSheet` to it.
- [ ] **Step 4: Run** `npm test --workspace mobile && npm run typecheck --workspace mobile` — expect PASS.
- [ ] **Step 5: Commit** `Add book page helpers, icons and a close-then-act sheet hook`.

---

### Task 3: The three sheets

**Files:**
- Create: `mobile/src/features/works/StatusSheet.tsx`
- Create: `mobile/src/features/works/EditionsSheet.tsx`
- Create: `mobile/src/features/works/CharactersSheet.tsx`

**Interfaces:**
- Consumes: `useDismissThen` (Task 2), `Sheet`, `FeelingChips` (`mobile/src/features/library/components/FeelingChips.tsx`), `useChangeStatus`, `useLibraryActions().setRating`, `BookCover` (`mobile/src/features/arena/BookCover.tsx`), `editionLabel`.
- Produces:
  - `StatusSheet({ book, model, visible, onClose }: { book: Record<string, unknown>; model: BookScreenModel; visible: boolean; onClose: () => void })` — title "Your reading". `model.status.options` as selectable rows (selected one marked with the `confirm` icon); tapping an unselected status hides the sheet and runs `changeStatus(book, value)` via `then` (so the finish-step navigation from `useChangeStatus` happens after dismissal). When `model.feeling` is set, a "How it landed" label and `<FeelingChips value={selected rating} onChange={(r) => setRating(book, r)} />`; the sheet stays open on a feeling pick.
  - `EditionsSheet({ editions, selectedIndex, mineIndex, visible, onClose, onSelect }: { editions: WorkEdition[]; selectedIndex: number; mineIndex: number | null; visible: boolean; onClose: () => void; onSelect: (bookId: string) => void })` — title "Editions". A `FlatList` (no cap) of rows: `BookCover` thumbnail 36×54, title (body, bold), `editionLabel(edition)` (body, dim), "Yours" (accent) on the row whose index is `mineIndex` (not `edition.mine` — `bookScreen.ts:90` falls back to the default edition when none is flagged), `confirm` icon on the selected row. Tapping a row calls `onSelect(bookId)` then `onClose()`.
  - `CharactersSheet({ characters, gamePath, visible, onClose }: { characters: string[]; gamePath: string | null; visible: boolean; onClose: () => void })` — title "Characters". One `body` row per name in a `ScrollView`; when `gamePath` is non-null, a `Button` "Make a character game" (secondary) at the end that pushes `gamePath` via `then`.

- [ ] **Step 1: Implement** the three components. All text `body`; row min height `minimumTouchTarget`.
- [ ] **Step 2: Run** `npm run typecheck --workspace mobile && npm test --workspace mobile` — expect PASS. (Rendering is checked in Task 7; the repo has no component render tests.)
- [ ] **Step 3: Commit** `Add the status, editions and characters sheets`.

---

### Task 4: Rebuild `BookScreen`

**Files:**
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `mobile/src/features/works/BookStats.tsx`
- Modify: `mobile/src/features/works/WorkScreen.tsx`
- Modify: `mobile/src/app/(app)/(home,arena,library,search,you)/book/[key]/index.tsx`
- Delete: `mobile/src/features/works/EditionStrip.tsx`
- Delete: `mobile/src/features/works/RatingStars.tsx`

**Interfaces:**
- Consumes: Task 1 `model.year`; Task 2 `statusBadgeLabel`, icons; Task 3 sheets; existing `StatsTiles`, `SeriesLine`, `CoverImage`, `BookCover`, `bookToolPath`, `workCharactersPath`, `workStatsPath`.
- Produces: `BookScreen` keeps its props signature unchanged except `onAdd` is removed (Task 5 owns adding). This task removes the `onAdd` prop from both callers (`WorkScreen.tsx:112`, `book/[key]/index.tsx:43`) so typecheck passes; `WorkScreen`'s `adding` state and `AddBookSheet` stay until Task 5.

Top to bottom (spec "The page, top to bottom"):

- [ ] **Step 1: Cover band.** Cover 150×225 (`radii.sm`), centred. Your edition — `book` present and (`model.edition === null || model.edition.index === model.edition.mineIndex`) — → `CoverImage book={book} size="full"` (keeps a custom cover); otherwise `BookCover cover={selected edition's coverUrl ?? page.work.coverUrl}`. Use `page.work.editions[model.edition.index]` for the selected edition when `model.edition` is set. Remove `EditionStrip` and delete its file.
- [ ] **Step 2: Title block** in a centred column with `gap: spacing.md`, and `spacing.lg` before the genre chips:
  - title `heading`;
  - `by ${model.author}` at `typography.input` (16), `textDim`;
  - status badge when `statusBadgeLabel(model)` is non-null: a `Pressable` pill (`radii.full`, `accentSoft` background, no border, `paddingHorizontal: spacing.md`, `paddingVertical: spacing.xs`, hitSlop to reach 44) with `confirm` icon when status is Finished, the label in `body` `accent`, and a `chevronDown` icon; opens `StatusSheet`;
  - meta row (`flexDirection: "row", flexWrap: "wrap", justifyContent: "center"`): `SeriesLine` (switch it to `body`), then `· ${model.year}`, then `· ` + `star` icon (14, accent) + `model.rating.label`, each part only when present;
  - award pills and author-awards line as today but at `body`;
  - genre and possible-genre chips at `body` with `paddingVertical: spacing.xs`, `paddingHorizontal: spacing.md`.
  Remove `OwnerRow`, the characters sentence, "+N more", the hero game button, `RatingStars` (delete the file), the hero `StatsTiles`, and the `model.meta` line. Remove the `primary === "add"` button (Task 5 replaces it).
- [ ] **Step 3: Tabs.** Text tabs from `model.tabs[].label` (`body`), underline (2px `accent`) on the selected tab, `textDim` otherwise, bottom hairline across the row, `accessibilityRole="tab"` kept. Drop `TAB_ICONS`.
- [ ] **Step 4: About tab.** No "About this book" heading. Synopsis at `typography.input` with `lineHeight: 26`; "Show more" / "Show less" as an accent `body` text `Pressable` (44 min height). Then rows (bordered, `radii.md`, `padding: spacing.md`, icon + `body` label + `chevronRight`, `gap: spacing.sm` between rows, `spacing.xl` above the first):
  - `${editions.length} editions` (icon `library`) when `about.editions.length >= 2` → `EditionsSheet` with `selectedIndex = model.edition?.index ?? 0`, `mineIndex = model.edition?.mineIndex ?? null`, `onSelect = onSelectEdition`;
  - `${n} character(s)` (icon `characters`) when `model.characters.shown.length > 0` → `CharactersSheet` with `[...shown, ...more]` and `gamePath = model.characters.canMakeGame && signedIn && page ? workCharactersPath(page.work.id, segments) : null`;
  - "Change cover" (icon `image`) when `book` → `router.push(bookToolPath(bookKey(book), "cover", segments))`.
  Remove the inline Editions list and the `editionsOpen` / `charactersOpen` state.
- [ ] **Step 5: Community tab.** `StatsTiles` (when `page`) at the top, above `countsLabel`; rest unchanged. In `BookStats.tsx`, replace the "→" text glyph (line ~76) with an `Icon`.
- [ ] **Step 6: Spacing.** `content` keeps `paddingHorizontal: spacing.lg`; hero-to-tabs gap `spacing.xxl`.
- [ ] **Step 7: Run** `npm run typecheck --workspace mobile && npm test --workspace mobile` — expect PASS; `rg -n '"▾"|▾|→' mobile/src/features/works` returns nothing.
- [ ] **Step 8: Commit** `Rebuild the mobile book page hero, tabs and About rows`.

---

### Task 5: Fixed "Want to read" bar

**Files:**
- Modify: `mobile/src/features/works/WorkScreen.tsx`

**Interfaces:**
- Consumes: `addBookToLibrary` (`mobile/src/features/library/api/client`), `toRecommendation` (`mobile/src/features/library/lib/recommendation`), `localDay`, `saveFailureMessage`, `LIBRARY_QUERY_KEY`, `AddBookSheet`, `Button`, `useToast`.

- [ ] **Step 1: Render the bar** in `WorkScreen` below `BookScreen` (normal flow, not absolute, so the scroll view ends above it) when `model.primary === "add"`: a `View` with top hairline, `padding: spacing.md`, containing `<Button label="Want to read" variant="primary" loading={adding} />`.
- [ ] **Step 2: Signed out** (`!signedIn`): the button opens the existing `AddBookSheet` (which shows "Sign in to add books"); no API call.
- [ ] **Step 3: Signed in**: `async function wantToRead()` — guard double taps; `await addBookToLibrary({ ...toRecommendation(model.addBook!, 0), day: localDay() })`; then `await queryClient.refetchQueries({ queryKey: LIBRARY_QUERY_KEY })`; then `await query.refetch()`. Refetch the library **before** the work so `page.mine` never arrives while `book` is missing — the full-screen skeleton at the `page.mine && !book && libraryQuery.isFetching` branch must not show. On error: `useToast()` (`mobile/src/ui/ToastHost.tsx`, as `useLibraryActions` uses it) with `saveFailureMessage(error, "Could not add the book.")` — not an in-flow `Toast` — busy state cleared, bar stays.
- [ ] **Step 4: Remove** the old `adding` add-sheet path for signed-in users (`AddBookSheet` stays only for the signed-out case).
- [ ] **Step 5: Run** `npm run typecheck --workspace mobile && npm test --workspace mobile` — expect PASS.
- [ ] **Step 6: Commit** `Add a fixed Want to read bar to the mobile book page`.

---

### Task 6: "Other editions" in the cover picker

**Files:**
- Modify: `mobile/src/features/library/components/CoverPicker.tsx`
- Modify: `mobile/src/app/(app)/(home,arena,library,search,you)/book/[key]/cover.tsx`

**Interfaces:**
- Consumes: `otherEditionCovers` (Task 2), `useBook(key).workId`, `fetchWork` (`mobile/src/features/works/api`), `saveBookCoverUrl`.
- Produces: `CoverPicker` gains `editionCovers: string[]` and `onPickEdition: (url: string) => void`.

- [ ] **Step 1: Route.** In `cover.tsx`, `useQuery({ queryKey: ["works", workId], queryFn: () => fetchWork(workId!), enabled: Boolean(workId), retry: false })` (same key as `WorkScreen`, so it is usually a cache hit). `editionCovers = otherEditionCovers(data?.work.editions ?? [], current)` where `current` is `book._coverUrl` when a string, else your edition's cover: `data?.work.editions.find((e) => e.mine)?.coverUrl ?? null` (not `work.coverUrl`, which is often another edition's). `onPickEdition = (url) => { void saveBookCoverUrl(book, url); router.back(); }`. A failed or missing work query just yields `[]`.
- [ ] **Step 2: Picker.** When `editionCovers.length > 0`, render an "Other editions" header (same style as "Your gallery") and a wrapped row of tappable 72×108 `BookCover` thumbnails above `FoundCovers`, each with `accessibilityLabel="Use this edition's cover"`.
- [ ] **Step 3: Run** `npm run typecheck --workspace mobile && npm test --workspace mobile` — expect PASS.
- [ ] **Step 4: Commit** `Offer other editions' covers in the mobile cover picker`.

---

### Task 7: Device pass

No files change in this task unless a check fails.

Dispatch `device-checker` (not capture-only) with the worktree path, screenshots to the scratchpad, fixture books The Hobbit (owned, 4 editions, characters), Fahrenheit 451 (owned, 1 edition, sparse), and an unowned catalog book from Search (Dune). Checklist — each is pass/fail with a screenshot:

- [ ] Owned: cover ~150pt, clean; title, "by author", badge, meta row, chips readable and not clipped; tabs show words; dark and light theme.
- [ ] Badge → status sheet: status rows, feeling chips when Finished, picking a feeling keeps it open; switching to Finished from Reading closes it and opens the finish step.
- [ ] "4 editions" → sheet; tapping another edition changes cover/title/meta; tapping "Yours" returns; Fahrenheit 451 shows no editions row.
- [ ] "N characters" → sheet with all names; game button present (both fixture books have ≥4 characters) and opens the cast picker.
- [ ] "Change cover" → picker shows "Other editions" for The Hobbit; picking one updates the cover.
- [ ] Unowned Dune: no badge, tabs About + Community, "Want to read" bar fixed above the tab bar, content not hidden behind it; tapping adds it, bar disappears, badge "To read" appears without a full-screen skeleton.
- [ ] Add with the backend tunnel cut (`adb reverse --remove`): error toast, bar stays, a second tap works after restoring.
- [ ] Community tab: stats tiles at top, opening the stats screen.

Not checkable with the fixture (fixture books all have ≥4 characters, ≤8 characters, and resolve to works): the no-game-button case under 4 characters, and `book/[key]` without a work. Report them as untested; both are simple conditionals reviewed in Task 4.

Fix anything that fails in the owning task's files, re-run that task's verify commands, commit, and re-check only the failed items.
