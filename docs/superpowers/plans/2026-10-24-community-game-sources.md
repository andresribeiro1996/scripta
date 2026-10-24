# Community Game Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Community talks to every game through one `GameSource` port it owns; the games ship the adapters; community stops branching per kind except where the wire format or a named extra needs it.

**Architecture:** Shared helpers first (vote code, `GameByWork`). Then the port and the three adapters, with a contract test per adapter, while community still uses the old deps. Then community's feed, Discover, activity and profile move to `games`, and finally Top Shelf.

**Tech Stack:** TypeScript, Fastify, `@scripta/shared`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-community-game-sources-design.md`

**Base:** after the game-rules-in-services branch merges (both change the three game services and their `plugin.ts`). Line refs below are from origin/main before that branch, so find code by name.

## Global Constraints

- The port is `backend/src/modules/community/domain/games.ts`, exported from `community/index.ts`. Exact types:
  ```ts
  import type { GameParticipation, ParticipationGameKind, PublishedContent } from "@scripta/shared/community";
  export type GameKind = ParticipationGameKind;
  export const GAME_KINDS: readonly GameKind[] = ["tierlist", "tournament", "quiz"];
  export type GameContent<K extends GameKind = GameKind> = Extract<PublishedContent, { kind: K }>;
  export interface GameListing { id: string; ownerUserId: string; createdAt: string; promoted: boolean }
  export interface GameCard<K extends GameKind = GameKind> extends GameListing { content: GameContent<K> }
  export interface GameShelfFact { kind: GameKind; id: string; ownerUserId: string; open: boolean; promoted: boolean; createdAt: string; voters: number; votesSince: number; workIds: string[]; placements: TierPlacementFact[]; champion: { workId: string; settledAt: string } | null }
  export interface GameSource<K extends GameKind = GameKind> {
    get(id: string): GameCard<K> | undefined;
    getMany(ids: string[], viewerId?: string): GameCard<K>[];
    listByOwner(ownerUserId: string): GameCard<K>[];
    discoverWindow(needle: string, limit: number): GameListing[];
    discoverByWorks(workIds: string[], limit: number): GameListing[];
    participation(ownerUserId: string, since: string): Array<GameParticipation & { voteCode?: string }>;
    shelfFacts(since: string | null, until: string | null): GameShelfFact[];
  }
  export type GameSources = { [K in GameKind]: GameSource<K> };
  export function asGameKind(refType: string): GameKind | null;
  ```
  `TierPlacementFact` and the `champion` shape are today's fields on `TierlistShelfFacts.placements` and `TournamentShelfFacts.champion`; the placement type moves into `games.ts`.
- **Covers.** `content.covers` carries what the game's public API returns: up to 8 for tier lists and tournaments, up to 3 for quizzes. Community caps covers at `FEED_COVER_LIMIT` (3) in one helper, `feedContent(content)`. It applies it everywhere a `to*Summary` capped before: feed, Discover, saved content, activity, completions and the profile's `published` lists. Wire output keeps today's 3-cover cap everywhere.
- `getMany` sets `content.viewerVoted` exactly when `viewerId` is given; `promoted` is true only for promoted tier lists; missing ids are left out; `listByOwner` is newest first.
- `CommunityRefType` is declared once, in `community/domain/types.ts`, as `GameKind | "book" | "user" | "mural"`; `community/service.ts` imports it instead of redeclaring it.
- After Task 4, nothing under `backend/src/modules/community/` (tests included) imports from `../tierlists/`, `../arena/` or `../quizzes/` except their `index.ts`.
- Wire output is unchanged except for the spec's three behaviour changes. No comments in code. New test files go into `backend/package.json`'s `test` list. Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **A promoted tier list whose creator's profile is gone** still shows with the "creator unavailable" author in the feed, Discover and saved content. Existing community tests cover it and must pass unchanged in Task 3.
- **Hide-own-game-votes** still hides a vote on the viewer's own non-promoted game and shows one on a promoted list. Existing tests; Task 3.
- **Discover with a search term** still fetches cheap listings first and full cards only for the page shown. Task 3 keeps the existing call-count tests, rewritten to count `getMany` calls.
- **Profile `published` lists and completions** still send at most 3 covers per game. Task 3 adds the test.
- **An activity vote on a deleted quiz** is kept as plain text. Task 3 adds the test.

---

### Task 1: `voteCode.ts` and `GameByWork`

**Files:**
- Create: `backend/src/voteCode.ts`
- Modify: `backend/src/modules/tierlists/service.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Modify: `backend/src/modules/arena/service.ts`
- Modify: `backend/src/modules/works/service.ts`
- Modify: `backend/src/modules/works/index.ts`
- Modify: `backend/src/modules/tierlists/index.ts`
- Modify: `backend/src/modules/quizzes/index.ts`
- Modify: `backend/src/modules/arena/index.ts`

**Interfaces:**
- Produces: `generateVoteCode(): string` from `backend/src/voteCode.ts`, moved verbatim with its alphabet from `tierlists/service.ts`. `export type GameByWork = { id: string; name: string; path: string; ownerUserId: string | null }` from `works/index.ts`.

