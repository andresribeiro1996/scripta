# You → Daily Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile You → Daily tab always show a week or month calendar, tappable days, a past chapters list that follows the calendar, a fixed play button, and readable questions and answers for missed days.

**Architecture:** Period and day-status logic is pure and lives in `@scripta/shared`. The backend adds one field to the history response and one signed-in route, and relaxes one guard for closed chapters. On mobile, one shared section renders the calendar and list on both You → Daily and "Your chapters".

**Tech Stack:** TypeScript, Fastify, node:sqlite, Expo Router, React Native, TanStack Query, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-daily-tab-calendar-design.md`, mockup in `docs/superpowers/specs/2026-11-03-daily-tab-calendar/full-design.html`.

## Global Constraints

- All dates are UTC day strings (`YYYY-MM-DD`). `history.today` is today. Never use the device's local date.
- API changes are additive. Don't change or remove an existing field or route an installed build uses.
- Other people's profiles don't change: `DailyChapterCalendar`, `dailyChapterMonth`, `dailyChapterSummary` and `GET /daily-chapter/players/:userId` keep their output.
- Reading a missed chapter never changes a streak, stat or theme rate.
- Today's and future chapters never expose answers to someone who hasn't played them.
- Every new string goes in both `en` and `pt-PT`.
- No code comments. Commit messages are plain sentences, with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` as the last line.
- Rebuild `@scripta/shared` before running a consumer's typecheck or tests.

## Review Focus

- A chapter that closes at UTC midnight: an unplayed chapter refuses review before midnight and allows it after. (Task 2)
- A schedule gap, or a past-dated edition that was never published: drawn as plain "no chapter", never as missed, and refused by the review route. (Tasks 1, 2)
- A week window crossing a month and year boundary on a device west of UTC: the right seven days, labelled with the right dates. (Task 1)
- No chapter today, as after the launch editions end on 2026-11-12: no play button, and today's cell is plain. (Task 1)
- The ‹ limit when the first chapter falls mid-window: the window containing it is reachable and nothing earlier is. (Task 1)

---

### Task 1: Shared period logic, types and API client

**Files:**
- Modify: `packages/shared/src/quizzes/dailyChapter.ts`
- Modify: `packages/shared/src/quizzes/dailyChapterApi.ts`
- Test: `packages/shared/src/quizzes/dailyChapter.test.ts`
- Test: `packages/shared/src/quizzes/dailyChapterApi.test.ts`

**Interfaces:**
- Produces, exported from `dailyChapter.ts`:

```ts
export interface DailyChapterPastEdition { id: string; date: string; title: string; themeId: string }
export type DailyChapterStats = Omit<DailyChapterHistory, "pastEditions">;
export type DailyChapterDayStatus = "played" | "missed" | "today" | "none";
export interface DailyChapterCalendarDay { date: string; status: DailyChapterDayStatus; score: number | null; editionId: string | null }
export interface DailyChapterRow { date: string; editionId: string; title: string; themeId: string; score: number | null; marks: boolean[] | null }
export interface DailyChapterReview { editionId: string; date: string; title: string; themeId: string; questions: Array<Omit<DailyChapterAnswer, "choiceIndex">> }

dailyChapterDays(history: DailyChapterHistory, dates: readonly string[]): DailyChapterCalendarDay[]
dailyChapterRows(history: DailyChapterHistory, days: readonly DailyChapterCalendarDay[]): DailyChapterRow[]
dailyChapterWeekDates(today: string, weeksBack: number): string[]
dailyChapterMonthDates(month: string): string[]
dailyChapterHasEarlierWeek(history: DailyChapterHistory, weeksBack: number): boolean
dailyChapterHasEarlierMonth(history: DailyChapterHistory, month: string): boolean
dailyChapterCanPlayToday(history: DailyChapterHistory): boolean
dailyChapterDayLabel(date: string, locale: Locale): string
dailyChapterRangeLabel(first: string, last: string, locale: Locale): string
```

- `DailyChapterHistory` gains `pastEditions: DailyChapterPastEdition[]`.
- `dailyChapterStats` now returns `DailyChapterStats`. `dailyChapterSummary` and `dailyChapterMonth` accept stats without `pastEditions`.
- `createDailyChapterApi` gains `review: (id: string) => Promise<DailyChapterReview>`.

- [ ] **Step 1: Write the failing tests in `dailyChapter.test.ts`**

