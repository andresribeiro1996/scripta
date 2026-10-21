# Games Hall of Fame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global "Hall of fame" reached from a trophy in the Games header: a podium, book records, genre champions and hottest games for This month / All time and any genre, plus a shared top-10 leaderboard screen.

**Architecture:** Each game module (tier lists, arena, quizzes) exposes raw per-game facts through its public API; community exposes publish times, likes/comments and Discover visibility per game. A pure ranking function in the backend `works` module turns those facts into boards; a service decorates the shown works with title/author/cover and serves one endpoint, `GET /hall-of-fame`. Mobile renders it with two screens over a new scroll-hiding bottom bar extracted from `SearchDock`.

**Tech Stack:** Fastify + node:sqlite (backend), `@scripta/shared` (types + API client), Expo Router / React Native (mobile), node:test everywhere.

**Spec:** `docs/superpowers/specs/2026-10-21-games-hall-of-fame-design.md` — read it first; this plan argues from it.

## Global Constraints

- Mobile only; no `frontend/` changes.
- Vote bar: a game feeds book records, podium and genre champions only with ≥ `HALL_OF_FAME_MIN_VOTERS = 5` distinct voters, owner excluded, anonymous included. One named constant, defined once (`backend/src/modules/works/hallOfFame.ts`).
- Highest tier needs ≥ `HIGHEST_TIER_MIN_LISTS = 3` qualifying tier lists.
- Points: tournament title = 3; each appearance in a tournament, tier list or quiz = 1. Ties: titles desc, latest appearance desc, work id asc.
- "This month" = calendar month in `Europe/Lisbon`, computed on the server.
- Visibility = the Discover rule (owner resolves to a public profile, or a promoted tier list). Live tables at read time; deleted/unpublished games vanish from every period.
- A work counts at most once per game, after canonicalizing with `canonicalWorks`.
- Hottest games: likes + votes + comments in the period, all visible published games, no vote bar, not genre-filtered; owner's own votes excluded.
- No new comments in code (repo rule). Backend tests must be appended to the explicit list in `backend/package.json` `test` script.
- Shared changes need `npm run build --workspace @scripta/shared` before mobile/backend typecheck.

## Review Focus

1. Start of a month (nothing qualifies yet) — main screen shows an "empty for now" state per section, never a broken podium; a podium with 1–2 books renders those only. → Task 8 model test `emptySections`.
2. Two editions of one work in a game, or a game stored under a since-merged work id — counted once, under the canonical id. → Task 5 test `counts a work once per game after canonicalizing`.
3. Publish event older than 30 days (moved to `events_history`) — still found, so the game is not bucketed by its draft `created_at`. → Task 4 test `finds publish times in events_history`.
4. Tournament slot with a NULL `work_id`, or a completed tournament whose final has no winner — ignored, no crash. → Task 2 test `skips null slots and undecided finals`.
5. A genre chosen in All time that has no entries this month — selection kept, menu still lists it, boards show empty state. → Task 8 model test `keeps the selected genre in the menu`.

---

### Task 1: Tier lists — hall-of-fame facts

**Files:**
- Modify: `backend/src/modules/tierlists/domain/ports.ts`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts`
- Modify: `backend/src/modules/tierlists/service.ts`
- Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`
- Modify: `backend/src/modules/tierlists/service.test.ts`

**Interfaces:**
- Produces, on the repository port, the service and `TierlistsPublicApi`:
  ```ts
  type TierlistHallFacts = {
    id: string; ownerUserId: string; createdAt: string;
    voters: number; votesSince: number; workIds: string[];
    placements: Array<{ workId: string; tierIndex: number; tierCount: number; ranksWorstFirst: boolean; castAt: string }>;
  };
  hallOfFameFacts(since: string | null): TierlistHallFacts[];
  ```
  Published lists only (`vote_code IS NOT NULL`). `ownerUserId` = `origin_user_id ?? owner_user_id`. `voters` = all-time ballots not by the owner (same owner rule as `eligibleCountStmt`), anonymous included. `votesSince` = those ballots with `created_at >= since` (all when `since` is null). `workIds` from `tierlist_works`, distinct, as stored. `placements` = exactly the rows `tierPlacements` counts (signed-in ballots), with `castAt` = ballot `created_at`, unfiltered by `since`.

