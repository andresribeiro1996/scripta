# Mobile Home Cover Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the mobile Home tab with three additions and keep everything it has today:
- a hero Daily Chapter card that knows today's score
- a "New games" section
- a "Currently reading" row

**Architecture:**
- All changes are in `mobile/`. There are no backend changes and no `@scripta/shared` changes.
- Pure logic goes in two model files tested with `node --test`:
  - `mobile/src/features/home/homeModel.ts`
  - `mobile/src/features/dailyChapter/dailyCardModel.ts`
- Three small components render it in `HomeScreen`'s `ListHeaderComponent`:
  - `HomeNewGames`
  - `HomeReadingRow`
  - `HomeSectionHeader`
- `DailyChapterCard` is restyled in place.

**Tech Stack:** Expo / React Native, expo-router, TanStack Query, `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-15-home-cover-story-design.md`

## Global Constraints

- **Nothing on Home today is removed or moved out.** That covers:
  - the header (brand mark, stats when chapters exist, bell with badge, saved)
  - `RecapHomeCard` and `AwardHomeCard`
  - the no-library onboarding
  - the reading-circle feed with likes, comments, paging, pull to refresh, and its empty and error states
- **Order in `ListHeaderComponent`:**
  1. `DailyChapterCard`
  2. `RecapHomeCard`
  3. `AwardHomeCard`
  4. onboarding
  5. `HomeNewGames`
  6. `HomeReadingRow`
  7. Then the existing circle section, whose header is restyled.
- **Colours come only from `useTheme().colors`.** No hex, and no new `ThemeColors` token.
- **Headings use the theme's display face**, via `<Text display>` or `fontSize >= 18`. No hard-coded font family.
- **No ↗ glyph.** Rows end with a › chevron, `<Icon name="chevronRight" size={16} color={colors.textDim} />`.
- **Text and targets:**
  - All `Text` spreads `{...dynamicType}`.
  - Every pressable has `minHeight: minimumTouchTarget` and an `accessibilityRole` of `link` or `button`.
- **Strings:**
  - Every new string lives in `mobile/src/i18n/messages/en/*.ts` and `mobile/src/i18n/messages/pt-PT/*.ts` with identical keys.
  - Use European Portuguese with the "o seu" register, matching the existing pt-PT files.
- **Fixture content stays out:** no issue number, "Today's plot.", "By Atmyshelf", or invented counts.
- **Repo rules:** no code comments, and no new dependencies.

## Review Focus

1. **A history load that fails or is still pending must leave the card in the Play state, never hidden or broken.** Task 2 tests `dailyCardAction` with `undefined` history.
2. **Yesterday's result must not show as today's.** History holds many days, so matching is by `board.id` (`editionId`), never by "latest". Task 2 tests this.
3. **A library whose reading books have no `DateLastRead`, or an unparseable one, must still show one book.** It must not show none, and must not crash. Task 1 tests this.
4. **A discover page whose first items are fewer than two must render what's there.** When it's empty, the section is hidden with no empty or error block. Task 1 tests the row model with 0, 1 and 3 items. Task 3 hides the section on error.
5. **A deleted or unavailable author must still render a sensible "by" line.** Task 1 tests an `unavailable` author.

---

### Task 1: Home model — reading pick and new-game rows

**Files:**
- Create: `mobile/src/features/home/homeModel.ts`
- Test: `mobile/src/features/home/homeModel.test.ts`
- Modify: `mobile/src/i18n/messages/en/community.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/community.ts`

**Interfaces:**
- Produces:
  - `currentRead(books: LibraryBook[] | undefined): LibraryBook | null`
  - `newGameRows(items: DiscoverItem[], locale: Locale): NewGameRow[]`
  - `type NewGameRow = { key: string; content: PublishedContent; kind: string; name: string; meta: string; target: string }`

Why this lives in mobile and not `@scripta/shared`: `packages/AGENTS.md` only admits code that more than one consumer needs, and only mobile Home uses these.

- [ ] **Step 1: Write the failing tests** in `homeModel.test.ts`. Set `process.env.TZ = "America/Sao_Paulo"` at the top, as `libraryView.test.ts` does.

