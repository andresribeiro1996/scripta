# Import Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an import, both the mobile app and the web app show what's happening:
- a confirmation with the number of books added;
- a progress banner on the library screens ("Finding covers · 230 of 1,000 · about 6 min left") until covers are in;
- a designed fallback instead of a grey box or "Cover unavailable".

**Architecture:**
- **Shared resolver** (`packages/shared/src/library/coverResolver.ts`):
  - It gains `watch(params[])`, which asks the server about many books in batches of 100. The per-book GET would hit the 1,200/min rate limit at 1,000 books.
  - It gains a small progress store (`progress()`, `subscribe()`).
  - Pending keys keep multiple waiters, so a cell's `resolve()` and a library `watch()` share one poll.
- **Each client** maps its library books to lookups, watches them when the library loads or changes, and renders a banner from the progress store. The server already queues every imported book's cover at import (`library/service.ts` `enqueueCovers`), so no backend change is needed.

**Tech Stack:** `@scripta/shared` (TypeScript, `node:test`), Expo/React Native (mobile), React/Vite/Tailwind (frontend).

**Spec:** the Decisions below (chat, 2026-10-01), and `DESIGN.md` for colours and the no-cover fallback.

## Decisions

- **Both clients:** mobile and web.
- **Banner text:** `Finding covers · {settled} of {total}`, plus ` · about {n} min left` once a rate is known and the estimate is at least 1 minute.
  - Shown only while `pending >= 3`, so a single on-screen lookup never flashes it.
  - It disappears when nothing is pending.
- **Banner colours:** `info-soft` background with `info` text (`DESIGN.md`: "Running with nothing asked of you"). The progress bar is `accent` fill on a `border` track (`DESIGN.md`, DuelCard/mural bars).
- **Banner placement:**
  - mobile: the Library tab header (`LibraryScreen.tsx` `ListHeaderComponent`, above search) and My shelf's Library pane header (`OwnLibraryPane.tsx`);
  - web: `LibraryPage.tsx` above the toolbar.
- **Import confirmation:**
  - mobile: the import sheet shows a success state ("{n} books imported. Covers will fill in over the next few minutes.") with a Done button, instead of closing silently;
  - web: `toast({ message })` with the same text.
  - `{n}` is the number of books **added** (after minus before). When `n` is 0: "Your library is already up to date."
- **Fallback cover:** `DESIGN.md` says "plain `surface` tile with centered title, never a broken-image icon".
  - Callers that draw their own title over the cover pass `onHasCoverChange` (BookCard on both clients). Those get a plain `surface` tile.
  - Every other caller gets `surface` plus a centred title, up to 3 lines, in `text-dim`.
  - While a cover is still being looked up, the tile shows the same thing, so nothing flickers when a lookup ends with no cover.
- **Progress counting:**
  - `total` counts keys that entered `pending` since `pending` was last empty.
  - `settled` counts keys that left it: found, not found, given up, or rejected.
  - Both reset to 0 when `pending` empties.
  - `perMinute` is settles in the last 2 minutes divided by 2, or `null` with fewer than 5 settles.
- **Shared helpers:** `coverProgressLabel(progress)` and `importedMessage(added)` live in `@scripta/shared`, so both clients use one copy.

## Global Constraints

- Minimum code, no new comments, no new dependencies (root `AGENTS.md`).
- Reuse `@scripta/shared`. The book → lookup mapping is `seedCoverLookup` (`packages/shared/src/arena/arenaSeed.ts`) or the clients' existing `coverParamsFor`; don't add a third.
- Catch only expected errors. A rejected batch already rejects its waiters after 3 failed ticks; `watch` must not swallow that.
- Mobile UI uses `useTheme()` tokens and `mobile/src/ui` components. Web uses the `--color-*` CSS variables. Both follow `DESIGN.md`.
- Each package's verify commands are in its `AGENTS.md`. Rebuild `@scripta/shared` before client typechecks.

## Review Focus

1. **Importing 1,000 books makes about 10 batch requests per tick, not 1,000 single GETs.** Pinned in Task 1.
2. **A cell's `resolve()` and the library `watch()` on the same pending key both resolve when the cover lands, without double polling.** Pinned in Task 1.
3. **Re-watching the same library on every render or library refresh doesn't add keys twice or restart counts.** Pinned in Task 1, and in the client hooks (Tasks 2 and 3).
4. **No books pending:** no banner. **Two pending:** no banner. Pinned in Task 1.
5. **Import of 0 new books:** shows "already up to date", not "0 books imported". Pinned in Task 1.

---

### Task 1: Shared — resolver `watch`, multi-waiter pending, progress store, label helpers

**Files:**
- Modify: `packages/shared/src/library/coverResolver.ts`
- Create: `packages/shared/src/library/coverProgress.ts`, with `coverProgressLabel(progress: CoverProgress): string | null` and `importedMessage(added: number): string`, exported from the package index.
- Test: `packages/shared/src/library/coverResolver.test.ts`, `packages/shared/src/library/coverProgress.test.ts`