- [ ] **Step 1: Write failing repo tests** in the repository test file: `hallOfFameFacts returns published lists only`; `counts voters without the owner and with anonymous ballots` (owner ballot + 2 signed-in + 1 anonymous → `voters === 3`); `votesSince counts ballots created at or after since` (re-casting a ballot does not move it: `updated_at` changes, count unchanged); `placements match tierPlacements and carry castAt`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** the port method, SQL, service passthrough and public-API entry; add the method to the in-memory fake in `service.test.ts` so it compiles.
- [ ] **Step 4: Run** the repo test file and `npm run typecheck --workspace backend` — PASS.
- [ ] **Step 5: Commit** `git add` the five files, message "Expose tier list facts for the hall of fame".

### Task 2: Arena — hall-of-fame facts

**Files:**
- Modify: `backend/src/modules/arena/domain/ports.ts`
- Modify: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts`
- Modify: `backend/src/modules/arena/service.ts`
- Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`
- Modify: `backend/src/modules/arena/service.test.ts`

**Interfaces:**
- Produces on port, service and `ArenaPublicApi`:
  ```ts
  type TournamentHallFacts = {
    id: string; ownerUserId: string; createdAt: string;
    voters: number; votesSince: number; workIds: string[];
    champion: { workId: string; settledAt: string } | null;
  };
  hallOfFameFacts(since: string | null): TournamentHallFacts[];
  ```
  Published = `status != 'seeding'`. `voters` = distinct `COALESCE(voter_user_id, voter_token)` across the tournament's duels, excluding the owner's user id. `votesSince` = vote rows (not voters) with `created_at >= since`, owner excluded. `workIds` = distinct non-null `tournament_slots.work_id`. `champion` only when `status = 'completed'` and the final (max round) duel is settled with a `winner_side`: the winning side's work id and that duel's `settled_at`; null otherwise.

- [ ] **Step 1: Failing tests:** `hallOfFameFacts skips seeding tournaments`; `counts distinct voters by user or token, without the owner` (one token voting 3 duels → 1 voter, `votesSince` 3); `champion is the final duel winner with its settled_at`; `skips null slots and undecided finals` (slot with null work id absent from `workIds`; completed-but-unsettled final → `champion === null`).
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts` — FAIL.
- [ ] **Step 3: Implement** port, SQL (reuse the final-duel join pattern already in the repo), service + public API, fake in `service.test.ts`.
- [ ] **Step 4: Run** the file + backend typecheck — PASS.
- [ ] **Step 5: Commit** "Expose tournament facts for the hall of fame".

### Task 3: Quizzes — hall-of-fame facts

**Files:**
- Modify: `backend/src/modules/quizzes/domain/ports.ts`
- Modify: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Test: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`
- Modify: `backend/src/modules/quizzes/service.test.ts`

**Interfaces:**
- Produces `QuizHallFacts = { id; ownerUserId; createdAt; voters; votesSince; workIds }` (same field meanings as Task 1) and `hallOfFameFacts(since: string | null): QuizHallFacts[]` on port, service and `QuizzesPublicApi`. Published = `vote_code IS NOT NULL`; `voters` = plays not by the owner (each anonymous play is one); `votesSince` = those plays since `since`; `workIds` from `quiz_works`.

- [ ] **Step 1: Failing tests:** `hallOfFameFacts returns published quizzes with plays excluding the owner`; `votesSince counts plays at or after since`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts` — FAIL.
- [ ] **Step 3: Implement** port, SQL, service, public API, fake.
- [ ] **Step 4: Run** file + typecheck — PASS.
- [ ] **Step 5: Commit** "Expose quiz facts for the hall of fame".

### Task 4: Community — engagement, publish times and visibility per game

**Files:**
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteEngagementRepository.ts`
- Modify: `backend/src/modules/community/service.ts`
- Test: `backend/src/modules/community/engagement.test.ts`
- Test: `backend/src/modules/community/service.test.ts`

**Interfaces:**
- `type GameRef = { kind: "tierlist" | "tournament" | "quiz"; id: string }`; keys are `` `${kind}:${id}` ``.
- Produces on `CommunityPublicApi`:
  ```ts
  gameEngagement(refs: GameRef[], since: string | null): Map<string, { publishedAt: string; likes: number; comments: number }>;
  discoverItems(refs: GameRef[]): Map<string, DiscoverItem>;
  ```
  `gameEngagement` reads the publish event (`tierlist_published` / `tournament_published` / `quiz_published`, matched on `ref_type`/`ref_id`) from `events` **and** `events_history`; `likes`/`comments` = rows on that event with `created_at >= since` (all when null). A ref with no publish event is absent from the map. `discoverItems` builds the same `DiscoverItem` Discover builds (extract the per-item author/content construction from `getDiscover` into one function both use), returning only refs Discover would show.

