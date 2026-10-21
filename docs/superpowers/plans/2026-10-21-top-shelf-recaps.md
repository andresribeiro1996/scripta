# Top Shelf Recaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frozen monthly Top Shelf recaps: story-style cards (summary, Book of the month, one per record, hottest game) that share as 9:16 pictures whose QR invites a stranger into a still-open game, reachable from Top Shelf, a past-recaps row and a Home card.

**Architecture:** The game modules' Top Shelf facts gain an upper time bound and an "open to strangers" flag; `rankTopShelf` gains `until`. A pure `freezeRecap` turns a bounded month's input into stored recap data (numbers + ranked candidate games per card). The community module stores recaps in its own SQLite DB, freezes due months on a timer, and serves `GET /top-shelf/recaps` and `GET /top-shelf/recaps/:month`, resolving each card's link and the hottest game's visibility live. Mobile adds a full-screen story screen with a share-as-picture frame, a Top Shelf button and row, and a Home header card.

**Tech Stack:** Fastify + node:sqlite (backend), `@scripta/shared` (types, client), Expo Router / React Native, `react-native-view-shot` + `ContentShareSheet`, `react-native-qrcode-svg`, node:test.

**Spec:** `docs/superpowers/specs/2026-10-21-top-shelf-recaps-design.md` — read it first. It builds on `docs/superpowers/specs/2026-10-21-top-shelf-design.md` and the Top Shelf code (`backend/src/modules/community/topShelf*.ts`, `mobile/src/features/topShelf/`).

## Global Constraints