Build fixtures with `const withPast = (stats: DailyChapterStats, ids: string[]) => ({ ...stats, pastEditions: ids.map((id) => ({ id, date: "2030-01-" + id.slice(1), title: "Title " + id, themeId: "retold-myths" })) })` over releases `e01, e03, e05, e07` with today `2030-01-07`.

```ts
test("calendar days separate played, missed, today and days with no chapter", () => {
  const history = withPast(dailyChapterStats([result("e03", "2030-01-03", 4)], releases, "2030-01-07"), ["e01", "e03", "e05"]);
  const days = dailyChapterDays(history, dailyChapterWeekDates("2030-01-07", 0));
  assert.deepEqual(days.map((day) => day.status), ["missed", "none", "played", "none", "missed", "none", "today"]);
  assert.deepEqual(days[2], { date: "2030-01-03", status: "played", score: 4, editionId: "e03" });
  assert.deepEqual(days[0], { date: "2030-01-01", status: "missed", score: null, editionId: "e01" });
  assert.deepEqual(days[6], { date: "2030-01-07", status: "today", score: null, editionId: null });
});

test("someone who has never played sees every past chapter as missed", () => {
  const history = withPast(dailyChapterStats([], releases, "2030-01-07"), ["e01", "e03", "e05"]);
  assert.deepEqual(dailyChapterDays(history, ["2030-01-01", "2030-01-03", "2030-01-05"]).map((day) => day.status), ["missed", "missed", "missed"]);
  assert.equal(dailyChapterCanPlayToday(history), true);
});

test("a played today is an ordinary played day and hides the play button", () => {
  const history = withPast(dailyChapterStats([result("e07", "2030-01-07", 5)], releases, "2030-01-07"), ["e01", "e03", "e05"]);
  assert.equal(dailyChapterDays(history, ["2030-01-07"])[0]!.status, "played");
  assert.equal(dailyChapterCanPlayToday(history), false);
});

test("no chapter today is a plain day with no play button", () => {
  const history = withPast(dailyChapterStats([], releases, "2030-01-08"), ["e01", "e03", "e05", "e07"]);
  assert.equal(dailyChapterDays(history, ["2030-01-08"])[0]!.status, "none");
  assert.equal(dailyChapterCanPlayToday(history), false);
});

test("rows are the period's played and missed chapters, newest first, without today", () => {
  const history = withPast(dailyChapterStats([result("e03", "2030-01-03", 4)], releases, "2030-01-07"), ["e01", "e03", "e05"]);
  const rows = dailyChapterRows(history, dailyChapterDays(history, dailyChapterWeekDates("2030-01-07", 0)));
  assert.deepEqual(rows.map((row) => [row.editionId, row.score]), [["e05", null], ["e03", 4], ["e01", null]]);
  assert.equal(rows[0]!.title, "Title e05");
  assert.equal(rows[0]!.marks, null);
  assert.deepEqual(rows[1]!.marks, [true]);
});

test("a week crosses a year boundary and steps back seven days", () => {
  assert.deepEqual(dailyChapterWeekDates("2030-01-03", 0), ["2029-12-28", "2029-12-29", "2029-12-30", "2029-12-31", "2030-01-01", "2030-01-02", "2030-01-03"]);
  assert.equal(dailyChapterWeekDates("2030-01-03", 1)[6], "2029-12-27");
  assert.equal(dailyChapterMonthDates("2030-02").length, 28);
});

test("the earlier arrows stop at the window holding the first chapter", () => {
  const history = withPast(dailyChapterStats([], [{ id: "e05", date: "2030-01-05", themeId: "retold-myths" }], "2030-01-20"), ["e05"]);
  assert.equal(dailyChapterHasEarlierWeek(history, 1), true);
  assert.equal(dailyChapterHasEarlierWeek(history, 2), false);
  assert.equal(dailyChapterHasEarlierMonth(history, "2030-02"), true);
  assert.equal(dailyChapterHasEarlierMonth(history, "2030-01"), false);
});

test("day labels name the UTC day on a device west of UTC", () => {
  const zone = process.env.TZ;
  process.env.TZ = "America/Sao_Paulo";
  try {
    assert.equal(dailyChapterDayLabel("2026-11-02", "en"), "Mon, Nov 2");
    assert.equal(dailyChapterRangeLabel("2026-10-28", "2026-11-03", "en"), "Oct 28 – Nov 3");
  } finally { process.env.TZ = zone; }
});
```

