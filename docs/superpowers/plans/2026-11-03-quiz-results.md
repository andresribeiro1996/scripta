# Quiz Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make quiz Your answers explain each miss at a glance, and make the leaderboard show avatars and the viewer's own row.

**Architecture:** The public results route learns who is asking and returns `avatarUrl` and `isYou`; post-play answers gain `workId`. Display logic that both clients need lives in `@scripta/shared`, tested there; each client then renders it. A small shared clock replaces the ad-hoc `Date.now()` timing on both clients.

**Tech Stack:** Fastify + zod + SQLite, `@scripta/shared`, React + Tailwind, Expo/React Native, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-03-quiz-results-design.md`

## Global Constraints

- No comments in code. Catch only specific failures.
- New copy goes in both `en` and `pt-PT`; `catalogMismatches` fails on missing keys or differing placeholders.
- Other players' `playId` must never appear in a public response.
- `@scripta/shared` must be rebuilt (`npm run build --workspace @scripta/shared`) before client typechecks or tests see its changes.
- Use existing tokens only: `accentSoft`/`--color-accent-soft` for the highlight, `accent`/`--color-accent` for the ring and first place.
- No database migration and no native change.

## Review Focus

- A missed question sorted to the top shows its own prompt, thumbnail and pick, not those of whichever question sat at that index. Pinned in Task 3.
- A guest passing a play id that matches nobody, or a repeated `?playId=a&playId=b`, gets a normal board with nobody highlighted, not a 400 or 500. Pinned in Task 1.
- A signed-in viewer sending someone else's `playId` is highlighted on their own row only. Pinned in Task 1.
- A player who leaves the quiz open past an hour can still submit. Pinned in Task 2.
- A time of 59.96s reads `1:00`, never `60.0s` or `0:60`. Pinned in Task 2.

---

### Task 1: Results route knows the viewer

**Files:**
- Modify: `packages/shared/src/quizzes/types.ts`
- Modify: `packages/shared/src/quizzes/api.ts`
- Test: `packages/shared/src/quizzes/api.test.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Modify: `backend/src/modules/quizzes/plugin.ts`
- Modify: `backend/src/modules/quizzes/routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `frontend/src/components/quiz/QuizResults.tsx`
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx`
- Test: `backend/src/modules/quizzes/routes.test.ts`
- Test: `backend/src/modules/quizzes/service.test.ts`

**Interfaces:**
- Produces: `ResultPlay` gains `avatarUrl: string | null`. `PublicResultPlay = Omit<ResultPlay, "playId"> & { isYou: boolean }`. `PlayResponse["answers"]` values gain `workId: string | null`. `api.fetchPublicResults(code: string, playId: string | null)`.
- Produces: `ResolveUsernames` becomes `ResolveProfiles = (userIds: string[]) => Map<string, ReaderProfile>`; the option `resolveUsernames` becomes `resolveProfiles`; `app.ts:227` passes `resolvePublicReaderProfiles` directly. `service.getPublicResults(code: string, player: Player)`.

- [ ] **Step 1: Write the failing tests**

In `api.test.ts`, replace the `fetchPublicResults` case with:

```ts
["fetchPublicResults without a play", (api) => api.fetchPublicResults("c1", null), "/quizzes/voting/c1/results", { auth: "optional" }],
["fetchPublicResults with a play", (api) => api.fetchPublicResults("c1", "p/1"), "/quizzes/voting/c1/results?playId=p%2F1", { auth: "optional" }],
```

In `routes.test.ts`, using the setup at `routes.test.ts:124-137` and the signed-in app at `routes.test.ts:65`:

- `public results mark the anonymous player who sends their play id`: submit two anonymous plays, `GET …/results?playId=<first>`; exactly the first play has `isYou === true`, and no play has a `playId` or `voter_user_id` key.
- `public results mark nobody for an unknown or repeated play id`: `?playId=nope` and `?playId=a&playId=b` both return 200 with every `isYou === false`.
- `a token beats a play id on public results`: a signed-in play plus an anonymous play, `GET …/results?playId=<anonymous id>` with the token; only the signed-in play has `isYou === true`.
- `public results are not cacheable`: `headers["cache-control"] === "no-store"`. The `call` helper at `routes.test.ts:65-71` returns only status and body, so add `headers: res.headers` to it.
- Extend the play-response test at `routes.test.ts:475-486`: each `answers` entry has `workId` equal to its question's stored `workId`.