- [ ] **Step 1:** Move `generateVoteCode` and its alphabet into `voteCode.ts`; tier lists and quizzes import it and drop their copies.
- [ ] **Step 2:** `works/service.ts` exports its `GameByWork`; `works/index.ts` re-exports it. The three games' `publishedByWorks` return `GameByWork` from `../works/index.js`. Delete their local `GameByWork` types and any re-export of them from their `index.ts`.
- [ ] **Step 3:** `npm test --workspace backend` passes; `node scripts/gate.mjs`; commit.

### Task 2: The port and the three adapters

**Files:**
- Create: `backend/src/modules/community/domain/games.ts`
- Modify: `backend/src/modules/community/index.ts`
- Create: `backend/src/modules/tierlists/adapters/communityGameSource.ts`
- Create: `backend/src/modules/arena/adapters/communityGameSource.ts`
- Create: `backend/src/modules/quizzes/adapters/communityGameSource.ts`
- Test: `backend/src/modules/tierlists/adapters/communityGameSource.test.ts`
- Test: `backend/src/modules/arena/adapters/communityGameSource.test.ts`
- Test: `backend/src/modules/quizzes/adapters/communityGameSource.test.ts`
- Modify: `backend/src/modules/tierlists/index.ts`
- Modify: `backend/src/modules/arena/index.ts`
- Modify: `backend/src/modules/quizzes/index.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Test: `backend/src/modules/quizzes/service.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: today's `create*PublicApi` objects in each game's `service.ts`.
- Produces:
  - `createTierlistGameSource(api): GameSource<"tierlist">`, `createTournamentGameSource(api): GameSource<"tournament">` and `createQuizGameSource(api): GameSource<"quiz">`, each in its module's `adapters/communityGameSource.ts`.
  - `getTierlistGameSource()`, `getTournamentGameSource()` and `getQuizGameSource()` from each `index.ts`, built lazily over the existing `get*PublicApi()`.
  - From arena only: `createCompletedTournaments(api)`, returning `(viewerId: string, since: string) => Array<{ card: GameCard<"tournament">; completedAt: string; winner: { title: string; author: string; cover: string | null; workId: string | null } }>`, and `getCompletedTournaments()` from `arena/index.ts`.
  - The adapters import port types with `import type` from `../../community/index.js`.

- [ ] **Step 1: Write the failing contract tests**, one file per game, against the real public API over a temp SQLite DB, set up as each module's existing service or route tests do:
  - "content kind and id match the listing, and covers come through as the public API returns them"
  - "getMany marks viewerVoted only when a viewer is given"
  - "an unpublished or unknown id is left out of getMany and undefined from get"
  - "listByOwner is newest first"
  - "shelfFacts carries empty placements and a null champion where they don't apply" (tier list: placements filled; tournament: champion filled; quiz: neither)
  - tier lists only: "promoted is true only for a promoted list"
  - arena only: "a seeding tournament is not listed by owner", "completed tournaments carry their card and winner"
  - In `quizzes/service.test.ts`: "participation shows up to three of the quiz's book covers"
- [ ] **Step 2:** Run the new tests with `npx tsx --test` in `backend/`; they fail.
- [ ] **Step 3: Implement.**
  - `games.ts` gets the Global Constraints types and `asGameKind`.
  - Each adapter copies its game's summary builder from `community/service.ts` (Task 3 deletes the originals) without the `slice(0, FEED_COVER_LIMIT)`.
  - `getMany` calls `getPublishedMany` and, when given a viewer, `votedAmong`. `get` maps `getPublished`, and `listByOwner` maps `listPublishedByOwner`.
  - `shelfFacts` maps the module's `*ShelfFacts` to `GameShelfFact`.
  - `participation` maps `participationByOwner` and adds `voteCode` for tier lists and quizzes.
  - In `quizzes/service.ts`, extract the cover loop in `toPublishedRef` into `previewCovers(row: QuizRow): string[]`. `participationByOwner` loads its quizzes with `repo.listPublicByIds(ids)` and fills each row's `covers` with `previewCovers` instead of `[]`.

  Add the three new test files to the `test` list.
- [ ] **Step 4:** `npm test --workspace backend` passes; `node scripts/gate.mjs`; commit.

### Task 3: Community feed, Discover, activity and profile on `games`

**Files:**
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/modules/community/domain/types.ts`
- Modify: `backend/src/modules/community/topShelfService.ts`
- Modify: `backend/src/modules/community/plugin.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/community/service.test.ts`
- Test: `backend/src/modules/community/routes.test.ts`
- Test: `backend/src/modules/community/engagement.test.ts`
- Test: `backend/src/modules/community/backfill.test.ts`
- Test: `backend/src/modules/community/archive.test.ts`
- Test: `backend/src/modules/community/topShelfService.test.ts`
- Test: `backend/src/modules/community/topShelfRecapService.test.ts`
- Test: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`

