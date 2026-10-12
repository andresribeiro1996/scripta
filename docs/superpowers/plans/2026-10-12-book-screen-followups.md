# Book Screen Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Follow-ups to the merged book screen (PR #222) and the cover colour wash (PR #230): a mobile header tint that never lags the scroll, plus six small fixes across mobile, web and backend.

**Specs:** `docs/superpowers/specs/2026-10-11-merged-book-screen-design.md`, `docs/superpowers/specs/2026-10-11-cover-colour-wash-design.md`. This plan amends the wash spec's mobile line ("the native header is opaque") for `WorkScreen` with a cover colour: the header is transparent there and the screen draws its background.

## Global Constraints

- No code comments (repo rule); the why goes in commit messages. Removing a comment that has become false is fine.
- Minimum code; reuse `@scripta/shared` and existing helpers before adding anything.
- No swallowed errors: catch only the failure you expect.
- Mobile: never read `x.value` inside a JSX inline style (raises a LogBox toast that swallows taps); use `useAnimatedStyle`.
- After `packages/shared` changes run `npm run build --workspace @scripta/shared` before typechecking clients.
- Backend tests: run with `npm test --workspace backend` (it carries the env preamble) or `npx tsx --test <file>` from `backend/` with the same env as that script. New `*.test.ts` files go in `backend/package.json`'s `test` list.
- Verify per package touched: `npm run typecheck` and `npm test` (and `npm run lint` in `frontend/`).
- Run git from the worktree root; stage files by name and commit in the same command. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never start emulators or dev servers in implementer tasks unless the task says so; the device pass is Task 6.

## Task 1: Mobile header tint on the UI thread (also fixes the stale tint after a theme change)

**Files:** `mobile/src/features/works/WorkScreen.tsx`, `mobile/src/features/works/BookScreen.tsx`.

Today `WorkScreen` holds `scrolledHeaderColor` in React state and sets it from `BookScreen`'s `onScrollY` (plain `ScrollView`, `scrollEventThrottle={16}`), then passes it to the native header via `Stack.Screen` `headerStyle`. That lags the content mid-fling, and the cached colour survives a theme change until the next scroll.

Replace it with:

- [ ] In `WorkScreen`, at the top with the other hooks (before any early return): `const scrollY = useSharedValue(0)` and `const headerHeight = useHeaderHeight()` — import `useHeaderHeight` from `"expo-router/react-navigation"` (expo-router re-exports `@react-navigation/elements`; do not add a dependency).
- [ ] Delete `scrolledHeaderColor`, `headerColorAt`, `headerColor`, `headerStyle`, the `blendHex` import and the `onScrollY` prop everywhere.
- [ ] When `wash && work.coverColor` (the tinted case), the `Stack.Screen` options add `headerTransparent: true`, `headerLargeTitleEnabled: false` and `headerShadowVisible: false`. With no cover colour the options are exactly what they were before PR #230's tint (no `headerStyle` override, large title inherited).
- [ ] In the tinted case `WorkScreen` renders, after `<BookScreen>` (so it sits above the scroll content and below the native header), an absolutely positioned, `pointerEvents="none"`, accessibility-hidden header background at `top: 0, left: 0, right: 0, height: headerHeight`: a `View` with `backgroundColor: colors.background` containing a full-size `Animated.View` with `backgroundColor: work.coverColor` whose `opacity` comes from `useAnimatedStyle(() => ({ opacity: washAlphaAt(topAlpha, scrollY.value) }))`. Put this in a small component (e.g. `HeaderWash`) in `BookScreen.tsx` next to `washAlphaAt`, so the `useAnimatedStyle` hook is not behind `WorkScreen`'s early returns.
- [ ] Make `washAlphaAt` a worklet: first statement `"worklet";`. Keep its signature and maths.
- [ ] `BookScreen` takes two new optional props instead of `onScrollY`: `scrollY?: SharedValue<number>` and `headerInset?: number` (default 0). It renders `Animated.ScrollView` (from `react-native-reanimated`) with `onScroll={useAnimatedScrollHandler(...)}` that writes `event.contentOffset.y` into `scrollY` when given, `scrollEventThrottle={16}`. Content `paddingTop` becomes `spacing.lg + headerInset`; the wash `Svg` moves to `top: headerInset`. `WorkScreen` passes `scrollY` always and `headerInset={headerHeight}` only in the tinted case. Follow the existing `useAnimatedScrollHandler` usage in `mobile/src/features/murals/MuralEditorScreen.tsx`.
- [ ] The library-only route `mobile/src/app/(app)/(home,arena,library)/book/[key]/index.tsx` passes neither prop and must look and behave exactly as before.