**Interfaces (additions to `CoverResolver`):**
- `watch(params: CoverLookupParams[]): Promise<void>`. For each key that isn't freshly cached, isn't already pending and isn't in flight, it sends `fetchResolveBatch` in chunks of `COVER_BATCH_SIZE`. Settled answers are stored, as the poll loop does. Pending answers join `pending` with no waiter of their own and start the poll loop. It resolves after the initial batches.
- `progress(): CoverProgress`, with `interface CoverProgress { pending: number; settled: number; total: number; perMinute: number | null }`. Export the type.
- `subscribe(listener: (progress: CoverProgress) => void): () => void`. Listeners are called after any change to `pending` or the counts.
- `pending` entries hold `waiters: Array<{ resolve, reject }>`. `waitForCover` attaches to an existing entry instead of replacing it. Settling, give-up and the 3-failed-ticks rejection apply to every waiter.
- `coverProgressLabel`:
  - returns `null` when `pending < 3`;
  - otherwise returns `Finding covers · {settled} of {total}`, plus ` · about {ceil(pending / perMinute)} min left` when `perMinute` isn't null and the estimate is at least 1;
  - formats numbers with thousands separators (`1,000`).
- `importedMessage(0)` is `"Your library is already up to date."`. `importedMessage(1)` is `"1 book imported. Covers will fill in over the next few minutes."`. `importedMessage(n)` uses the plural.

- [ ] **Step 1: Write failing tests**, using the file's fake-deps and fake-sleep style:
  - `watch` of 250 uncached keys calls `fetchResolveBatch` 3 times (100/100/50) and never calls `fetchResolve`.
  - Settled answers are cached, so `peek` returns them, and pending ones are polled on the next tick.
  - A `resolve()` on a key already pending via `watch` resolves when the poll settles it, and the key is batched once per tick.
  - `watch` called twice with the same keys sends no new batch requests for keys already pending or cached.
  - `progress` across a run: totals and settled counts rise; it resets to zeros when `pending` empties; `perMinute` stays `null` under 5 settles.
  - `subscribe` fires on add and settle, and unsubscribe stops calls.
  - After 3 failed ticks, both a `resolve()` waiter and the watch entry are cleared, and `pending` returns to 0.
  - Label and message helpers: null under 3 pending, the separator formatting, the ETA rounding, and the 0, 1 and n messages.
- [ ] **Step 2:** Run the package tests and watch the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the package build and tests.
- [ ] **Step 5:** Commit: `Let the cover resolver watch a whole library in batches and report progress`.

---

### Task 2: Mobile — watch the library, progress banner, import confirmation, fallback tile

**Files:**
- Modify: `mobile/src/features/library/api/covers.ts`. Export `watchLibraryCovers(books)`, which maps through the shared lookup mapping and skips nulls. Also export `coverProgress()` and `subscribeCoverProgress()`.
- Create: `mobile/src/features/library/components/CoverProgressBanner.tsx`. Use `useSyncExternalStore` over the progress store, use `coverProgressLabel` for text and visibility, apply the Decisions' colours, and make it a `progressbar` for accessibility with its value.
- Modify: the Library tab screen (`LibraryScreen.tsx`) and `mobile/src/features/community/OwnLibraryPane.tsx`. Render the banner at the top of the list header, and call `watchLibraryCovers(library.data.books)` in an effect keyed on the library document's `updatedAt`.
- Modify: `ImportForm.tsx` plus its route and `useLibraryActions().merge`:
  - `merge` returns the number of books added (after minus before, using the cached document before the save);
  - the sheet shows `importedMessage(added)` with a Done button that closes it.
- Modify: `mobile/src/features/library/components/CoverImage.tsx`. Apply the fallback rule from the Decisions, and remove the "Cover unavailable" text.

- [ ] Implement. Run `cd mobile && npm run typecheck && npm test` (after building shared). Commit: `Show cover progress and an import confirmation on mobile`.

---

### Task 3: Web — same behaviour

**Files:**
- Modify: `frontend/src/api/covers.ts`. Same three exports as mobile.
- Create: `frontend/src/components/CoverProgressBanner.tsx`. Use `useSyncExternalStore`, `coverProgressLabel`, and the inline-notice pattern (`rounded-lg px-3 py-2 text-sm`) with `bg-(--color-info-soft) text-(--color-info)` and an `accent`-on-`border` bar.
- Modify: `frontend/src/pages/LibraryPage.tsx`.
  - Render the banner above the toolbar.
  - Call `watchLibraryCovers` in an effect keyed on the library's `updatedAt`.
  - After `mergeAndSave` succeeds, `toast({ message: importedMessage(added) })`. `mergeAndSave` returns the added count, computed the same way as mobile.
- Modify: `frontend/src/components/BookCard.tsx` `CoverImage`'s no-`src` branch. Apply the fallback rule: no `BookIcon`, a `surface` tile, and a centred title when there's no `onHasCoverChange`.

- [ ] Implement. Run `cd frontend && npm run typecheck && npm run lint && npm test`. Commit: `Show cover progress and an import confirmation on the web`.

---

### Task 4: Verify on a device and in a browser (controller)

1. Run `node scripts/dev-status.mjs --json`. If the emulator is free, dispatch `device-checker` on the mobile Library tab and My shelf → Library:
   - import the fixture library twice; the second time shows "already up to date";
   - the banner appears while covers resolve and disappears after;
   - a mural block whose book has no cover shows the title tile.

   If another worktree holds the emulator, skip this and say so.
2. Web: start the frontend dev server from this worktree, using the dev-workflow port claim, and check the same in the browser pane.