- [ ] **Step 1: Failing tests:** in `engagement.test.ts` (it already opens a scratch community DB and builds the engagement repository): `finds publish times in events_history`; `counts likes and comments since a time`. Service: `discoverItems drops games whose owner has no public profile`; `discoverItems keeps a promoted tier list as Original creator unavailable`; `getDiscover output is unchanged` (existing Discover tests still pass after the extraction).
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/community/engagement.test.ts src/modules/community/service.test.ts` — FAIL.
- [ ] **Step 3: Implement** the repo query, the extraction and both public-API methods.
- [ ] **Step 4: Run** both files + typecheck — PASS.
- [ ] **Step 5: Commit** "Expose per-game engagement and Discover visibility to other modules".

### Task 5: Hall-of-fame ranking (pure)

**Files:**
- Create: `backend/src/modules/works/hallOfFame.ts`
- Test: `backend/src/modules/works/hallOfFame.test.ts`
- Modify: `backend/src/modules/works/stats.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes the fact types from Tasks 1–4 (redeclare structurally here; do not import across modules).
- Extract from `stats.ts` `tiers()` a shared `tierPosition(p: { tierIndex: number; tierCount: number; ranksWorstFirst: boolean }): number | null` (null when `tierCount < 2`); `stats.ts` keeps its behaviour.
- Produces:
  ```ts
  export const HALL_OF_FAME_MIN_VOTERS = 5;
  export const HIGHEST_TIER_MIN_LISTS = 3;
  export type HallBoard = "champions" | "crowned" | "tiered" | "highestTier" | "quizzed" | "risingStar";
  export function hallOfFameMonthStart(now: Date): string;   // ISO UTC instant of 00:00 on the 1st in Europe/Lisbon
  export type RankInput = {
    tierlists: TierlistHallFacts[]; tournaments: TournamentHallFacts[]; quizzes: QuizHallFacts[];
    engagement: Map<string, { publishedAt: string; likes: number; comments: number }>;
    visible: Set<string>;                       // game keys discoverItems returned
    canonical: Map<string, string>;             // raw work id -> canonical
    genres: Map<string, { genres: string[] }>;  // canonical work id -> genres
  };
  export type Ranked = { workId: string; value: number };
  export function rankHallOfFame(input: RankInput, opts: { since: string | null; genre: string | null }): {
    boards: Partial<Record<HallBoard, Ranked[]>>;   // full ordering; risingStar only when since !== null
    genres: string[];                               // genres with ≥1 champions entry in the period, by champion points desc
    genreChampions: Array<{ genre: string; entry: Ranked }>; // empty when opts.genre is set
    games: Array<{ key: string; likes: number; votes: number; comments: number }>; // score desc, zero-score dropped
  };
  ```
  Rules (from the spec): a game is in play only if its key is in `visible`. Book boards use only games with `voters >= HALL_OF_FAME_MIN_VOTERS`. A game's publish time = `engagement.get(key)?.publishedAt ?? createdAt`; "in period" = `>= since`. tiered/quizzed = count of in-period games of that kind containing the work; crowned = champions with `settledAt` in period; champions = 3×titles + appearances (all three kinds); highestTier = mean over lists of each list's mean `tierPosition` for in-period placements (`castAt >= since`), only works with ≥3 such lists, ascending (lower = better, matches `tierLetter`); risingStar = works whose earliest qualifying-game publish time (all time) is in period, valued by in-period appearances. `genre` filters every book board to works whose genres include it. Ties per Global Constraints; highestTier ties by lists desc then work id.