For the earlier-arrows test: today `2030-01-20`, `weeksBack` 1 is Jan 7–13 and 2 is Dec 31–Jan 6, which holds Jan 5.

- [ ] **Step 2: Write the failing API test in `dailyChapterApi.test.ts`**

Assert `review` requests with `auth: "required"`, following that file's recorder pattern.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run build --workspace @scripta/shared` then `npm test --workspace @scripta/shared`
Expected: the build fails on the missing exports.

- [ ] **Step 4: Implement in `dailyChapter.ts` and `dailyChapterApi.ts`**

- `dailyChapterDays`: played if `results` has the date. `today` if the date is `history.today` and `editionDates` includes it. `missed` if `pastEditions` has the date. Otherwise `none`.
- `dailyChapterHasEarlierWeek`: the window's first date is after `editionDates.at(-1)`. False when `editionDates` is empty. The month version compares against `editionDates.at(-1)!.slice(0, 7)`.
- `dailyChapterCanPlayToday`: `editionDates` includes `today`, and `results` has no row for `today`.
- Labels: `new Date(date + "T00:00:00Z").toLocaleDateString(intlLocale(locale), { ..., timeZone: "UTC" })`, with `weekday: "short", month: "short", day: "numeric"` for the day. The range joins two `month: "short", day: "numeric"` dates with ` – `.
- `dailyChapterMonth` reuses `dailyChapterMonthDates`, with unchanged output.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build --workspace @scripta/shared` then `npm test --workspace @scripta/shared`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/quizzes/dailyChapter.ts packages/shared/src/quizzes/dailyChapterApi.ts packages/shared/src/quizzes/dailyChapter.test.ts packages/shared/src/quizzes/dailyChapterApi.test.ts
git commit -m "Add Daily Chapter week and month calendar logic"
```

### Task 2: Backend history field, review route and people guard

**Files:**
- Modify: `backend/src/modules/quizzes/dailyChapterService.ts`
- Modify: `backend/src/modules/quizzes/dailyChapterRoutes.ts`
- Test: `backend/src/modules/quizzes/dailyChapter.test.ts`

**Interfaces:**
- Consumes: `DailyChapterHistory`, `DailyChapterStats`, `DailyChapterReview` from Task 1.
- Produces: `POST /daily-chapter/history` includes `pastEditions`. `GET /daily-chapter/:id/review` returns `DailyChapterReview`. `service.review(id: string): DailyChapterReview`.

- [ ] **Step 1: Write the failing tests**

Seed with the file's `seed` and `service.publish`, move the clock with `on`.

```ts
test("history lists closed published chapters only", () => {
  // published on-01 and today-02, saved-but-unpublished unpub-01, future-03; clock at 2030-01-02
  assert.deepEqual(service.history("reader").pastEditions.map((edition) => edition.id), ["on-01"]);
  assert.deepEqual(Object.keys(service.history("reader").pastEditions[0]!).sort(), ["date", "id", "themeId", "title"]);
});

test("review answers only for a closed published chapter", async () => {
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/on-01/review" })).status, 401);
  const open = await call(service, { method: "GET", url: "/daily-chapter/on-01/review" }, "reader");
  assert.equal(open.status, 200);
  assert.equal(open.headers["cache-control"], "no-store");
  assert.equal(open.body.questions.length, 5);
  assert.equal(open.body.questions[0].answerIndex, 0);
  assert.ok(!("choiceIndex" in open.body.questions[0]));
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/today-02/review" }, "reader")).status, 403);
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/future-03/review" }, "reader")).status, 404);
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/unpub-01/review" }, "reader")).status, 404);
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/missing/review" }, "reader")).status, 404);
});

test("a chapter becomes reviewable when its day closes", async () => {
  // today-02 refuses on 2030-01-02T23:59:59Z, answers on 2030-01-03T00:00:00Z
});

test("reading a missed chapter changes nothing in the player's history", () => {
  const before = service.history("reader");
  service.review("on-01");
  assert.deepEqual(service.history("reader"), before);
});

test("people need a play only while the chapter is open", () => {
  // withPeople: a viewer with no play gets 403 on the edition's own day,
  // and the published followees after the clock moves past that day
});
```

