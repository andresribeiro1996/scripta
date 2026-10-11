# Book Stats (PR A: backend + shared) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `GET /works/:id/stats` (community rating, average tier, tournament record) and ship the shared `bookStatsModel` the UI PR will render.

**Architecture:** Each owning module exposes one read: library `communityRatings`, tierlists `tierPlacements`, arena `tournamentRecord`. A new `createBookStatsService` in the works module combines them over the work's `aliasIds`, applies the minimums and tier maths, and a new route serves it. Types, `tierLetter` and the display model live in `@scripta/shared`.

**Tech Stack:** Fastify, node:sqlite, node:test via tsx, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-11-book-stats-design.md`

## Global Constraints

- Signed-in accounts only: library rows (always an account), tierlist ballots with `voter_user_id IS NOT NULL`. Tournaments use settled duel results as they are.
- Minimum 3 for community ratings and for tier placements; tournaments have none.
- Tier position `index / (tiers - 1)`, 0 = top; lists with < 2 tiers skipped; lists weighted equally; letter `["S","A","B","C","D"][Math.min(4, Math.floor(score * 5))]`.
- Round labels come from the existing shared `roundLabel(duelsInRound, roundNumber)`.
- `GET /works/:id/stats`: optional auth, `Cache-Control: no-store`, 404 `{ error: "No book with that id." }`, catalog failures → `WorkResolutionError` (503), like `/works/:id`.
- No code comments. Stage and commit in one command. Run git from the worktree root `/Users/andreribeiro/Documents/scripta/.claude/worktrees/book-stats`.
- `backend/package.json`'s `test` script lists files explicitly: a new test file must be appended there or CI never runs it.
- Do not touch `backend/src/modules/works/service.ts`, `packages/shared/src/works/types.ts` or any client code: another branch (`claude/book-details-menu-ui-01a2bc`) is changing them.
- After `packages/shared` changes, `npm run build --workspace @scripta/shared` before backend typecheck.

## Review Focus

1. A reader holding two editions of the same book (both finished and rated) must count once — test in Task 2.
2. A book that sits on many lists from one big tier list with dozens of voters must not drown out smaller lists — equal-weight test in Task 5.
3. An active tournament where the book's first duel hasn't settled yet: counted as entered, no wins/losses, `best` reflects the round it is playing in — test in Task 4.
4. A tier list whose owner later deleted a tier (placement's `tier_id` missing from `data.tiers`) must be skipped, not crash or count as top — test in Task 3.
5. A merged-away work id must still find the canonical work's stats (route goes through `getWorkPage`, which follows `merged_into`) — test in Task 5.

---

### Task 1: Shared stats types, tier letter and display model

**Files:**
- Create: `packages/shared/src/works/bookStats.ts`
- Create: `packages/shared/src/works/bookStats.test.ts`
- Modify: `packages/shared/src/works/index.ts`

**Interfaces:**
- Produces:
```ts
export const BOOK_STATS_MINIMUM = 3;
export type TierLetter = "S" | "A" | "B" | "C" | "D";
export type CommunityRating = { average: number; count: number; distribution: [number, number, number, number, number] };
export type TierStanding = { score: number; letter: TierLetter; lists: number; ballots: number };
export type TournamentRecord = { entered: number; titles: number; wins: number; losses: number; best: { round: number; duels: number } | null };
export type BookStats = { community: CommunityRating | null; tiers: TierStanding | null; tournaments: TournamentRecord | null };
export function tierLetter(score: number): TierLetter;
export function bookStatsModel(stats: BookStats | null, openLibrary: { value: number; count: number } | null): BookStatsModel;
```
`BookStatsModel` = `{ strip: Array<{ key: "openLibrary" | "community" | "tiers" | "tournaments"; value: string; label: string }>; ratings: { openLibrary: string | null; community: { feeling: string; summary: string; bars: Array<{ label: string; count: number; fraction: number }> } | null; empty: string | null }; tiers: { letter: TierLetter; summary: string } | null; tiersEmpty: string | null; tournaments: Array<{ label: string; value: string }> | null; tournamentsEmpty: string | null }`.

- [ ] **Step 1: Write the failing tests** — `bookStats.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookStatsModel, tierLetter, type BookStats } from "./bookStats.js";

const full: BookStats = {
  community: { average: 3.8, count: 12, distribution: [1, 0, 2, 6, 3] },
  tiers: { score: 0.31, letter: "B", lists: 4, ballots: 23 },
  tournaments: { entered: 3, titles: 1, wins: 7, losses: 2, best: { round: 3, duels: 1 } }
};
const openLibrary = { value: 4.12, count: 2310 };

test("tier letters split the range into five equal bands", () => {
  assert.deepEqual([0, 0.19, 0.2, 0.39, 0.4, 0.6, 0.8, 0.99, 1].map(tierLetter), ["S", "S", "A", "A", "B", "C", "D", "D", "D"]);
});

test("the strip shows every stat that exists, in a fixed order", () => {
  assert.deepEqual(bookStatsModel(full, openLibrary).strip, [
    { key: "openLibrary", value: "★ 4.1", label: "Open Library" },
    { key: "community", value: "Loved it", label: "12 readers" },
    { key: "tiers", value: "B tier", label: "4 lists" },
    { key: "tournaments", value: "1 title", label: "3 tournaments" }
  ]);
});