In `service.test.ts`:

- Change the resolver in `namedPlaysFixture` (`service.test.ts:507`) to return `{ username, avatarUrl: "/a.jpg" }`, and extend the naming test that ends at `:542`: signed-in plays carry `avatarUrl: "/a.jpg"`, and guest plays and players with no resolved profile carry `avatarUrl: null`.
- `:537`: call `getPublicResults(code, { kind: "anonymous", playId: null })`.
- `:556-557`: widen the `stored` cast and add `workId: q.workId` to `expected`, because the comparison is a strict `deepEqual`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @scripta/shared` and `npm test --workspace backend`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

- `fetchPublicResults`: `auth: "optional"`, appending `?playId=${encodeURIComponent(playId)}` when not null.
- `toResultPlay(row, profiles: Map<string, ReaderProfile>)`: read `username` and `avatarUrl` from the profile, otherwise fall back as today and use `avatarUrl: null`.
- `getPublicResults`: `isYou` is `player.kind === "user" ? row.voter_user_id === player.userId : row.voter_user_id === null && row.id === player.playId`.
- Route: `const playId = typeof (request.query as { playId?: unknown }).playId === "string" ? …: null`, pass `playerFor(request, playId)`, and send with `reply.header("Cache-Control", "no-store")` as `dailyChapterRoutes.ts:33` does.
- `answersFor` adds `workId: question.workId`; update its parameter and return types and the outcome type at `service.ts:54` to match.
- `QuizResults.tsx:167` and `QuizPlayScreen.tsx:256`: pass `null` as `playId` so both clients keep compiling. Tasks 3 and 4 replace these calls; leave their query keys alone here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @scripta/shared`, `npm run build --workspace @scripta/shared`, `npm test --workspace backend`, then `npm run typecheck` in `backend`, `frontend` and `mobile` (each with `--workspace`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/quizzes backend/src/modules/quizzes backend/src/app.ts frontend/src/components/quiz/QuizResults.tsx mobile/src/features/quizzes/QuizPlayScreen.tsx
git commit -m "Tell the public quiz results who is asking"
```

### Task 2: Shared display helpers and play clock

**Files:**
- Modify: `packages/shared/src/quizzes/labels.ts`
- Test: `packages/shared/src/quizzes/labels.test.ts`
- Create: `packages/shared/src/quizzes/playClock.ts`
- Test: `packages/shared/src/quizzes/playClock.test.ts`
- Modify: `packages/shared/src/quizzes/index.ts`
- Modify: `packages/shared/src/i18n/messages/en.ts`
- Modify: `packages/shared/src/i18n/messages/pt-PT.ts`
- Modify: `backend/src/modules/quizzes/routes.ts`

**Interfaces:**
- Consumes: `workId` on `PlayResponse["answers"]` from Task 1.
- Produces, in `labels.ts`:
  - `ScoreRow` gains `prompt?: string` and `workId?: string`, set only when present.
  - `missesFirst(rows: ScoreRow[]): ScoreRow[]`
  - `answerExpands(row: ScoreRow): boolean`
  - `leaderboardPosition(plays: Array<{ isYou: boolean }>): { rank: number; total: number } | null`
  - `playDurationLabel(ms: number, locale: Locale): string`
- Produces, in `playClock.ts`: `MAX_PLAY_DURATION_MS = 3_600_000` and `createPlayClock(): PlayClock`, with `start(now: number): void`, `answered(now: number): void`, `elapsed(now: number, complete: boolean): number`, `durationMs(now: number): number`.

- [ ] **Step 1: Write the failing tests**

In `labels.test.ts`:

```ts
test("score rows carry the prompt for text clues only, and the work when known", () => {
  const questions: PublicQuizQuestion[] = [
    { id: "q0", type: "quote_title", prompt: "Call me Ishmael", options: ["Moby-Dick", "Emma"] },
    { id: "q1", type: "cover_title", prompt: "/c/x.jpg", options: ["Dune", "Emma"] },
    { id: "q2", type: "title_cover", prompt: "Dune", options: ["/c/a.jpg", "/c/b.jpg"] }
  ];
  const answers = {
    q0: { choiceIndex: 1, answerIndex: 0, workId: "w0" },
    q1: { choiceIndex: 0, answerIndex: 0, workId: null },
    q2: { choiceIndex: 0, answerIndex: 0, workId: "w2" }
  };
  const rows = scoreRows(questions, { q1: true, q2: true }, answers);
  assert.equal(rows[0]!.prompt, "Call me Ishmael");
  assert.equal(rows[0]!.workId, "w0");
  assert.equal("prompt" in rows[1]!, false);
  assert.equal("workId" in rows[1]!, false);
  assert.equal("prompt" in rows[2]!, false);
});

test("misses come first and keep their numbers and relative order", () => {
  const row = (number: number, correct: boolean) => ({ id: `q${number}`, number, correct });
  assert.deepEqual(missesFirst([row(1, true), row(2, false), row(3, true), row(4, false)]).map((r) => r.number), [2, 4, 1, 3]);
});

test("a row expands only when something sits behind it", () => {
  const text = { kind: "text" as const, value: "Dune" };
  const cover = { kind: "cover" as const, value: "/c/a.jpg" };
  assert.equal(answerExpands({ id: "a", number: 1, correct: true, answer: text }), false);
  assert.equal(answerExpands({ id: "b", number: 1, correct: false, answer: text, pick: text }), false);
  assert.equal(answerExpands({ id: "c", number: 1, correct: true, answer: text, workId: "w" }), true);
  assert.equal(answerExpands({ id: "d", number: 1, correct: false, answer: cover, pick: cover }), true);
  assert.equal(answerExpands({ id: "e", number: 1, correct: false }), true);
});

test("position needs the viewer on a board with someone else", () => {
  assert.equal(leaderboardPosition([{ isYou: false }, { isYou: false }]), null);
  assert.equal(leaderboardPosition([{ isYou: true }]), null);
  assert.deepEqual(leaderboardPosition([{ isYou: false }, { isYou: true }, { isYou: false }]), { rank: 2, total: 3 });
});

test("durations keep the decimal under a minute and read as a clock from there", () => {
  assert.equal(playDurationLabel(16800, "en"), "16.8s");
  assert.equal(playDurationLabel(16800, "pt-PT"), "16,8 s");
  assert.equal(playDurationLabel(59_949, "en"), "59.9s");
  assert.equal(playDurationLabel(59_960, "en"), "1:00");
  assert.equal(playDurationLabel(143_200, "en"), "2:23");
  assert.equal(playDurationLabel(119_600, "en"), "2:00");
});
```

Change the existing guest test to `test("a nameless guest's name already says guest", …)`, asserting `playerLabel({ playerName: null, anonymous: true }, "en")` is `{ name: "Guest", guest: false }`, and add `playerLabel({ playerName: "Rui", anonymous: true }, "en")` is `{ name: "Rui", guest: true }`.

In `playClock.test.ts`:

```ts
test("the clock starts once and ends at the last answer", () => {
  const clock = createPlayClock();
  assert.equal(clock.elapsed(500, false), 0);
  clock.start(1000);
  clock.start(5000);
  clock.answered(4000);
  clock.answered(9000);
  assert.equal(clock.durationMs(60_000), 8000);
});

test("a running count freezes once every question is answered", () => {
  const clock = createPlayClock();
  clock.start(1000);
  assert.equal(clock.elapsed(3000, false), 2000);
  clock.answered(4000);
  assert.equal(clock.elapsed(50_000, true), 3000);
});

test("duration stays inside the server's limit", () => {
  const clock = createPlayClock();
  clock.start(0);
  clock.answered(2 * MAX_PLAY_DURATION_MS);
  assert.equal(clock.durationMs(2 * MAX_PLAY_DURATION_MS), MAX_PLAY_DURATION_MS);
});

test("a clock that never started reports nothing", () => {
  assert.equal(createPlayClock().durationMs(1000), 0);
});

test("a device clock moved backwards still gives a valid duration", () => {
  const clock = createPlayClock();
  clock.start(5000);
  clock.answered(1000);
  assert.equal(clock.durationMs(1000), 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, helpers not defined.

- [ ] **Step 3: Implement**

- `prompt` is set for `quote_title`, `blurb_title` and `characters_title` when non-empty, including rows with no answers, because `service.ts:95-104` can yield `""`.
- `workId` is set with a truthy check, so old fixtures and an old backend leave the key absent and the strict `deepEqual`s at `labels.test.ts:35-36` keep passing.
- `durationMs` clamps to `[0, MAX_PLAY_DURATION_MS]`, because the server's schema rejects anything outside it.
- `answerExpands`: true when `!row.answer`, `row.workId`, or `row.pick?.kind === "cover"`.
- `playerLabel`: `guest: play.anonymous && play.playerName !== null`.
- `playDurationLabel`: below `59_950` ms use `shared.labels.seconds` (en `"{value}s"`, pt-PT `"{value} s"`) with `decimalText(ms / 1000, locale, 1)`. Otherwise round to whole seconds, then split into `m:ss` with a zero-padded seconds part.
- `routes.ts:53`: replace the literal with `MAX_PLAY_DURATION_MS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @scripta/shared`, then `npm run build --workspace @scripta/shared` and `npm run typecheck --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src backend/src/modules/quizzes/routes.ts
git commit -m "Add the shared quiz display helpers and play clock"
```

### Task 3: Web results screen

**Files:**
- Modify: `frontend/src/components/quiz/QuizResults.tsx`
- Modify: `frontend/src/components/CommunityAuthorAvatar.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/i18n/messages/en/quizzes.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/quizzes.ts`
- Test: `frontend/scripts/test-quiz-results.mts`
- Test: `frontend/scripts/test-i18n-quizzes.mts`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce.
- Produces: new keys for Task 4 to mirror, with these exact values:

| Key | en | pt-PT |
|---|---|---|
| `quizzes.youPicked` | `You picked {value}` | `Escolheu {value}` |
| `quizzes.openBook` | `Open book` | `Abrir livro` |
| `quizzes.rankOf` | `#{rank} of {total} players` | `{rank}.º de {total} jogadores` |
| `quizzes.justYou` | `Just you so far. Send the link to a friend.` | `Por agora, só você. Envie a ligação a um amigo.` |
| `quizzes.challengeMessage` | `I got {score}/{total} on {name}. Can you beat me? {url}` | `Fiz {score}/{total} em {name}. Consegue fazer melhor? {url}` |
| `quizzes.you` (web only; mobile has it) | `You` | copy mobile's pt-PT value |

- [ ] **Step 1: Write the failing tests**

In `test-quiz-results.mts`, seed `["quizPublicResults", "challenge", "play"]` in `render`, and do the same in `test-i18n-quizzes.mts`. Give seeded plays `avatarUrl` and `isYou`, and give all three existing answers a `workId`. Leave the existing `questions` and `result` as they are, because `:43-45`, `:58-61` and `:68-69` count against them. Add a third parameter, `render(play, plays, qs = questions)`, and a separate fixture for the new tests: a correct `cover_title`, then a `quote_title` miss, then a correct text row with `workId: null`. Then:

- `misses come first with their own prompt and cover`: the first `<li>` holds the quote miss's prompt; the correct cover question's image stays in its own later row.
- `a wrong text answer names the pick on the collapsed row`: html matches `/You picked Piranesi/`.
- `a quote prompt is curly-quoted, and clamped while it can expand`: the expandable quote row's prompt reads `“…”` with `line-clamp-2`; the non-expandable `workId: null` text row's prompt has no clamp.
- `desktop shows the prompt in its open panel`: the expanded panel holds an unclamped copy of the prompt with `hidden lg:block`.
- `a row with a work links to it, and one without does not`: html has `href="/work/w1"` and no link for the question whose `workId` is null.
- `a legacy result keeps its verdicts`: keep the existing test, which must still pass with no links and no `You picked`.
- `the viewer's row is highlighted without visible text`: with `isYou: true`, html matches `/<li[^>]*bg-\(--color-accent-soft\)/` and `/sr-only">You</`. The class alone isn't enough, because initial avatars and thumbnails use it too.
- `first place's rank is in the accent colour`: the first row's rank span has `text-(--color-accent)`, the second's doesn't.
- `a nameless guest reads Guest once`: `playerName: null` gives exactly one `Guest` in that `<li>`.
- `rows carry avatars`: `avatarUrl: "/a.jpg"` renders `src="/a.jpg"`; `avatarUrl: null` renders the initial.
- `the hero shows the rank, and a lone player gets the prompt instead`: two plays give `#2 of 2 players`; one `isYou` play gives no rank and `Just you so far`.
- `long times read as a clock`: `durationMs: 143200` gives `2:23`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

- `usePublicResults(code, playId)` with key `["quizPublicResults", code, playId]`, used by the hero and `QuizLeaderboard({ code, playId })`. `QuizResults` passes `playId={result.playId}`; `PlayQuizPage.tsx:106` passes `playId={null}`.
- Hero: wrap the score and the `quizzes.rankOf` line in one `div`, because the section at `QuizResults.tsx:75` is a two-column grid and a loose sibling would take the cover fan's cell.
- `const rows = scoreRows(…)`; `resultCovers` still takes that unsorted list; render `missesFirst(rows)` and look up `questions[row.number - 1]`, never the map index.
- `QuizAnswer`: prompt above the title inside the `lg:hidden` row button, curly-quoted for `quote_title` and `blurb_title`, with `line-clamp-2` only while collapsed and `answerExpands(row)` is true. Add an unclamped copy with `hidden lg:block` at the top of the always-open panel (`QuizResults.tsx:46`). `You picked` replaces `Incorrect` for a wrong text answer. Render the chevron and toggle only when `answerExpands(row)`, otherwise a plain non-interactive row.
- Below `lg`, the comparison shows only for a cover pick, the same condition as mobile, so give it `hidden lg:grid` otherwise and keep it in the markup. Add a `Link` to `/work/${row.workId}` with `quizzes.openBook` when `workId` is set, outside the two-column `grid` at `QuizResults.tsx:50`.
- `AuthorAvatar`: widen `author` to `ReaderProfile`, and change `BookScreen.tsx:482` to `author={row}`, since its explicit `userId` would now be an excess property. Leaderboard rows use size 28 with `play.playerName` label via `playerLabel`; own row wraps it in `rounded-full ring-1 ring-(--color-accent)`. First place's rank at `QuizResults.tsx:179` uses `text-(--color-accent)`.
- `ChallengeLink` takes `score`, `total`, `name`; the clipboard gets `quizzes.challengeMessage`, the visible field keeps the URL.
- Replace `quizzes.seconds` with `playDurationLabel` in `QuizResults.tsx` and `QuizEditorPage.tsx:301`, delete the key from both catalogs, and drop the `decimalText` imports at `QuizResults.tsx:3` and `QuizEditorPage.tsx:9`.
- `DESIGN.md:100` and `:102`: the results section is the score, the viewer's rank once the board has loaded, and the cover fan; rows keep the chevron and misses come first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace frontend`, `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend DESIGN.md
git commit -m "Explain misses and mark your row on web quiz results"
```

### Task 4: Mobile results screen

**Files:**
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx`
- Modify: `mobile/src/i18n/messages/en/quizzes.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/quizzes.ts`
- Test: `mobile/src/features/quizzes/quizTypeLabel.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2's exports, and Task 3's key table.

Mobile has no screen tests; logic is pinned in Tasks 1 and 2, the catalog by `mobile/src/i18n/i18n.test.ts`, and rendering by the device pass.

- [ ] **Step 1: Implement results**

- `usePublicResults(code, playId)` with key `["quizzes", "results", code, playId]`, used by the hero (`quizzes.rankOf` caption under the score inside `heroText`, from `leaderboardPosition`) and `Leaderboard({ code, playId })`. `EndScreen` passes `result.playId`; the closed stage at `QuizPlayScreen.tsx:103` passes `playId={null}`.
- `EndScreen`: keep `rows` unsorted for `resultCovers`, render `missesFirst(rows)`, and look up `board.questions[row.number - 1]`.
- `AnswerRow`: prompt in `typography.caption` above the title, curly quotes for quote and blurb types, `numberOfLines={2}` only while collapsed and `answerExpands(row)` is true. Verdict line `✗ {youPicked}` for a text pick. `Pressable` and chevron only when `answerExpands(row)`; otherwise a plain `View` with `accessible` and the same label. Keep the prompt and the pick in `accessibilityLabel`.
- Expanded body: the `AnswerValue` comparison only when `row.pick?.kind === "cover"`, the unavailable text when there's no answer, and a `quizzes.openBook` `Pressable` with a chevron doing `router.push(workPath(row.workId, segments) as never)` from `useSegments()`, as `LeaderboardScreen.tsx:67` does. Put the link below `styles.answerBody`, which is row-direction, so it doesn't become a third column.
- `Leaderboard`: `AuthorAvatar` with `username={playerLabel(play, locale).name}` and `avatarUrl={play.avatarUrl}`. Own row gets `backgroundColor: colors.accentSoft`, `borderRadius: radii.md`, matching horizontal padding and negative margin, a 1px `colors.accent` ring around the avatar, and `accessibilityLabel` starting with `t("quizzes.you")`. First place's rank uses `colors.accent`. Time uses `playDurationLabel`. A `RefreshControl` drives `leaderboard.refetch()`. The check at `QuizPlayScreen.tsx:258` becomes `isError && !data`, so a failed refresh keeps the loaded board instead of replacing it with an error. A lone viewer gets `quizzes.justYou` below the row.
- `challenge()`: `Share.share({ message: t("quizzes.challengeMessage", { score: result.score, total: board.questionCount, name: board.name, url }) })`.
- Delete `quizzes.durationSeconds` from both catalogs, and the `decimalText` import if nothing else uses it. In `quizTypeLabel.test.ts:21`, replace the assertion with `assert.equal(t("quizzes.rankOf", { rank: 3, total: 6 }), "3.º de 6 jogadores")`.

- [ ] **Step 2: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS, including the catalog parity test.

- [ ] **Step 3: Commit**

```bash
git add mobile/src
git commit -m "Explain misses and mark your row on mobile quiz results"
```

### Task 5: Fair timing and no pointless name field

**Files:**
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`

**Interfaces:**
- Consumes: `createPlayClock` from Task 2. `useAuth().user.username` on mobile, `session?.user.username` on web.

The clock's behaviour is pinned in Task 2's tests; this task is wiring, checked by review and the device pass.

- [ ] **Step 1: Wire the mobile clock**

Replace `startRef` with `const clock = useRef(createPlayClock()).current`. Call `clock.start(Date.now())` in an effect keyed on `stage === "playing"`, `clock.answered(Date.now())` in both option handlers, and send `durationMs: clock.durationMs(Date.now())`. Add a small `ElapsedCaption` component holding its own one-second interval, so the screen doesn't re-render every second, rendering `questionOf` then ` · ${seconds}s` with `clock.elapsed(Date.now(), complete)`.

- [ ] **Step 2: Wire the web clock**

Same clock in `PlayQuizPage`. The start effect must sit above the early returns at `PlayQuizPage.tsx:93-100`, and it reuses the existing helper so the condition can't drift:

```ts
const playing = quizPlayStage({ playOpen: board.data?.playOpen ?? false, hasResult: Boolean(submitted ?? ownPlay.data), ownPlayPending: ownPlay.isLoading }) === "playing";
```

Call `clock.answered(Date.now())` in `pick`. The interval at `:88-91` uses `clock.elapsed(Date.now(), complete)`, with `complete` read from a ref because the interval's closure is created once. Update the stale "timer running from first render" comment at `PlayQuizPage.tsx:3`.

- [ ] **Step 3: Hide the name field**

Render the name input only when the viewer has no username, on mobile (`QuizPlayScreen.tsx:140`) and web (`PlayQuizPage.tsx:161-170`). The submit button stays. A signed-in user with no username keeps the field, because `toResultPlay` uses their typed name.

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace mobile`, `npm test --workspace mobile`, `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend`, `npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/quizzes/QuizPlayScreen.tsx frontend/src/pages/PlayQuizPage.tsx
git commit -m "Time quizzes from the first question to the last answer"
```

## Before merge

- `device-checker` on a played quiz: both tabs, an expanded miss, Open book, pull-to-refresh, highlighted row in light and dark, a long blurb and a pt-PT name, plus the running-time caption and the name field signed in and as a guest. It gates the merge, not the PR.
- A browser pass on web at phone width and `lg`, because the SSR tests can't see layout or timing: the desktop prompt, the hero with the cover fan, the running time, and the name field signed in and as a guest.
- This branch changes what a public route returns about players, so run the `security-review` skill.
- `branch-reviewer` with the spec and plan, and `node scripts/codex-review.mjs branch docs/superpowers/specs/2026-11-03-quiz-results-design.md docs/superpowers/plans/2026-11-03-quiz-results.md` in the background, in parallel.
- Deploy needs no migration. Backend ships first in the normal deploy; phones get it by OTA, with no store build.