**Interfaces:**
- Consumes: Task 2's port, `get*GameSource()` and `getCompletedTournaments()`.
- Produces: `CommunityDeps` with `games: GameSources`, `rankingCovers(tierlistId: string, ranking: RankingTierPreview[]): RankingTierPreview[]` and `completedTournaments` (Task 2's signature), in place of `tierlists`, `tournaments`, `quizzes` and `participation`. `DiscoverDeps` in `topShelfService.ts` picks `games` instead of the three keys.

- [ ] **Step 1: Tests first.**
  - In `service.test.ts`, replace the three game blocks of `createDeps` (around lines 219-284) with one generic `fakeGameSource(kind, cards, voted, participation, facts)` backed by a `Map<string, GameCard>`. It records `getMany` calls with their ids and viewer.
  - Rewrite the call-log assertions (`votedAmongCalls`, `publishedManyCalls`, `windowCalls`, around lines 1860-1880) to the new calls. A loop that skips a kind with no ids is fine, and the expectations change to match.
  - Wire-output assertions stay unchanged.
  - Drop `service.test.ts`'s imports of `PublishedTierlistRef`, `PublishedTournamentRef` and `PublishedQuizRef` (lines 8-10) and `sqliteCommunityRepository.test.ts`'s import from `../../../tierlists/service.js` (line 11); their fixtures become `GameCard`s.
  - Add "an activity vote on a deleted quiz is kept, without cover or link" and "profile published lists and completions send at most three covers per game".
  - In `engagement.test.ts`, `backfill.test.ts`, `archive.test.ts`, `topShelfService.test.ts` and `topShelfRecapService.test.ts`, replace the `tierlists`/`tournaments`/`quizzes` dep fakes with `games` fakes.
  - Run `npx tsx --test src/modules/community/service.test.ts` and see it fail.
- [ ] **Step 2: Implement.**
  - Swap the deps. Delete `toTierlistSummary`, `toTournamentSummary`, `toQuizSummary`, `withVoted` and the `../arena/service.js`, `../quizzes/service.js` and `../tierlists/service.js` type imports from `service.ts`.
  - Add `feedContent(content)` and apply it at every place listed under Covers in Global Constraints.
  - Rewrite `buildDiscoverItems`, `participationItems`, `toDigestItem` (publication and `voted_on`), `resolveSavedContent`, `getDiscover` and `getActivity` as loops over `GAME_KINDS` or lookups through `asGameKind(ref_type)`, with links from `contentTarget(content)` (`@scripta/shared/community`).
  - The profile's `published` keeps its three keys, each filled from `games[kind].listByOwner` through `feedContent`.
  - `CommunityRefType` follows the Global Constraints.
  - In `app.ts`, pass `games: { tierlist: getTierlistGameSource(), tournament: getTournamentGameSource(), quiz: getQuizGameSource() }`, `rankingCovers` (today's `fillRankingCovers`) and `completedTournaments: getCompletedTournaments()` instead of the pass-through blocks.
- [ ] **Step 3:** `npm test --workspace backend` passes; `node scripts/gate.mjs`; commit.

### Task 4: Top Shelf on `games`

**Files:**
- Modify: `backend/src/modules/community/topShelf.ts`
- Modify: `backend/src/modules/community/topShelfService.ts`
- Modify: `backend/src/modules/community/topShelfRecapService.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/community/topShelf.test.ts`
- Test: `backend/src/modules/community/topShelfRecap.test.ts`
- Test: `backend/src/modules/community/topShelfRecapService.test.ts`
- Test: `backend/src/modules/community/topShelfService.test.ts`
- Test: `backend/src/modules/community/backfill.test.ts`
- Test: `backend/src/modules/community/archive.test.ts`

**Interfaces:**
- Consumes: `GameSources`, `GameShelfFact`, `GAME_KINDS`.
- Produces: `TopShelfDeps` with `games: GameSources` instead of `tierlistFacts`, `tournamentFacts` and `quizFacts`; `ShelfInput` takes `games: GameShelfFact[]`.

- [ ] **Step 1:** In `topShelf.test.ts` and `topShelfRecap.test.ts`, merge the three input factories into one `game({ kind, … })` returning a `GameShelfFact`. Expectations stay unchanged. In the service tests, `backfill.test.ts` and `archive.test.ts`, replace the `*Facts` fakes with `games` fakes whose `shelfFacts` return the same facts. Drop their imports from `../tierlists/`, `../arena/` and `../quizzes/` service files. Run them and see them fail.
- [ ] **Step 2:** `topShelfService.ts` and `topShelfRecapService.ts` collect `GAME_KINDS.flatMap((kind) => deps.games[kind].shelfFacts(since, until))`. `topShelf.ts`'s generic `build(kind, facts, promoted)` reads `fact.kind` and `fact.promoted`; the tiered/quizzed/plain rule stays as written. Delete the `*ShelfFacts` type imports. `app.ts` passes `games` to Top Shelf.
- [ ] **Step 3:** `rg -n "\.\./(tierlists|arena|quizzes)/(service|domain)" backend/src/modules/community` prints nothing. `npm test --workspace backend` passes; `node scripts/gate.mjs`; commit.