```ts
test("currentRead picks the reading book read most recently", () => {
  const books = [
    { Title: "Old", ReadStatus: 1, DateLastRead: "2026-01-02" },
    { Title: "Done", ReadStatus: 2, DateLastRead: "2026-11-10" },
    { Title: "New", ReadStatus: 1, DateLastRead: "2026-11-01T09:00:00Z" },
  ];
  assert.equal(currentRead(books)?.Title, "New");
});
test("currentRead sorts undated or unparseable dates last and keeps library order on ties", () => {
  assert.equal(currentRead([{ Title: "A", ReadStatus: 1 }, { Title: "B", ReadStatus: 1, DateLastRead: "garbage" }])?.Title, "A");
  assert.equal(currentRead([{ Title: "A", ReadStatus: 1 }, { Title: "B", ReadStatus: 1, DateLastRead: "2020-01-01" }])?.Title, "B");
});
test("currentRead is null with no library or nothing reading", () => {
  assert.equal(currentRead(undefined), null);
  assert.equal(currentRead([{ Title: "A", ReadStatus: 2 }]), null);
});
test("newGameRows keeps the first two items", () => {
  assert.deepEqual(newGameRows([quiz, tournament, tierlist], "en").map((row) => row.name), ["Guess the classic", "The fantasy final"]);
  assert.equal(newGameRows([quiz], "en").length, 1);
  assert.deepEqual(newGameRows([], "en"), []);
});
test("newGameRows meta names the author and the kind's headline count", () => {
  const [q, t, l] = [quiz, tournament, tierlist].map((item) => newGameRows([item], "en")[0]!);
  assert.equal(q.meta, "by @joao · 248 plays");
  assert.equal(t.meta, "by @marta · 16 books");
  assert.equal(l.meta, "by @ana · 7 ballots");
  assert.equal(q.target, contentTarget(quiz.content));
  assert.equal(q.kind, contentKindLabel(quiz.content, "en"));
});
test("newGameRows meta for an unavailable author", () => {
  const gone = { ...quiz, author: { ...quiz.author, username: "Original creator unavailable", unavailable: true } };
  assert.equal(newGameRows([gone], "en")[0]!.meta, "Original creator unavailable · 248 plays");
});
test("newGameRows meta in pt-PT", () => {
  assert.match(newGameRows([quiz], "pt-PT")[0]!.meta, /^de @joao · 248 /);
});
```

- Build the `quiz`, `tournament` and `tierlist` `DiscoverItem` fixtures from the types in `packages/shared/src/community/types.ts:17-76`, with every required field so they type-check:
  - quiz: `playCount: 248`
  - tournament: `bracketSize: 16` and `bookCount: 16`, plus `status` and `covers`
  - tierlist: `ballotCount: 7`
- `feedRowModel.test.ts` shows the fixture style.
- An unavailable author arrives from the backend with `username: "Original creator unavailable"` (`backend/src/modules/community/service.ts:503`).

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd mobile && node --import tsx --test src/features/home/homeModel.test.ts`
Expected: FAIL, because `homeModel.js` can't be resolved.

- [ ] **Step 3: Implement `homeModel.ts`**
- **`currentRead`:**
  - Filter `ReadStatus === 1`.
  - Order by `parseBookDate(book.DateLastRead)?.getTime()` descending, with null last.
  - Use a stable sort (`Array.prototype.sort` is stable) and return the first, or `null`.
- **`newGameRows`:**
  - Take `items.slice(0, 2)`.
  - The headline count is the last entry of `contentStats(content, locale)`, rendered `${value} ${label}`.
  - `meta` is `t("community.homeGameBy", { username })` + ` · ` + that count.
  - When `author.unavailable` is true, use the plain `username` instead of the "by @" string, as `DiscoverRow` does.
  - This task adds `community.homeGameBy`: en `"by @{username}"`, pt-PT `"de @{username}"`.
  - Take `contentKindLabel`, `contentStats` and `contentTarget` from `./../community/communityHome`, which re-exports them, and `parseBookDate` from `@scripta/shared`.
  - Get `t` through `translatorFor(locale)` from `../../i18n`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/home/homeModel.ts mobile/src/features/home/homeModel.test.ts mobile/src/i18n/messages/en/community.ts mobile/src/i18n/messages/pt-PT/community.ts
git commit -m "Pick Home's current read and new-game rows"
```

