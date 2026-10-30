# Daily Chapter: Your chapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-in mobile players a Your chapters screen (stats, calendar, themes, past days with followed players' scores, sharing), Daily Chapter stats on public profiles, and a community Daily Chapter card in the monthly Top Shelf recap.

**Architecture:** All stats maths lives in `@scripta/shared` next to `dailyChapterStats`. The quizzes module serves two new routes (people per edition, a player's summary) and a month-facts function; it learns follows, published flags and profiles through one injected `DailyChapterPeople` dependency wired in `app.ts`, as works gets `readerVisibility`. The community recap appends a `dailyChapter` card only when the client asks with `?daily=1`, computed at read time from closed editions (nothing frozen). Mobile adds two Home-stack routes, a calendar component, a share poster, a profile section and the recap card.

**Tech Stack:** Fastify + node:sqlite (backend), TypeScript shared package, Expo Router / React Native (mobile), `node:test` everywhere.

**Spec:** `docs/superpowers/specs/2026-10-30-daily-chapter-your-chapters-design.md` (mockups: `docs/superpowers/specs/2026-10-30-daily-chapter-your-chapters-mockups/screens.html`)

## Global Constraints

- Mobile only. The website (`frontend/`) gets no UI change. Shared and API changes are additive, so the web keeps working.
- Visibility: another person's Daily Chapter scores are shown only if their profile is published (`readerVisibility(...).published`). Your own are always shown to you. Followers get no exception.
- Never send or render which options another person picked. Other people get squares (`marks: boolean[]`) and a score only.
- Guests (`voter_user_id` starting `daily-guest:`) never appear by name. They do count in the recap's `players` total.
- The poster, the profile section and the recap card show no titles, questions or answers. The one exception is the recap's `hardest.title` and `mostMissed.title`, which are book titles from closed editions.
- Streaks skip dates with no published edition. Only a published edition you didn't play breaks a streak. Today's unplayed edition never breaks one.
- Editions belong to a month by `date.slice(0, 7)` (UTC). Recap facts use only editions with `date < today` (closed).
- The recap's `dailyChapter` card is opt-in through `GET /top-shelf/recaps/:month?daily=1`. Without the parameter the response is unchanged.
- Repo rules: no code comments; new backend `*.test.ts` files go in `backend/package.json`'s `test` list. Run `node scripts/gate.mjs` before each commit (it only sees uncommitted changes).

## Review Focus

1. **Private profile:** a followee with an unpublished profile must not appear in `/daily-chapter/:id/people`, `/daily-chapter/players/:userId` must return `{ summary: null }` for them, and they must not be in recap `topPlayers`. Tests in Tasks 2 and 3.
2. **Viewer hasn't played that edition:** `/daily-chapter/:id/people` returns 403, so people's squares can't hint at today's answers. Test in Task 2.
3. **Schedule gaps and today:** a date with no edition doesn't break the streak or the perfect run, and an unplayed today doesn't either. Test in Task 1.
4. **Guests:** guest plays count in `players` but never appear in `perfect`, `topPlayers` or people lists. Tests in Tasks 2 and 3.
5. **Old clients:** a recap request without `?daily=1` returns exactly the old card kinds. Test in Task 3.

---

### Task 1: Shared stats — streak rule, personal bests, month grid, summary, share text

**Files:**
- Modify: `packages/shared/src/quizzes/dailyChapter.ts`
- Test: `packages/shared/src/quizzes/dailyChapter.test.ts`

**Interfaces:**
- Produces (all exported from `@scripta/shared` via the existing quizzes index):
  - `DailyChapterHistory` gains `editionDates: string[]` (every published edition date up to today, newest first, including dates before `startedOn` so the calendar can tell "missed" from "no edition"), `longestStreak: number`, `longestPerfectRun: number`, `correct: number`, `answered: number`. Streaks, bests and theme stats still count only from `startedOn`.
  - `interface DailyChapterDay { date: string; published: boolean; score: number | null }`
  - `dailyChapterMonth(history: Pick<DailyChapterHistory, "results" | "editionDates">, month: string): DailyChapterDay[]`: every calendar day of `month` (`YYYY-MM`) in order. `published` means the date is in `editionDates`, and `score` is that day's result score or `null`.
  - `dailyChapterThemeRates(themes: DailyChapterThemeStats[]): Array<{ themeId: string; percent: number }>`: themes with `answered > 0`, `percent = Math.round(correct / answered * 100)`, sorted by percent descending, ties by `themeId`.
  - `interface DailyChapterPlayerSummary { streak: number; average: number; perfect: number; bestTheme: { themeId: string; percent: number } | null; month: string; days: DailyChapterDay[] }`
  - `dailyChapterSummary(history: DailyChapterHistory, month: string): DailyChapterPlayerSummary`: `average = Math.round(correct / results.length * 10) / 10`, or 0 with no results. `perfect` is the number of results with score 5. `bestTheme` is the first of `dailyChapterThemeRates`, or `null`. Every screen that shows these three numbers uses this function rather than recomputing them.
  - `dailyChapterMonthShare(summary: DailyChapterPlayerSummary, url: string): string`
  - `interface DailyChapterPerson { userId: string; username: string; avatarUrl: string | null; score: number; marks: boolean[]; you: boolean }`
  - `interface DailyChapterMonthFacts { players: number; hardest: { title: string; date: string; average: number } | null; mostMissed: { title: string; missedPercent: number } | null; perfect: Array<{ userId: string; perfect: number }> }`

- [ ] **Step 1: Write the failing tests** in `dailyChapter.test.ts`, reusing its `result(id, date, score)` helper:

```ts
test("streaks skip dates with no edition and an unplayed today", () => {
  const releases = ["01", "03", "05", "07"].map((day) => ({ id: "e" + day, date: "2030-01-" + day, themeId: "retold-myths" }));
  const played = dailyChapterStats([result("e03", "2030-01-03"), result("e05", "2030-01-05", 4), result("e07", "2030-01-07")], releases, "2030-01-07");
  assert.equal(played.streak, 3);
  assert.equal(played.longestStreak, 3);
  assert.equal(played.longestPerfectRun, 1);
  assert.deepEqual(played.editionDates, ["2030-01-07", "2030-01-05", "2030-01-03", "2030-01-01"]);
  assert.equal(played.correct, 14);
  assert.equal(played.answered, 15);
  const morning = dailyChapterStats([result("e03", "2030-01-03"), result("e05", "2030-01-05")], releases, "2030-01-07");
  assert.equal(morning.streak, 2);
  assert.equal(morning.longestPerfectRun, 2);
});

test("a missed published edition ends the run but the longest one is kept", () => {
  const releases = ["01", "02", "03", "04", "05"].map((day) => ({ id: "e" + day, date: "2030-01-" + day, themeId: "retold-myths" }));
  const history = dailyChapterStats([result("e01", "2030-01-01"), result("e02", "2030-01-02"), result("e03", "2030-01-03"), result("e05", "2030-01-05")], releases, "2030-01-05");
  assert.equal(history.streak, 1);
  assert.equal(history.longestStreak, 3);
  assert.equal(history.longestPerfectRun, 3);
});

test("the month grid separates no edition, missed and played days", () => {
  const releases = ["01", "03", "05"].map((day) => ({ id: "e" + day, date: "2030-01-" + day, themeId: "retold-myths" }));
  const days = dailyChapterMonth(dailyChapterStats([result("e01", "2030-01-01", 3), result("e05", "2030-01-05", 5)], releases, "2030-01-05"), "2030-01");
  assert.equal(days.length, 31);
  assert.deepEqual(days.slice(0, 5), [
    { date: "2030-01-01", published: true, score: 3 },
    { date: "2030-01-02", published: false, score: null },
    { date: "2030-01-03", published: true, score: null },
    { date: "2030-01-04", published: false, score: null },
    { date: "2030-01-05", published: true, score: 5 },
  ]);
});

test("the summary and share text carry numbers and squares only", () => {
  const releases = ["01", "02", "03"].map((day) => ({ id: "e" + day, date: "2030-01-" + day, themeId: "retold-myths" }));
  const summary = dailyChapterSummary(dailyChapterStats([result("e01", "2030-01-01", 5), result("e03", "2030-01-03", 2)], releases, "2030-01-03"), "2030-01");
  assert.equal(summary.average, 3.5);
  assert.equal(summary.perfect, 1);
  assert.deepEqual(summary.bestTheme, { themeId: "retold-myths", percent: 70 });
  const text = dailyChapterMonthShare(summary, "https://example.org/daily");
  assert.equal(text, "The Daily Chapter · January 2030\n🟩⬜🟥\n1-day streak · 3.5 avg\nhttps://example.org/daily");
  assert.ok(!text.includes("Secret passage"));
});

test("theme rates rank strongest first", () => {
  const rates = dailyChapterThemeRates([
    { themeId: "b", eligible: 2, completed: 2, correct: 4, answered: 10, perfect: 0, perfectStreak: 0 },
    { themeId: "a", eligible: 1, completed: 1, correct: 5, answered: 5, perfect: 1, perfectStreak: 1 },
    { themeId: "c", eligible: 1, completed: 0, correct: 0, answered: 0, perfect: 0, perfectStreak: 0 },
  ]);
  assert.deepEqual(rates, [{ themeId: "a", percent: 100 }, { themeId: "b", percent: 40 }]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, because `dailyChapterMonth`, `dailyChapterSummary`, `dailyChapterMonthShare` and `dailyChapterThemeRates` are not exported and `longestStreak` is undefined.

- [ ] **Step 3: Implement** in `dailyChapter.ts`. `streak`, `longestStreak` and `longestPerfectRun` all walk `eligible` (published editions from `startedOn` to today), not calendar dates. Skip today's edition when it is unplayed, and let any other unplayed edition end a run. The existing per-theme `perfectStreak` is unchanged. In the share text, the month name is `recapMonthName(month) + " " + year` (`../topShelf/api.js`). One emoji per published day of the month up to and including the latest published date: score 5 → `🟩`, 3–4 → `🟨`, 0–2 → `🟥`, missed → `⬜`. The second line is `${streak}-day streak · ${average} avg`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @scripta/shared`
Expected: PASS, including the existing "theme attendance…" and "an unplayed edition today…" tests unchanged.

- [ ] **Step 5: Commit**

```bash
node scripts/gate.mjs
git add packages/shared/src/quizzes/dailyChapter.ts packages/shared/src/quizzes/dailyChapter.test.ts
git commit -m "Count Daily Chapter streaks over published editions and add run stats"
```

---

### Task 2: Backend — people per edition and a player's summary

**Files:**
- Modify: `backend/src/modules/quizzes/domain/dailyChapter.ts`
- Modify: `backend/src/modules/quizzes/adapters/sqlite/sqliteDailyChapterRepository.ts`
- Modify: `backend/src/modules/quizzes/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/quizzes/dailyChapterService.ts`
- Modify: `backend/src/modules/quizzes/dailyChapterRoutes.ts`
- Modify: `backend/src/modules/quizzes/plugin.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/app.ts`
- Modify: `packages/shared/src/quizzes/dailyChapterApi.ts`
- Test: `backend/src/modules/quizzes/dailyChapter.test.ts`

**Interfaces:**
- Consumes: `DailyChapterPerson`, `DailyChapterPlayerSummary` and `dailyChapterSummary` from Task 1.
- Produces:
  - In `domain/dailyChapter.ts`:
    - `interface DailyChapterPeople { followees(userId: string): string[]; published(userIds: string[]): Set<string>; profiles(userIds: string[]): Map<string, ReaderProfile> }`
    - `const NO_DAILY_PEOPLE: DailyChapterPeople`, with all three returning empty.
  - `DailyChapterRepository` gains `editionPlays(editionIds: string[], voterIds?: string[]): PlayRow[]`.
  - `createDailyChapterService(repo, plays, clock?, people: DailyChapterPeople = NO_DAILY_PEOPLE)` gains:
    - `people(editionId: string, viewerId: string): DailyChapterPerson[]`
    - `player(userId: string, viewerId: string | null): DailyChapterPlayerSummary | null`
  - Routes:
    - `GET /daily-chapter/:id/people` (authGuard) → `{ people: DailyChapterPerson[] }`
    - `GET /daily-chapter/players/:userId` (optional auth) → `{ summary: DailyChapterPlayerSummary | null }`
    - Both send `Cache-Control: no-store`.
  - `CommunityPublicApi.followees(userId: string): string[]`, implemented with `repo.listFollowees`.
  - `QuizzesPluginOptions.dailyPeople?: DailyChapterPeople`
  - The shared client gains:
    - `people: (editionId: string) => request<{ people: DailyChapterPerson[] }>(…, { auth: "required" })`
    - `player: (userId: string) => request<{ summary: DailyChapterPlayerSummary | null }>(…, { auth: "optional" })`

- [ ] **Step 1: Write the failing tests** in `backend/src/modules/quizzes/dailyChapter.test.ts`. Build a service with a fake `DailyChapterPeople`. The viewer, called `me` below, is the user behind the existing `reader` token (see `call()` at `dailyChapter.test.ts:45` for its id) so the route test can authenticate. `me` follows `"pub"`, `"priv"` and `"nameless"`. `published` returns `{"pub", "nameless"}`. `profiles` returns usernames for `me` and `pub` only, so `nameless` is dropped for having no profile. Seed one edition on `2030-01-01` and record plays by `me` (5/5), `pub` (3/5), `priv` (4/5), `nameless` (2/5) and a guest key.

```ts
test("people for an edition are the viewer and published followees, squares only", () => {
  const people = service.people("edition-1", "me");
  assert.deepEqual(people.map((p) => [p.userId, p.score, p.you]), [["me", 5, true], ["pub", 3, false]]);
  assert.equal(people[1]!.marks.length, 5);
  assert.ok(people.every((p) => !("choiceIndex" in p) && !("answers" in p)));
});

test("people stay hidden until the viewer has played that edition", () => {
  assert.throws(() => service.people("edition-1", "pub-viewer-without-play"), (error: DailyChapterError) => error.status === 403);
  assert.throws(() => service.people("missing", "me"), (error: DailyChapterError) => error.status === 404);
});

test("a player summary is visible to its owner and to everyone only when published", () => {
  assert.equal(service.player("priv", "me"), null);
  assert.equal(service.player("priv", "priv")?.perfect, 0);
  assert.equal(service.player("pub", null)?.average, 3);
  assert.equal(service.player("pub", null)?.month, "2030-01");
  assert.equal(service.player("nobody", "nobody"), null);
});
```

Add a route test in the same file's `Fastify` + `inject` style: `/daily-chapter/edition-1/people` without a token → 401, with the `reader` token → 200 and `no-store`.

Add an index test: `EXPLAIN QUERY PLAN` for the `repo.plays` statement (`SELECT p.* FROM quiz_plays p JOIN daily_chapter_editions e ON e.id = p.quiz_id WHERE p.voter_user_id = ?`) contains `idx_quiz_plays_voter`. Public profiles now run this per-user read for other people, and today it scans `quiz_plays`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace backend`
Expected: FAIL, because `service.people` and `service.player` are not functions.

- [ ] **Step 3: Implement.**
  - **Repo.** `editionPlays` selects `quiz_plays` rows where `quiz_id IN (…)`, filtered to `voter_user_id IN (…)` when `voterIds` is given. Use `json_each(?)` for the lists, as `publish` already does.
  - **`people`.**
    - 404 unless the edition is published with `date <= today`.
    - 403 `"Play this chapter to see how others did."` unless the viewer has a play.
    - Ids are `published(followees(viewer))` plus the viewer. Drop non-viewer ids with no profile.
    - Marks come from comparing `plays.getAnswers(play.id)` with the snapshot's `answerIndex`, in snapshot order.
    - The viewer's `username` is their profile's, or `"You"`.
    - Sort by score descending, then username.
  - **`player`.** Return `null` unless `viewerId === userId` or `published([userId])` has it. Otherwise call `history(userId)`. With no results return `null`, else `dailyChapterSummary(history, today.slice(0, 7))`.
  - **Routes.** Validate `:userId` with `z.string().min(1).max(100)`. Get the viewer from `getOptionalAuthenticatedUser`, and keep the existing 401 behaviour for a bad token, as `player()` in the routes file does.
  - **Wiring in `app.ts`.**
    - `followees: (id) => getCommunityPublicApi().followees(id)`
    - `published: (ids) => new Set([...getCommunityPublicApi().readerVisibility(null, ids)].filter(([, l]) => l.published).map(([id]) => id))`
    - `profiles: resolvePublicReaderProfiles`
    - Pass the result through `QuizzesPluginOptions.dailyPeople` into `createDailyChapterService`.
  - **Index.** Add `CREATE INDEX IF NOT EXISTS idx_quiz_plays_voter ON quiz_plays(voter_user_id);` to `schema.sql`. It runs on every boot through `applyQuizzesMigrations`, so no migration step is needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace backend && npm run typecheck --workspace backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
node scripts/gate.mjs
git add backend/src/modules/quizzes backend/src/modules/community/service.ts backend/src/app.ts packages/shared/src/quizzes/dailyChapterApi.ts
git commit -m "Serve followed players' Daily Chapter scores and public player summaries"
```

---

### Task 3: Backend — community Daily Chapter card in the recap (opt-in)

**Files:**
- Modify: `backend/src/modules/quizzes/domain/dailyChapter.ts`
- Modify: `backend/src/modules/quizzes/adapters/sqlite/sqliteDailyChapterRepository.ts`
- Modify: `backend/src/modules/quizzes/dailyChapterService.ts`
- Modify: `backend/src/modules/quizzes/plugin.ts`
- Modify: `backend/src/modules/quizzes/index.ts`
- Modify: `backend/src/modules/community/topShelfService.ts`
- Modify: `backend/src/modules/community/topShelfRecapService.ts`
- Modify: `backend/src/modules/community/topShelfRoutes.ts`
- Modify: `backend/src/modules/community/plugin.ts`
- Modify: `backend/src/app.ts`
- Modify: `packages/shared/src/topShelf/types.ts`
- Modify: `packages/shared/src/topShelf/api.ts`
- Test: `backend/src/modules/quizzes/dailyChapter.test.ts`
- Test: `backend/src/modules/community/topShelfRecapService.test.ts`
- Test: `backend/src/modules/community/topShelfRoutes.test.ts`

**Interfaces:**
- Consumes: `DailyChapterMonthFacts` (Task 1) and `editionPlays` (Task 2).
- Produces:
  - `DailyChapterRepository.missRates(editionIds: string[]): Array<{ quiz_id: string; question_id: string; wrong: number; total: number }>`, from `quiz_play_answers.correct`.
  - The service gains `monthFacts(month: string): DailyChapterMonthFacts | null`.
  - The quizzes module exports `getDailyChapterPublicApi(): { monthFacts(month: string): DailyChapterMonthFacts | null }`, cached like `getQuizzesPublicApi`.
  - `TopShelfRecapCard` gains `| { kind: "dailyChapter"; players: number; hardest: { title: string; date: string; average: number } | null; mostMissed: { title: string; missedPercent: number } | null; topPlayers: Array<{ username: string; perfect: number }> }`.
  - `TopShelfDeps` (`backend/src/modules/community/topShelfService.ts:8`) gains `dailyChapterMonth?: (month: string) => DailyChapterMonthFacts | null`. It already reaches the recap service as `shelf`. The service gains `getRecap(month: string, options?: { daily?: boolean })`.
  - Shared `fetchRecap(month: string, options: { daily?: boolean } = {})` appends `?daily=1` when `daily` is true.

- [ ] **Step 1: Write the failing tests.**
  - In `dailyChapter.test.ts`: seed editions on `2030-01-30` and `2030-01-31`, with "today" being `2030-02-01`. `saveEdition` rejects past dates and `play` needs `date === today`, so seed and play each edition with `on()` set to its own date, then move to `2030-02-01`.
    - Edition ids are `edition-30` and `edition-31`; the `seed` helper names books `<id>-book-<n>`.
    - Plays on the 30th: `a` 5/5, `b` 2/5 (wrong on q-0, q-1 and q-2), a guest 5/5. On the 31st: `a` 5/5.
    - Assert `service.monthFacts("2030-01")` deep-equals `{ players: 3, hardest: { title: "edition-30", date: "2030-01-30", average: 4 }, mostMissed: { title: "edition-30-book-0", missedPercent: 33 }, perfect: [{ userId: "a", perfect: 2 }] }`.
    - Assert `monthFacts("2030-02")` is `null`.
    - With "today" set to `2030-01-31`, assert the 31st's edition is excluded (`hardest.date === "2030-01-30"` and `perfect[0].perfect === 1`).
  - In `topShelfRecapService.test.ts`, add `visibilityRows` to the fake `community.repo` (`standings()` calls it, `visibility.ts:66`), then give the service `dailyChapterMonth: () => ({ players: 3, hardest: null, mostMissed: null, perfect: [{ userId: "pub", perfect: 2 }, { userId: "priv", perfect: 3 }] })`, with `pub` published and `priv` not.
    - Assert `getRecap(month)` has no `dailyChapter` card.
    - Assert `getRecap(month, { daily: true })` ends with `{ kind: "dailyChapter", players: 3, hardest: null, mostMissed: null, topPlayers: [{ username: <pub's username>, perfect: 2 }] }`.
    - With `players: 0` facts or `null`, assert no card.
  - In `topShelfRoutes.test.ts`: `?daily=1` passes `{ daily: true }`, no query passes `{ daily: false }` (or omits it), and `?daily=yes` → 400.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace backend`
Expected: FAIL, because `monthFacts` is not a function and no `dailyChapter` card is returned.

- [ ] **Step 3: Implement.**
  - **`monthFacts`.**
    - Editions: published, `date.startsWith(month)` and `date < today`. With none, return `null`.
    - `players` is the count of distinct non-null `voter_user_id`. With 0, return `null`.
    - `hardest` is the edition with the lowest average score (rounded to 1 decimal). Ties go to the earliest date.
    - `mostMissed` is the question with the highest `wrong / total`. `title` is its snapshot `book.title` and `missedPercent` is `Math.round(wrong / total * 100)`. Ties go to the earliest edition, then the question order.
    - `perfect` covers non-guest voters with at least one 5/5, sorted by count descending, then `userId`.
  - **Recap service.** When `options.daily` is set and `dailyChapterMonth(month)?.players` is truthy, append the card. `topPlayers` keeps the `perfect` entries whose standing is published (`createVisibility(community.repo, null).standings(ids)`) and who have a profile from `community.resolveProfiles`, takes the first 3, and maps them to `{ username, perfect }`.
  - **Route and wiring.** The route parses `daily: z.literal("1").optional()` from the query. In `app.ts`, add `dailyChapterMonth: (month) => getDailyChapterPublicApi().monthFacts(month)` to the `TopShelfDeps` the community module already receives.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace backend && npm run typecheck --workspace backend && npm run typecheck --workspace frontend`
Expected: PASS. The frontend typecheck proves the widened union breaks no web switch.

- [ ] **Step 5: Commit**

```bash
node scripts/gate.mjs
git add backend/src packages/shared/src/topShelf
git commit -m "Add an opt-in community Daily Chapter card to the monthly recap"
```

---

### Task 4: Mobile — Home icon, Your chapters screen, calendar, Daily screen link

**Files:**
- Modify: `mobile/src/ui/icon.tsx`
- Create: `mobile/src/features/dailyChapter/use-daily-history.ts`
- Create: `mobile/src/features/dailyChapter/daily-chapter-calendar.tsx`
- Create: `mobile/src/features/dailyChapter/your-chapters-screen.tsx`
- Create: `mobile/src/app/(app)/(home)/daily-chapters/index.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-screen.tsx`

**Interfaces:**
- Consumes: `DailyChapterHistory`, `dailyChapterMonth`, `dailyChapterThemeRates` and `DAILY_CHAPTER_THEMES` (Task 1).
- Produces:
  - `GLYPHS.stats = { ios: "chart.bar", android: "bar_chart" }`
  - `deviceIdentity(): Promise<string>`, moved out of `daily-chapter-screen.tsx` into `use-daily-history.ts` and imported back.
  - `useDailyHistory(): UseQueryResult<DailyChapterHistory>`, enabled only when signed in. Its key is `["daily-chapter", "history", user.id, guestId]`, so the Daily screen's existing prefix invalidation refreshes it. It calls `dailyChapterApi.history(guestId, true)`.
  - `<DailyChapterCalendar days={DailyChapterDay[]} onDayPress?={(date: string) => void} tone?: "screen" | "poster" numbers?: boolean />`, where `numbers` defaults to `true`.
  - Route `/daily-chapters`.

- [ ] **Step 1: Implement the hook, glyph and calendar.**
  - The calendar is Monday-first with 7 columns, and leading blanks before day 1.
  - A played day fills with `colors.accent` at opacity `0.25 + 0.15 * score` and shows the day number.
  - A published but missed day has a `colors.border` outline and no fill.
  - An unpublished day is plain text with no outline or fill.
  - Only played days are pressable, and their accessibility label is `"<date>, <score> out of 5"`.
  - `numbers={false}` hides day numbers. `tone="poster"` uses the poster palette from Task 6, and until then it can be the screen palette.
- [ ] **Step 2: Build `YourChaptersScreen`** in the mockup's order:
  - Three tiles: streak, average and perfect, all from `dailyChapterSummary(history, shownMonth)`. The same call gives the calendar its `days`.
  - Personal bests: longest streak in days, most perfects in a row, and `correct of answered` questions right.
  - The month calendar, with ‹ › arrows from the first played month to the current UTC month, defaulting to the current one.
  - "By theme" bars from `dailyChapterThemeRates`, with the first labelled "strongest" and the last "trips you up" when there are 2 or more.
  - Past chapters rows, with date · title, the five squares and a ›.
  - Day presses and row presses push `/daily-chapters/<editionId>`.
  - Loading uses `Skeleton`, an error uses `ErrorState` with retry, and no results uses `EmptyState`.
  - The share button is wired in Task 6. Leave it out here.
- [ ] **Step 3: Add the Home icon.** In `HomeScreen.tsx:52`, when `useDailyHistory().data?.results.length` is truthy, put `<IconButton name="stats" accessibilityLabel="Open your Daily Chapter stats" onPress={() => router.push("/daily-chapters" as never)} />` before the bell.
- [ ] **Step 4: Update the Daily screen.** In `daily-chapter-screen.tsx:34`, when `user` is set, replace the stats block with one pressable row: `Your chapters · {n} played · {streak} day streak ›` → `/daily-chapters`. Signed-out players keep the existing block unchanged.
- [ ] **Step 5: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
node scripts/gate.mjs
git add mobile/src
git commit -m "Add the Your chapters screen and its Home header entry"
```

---

### Task 5: Mobile — a past day with followed players

**Files:**
- Create: `mobile/src/features/dailyChapter/daily-chapter-day-screen.tsx`
- Create: `mobile/src/app/(app)/(home)/daily-chapters/[id].tsx`

**Interfaces:**
- Consumes: `useDailyHistory` (Task 4) and `dailyChapterApi.people` (Task 2).
- Produces: route `/daily-chapters/[id]`.

- [ ] **Step 1: Implement** the screen from `useDailyHistory().data.results.find((r) => r.editionId === id)`.
  - The header title is `<date> · <title>`.
  - Show the score with five squares.
  - Each answer card shows the prompt and `✓ <picked option>`. A wrong answer shows `✗ You said <picked>` plus `· it's <right option>` and the explanation.
  - "People you follow" comes from `useQuery(["daily-chapter", "people", id], () => dailyChapterApi.people(id))`. Each row has an avatar, the username, the five squares and the score, and the viewer's row is labelled "you".
  - With only the viewer in the list, show one dim line: "Nobody you follow has played this chapter."
  - A people-query error shows an inline retry in that section only.
  - No result for `id` shows `EmptyState` "You didn't play this chapter."
- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
node scripts/gate.mjs
git add mobile/src
git commit -m "Show a past Daily Chapter with answers and followed players' scores"
```

---

### Task 6: Mobile — share poster and text

**Files:**
- Create: `mobile/src/features/dailyChapter/daily-chapter-poster.tsx`
- Modify: `mobile/src/features/dailyChapter/your-chapters-screen.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-calendar.tsx`
- Modify: `mobile/src/features/sharing/ContentShareSheet.tsx`

**Interfaces:**
- Consumes:
  - `ContentShareSheet` (`visible`, `onClose`, `title`, `url`, `linkError`, `onRetryLink`, `children` = the image)
  - `dailyChapterSummary` and `dailyChapterMonthShare` (Task 1)
  - `publicContentUrl("/daily")`
- Produces:
  - `<DailyChapterPoster summary={DailyChapterPlayerSummary} />`
  - `ContentShareSheet` gains `textMessage?: string`. When it is set, the main actions view shows a third choice, `ShareChoice icon="share" label="Send as text" detail="For group chats"`, which calls `Share.share({ message: textMessage, title })`. Nothing changes for existing callers.

- [ ] **Step 1: Implement the poster.** It contains, in order:
  - "The Daily Chapter" eyebrow;
  - "My <Month>";
  - `<DailyChapterCalendar tone="poster" numbers={false} />`;
  - streak, average out of 5, and `summary.bestTheme` as `<percent>% at <theme name>` when set;
  - the footer "atmyshelf · play today's chapter".

  It uses a dark warm gradient as in the mockup and contains no dates, titles or answers.
- [ ] **Step 2: Wire the screen.**
  - The header share icon and the bottom "Share my chapters" button set `sharing` to true. `ContentShareSheet` gets `visible={sharing}`, `onClose`, `title="My Daily Chapter"` and `children = <DailyChapterPoster summary={summary} />`.
  - Resolve the link with `useQuery(["public-url", "/daily"], () => publicContentUrl("/daily"), { enabled: sharing })`. It is async and does a network call. Pass `url={link.data ?? null}`, `linkError` from the query error and `onRetryLink={() => void link.refetch()}`, as `RecapScreen` does.
  - `textMessage` is `dailyChapterMonthShare(summary, link.data)` once `link.data` exists, else `undefined`.
  - The image works without the link.
- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
node scripts/gate.mjs
git add mobile/src
git commit -m "Share Your chapters as a month poster or text"
```

---

### Task 7: Mobile — Daily Chapter section on profiles

**Files:**
- Create: `mobile/src/features/dailyChapter/daily-chapter-profile-section.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`

**Interfaces:**
- Consumes: `dailyChapterApi.player(userId)` (Task 2), `DailyChapterCalendar` (Task 4) and `dailyChapterThemeRates`.
- Produces: `<DailyChapterProfileSection userId={string} own={boolean} />`. While loading it shows `Skeleton`, and on error an `ErrorState` with retry. On `summary === null` it shows an empty note: own → "Play today's Daily Chapter to start your calendar." with an action to `/daily`; others → "No Daily Chapter results to show." A private profile's summary is `null` too, so nothing leaks.

- [ ] **Step 1: Implement the section** inside a `ScrollView`. It has the heading "The Daily Chapter", three tiles (streak, average, perfect), `<DailyChapterCalendar days={summary.days} numbers={false} />` without `onDayPress`, and a "Best at <theme> · <percent>%" line when `summary.bestTheme` is set. The query key is `["daily-chapter", "player", userId]`.
- [ ] **Step 2: Mount it as a "Daily" tab, last in each tab list** (Claude's call: `MyShelfScreen` has no list header to share, and a tab keeps both screens alike).
  - In `ProfileScreen.tsx`: add `{ value: "daily", label: "Daily" }` to `PROFILE_TABS` (line 200). Its page is `<DailyChapterProfileSection userId={view.profile.user.userId} own={false} />`.
  - In `MyShelfScreen.tsx`: add the same entry to `MY_SHELF_TABS` (line 23). Handle `"daily"` first in `renderPage` (line 200) with `own` set and the signed-in user's id.
  - Match the tab entries' existing shape, whatever fields the other entries carry.
- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
node scripts/gate.mjs
git add mobile/src
git commit -m "Show Daily Chapter stats on public profiles"
```

---

### Task 8: Mobile — recap card

**Files:**
- Modify: `mobile/src/features/topShelf/recapModel.ts`
- Modify: `mobile/src/features/topShelf/RecapCard.tsx`
- Modify: `mobile/src/features/topShelf/RecapScreen.tsx`
- Test: `mobile/src/features/topShelf/recapModel.test.ts`

**Interfaces:**
- Consumes: the `dailyChapter` card kind and `fetchRecap(month, { daily: true })` (Task 3).

- [ ] **Step 1: Write the failing test** in `recapModel.test.ts`:

```ts
const daily: TopShelfRecapCard = { kind: "dailyChapter", players: 42, hardest: { title: "Poetry", date: "2026-11-04", average: 2.1 }, mostMissed: { title: "The Stranger", missedPercent: 71 }, topPlayers: [{ username: "marta", perfect: 9 }, { username: "joao", perfect: 7 }] };

test("the Daily Chapter recap card speaks for the whole community", () => {
  assert.equal(recapTitle(daily, "2026-11"), "📖 November's Daily Chapter");
  assert.equal(recapNumber(daily), "42 readers played\nHardest: Poetry · 2.1/5\nMost missed: The Stranger · 71%\nMost perfect: @marta (9), @joao (7)");
  assert.equal(recapNumber({ ...daily, hardest: null, mostMissed: null, topPlayers: [] }), "42 readers played");
  assert.equal(recapCta(daily, "2026-12"), "Play today's Daily Chapter");
  assert.equal(recapLinkPath(daily), "/daily");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace mobile`
Expected: FAIL, because `recapTitle` returns `undefined` for `dailyChapter`.

- [ ] **Step 3: Implement.**
  - Add the `dailyChapter` cases to the four switches.
  - In `RecapCard.tsx`, treat `dailyChapter` like `summary`: no covers (`recapCovers` returns `[]`) and the numbers block uses `styles.summaryNumbers`.
  - In `RecapScreen.tsx:28`, call `fetchRecap(month, { daily: true })` and add `"daily"` to the query key.
  - In `RecapScreen.tsx:79-82` `open()`, add `else if (card.kind === "dailyChapter") router.push("/daily" as never);` so tapping the card plays today's chapter.
- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
node scripts/gate.mjs
git add mobile/src
git commit -m "Render the community Daily Chapter card in the monthly recap"
```

---

### After the tasks

- A device pass by `device-checker` on the signed-in fixture covers:
  - the Home icon present after a play;
  - `/daily-chapters` with the calendar arrows and the theme bars;
  - a past day with the people list;
  - the share sheet poster;
  - own profile and another public profile;
  - a recap month with the Daily Chapter card, and tapping it;
  - Daily screen → "Your chapters" link → back returns to the Daily screen. `/daily` is a root route outside `(app)`, so check the back stack;
  - the unchanged signed-out Daily screen block.

  The device pass gates the merge, not the PR.
- Then run `branch-reviewer` with the spec and this plan, and `node scripts/codex-review.mjs branch <spec> <plan>` in parallel. Because this branch changes who can see whose scores, run the `security-review` skill before merge.