Keep the existing test "people stay hidden until the viewer has played that edition". If `withPeople` leaves the clock after the edition's day, set the clock to that day in that test so it still asserts the 403.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build --workspace @scripta/shared` then `npm test --workspace backend`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement in the service**

- `history` returns `{ ...dailyChapterStats(results, editions, today()), pastEditions }`, with `pastEditions` from `editions` where `date < today()`, mapped to exactly `id, date, title, themeId`.
- `review(id)`: `repo.edition(id)`. Unpublished, unknown or `date > today()` gets `failKey(404, "quizzes.dailyNoEdition")`. `date === today()` gets `failKey(403, "quizzes.dailyPlayFirst")`. Otherwise map `edition.snapshot!` to the question fields of `editionResult` without `choiceIndex`.
- `people`: the `dailyPlayFirst` check applies only when `edition.date === today()`.

- [ ] **Step 4: Add the route in `dailyChapterRoutes.ts`**

`GET /daily-chapter/:id/review` with `preHandler: authGuard`, sending `no-store`, next to the `people` route. Check it doesn't collide with the admin routes.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace backend` and `npm run typecheck --workspace backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/quizzes/dailyChapterService.ts backend/src/modules/quizzes/dailyChapterRoutes.ts backend/src/modules/quizzes/dailyChapter.test.ts
git commit -m "Let signed-in readers review closed Daily Chapters"
```

### Task 3: Calendar section and You → Daily

**Files:**
- Create: `mobile/src/features/dailyChapter/use-daily-period.ts`
- Create: `mobile/src/features/dailyChapter/daily-chapter-period-section.tsx`
- Create: `mobile/src/features/dailyChapter/daily-chapter-play-footer.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-calendar.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-profile-section.tsx`
- Modify: `mobile/src/features/works/workPath.ts`
- Modify: `mobile/src/i18n/messages/en/quizzes.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/quizzes.ts`
- Test: `mobile/src/features/works/workPath.test.ts`

**Interfaces:**
- Consumes: the Task 1 functions, `useDailyHistory`, `Segmented`, `Button`.
- Produces:

```ts
export function dailyDayPath(id: string, segments: readonly string[]): string
export function useDailyPeriod(history: DailyChapterHistory): {
  view: "week" | "month"; setView(view: "week" | "month"): void;
  dates: string[]; days: DailyChapterCalendarDay[]; rows: DailyChapterRow[];
  title: string; hasEarlier: boolean; hasLater: boolean; earlier(): void; later(): void;
  posterMonth: string;
}
export function DailyChapterPeriodSection({ history, period, afterCalendar }: { history: DailyChapterHistory; period: ReturnType<typeof useDailyPeriod>; afterCalendar?: ReactNode }): JSX.Element
export function DailyChapterPlayFooter({ history }: { history: DailyChapterHistory }): JSX.Element | null
```

- [ ] **Step 1: Write the failing test in `workPath.test.ts`**

```ts
test("a Daily Chapter day stays in Home's stack and otherwise opens over the tabs", () => {
  assert.equal(dailyDayPath("e1", ["(app)", "(home)", "daily-chapters"]), "/daily-chapters/e1");
  assert.equal(dailyDayPath("e1", ["(app)", "(you)", "you"]), "/(public)/daily-chapters/e1");
  assert.equal(dailyDayPath("e1", ["(public)", "daily-chapters"]), "/(public)/daily-chapters/e1");
});
```

`/daily-chapters/:id` only exists under `(home)` and `(public)`, so `stackPrefix` would send a You-tab tap over to the Home tab.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace mobile`
Expected: FAIL, `dailyDayPath` is not defined.

- [ ] **Step 3: Implement `dailyDayPath`, then add the strings**

Add to both `en` and `pt-PT`:

| Key | en | pt-PT |
|---|---|---|
| `quizzes.viewWeek` | Week | Semana |
| `quizzes.viewMonth` | Month | Mês |
| `quizzes.calendarView` | Calendar view | Vista do calendário |
| `quizzes.previousWeek` | Previous week | Semana anterior |
| `quizzes.nextWeek` | Next week | Semana seguinte |
| `quizzes.dayMissed` | Missed | Perdido |
| `quizzes.dayPlay` | Play | Jogar |
| `quizzes.dayMissedLabel` | {date}, missed | {date}, perdido |
| `quizzes.dayPlayLabel` | {date}, play today's chapter | {date}, jogar o capítulo de hoje |
| `quizzes.pastChapterMissedLabel` | {date}, {title}, missed | {date}, {title}, perdido |
| `quizzes.noChaptersInPeriod` | No chapters in this period. | Sem capítulos neste período. |

