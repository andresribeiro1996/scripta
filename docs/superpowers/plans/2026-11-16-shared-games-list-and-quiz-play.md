# Shared Games List and Quiz Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web and mobile render tournament status, game stage, game-list sections and search, and quiz play stages from one `@scripta/shared` implementation.

**Architecture:** Mobile's pure modules (`arenaHome.ts` status, stage and sections; `quizPlay.ts`) move into `packages/shared/src/arena/gamesList.ts` and `packages/shared/src/quizzes/play.ts`. Both clients call them. Presentation, including each client's quiz colours, stays per client.

**Tech Stack:** TypeScript, React (web), React Native/Expo (mobile), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-shared-games-list-and-quiz-play-design.md`

**Base:** `main`. This lane touches:
- shared `arena/` and `quizzes/`, plus the shared i18n catalogues;
- the web arena and quiz pages and components;
- mobile `features/arena` and `features/quizzes`.

## Global Constraints

- No comments in code.
- Copied or moved tests keep their assertions. Fixtures become structural objects instead of client API types.
- Shared is consumed from `dist/`, so run `npm run build --workspace @scripta/shared` before web or mobile tests.
- Shared and mobile tests are globbed (`src/**/*.test.ts`), and so are web tests (`frontend/scripts/test-*.mts`).
- New i18n keys go in both `en` and `pt-PT`. The catalogue checks must pass.
- Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **Active tournament with no round:** when `currentRound` is 0 or missing, the badge reads "In progress", not "Round 0". Task 3.
- **Quizzes tab:** has no voted section on either client. Task 3.
- **Web quiz play while the own-play lookup is in flight:** shows loading, not the questions. When no lookup runs (no plays yet, or an anonymous player with no stored id), it does not wait. Task 2.
- **Web quiz play when the lookup fails with a non-404:** shows a retry, never the questions. Task 2.
- **A signed-in player's 404:** removes no stored id. Task 2.
- **Web search after a tab change:** starts empty. Task 4.

---

### Task 1: Shared quiz play; mobile on it

**Files:**
- Create: `packages/shared/src/quizzes/play.ts`
- Test: `packages/shared/src/quizzes/play.test.ts`
- Modify: `packages/shared/src/quizzes/index.ts`
- Modify: `mobile/src/features/quizzes/quizPlay.ts`
- Test: `mobile/src/features/quizzes/quizPlay.test.ts`
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx`

**Interfaces:**
- Produces: `buildSubmission`, `isComplete`, `nextIndex`, `playStage` and `type PlayStage`, with today's mobile signatures (`quizPlay.ts:9-38`).

- [ ] **Step 1:** Move the `buildSubmission`, `isComplete`, `nextIndex` and `playStage` cases from `mobile/src/features/quizzes/quizPlay.test.ts:12-41` into `play.test.ts`, then run it and watch it fail.
- [ ] **Step 2:** Move the four functions into `play.ts` verbatim and export them from `quizzes/index.ts`. `quizPlay.ts` keeps only `playStorageKey`, and its test keeps only that case. `QuizPlayScreen.tsx` imports the four from `@scripta/shared`.
- [ ] **Step 3:** Build shared, then run the shared and mobile tests and the mobile typecheck. Run `node scripts/gate.mjs`, then commit.

### Task 2: Web quiz play on shared

**Files:**
- Modify: `frontend/src/pages/PlayQuizPage.tsx`
- Modify: `frontend/src/hooks/useQuizPlay.ts`
- Delete: `frontend/src/lib/quizPlayStage.ts`
- Delete: `frontend/scripts/test-quiz-play-stage.mts`
- Test: `packages/shared/src/quizzes/play.test.ts`
- Modify: `frontend/src/i18n/messages/en/quizzes.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/quizzes.ts`

**Interfaces:**
- Consumes: Task 1's `playStage`, `isComplete`, `buildSubmission` and `nextIndex`.
- `useQuizPlay` returns `lookupEnabled: boolean` along with what it returns today.

