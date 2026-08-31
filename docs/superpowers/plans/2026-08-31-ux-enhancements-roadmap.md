# UX Enhancement Roadmap — Desktop & Mobile

> **For agentic workers:** This is a roadmap, not a task-level plan. Each phase below gets its own detailed implementation plan (writing-plans format, TDD steps) before execution. Do not implement directly from this document.

**Goal:** Close the systemic UX gaps found in evaluation: mobile/PWA usability, the dead card-click affordance, missing search/filter, touch/keyboard interaction parity, silent failures, and offline behavior.

**Architecture:** Phases are ordered so each ships independently usable value; nothing in a later phase is required by an earlier one. Phases 0–2 change interaction surfaces (shell, cards, grid); 3–5 change feedback and resilience; 6 is polish. Each phase = one PR-sized plan = one review gate.

**Tech Stack:** React + Vite + TS, Tailwind v4, TanStack Query, vite-plugin-pwa (workbox). Possible new deps (Decision D3 only): `@dnd-kit/core` + `@dnd-kit/sortable`.

**Spec:** This document. Source evaluation: conversation 2026-08-31 (designer review of `frontend/`).

## Global Constraints

- `npm run typecheck` and `npm run lint` (oxlint) in `frontend/` after every change.
- No comments in code unless asked (AGENTS.md). Existing file-header comment style is exempt (matching current convention).
- Preserve current behavior on desktop unless a task says otherwise; mobile additions must not degrade desktop pointer/keyboard UX.
- Test convention: pure-logic scripts under `frontend/scripts/test-*.mts` run via `npx tsx`; no unit-test framework in the repo. UI verification is manual-in-browser (document steps in each phase plan).
- Every phase plan must include manual mobile verification at 390×844 (iPhone) and desktop 1440×900, plus keyboard-only pass where relevant.

## Findings this roadmap addresses