- [ ] **Step 1: Failing tests** (fake inputs, no DB): `hallOfFameMonthStart` — `2026-10-21T10:00:00Z → "2026-09-30T23:00:00.000Z"`, `2026-11-15T12:00:00Z → "2026-11-01T00:00:00.000Z"`, `2026-09-30T23:30:00Z → "2026-09-30T23:00:00.000Z"`; `ignores games under the vote bar` (4 voters excluded, 5 included); `ignores games Discover hides`; `counts a work once per game after canonicalizing`; `scores a title as 3 and an appearance as 1`; `breaks ties by titles, then latest appearance, then work id`; `highest tier needs three lists and ranks lower scores first`; `rising star only in a month and only for first appearances`; `uses the publish event time, falling back to createdAt`; `genre filters book boards and empties genreChampions`; `hottest games sum likes votes and comments in the period and ignore the vote bar`; `stats getStats is unchanged` (existing `stats.test.ts` passes).
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/works/hallOfFame.test.ts` — FAIL.
- [ ] **Step 3: Implement** `hallOfFame.ts` and the `tierPosition` extraction; month start via `Intl.DateTimeFormat` parts for `Europe/Lisbon` (no new dependency).
- [ ] **Step 4: Append** `src/modules/works/hallOfFame.test.ts` to the `test` script list in `backend/package.json`; run `npm test --workspace backend` — PASS.
- [ ] **Step 5: Commit** "Rank the games hall of fame".

### Task 6: Shared types and API client

**Files:**
- Create: `packages/shared/src/hallOfFame/types.ts`
- Create: `packages/shared/src/hallOfFame/api.ts`
- Create: `packages/shared/src/hallOfFame/index.ts`
- Test: `packages/shared/src/hallOfFame/api.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HallOfFamePeriod = "month" | "all";
  export type HallOfFameBoard = "champions" | "crowned" | "tiered" | "highestTier" | "quizzed" | "risingStar";
  export type HallOfFameView = HallOfFameBoard | "games";
  export type HallOfFameBook = { workId: string; title: string; author: string; coverUrl: string | null; value: number };
  export type HallOfFameGame = { item: DiscoverItem; likes: number; votes: number; comments: number };
  export type HallOfFame = {
    period: HallOfFamePeriod; genre: string | null; genres: string[];
    boards: Partial<Record<HallOfFameBoard, HallOfFameBook[]>>;
    genreChampions: Array<{ genre: string; book: HallOfFameBook }>;
    games: HallOfFameGame[];
  };
  export function createHallOfFameApi(request: ApiRequest): {
    fetchHallOfFame(query: { period: HallOfFamePeriod; genre: string | null; view?: HallOfFameView }): Promise<HallOfFame>;
  };
  ```
  Path `/hall-of-fame?period=…[&genre=…][&view=…]` (omit absent params; encode values), `auth: "optional"`. Follow `works/api.ts`.

- [ ] **Step 1: Failing test** `fetchHallOfFame builds the path and omits empty params` (`{period:"month",genre:null}` → `/hall-of-fame?period=month`; `{period:"all",genre:"Science fiction",view:"crowned"}` → `/hall-of-fame?period=all&genre=Science%20fiction&view=crowned`).
- [ ] **Step 2: Run** `npm test --workspace @scripta/shared` — FAIL.
- [ ] **Step 3: Implement** the three files and re-export from `src/index.ts`.
- [ ] **Step 4: Run** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared` — PASS.
- [ ] **Step 5: Commit** "Add hall of fame types and client".

### Task 7: `GET /hall-of-fame` endpoint

**Files:**
- Create: `backend/src/modules/works/hallOfFameService.ts`
- Modify: `backend/src/modules/works/routes.ts`
- Modify: `backend/src/modules/works/plugin.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/works/hallOfFameService.test.ts`
- Test: `backend/src/modules/works/routes.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes Tasks 1–6.
- `createHallOfFameService(deps)` with deps as plain functions, wired in `app.ts` like the stats deps: `tierlistFacts`, `tournamentFacts`, `quizFacts` (each `(since) => …`), `gameEngagement`, `discoverItems`, `canonicalWorks`, `catalogGenres`, `workCard(id): { title: string; author: string; coverUrl: string | null } | undefined` (build from `getWorkPage` the way `WorksService.getPage` derives the cover), `now(): Date`.
- `getHallOfFame(query: { period; genre; view? }): HallOfFame`. Without `view`: `champions` top 3, every other book board top 1, `games` top 3, `genreChampions` all. With a book `view`: that board top 10, others omitted. With `view: "games"`: `games` top 10, no book boards. `since` = `period === "month" ? hallOfFameMonthStart(now()) : null`. `workCard` is called only for works being returned.
- Route `GET /hall-of-fame` in the works plugin's rate-limited scope, `getOptionalAuthenticatedUser` like stats, `Cache-Control: no-store`; 400 on an unknown `period` or `view`.

- [ ] **Step 1: Failing tests:** service: `main view returns podium of three and one leader per board`; `a board view returns that board's top ten only`; `games view returns games only`; `only returned works get a card`. Route: `GET /hall-of-fame?period=month returns 200 with no-store`; `rejects an unknown period with 400`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/works/hallOfFameService.test.ts src/modules/works/routes.test.ts` — FAIL.
- [ ] **Step 3: Implement** service, route, plugin registration and `app.ts` wiring.
- [ ] **Step 4: Append** `src/modules/works/hallOfFameService.test.ts` to the backend test list; run `npm run typecheck --workspace backend && npm test --workspace backend && npm run test:fixture --workspace backend` — PASS.
- [ ] **Step 5: Commit** "Serve the games hall of fame".

### Task 8: Mobile — bottom bar, model and screens

