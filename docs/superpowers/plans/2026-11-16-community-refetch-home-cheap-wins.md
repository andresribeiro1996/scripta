# Community Refetch, Home Picks and Cheap Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared list of what to refetch after a follow or a shelf publish. One shared reading pick. Mobile Home hides the viewer's own games. Community jobs are staggered. The locale store and username rule live in shared.

**Architecture:** Small pure additions to `@scripta/shared` (`community/queryKeys.ts`, `community/homeModel.ts`, `i18n/localeStore.ts`, `auth.ts`), each consumed by both clients. Community plugin timers move to `createJobs`.

**Tech Stack:** TypeScript, React, React Native/Expo, TanStack Query, Fastify, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-community-refetch-home-cheap-wins-design.md`

**Base:** `main`. This lane must not touch the files of the library lane (`useBookActions.ts`, `useLibraryActions.ts`, `LibraryPage.tsx`, `LibraryScreen.tsx`, groups screens, shared `library/`) or of the games lane (shared `arena/`, `quizzes/`, the shared i18n message catalogues).

## Global Constraints

- No comments in code. Build shared before web or mobile tests.
- Backend test files are listed explicitly in `backend/package.json`. Shared, mobile and web tests are globbed.
- Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **Prefix invalidation** of `["community","dashboard"]` reaches mobile's infinite circle query and web's circle and activity queries. Task 1.
- **Mobile Home with fewer than two non-own games** shows what there is. Task 2.
- **The first archive run waits 100 s.** The archive tests must not depend on a t=0 run. Task 3.
- **The locale store** keeps one module-level instance per client. Importers must not each create their own store. Task 4.

---

### Task 1: Shared refetch lists

**Files:**
- Create: `packages/shared/src/community/queryKeys.ts`
- Test: `packages/shared/src/community/queryKeys.test.ts`
- Modify: `packages/shared/src/community/index.ts`
- Modify: `frontend/src/hooks/useCommunity.ts`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/components/home/ForYouPanel.tsx`
- Modify: `mobile/src/features/community/useFollowToggle.ts`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/home/FeedRow.tsx`
- Modify: `mobile/src/features/home/ActivityScreen.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`

**Interfaces:**
- Produces: `AFTER_FOLLOW`, `afterShelfPublish(username: string | null)`, `AFTER_SHELF_PUBLISH_FAILED`.

- [ ] **Step 1:** In `queryKeys.test.ts`, add:
  - `afterShelfPublish(null)` and `afterShelfPublish("")` are both `[["community","own-profile"]]`, because the check is truthiness;
  - `afterShelfPublish("ana")` adds the profile and activity keys;
  - `AFTER_FOLLOW` contains the dashboard prefix.

  Run it and see it fail, then implement and export.
- [ ] **Step 2:** On web, `invalidateAfterFollow` loops over `AFTER_FOLLOW`. `ForYouPanel.tsx:104` drops its `await feed.refetch()`; the dashboard prefix already refetches the feed. `OwnShelfView`'s `run` uses `afterShelfPublish(username)` on success and `AFTER_SHELF_PUBLISH_FAILED` on failure.
- [ ] **Step 3:** On mobile, the three follow sites loop over `AFTER_FOLLOW`. `useFollowBack` (defined at `FeedRow.tsx:38`) loses its `refetch` parameter. Update its only caller, `ActivityScreen.tsx:25`, and delete the comment at `FeedRow.tsx:43-45`. In `MyShelfScreen`, `run` uses the two publish lists in place of its literal keys, passing `user?.username ?? null` (today `:55` falls back to `""`). `keepShelf`'s `["murals"]` stays as it is.
- [ ] **Step 4:** Build shared, then run the shared, web and mobile tests, typecheck and lint. Run `node scripts/gate.mjs`, then commit.

### Task 2: Home picks

**Files:**
- Modify: `packages/shared/src/community/homeModel.ts`
- Test: `packages/shared/src/community/homeModel.test.ts`
- Modify: `mobile/src/features/home/homeModel.ts`
- Test: `mobile/src/features/home/homeModel.test.ts`
- Modify: `mobile/src/features/home/HomeNewGames.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`

**Interfaces:**
- Produces: `readingNow(books: LibraryBook[] | undefined): LibraryBook[]` and `newGameRows(items, locale, viewerId: string | null)`.

- [ ] **Step 1:** Move the `currentRead` ordering cases (`mobile/src/features/home/homeModel.test.ts:23-34`) to shared as `readingNow` cases. The null case (:35-38) stays in mobile. Add the new `null` third argument to the existing `newGameRows` calls (:40-57). Each asserts the full order. Add "returns every reading book". In mobile, add "newGameRows skips the viewer's own games before taking two". Both fail.
- [ ] **Step 2:** Implement `readingNow` in shared. Mobile's `currentRead` becomes `readingNow(books)[0] ?? null`. `newGameRows` filters by `author.userId !== viewerId`, then slices to 2. `HomeNewGames` passes `useAuth().user?.id ?? null`. Web `HomePage.tsx:47-48` uses `readingNow(books)`.
- [ ] **Step 3:** Build shared, then run the tests, typecheck and lint for shared, web and mobile. Run `node scripts/gate.mjs`, then commit.

### Task 3: Community jobs on `createJobs`

**Files:**
- Modify: `backend/src/modules/community/plugin.ts`
- Test: `backend/src/modules/community/archive.test.ts`

- [ ] **Step 1:** Rewrite the timer tests in `archive.test.ts` (:126, :148, :170, :180). Each one, including :126, which uses real timers today, calls `t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })`. Test :170 ticks 110 000 ms, then `await until(...)`. Assert:
  - nothing runs at registration;
  - the archive runs after 100 s and again every 24 h;
  - the recap freeze runs after 110 s and hourly;
  - a failure logs `"community event archive failed"` / `"top shelf recap freeze failed"` and the next run still happens;
  - close stops both.

  They fail.
- [ ] **Step 2:** In `plugin.ts:42-66`, replace the two `setInterval`s and the immediate calls with `createJobs(app.log)` and `jobs.every(...)`, using the names and delays in the spec.
  - Remove the `try/catch` around `archive` (:43-47) and `freezeRecaps` (:53-57), so that `createJobs` does the failure logging.
  - Both return `void`, because a number would be read as `pausedUntil` (`jobs.ts:45`).
  - The `onClose` hook calls `jobs.stopAll()`. Keep the archive success log.
- [ ] **Step 3:** Typecheck and test the backend. Run `node scripts/gate.mjs`, then commit.

### Task 4: Locale store, murals import, username rule

**Files:**
- Create: `packages/shared/src/i18n/localeStore.ts`
- Test: `packages/shared/src/i18n/localeStore.test.ts`
- Modify: `packages/shared/src/i18n/index.ts`
- Modify: `frontend/src/i18n/locale.ts`
- Modify: `mobile/src/i18n/locale.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `packages/shared/src/auth.ts`
- Create: `packages/shared/src/auth.test.ts`
- Modify: `mobile/src/features/you/ProfileHeader.tsx`
- Modify: `mobile/src/app/choose-username.tsx`