**Mobile (new, from this session's pass):**

| # | Finding | Evidence |
|---|---|---|
| M1 | Grid overflows horizontally on phones: fixed `w-56` (224px) sidebar leaves 166px content; default `cardMinWidth: 200` forces horizontal scroll | `DashboardLayout.tsx:31`, `lib/libraryStyle.ts:156` |
| M2 | No responsive nav collapse, no bottom tab bar, no drawer | `DashboardLayout.tsx` (zero breakpoint classes) |
| M3 | No `viewport-fit=cover` / `env(safe-area-inset-*)` — standalone PWA content sits under notch/home indicator on iOS | `frontend/index.html:7`, grep: no safe-area usage |
| M4 | iOS focus-zoom: inputs at `text-[15px]`/`text-[13px]` < 16px trigger Safari page zoom on focus | `LoginPage.tsx:133`, various |
| M5 | Hover-only affordances unreachable on touch: Style/Cover buttons, rename scent, `title` tooltips (tooltips don't exist on touch) | `BookCard.tsx:323`, `LibraryPage.tsx:272-281` |
| M6 | Reorder dead on touch (HTML5 DnD); mural canvas dead on touch (react-grid-layout mouse events); tier-list inner DnD dead on touch | `BookCard.tsx:249-278`, `MuralCanvas.tsx:95-96` |
| M7 | Touch targets far below 44×44: `text-[10.5px] px-2.5 py-1` pills, 24px selection checkbox | `BookCard.tsx:312,325-347` |
| M8 | Offline = broken: workbox precaches the shell only, no runtime caching of `/library` or cover responses — installed app offline shows error states despite "wherever you left off" pitch | `vite.config.ts:11-26` (no `runtimeCaching`) |
| M9 | Public pages (share links, arena voting — the pages strangers open on phones) unaudited for narrow screens; `BracketTree`/tier lists likely overflow | `ArenaViewPage.tsx`, `SharedLibraryPage.tsx` |

**Desktop (carried from prior evaluation):**

| # | Finding | Evidence |
|---|---|---|
| D1 | Card primary click is a no-op; no book detail view exists | `LibraryPage.tsx:374` `onClick={() => {}}` |
| D2 | No search/filter/sort on the Library grid (pattern exists in GroupsPage picker) | grep across `pages/` |
| D3 | BookCard not keyboard-accessible: clickable div, no role/tabIndex/keys; div checkbox | `BookCard.tsx:246-248,310-320` |
| D4 | With overlay text hidden, card has no accessible name (h3 unrendered, `alt=""`) | `BookCard.tsx:377,124-126` |
| D5 | Silent failures: reorder rollback only console.errors; debounced style saves have no indicator | `LibraryPage.tsx:141-144` |
| D6 | Confirm dialogs are the only safety net; no undo for destructive deletes | `ConfirmDialog.tsx`, delete flows |
| D7 | Nav IA: 8 flat items mixing content and config; Murals/Arena unexplained; "Library style" undersells scope | `DashboardLayout.tsx:6-15` |
| D8 | Login label contrast likely under WCAG AA (45%-opacity 10.5px labels) | `LoginPage.tsx:37,214` |
| D9 | No 404 route — wildcard silently redirects to `/dashboard` | `App.tsx:62` |
| D10 | Drop feedback: 2px outline only, no insertion caret; standalone-onto-series drop point ≠ pointer position | `BookCard.tsx:292` |
| D11 | Covers pop in with no transition | `BookCard.tsx:123-133` |

## Confirmed design decisions (settled 2026-08-31)

- **D-A Mobile nav pattern.** **Confirmed:** bottom tab bar for content nav (Library / Series / Collections / More) + "More" opens an off-canvas drawer carrying Gallery/Murals/Arena/Style/Settings + logout; sidebar unchanged ≥ `lg`.
- **D-B Card actions on touch.** **Confirmed:** Style/Cover actions live inside the book detail sheet (P1); hover pills remain as desktop accelerator (`pointer-coarse` hides them).
- **D-C Reorder on touch/keyboard.** **Confirmed:** replace HTML5 DnD with `@dnd-kit` (pointer + keyboard sensors, insertion-gap feedback) in P2.
- **D-D Mural editing on touch.** **Confirmed:** view-only murals on mobile v1 with an "Edit on desktop" hint chip; full touch mural editing deferred.

---

## Phase 0 — Mobile shell & input fundamentals

Makes the app merely usable on a phone. No new features; fixes M1–M4, M7 partially.

**Files:** `frontend/src/layouts/DashboardLayout.tsx` (rewrite), `frontend/index.html`, `frontend/src/index.css`, `frontend/src/components/BookCard.tsx` (target sizes), new `frontend/src/components/AppDrawer.tsx` or equivalent.

Tasks:
1. Viewport & safe area — add `viewport-fit=cover` to the viewport meta; pad shell edges with `env(safe-area-inset-*)`; verify manifest `display: standalone` renders clear of notch/home indicator.
2. Responsive shell — implement D-A: sidebar hidden below `lg`; bottom tab bar (content items) + drawer (rest + logout). Sidebar markup above `lg` unchanged.
3. Grid floor fix — `BookGrid` clamps `cardMinWidth` to available width (e.g. `min(${style.cardMinWidth}px, 100%)` in the `minmax()`), killing horizontal overflow regardless of user style setting.
4. Input zoom — 16px font floor on all focusable text inputs (login fields, rename input, group forms, mural inputs).
5. Touch targets — raise card chrome pills and the selection checkbox to ≥44px hit areas (visual size may stay small; extend hit area via padding/pseudo-element).

Acceptance: at 390×844 — no horizontal scroll on Library/Series/Collections/Gallery; every nav destination reachable; login usable without page zoom; all chrome buttons comfortably tappable. Desktop unchanged at ≥1024px.

## Phase 1 — Book detail view + search/filter/sort

The biggest product gap, both platforms. Fixes D1, D2, M5 (via D-B).

**Files:** new `frontend/src/components/BookDetailSheet.tsx`, modify `frontend/src/pages/LibraryPage.tsx`, new `frontend/src/components/LibraryToolbar.tsx`, `frontend/src/lib/covers.ts` (status helpers already there).

Tasks:
1. Book detail sheet — clicking a card (Library grid; later also Series/Collections) opens a bottom sheet on mobile / centered modal on desktop: large cover, title/author/status, progress if present, highlights list (already in the book object), and actions: Style, Cover, toggle read status. Cards stop being dead buttons.
2. Card actions routing — per D-B: Style/Cover buttons open from the sheet on touch; hover pills remain on pointer-fine devices.
3. Library toolbar — search box (title/author, same matching as `GroupsPage.tsx:401`), status filter (All / Not read / Reading / Finished via `statusLabel`'s source field), sort (manual order default; title A–Z; author; status). Client-side only, no backend change.
4. Empty-result state — "No books match" with clear-filters action.

Acceptance: find a book by typing any word of its title in ≤2s; open a book and read its highlights without leaving the page; works one-handed at 390px.

## Phase 2 — Reorder parity (touch + keyboard)

Fixes M6 (library part), D3 partially, D10. Depends on D-C decision.

**Files:** `frontend/src/components/BookCard.tsx`, `frontend/src/pages/LibraryPage.tsx`, `frontend/src/lib/libraryOrder.ts` (unchanged logic, new event source).

Tasks (if dnd-kit): swap HTML5 DnD props for dnd-kit sensors (Pointer + Keyboard), keep `reorderOnDrop` as the single order-authority (unit-tested already by `scripts/test-library-order.mts` — extend for the new drag-unit semantics), adopt dnd-kit's insertion-gap feedback, keep View Transitions animation. Mobile: long-press (150ms) arms a drag. Murals stay per D-D: add "view-only on this device" chip when `editMode` would be needed on touch.

Acceptance: reorder works with finger, mouse, and keyboard (Tab to card, Space to lift, arrows to move); series moves as a block in all three; no regressions in `scripts/test-library-order.mts`.

## Phase 3 — Feedback & safety

Fixes D5, D6.

**Files:** new `frontend/src/components/Toaster.tsx` (+ `useToast`), `frontend/src/pages/LibraryPage.tsx`, `frontend/src/pages/GroupsPage.tsx`, `frontend/src/components/ConfirmDialog.tsx` (delete flows stop using it where undo applies).

Tasks:
1. Toast system — minimal context-based toaster (info/error, auto-dismiss, stacking), mounted in `App.tsx`.
2. Undo delete — deleting books/groups keeps the pre-delete snapshot in memory; toast "Deleted N books — Undo" for 6s; undo restores via the normal save path. Confirmation dialog dropped for these flows (undo is the safety net).
3. Surface silent failures — reorder rollback, style-save failure, cover-assign failure fire an error toast; debounce indicators stay passive (no "saving" chrome).

Acceptance: delete 3 books, undo within 6s, books and group memberships fully restored; kill the backend mid-drag-save and see an error toast, not a silent snap-back.

## Phase 4 — Accessibility pass

Fixes D3, D4; partial M5.

**Files:** `frontend/src/components/BookCard.tsx`, `frontend/src/components/BookGrid.tsx`, `frontend/src/index.css`, `LoginPage.tsx` (D8 contrast).

Tasks:
1. Card semantics — root `role="button"` + `tabIndex={0}` + Enter/Space activation (or real `<button>` if styling permits); selection checkbox becomes a real checkbox input (visually identical overlay).
2. Accessible name always — when overlay text is hidden, render the title in a `sr-only` element so the card is never nameless; give the cover `img` a meaningful `alt` (title) instead of `""` when it's the only content.
3. Focus visibility — global `:focus-visible` ring using `--color-accent`; remove bare `outline-none` without replacement (login underline fields get a visible focus state beyond border color).
4. Contrast — bump `PAPER_DIM` label opacity 45%→~65% on login; recheck dashboard dim-text tokens against AA for body-size text.

Acceptance: full keyboard pass — navigate, open detail, select, delete, reorder (post-Phase 2) without a pointer; axe DevTools scan of Library/login reports no serious violations.

## Phase 5 — Offline PWA

Fixes M8. The "wherever you left off" promise.

**Files:** `frontend/vite.config.ts` (workbox `runtimeCaching`), new `frontend/src/components/OfflineBanner.tsx`, `frontend/src/api/client.ts` (online/offline awareness).

Tasks:
1. Runtime caching — `GET /library` stale-while-revalidate; cover responses (`/covers/cached/*` and the resolve endpoint) cache-first with LRU cap; auth/me excluded.
2. Offline banner — passive top banner when `navigator.onLine` is false or a query fails offline: "Offline — showing your last synced library."
3. Write guard — mutating calls while offline fail fast with a toast, never silently queue.

Acceptance: load library, kill network, reload the installed app — full grid with covers renders; edits attempted offline produce a clear message; reconverges on reconnect.

## Phase 6 — Polish

Fixes D7, D9, D11, M9.

Tasks:
1. Nav IA — sidebar/drawer grouped: content items, divider, Gallery/Murals/Arena, divider, Library style/Settings; one-line descriptions for Murals ("Freeform dashboard pages") and Arena ("Book tournaments") shown in drawer and on their list pages' empty states; rename consideration for "Library style" scope (document decision).
2. 404 route — real "Not found" page for `*`, distinguishable from auth redirect.
3. Cover fade-in — 150–200ms opacity transition once `img` loads (keep eager loading; no `loading="lazy"` per existing bug note).
4. Public pages mobile audit — `ArenaViewPage` (bracket/voting), `SharedLibraryPage`, `SharedMuralPage` at 390px: fix overflows, tap targets for vote buttons, share-view header. These are the pages non-users see; they are the app's storefront.

---

## Sequencing rationale

- Phase 0 first: every later phase is evaluated on mobile through the shell; fixing it first stops double-testing broken layouts.
- Phase 1 next: largest user value; also resolves where card actions live (D-B), which Phase 2's touch work depends on.
- Phases 2–4 are independent of each other after 1; run in that order for risk descending (interaction > resilience > a11y-only changes).
- Phase 5 anytime after 0; Phase 6 last, purely additive.

## Self-review

- Coverage: M1–M9 and D1–D11 all map to phases (M1→P0.3, M2→P0.2, M3→P0.1, M4→P0.4, M5→P1.2/P4, M6→P2/D-D, M7→P0.5, M8→P5, M9→P6.4; D1→P1.1, D2→P1.3, D3→P2/P4.1, D4→P4.2, D5→P3.3, D6→P3.2, D7→P6.1, D8→P4.4, D9→P6.2, D10→P2, D11→P6.3).
- Decisions D-A–D-D block only their own phases' detailed plans; all have recommendations so settling them is cheap.
- Murals full touch editing deliberately out of scope (D-D); revisit after P2 proves the dnd-kit pattern.