**Files:**
- Create: `mobile/src/ui/ScrollDock.tsx`
- Modify: `mobile/src/ui/SearchDock.tsx`
- Modify: `mobile/src/ui/index.ts`
- Create: `mobile/src/features/hallOfFame/hallOfFameModel.ts`
- Test: `mobile/src/features/hallOfFame/hallOfFameModel.test.ts`
- Create: `mobile/src/features/hallOfFame/api.ts`
- Create: `mobile/src/features/hallOfFame/HallOfFameBar.tsx`
- Create: `mobile/src/features/hallOfFame/HallOfFameScreen.tsx`
- Create: `mobile/src/features/hallOfFame/LeaderboardScreen.tsx`
- Create: `mobile/src/app/(app)/(arena)/hall-of-fame/index.tsx`
- Create: `mobile/src/app/(app)/(arena)/hall-of-fame/[view].tsx`
- Modify: `mobile/src/features/arena/ArenaHomeScreen.tsx`

**Interfaces:**
- `ScrollDock({ bar, fab, hidden, children }: { bar: ReactNode; fab?: ReactNode; hidden?: boolean; children: (scrollProps: SearchDockScrollProps) => ReactNode })` — the scroll-hide, keyboard-overlap and FAB placement moved out of `SearchDock`; `SearchDock` becomes `ScrollDock` with its search row as `bar`. `SearchDock`'s props and behaviour do not change.
- `api.ts`: `export const { fetchHallOfFame } = createHallOfFameApi(request)`.
- `hallOfFameModel.ts`:
  ```ts
  export const BOARD_ORDER: HallOfFameBoard[]; // crowned, tiered, highestTier, quizzed, risingStar
  export function boardTitle(view: HallOfFameView, genre: string | null): string; // "Most crowned", …, "Hottest games"; champions → "Champions" or "<genre> champions"
  export function valueLabel(board: HallOfFameBoard, value: number): string; // "5 wins"/"1 win", "12 lists", "Usually S" (tierLetter), "7 quizzes", "4 games", "9 pts"
  export function visibleBoards(period: HallOfFamePeriod): HallOfFameBoard[]; // risingStar only for "month"
  export function genreMenu(genres: string[], selected: string | null): string[]; // selected kept even if absent
  export function emptySections(data: HallOfFame): { podium: boolean; records: boolean; genres: boolean; games: boolean };
  ```
- `HallOfFameBar({ period, onPeriod, genre, onGenre, genres, genreDisabled? })`: `Segmented` (This month / All time) filling the row + a pill button opening `Menu` ("All genres" + `genreMenu(...)`, selected item `selected: true`), active styling when a genre is set.
- `HallOfFameScreen`: title "Hall of fame", react-query `["hallOfFame", period, genre]`, sections per spec (podium titled "Book of the month" for month / "All-time champions" for all; records strip with `valueLabel`; Champions by genre row hidden when a genre is set; Hottest games as `GameRow`s with `stats` likes/votes/comments). Taps: record → `/hall-of-fame/<board>`, genre → `/hall-of-fame/champions` with `genre`, games › → `/hall-of-fame/games`, book → `workPath(id, segments)`, game → `contentTarget(item.content)`. Period and genre passed as route params.
- `LeaderboardScreen({ view })`: title `boardTitle`, top 10 rows (rank, `BookCover`, title, bar proportional to the leader, `valueLabel`), same bar; `genreDisabled` for `view === "games"`.
- `ArenaHomeScreen`: `headerRight` `IconButton name="champion" accessibilityLabel="Hall of fame"` → `/hall-of-fame`.

- [ ] **Step 1: Failing model tests:** `valueLabel pluralises and letters`; `visibleBoards hides rising star for all time`; `keeps the selected genre in the menu`; `emptySections` (all-empty response → every flag true; a podium of 1 → `podium: false`); `boardTitle names genre champions`.
- [ ] **Step 2: Run** `npm test --workspace mobile` — FAIL.
- [ ] **Step 3: Implement** the model, then `ScrollDock` extraction (Library/Search/Games docks unchanged), bar, screens, routes, header button. Empty sections show short copy ("No records yet this month — games need 5 voters to count.").
- [ ] **Step 4: Run** `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile` — PASS.
- [ ] **Step 5: Commit** "Add the games hall of fame screens".
- [ ] **Step 6: Device pass** (`device-checker`): trophy in Games header opens Hall of fame; bottom bar switches period and genre; record, genre and games taps open leaderboards with the same filters; book tap opens the book page; Library/Search/Games docks still hide on scroll and keep their FABs; empty states read sensibly on the fixture (few votes).