- A month is the calendar month in `Europe/Lisbon`, keyed `"YYYY-MM"`; its range is `[lisbonMonthStart(m), lisbonMonthStart(addMonths(m, 1)))` — start inclusive, end exclusive, for every timestamp (votes, ballots' cast time, publish time, settlement, likes, comments, voters).
- Vote bar unchanged: `TOP_SHELF_MIN_VOTERS` (5) distinct voters, owner excluded, counted up to the month's end.
- A recap is frozen once and never recomputed. Live at read time only: each book card's link (first candidate still visible and open to strangers, else the book page) and the hottest game's visibility (dropped if no longer visible).
- "Open to strangers": tier list `voting_open = 1 AND vote_access = 'anonymous' AND promoted_at IS NULL`; quiz `play_open = 1`; tournament `status = 'active'`.
- Card order: summary, `champions` ("Book of the month"), `crowned`, `tiered`, `highestTier`, `quizzed`, `risingStar`, hottest game. A recap exists only if at least one book card or a hottest game exists.
- Copy: book card with a game link → "<verb> — it counts for <current month name>" where verb is "Rank it yourself" (tier list), "Play it yourself" (quiz), "Vote in the bracket" (tournament); without → "See <title> on Scripta"; hottest game open → "Play it yourself", closed → "See how it ended"; summary → "Join in on Scripta". Month names in English ("October").
- Style A colours are the card's own (not theme tokens): background `linear-gradient(160deg, #3d2f12, #1a2a22 55%, #0f1512)`, gold `#d9a54a`, text `#e8ece9`, dim `#9aa79f`, border `#5a4a24`. Shared picture is 9:16.
- Mobile only. API additive: new routes and new shared types only; no existing type or route changes shape.
- No code comments. New backend test files are appended to `backend/package.json` `test`. Shared changes need `npm run build --workspace @scripta/shared` before backend/mobile typecheck. Date tests set `process.env.TZ = "America/Sao_Paulo"` after imports.
- `//` notes inside this plan's code blocks are plan notes — never copy them into code.

## Review Focus

1. A freeze that runs late (e.g. 3 November) — November's votes, ballots, likes and publishes must not count toward October. → Task 3 test `freezeRecap ignores activity after until`.
2. Downtime across two month ends — both missing months are frozen, oldest first; a month with nothing is stored empty and never listed. → Task 5 test `freezeDue fills every missing month and skips empty ones in the list`.
3. The linked game closes or its owner goes private after the freeze — the card falls back to the next candidate, then to the book page; the hottest game card disappears. → Task 5 test `getRecap resolves links live and drops a hidden hottest game`.
4. A stranger scanning a members-only tier list — never linked. → Task 1 test `open is false for members-only, closed and promoted lists`.
5. A `month` param that isn't `YYYY-MM`, is the current or a future month, or has no recap — 400 / 404, no compute. → Task 5 route tests.

---

### Task 1: Bounded facts and "open to strangers" in the game modules

**Files:**
- Modify: `backend/src/modules/tierlists/domain/types.ts`
- Modify: `backend/src/modules/tierlists/domain/ports.ts`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts`
- Modify: `backend/src/modules/tierlists/service.ts`
- Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`
- Modify: `backend/src/modules/tierlists/service.test.ts`
- Modify: `backend/src/modules/arena/domain/types.ts`
- Modify: `backend/src/modules/arena/domain/ports.ts`
- Modify: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts`
- Modify: `backend/src/modules/arena/service.ts`
- Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`
- Modify: `backend/src/modules/arena/service.test.ts`
- Modify: `backend/src/modules/quizzes/domain/types.ts`
- Modify: `backend/src/modules/quizzes/domain/ports.ts`
- Modify: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Test: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`
- Modify: `backend/src/modules/quizzes/service.test.ts`
- Modify: `backend/src/modules/community/topShelfService.ts`
- Modify: `backend/src/modules/community/topShelf.test.ts`
- Modify: `backend/src/modules/community/topShelfService.test.ts`

**Interfaces:**
- Produces, on each module's port, service and public API: `topShelfFacts(since: string | null, until: string | null)` replacing `topShelfFacts(since)`. Each facts type (`TierlistShelfFacts`, `TournamentShelfFacts`, `QuizShelfFacts`) gains `open: boolean`.
- `voters` counts only votes/ballots/plays with `created_at < until` (all when null); `votesSince` counts `since <= created_at < until`. Placements and champion stay unfiltered (the ranking filters them).
- `TopShelfDeps.tierlistFacts/tournamentFacts/quizFacts` take `(since, until)`; `topShelfService.gather(since)` passes `until = null` (behaviour unchanged).

- [ ] **Step 1: Failing tests** in each repo test file: `topShelfFacts bounds voters and votesSince by until` (ballots/plays/votes before, inside and after `[since, until)` → only those before `until` in `voters`, only those inside in `votesSince`); tier lists `open is false for members-only, closed and promoted lists` (anonymous+open → true; members → false; `voting_open = 0` → false; promoted → false); quizzes `open follows play_open`; arena `open is true only while active`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts` — new tests FAIL.
- [ ] **Step 3: Implement** with a `$until` parameter (`($until IS NULL OR x.created_at < $until)`) beside `$since`, the `open` column expression per Global Constraints, and the signature change through port → service → public API → fakes → `TopShelfDeps` (`plugin.ts`/`app.ts` pass method references and need no edit); add `open` to the facts factories in the two community test files.
- [ ] **Step 4: Run** the three files, `npm run typecheck --workspace backend`, `npm test --workspace backend` — PASS (existing Top Shelf tests unchanged).
- [ ] **Step 5: Commit** "Bound Top Shelf facts by an end time and flag games open to strangers".

### Task 2: Bounded engagement

**Files:**
- Modify: `backend/src/modules/community/domain/ports.ts`
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteEngagementRepository.ts`
- Test: `backend/src/modules/community/engagement.test.ts`
- Modify: `backend/src/modules/community/topShelfService.ts`

**Interfaces:**
- Produces: `gameEngagement(refs: GameRef[], since: string | null, until: string | null)`; likes/comments counted with `since <= created_at < until`. `publishedAt` unchanged (earliest publish event across `events` and `events_history`, not bounded). `topShelfService` passes `until = null`.

- [ ] **Step 1: Failing test** `counts likes and comments inside since..until only`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/community/engagement.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file + backend typecheck — PASS.
- [ ] **Step 5: Commit** "Bound per-game engagement by an end time".

### Task 3: Months and the pure recap freeze

**Files:**
- Modify: `backend/src/modules/community/topShelf.ts`
- Test: `backend/src/modules/community/topShelf.test.ts`
- Create: `backend/src/modules/community/topShelfRecap.ts`
- Test: `backend/src/modules/community/topShelfRecap.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: Task 1 facts (`open`), Task 2 engagement, `ShelfInput`, `rankTopShelf`.
- Produces in `topShelf.ts`:
  ```ts
  export function lisbonMonth(at: Date): string;            // "2026-10"
  export function lisbonMonthStart(month: string): string;   // ISO UTC instant of 00:00 on the 1st, Lisbon
  export function addMonths(month: string, n: number): string;            // backend only: the app gets months from the server (Task 5)
  // topShelfMonthStart(now) becomes lisbonMonthStart(lisbonMonth(now)) — same results
  rankTopShelf(input, opts: { since: string | null; until?: string | null; genre: string | null })
  ```
  `inPeriod(at)` = `at >= since && (until == null || at < until)`; it now also bounds placements' `castAt` and champions' `settledAt` (already routed through `inPeriod`). `rankTopShelf` additionally returns `visibleGames: Array<{ ref: GameRef; works: Set<string>; publishedAt: number; likes: number; votes: number; comments: number }>` — every visible game (no vote bar, no activity filter; `votes` = `votesSince`, likes/comments from engagement) — so `freezeRecap` reuses its visibility and canonicalization instead of recomputing them.
- Produces in `topShelfRecap.ts`:
  ```ts
  export type RecapBook = { board: TopShelfBoard; workId: string; value: number; candidates: GameRef[] };
  export type RecapData = {
    summary: { gamesPublished: number; votesCast: number; booksInPlay: number };
    books: RecapBook[];                                                  // card order per Global Constraints, at most one per board (its #1)
    hottest: { ref: GameRef; likes: number; votes: number; comments: number } | null;
  };
  export const RECAP_BOARDS: TopShelfBoard[];                            // champions, crowned, tiered, highestTier, quizzed, risingStar
  export function freezeRecap(input: ShelfInput, range: { since: string; until: string }): RecapData;
  export function recapHasCards(data: RecapData): boolean;               // books.length > 0 || hottest !== null
  ```
  `summary` over `visibleGames`: `gamesPublished` = publish time in range; `votesCast` = Σ `votesSince` (already range-bounded); `booksInPlay` = distinct canonical works of games published in range. `candidates` = `visibleGames` containing the card's work (canonicalized), ordered by in-range likes + votes + comments desc, then `kind:id`; all of them, not only open ones (openness is checked live). `hottest` = `rankTopShelf(...).games[0]` or null.

- [ ] **Step 1: Failing tests** in `topShelf.test.ts`: `lisbonMonth and lisbonMonthStart around DST and year ends` (`lisbonMonth(2026-10-31T23:30Z) === "2026-10"`, `lisbonMonthStart("2026-11") === "2026-11-01T00:00:00.000Z"`, `lisbonMonthStart("2026-10") === "2026-09-30T23:00:00.000Z"`, `addMonths("2026-12", 1) === "2027-01"`, `addMonths("2027-01", -1) === "2026-12"`); `rankTopShelf with until ignores later appearances, placements and titles`. In `topShelfRecap.test.ts`: `freezeRecap ignores activity after until`; `freezeRecap orders cards and keeps each board's leader`; `candidates are every visible game with the work, busiest first`; `summary counts games published, votes cast and books in play`; `recapHasCards is false with only a summary`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/community/topShelf.test.ts src/modules/community/topShelfRecap.test.ts` — FAIL.
- [ ] **Step 3: Implement**; append `src/modules/community/topShelfRecap.test.ts` to the backend test list.
- [ ] **Step 4: Run** both files, backend typecheck, `npm test --workspace backend` — PASS.
- [ ] **Step 5: Commit** "Freeze a Top Shelf month into recap data".

### Task 4: Shared recap types and client

**Files:**
- Modify: `packages/shared/src/topShelf/types.ts`
- Modify: `packages/shared/src/topShelf/api.ts`
- Test: `packages/shared/src/topShelf/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TopShelfRecapCard =
    | { kind: "summary"; gamesPublished: number; votesCast: number; booksInPlay: number }
    | { kind: "book"; board: TopShelfBoard; book: TopShelfBook; game: DiscoverItem | null }   // game = live link target, null → book page
    | { kind: "hottestGame"; game: TopShelfGame; open: boolean };
  export type TopShelfRecap = { month: string; cards: TopShelfRecapCard[] };
  export type TopShelfRecapIndex = { months: string[]; currentMonth: string; announce: boolean }; // months newest first; currentMonth = Lisbon "YYYY-MM" now; announce = months[0] is last month and today is Lisbon day 1–7
  // on createTopShelfApi:
  fetchRecapIndex(): Promise<TopShelfRecapIndex>;     // GET /top-shelf/recaps
  fetchRecap(month: string): Promise<TopShelfRecap>; // GET /top-shelf/recaps/:month
  export function recapMonthName(month: string): string; // "2026-10" → "October" — a static English month list, no Intl
  ```
  Both requests `auth: "none"`. `fetchRecap` drops a `book` card's `game` and a `hottestGame` card whose content kind fails `isKnownContent` (book card keeps, with `game: null`).

- [ ] **Step 1: Failing tests:** `fetchRecapIndex reads the index`; `fetchRecap builds the path and drops unknown game kinds`; `recapMonthName names the month` (`"2026-10"` → `"October"`, `"2027-01"` → `"January"`).
- [ ] **Step 2: Run** `npm test --workspace @scripta/shared` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared` — PASS.
- [ ] **Step 5: Commit** "Add Top Shelf recap types and client".

### Task 5: Store, freeze and serve recaps

**Files:**
- Modify: `backend/src/modules/community/adapters/sqlite/schema.sql`
- Create: `backend/src/modules/community/adapters/sqlite/sqliteRecapRepository.ts`
- Create: `backend/src/modules/community/topShelfRecapService.ts`
- Test: `backend/src/modules/community/topShelfRecapService.test.ts`
- Modify: `backend/src/modules/community/topShelfService.ts`
- Modify: `backend/src/modules/community/topShelfService.test.ts`
- Modify: `backend/src/modules/community/topShelfRoutes.ts`
- Test: `backend/src/modules/community/topShelfRoutes.test.ts`
- Modify: `backend/src/modules/community/plugin.ts`
- Modify: `backend/src/modules/community/index.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: Tasks 1–4.
- `schema.sql`: `CREATE TABLE IF NOT EXISTS top_shelf_recaps (month TEXT PRIMARY KEY, data TEXT NOT NULL, has_cards INTEGER NOT NULL, frozen_at TEXT NOT NULL)`.
- `createRecapRepository(db)`: `newest(): string | null` (any row); `get(month): RecapData | null`; `put(month, data: RecapData, frozenAt: string): void` (`INSERT OR IGNORE` — frozen once); `months(): string[]` (`has_cards = 1`, newest first).
- Extract the gathering from `createTopShelfService` into `createShelfGatherer({ engagementRepo, community, shelf, now })` in `topShelfService.ts`, returning `gather(since: string | null, until: string | null): ShelfInput` (uncached) and `cached(since: string | null): ShelfInput` (today's 60 s cache, `until = null`). `createTopShelfService` takes the gatherer instead of building its own (update `topShelfService.test.ts`'s construction); `/top-shelf` behaviour unchanged. Export `DiscoverDeps`.
- `createTopShelfRecapService({ repo, gatherer, community: DiscoverDeps, shelf: TopShelfDeps, now })`:
  - `freezeMonth(month: string): void` — `gatherer.gather(lisbonMonthStart(month), lisbonMonthStart(addMonths(month, 1)))` → `freezeRecap` → `repo.put`.
  - `freezeDue(): void` — `last = addMonths(lisbonMonth(now), -1)`; if `repo.newest()` is null freeze `last` only; else freeze every month after `newest` up to `last`, oldest first.
  - `getIndex(): TopShelfRecapIndex` — `months` from the repo, `currentMonth = lisbonMonth(now)`, `announce = months[0] === addMonths(currentMonth, -1) && Lisbon day of now <= 7`.
  - `getRecap(month): TopShelfRecap | null` — null when no row or `has_cards = 0`. Live: `live = gatherer.cached(null)`; book cards built like Top Shelf's (`getWorkPage`, first edition with a cover; a work with no page is dropped); `game` = first candidate present in `live`, visible, `open`, and whose live `workIds` (canonicalized) still contain the card's work, built with `buildDiscoverItems` (no viewer), else null; hottest card dropped unless visible in `live`, `open` from live facts. Summary card first.
- Plugin: a `run` wrapper that calls `freezeDue()` inside try/catch and logs with `app.log.error` (a throw must never fail plugin registration); call it once at boot, then `setInterval(run, 60 * 60 * 1000).unref()`, cleared `onClose` (copy the archive timer). Keep the recap service in a module-level `let` set at registration and export `freezeTopShelfRecap(month: string): void` from `community/index.ts` (throws if the plugin hasn't registered) — for the dev fixture; `CommunityPublicApi` is unchanged.
- Routes, in Top Shelf's rate-limited scope: `GET /top-shelf/recaps` → `TopShelfRecapIndex`; `GET /top-shelf/recaps/:month` → `TopShelfRecap`; `400` unless `/^\d{4}-(0[1-9]|1[0-2])$/`; `404` when `getRecap` is null (current/future months have no row); `Cache-Control: no-store`.

- [ ] **Step 1: Failing tests** (service, fake gatherer + real repo on a temp community DB): `freezeDue freezes only last month when empty`; `freezeDue fills every missing month and skips empty ones in the list`; `freezeMonth never overwrites a frozen month`; `getRecap resolves links live and drops a hidden hottest game` (first candidate closed → second; none open → `game: null`; hottest owner hidden → no hottest card); `getRecap returns null for an empty month`. `getIndex announces last month's recap only on Lisbon days 1–7` (now = `2026-08-31T23:30Z` with newest "2026-08" → announce true, it is 1 September in Lisbon; 8 November → false). Routes: `GET /top-shelf/recaps returns the index`; `rejects a malformed month with 400`; `returns 404 for a month without a recap`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test src/modules/community/topShelfRecapService.test.ts src/modules/community/topShelfRoutes.test.ts` — FAIL.
- [ ] **Step 3: Implement**; append `src/modules/community/topShelfRecapService.test.ts` to the backend test list.
- [ ] **Step 4: Run** `npm run typecheck --workspace backend && npm test --workspace backend` — PASS.
- [ ] **Step 5: Commit** "Store, freeze and serve Top Shelf recaps".

### Task 6: Dev fixture recap

**Files:**
- Modify: `backend/scripts/three-users.mjs`

**Interfaces:** after the existing Top Shelf seeding, `await import("../src/modules/community/index.ts")` (after `buildApp` at ~:75, so it is the app's module instance) and call `freezeTopShelfRecap(lisbonMonth(new Date()))` (`lisbonMonth` from `../src/modules/community/topShelf.ts`) so the dev data has a recap — the seeded games are this month's. Dev-only consequence, accepted: that month is frozen mid-month and later boots won't refreeze it (`newest` is already it); `--reset` starts over.

- [ ] **Step 1:** Extend `--check`: `GET /top-shelf/recaps` lists the current month in `months`; `GET /top-shelf/recaps/<it>` returns a summary card first and at least one `book` card.
- [ ] **Step 2: Run** `npm run test:fixture --workspace backend` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:fixture --workspace backend` — PASS.
- [ ] **Step 5: Commit** "Freeze a recap in the dev fixture".

### Task 7: Mobile recap screen and share frame

**Files:**
- Create: `mobile/src/features/topShelf/recapModel.ts`
- Test: `mobile/src/features/topShelf/recapModel.test.ts`
- Create: `mobile/src/features/topShelf/RecapCard.tsx`
- Create: `mobile/src/features/topShelf/RecapScreen.tsx`
- Create: `mobile/src/app/recap/[month].tsx`
- Modify: `mobile/src/features/topShelf/api.ts`

**Interfaces:**
- `api.ts` also exports `fetchRecapIndex`, `fetchRecap`.
- `recapModel.ts`:
  ```ts
  export function recapTitle(card: TopShelfRecapCard, month: string): string;   // "October on Scripta", "Book of the month", "👑 October's most crowned", "🔥 October's hottest game"…
  export function recapNumber(card: TopShelfRecapCard): string;                // Top Shelf's valueLabel for books; "74 interactions"; summary lines
  export function recapCta(card: TopShelfRecapCard, currentMonth: string): string; // copy per Global Constraints
  export function recapLinkPath(card: TopShelfRecapCard): string;              // book: contentTarget(game.content) or `/work/${encodeURIComponent(workId)}`; hottest: contentTarget(game.item.content); summary: "/"
  ```
  Reuse `valueLabel`/`gameScoreLabel` from `topShelfModel.ts` and `recapMonthName` from shared.
- `RecapCard({ card, month, currentMonth, url, sharing })` — style A per Global Constraints; `sharing` adds the bottom strip (QR of `url`, `recapCta(card, currentMonth)`, Scripta mark) inside the view and fixes a 9:16 aspect ratio. `currentMonth` comes from `fetchRecapIndex()`.
- `RecapScreen({ month })` — full screen, no header; progress dots; tap right/left half for next/previous; ✕ closes; a share button per card opens `ContentShareSheet` with `children={<RecapCard sharing />}`, `url` = `publicContentUrl(recapLinkPath(card))` (async — resolve it before showing the sheet's picture), `imageReady` once the URL is resolved and covers have loaded; tapping the cover opens the book (`workPath`) or game (`contentTarget`). Unknown/empty month → back to `/top-shelf`.
- Root route `recap/[month]` (outside `(app)`, so it is full-bleed in the root Stack like `reader-card.tsx`, works signed out, and ✕/back returns to whichever tab opened it) renders `RecapScreen`.

- [ ] **Step 1: Failing model tests:** `recapCta frames a vote as counting for the current month` (tier list card, current "November" → "Rank it yourself — it counts for November"; quiz/tournament verbs; no game → "See Dune on Scripta"; hottest open/closed; summary); `recapLinkPath falls back to the book page and the landing page` (and uses `game.item.content` for the hottest game).
- [ ] **Step 2: Run** `npm test --workspace mobile` — FAIL.
- [ ] **Step 3: Implement** model, card, screen, route.
- [ ] **Step 4: Run** `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile` — PASS.
- [ ] **Step 5: Commit** "Add the Top Shelf recap stories".

### Task 8: Entry points — Top Shelf button, past recaps, Home card

**Files:**
- Modify: `mobile/src/features/topShelf/TopShelfScreen.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Create: `mobile/src/features/topShelf/RecapHomeCard.tsx`

**Interfaces:**
- Query key `["topShelfRecaps"]` → `fetchRecapIndex()`.
- Top Shelf: "▶ Play <Month> recap" for `months[0]` sits at the top of the scroll content, above the podium and outside any book's `Pressable`, and it and a "Past recaps" section (rows for `months.slice(1)`, "September recap") render **before** the all-empty early return and regardless of podium, genre or period — early in a month "This month" is usually empty, which is exactly when the recap matters. Remove the podium's now-unused `recapSpace`. Rows and button push `/recap/<month>`.
- Home: `ListHeaderComponent` shows `RecapHomeCard` above the existing onboarding empty state when `index.announce && !dismissed`; ✕ stores AsyncStorage key `topShelfRecapDismissed:<month>`; tap pushes `/recap/<month>`. A failed index request hides the card (Home must not show an error for it).

- [ ] **Step 1: Run** `npm run typecheck --workspace mobile && npm test --workspace mobile` — baseline PASS.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the same — PASS.
- [ ] **Step 4: Commit** "Link Top Shelf recaps from Top Shelf and Home".
- [ ] **Step 5: Device pass** (`device-checker`, fixture from Task 6 — start with `node scripts/dev-emulator.mjs --reset`): Top Shelf shows "▶ Play October recap"; the recap opens full screen with the summary first and gold style A; tap through to the hottest game; ✕ closes; share opens the sheet with a 9:16 picture whose strip shows the QR and "… it counts for <current month>"; tapping a cover opens the book / game; the button also shows with a genre selected and under This month when Top Shelf's sections are empty; Past recaps row is absent with one recap; opening the recap from Top Shelf and pressing ✕ returns to Top Shelf. The Home card can't appear with fixture data (`announce` needs last month's recap in Lisbon days 1–7) — covered by the `getIndex` test in Task 5.