### Task 2: Daily Chapter hero card with today's score

**Files:**
- Create: `mobile/src/features/dailyChapter/dailyCardModel.ts`
- Test: `mobile/src/features/dailyChapter/dailyCardModel.test.ts`
- Modify: `mobile/src/features/dailyChapter/use-daily-history.ts`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-screen.tsx:22-26`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-card.tsx`
- Modify: `mobile/src/i18n/messages/en/quizzes.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/quizzes.ts`

**Interfaces:**
- Produces:
  - `dailyCardAction(boardId: string, history: DailyChapterHistory | undefined): { kind: "play" } | { kind: "results"; score: number }`
  - `useChapterHistory(date: string | undefined): UseQueryResult<DailyChapterHistory>`, exported from `use-daily-history.ts`

- [ ] **Step 1: Write the failing tests** in `dailyCardModel.test.ts`:

```ts
const history = (results: Array<{ editionId: string; score: number; date: string }>) => ({ results, today: "2026-11-15" }) as unknown as DailyChapterHistory;
test("unplayed or unknown history offers play", () => {
  assert.deepEqual(dailyCardAction("ed-15", undefined), { kind: "play" });
  assert.deepEqual(dailyCardAction("ed-15", history([])), { kind: "play" });
});
test("today's result shows its score", () => {
  assert.deepEqual(dailyCardAction("ed-15", history([{ editionId: "ed-15", score: 4, date: "2026-11-15" }])), { kind: "results", score: 4 });
  assert.deepEqual(dailyCardAction("ed-15", history([{ editionId: "ed-15", score: 0, date: "2026-11-15" }])), { kind: "results", score: 0 });
});
test("yesterday's result is not today's", () => {
  assert.deepEqual(dailyCardAction("ed-15", history([{ editionId: "ed-14", score: 5, date: "2026-11-14" }])), { kind: "play" });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd mobile && node --import tsx --test src/features/dailyChapter/dailyCardModel.test.ts`
Expected: FAIL, because the module can't be resolved.

- [ ] **Step 3: Implement `dailyCardAction`** in `dailyCardModel.ts`. It uses `history?.results.find((result) => result.editionId === boardId)`.

- [ ] **Step 4: Run the tests and confirm they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Lift the `/daily` history query into `useChapterHistory(date)`** in `use-daily-history.ts`.
- Move the query from `daily-chapter-screen.tsx:25` unchanged:
  - key `["daily-chapter","history", user?.id ?? "guest", identity.data, date]`
  - `queryFn: () => dailyChapterApi.history(identity.data!, Boolean(user))`
  - `enabled: ready && !unreachable && Boolean(identity.data && date)`
- `daily-chapter-screen.tsx` calls `useChapterHistory(daily.data?.date)` in place of its inline query. Its behaviour is otherwise unchanged.
- Leave `useDailyHistory` as it is.

- [ ] **Step 6: Restyle `DailyChapterCard`**
- **States:**
  - Call `const history = useChapterHistory(daily.data?.date);` and `const { fontScale } = useWindowDimensions();` right after the `daily` query, before any early return. A hook after the `if (!board) return null` crashes once the board loads.
  - It still returns `null` without a board.
  - It then reads `dailyCardAction(board.id, history.data)`.
- **Surface:**
  - A `View` with `backgroundColor: colors.accentSoft`, `borderRadius: radii.xl`, `padding: spacing.lg`, `marginHorizontal: spacing.md`, `marginTop: spacing.lg`, and `gap: spacing.sm`.
- **Contents:**
  - The caption `quizzes.theDailyChapter` (`typography.caption`, `textDim`).
  - `board.title` as `<Text display>` at `typography.heading`.
  - The `quizzes.dailyCardMeta` line.
  - `DailyChapterArt motif={board.theme.motif}` top-right, beside the caption and title.
  - When `fontScale > 1.3`, the art renders above the text instead of beside it.
- **Button:** the existing `Button` (`variant="primary"`), full width, `onPress={() => router.push("/daily")}`.
  - Label `quizzes.dailyCardPlay` for play, or `quizzes.dailyCardResults` with `{ score }` for results.
  - `accessibilityLabel` is `quizzes.dailyCardLabel` with `{ title }` when playing, and `quizzes.dailyCardResultsLabel` with `{ score, title }` when played.