**Interfaces:**
- Produces:
  - `createLocaleStore(portugueseEnabled: boolean)`, returning `getLocalePreference`, `setLocalePreference`, `setDeviceLocaleTags`, `subscribeLocale` and `getLocale` with today's signatures;
  - `isValidUsername(username: string): boolean`.

- [ ] **Step 1:** In `localeStore.test.ts`:
  - preference beats device tags;
  - `portugueseEnabled: false` resolves to English;
  - subscribers hear changes;
  - auto preference with `["pt-PT"]` device tags resolves to `en`, today's behaviour (`locale.ts:33-34`);
  - two stores don't share state.

  In the new `auth.test.ts`, test `isValidUsername`: `"ab"` false, `"abc"` true, `"a b c"` false, 31 chars false, `" abc "` true. Both fail.
- [ ] **Step 2:** Move the body of `locale.ts` into `createLocaleStore`. Each client's `locale.ts` becomes `export const { getLocalePreference, setLocalePreference, setDeviceLocaleTags, subscribeLocale, getLocale } = createLocaleStore(PORTUGUESE_ENABLED);`.
- [ ] **Step 3:** Extract `isValidUsername` from `authFieldErrors` and export it. Mobile `ProfileHeader.tsx:85` disables Save on `!isValidUsername(draft)`. In `choose-username.tsx`, `tooShort` (:39) becomes `invalid = !isValidUsername(value)`, used at :39, :71 and :75 (keyboard submit and Continue). Change the import at `community/service.ts:7` to `import type { MuralsPublicApi } from "../murals/index.js"`.
- [ ] **Step 4:** Build shared, then run the tests, typecheck and lint for every touched package. Run `node scripts/gate.mjs`, then commit.

### Task 5: Device pass

- [ ] Dispatch `device-checker`. On mobile Home, check that Currently reading shows the most recent book and that New games doesn't list the fixture user's own games. Following someone from a profile should make their items appear in the circle feed. Saving a username should be disabled for `"a b"`. Fix what it reports inside this lane.