Remove `quizzes.noDailyTitle` and `quizzes.noDailyOwnBody` from both locales once the profile section stops using them.

- [ ] **Step 4: Implement `useDailyPeriod`**

- State: `view`, `weeksBack` (starts 0), `month` (starts `history.today.slice(0, 7)`). Each view keeps its own position.
- `view` is read from and written to AsyncStorage under `daily-chapter:view`. Anything other than `"month"` counts as `"week"`.
- `title`: `dailyChapterRangeLabel` for week, the `quizzes.monthYear` text for month.
- `hasLater`: `weeksBack > 0` for week, `month < history.today.slice(0, 7)` for month.
- `posterMonth`: `month` in month view, otherwise the visible week's last date `.slice(0, 7)`.

- [ ] **Step 5: Implement `DailyChapterPeriodSection`**

Order: `Segmented` (accessibility label `quizzes.calendarView`), a header row with ‹ › using the existing `arrow` markup from `your-chapters-screen.tsx`, the calendar, `afterCalendar`, then `quizzes.pastChapters` and the rows.

- Calendar cells follow the spec and mockup. Export `WEEKDAYS` from `daily-chapter-calendar.tsx` and reuse the tint from there (`opacity: 0.25 + 0.15 * score`), without changing that component's output.
- Month is a Monday-first grid. Week is 7 cells in date order, each with its weekday above and a caption below: `{score}/5`, `quizzes.dayMissed` or `quizzes.dayPlay`. Captions are `numberOfLines={1}`.
- Tapping: `played` and `missed` go to `dailyDayPath(editionId, segments)`. `today` goes to `/daily`. `none` is a plain non-pressable `View`.
- Rows have two lines: title, then `{dailyChapterDayLabel} · {dailyThemeName}`. On the right, `DailyChapterSquares` and `{score}/5` when played, `quizzes.dayMissed` when missed, then the chevron. Accessibility labels use `quizzes.pastChapterLabel` or `quizzes.pastChapterMissedLabel`, with the day label as `date`.
- No rows shows `quizzes.noChaptersInPeriod`.

- [ ] **Step 6: Implement `DailyChapterPlayFooter`**

Returns `null` unless `dailyChapterCanPlayToday(history)`. Otherwise a non-scrolling `View` with `padding: spacing.lg` and a top border, holding `<Button label={t("quizzes.playToday")} onPress={() => router.push("/daily")} />`. It's a sibling below the `ScrollView` in a `flex: 1` container, so content can't be covered and no padding math is needed.

- [ ] **Step 7: Use it on You → Daily**

In `daily-chapter-profile-section.tsx`, `own` renders a new `OwnDailyChapterSection` and `own={false}` keeps the current code unchanged. The new one uses `useDailyHistory` and `useDeviceIdentity`, the retry pattern from `your-chapters-screen.tsx`, and skeletons while loading. Layout: tiles only when `history.results.length > 0`, then the period section with `afterCalendar` set to the existing `quizzes.bestAt` line when there is a best theme, then the footer.

- [ ] **Step 8: Run the checks**