- **Strings:**
  - en:
    - `"quizzes.dailyCardPlay": "Play today's chapter"`
    - `"quizzes.dailyCardResults": "You scored {score}/5 · See results"`
    - `"quizzes.dailyCardResultsLabel": "You scored {score}/5 in The Daily Chapter: {title}. See results"`
  - pt-PT:
    - `"Jogar o capítulo de hoje"`
    - `"Fez {score}/5 · Ver resultados"`
    - `"Fez {score}/5 n'O Capítulo do Dia: {title}. Ver resultados"`
  - Delete `quizzes.dailyCardOpen` from both files if `rg -n dailyCardOpen mobile/src` finds no other user.

- [ ] **Step 7: Run typecheck and tests**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: both pass, including the en/pt-PT parity tests.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/features/dailyChapter mobile/src/i18n/messages/en/quizzes.ts mobile/src/i18n/messages/pt-PT/quizzes.ts
git commit -m "Make the Daily Chapter the Home hero and show today's score"
```

### Task 3: New games section and shared Home section header

**Files:**
- Create: `mobile/src/features/home/HomeSectionHeader.tsx`
- Create: `mobile/src/features/home/HomeNewGames.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/i18n/messages/en/community.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/community.ts`

**Interfaces:**
- Consumes: `newGameRows`, `NewGameRow` (Task 1).
- Produces:
  - `HomeSectionHeader({ title, linkLabel, onLink }: { title: string; linkLabel: string; onLink: () => void })`
  - `NEW_GAMES_QUERY_KEY = ["home", "new-games"] as const`, exported from `HomeNewGames.tsx`
  - `HomeNewGames()`

- [ ] **Step 1: Build `HomeSectionHeader`.** Move the existing circle header markup out of `HomeScreen.tsx:66-69`:
  - The title becomes `<Text display accessibilityRole="header">` at `typography.title`.
  - Keep the link `Pressable` (`accessibilityRole="link"`, `minHeight: minimumTouchTarget`, accent caption).
  - `HomeScreen`'s `renderSectionHeader` renders `<HomeSectionHeader title={section.title} linkLabel={t("community.findPeopleArrow")} onLink={findReaders} />`.

- [ ] **Step 2: Build `HomeNewGames`.**
- **Data:**
  - `useQuery({ queryKey: NEW_GAMES_QUERY_KEY, queryFn: () => fetchDiscover("all", "", 0), retry: false })`, with `fetchDiscover` from `../community/api`.
  - `rows = newGameRows(data?.items ?? [], locale)`.
- **States:**
  - While pending: `<Skeleton height={64} />` inside the section's margins.
  - When there are no rows or the query errored, render `null`.
- **Header:** `HomeSectionHeader` with title `community.homeNewGames` and link `community.homeSeeAllGames`. `onLink` is `router.navigate("/my-arena" as never)`.
- **Each row:**
  - A `Pressable`, `accessibilityRole="link"`, `onPress={() => router.push(row.target as never)}`.
  - **Art:** use `CoverFan` (`../community/CoverFan`) the way the Home feed's `FeedPreview.tsx:34-36` does: `covers={row.content.covers.slice(0, FAN_SIZE)}` and `inset={0}`, in a box `fanWidth(n)` wide by `SLOT_HEIGHT` tall.
    - Not `GameTicketArt`: its fixed sizes run 80+ wide and make the rows tall.
    - With no covers, show the same `iconTile` fallback `FeedPreview` uses.
  - **Kind colour:** take it from `GameRow` (`DiscoverRow.tsx:86`). Quiz → `colors.reference`, tierlist → `colors.success`, tournament → `colors.accent`.
  - A column: `row.kind` (caption, in the kind colour), `row.name` (`typography.body`, bold, `numberOfLines={1}`), `row.meta` (caption, `textDim`, `numberOfLines={1}`).
  - The trailing chevron.
  - Rows sit on `colors.surface` with `radii.lg` and `gap: spacing.sm` between them.
- **Strings:**
  - en: `"community.homeNewGames": "New games"`, `"community.homeSeeAllGames": "See all ›"`.
  - pt-PT: `"Jogos novos"`, `"Ver todos ›"`.
  - Keep `community.homeGameBy` from Task 1.

- [ ] **Step 3: Wire `HomeNewGames` into `HomeScreen`.**
  - Render it after the onboarding block in `ListHeaderComponent`.
  - Add `queryClient.invalidateQueries({ queryKey: NEW_GAMES_QUERY_KEY })` to both the `useFocusEffect` callback and `onRefresh`'s `Promise.all`.

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/home mobile/src/i18n/messages/en/community.ts mobile/src/i18n/messages/pt-PT/community.ts
git commit -m "Show the two newest games on Home"
```

