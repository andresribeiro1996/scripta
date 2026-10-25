# Beta Sweep Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 21 findings of the 2026-10-25 mobile beta sweep, plus two console errors, with web fixed wherever it shares the defect.

**Architecture:** Three PRs in order. Phase 1 fixes bugs and data loss and builds the themed `ConfirmDialog`. Phase 2 fixes dead ends and missing feedback and builds the app-level toast host. Phase 3 does the design-system and copy sweep, using both. Shared logic (reorder steps, quiz labels) goes in `@scripta/shared`. Backend changes are additive (no migration).

**Tech Stack:** Expo/React Native (expo-router, `node --test` via tsx for pure modules), React/Vite web, Fastify/TypeScript backend with per-module SQLite, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-25-beta-sweep-fixes-design.md`. Source report with repro steps and screenshots: `/Users/andreribeiro/Documents/scripta/beta-tests/2026-10-25-0053/report.md`.

## Global Constraints

- Paths below are repo-relative. Mobile code lives in `mobile/src/`; mobile routes in `mobile/src/app/`.
- Product name in user-visible text is **Atmyshelf**. "Scripta" survives only in package names, identifiers and non-user-visible fixtures.
- Sentence case throughout: after Task 18, no `textTransform: "uppercase"` in `mobile/src` and no `uppercase` class in `frontend/src`. Literal uppercase copy ("WINS"/"LOSES") stays.
- Every tappable control has a touch target of at least `minimumTouchTarget` (44pt), via size or `hitSlop`.
- Name inputs cap at **200** characters.
- No comments in code. No new dependencies.
- Mobile tests are pure-module `node --test` files (`*.test.ts`); components are not rendered in tests. Visual behaviour is checked by a `device-checker` pass per phase.
- Verify per package: shared `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`; mobile `npm run typecheck --workspace mobile && npm test --workspace mobile`; frontend `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`; backend `npm run typecheck --workspace backend && npm test --workspace backend`. `node scripts/gate.mjs` runs what a change needs.
- Phase 1 starts from current `origin/main` (bring the branch up to date with the `sync_with_base_branch` tool before Task 1). Phase N+1 branches from phase N's branch. Before `gh pr merge --auto` on a phase N+1 PR, retarget it to `main` once phase N has merged (auto-merge on a non-main base skips CI).

## Review Focus

1. A signed-in quiz player whose profile is unpublished or who hides votes: the public results link and the owner's results show "Reader" (or their typed name), never their username. Pinned in Task 2.
2. A guest reopening a quiz on the same device: the score view still shows correct answers from `getPlay`, and the leaderboard tags them as a guest. Pinned in Task 2.
3. A mural already named over 200 characters, saved by an old installed build that resends the unchanged name with new blocks: the save succeeds. Pinned in Task 7.
4. A new client against a backend without `answers` (cached PWA, deploy in progress): the score screen renders without correct-answer rows instead of throwing. Pinned in Task 3 (shared helper test).
5. Reorder with one series and one standalone book, or a single unit: every arrow that cannot change `orderLibraryBooks` output is disabled. Pinned in Task 1.

---

## Phase 1 — bugs and data loss (PR 1)

### Task 1: Reorder within series and within standalone books (#4)

**Files:**
- Modify: `packages/shared/src/library/libraryOrder.ts`
- Test: `packages/shared/src/library/libraryOrder.test.ts`
- Modify: `mobile/src/features/library/components/ReorderList.tsx`
- Modify: `mobile/src/app/(app)/(library)/reorder.tsx`
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts`