Run: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace mobile`, `npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/features/dailyChapter/use-daily-period.ts mobile/src/features/dailyChapter/daily-chapter-period-section.tsx mobile/src/features/dailyChapter/daily-chapter-play-footer.tsx mobile/src/features/dailyChapter/daily-chapter-calendar.tsx mobile/src/features/dailyChapter/daily-chapter-profile-section.tsx mobile/src/features/works/workPath.ts mobile/src/features/works/workPath.test.ts mobile/src/i18n/messages/en/quizzes.ts mobile/src/i18n/messages/pt-PT/quizzes.ts
git commit -m "Show a week or month calendar on the You tab's Daily section"
```

### Task 4: "Your chapters" uses the same section

**Files:**
- Modify: `mobile/src/features/dailyChapter/your-chapters-screen.tsx`
- Modify: `mobile/src/i18n/messages/en/quizzes.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/quizzes.ts`

**Interfaces:**
- Consumes: `useDailyPeriod`, `DailyChapterPeriodSection`, `DailyChapterPlayFooter` from Task 3.

- [ ] **Step 1: Replace the month state, arrows, calendar and flat list**

Order: tiles and bests when `results.length > 0`, the period section, theme bars, the share button. The footer goes below the `ScrollView`. The empty state goes, since the calendar always shows. The poster and share text use `period.posterMonth` in place of `month`. Sharing stays hidden with no results. `useDailyPeriod` needs loaded history, so the part that holds it is a child component rendered once `data` exists.

- [ ] **Step 2: Remove strings nothing uses now**

Remove `quizzes.noChapters` and `quizzes.noChaptersBody` from both locales, if `rg` confirms they're unused.

- [ ] **Step 3: Run the checks**

Run: `npm run typecheck --workspace mobile`, `npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/features/dailyChapter/your-chapters-screen.tsx mobile/src/i18n/messages/en/quizzes.ts mobile/src/i18n/messages/pt-PT/quizzes.ts
git commit -m "Share the Daily calendar and list with Your chapters"
```

### Task 5: The day page shows missed chapters

**Files:**
- Modify: `mobile/src/features/dailyChapter/daily-chapter-day-screen.tsx`
- Modify: `mobile/src/i18n/messages/en/quizzes.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/quizzes.ts`

**Interfaces:**
- Consumes: `dailyChapterApi.review` and `DailyChapterReview` from Task 1, through the mobile `dailyChapterApi` that wraps the shared client.

- [ ] **Step 1: Add the string**

`quizzes.questionsAndAnswers`: "Questions and answers" / "Perguntas e respostas".

- [ ] **Step 2: Fetch the review when there's no result**

```ts
const review = useQuery({
  queryKey: ["daily-chapter", "review", id],
  queryFn: async () => {
    try { return await dailyChapterApi.review(id); }
    catch (reason) { if (reason instanceof ApiError && (reason.status === 403 || reason.status === 404)) return null; throw reason; }
  },
  enabled: Boolean(history.data && !result),
});
```

Only a 403 or 404 means "can't review". Any other failure goes to the existing `quizzes.dayLoadFailed` state with retry.

- [ ] **Step 3: Render the missed page**

- The title uses `result ?? review.data`.
- `review.data` set: `quizzes.didntPlay` as a line, `quizzes.questionsAndAnswers` as a header, then a card per question reusing the played card's styling: prompt, `✓ {options[answerIndex]}` in `colors.success`, and the explanation.
- `review.data === null`: the existing `quizzes.didntPlay` empty state.
- `people` becomes `enabled: Boolean(result || review.data)`, and the "People you follow" block renders for both.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck --workspace mobile`, `npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/dailyChapter/daily-chapter-day-screen.tsx mobile/src/i18n/messages/en/quizzes.ts mobile/src/i18n/messages/pt-PT/quizzes.ts
git commit -m "Show questions and answers for a missed Daily Chapter"
```

### Task 6: Device pass and the whole gate

**Files:**
- Test: `scripts/dev-daily-chapter.mjs`

The fixture script is listed only as the source of test data. Don't edit it unless the pass finds it can't produce a state below.

- [ ] **Step 1: Run the full checks**

Run the Verify commands for `packages/`, `backend/` and `mobile/` from each `AGENTS.md`. `gate.mjs` only sees uncommitted changes, so run them directly.
Expected: PASS.

- [ ] **Step 2: Dispatch `device-checker`**

Give it the worktree path, a screenshot directory, and these checks on the seeded dev account (it has mixed scores, two missed days and gap days):

- You → Daily, Week: tiles, 7 cells with captions, list limited to the window, fixed play button above the tab bar with the last row readable above it.
- Month: numbers, arrows, gap days plain, ‹ stops at the first chapter's month. Leave and return: the view is remembered.
- Tap a played day, then a missed day: the You tab stays underneath, and back returns to it. The missed page shows questions, answers and people you follow.
- Tap today: the game opens. After finishing it, the button is gone and today is filled.
- "Your chapters": the same calendar and list, plus bests, theme bars and share. In Week view the poster shows the visible week's month.
- A followed person's profile → Daily: unchanged, with no numbers or tapping.
- pt-PT: "Perdido" fits on one line in a week cell.

Never-played can't be reached through the UI on the seeded account. Check it with a fresh account, or report it as not checked.

- [ ] **Step 3: Fix what it finds, within this plan's scope**

Commit each fix with a plain sentence and re-check that screen only.