### Task 4: Currently reading row

**Files:**
- Create: `mobile/src/features/home/HomeReadingRow.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/i18n/messages/en/community.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/community.ts`

**Interfaces:**
- Consumes: `currentRead` (Task 1).
- Produces: `HomeReadingRow({ books }: { books: LibraryBook[] | undefined })`

- [ ] **Step 1: Build `HomeReadingRow`.**
- **Book:** `book = currentRead(books)`; return `null` when there's no book.
- **Pressable:** `accessibilityRole="link"`, `onPress={() => router.push(\`/book/${encodeURIComponent(bookKey(book))}\` as never)}`, `minHeight: minimumTouchTarget`, `marginHorizontal: spacing.md`, `marginTop: spacing.lg`.
- **Contents:**
  - `CoverImage book={book}` (`../library/components/CoverImage`) in a box about 36×54 with `radii.sm`.
  - A caption: `community.homeReadingPercent` with `{ percent }` when `readingPercent(book) !== null`, otherwise `community.homeReading`.
  - `${String(book.Title ?? "")} · ${String(book.Attribution ?? "")}`, with `numberOfLines={1}`. Drop the " · " when there's no `Attribution`.
  - The trailing chevron.
- **Strings:**
  - en: `"community.homeReading": "Currently reading"`, `"community.homeReadingPercent": "Currently reading · {percent}%"`.
  - pt-PT: `"A ler agora"`, `"A ler agora · {percent}%"`.

- [ ] **Step 2: Wire it into `HomeScreen`.** Render `<HomeReadingRow books={actions.library.data?.data.books} />` right after `<HomeNewGames />`. The library already refetches on focus and on refresh.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/features/home mobile/src/i18n/messages/en/community.ts mobile/src/i18n/messages/pt-PT/community.ts
git commit -m "Show the current read on Home"
```

### Task 5: Device pass (main session only, not an implementer)

**Files:**
- Test: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/features/home/HomeNewGames.tsx`
- Modify: `mobile/src/features/home/HomeReadingRow.tsx`
- Modify: `mobile/src/features/home/HomeSectionHeader.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-card.tsx`

The `Modify` lines are only for fixes the pass turns up.

- [ ] **Step 1: Check whether the emulator is free.** Run `node scripts/dev-status.mjs --json`. If another worktree holds the emulator, stop and report. Do not take the lease.

- [ ] **Step 2: Dispatch `device-checker`** with this worktree path and these Home checks:
  1. **Light theme, unplayed chapter.**
     - The card has the accentSoft panel, the real title in the display face, and "Play today's chapter".
     - All header buttons (stats, bell, saved) are present.
  2. **After playing.** The card reads "You scored N/5 · See results" and opens `/daily` with the results.
  3. **New games.**
     - Two rows show the fan art, kind, name and "by @user · count".
     - Tapping a row opens that game.
     - "See all ›" switches to the Games tab, not a copy stacked on Home. If it stacks, report it, and replace `router.navigate` with the fix in Task 3's file.
     - On a first visit it lands on Browse.
     - If the Games tab was already left on another pane, it keeps that pane. That's accepted; the pane is local state in `ArenaHomeScreen.tsx:43`.
  4. **Currently reading** shows a book with a percent. When no book is marked reading, the row is absent.
  5. **Circle feed:** likes, comments, paging and pull to refresh all still work, and the Recap and Award cards still show when present.
  6. **Theme and size checks:** dark theme, one non-serif theme (matrix or synthwave), and the largest system text size.
     - Nothing clips.
     - The Daily Chapter art moves above the text at large sizes.

- [ ] **Step 3: Fix anything the pass finds** in the owning task's files. Then re-run `npm run typecheck --workspace mobile && npm test --workspace mobile` and commit.