**Interfaces:**
- Produces (in `libraryOrder.ts`; the library index's `export *` already re-exports it):
  - `moveUnit(books: Array<Record<string, unknown>>, groups: Group[], key: string, direction: "up" | "down"): Array<Record<string, unknown>>`. It moves the unit containing `key` past the adjacent unit *of the same kind*: series among series, standalone books among standalone books. Series always render first (`buildUnits`, `:53-85`), and that rule stays. It rewrites `_order` as `reorderOnDrop` does, and returns `books` (same reference) when there is no same-kind neighbour.
  - `unitMoves(books: Array<Record<string, unknown>>, groups: Group[]): Map<string, { up: boolean; down: boolean; inSeries: boolean }>`. One entry per book key; every book of a unit shares its unit's values.

- [ ] **Step 1: Write failing tests** in `libraryOrder.test.ts`. Fixture: two series S (S1, S2) and T (T1), then standalone A, B, C. Assert on `orderLibraryBooks(result, groups)` keys, never on `_order`.
  - `moveUnit(…, "S2", "down")` gives T1, S1, S2, A, B, C.
  - `moveUnit(…, "T1", "up")` gives the same order.
  - `moveUnit(…, "B", "down")` gives S1, S2, T1, A, C, B.
  - `moveUnit(…, "A", "up")` and `moveUnit(…, "T1", "down")` each return the same `books` reference.
  - `unitMoves`:
    - S1 and S2 are `{ up: false, down: true, inSeries: true }`.
    - T1 is `{ up: true, down: false, inSeries: true }`.
    - A is `{ up: false, down: true, inSeries: false }` and C is `{ up: true, down: false, inSeries: false }`.
  - A library of one series and one standalone book gives every arrow `false`.
- [ ] **Step 2: Run** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`. Expected: FAIL, `moveUnit` is not defined.
- [ ] **Step 3: Implement** both in `libraryOrder.ts`, reusing `buildUnits` and the `_order` rewrite from `reorderOnDrop`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Wire mobile.**
  - `reorder.tsx` (`:14-22`) passes `groups` to `ReorderList`.
  - `ReorderList` takes `groups: Group[]` and `onMove: (key: string, direction: "up" | "down") => void`, and enables the arrows from `unitMoves`.
  - A series row shows a `caption` `text-dim` line under its title: "Series stay at the top and move together."
  - The caller in `useLibraryActions.ts` calls `moveUnit`. Web drag-and-drop stays on `reorderOnDrop`.
- [ ] **Step 6: Mobile verify.** Expected: typecheck and tests pass.
- [ ] **Step 7: Commit.** "Move reorder arrows within series and within standalone books"

### Task 2: Quiz backend: names, anonymous flag, correct answers (#6)

**Files:**
- Modify: `packages/shared/src/quizzes/types.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Modify: `backend/src/modules/quizzes/routes.ts`
- Modify: `backend/src/modules/quizzes/plugin.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/quizzes/service.test.ts`
- Test: `backend/src/modules/quizzes/routes.test.ts`
- Test: `backend/src/modules/community/service.test.ts`

**Interfaces:**
- Produces (shared types):
  - `ResultPlay` gains `anonymous: boolean`. `PublicResultPlay` inherits it.
  - `PlayResponse` gains `answers?: Record<string, { choiceIndex: number; answerIndex: number }>`, keyed by question id. It is optional so a new client survives an old backend.
- Produces (backend):
  - `PlayOutcome`'s ok branch (`service.ts:51`) gains `answers` too. `sendPlayOutcome` (`routes.ts:217`) passes it through.
  - `CommunityPublicApi.nameableUsernames(userIds: string[]): Map<string, string>`. It keeps only users passing `canNameAsParticipant` (`community/domain/visibility.ts:20`, via `createVisibility(repo, null)`), then maps each to its username via the profile resolver the community service already receives.
  - `QuizzesPluginOptions.resolveUsernames?: (userIds: string[]) => Map<string, string>`, the new last parameter of `createQuizzesService`. `app.ts` wires it to `getCommunityPublicApi().nameableUsernames`; `getQuizzesPublicApi()` passes nothing.
- Display rule for `toResultPlay`:
  - A user in the map shows their username.
  - Otherwise a stored `player_name` shows as typed.
  - Otherwise a signed-in player gets `"Reader"` and a guest gets `null` (clients render "Guest").
  - `anonymous` is `voter_user_id === null`.

- [ ] **Step 1: Write failing tests.**
  - Community: `nameableUsernames` names a published user with votes shown. It omits an unpublished user and one with `show_votes = 0`.
  - Quizzes service, with a resolver stub:
    - `getResults` names a nameable signed-in player with no typed name `{ playerName: "alice", anonymous: false }`.
    - A non-nameable signed-in player gives `{ playerName: "Reader", anonymous: false }`.
    - A guest gives `{ playerName: <typed or null>, anonymous: true }`.
    - After the stub renames alice to "alice2", the result reads "alice2".
    - `getPublicResults` carries the same names and `anonymous`, and still omits `playId`.
    - `submitPlay` and `getPlay` (user, and guest by `playId`) return `answers[qid]` with the submitted `choiceIndex` and the question's `answerIndex`.
  - Routes:
    - The board `GET /quizzes/voting/:code` body contains neither `answerIndex` nor `answers`.
    - The play POST response includes `answers`.
- [ ] **Step 2: Run** `npm run build --workspace @scripta/shared && npm test --workspace backend`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the types, `nameableUsernames`, the plugin option and wiring, `toResultPlay` with the name map, and `answers` in `submitPlay`, `getPlay` and `sendPlayOutcome`.
- [ ] **Step 4: Backend verify.** Expected: PASS. Fix `ResultPlay` literals in frontend and mobile test fixtures if their typecheck now fails.
- [ ] **Step 5: Commit.** "Name visible quiz players, tag anonymous plays and return correct answers after a play"

### Task 3: Quiz labels and mobile quiz screens (#6)

**Files:**
- Create: `packages/shared/src/quizzes/labels.ts`
- Test: `packages/shared/src/quizzes/labels.test.ts`
- Modify: `packages/shared/src/quizzes/index.ts`
- Modify: `mobile/src/features/home/feedRowModel.ts`
- Test: `mobile/src/features/home/feedRowModel.test.ts`
- Modify: `mobile/src/app/(app)/(home,arena)/quiz/[id].tsx`
- Modify: `mobile/src/features/quizzes/QuizEditorScreen.tsx`
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx`

**Interfaces:**
- Consumes: Task 2's `ResultPlay.anonymous` and `PlayResponse.answers`.
- Produces (shared):
  - `quizQuestionLabel(question: QuizQuestion, index: number, books: QuizBook[]): string` returns `"Q{index+1} · {title}"`, where `title` is the book the question is about (`question.workId`), or just `"Q{index+1}"` when unknown. This is a spec refinement: a prompt can be a cover URL or a long quote, so the subject book's title is the label.
  - `quizOptionLabel(type: QuizQuestionType, option: string, books: Array<{ title: string; coverUrl?: string | null }>): string` returns the option text. For `title_cover`, whose options are cover URLs, it returns the title of the book with that cover, or "Unknown book". This is for the owner view, which has `current.data.books`.
  - `scoreRows(questions: PublicQuizQuestion[], correct: Record<string, boolean>, answers: PlayResponse["answers"]): Array<{ id: string; number: number; correct: boolean; answer?: { kind: "text" | "cover"; value: string; title?: string }; pick?: { kind: "text" | "cover"; value: string } }>`. This is the player view. The board carries no books, so for `title_cover` the answer is the cover `options[answerIndex]` with `title: question.prompt`, and a wrong pick is the picked cover. Other types return text options. When `answers` is undefined it returns rows without `answer` and `pick`.
  - `playerLabel(play: { playerName: string | null; anonymous: boolean }): { name: string; guest: boolean }`: `name` falls back to "Guest".

- [ ] **Step 1: Write failing shared tests** for the four helpers:
  - `quizQuestionLabel` at index 0 gives "Q1 · Dune".
  - Unknown work gives "Q3".
  - `title_cover` option maps a URL to its title.
  - `playerLabel({ playerName: null, anonymous: true })` gives `{ name: "Guest", guest: true }`, and `{ playerName: "Reader", anonymous: false }` gives `{ name: "Reader", guest: false }`.
  - `scoreRows`:
    - A wrong `title_cover` answer gives `answer: { kind: "cover", value: <correct url>, title: <prompt> }` and `pick: { kind: "cover", value: <picked url> }`.
    - A right `cover_title` answer has `answer` and no `pick`.
    - `answers: undefined` gives rows with only `id`, `number` and `correct`.
- [ ] **Step 2: Update the mobile test** at `feedRowModel.test.ts:146`: `digestRoute` for a quiz participation item returns `/quiz/g1?view=results`. Tier list stays `/tierlist/<id>`.
- [ ] **Step 3: Run** shared and mobile tests. Expected: FAIL.
- [ ] **Step 4: Implement the helpers and `digestRoute`.**
- [ ] **Step 5: Owner results.**
  - The quiz route reads `view` from `useLocalSearchParams` and passes `initialView?: EditorView` to `QuizEditorScreen`, whose `useState` uses it.
  - Stats rows render `quizQuestionLabel`. Pick rows render `quizOptionLabel`, using `current.data.questions` and `current.data.books`.
  - Leaderboard rows render `playerLabel`, with a small `text-dim` "guest" tag when `guest`.
- [ ] **Step 6: Player score view** (`QuizPlayScreen.tsx:176-181`).
  - Render `scoreRows`: number, tick or cross, then the answer.
  - A text answer shows as text. A cover answer shows as a small cover image with `title` beside it when present.
  - A wrong answer also shows the pick.
  - The leaderboard uses `playerLabel` and the guest tag.
- [ ] **Step 7: Mobile verify.** Expected: PASS.
- [ ] **Step 8: Commit.** "Label quiz results by question, book and player, and show players the right answers"

### Task 4: Web quiz screens (#6)

**Files:**
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`

**Interfaces:**
- Consumes: Task 3's shared helpers and Task 2's types.

- [ ] **Step 1:** In `QuizEditorPage.tsx`:
  - Replace the raw `questionId` (`:311`) with `quizQuestionLabel`.
  - Replace pick numbers with `quizOptionLabel`.
  - Replace "Guest" fallbacks (`:296`) with `playerLabel` plus a guest tag.
- [ ] **Step 2:** In `PlayQuizPage.tsx`:
  - The leaderboard (`:269`) uses `playerLabel`.
  - The player's own result renders `scoreRows` as in Task 3 Step 6.
- [ ] **Step 3: Frontend verify.** Expected: PASS.
- [ ] **Step 4: Browser check** (built-in browser against the local stack): play a quiz to the score view and open the owner results. Screenshot both.
- [ ] **Step 5: Commit.** "Show quiz question labels, player names and correct answers on web"

### Task 5: Themed confirm and unsaved-changes guard (#1)

**Files:**
- Modify: `mobile/src/ui/components.tsx`
- Create: `mobile/src/ui/useUnsavedChangesGuard.tsx`
- Modify: `mobile/src/ui/index.ts`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`
- Modify: `mobile/src/features/tierlists/TierlistEditorScreen.tsx`
- Modify: `mobile/src/features/quizzes/QuizEditorScreen.tsx`
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx`

**Interfaces:**
- Produces:
  - `ConfirmDialog(props: { visible: boolean; title: string; body?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean; loading?: boolean; onConfirm: () => void; onCancel: () => void }): ReactElement`, built on `Dialog`, laid out like the delete dialog at `features/arena/ArenaHomeScreen.tsx:125`. `cancelLabel` defaults to "Cancel".
  - `useUnsavedChangesGuard(unsaved: boolean, copy?: { title: string; body: string; confirmLabel: string; cancelLabel: string }): ReactElement`. It wraps `usePreventRemove` from `expo-router/react-navigation`. On a blocked leave it shows a `ConfirmDialog` and returns that element for the screen to render. Confirm dispatches the blocked action; cancel stays. Default copy:
    - title "Discard changes?"
    - body "Your unsaved changes will be lost."
    - confirm "Discard" (destructive)
    - cancel "Keep editing"

- [ ] **Step 1: Implement** `ConfirmDialog` in `components.tsx` and the hook. Export both from `ui/index.ts`.
- [ ] **Step 2: Wire the editors.**
  - Mural (`unsaved`, `:122`), tier list (`dirty`, `:119`) and quiz editor (`dirty`, `:97`) each call the hook above every early return and render its element.
  - `QuizPlayScreen` swaps its `Alert.alert` guard (`:67-72`) for the hook with its existing copy: "Leave this quiz?", "Your answers so far won't be saved.", "Leave", "Keep playing".
The web mural editor saves every change as it happens and needs no guard.

- [ ] **Step 3: Mobile verify.** Expected: PASS.
- [ ] **Step 4: Device check** (`device-checker`):
  - Rename a mural and press Android back: the dialog shows, "Keep editing" stays, "Discard" leaves.
  - Save, then press back: no dialog.
  - Repeat once in the tier list editor.
- [ ] **Step 5: Commit.** "Ask before leaving an editor with unsaved changes"

### Task 6: Form and header bugs (#3, #8, #18, #20)

**Files:**
- Modify: `mobile/src/features/settings/SettingsScreen.tsx`
- Modify: `mobile/src/features/sharing/ContentShareSheet.tsx`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`
- Modify: `mobile/src/ui/components.tsx`

- [ ] **Step 1: Username Cancel** (`SettingsScreen.tsx:74`). It runs `setError(null)` and `setDraft(user?.username ?? "")` before `setEditing(false)`.
- [ ] **Step 2: Save image** (`ContentShareSheet.tsx:64`). Wrap only the `requestPermissionsAsync` call. A throw raises the same `Error` message the not-granted branch uses at `:65`.
- [ ] **Step 3: Mural header** (`MuralEditorScreen.tsx:203-232`). Render the `<Stack.Screen options={{ title: "" … }}>` element in the loading and error branches too, sharing one element with the loaded branch.
- [ ] **Step 4: Input hint.** Render the hint only when there is no error: `{hint && !error ? … : null}` in `Input` (`components.tsx`, defined at `:335`).
- [ ] **Step 5: Mobile verify.** Expected: PASS.
- [ ] **Step 6: Commit.** "Clear the username error on cancel, replace hints with errors, and hide raw route and native error text"

### Task 7: Name length caps (#12)

**Files:**
- Modify: `backend/src/modules/murals/routes.ts`
- Modify: `backend/src/modules/murals/service.ts`
- Modify: `backend/src/modules/murals/domain/errors.ts`
- Test: `backend/src/modules/murals/routes.test.ts`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`
- Modify: `mobile/src/features/library/LibraryScreen.tsx`
- Modify: `mobile/src/features/library/components/GroupDetail.tsx`
- Modify: `mobile/src/features/library/components/GroupsView.tsx`
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`

**Interfaces:**
- Produces: `MuralNameTooLongError` in `murals/domain/errors.ts`. Routes map it to 400, the way they map `FolderCycleError`.
- Rule:
  - Create (mural and folder) rejects names over 200 at the schema level.
  - `updateMural` and `renameFolder` (`service.ts:112,180`) throw `MuralNameTooLongError` only when the new name is over 200 *and* differs from the stored name. Installed builds resend the unchanged name on every save.

- [ ] **Step 1: Write failing route tests.**
  - Mural create and folder create reject a 201-character name with 400 and accept 200.
  - Update and folder rename reject a new 201-character name with 400.
  - An update sending the unchanged stored 300-character name plus new blocks succeeds (seed the long name through the repository).
  - An update with only `blocks` on that mural succeeds.
- [ ] **Step 2: Run** `npm test --workspace backend`. Expected: the length tests fail.
- [ ] **Step 3: Implement** `.max(200)` on `createMuralSchema.name` and `createFolderSchema.name`, plus the compare-and-throw in the service.
- [ ] **Step 4: Mobile.**
  - `maxLength={200}` on the mural rename (`MuralEditorScreen.tsx:254`), library name (`LibraryScreen.tsx:331`), collection rename (`GroupDetail.tsx:173`) and new-collection field (`GroupsView.tsx`, opened by `startCreating`).
  - The mural save (`MuralEditorScreen.tsx:182`) sends `name` only when it differs from `mural.name`.
- [ ] **Step 5: Web.** `maxLength={200}` on the same fields: mural rename, library name, and collection create and rename.
- [ ] **Step 6: Backend, mobile and frontend verify.** Expected: PASS.
- [ ] **Step 7: Commit.** "Cap mural, library and collection names at 200 characters without breaking saves of old long names"

### Task 8: Tab bar keeps the old theme (#2)

**Files:**
- Modify: `mobile/src/app/(app)/_layout.tsx`

Use the `diagnosing-bugs` skill: build a red repro before any theory.

- [ ] **Step 1: Repro on the emulator** (lease per `docs/dev-workflow.md`, fixture via `node scripts/dev-emulator.mjs`; run `--reset` first, because the last sweep left the dev account dirty).
  - Go to Settings → Appearance → Dark, then Light, and wait 8s.
  - Screenshot: the bar should still be dark. If it doesn't reproduce in three tries, stop and report that instead of changing code.
- [ ] **Step 2: Find the cause.** Check whether the native tab bar re-reads `screenOptions.tabBarStyle` on a theme change. A quick probe is temporarily keying `<Tabs>` on `colors.surface`.
- [ ] **Step 3: Fix** with the smallest change that makes the bar follow the theme without navigating away. Re-keying `<Tabs>` is acceptable only if it doesn't reset the current tab's stack; verify that.
- [ ] **Step 4: Repro again.** Expected: the bar turns light within a second, and the current tab and its stack are unchanged.
- [ ] **Step 5: Mobile verify, then commit.** "Make the tab bar follow a theme change immediately"

### Task 9: Console errors (require cycle, state update before mount)

**Files:**
- Modify: `packages/shared/src/library/merge.ts`
- Modify: `packages/shared/src/library/catalogGenres.ts`
- Modify: `packages/shared/src/library/bookGenres.ts`
- Modify: `packages/shared/src/library/dedupe.ts`
- Modify: `packages/shared/src/library/bookSearch.ts`
- Test: `packages/shared/src/library/catalogGenres.test.ts`
- Modify: `mobile/src/features/settings/appearanceSync.ts`

- [ ] **Step 1: Move `GENRES_FROM_CATALOG`** from `catalogGenres.ts` to `bookGenres.ts`. Every importer (`merge.ts`, `dedupe.ts`, `bookSearch.ts`, `catalogGenres.test.ts`, `catalogGenres.ts` itself) imports it from `bookGenres.ts`. Do not re-export it from `catalogGenres.ts`: the index's `export *` of both modules would make it ambiguous (TS2308).
- [ ] **Step 2: Shared verify.** Expected: PASS. Metro no longer logs the merge ↔ catalogGenres require cycle.
- [ ] **Step 3: The state-update error.**
  - Sign up a fresh account on the emulator, cold-restart, and watch `adb logcat -s ReactNativeJS:E`.
  - If "Can't perform a React state update on a component that hasn't mounted yet" appears, find the setter. The candidate is `useAccountAppearanceSync` (`appearanceSync.ts:28-42`); fix it with a cancelled flag in that effect.
  - If it doesn't appear in three tries, change nothing and say so in the PR body.
- [ ] **Step 4: Commit.** "Break the merge/catalogGenres require cycle" (plus the appearance-sync fix if Step 3 found it)

### Phase 1 close

- [ ] `device-checker` pass on Tasks 1, 3, 5, 6 screens (reorder sheet, quiz results and score, editors, settings username, mural loading header, sign-up errors).
- [ ] Run the `security-review` skill (Task 2 changes who is named on public results).
- [ ] `branch-reviewer` plus `node scripts/codex-review.mjs branch docs/superpowers/specs/2026-10-25-beta-sweep-fixes-design.md docs/superpowers/plans/2026-10-25-beta-sweep-fixes.md`, in parallel.
- [ ] Ship PR 1 (`ship` skill), with auto-merge.

---

## Phase 2 — dead ends and feedback (PR 2)

### Task 10: App-level toast host

**Files:**
- Create: `mobile/src/ui/ToastHost.tsx`
- Modify: `mobile/src/ui/index.ts`
- Modify: `mobile/src/app/_layout.tsx`

**Interfaces:**
- Produces:
  - `ToastProvider({ children }: { children: ReactNode }): ReactElement`, mounted once in `app/_layout.tsx` inside the theme provider.
  - `useToast(): { show(message: string, tone?: "default" | "error" | "success"): void }`. It renders the existing `Toast` (`ui/components.tsx:727`) above all content. A new `show` replaces the current message. Auto-hide after 5000ms, matching web's `Toaster` (`frontend/src/components/Toaster.tsx:32`). The host renders under RN `Modal`s, so callers must not `show` while a `Dialog`, `Sheet` or `ConfirmDialog` is open.

- [ ] **Step 1: Implement.** Mount it in `app/_layout.tsx`.
- [ ] **Step 2: Mobile verify.** Expected: PASS.
- [ ] **Step 3: Commit.** "Add an app-level toast host"

### Task 11: Add-to-library feedback (#9)

**Files:**
- Modify: `mobile/src/features/library/components/AddBookForm.tsx`
- Modify: `mobile/src/features/community/AddBookSheet.tsx`
- Modify: `mobile/src/features/search/searchModel.ts`
- Test: `mobile/src/features/search/searchModel.test.ts`

**Interfaces:**
- Consumes: `useToast` (Task 10).
- Produces: `ownedEntry(candidate: Book, books: Array<Record<string, unknown>>): Record<string, unknown> | undefined` in `searchModel.ts`, the library entry `isCertainMatch` (`packages/shared/src/library/bookMatch.ts:91`) pairs with the candidate. It is the same rule the server's `addBook` uses (`backend/src/modules/library/service.ts:455`).

- [ ] **Step 1: Reproduce on the emulator** before changing UI. Use the add sheet from fixture_alice's profile library (1984, already on To read) and from a Search result. Record whether the existing in-sheet toast (`AddBookSheet.tsx:57-70`) appears, and for how long before the sheet closes.
- [ ] **Step 2: Write failing tests** for `ownedEntry`:
  - An ISBN match.
  - A hand-added book with no ISBN, matched the way `isCertainMatch` matches.
  - A different edition of the same work that `isCertainMatch` rejects returns undefined.
- [ ] **Step 3: Run** `npm test --workspace mobile`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - `ownedEntry` comes first. Use it for the owned filter in `mergeBookResults` (`searchModel.ts:134`), so owned results keep moving to the library section but by the server's rule.
  - `AddBookSheet`:
    - When `ownedEntry` finds the book, the heading reads "Update status" with the entry's status preselected. It still uses the existing add call; the server re-shelves and reports `updated`.
    - It invalidates the library query after every add or update, dropping the `status !== 2` condition at `:57`.
    - It keeps its in-sheet `Toast`. If Step 1 showed it was cut short, hold the close until the toast has shown for 1.6s.
  - `AddBookForm` calls `useToast().show("Added to your library", "success")` right before `router.back()` (`:132-135`), after its sheet is gone.
- [ ] **Step 5: Mobile verify.** Expected: PASS.
- [ ] **Step 6: Device check.**
  - Add "Dune" from Search: it leaves the results for the library section at once.
  - Open 1984 from fixture_alice: the sheet reads "Update status".
  - Add by hand: the toast shows.
- [ ] **Step 7: Commit.** "Confirm book adds and recognise books already in the library by the server's match rule"

### Task 12: Say why a control is disabled (#5, #10)

**Files:**
- Modify: `mobile/src/features/library/components/AddBookForm.tsx`
- Modify: `mobile/src/features/arena/ArenaSeedScreen.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`

- [ ] **Step 1: Add book.** The Title and Author labels read "Title (required)" and "Author (required)". While the button is disabled, a `caption` `text-dim` line under it reads "Add a title and an author to continue."
- [ ] **Step 2: Tournament.**
  - Under Start (`ArenaSeedScreen.tsx:153`), while it's disabled: "Fill every slot to start."
  - Under Random fill (`:151`) when the library is empty: "Random fill needs books in your library."
- [ ] **Step 3: Mural picker.**
  - `MuralPicker` (`ProfileScreen.tsx:248-300`) with zero murals renders `EmptyState` (title "No murals yet", action "Create a mural"), and the action creates a mural the way `features/murals/MuralsScreen.tsx` does and opens it.
  - The disabled "Use this mural" button is hidden in that state.
- [ ] **Step 4: Mobile verify, then commit.** "Explain disabled add and start buttons and give the empty mural picker a way out"

### Task 13: Game card menu and mural delete copy (#11)

**Files:**
- Modify: `mobile/src/features/community/DiscoverRow.tsx`
- Modify: `mobile/src/features/arena/ArenaHomeScreen.tsx`
- Modify: `mobile/src/features/murals/MuralsScreen.tsx`

- [ ] **Step 1: Game card menu.**
  - `GameRow` already takes `onDelete` (`DiscoverRow.tsx:77`). When it is set, also render a trailing `Menu` (`ui/components.tsx:699`) with an `IconButton name="more"` trigger (as at `features/tierlists/TierlistEditorScreen.tsx:146`) and one destructive item, "Delete…", calling `onDelete`.
  - The trigger has a 44pt target and the accessibility label `More actions for {name}`. Keep `onLongPress` and the accessibility action.
- [ ] **Step 2: Mural delete copy.** The delete confirm body (`MuralsScreen.tsx:125`) reads "This can't be undone." plus, when the mural has a public link: "Its public link will stop working."
- [ ] **Step 3: Mobile verify, then commit.** "Add a visible delete menu to game cards and name what deleting a mural breaks"

### Task 14: Top Shelf floating filters (#21)

**Files:**
- Modify: `mobile/src/features/topShelf/TopShelfScreen.tsx`
- Modify: `mobile/src/features/topShelf/TopShelfBar.tsx`

Use the `diagnosing-bugs` skill.

- [ ] **Step 1: Repro on the emulator at 320dp width.**
  - Open Games, then the trophy. Screenshot at rest and after a scroll.
  - Log `barHeight` from `TopShelfBar` `onLayout` (`:44`) against the measured overlap.
- [ ] **Step 2: Fix the overlap** so the last content clears the bar at rest. Either pad by the true height (wrapped row plus tab bar and safe-area inset), or render the bar as the scroll view's sticky header instead of an overlay (`ui/ScrollDock.tsx`).
- [ ] **Step 3: Fix the swipe.** A vertical drag starting on the bar or a carousel scrolls the page (`nestedScrollEnabled` on the horizontal lists; the bar not intercepting vertical pans).
- [ ] **Step 4: Repro again.** Expected: no content under the bar at rest, and both drags scroll.
- [ ] **Step 5: Mobile verify, then commit.** "Keep Top Shelf content clear of its filter bar and let drags on it scroll"

### Phase 2 close

- [ ] `device-checker` on Tasks 11–14 screens.
- [ ] `branch-reviewer` plus codex review, in parallel.
- [ ] Ship PR 2 (retarget to `main` after PR 1 merges, then auto-merge).

---

## Phase 3 — design system and copy (PR 3)

### Task 15: Touch targets (#7, #13)

**Files:**
- Modify: `mobile/src/features/quizzes/QuizCreateScreen.tsx`
- Modify: `mobile/src/features/quizzes/QuizEditorScreen.tsx`
- Modify: `mobile/src/features/arena/BracketRounds.tsx`

- [ ] **Step 1: Quiz chips.** The `length` style (`QuizCreateScreen.tsx:199`, `QuizEditorScreen.tsx:177`) gets `minHeight: minimumTouchTarget` and centred content.
- [ ] **Step 2: Bracket round markers** (`BracketRounds.tsx:355-360`). The Pressable becomes `minimumTouchTarget` square with the 14dp dot centred; adjust `rail` (`:401`) so the dot stays on the line. Settle (`:197`): `hitSlop` large enough that height plus slop reaches 44.
- [ ] **Step 3: Mobile verify, then commit.** "Bring quiz chips and bracket markers up to 44pt targets"

### Task 16: Labelled Save and Gallery upload (#14)

**Files:**
- Modify: `mobile/src/ui/components.tsx`
- Modify: `mobile/src/features/gallery/GalleryScreen.tsx`

- [ ] **Step 1: Save button.** `SaveStateButton` renders `IconButton` with `framed` and `label`: "Save" (accent tone, save icon) while unsaved, "Saving…" while busy, "Saved" (confirm icon, disabled) otherwise. If `IconButton` has no `label`/`framed` props, check DESIGN.md "Headers" and add them as described there.
- [ ] **Step 2: Gallery.** The header action (`:101`) gets `label="Upload"` and `framed`. The empty state (`:112`) gets `actionLabel="Upload image"` and `onAction={pickImage}`.
- [ ] **Step 3: Mobile verify, then commit.** "Label the editor save state and the gallery upload action"

### Task 17: Replace native alerts (#15)

**Files:**
- Modify: `mobile/src/features/settings/SettingsScreen.tsx`
- Modify: `mobile/src/features/gallery/GalleryScreen.tsx`
- Modify: `mobile/src/features/library/LibraryScreen.tsx`
- Modify: `mobile/src/features/library/components/GroupDetail.tsx`
- Modify: `mobile/src/features/library/components/ShareSheet.tsx`
- Modify: `mobile/src/features/library/components/CoverPicker.tsx`
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `mobile/src/features/arena/ArenaViewScreen.tsx`
- Modify: `mobile/src/features/socials/SocialsSection.tsx`
- Modify: `mobile/src/features/murals/MuralsScreen.tsx`
- Modify: `mobile/src/app/account-security.tsx`
- Modify: `mobile/src/app/(app)/(library)/style.tsx`
- Modify: `mobile/src/features/library/components/GroupsView.tsx`
- Modify: `mobile/src/features/library/components/DuplicatesSheet.tsx`
- Modify: `mobile/src/features/library/FinishedScreen.tsx`
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts`
- Modify: `mobile/src/features/socials/ShareActions.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 5), `useToast` (Task 10).

- [ ] **Step 1: Confirms.** Each `Alert.alert` confirm becomes a `ConfirmDialog` driven by local state, with the same title, body and button labels, and `destructive` where the alert used `style: "destructive"`. The spec lists the 13 sites; `QuizPlayScreen` was already done in Task 5.
- [ ] **Step 2: Errors and notices.**
  - Each `Alert.alert` that reports an error or a result calls `useToast().show(message, tone)` instead: tone "error" for failures, "success" for "Posted". The 17 sites are listed in the spec.
  - `useLibraryActions` gets `show` from `useToast()` inside the hook.
  - A failure inside an open `ConfirmDialog`, `Dialog` or `Sheet` is shown inline in it, or the dialog closes before `show`: the host renders under RN `Modal`.
- [ ] **Step 3: Check.** `rg -n "Alert\.alert|from \"react-native\".*Alert" mobile/src`. Expected: no matches.
- [ ] **Step 4: Mobile verify.** Expected: PASS.
- [ ] **Step 5: Device check.** In Dark theme:
  - Sign out: the themed dialog shows.
  - Delete a collection: the themed dialog shows.
  - Force a save failure (airplane mode, then rename a collection): a toast shows.
  - A confirmed delete fails offline: the error is visible.
- [ ] **Step 6: Commit.** "Replace native alerts with themed dialogs and toasts"

### Task 18: Sentence case everywhere (#19)

**Files:**
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Modify: `frontend/src/components/murals/blocks/MiscBlocks.tsx`
- Modify: `frontend/src/components/murals/blocks/BookBlocks.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/pages/MuralsListPage.tsx`
- Modify: `frontend/src/components/ProfileActivity.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/components/FinishSheet.tsx`
- Modify: `frontend/src/components/StyleControls.tsx`
- Modify: `frontend/src/components/arena/BracketMap.tsx`
- Modify: `frontend/src/components/arena/BracketTree.tsx`
- Modify: `frontend/src/components/landing/TournamentBracket.tsx`
- Modify: `frontend/src/components/landing/ReaderCardPreview.tsx`
- Modify: `DESIGN.md`

- [ ] **Step 1: Mobile.** Remove `textTransform: "uppercase"` and `letterSpacing` from `genreLabel` (`MuralCanvas.tsx:566`).
- [ ] **Step 2: Web.**
  - Remove every `uppercase` class and its paired `tracking-*` class in the files above.
  - Where the source text is not already sentence case (for example "vs", "Search", "Sort"), leave it as written.
  - Then `rg -n "\buppercase\b" frontend/src`. Expected: no matches.
- [ ] **Step 3: DESIGN.md:136.** Change "eyebrow headings (`text-dim`, uppercase)" to "eyebrow headings (`text-dim`, sentence case)".
- [ ] **Step 4: Mobile and frontend verify.**
- [ ] **Step 5: Browser check** of a mural and the profile page. Screenshot.
- [ ] **Step 6: Commit.** "Use sentence case for every label, mobile and web"

### Task 19: One name per action, and Atmyshelf (#16, #17)

**Files:**
- Modify: `mobile/src/features/library/LibraryScreen.tsx`
- Modify: `mobile/src/app/(app)/(home,library,search,you)/import.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/features/quizzes/QuizCreateScreen.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `mobile/src/features/topShelf/recapModel.ts`
- Test: `mobile/src/features/topShelf/recapModel.test.ts`
- Modify: `mobile/src/features/topShelf/RecapCard.tsx`
- Modify: `packages/shared/src/works/labels.ts`
- Test: `packages/shared/src/works/bookScreen.test.ts`
- Modify: `backend/src/modules/library/domain/sizeLimit.ts`
- Test: `backend/src/modules/library/import/parseImport.test.ts`
- Test: `backend/src/modules/library/routes.test.ts`

- [ ] **Step 1: Update tests first.**
  - `recapModel.test.ts:17,33,36` expect "October on Atmyshelf", "Join in on Atmyshelf" and "See <title> on Atmyshelf".
  - `bookScreen.test.ts:89` expects "Tier list · Atmyshelf".
  - `parseImport.test.ts` (174, 214, 225, 360, 373) and `library/routes.test.ts:31` expect "the most Atmyshelf can store".
- [ ] **Step 2: Run** shared, mobile and backend tests. Expected: FAIL.
- [ ] **Step 3: Rename.**
  - `recapModel.ts:18,38,40`, `RecapCard.tsx:96` (`accessibilityLabel="Atmyshelf"`), `labels.ts:17` and `sizeLimit.ts:8,12`.
  - Then `rg -n "Scripta" mobile/src frontend/src backend/src -g '!*.test.*'`, and change any user-visible string it finds (including backend error messages a client displays). Leave package names and identifiers.
- [ ] **Step 4: Action names.**
  - Library button `:224` reads "Import library".
  - Library menu `:142` reads "Import library…" (menus keep an ellipsis for actions that open a sheet, if the app's other menu items do; check them).
  - The import sheet title (`import.tsx:11`) is always "Import library".
  - `MyShelfScreen.tsx:225` reads "Add a book".
  - In `HomeScreen.tsx:45,53`, only "Import library" stays a filled accent button; "Find readers" uses the secondary variant.
  - `QuizCreateScreen.tsx:158` says "in your library".
  - Web: the same names at `OwnShelfView.tsx:216`, `HomePage.tsx` and `LibraryPage.tsx:341`.
- [ ] **Step 5: Shared, mobile, frontend and backend verify.** Expected: PASS.
- [ ] **Step 6: Commit.** "Name each action once and call the product Atmyshelf"

### Phase 3 close

- [ ] `device-checker` on Tasks 15–19 screens, in Light and Dark. Browser check of the web strings changed in Task 19.
- [ ] `branch-reviewer` plus codex review, in parallel.
- [ ] Ship PR 3 (retarget to `main` after PR 2 merges, then auto-merge).
- [ ] Hand the user one batch-deploy runbook entry: deploy after all three merge. No production commands, env vars or migrations are needed. Mobile fixes reach phones only by OTA (CI minutes out until 11-01) or a store build on request.