- [ ] **Step 1:** Port the cases in `test-quiz-play-stage.mts` into `play.test.ts` under the shared stage names, with `result` becoming `played`. Drop the case at `:9` ("pending → playing"), because the new rule inverts it. Add "open quiz, lookup unresolved → loading". Delete the web test file.
- [ ] **Step 2:** In `useQuizPlay.ts`:
  - Enable the play lookup only when `board.data.playCount > 0 && (signedIn || playId !== null)`, as `QuizPlayScreen.tsx:49` does. Return that flag as `lookupEnabled`.
  - When an anonymous player's lookup (`!signedIn && playId`) fails with an `ApiError` whose status is 404, remove `quiz-play-${code}` from `localStorage`. `playId` is re-read from `localStorage` on each render, so the next render disables the lookup. Signed-in players and other errors remove nothing.
- [ ] **Step 3:** In `PlayQuizPage.tsx`, replace both `quizPlayStage` calls (`:90`, which starts the clock, and `:107`) with one
  `playStage({ boardReady: board.isSuccess, boardMissing: board.isError, playOpen, resolved, alreadyPlayed })`, where:
  - `resolved` is `!lookupEnabled || ownPlay.isSuccess || is404(ownPlay.error)`;
  - `alreadyPlayed` is `(submitted ?? ownPlay.data ?? null) !== null`.

  Rendering:
  - "unavailable" renders today's `board.isError` `InfoScreen`.
  - "played" renders where "result" did.
  - A non-404 lookup error renders an `InfoScreen` with a Retry button that calls `ownPlay.refetch()`. Add `quizzes.playLookupFailed` in en and pt-PT, copying the text of mobile's equivalent key from `QuizPlayScreen.tsx:60-64`.

  Replace the inline completeness check (`:68`), submission body and clamp with `isComplete`, `buildSubmission` and `nextIndex`. The 220 ms timeout stays.
- [ ] **Step 4:** Run the frontend typecheck, lint and tests, and the shared tests. Run `node scripts/gate.mjs`, then commit.

### Task 3: Shared games list; mobile on it

**Files:**
- Create: `packages/shared/src/arena/gamesList.ts`
- Test: `packages/shared/src/arena/gamesList.test.ts`
- Modify: `packages/shared/src/arena/index.ts`
- Modify: `packages/shared/src/i18n/messages/en.ts`
- Modify: `packages/shared/src/i18n/messages/pt-PT.ts`
- Modify: `mobile/src/features/arena/arenaHome.ts`
- Test: `mobile/src/features/arena/arenaHome.test.ts`
- Modify: `mobile/src/i18n/messages/en/arena.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/arena.ts`

**Interfaces:**
- Produces:
  - `type Badge = { label: string; tone: ContentTone }`
  - `tournamentBadge(t: { status: "seeding" | "active" | "completed"; currentRound?: number | null }, locale: Locale): Badge`
  - `gameStage(voteCode: string | null, open: boolean): "draft" | "open" | "closed"`
  - `votedTierlistBadges(t: { votingOpen: boolean }, locale: Locale): Badge[]`
  - `gamesSections<O extends { name: string }, V extends { name: string }>(input: { owned: O[]; voted: V[] | null; search: string; owner: "all" | "mine" | "voted" }): { created: O[]; voted: V[] }`

- [ ] **Step 1:** Write fresh `gamesList.test.ts` cases, and watch them fail:
  - Tournament badge:
    - seeding → "Seeding", neutral;
    - active round 2 → "Round 2", accent;
    - active round 0 → "In progress";
    - completed → "Completed".
  - `gameStage`: covers all three stages.
  - `votedTierlistBadges`: open → [Voting open, Voted]; closed → [Closed, Voted].
  - `gamesSections`:
    - search matches owned and voted rows, case-insensitive and trimmed;
    - `voted: null` gives an empty voted list;
    - owner "mine" drops voted;
    - owner "voted" drops owned;
    - order is kept.

  Mobile's `homeSections` and row tests (`arenaHome.test.ts:139-183`, `:232`, `:260`) stay in mobile, because they test mobile headings, targets and row models.