test("while stats load, or with none, only Open Library shows", () => {
  assert.deepEqual(bookStatsModel(null, openLibrary).strip.map((cell) => cell.key), ["openLibrary"]);
  assert.deepEqual(bookStatsModel({ community: null, tiers: null, tournaments: null }, null).strip, []);
});

test("without a title the tournament cell names the best round, singular counts read singular", () => {
  const stats: BookStats = { community: { average: 1.4, count: 3, distribution: [2, 1, 0, 0, 0] }, tiers: { score: 0, letter: "S", lists: 1, ballots: 3 }, tournaments: { entered: 1, titles: 0, wins: 1, losses: 1, best: { round: 2, duels: 2 } } };
  assert.deepEqual(bookStatsModel(stats, null).strip, [
    { key: "community", value: "Not for me", label: "3 readers" },
    { key: "tiers", value: "S tier", label: "1 list" },
    { key: "tournaments", value: "Semis", label: "1 tournament" }
  ]);
});

test("the ratings section has an Open Library line, a feeling, a summary and bars from All-time down", () => {
  const { ratings } = bookStatsModel(full, openLibrary);
  assert.equal(ratings.openLibrary, "★ 4.1 · 2.3K ratings on Open Library");
  assert.equal(ratings.community!.feeling, "Loved it");
  assert.equal(ratings.community!.summary, "3.8 average · 12 ratings");
  assert.deepEqual(ratings.community!.bars.map((bar) => [bar.label, bar.count, bar.fraction]), [["All-time", 3, 0.5], ["Loved it", 6, 1], ["Good", 2, 2 / 6], ["Fine", 0, 0], ["Not for me", 1, 1 / 6]]);
  assert.equal(ratings.empty, null);
});

test("tiers and tournaments sections", () => {
  const model = bookStatsModel(full, openLibrary);
  assert.deepEqual(model.tiers, { letter: "B", summary: "Average across 4 published tier lists · 23 votes" });
  assert.deepEqual(model.tournaments, [
    { label: "Entered", value: "3" },
    { label: "Titles", value: "1" },
    { label: "Won–lost", value: "7–2" },
    { label: "Best finish", value: "Winner" }
  ]);
});

test("an unplayed tournament has no best finish yet", () => {
  const model = bookStatsModel({ community: null, tiers: null, tournaments: { entered: 1, titles: 0, wins: 0, losses: 0, best: null } }, null);
  assert.deepEqual(model.tournaments!.at(-1), { label: "Best finish", value: "Not played yet" });
});