Invariant (Review Focus 1): at any scroll offset `y`, the header background colour equals the wash row directly under the header bottom: content row `headerInset + y` is wash row `y`, and the header shows `coverColor` at `washAlphaAt(topAlpha, y)` over `colors.background`, which is what the wash SVG shows there. Overscroll (`y < 0`) shows `topAlpha`.

Theme change (user task 3): there is no cached colour any more; `colors.background` and `wash.topAlpha` come from `useTheme()` on every render, so a theme change re-tints without a scroll event. Nothing else to do — check it holds.

iOS large title (user task 2): with `headerLargeTitleEnabled: false` in the tinted case, the large-title header (and the global `headerLargeStyle` in `mobile/src/ui/navigation.tsx`) is never shown on a tinted book screen, so it cannot show untinted. Leave `navigation.tsx` unchanged.

Verify: `npm run typecheck --workspace mobile`, `npm test --workspace mobile`. No device in this task.

## Task 2: Mobile book keys decoded once

**Files:** `mobile/src/features/library/hooks/useBook.ts`, `mobile/src/app/(app)/(home,arena,library)/book/[key]/index.tsx`.

Expo Router already URI-decodes route params (see the note in `book/[key]/finished.tsx`), so the extra `decodeURIComponent` calls mangle a key with a literal `%` (and throw `URIError` on `%` followed by non-hex).

- [ ] `useBook.ts`: use `rawKey` as the key directly (rename the parameter to `key`), and delete the false "the key arrives percent-encoded" clause from the file's header comment.
- [ ] `book/[key]/index.tsx`: `bookMenuItems(model, key, segments)` — no decode.
- [ ] No other `decodeURIComponent` on a book key exists in `mobile/src`; confirm with `rg -n decodeURIComponent mobile/src`.
- [ ] Test: there is no pure function left to test (the hook needs React Native and the mobile runner is node:test over `.test.ts` only). Skip a unit test; Task 6's device pass covers the route.

Verify: `npm run typecheck --workspace mobile`, `npm test --workspace mobile`.

## Task 3: Backend cover colour backfill logs its drains

**Files:** `backend/src/modules/books/backfill.ts`, `backend/src/modules/books/plugin.ts`, `backend/src/modules/books/backfill.test.ts`.

- [ ] `startCoverColorBackfill(step, log: WorksLog, intervalMs?, timers?)` — replace the `onError` parameter with the same `WorksLog` the works backfill takes. On each drain: `const coloured = await drainBatches(step, signal, COLOR_BATCH_SIZE); if (coloured > 0) log.info({ coloured }, "coloured cover images");`. Errors: `(error) => log.error({ err: error }, "cover colour backfill failed")` (the message `plugin.ts` logs today).
- [ ] `plugin.ts`: `startCoverColorBackfill((limit) => service.fillCoverColors(limit), app.log)`.
- [ ] Tests, using the existing `fakeTimers()`, `fakeLog()` and `until()` helpers:
  - the drain test asserts `limits` `[50, 50, 50]` and one info log `{ details: { coloured: 107 }, message: "coloured cover images" }`; then it fires the interval with `state.callback!()` and asserts a second drain runs (step called again with 50) and that a drain returning 0 logs nothing new.
  - the abort/failure test asserts the failure lands as an error log with `message: "cover colour backfill failed"` and `details.err.message === "R2 GET failed: HTTP 500"`.
  - test names say what they test (drop "retries on the next tick" unless the test now fires the timer, which it should).