- [ ] **Step 2:** Implement `gamesList.ts`, building it from mobile's `tournamentBadge`, `stage`, the voted badges and `homeSections`' filtering. Add `shared.gamesList.seeding` and `shared.gamesList.round` in en and pt-PT, copying web's `arena.statusSeeding` and `arena.statusRound` text.
- [ ] **Step 3:** `arenaHome.ts` calls the shared functions and deletes its private copies. `homeSections` keeps its section shape and headings, built from `gamesSections`. `QUIZ_STATUS` and `TIERLIST_STATUS` stay, keyed by `gameStage`. `tournamentProgress` and the "Round N of M" caption stay.
  - Update the row expectations at `arenaHome.test.ts:222` and `:226` to "Round 2", accent.
  - Update `:277` (voted tournament, round 1) to "Round 1", accent.
  - Delete the now-unused `arena.seeding` key from both mobile catalogues.
- [ ] **Step 4:** Build shared, then run the shared and mobile tests and the mobile typecheck. Run `node scripts/gate.mjs`, then commit.

### Task 4: Web games list on shared

**Files:**
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/pages/ArenaViewPage.tsx`
- Modify: `frontend/src/components/arena/TournamentStatusBadge.tsx`
- Modify: `frontend/src/components/quizzes/QuizStatusBadge.tsx`
- Modify: `frontend/src/i18n/messages/en/arena.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/arena.ts`
- Test: `frontend/scripts/test-i18n-arena.mts`
- Test: `frontend/scripts/test-i18n-quizzes.mts`
- Create: `frontend/scripts/test-arena-list.mts`

**Interfaces:**
- Consumes: Task 3's exports.

- [ ] **Step 1:** `TournamentStatusBadge` takes `{ status, currentRound }`, renders `tournamentBadge(...)` through the existing `StatusBadge`/`STATUS_TONES` (`GameTicket.tsx:24`), and updates the call site at `ArenaViewPage.tsx:152`. `QuizStatusBadge` computes its stage with `gameStage` and keeps its own colours (`QuizStatusBadge.tsx:13-17`); `quizStatus` is deleted. Delete `arena.statusSeeding`, `arena.statusRound` and `arena.statusActive` from the web catalogues once `rg` shows no other user. In `test-i18n-arena.mts:98`, update "Ativo" to the shared pt-PT "in progress" text. Keep `test-i18n-quizzes.mts:82` passing.
- [ ] **Step 2:** `ArenaListPage` builds each tab's created and voted lists with `gamesSections({ owned, voted, search, owner: "all" })`, passing `voted: null` for quizzes.
  - All three tabs render their filtered lists. The tier-list tab renders filtered rows too, not the unfiltered `tierlists.map` at `:196`.
  - The search field and a "nothing matches" line render on every tab. Today both are tournaments-only, at `:131` and `:173`. Add `arena.searchTierlists` and `arena.searchQuizzes` in en and pt-PT, copying mobile's per-tab search placeholder text if mobile has one, else matching `arena.searchTournaments`' wording.
  - The search clears when the tab changes.
  - Voted tier lists pass `votedTierlistBadges(...)` instead of `badges={null}`.
  - Headings keep today's rules.
- [ ] **Step 3:** In `test-arena-list.mts`, render `ArenaListPage` the way `test-i18n-arena.mts` renders pages. Assert that a search on the tier-lists tab filters both owned and voted rows, and that a voted tier list shows "Voted".
- [ ] **Step 4:** Run the frontend typecheck, lint and tests. Run `node scripts/gate.mjs`, then commit.

### Task 5: Device and browser pass

- [ ] Dispatch `device-checker` on the mobile Games tab. Check that an active tournament's badge reads "Round N" in accent, that search filters voted rows, and that quiz play works for a fresh quiz and for one already played.
- [ ] In the browser pane on the web dev server, check:
  - the arena list's three tabs, including searching each one and the voted-tier-list badges;
  - quiz play for a fresh anonymous player, for a player who already played (no flash of questions), and with a stale stored id (it is removed after one 404).

  Fix what either pass reports, inside this lane.