test("every empty section explains itself", () => {
  const model = bookStatsModel({ community: null, tiers: null, tournaments: null }, null);
  assert.equal(model.ratings.openLibrary, null);
  assert.equal(model.ratings.community, null);
  assert.equal(model.ratings.empty, "Shown once 3 readers have rated it.");
  assert.equal(model.tiersEmpty, "Shown once 3 people have voted on it in tier lists.");
  assert.equal(model.tournamentsEmpty, "Not in any tournament yet.");
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd packages/shared && node --import tsx --test src/works/bookStats.test.ts` → cannot find module.

- [ ] **Step 3: Implement** — `bookStats.ts`:

```ts
import { roundLabel } from "../arena/arenaBracket.js";
import { FINISH_FEELINGS } from "../library/finish.js";

export const BOOK_STATS_MINIMUM = 3;
const TIER_LETTERS = ["S", "A", "B", "C", "D"] as const;
export type TierLetter = (typeof TIER_LETTERS)[number];
export type CommunityRating = { average: number; count: number; distribution: [number, number, number, number, number] };
export type TierStanding = { score: number; letter: TierLetter; lists: number; ballots: number };
export type TournamentRecord = { entered: number; titles: number; wins: number; losses: number; best: { round: number; duels: number } | null };
export type BookStats = { community: CommunityRating | null; tiers: TierStanding | null; tournaments: TournamentRecord | null };
type StripKey = "openLibrary" | "community" | "tiers" | "tournaments";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const feelingFor = (average: number) => FINISH_FEELINGS.find((feeling) => feeling.rating === Math.round(average))!.label as string;

export function tierLetter(score: number): TierLetter {
  return TIER_LETTERS[Math.min(4, Math.floor(score * 5))]!;
}

function bestFinish(record: TournamentRecord): string | null {
  if (record.titles > 0) return "Winner";
  return record.best ? roundLabel(record.best.duels, record.best.round) : null;
}

export function bookStatsModel(stats: BookStats | null, openLibrary: { value: number; count: number } | null) {
  const community = stats?.community ?? null;
  const tiers = stats?.tiers ?? null;
  const tournaments = stats?.tournaments ?? null;
  const strip: Array<{ key: StripKey; value: string; label: string }> = [];
  if (openLibrary) strip.push({ key: "openLibrary", value: `★ ${openLibrary.value.toFixed(1)}`, label: "Open Library" });
  if (community) strip.push({ key: "community", value: feelingFor(community.average), label: plural(community.count, "reader", "readers") });
  if (tiers) strip.push({ key: "tiers", value: `${tiers.letter} tier`, label: plural(tiers.lists, "list", "lists") });
  if (tournaments) {
    const best = bestFinish(tournaments);
    strip.push({ key: "tournaments", value: tournaments.titles > 0 ? plural(tournaments.titles, "title", "titles") : best ?? `${tournaments.wins}–${tournaments.losses}`, label: plural(tournaments.entered, "tournament", "tournaments") });
  }
  const largest = community ? Math.max(...community.distribution) : 0;
  return {
    strip,
    ratings: {
      openLibrary: openLibrary ? `★ ${openLibrary.value.toFixed(1)} · ${compact.format(openLibrary.count)} ${openLibrary.count === 1 ? "rating" : "ratings"} on Open Library` : null,
      community: community ? {
        feeling: feelingFor(community.average),
        summary: `${community.average.toFixed(1)} average · ${plural(community.count, "rating", "ratings")}`,
        bars: [...FINISH_FEELINGS].reverse().map((feeling) => {
          const count = community.distribution[feeling.rating - 1]!;
          return { label: feeling.label as string, count, fraction: largest > 0 ? count / largest : 0 };
        })
      } : null,
      empty: community ? null : `Shown once ${BOOK_STATS_MINIMUM} readers have rated it.`
    },
    tiers: tiers ? { letter: tiers.letter, summary: `Average across ${plural(tiers.lists, "published tier list", "published tier lists")} · ${plural(tiers.ballots, "vote", "votes")}` } : null,
    tiersEmpty: tiers ? null : `Shown once ${BOOK_STATS_MINIMUM} people have voted on it in tier lists.`,
    tournaments: tournaments ? [
      { label: "Entered", value: String(tournaments.entered) },
      { label: "Titles", value: String(tournaments.titles) },
      { label: "Won–lost", value: `${tournaments.wins}–${tournaments.losses}` },
      { label: "Best finish", value: bestFinish(tournaments) ?? "Not played yet" }
    ] : null,
    tournamentsEmpty: tournaments ? null : "Not in any tournament yet."
  };
}

export type BookStatsModel = ReturnType<typeof bookStatsModel>;
```
Add `export * from "./bookStats.js";` to `packages/shared/src/works/index.ts`. If `roundLabel` or `FINISH_FEELINGS` are imported elsewhere in `works/` from an `index.js` barrel rather than the file, follow that (`rg -n "from \"\.\./" packages/shared/src/works`).

- [ ] **Step 4: Run, expect PASS** — `cd packages/shared && node --import tsx --test src/works/bookStats.test.ts && npm run typecheck && npm test && npm run build`.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/works && git commit -m "Add shared book stats types and display model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Library rating column, backfill and community ratings

**Files:**
- Modify: `backend/src/modules/library/adapters/sqlite/schema.sql` (`library_books`)
- Modify: `backend/src/modules/library/adapters/sqlite/connection.ts:36-40`
- Modify: `backend/src/modules/library/domain/types.ts` (book row type, ~line 67)
- Modify: `backend/src/modules/library/domain/constants.ts:2`
- Modify: `backend/src/modules/library/service.ts` (`bookRow`, ~line 122-137)
- Modify: `backend/src/modules/library/adapters/sqlite/sqliteLibraryRepository.ts:62-71, 107, 134`
- Modify: `backend/src/modules/library/workHolders.ts`, `backend/src/modules/library/index.ts:21`
- Test: `backend/src/modules/library/service.test.ts`, `backend/src/modules/library/workHolders.test.ts`

**Interfaces:**
- Produces: `communityRatings(workIds: string[]): Array<{ userId: string; rating: number }>` exported from `modules/library/index.ts` (one entry per user, finished + rated only).

- [ ] **Step 1: Failing tests**

In `service.test.ts`, add `rating` to the `rowsInDb` SELECT column list (after `finished_year`), then append:
```ts
test("a book row keeps a 1-5 rating and drops anything else", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", { books: [{ Title: "A", Rating: 4 }, { Title: "B", Rating: 9 }, { Title: "C", Rating: "4" }, { Title: "D" }, { Title: "E", Rating: 2.5 }] });
  assert.deepEqual(rowsInDb(db, "u1").books.map((row) => row.rating), [4, null, null, null, null]);
  db.close();
});

test("an existing database gains library_books.rating", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE library_books (user_id TEXT NOT NULL, position INTEGER NOT NULL, book_key TEXT NOT NULL, title TEXT, author TEXT, isbn TEXT, image_id TEXT, read_status REAL, series_number REAL, sort_order REAL, cover_url TEXT, finished_year INTEGER, row_hash TEXT NOT NULL, PRIMARY KEY (user_id, position))");
  applyLibrarySchema(db);
  const columns = (db.prepare("PRAGMA table_info(library_books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("rating"));
});
```
In `workHolders.test.ts`, append:
```ts
test("community ratings: finished and rated only, one per user from their first such copy", () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const row = db.prepare("INSERT INTO library_books (user_id, position, book_key, read_status, rating, row_hash, work_id) VALUES (?, ?, ?, ?, ?, 'h', ?)");
  row.run("ana", 3, "isbn:1", 2, 5, "w-old");
  row.run("ana", 1, "isbn:2", 2, 3, "w-new");
  row.run("bo", 0, "isbn:3", 1, 4, "w-new");
  row.run("cy", 0, "isbn:4", 2, null, "w-new");
  row.run("di", 0, "isbn:5", 2, 1, "w-other");
  row.run("ed", 2, "isbn:6", 2, 2, "w-old");
  const { communityRatings } = createWorkHolders(db);
  assert.deepEqual(communityRatings(["w-new", "w-old"]), [{ userId: "ana", rating: 3 }, { userId: "ed", rating: 2 }]);
  assert.deepEqual(communityRatings([]), []);
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd backend && npx tsx --test src/modules/library/service.test.ts src/modules/library/workHolders.test.ts`.

- [ ] **Step 3: Implement**
- `schema.sql`: add `rating INTEGER,` after `finished_year INTEGER,` in `library_books`.
- `connection.ts`: next to the `work_id` retrofit:
  ```ts
  if (!bookColumns.some((c) => c.name === "rating")) {
    db.exec(`ALTER TABLE library_books ADD COLUMN rating INTEGER`);
  }
  ```
- `domain/types.ts`: `rating: number | null;` after `finished_year`.
- `constants.ts`: `export const LIBRARY_ROWS_VERSION = 2;`
- `service.ts` `bookRow`: `rating: typeof book.Rating === "number" && Number.isInteger(book.Rating) && book.Rating >= 1 && book.Rating <= 5 ? book.Rating : null,` after `finished_year`.
- Repository upsert: add `rating` to the INSERT column list, a 15th `?`, `rating = excluded.rating` in the UPDATE SET, and `book.rating` in both `upsertBookStmt.run(...)` calls (lines 107 and 134) in the matching position.
- `workHolders.ts`:
  ```ts
  const ratingsStmt = db.prepare(`SELECT user_id, rating FROM library_books WHERE work_id IN (SELECT value FROM json_each(?)) AND read_status = 2 AND rating IS NOT NULL ORDER BY user_id, position`);

  function communityRatings(workIds: string[]): Array<{ userId: string; rating: number }> {
    if (workIds.length === 0) return [];
    const seen = new Set<string>();
    const ratings: Array<{ userId: string; rating: number }> = [];
    for (const row of ratingsStmt.all(JSON.stringify(workIds)) as Array<{ user_id: string; rating: number }>) {
      if (seen.has(row.user_id)) continue;
      seen.add(row.user_id);
      ratings.push({ userId: row.user_id, rating: row.rating });
    }
    return ratings;
  }
  ```
  return it from `createWorkHolders`, and add the lazy module-level wrapper:
  ```ts
  export function communityRatings(workIds: string[]) {
    holders ??= createWorkHolders(openLibraryDb());
    return holders.communityRatings(workIds);
  }
  ```
- `index.ts:21`: export `communityRatings` alongside `copyOfWork`.

- [ ] **Step 4: Run, expect PASS** — same command, then `cd backend && npm run typecheck && npm test`. The existing rows-version tests (`service.test.ts` ~1900-1950) pass explicit versions and must stay green; if one hard-codes `1` as "current", update it to read `LIBRARY_ROWS_VERSION`.

- [ ] **Step 5: Commit**
```bash
git add backend/src/modules/library && git commit -m "Store each library book's rating and read community ratings per work" -m "Bumps LIBRARY_ROWS_VERSION so the startup backfill fills rating for every existing library once." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tier placements from signed-in ballots

**Files:**
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts` (statement + method, near `listPublishedByWorks` ~41 and ~304)
- Modify: the repository interface that declares `listPublishedByWorks(workIds, limit): TierlistGameRow[]` (`rg -n "listPublishedByWorks" backend/src/modules/tierlists/domain`)
- Modify: `backend/src/modules/tierlists/service.ts` (`TierlistsService` ~113, its impl ~410, `TierlistsPublicApi` ~456, `createTierlistsPublicApi` ~475)
- Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`

**Interfaces:**
- Produces: `TierlistsPublicApi.tierPlacements(workIds: string[]): Array<{ tierlistId: string; tierIndex: number; tierCount: number }>`; repository method of the same name and shape.

- [ ] **Step 1: Failing test** — append to the repository test:
```ts
test("tier placements: signed-in ballots on published lists, mapped through the list's own tiers", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  const tiers = (ids: string[]) => JSON.stringify({ tiers: ids.map((id) => ({ id, label: id, color: "#fff", workIds: [] })), pool: [] });
  repo.insert(row({ id: "big", vote_code: "code-big", voting_open: 1, data: tiers(["s", "a", "b"]) }));
  repo.insert(row({ id: "tiny", vote_code: "code-tiny", voting_open: 1, data: tiers(["only"]) }));
  repo.insert(row({ id: "private", data: tiers(["s", "a"]) }));
  repo.saveBallot(ballot({ id: "b1", tierlist_id: "big", voter_user_id: "u1" }), [{ workId: "w-new", tierId: "a" }]);
  repo.saveBallot(ballot({ id: "b2", tierlist_id: "big", voter_user_id: "u2" }), [{ workId: "w-old", tierId: "s" }]);
  repo.saveBallot(ballot({ id: "b3", tierlist_id: "big", voter_user_id: null }), [{ workId: "w-new", tierId: "b" }]);
  repo.saveBallot(ballot({ id: "b4", tierlist_id: "big", voter_user_id: "u3" }), [{ workId: "w-new", tierId: "deleted-tier" }]);
  repo.saveBallot(ballot({ id: "b5", tierlist_id: "tiny", voter_user_id: "u1" }), [{ workId: "w-new", tierId: "only" }]);
  repo.saveBallot(ballot({ id: "b6", tierlist_id: "private", voter_user_id: "u1" }), [{ workId: "w-new", tierId: "s" }]);
  const sorted = (rows: Array<{ tierlistId: string; tierIndex: number; tierCount: number }>) => [...rows].sort((a, b) => a.tierIndex - b.tierIndex || a.tierlistId.localeCompare(b.tierlistId));
  assert.deepEqual(sorted(repo.tierPlacements(["w-new", "w-old"])), [
    { tierlistId: "big", tierIndex: 0, tierCount: 3 },
    { tierlistId: "tiny", tierIndex: 0, tierCount: 1 },
    { tierlistId: "big", tierIndex: 1, tierCount: 3 }
  ]);
  assert.deepEqual(repo.tierPlacements([]), []);
});
```
(1-tier lists are returned here and skipped by the works stats service, which owns the maths.) If `saveBallot` refuses a ballot on an unpublished list, insert `b6` with a direct `db.prepare("INSERT INTO tierlist_ballots …")`/placements insert instead, keeping `freshDb()`'s handle.

- [ ] **Step 2: Run, expect FAIL** — `cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`.

- [ ] **Step 3: Implement**
```ts
const tierPlacementsStmt = db.prepare(`
  SELECT p.tierlist_id, p.tier_id, t.data
  FROM tierlist_ballot_placements p
  JOIN tierlist_ballots b ON b.id = p.ballot_id
  JOIN tierlists t ON t.id = p.tierlist_id
  WHERE p.work_id IN (SELECT value FROM json_each(?)) AND b.voter_user_id IS NOT NULL AND t.vote_code IS NOT NULL
`);
```
```ts
    tierPlacements(workIds) {
      if (workIds.length === 0) return [];
      const tiersOf = new Map<string, string[]>();
      return (tierPlacementsStmt.all(JSON.stringify(workIds)) as Array<{ tierlist_id: string; tier_id: string; data: string }>).flatMap((row) => {
        let ids = tiersOf.get(row.tierlist_id);
        if (!ids) {
          ids = (JSON.parse(row.data) as { tiers: Array<{ id: string }> }).tiers.map((tier) => tier.id);
          tiersOf.set(row.tierlist_id, ids);
        }
        const tierIndex = ids.indexOf(row.tier_id);
        return tierIndex === -1 ? [] : [{ tierlistId: row.tierlist_id, tierIndex, tierCount: ids.length }];
      });
    },
```
Declare it on the repository interface, pass it through `TierlistsService` (`tierPlacements: (workIds) => repo.tierPlacements(workIds)`) and `createTierlistsPublicApi` (`tierPlacements: (workIds) => service.tierPlacements(workIds)`), with the interface entries `tierPlacements(workIds: string[]): Array<{ tierlistId: string; tierIndex: number; tierCount: number }>;`.

- [ ] **Step 4: Run, expect PASS** — same test file, then `cd backend && npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add backend/src/modules/tierlists && git commit -m "Read a work's tier placements from signed-in ballots on published lists" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tournament record

**Files:**
- Modify: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts`
- Modify: the arena repository interface (`rg -n "listPublishedByWorks" backend/src/modules/arena/domain`)
- Modify: `backend/src/modules/arena/service.ts` (`ArenaService` ~49 + impl ~303, `ArenaPublicApi` ~497 + `createArenaPublicApi` ~520)
- Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`

**Interfaces:**
- Consumes: `TournamentRecord` from `@scripta/shared` (Task 1).
- Produces: `ArenaPublicApi.tournamentRecord(workIds: string[]): TournamentRecord` (`entered: 0` when none; the stats service turns that into `null`).

- [ ] **Step 1: Failing test** — append, reusing the file's `tournament(...)` and `TournamentSlotRow` helpers from the `listPublishedByWorks` test:
```ts
test("tournament record: started brackets only, wins, losses, titles and the furthest round", () => {
  const db = freshDb();
  const repo = createSqliteArenaRepository(db);
  const slot = (tournamentId: string, index: number, workId: string): TournamentSlotRow => ({ tournament_id: tournamentId, slot_index: index, work_id: workId, title: "T", author: "A", cover_url: null });
  const duel = db.prepare(`INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_work_id, book_a_title, book_a_author, book_b_work_id, book_b_title, book_b_author, winner_side, status, opens_at, closes_at)
    VALUES (?, ?, ?, 0, ?, 'A', 'x', ?, 'B', 'y', ?, ?, '2026-01-01', '2026-01-02')`);
  repo.insertTournament(tournament({ id: "won", status: "completed", bracket_size: 4 }));
  repo.insertTournament(tournament({ id: "live", status: "active", bracket_size: 8 }));
  repo.insertTournament(tournament({ id: "draft", status: "seeding", bracket_size: 4 }));
  repo.replaceSlots("won", [slot("won", 0, "w-old"), slot("won", 1, "w-x")]);
  repo.replaceSlots("live", [slot("live", 0, "w-new"), slot("live", 1, "w-y")]);
  repo.replaceSlots("draft", [slot("draft", 0, "w-new")]);
  duel.run("d1", "won", 1, "w-old", "w-x", "a", "settled");
  duel.run("d2", "won", 2, "w-z", "w-old", "b", "settled");
  duel.run("d3", "live", 1, "w-new", "w-y", "b", "settled");
  duel.run("d4", "draft", 1, "w-new", "w-q", "a", "settled");
  assert.deepEqual(repo.tournamentRecord(["w-new", "w-old"]), { entered: 2, titles: 1, wins: 2, losses: 1, best: { round: 2, duels: 1 } });
  assert.deepEqual(repo.tournamentRecord(["w-none"]), { entered: 0, titles: 0, wins: 0, losses: 0, best: null });
});

test("an entered book whose first duel is still open has a best round but no result", () => {
  const db = freshDb();
  const repo = createSqliteArenaRepository(db);
  repo.insertTournament(tournament({ id: "live", status: "active", bracket_size: 8 }));
  repo.replaceSlots("live", [{ tournament_id: "live", slot_index: 0, work_id: "w", title: "T", author: "A", cover_url: null }]);
  db.prepare(`INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_work_id, book_a_title, book_a_author, book_b_work_id, book_b_title, book_b_author, winner_side, status, opens_at, closes_at)
    VALUES ('d', 'live', 1, 0, 'w', 'A', 'x', 'o', 'B', 'y', NULL, 'active', '2026-01-01', '2026-01-02')`).run();
  assert.deepEqual(repo.tournamentRecord(["w"]), { entered: 1, titles: 0, wins: 0, losses: 0, best: { round: 1, duels: 4 } });
});
```
(`freshDb()` here must return the db handle; if the file's `freshDb` already does, use it. If the `duels` table has other NOT NULL columns, add them to the INSERT with the values `seedTournament` uses.)

- [ ] **Step 2: Run, expect FAIL** — `cd backend && npx tsx --test src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`.

- [ ] **Step 3: Implement**
```ts
const enteredByWorksStmt = db.prepare(`
  SELECT DISTINCT t.id, t.status, t.bracket_size FROM tournament_slots s JOIN tournaments t ON t.id = s.tournament_id
  WHERE s.work_id IN (SELECT value FROM json_each(?)) AND t.status != 'seeding'
`);
const duelsByWorksStmt = db.prepare(`
  SELECT d.tournament_id, d.round_number, d.winner_side,
    CASE WHEN d.book_a_work_id IN (SELECT value FROM json_each(?1)) THEN 'a' ELSE 'b' END AS side
  FROM duels d JOIN tournaments t ON t.id = d.tournament_id
  WHERE t.status != 'seeding' AND (d.book_a_work_id IN (SELECT value FROM json_each(?1)) OR d.book_b_work_id IN (SELECT value FROM json_each(?1)))
`);
```
```ts
    tournamentRecord(workIds) {
      const record: TournamentRecord = { entered: 0, titles: 0, wins: 0, losses: 0, best: null };
      if (workIds.length === 0) return record;
      const ids = JSON.stringify(workIds);
      const tournaments = new Map((enteredByWorksStmt.all(ids) as Array<{ id: string; status: string; bracket_size: number }>).map((row) => [row.id, row]));
      record.entered = tournaments.size;
      for (const duel of duelsByWorksStmt.all(ids) as Array<{ tournament_id: string; round_number: number; winner_side: "a" | "b" | null; side: "a" | "b" }>) {
        const tournament = tournaments.get(duel.tournament_id);
        if (!tournament) continue;
        const duels = tournament.bracket_size / 2 ** duel.round_number;
        if (!record.best || duels < record.best.duels) record.best = { round: duel.round_number, duels };
        if (duel.winner_side === null) continue;
        if (duel.winner_side !== duel.side) record.losses += 1;
        else {
          record.wins += 1;
          if (tournament.status === "completed" && duels === 1) record.titles += 1;
        }
      }
      return record;
    },
```
`?1` reuses one bound value three times; if node:sqlite rejects numbered parameters here, use plain `?` and call `duelsByWorksStmt.all(ids, ids, ids)`. Import `TournamentRecord` from `@scripta/shared`. Declare it on the repository interface, pass through `ArenaService` (`tournamentRecord: (workIds) => repo.tournamentRecord(workIds)`) and `createArenaPublicApi`, with interface entries `tournamentRecord(workIds: string[]): TournamentRecord;`.

- [ ] **Step 4: Run, expect PASS** — same file, then `cd backend && npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add backend/src/modules/arena && git commit -m "Read a work's tournament record from started brackets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Works stats service, route and wiring

**Files:**
- Create: `backend/src/modules/works/stats.ts`
- Create: `backend/src/modules/works/stats.test.ts`
- Modify: `backend/src/modules/works/routes.ts`, `backend/src/modules/works/routes.test.ts`, `backend/src/modules/works/plugin.ts`, `backend/src/app.ts:235-245`
- Modify: `backend/package.json` (`test` script: append `src/modules/works/stats.test.ts`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
```ts
export type BookStatsDeps = {
  getWorkPage(id: string): { aliasIds: string[] } | undefined;
  communityRatings(workIds: string[]): Array<{ userId: string; rating: number }>;
  tierPlacements(workIds: string[]): Array<{ tierlistId: string; tierIndex: number; tierCount: number }>;
  tournamentRecord(workIds: string[]): TournamentRecord;
};
export function createBookStatsService(deps: BookStatsDeps): { getStats(id: string): BookStats | undefined };
export type BookStatsService = ReturnType<typeof createBookStatsService>;
```
`buildWorkRoutes(service: WorksService, stats: BookStatsService)`.

- [ ] **Step 1: Failing service tests** — `stats.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createBookStatsService, type BookStatsDeps } from "./stats.js";

const none = { entered: 0, titles: 0, wins: 0, losses: 0, best: null };
function deps(overrides: Partial<BookStatsDeps> = {}): BookStatsDeps {
  return {
    getWorkPage: (id) => (id === "w" || id === "old" ? { aliasIds: ["w", "old"] } : undefined),
    communityRatings: () => [],
    tierPlacements: () => [],
    tournamentRecord: () => none,
    ...overrides
  };
}
const stats = (overrides: Partial<BookStatsDeps> = {}, id = "w") => createBookStatsService(deps(overrides)).getStats(id);

test("an unknown work has no stats; a merged-away id asks for the canonical aliases", () => {
  assert.equal(stats({}, "nope"), undefined);
  const seen: string[][] = [];
  stats({ communityRatings: (ids) => { seen.push(ids); return []; } }, "old");
  assert.deepEqual(seen, [["w", "old"]]);
});

test("community rating needs three ratings and reports average and distribution", () => {
  const two = [{ userId: "a", rating: 4 }, { userId: "b", rating: 5 }];
  assert.equal(stats({ communityRatings: () => two })!.community, null);
  assert.deepEqual(stats({ communityRatings: () => [...two, { userId: "c", rating: 1 }] })!.community, { average: 10 / 3, count: 3, distribution: [1, 0, 0, 1, 1] });
});

test("tiers need three placements, skip one-tier lists and weigh lists equally", () => {
  const busy = Array.from({ length: 10 }, () => ({ tierlistId: "busy", tierIndex: 0, tierCount: 5 }));
  const quiet = [{ tierlistId: "quiet", tierIndex: 4, tierCount: 5 }];
  const tiny = [{ tierlistId: "tiny", tierIndex: 0, tierCount: 1 }, { tierlistId: "tiny", tierIndex: 0, tierCount: 1 }];
  assert.equal(stats({ tierPlacements: () => [...quiet, ...tiny] })!.tiers, null);
  assert.deepEqual(stats({ tierPlacements: () => [...busy, ...quiet, ...tiny] })!.tiers, { score: 0.5, letter: "C", lists: 2, ballots: 11 });
});

test("tournaments are null when never entered and passed through otherwise", () => {
  assert.equal(stats()!.tournaments, null);
  const record = { entered: 2, titles: 1, wins: 3, losses: 1, best: { round: 2, duels: 1 } };
  assert.deepEqual(stats({ tournamentRecord: () => record })!.tournaments, record);
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd backend && npx tsx --test src/modules/works/stats.test.ts`.

- [ ] **Step 3: Implement `stats.ts`**
```ts
import { BOOK_STATS_MINIMUM, tierLetter, type BookStats, type CommunityRating, type TierStanding, type TournamentRecord } from "@scripta/shared";

export type BookStatsDeps = {
  getWorkPage(id: string): { aliasIds: string[] } | undefined;
  communityRatings(workIds: string[]): Array<{ userId: string; rating: number }>;
  tierPlacements(workIds: string[]): Array<{ tierlistId: string; tierIndex: number; tierCount: number }>;
  tournamentRecord(workIds: string[]): TournamentRecord;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function community(ratings: Array<{ rating: number }>): CommunityRating | null {
  if (ratings.length < BOOK_STATS_MINIMUM) return null;
  const distribution: CommunityRating["distribution"] = [0, 0, 0, 0, 0];
  for (const { rating } of ratings) distribution[rating - 1]! += 1;
  return { average: mean(ratings.map((r) => r.rating)), count: ratings.length, distribution };
}

function tiers(placements: Array<{ tierlistId: string; tierIndex: number; tierCount: number }>): TierStanding | null {
  const byList = new Map<string, number[]>();
  for (const placement of placements) {
    if (placement.tierCount < 2) continue;
    byList.set(placement.tierlistId, [...(byList.get(placement.tierlistId) ?? []), placement.tierIndex / (placement.tierCount - 1)]);
  }
  const ballots = [...byList.values()].reduce((sum, positions) => sum + positions.length, 0);
  if (ballots < BOOK_STATS_MINIMUM) return null;
  const score = mean([...byList.values()].map(mean));
  return { score, letter: tierLetter(score), lists: byList.size, ballots };
}

export function createBookStatsService(deps: BookStatsDeps) {
  return {
    getStats(id: string): BookStats | undefined {
      const work = deps.getWorkPage(id);
      if (!work) return undefined;
      const record = deps.tournamentRecord(work.aliasIds);
      return {
        community: community(deps.communityRatings(work.aliasIds)),
        tiers: tiers(deps.tierPlacements(work.aliasIds)),
        tournaments: record.entered > 0 ? record : null
      };
    }
  };
}

export type BookStatsService = ReturnType<typeof createBookStatsService>;
```
`distribution[rating - 1]! += 1` relies on `rating` being 1–5, which Task 2 guarantees at write time.

- [ ] **Step 4: Run, expect PASS** — `cd backend && npx tsx --test src/modules/works/stats.test.ts`.

- [ ] **Step 5: Failing route tests** — in `routes.test.ts`, change `appWith` to take a stats function and register both services:
```ts
function appWith(getPage: (id: string, viewerId: string | null) => unknown, getStats: (id: string) => unknown = () => undefined) {
  ...
  void app.register(buildWorkRoutes({ getPage } as never, { getStats } as never));
  return app;
}
```
and append:
```ts
test("stats: 404 for an unknown work, the stats otherwise, never cached, viewer optional", async () => {
  const app = appWith(() => undefined, (id) => (id === "w" ? { community: null, tiers: null, tournaments: null } : undefined));
  const missing = await app.inject({ url: "/works/nope/stats" });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "No book with that id." });
  const found = await app.inject({ url: "/works/w/stats", headers: { authorization: "Bearer good" } });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), { community: null, tiers: null, tournaments: null });
  assert.equal(found.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ url: "/works/w/stats", headers: { authorization: "Bearer bad" } })).statusCode, 401);
  await app.close();
});

test("stats: a catalog outage is a 503", async () => {
  const app = appWith(() => undefined, () => { throw new WorkResolutionError(new Error("disk")); });
  assert.equal((await app.inject({ url: "/works/w/stats" })).statusCode, 503);
  await app.close();
});
```

- [ ] **Step 6: Run, expect FAIL** — `cd backend && npx tsx --test src/modules/works/routes.test.ts`.

- [ ] **Step 7: Implement route and wiring**

`routes.ts`:
```ts
export function buildWorkRoutes(service: WorksService, stats: BookStatsService) {
  return async function workRoutes(app: FastifyInstance) {
    app.get("/works/:id", ...unchanged);
    app.get("/works/:id/stats", async (request, reply) => {
      const { id } = request.params as { id: string };
      getOptionalAuthenticatedUser(request);
      const result = stats.getStats(id);
      reply.header("Cache-Control", "no-store");
      if (!result) return reply.code(404).send({ error: "No book with that id." });
      return reply.send(result);
    });
  };
}
```
(`getOptionalAuthenticatedUser` is what turns a bad token into the 401 the test expects; keep the call even though the viewer is unused.)

`plugin.ts`:
```ts
export async function worksPlugin(app: FastifyInstance, deps: WorksDeps & Omit<BookStatsDeps, "getWorkPage">) {
  const getWorkPage: WorksDeps["getWorkPage"] = (id) => {
    try {
      return deps.getWorkPage(id);
    } catch (error) {
      throw new WorkResolutionError(error);
    }
  };
  const service = createWorksService({ ...deps, getWorkPage });
  const stats = createBookStatsService({ getWorkPage, communityRatings: deps.communityRatings, tierPlacements: deps.tierPlacements, tournamentRecord: deps.tournamentRecord });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildWorkRoutes(service, stats));
  });
}
```

`app.ts` — import `communityRatings` from `./modules/library/index.js` and add to the `registerWorksModule` options:
```ts
    communityRatings,
    tierPlacements: (workIds: string[]) => getTierlistsPublicApi().tierPlacements(workIds),
    tournamentRecord: (workIds: string[]) => getArenaPublicApi().tournamentRecord(workIds),
```

`backend/package.json`: append ` src/modules/works/stats.test.ts` to the `test` script's file list (after `src/modules/works/service.test.ts`).

- [ ] **Step 8: Run, expect PASS** — `cd backend && npx tsx --test src/modules/works/routes.test.ts src/modules/works/app.test.ts && npm run typecheck && npm test`. If `app.test.ts` builds the works plugin with a deps literal, add the three new deps there.

- [ ] **Step 9: Commit**
```bash
git add backend && git commit -m "Serve GET /works/:id/stats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Smoke check** — with the dev stack running per `docs/dev-workflow.md`, `curl -s localhost:<backend port>/works/<a fixture work id>/stats` returns the JSON shape; the backend log shows `library backfill: rebuilt N accounts` once on first boot after the rows-version bump.

---

## Self-review notes

- Spec coverage: counting rules (Tasks 2–5), endpoint (5), shared model (1), testing list (each task), rollout log check (Task 5 step 10). UI is PR B, planned after piece 1 merges.
- Names used across tasks: `communityRatings`, `tierPlacements`, `tournamentRecord`, `createBookStatsService`, `BookStatsDeps`, `BookStatsService`, `bookStatsModel`, `tierLetter`, `BOOK_STATS_MINIMUM`, `TournamentRecord`, `BookStats`.