Verify: `npm run typecheck --workspace backend`, `npm test --workspace backend`.

## Task 4: Web book screen refetches after a cover fix; wash assertion targets the wash

**Files:** `frontend/src/components/book/BookScreen.tsx`, `frontend/scripts/test-work-page.mts`.

- [ ] After `rejectSharedCover` and after `uploadSharedCover` succeed (inside the existing `try`, after the current success lines), invalidate the work page: `void queryClient.invalidateQueries({ queryKey: ["works", page.work.id] })` when `page` is not null (`queryClient` from `useQueryClient()`; the work query key is `["works", id]` in `frontend/src/hooks/useWork.ts`). Keep the existing `forgetResolvedCover` / `rememberResolvedCover` and `coverVersion` bump.
- [ ] `test-work-page.mts`, test "a cover colour washes the header and hero; no colour, no wash": replace `washed.includes('aria-hidden="true"')` with an assertion on the wash element itself — a regex over the rendered opening tag that requires `aria-hidden="true"`, the wash's `h-[520px]` class and the `linear-gradient(to bottom` background on the same element. Make the no-wash renders assert that same pattern is absent. Fix the test, not the markup.
- [ ] Add a test only if a refetch can be asserted with the existing renderToString harness without new infrastructure; otherwise none (ruling recorded by the controller).

Verify: `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend`, `npm test --workspace frontend`.

## Task 5: Web library restores its scroll position on Back

**Files:** `frontend/src/pages/LibraryPage.tsx` (and a small helper beside it only if needed).

The app uses `<BrowserRouter>` (react-router-dom 7, declarative routes), so `<ScrollRestoration>` is unavailable. The library grid is not virtualized and scrolls the window. `html { scroll-behavior: smooth }` is set.

- [ ] Remember the window's scroll position per history entry: a module-level `Map<string, number>` keyed by `useLocation().key`, updated by a passive `scroll` listener on `window` that is added and removed in a `useLayoutEffect` (so the listener is gone before the next page's layout can fire a scroll event).
- [ ] On a `POP` navigation (`useNavigationType() === "POP"`) back to a library entry with a saved position, restore it once the book grid is rendered (not while the skeleton shows): `window.scrollTo({ top, behavior: "instant" })` in a `useLayoutEffect`, once per mount.
- [ ] Filter and sort already live in the URL; don't change them. A fresh (PUSH) visit to the library starts wherever it starts today.
- [ ] No unit test: the frontend tests are renderToString-only, so scroll can't be exercised; the controller verifies in the browser.

Verify: `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend`, `npm test --workspace frontend`.

## Task 6: Device pass (device-checker, Android emulator)

Covers Tasks 1 and 2. Dev fixture books with cover colours: The Fellowship of the Ring and Dracula.

- [ ] Seam between header background and wash ≤3 colour steps (max channel delta of the pixel rows just above and just below the header bottom, sampled away from the title and buttons) at scroll 0, at two or three settled offsets inside the wash (e.g. ~100 and ~300 dp), past the wash, and in frames captured mid-fling (screencap during a fast `input swipe`).
- [ ] Overscroll at the top (drag down at scroll 0): no untinted band appears between header and wash.
- [ ] Light and dark themes. Theme switch without scrolling: open a book, switch theme in Settings, go back to the book without touching it, and the header matches the new theme's wash.
- [ ] A book with no cover colour: opaque default header, as before.
- [ ] A library-only book (`/book/<key>`, no work), if the fixture has one: unchanged, no tint.
- [ ] No LogBox toast on the book screen.
