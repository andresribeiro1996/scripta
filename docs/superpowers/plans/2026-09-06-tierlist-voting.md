# Tier List Voting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tier list be opened for voting, which duplicates it into a public "community" tier list that anyone can rank; every submission is a ballot, and the aggregate decides each book's tier.

**Architecture:** Opening voting creates a *second* `tierlists` row holding structure only (tiers with empty `bookKeys` + the full pool), with the owner's placements written as ballot #1. Ballots are stored normalized, one row per book placed, so the aggregate is a single indexed `GROUP BY` returning a per-book × per-tier histogram whose size is constant in voter count. The frontend turns that histogram into Average / Most-voted / Median views with a pure function.

**Tech Stack:** Fastify + TypeScript, `node:sqlite` (`DatabaseSync`), `@fastify/rate-limit`, zod; React + Vite + Tailwind, `@tanstack/react-query`, `@dnd-kit/core`; tests via `tsx --test` (backend) and standalone `npx tsx scripts/*.mts` scripts (frontend).

**Spec:** `docs/superpowers/specs/2026-09-05-tierlist-voting-design.md`

## Global Constraints

- **AGENTS.md rules apply to every task:** write the minimum code that works; reuse existing code, patterns and the stdlib first; no speculative features, abstractions or config options; never simplify away validation, error handling or security; **no comments in code unless asked** — except where this plan gives you a comment verbatim in a code block, which you must keep (this codebase documents non-obvious decisions in comments, and those specific ones are load-bearing).
- Run `npm run typecheck` in the package you changed after every task; `npm run lint` too for `frontend/`.
- Backend module isolation: `modules/tierlists` may import from another module **only** via that module's `index.ts`. Never reach into another module's `service.ts`, `adapters/`, or `domain/`.
- Only `adapters/sqlite/*` inside a module may contain SQL.
- New backend test files MUST be added to `backend/package.json`'s `test` script file list, or they never run.
- `vote_access` values are exactly `"anonymous"` and `"members"`. `voting_open` is an INTEGER `0`/`1` in SQLite (no BOOLEAN type).
- Tier-order scoring: the **first** tier in `tiers[]` is index `0` (the best). Every tie in every aggregation mode breaks **toward the higher tier** (the lower index).
- Frontend pure-logic tests are standalone `frontend/scripts/test-*.mts` scripts using the `check(label, condition)` helper convention from `scripts/test-murals.mts`, run with `npx tsx`. The frontend has no test runner; **do not add one**.

---

## File Structure

**Backend — `backend/src/modules/tierlists/`**

| File | Responsibility |
|---|---|
| `domain/types.ts` (modify) | Row/domain types: voting columns on `TierlistRow`, plus `BallotRow`, `Placement`, `HistogramCell`, `VoteAccess` |
| `domain/ports.ts` (modify) | `TierlistsRepository` gains voting + ballot methods |
| `adapters/sqlite/schema.sql` (modify) | Voting columns, ballot tables, indexes |
| `adapters/sqlite/connection.ts` (modify) | `applyTierlistsMigrations(db)` — extracted so it is testable |
| `adapters/sqlite/sqliteTierlistsRepository.ts` (modify) | SQL for the new port methods |
| `adapters/sqlite/sqliteTierlistsRepository.test.ts` (create) | Adapter tests against `:memory:` — the SQL a fake cannot validate |
| `service.ts` (modify) | `openVoting`, `setVotingState`, ballots, results, `listPublicTierlists` |
| `service.test.ts` (modify) | Extends the existing in-memory fake and its tests |
| `routes.ts` (modify) | Authenticated voting routes + `buildPublicTierlistRoutes` |
| `plugin.ts` (modify) | Second, rate-limited encapsulation scope for the public routes |

**Backend — other modules**

| File | Responsibility |
|---|---|
| `modules/auth/guard.ts` (modify) | `getOptionalAuthenticatedUser(request)` |
| `modules/auth/index.ts` (modify) | Re-export it |

**Frontend — `frontend/src/`**

| File | Responsibility |
|---|---|
| `lib/tierlistResults.ts` (create) | Pure `aggregate(histogram, tierIds, mode)` |
| `components/tierlist/TierBoard.tsx` (create) | The ranking board, extracted from the editor page |
| `pages/TierListEditorPage.tsx` (modify) | Consumes `TierBoard`; gains the owner voting controls |
| `api/tierlistVoting.ts` (create) | One function per new route |
| `hooks/useTierlistVoting.ts` (create) | react-query wrappers |
| `hooks/usePublicTierlists.ts` (create) | Mirrors `usePublicTournaments` |
| `components/tierlist/TierlistResultsView.tsx` (create) | Mode switcher + results board |
| `pages/VoteTierlistPage.tsx` (create) | Public `/vote/:code` page |
| `pages/ArenaPublicListPage.tsx` (modify) | Tier lists section |
| `App.tsx` (modify) | `/vote/:code` route |
| `scripts/test-tierlist-results.mts` (create) | Pure-logic tests for the aggregation |

---

### Task 1: Schema, migration, and row types

**Files:**
- Modify: `backend/src/modules/tierlists/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/tierlists/domain/types.ts`
- Create: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `applyTierlistsMigrations(db: DatabaseSync): void` from `connection.ts`; types `VoteAccess`, `TierlistRow` (extended), `BallotRow`, `Placement`, `HistogramCell` from `domain/types.ts`.

**Why the migration is its own function:** `openTierlistsDb()` reads `env.TIERLISTS_DB_PATH` and touches the filesystem, so it can't be unit-tested. Extracting the schema+migration step lets a test run it against `new DatabaseSync(":memory:")`.

**Critical:** SQLite **cannot** add a `UNIQUE` column with `ALTER TABLE ADD COLUMN`. `vote_code` is therefore a plain `TEXT` column plus a separate `CREATE UNIQUE INDEX`, in both the fresh-create and migration paths. Getting this wrong throws on every existing database.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`:

```ts
// Adapter-level tests against a real in-memory SQLite database — the SQL
// itself (migrations, the partial unique index, the histogram GROUP BY)
// is exactly what service.test.ts's in-memory fake cannot check.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { applyTierlistsMigrations } from "./connection.js";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  return db;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

test("a fresh database has the voting columns and ballot tables", () => {
  const db = freshDb();
  const cols = columnNames(db, "tierlists");
  for (const col of ["vote_code", "vote_access", "voting_open", "source_tierlist_id"]) {
    assert.ok(cols.includes(col), `tierlists is missing ${col}`);
  }
  assert.ok(columnNames(db, "tierlist_ballots").includes("voter_user_id"));
  assert.ok(columnNames(db, "tierlist_ballot_placements").includes("tier_id"));
});

test("migrating a pre-voting database adds the columns without losing rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tierlists (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO tierlists VALUES ('t1','u1','Old','{}','2026-01-01','2026-01-01')`).run();

  applyTierlistsMigrations(db);

  const cols = columnNames(db, "tierlists");
  assert.ok(cols.includes("vote_code"));
  const row = db.prepare(`SELECT name, vote_access, voting_open, vote_code FROM tierlists WHERE id = 't1'`).get() as {
    name: string;
    vote_access: string;
    voting_open: number;
    vote_code: string | null;
  };
  assert.equal(row.name, "Old");
  assert.equal(row.vote_access, "anonymous");
  assert.equal(row.voting_open, 0);
  assert.equal(row.vote_code, null);
});

test("applyTierlistsMigrations is idempotent", () => {
  const db = freshDb();
  applyTierlistsMigrations(db);
  applyTierlistsMigrations(db);
  assert.ok(columnNames(db, "tierlists").includes("vote_code"));
});

test("vote_code is unique but many rows may leave it NULL", () => {
  const db = freshDb();
  const insert = db.prepare(
    `INSERT INTO tierlists (id, owner_user_id, name, data, created_at, updated_at, vote_code)
     VALUES (?, 'u1', 'n', '{}', '2026-01-01', '2026-01-01', ?)`
  );
  insert.run("a", null);
  insert.run("b", null);
  insert.run("c", "code1");
  assert.throws(() => insert.run("d", "code1"));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts
```

Expected: FAIL — `applyTierlistsMigrations` is not exported from `connection.js`.

- [ ] **Step 3: Add the schema**

In `backend/src/modules/tierlists/adapters/sqlite/schema.sql`, replace the `CREATE TABLE tierlists` statement's column list by adding the four new columns before `created_at`, and append the new indexes and tables. The full file becomes:

```sql
-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql:
-- no real foreign key back to auth's users table, owner_user_id is just
-- an opaque string trusted because it came from a token auth already
-- verified (same as modules/arena's tournaments).

CREATE TABLE IF NOT EXISTS tierlists (
  id                 TEXT PRIMARY KEY,
  owner_user_id      TEXT NOT NULL,
  name               TEXT NOT NULL,
  data               TEXT NOT NULL DEFAULT '{}',
  -- NULL on an ordinary private tier list; set once when a community
  -- copy is created and never rotated. Deliberately NOT declared UNIQUE
  -- inline: SQLite cannot ADD COLUMN with a UNIQUE constraint, so the
  -- migration path in connection.ts could never match this. The separate
  -- unique index below is what enforces it on BOTH paths.
  vote_code          TEXT,
  vote_access        TEXT NOT NULL DEFAULT 'anonymous',
  voting_open        INTEGER NOT NULL DEFAULT 0,
  source_tierlist_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tierlists_owner_user_id ON tierlists(owner_user_id);

-- SQLite treats multiple NULLs as distinct, so every ordinary tier list
-- (vote_code IS NULL) coexists happily under a UNIQUE index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tierlists_vote_code ON tierlists(vote_code);

-- Partial, so listing the public directory never scans private tier lists.
CREATE INDEX IF NOT EXISTS idx_tierlists_public
  ON tierlists(created_at DESC) WHERE vote_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS tierlist_ballots (
  id            TEXT PRIMARY KEY,
  tierlist_id   TEXT NOT NULL,
  voter_user_id TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tierlist_ballots_tierlist ON tierlist_ballots(tierlist_id);

-- One ballot per account per tier list, enforced by the database rather
-- than by handler logic. Partial so anonymous ballots (all NULL) never
-- collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tierlist_ballots_one_per_voter
  ON tierlist_ballots(tierlist_id, voter_user_id) WHERE voter_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tierlist_ballot_placements (
  ballot_id   TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE,
  tierlist_id TEXT NOT NULL,
  book_key    TEXT NOT NULL,
  tier_id     TEXT NOT NULL,
  PRIMARY KEY (ballot_id, book_key)
);
CREATE INDEX IF NOT EXISTS idx_tierlist_placements_histogram
  ON tierlist_ballot_placements(tierlist_id, book_key, tier_id);
```

- [ ] **Step 4: Extract and extend the migration**

Rewrite `backend/src/modules/tierlists/adapters/sqlite/connection.ts`:

```ts
// Opens (and migrates) this module's own SQLite database — mirrors
// modules/arena/adapters/sqlite/connection.ts exactly. A separate file
// from every other module's, per the module-isolation convention.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

/** Schema + column migrations, split out from openTierlistsDb so it can
 *  run against an in-memory database in tests — openTierlistsDb itself
 *  reads env and touches the filesystem, so it can't be unit-tested. */
export function applyTierlistsMigrations(db: DatabaseSync): void {
  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  // Same PRAGMA-then-ALTER pattern as modules/murals' own connection.ts:
  // CREATE TABLE IF NOT EXISTS above is a no-op on a database that already
  // has the table, so pre-voting databases need each column added by hand.
  // NOTE: no UNIQUE here — SQLite rejects ADD COLUMN with a UNIQUE
  // constraint. idx_tierlists_vote_code in schema.sql enforces it instead,
  // and runs after these ALTERs on every open.
  const columns = db.prepare(`PRAGMA table_info(tierlists)`).all() as { name: string }[];
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!has("vote_code")) db.exec(`ALTER TABLE tierlists ADD COLUMN vote_code TEXT`);
  if (!has("vote_access")) db.exec(`ALTER TABLE tierlists ADD COLUMN vote_access TEXT NOT NULL DEFAULT 'anonymous'`);
  if (!has("voting_open")) db.exec(`ALTER TABLE tierlists ADD COLUMN voting_open INTEGER NOT NULL DEFAULT 0`);
  if (!has("source_tierlist_id")) db.exec(`ALTER TABLE tierlists ADD COLUMN source_tierlist_id TEXT`);

  // Re-run so the indexes exist on a migrated database too: on the first
  // pass above they were skipped, because the columns they name didn't
  // exist yet on a pre-voting table.
  db.exec(schema);
}

export function openTierlistsDb(): DatabaseSync {
  mkdirSync(dirname(env.TIERLISTS_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.TIERLISTS_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  applyTierlistsMigrations(db);

  return db;
}
```

- [ ] **Step 5: Extend the row types**

Replace `backend/src/modules/tierlists/domain/types.ts` with:

```ts
// Domain types for the tierlists module.

/** Who may cast a ballot on a community tier list. */
export type VoteAccess = "anonymous" | "members";

/** Row shape as stored — `data` is the tier list's document ({tiers,
 *  pool}) as raw JSON text, kept opaque all the way down (same treatment
 *  as `blocks` in modules/murals/domain/types.ts's MuralRow): parsed
 *  only at the edges (service.ts parses on read, stringifies on write).
 *  This module doesn't validate the document's shape beyond "is it an
 *  object."
 *
 *  The voting columns are the one exception to that opacity, and only
 *  for community copies: see service.ts's openVoting and validatePlacements. */
export interface TierlistRow {
  id: string;
  owner_user_id: string;
  name: string;
  data: string;
  /** NULL on an ordinary tier list; a short public code on a community copy. */
  vote_code: string | null;
  vote_access: VoteAccess;
  /** SQLite has no BOOLEAN — 0 or 1. */
  voting_open: number;
  /** NULL unless this row is a community copy, then the original's id. */
  source_tierlist_id: string | null;
  created_at: string;
  updated_at: string;
}

/** What the service hands back to routes.ts — `data` here is the parsed
 *  JSON value, not the raw text. */
export interface Tierlist {
  id: string;
  name: string;
  data: unknown;
  voteCode: string | null;
  voteAccess: VoteAccess;
  votingOpen: boolean;
  sourceTierlistId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One person's submission on a community tier list. `voter_user_id` is
 *  NULL for an anonymous ballot, in which case `id` (handed back once, on
 *  first submission) is the only handle the voter has to edit it. */
export interface BallotRow {
  id: string;
  tierlist_id: string;
  voter_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/** One book placed in one tier by one ballot. A book the voter left
 *  unranked simply has no Placement — that is how "no opinion" is stored. */
export interface Placement {
  bookKey: string;
  tierId: string;
}

/** How many ballots put `bookKey` in `tierId`. Cells with zero votes are
 *  absent, so a histogram is at most pool_size × tier_count entries
 *  regardless of how many people voted. */
export interface HistogramCell {
  bookKey: string;
  tierId: string;
  votes: number;
}
```

- [ ] **Step 6: Keep service.ts compiling**

The widened `TierlistRow`/`Tierlist` types break `service.ts` immediately, so fix it in this task rather than leaving the package red. In `backend/src/modules/tierlists/service.ts`, `toTierlist` maps the new fields:

```ts
function toTierlist(row: TierlistRow): Tierlist {
  const parsed = JSON.parse(row.data) as { tiers?: unknown; pool?: unknown };
  return {
    id: row.id,
    name: row.name,
    data: { tiers: parsed.tiers ?? [], pool: parsed.pool ?? [] },
    voteCode: row.vote_code,
    voteAccess: row.vote_access,
    votingOpen: row.voting_open === 1,
    sourceTierlistId: row.source_tierlist_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

and `createTierlist`'s row literal gains, before `created_at`:

```ts
        vote_code: null,
        vote_access: "anonymous",
        voting_open: 0,
        source_tierlist_id: null,
```

- [ ] **Step 7: Register the test file**

In `backend/package.json`, extend the `test` script:

```json
"test": "tsx --test src/modules/arena/service.test.ts src/modules/murals/service.test.ts src/modules/tierlists/service.test.ts src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts"
```

- [ ] **Step 8: Run the tests and typecheck**

```bash
cd backend && npm test && npm run typecheck
```

Expected: the four new adapter tests PASS, the existing tier list tests still PASS, and typecheck is clean. The legacy-row test in `service.test.ts` casts its literal `as TierlistRow`, which keeps compiling on purpose — it models a row written before these columns existed.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/tierlists backend/package.json
git commit -m "feat(tierlists): add voting columns, ballot tables, and a testable migration"
```

---

### Task 2: Repository port and SQLite adapter

**Files:**
- Modify: `backend/src/modules/tierlists/domain/ports.ts`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`
- Modify: `backend/src/modules/tierlists/service.ts` (only `toTierlist`, to keep the package compiling)

**Interfaces:**
- Consumes: `TierlistRow`, `BallotRow`, `Placement`, `HistogramCell`, `VoteAccess` (Task 1).
- Produces: the extended `TierlistsRepository` port, consumed by Tasks 3-5. Exact new methods:
  - `getByVoteCode(code: string): TierlistRow | undefined`
  - `insertCommunityCopy(row: TierlistRow, ballot: BallotRow, placements: Placement[]): void`
  - `setVoting(id: string, userId: string, patch: { vote_access?: VoteAccess; voting_open?: number }): TierlistRow | undefined`
  - `listPublic(limit: number, offset: number): TierlistRow[]`
  - `getBallotById(tierlistId: string, ballotId: string): BallotRow | undefined`
  - `getBallotByVoter(tierlistId: string, voterUserId: string): BallotRow | undefined`
  - `saveBallot(ballot: BallotRow, placements: Placement[]): void`
  - `getPlacements(ballotId: string): Placement[]`
  - `histogram(tierlistId: string): HistogramCell[]`
  - `ballotCount(tierlistId: string): number`
  - `ballotCountsByTierlist(): Map<string, number>`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`:

```ts
import { createSqliteTierlistsRepository } from "./sqliteTierlistsRepository.js";
import type { BallotRow, TierlistRow } from "../../domain/types.js";

function row(overrides: Partial<TierlistRow> & { id: string }): TierlistRow {
  return {
    owner_user_id: "u1",
    name: "List",
    data: JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#fff", bookKeys: [] }], pool: ["b1", "b2"] }),
    vote_code: null,
    vote_access: "anonymous",
    voting_open: 0,
    source_tierlist_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function ballot(overrides: Partial<BallotRow> & { id: string; tierlist_id: string }): BallotRow {
  return {
    voter_user_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("insertCommunityCopy stores the copy with its seeded ballot atomically", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(
    row({ id: "c1", vote_code: "abc12345", voting_open: 1, source_tierlist_id: "t1" }),
    ballot({ id: "bal1", tierlist_id: "c1", voter_user_id: "u1" }),
    [
      { bookKey: "b1", tierId: "s" },
      { bookKey: "b2", tierId: "s" }
    ]
  );

  assert.equal(repo.getByVoteCode("abc12345")?.id, "c1");
  assert.equal(repo.ballotCount("c1"), 1);
  assert.deepEqual(repo.getPlacements("bal1"), [
    { bookKey: "b1", tierId: "s" },
    { bookKey: "b2", tierId: "s" }
  ]);
});

test("getByVoteCode returns undefined for an unknown code", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  assert.equal(repo.getByVoteCode("nope"), undefined);
});

test("histogram counts each book-tier pair across ballots", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1" }), [
    { bookKey: "b1", tierId: "s" }
  ]);
  repo.saveBallot(ballot({ id: "bal2", tierlist_id: "c1" }), [
    { bookKey: "b1", tierId: "s" },
    { bookKey: "b2", tierId: "a" }
  ]);

  const cells = repo.histogram("c1");
  assert.equal(cells.find((c) => c.bookKey === "b1" && c.tierId === "s")?.votes, 2);
  assert.equal(cells.find((c) => c.bookKey === "b2" && c.tierId === "a")?.votes, 1);
  assert.equal(repo.ballotCount("c1"), 2);
});

test("saveBallot replaces a ballot's placements rather than appending", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1" }), [
    { bookKey: "b1", tierId: "s" }
  ]);
  repo.saveBallot(ballot({ id: "bal1", tierlist_id: "c1" }), [{ bookKey: "b1", tierId: "a" }]);

  assert.deepEqual(repo.getPlacements("bal1"), [{ bookKey: "b1", tierId: "a" }]);
  assert.equal(repo.ballotCount("c1"), 1);
});

test("an account cannot hold two ballots on one tier list", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1", voter_user_id: "u9" }), []);
  assert.throws(() => repo.saveBallot(ballot({ id: "bal2", tierlist_id: "c1", voter_user_id: "u9" }), []));
  assert.equal(repo.getBallotByVoter("c1", "u9")?.id, "bal1");
});

test("listPublic returns only community copies, newest first", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insert(row({ id: "private1" }));
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "aaa", created_at: "2026-01-01T00:00:00.000Z" }), ballot({ id: "b1", tierlist_id: "c1" }), []);
  repo.insertCommunityCopy(row({ id: "c2", vote_code: "bbb", created_at: "2026-02-01T00:00:00.000Z" }), ballot({ id: "b2", tierlist_id: "c2" }), []);

  assert.deepEqual(repo.listPublic(10, 0).map((t) => t.id), ["c2", "c1"]);
  assert.deepEqual(repo.listPublic(1, 1).map((t) => t.id), ["c1"]);
  assert.equal(repo.ballotCountsByTierlist().get("c1"), 1);
});

test("setVoting changes access and open state, ownership-checked", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "b1", tierlist_id: "c1" }), []);

  assert.equal(repo.setVoting("c1", "u2", { voting_open: 0 }), undefined);
  const updated = repo.setVoting("c1", "u1", { vote_access: "members", voting_open: 0 });
  assert.equal(updated?.vote_access, "members");
  assert.equal(updated?.voting_open, 0);
  assert.equal(repo.getOwned("c1", "u1")?.vote_access, "members");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts
```

Expected: FAIL — `repo.insertCommunityCopy is not a function`.

- [ ] **Step 3: Extend the port**

Append to the `TierlistsRepository` interface in `backend/src/modules/tierlists/domain/ports.ts` (keep the existing methods, and add these imports: `BallotRow`, `HistogramCell`, `Placement`, `VoteAccess` from `./types.js`):

```ts
  /** Lookup by public code — NOT ownership-checked: this backs the public
   *  voting routes, where the caller has no session at all. */
  getByVoteCode(code: string): TierlistRow | undefined;
  /** The community copy and its seeded owner ballot in ONE transaction —
   *  a copy that exists without its owner's vote, or a ballot orphaned by
   *  a failed insert, would both be corrupt states no caller can repair. */
  insertCommunityCopy(row: TierlistRow, ballot: BallotRow, placements: Placement[]): void;
  setVoting(id: string, userId: string, patch: { vote_access?: VoteAccess; voting_open?: number }): TierlistRow | undefined;
  /** Every community copy, newest first. Ordinary tier lists are excluded. */
  listPublic(limit: number, offset: number): TierlistRow[];
  getBallotById(tierlistId: string, ballotId: string): BallotRow | undefined;
  getBallotByVoter(tierlistId: string, voterUserId: string): BallotRow | undefined;
  /** Insert-or-replace a ballot and REPLACE its placements wholesale (a
   *  re-vote that moves a book must not leave the old placement behind). */
  saveBallot(ballot: BallotRow, placements: Placement[]): void;
  getPlacements(ballotId: string): Placement[];
  histogram(tierlistId: string): HistogramCell[];
  ballotCount(tierlistId: string): number;
  /** Ballot totals for every tier list at once — one grouped count, so
   *  listing the public directory doesn't fire a query per row. */
  ballotCountsByTierlist(): Map<string, number>;
```

- [ ] **Step 4: Implement in the SQLite adapter**

In `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts`: update `insertStmt` and `updateStmt` to carry the new columns, and add the new statements and methods. The changed and added parts:

```ts
  const insertStmt = db.prepare(`
    INSERT INTO tierlists (id, owner_user_id, name, data, vote_code, vote_access, voting_open, source_tierlist_id, created_at, updated_at)
    VALUES ($id, $owner_user_id, $name, $data, $vote_code, $vote_access, $voting_open, $source_tierlist_id, $created_at, $updated_at)
  `);
  const getByVoteCodeStmt = db.prepare(`SELECT * FROM tierlists WHERE vote_code = ?`);
  const listPublicStmt = db.prepare(
    `SELECT * FROM tierlists WHERE vote_code IS NOT NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`
  );
  const setVotingStmt = db.prepare(`
    UPDATE tierlists SET vote_access = $vote_access, voting_open = $voting_open, updated_at = $updated_at
    WHERE id = $id AND owner_user_id = $owner_user_id
  `);
  const insertBallotStmt = db.prepare(`
    INSERT INTO tierlist_ballots (id, tierlist_id, voter_user_id, created_at, updated_at)
    VALUES ($id, $tierlist_id, $voter_user_id, $created_at, $updated_at)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `);
  const deletePlacementsStmt = db.prepare(`DELETE FROM tierlist_ballot_placements WHERE ballot_id = ?`);
  const insertPlacementStmt = db.prepare(`
    INSERT INTO tierlist_ballot_placements (ballot_id, tierlist_id, book_key, tier_id)
    VALUES ($ballot_id, $tierlist_id, $book_key, $tier_id)
  `);
  const getBallotByIdStmt = db.prepare(`SELECT * FROM tierlist_ballots WHERE tierlist_id = ? AND id = ?`);
  const getBallotByVoterStmt = db.prepare(`SELECT * FROM tierlist_ballots WHERE tierlist_id = ? AND voter_user_id = ?`);
  const getPlacementsStmt = db.prepare(
    `SELECT book_key, tier_id FROM tierlist_ballot_placements WHERE ballot_id = ? ORDER BY book_key ASC`
  );
  const histogramStmt = db.prepare(`
    SELECT book_key, tier_id, COUNT(*) AS votes
    FROM tierlist_ballot_placements WHERE tierlist_id = ?
    GROUP BY book_key, tier_id
  `);
  const ballotCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM tierlist_ballots WHERE tierlist_id = ?`);
  const ballotCountsStmt = db.prepare(`SELECT tierlist_id, COUNT(*) AS n FROM tierlist_ballots GROUP BY tierlist_id`);
```

A plain function, declared above the `return {...}`, so both `saveBallot` and `insertCommunityCopy`'s transaction can call it without going through the returned object:

```ts
  function saveBallotRow(ballot: BallotRow, placements: Placement[]): void {
    insertBallotStmt.run({
      $id: ballot.id,
      $tierlist_id: ballot.tierlist_id,
      $voter_user_id: ballot.voter_user_id,
      $created_at: ballot.created_at,
      $updated_at: ballot.updated_at
    });
    // Replace, never append: a re-vote that moves a book to another tier
    // must not leave its previous placement counted alongside the new one.
    deletePlacementsStmt.run(ballot.id);
    for (const placement of placements) {
      insertPlacementStmt.run({
        $ballot_id: ballot.id,
        $tierlist_id: ballot.tierlist_id,
        $book_key: placement.bookKey,
        $tier_id: placement.tierId
      });
    }
  }
```

`insert` must now pass the new columns:

```ts
    insert(row) {
      insertStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $name: row.name,
        $data: row.data,
        $vote_code: row.vote_code,
        $vote_access: row.vote_access,
        $voting_open: row.voting_open,
        $source_tierlist_id: row.source_tierlist_id,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },
```

And the new methods:

```ts
    getByVoteCode(code) {
      return getByVoteCodeStmt.get(code) as TierlistRow | undefined;
    },

    insertCommunityCopy(row, ballot, placements) {
      // Statements called directly rather than through `this` — the object
      // literal's methods would work, but a transaction that silently
      // depends on how the caller invoked it is a trap worth not setting.
      db.exec("BEGIN");
      try {
        insertStmt.run({
          $id: row.id,
          $owner_user_id: row.owner_user_id,
          $name: row.name,
          $data: row.data,
          $vote_code: row.vote_code,
          $vote_access: row.vote_access,
          $voting_open: row.voting_open,
          $source_tierlist_id: row.source_tierlist_id,
          $created_at: row.created_at,
          $updated_at: row.updated_at
        });
        saveBallotRow(ballot, placements);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    setVoting(id, userId, patch) {
      const existing = getOwnedStmt.get(id, userId) as TierlistRow | undefined;
      if (!existing) return undefined;
      const updatedAt = new Date().toISOString();
      const merged: TierlistRow = { ...existing, ...patch, updated_at: updatedAt };
      setVotingStmt.run({
        $id: id,
        $owner_user_id: userId,
        $vote_access: merged.vote_access,
        $voting_open: merged.voting_open,
        $updated_at: updatedAt
      });
      return merged;
    },

    listPublic(limit, offset) {
      return listPublicStmt.all(limit, offset) as unknown as TierlistRow[];
    },

    getBallotById(tierlistId, ballotId) {
      return getBallotByIdStmt.get(tierlistId, ballotId) as BallotRow | undefined;
    },

    getBallotByVoter(tierlistId, voterUserId) {
      return getBallotByVoterStmt.get(tierlistId, voterUserId) as BallotRow | undefined;
    },

    saveBallot: saveBallotRow,

    getPlacements(ballotId) {
      const rows = getPlacementsStmt.all(ballotId) as unknown as { book_key: string; tier_id: string }[];
      return rows.map((r) => ({ bookKey: r.book_key, tierId: r.tier_id }));
    },

    histogram(tierlistId) {
      const rows = histogramStmt.all(tierlistId) as unknown as { book_key: string; tier_id: string; votes: number }[];
      return rows.map((r) => ({ bookKey: r.book_key, tierId: r.tier_id, votes: Number(r.votes) }));
    },

    ballotCount(tierlistId) {
      return Number((ballotCountStmt.get(tierlistId) as { n: number }).n);
    },

    ballotCountsByTierlist() {
      const rows = ballotCountsStmt.all() as unknown as { tierlist_id: string; n: number }[];
      return new Map(rows.map((r) => [r.tierlist_id, Number(r.n)]));
    }
```

Add `BallotRow` to the type import at the top of the file.

- [ ] **Step 5: Update the in-memory fake**

In `backend/src/modules/tierlists/service.test.ts`, the fake must satisfy the widened port. Add to `createInMemoryRepo`'s returned object (and add `const ballots = new Map<string, BallotRow>();` and `const placements = new Map<string, Placement[]>();` beside the existing `tierlists` map, importing `BallotRow`, `HistogramCell`, `Placement` types):

```ts
    getByVoteCode(code) {
      return [...tierlists.values()].find((t) => t.vote_code === code);
    },
    insertCommunityCopy(row, ballot, ps) {
      tierlists.set(row.id, { ...row });
      ballots.set(ballot.id, { ...ballot });
      placements.set(ballot.id, [...ps]);
    },
    setVoting(id, userId, patch) {
      const existing = tierlists.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged: TierlistRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
      tierlists.set(id, merged);
      return merged;
    },
    listPublic(limit, offset) {
      return [...tierlists.values()]
        .filter((t) => t.vote_code !== null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(offset, offset + limit);
    },
    getBallotById(tierlistId, ballotId) {
      const b = ballots.get(ballotId);
      return b && b.tierlist_id === tierlistId ? b : undefined;
    },
    getBallotByVoter(tierlistId, voterUserId) {
      return [...ballots.values()].find((b) => b.tierlist_id === tierlistId && b.voter_user_id === voterUserId);
    },
    saveBallot(ballot, ps) {
      const clash = [...ballots.values()].find(
        (b) => b.tierlist_id === ballot.tierlist_id && b.voter_user_id !== null && b.voter_user_id === ballot.voter_user_id && b.id !== ballot.id
      );
      if (clash) throw new Error("UNIQUE constraint failed: tierlist_ballots.voter_user_id");
      ballots.set(ballot.id, { ...ballot });
      placements.set(ballot.id, [...ps]);
    },
    getPlacements(ballotId) {
      return [...(placements.get(ballotId) ?? [])];
    },
    histogram(tierlistId) {
      const counts = new Map<string, HistogramCell>();
      for (const ballot of ballots.values()) {
        if (ballot.tierlist_id !== tierlistId) continue;
        for (const p of placements.get(ballot.id) ?? []) {
          const key = JSON.stringify([p.bookKey, p.tierId]);
          const cell = counts.get(key) ?? { bookKey: p.bookKey, tierId: p.tierId, votes: 0 };
          cell.votes += 1;
          counts.set(key, cell);
        }
      }
      return [...counts.values()];
    },
    ballotCount(tierlistId) {
      return [...ballots.values()].filter((b) => b.tierlist_id === tierlistId).length;
    },
    ballotCountsByTierlist() {
      const counts = new Map<string, number>();
      for (const b of ballots.values()) counts.set(b.tierlist_id, (counts.get(b.tierlist_id) ?? 0) + 1);
      return counts;
    }
```

Also give the fake's `insert` and legacy-row test the new columns — in the legacy-row test, the `as TierlistRow` cast already suppresses the missing fields, which is intentional: it models a row written before these columns existed.

- [ ] **Step 6: Run tests and typecheck**

```bash
cd backend && npm test && npm run typecheck
```

Expected: all tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tierlists
git commit -m "feat(tierlists): add voting and ballot methods to the repository port"
```

---

### Task 3: Opening voting and changing its state

**Files:**
- Modify: `backend/src/modules/tierlists/service.ts`
- Modify: `backend/src/modules/tierlists/service.test.ts`

**Interfaces:**
- Consumes: the repository port from Task 2.
- Produces, on `TierlistsService`:
  - `openVoting(userId: string, id: string, access: VoteAccess): Tierlist | undefined`
  - `setVotingState(userId: string, id: string, patch: { access?: VoteAccess; open?: boolean }): Tierlist | undefined`
  - and the exported helper `generateVoteCode(): string`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/tierlists/service.test.ts`:

```ts
test("openVoting duplicates the tier list without touching the original", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous");

  assert.ok(copy);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, "Fantasy (community)");
  assert.equal(copy.sourceTierlistId, original.id);
  assert.equal(copy.votingOpen, true);
  assert.equal(copy.voteAccess, "anonymous");
  assert.ok(copy.voteCode && copy.voteCode.length >= 6);

  const untouched = service.getTierlist("u1", original.id);
  assert.deepEqual((untouched?.data as { tiers: Array<{ bookKeys: string[] }> }).tiers[0]?.bookKeys, ["b1"]);
  assert.equal(untouched?.voteCode, null);
});

test("the community copy carries structure only, with the whole pool", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous");
  const data = copy?.data as { tiers: Array<{ id: string; bookKeys: string[] }>; pool: string[] };

  assert.deepEqual(data.tiers.map((t) => t.bookKeys), [[], [], [], [], []]);
  assert.deepEqual(data.tiers.map((t) => t.id), tiers.map((t) => t.id));
  assert.deepEqual([...data.pool].sort(), ["b1", "b2"]);
});

test("openVoting seeds the owner's ranking as the first ballot", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  const topTierId = tiers[0]!.id;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous")!;
  const results = service.getResults(copy.id);

  assert.equal(results.ballotCount, 1);
  assert.equal(results.histogram.find((c) => c.bookKey === "b1")?.tierId, topTierId);
  assert.equal(results.histogram.find((c) => c.bookKey === "b2"), undefined);
});

test("openVoting returns undefined for an unowned tier list", () => {
  const service = makeService();
  const theirs = service.createTierlist("u2", "Theirs");
  assert.equal(service.openVoting("u1", theirs.id, "anonymous"), undefined);
});

test("opening voting twice yields two independent community copies", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const first = service.openVoting("u1", original.id, "anonymous")!;
  const second = service.openVoting("u1", original.id, "members")!;
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.voteCode, second.voteCode);
  assert.equal(second.voteAccess, "members");
});

test("a community copy refuses data writes but still accepts a rename", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const copy = service.openVoting("u1", original.id, "anonymous")!;
  const frozen = copy.data;

  assert.equal(service.updateTierlist("u1", copy.id, { data: { tiers: [], pool: ["sneaky"] } }), undefined);
  assert.deepEqual(service.getTierlist("u1", copy.id)?.data, frozen);

  assert.equal(service.updateTierlist("u1", copy.id, { name: "Renamed" })?.name, "Renamed");
});

test("the original stays fully editable after its copy is voting", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  service.openVoting("u1", original.id, "anonymous");
  const edited = service.updateTierlist("u1", original.id, { data: { tiers: [], pool: ["b9"] } });
  assert.deepEqual(edited?.data, { tiers: [], pool: ["b9"] });
});

test("setVotingState switches access and closes without losing ballots", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const copy = service.openVoting("u1", original.id, "anonymous")!;

  const tightened = service.setVotingState("u1", copy.id, { access: "members" });
  assert.equal(tightened?.voteAccess, "members");

  const closed = service.setVotingState("u1", copy.id, { open: false });
  assert.equal(closed?.votingOpen, false);
  assert.equal(closed?.voteCode, copy.voteCode);
  assert.equal(service.getResults(copy.id).ballotCount, 1);

  assert.equal(service.setVotingState("u2", copy.id, { open: true }), undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx tsx --test src/modules/tierlists/service.test.ts
```

Expected: FAIL — `service.openVoting is not a function`.

- [ ] **Step 3: Implement**

In `backend/src/modules/tierlists/service.ts`, add to the `TierlistsService` interface:

```ts
  /** Duplicates the tier list into a public community copy whose structure
   *  is frozen, seeding the owner's current ranking as its first ballot.
   *  undefined if not owned. */
  openVoting(userId: string, id: string, access: VoteAccess): Tierlist | undefined;
  setVotingState(userId: string, id: string, patch: { access?: VoteAccess; open?: boolean }): Tierlist | undefined;
```

And above `createTierlistsService`:

```ts
// Unambiguous alphabet: no 0/O/1/I/L, because these codes get read aloud
// and typed by hand. 8 chars over 32 symbols is ~10^12 combinations —
// enough that a poll isn't stumbled upon, though it is an identifier and
// not a secret (community tier lists are publicly listed; vote_access is
// what actually authorizes a ballot).
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateVoteCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** The two places this module looks inside the opaque `data` document —
 *  see the spec's "Why duplication simplifies everything downstream". */
interface TierlistDocument {
  tiers: Array<{ id: string; label: string; color: string; bookKeys: string[] }>;
  pool: string[];
}

function readDocument(tierlist: Tierlist): TierlistDocument {
  const data = (tierlist.data ?? {}) as Partial<TierlistDocument>;
  return { tiers: data.tiers ?? [], pool: data.pool ?? [] };
}
```

Add `randomBytes` to the `node:crypto` import and `VoteAccess` to the types import. Then the implementations inside `createTierlistsService`:

```ts
    openVoting(userId, id, access) {
      const original = this.getTierlist(userId, id);
      if (!original) return undefined;

      const { tiers, pool } = readDocument(original);
      const placements: Placement[] = [];
      const poolKeys = new Set(pool);
      for (const tier of tiers) {
        for (const bookKey of tier.bookKeys) {
          placements.push({ bookKey, tierId: tier.id });
          poolKeys.add(bookKey);
        }
      }

      const now = new Date().toISOString();
      const copy: TierlistRow = {
        id: randomUUID(),
        owner_user_id: userId,
        name: `${original.name} (community)`,
        data: JSON.stringify({ tiers: tiers.map((t) => ({ ...t, bookKeys: [] })), pool: [...poolKeys] }),
        vote_code: generateVoteCode(),
        vote_access: access,
        voting_open: 1,
        source_tierlist_id: original.id,
        created_at: now,
        updated_at: now
      };
      const ballot: BallotRow = {
        id: randomUUID(),
        tierlist_id: copy.id,
        voter_user_id: userId,
        created_at: now,
        updated_at: now
      };

      repo.insertCommunityCopy(copy, ballot, placements);
      return toTierlist(copy);
    },

    setVotingState(userId, id, patch) {
      const row = repo.setVoting(id, userId, {
        ...(patch.access !== undefined ? { vote_access: patch.access } : {}),
        ...(patch.open !== undefined ? { voting_open: patch.open ? 1 : 0 } : {})
      });
      return row ? toTierlist(row) : undefined;
    },
```

Import `BallotRow` and `Placement` types at the top of `service.ts`.

- [ ] **Step 4: Freeze the community copy's document**

This is the whole replacement for the structure-lock invariant the design
rejected: rather than deciding which parts of `data` may change, a
community copy takes no `data` writes at all. Change `updateTierlist` in
`service.ts`:

```ts
    updateTierlist(userId, id, patch) {
      // A community copy's tiers and pool are frozen for the life of the
      // vote — that's what makes ballots comparable, and it's why the
      // owner's ORIGINAL is left untouched and editable when voting opens.
      // Renaming stays allowed: the name is not part of the structure any
      // ballot was cast against.
      if (patch.data !== undefined) {
        const existing = repo.getOwned(id, userId);
        if (!existing) return undefined;
        if (existing.vote_code !== null) return undefined;
      }
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.data !== undefined ? { data: JSON.stringify(patch.data) } : {})
      });
      return row ? toTierlist(row) : undefined;
    },
```

Returning `undefined` maps to the 404 `routes.ts` already sends for
"not found or not owned" — no new error path, and it doesn't tell an
attacker the difference between "isn't yours" and "is frozen".

- [ ] **Step 5: Run tests**

```bash
cd backend && npx tsx --test src/modules/tierlists/service.test.ts
```

Expected: the `openVoting`, `setVotingState` and freeze tests PASS. The three that call `getResults` still fail — Task 5 adds it — and go green there.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/tierlists
git commit -m "feat(tierlists): duplicate into a frozen community copy when voting opens"
```

---

### Task 4: Casting and editing ballots

**Files:**
- Modify: `backend/src/modules/tierlists/service.ts`
- Modify: `backend/src/modules/tierlists/service.test.ts`

**Interfaces:**
- Consumes: Task 2's port, Task 3's `readDocument`.
- Produces, on `TierlistsService`:
  - `type Voter = { kind: "user"; userId: string } | { kind: "anonymous"; ballotId: string | null }`
  - `type BallotOutcome = { ok: true; ballotId: string; placements: Placement[] } | { ok: false; reason: "not-found" | "closed" | "members-only" | "invalid" }`
  - `submitBallot(code: string, placements: Placement[], voter: Voter): BallotOutcome`
  - `getBallot(code: string, voter: Voter): BallotOutcome`

A discriminated result rather than thrown errors, so `routes.ts` maps `reason` straight onto 404/409/401/400 — the same "no exceptions for caller-facing outcomes" stance this module's `undefined` returns already take.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/tierlists/service.test.ts`:

```ts
function openPoll(service: ReturnType<typeof makeService>, access: "anonymous" | "members" = "anonymous") {
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t) => ({ ...t, bookKeys: [] })), pool: ["b1", "b2"] }
  });
  const copy = service.openVoting("u1", original.id, access)!;
  return { copy, code: copy.voteCode!, tierIds: tiers.map((t) => t.id) };
}

test("an anonymous ballot is created, then edited by its returned id", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  const first = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.equal(first.ok, true);
  const ballotId = first.ok ? first.ballotId : "";

  const edit = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[1]! }], { kind: "anonymous", ballotId });
  assert.equal(edit.ok, true);
  assert.equal(edit.ok && edit.ballotId, ballotId);

  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.ballotCount, 2);
  assert.equal(results.histogram.find((c) => c.bookKey === "b1" && c.tierId === tierIds[1]!)?.votes, 1);
});

function openPollIdFor(service: ReturnType<typeof makeService>, code: string): string {
  return service.getVotingBoard(code)!.id;
}

test("a signed-in voter gets one ballot, edited in place across submissions", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  const first = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "user", userId: "u7" });
  const second = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[2]! }], { kind: "user", userId: "u7" });

  assert.equal(first.ok && second.ok && first.ballotId === second.ballotId, true);
  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.ballotCount, 2);
});

test("members-only refuses an anonymous ballot", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service, "members");
  const outcome = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.deepEqual(outcome, { ok: false, reason: "members-only" });
});

test("a closed poll refuses new ballots", () => {
  const service = makeService();
  const { copy, code, tierIds } = openPoll(service);
  service.setVotingState("u1", copy.id, { open: false });
  const outcome = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.deepEqual(outcome, { ok: false, reason: "closed" });
});

test("an unknown code is not found", () => {
  const service = makeService();
  assert.deepEqual(service.submitBallot("nosuch", [], { kind: "anonymous", ballotId: null }), { ok: false, reason: "not-found" });
});

test("placements outside the frozen structure are rejected", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  assert.deepEqual(service.submitBallot(code, [{ bookKey: "nope", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null }), {
    ok: false,
    reason: "invalid"
  });
  assert.deepEqual(service.submitBallot(code, [{ bookKey: "b1", tierId: "nosuchtier" }], { kind: "anonymous", ballotId: null }), {
    ok: false,
    reason: "invalid"
  });
  assert.deepEqual(
    service.submitBallot(
      code,
      [
        { bookKey: "b1", tierId: tierIds[0]! },
        { bookKey: "b1", tierId: tierIds[1]! }
      ],
      { kind: "anonymous", ballotId: null }
    ),
    { ok: false, reason: "invalid" }
  );
});

test("an unranked book simply has no placement", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.histogram.some((c) => c.bookKey === "b2"), false);
});

test("getBallot rehydrates an anonymous voter's placements", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  const submitted = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  const ballotId = submitted.ok ? submitted.ballotId : "";

  const fetched = service.getBallot(code, { kind: "anonymous", ballotId });
  assert.equal(fetched.ok, true);
  assert.deepEqual(fetched.ok && fetched.placements, [{ bookKey: "b1", tierId: tierIds[0]! }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx tsx --test src/modules/tierlists/service.test.ts
```

Expected: FAIL — `service.submitBallot is not a function`.

- [ ] **Step 3: Implement**

Add to `service.ts`, above `createTierlistsService`:

```ts
export type Voter = { kind: "user"; userId: string } | { kind: "anonymous"; ballotId: string | null };

export type BallotOutcome =
  | { ok: true; ballotId: string; placements: Placement[] }
  | { ok: false; reason: "not-found" | "closed" | "members-only" | "invalid" };
```

Add to the `TierlistsService` interface:

```ts
  submitBallot(code: string, placements: Placement[], voter: Voter): BallotOutcome;
  getBallot(code: string, voter: Voter): BallotOutcome;
```

And the implementations:

```ts
    submitBallot(code, placements, voter) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.voting_open !== 1) return { ok: false, reason: "closed" };
      if (row.vote_access === "members" && voter.kind !== "user") return { ok: false, reason: "members-only" };

      const { tiers, pool } = readDocument(toTierlist(row));
      const validPool = new Set(pool);
      const validTiers = new Set(tiers.map((t) => t.id));
      const seen = new Set<string>();
      for (const placement of placements) {
        if (!validPool.has(placement.bookKey)) return { ok: false, reason: "invalid" };
        if (!validTiers.has(placement.tierId)) return { ok: false, reason: "invalid" };
        if (seen.has(placement.bookKey)) return { ok: false, reason: "invalid" };
        seen.add(placement.bookKey);
      }

      const existing =
        voter.kind === "user"
          ? repo.getBallotByVoter(row.id, voter.userId)
          : voter.ballotId
            ? repo.getBallotById(row.id, voter.ballotId)
            : undefined;

      const now = new Date().toISOString();
      const ballot: BallotRow = existing
        ? { ...existing, updated_at: now }
        : {
            id: randomUUID(),
            tierlist_id: row.id,
            voter_user_id: voter.kind === "user" ? voter.userId : null,
            created_at: now,
            updated_at: now
          };

      repo.saveBallot(ballot, placements);
      return { ok: true, ballotId: ballot.id, placements };
    },

    getBallot(code, voter) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };

      const existing =
        voter.kind === "user"
          ? repo.getBallotByVoter(row.id, voter.userId)
          : voter.ballotId
            ? repo.getBallotById(row.id, voter.ballotId)
            : undefined;
      if (!existing) return { ok: false, reason: "not-found" };

      return { ok: true, ballotId: existing.id, placements: repo.getPlacements(existing.id) };
    },
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx tsx --test src/modules/tierlists/service.test.ts
```

Expected: the ballot tests still fail on `getVotingBoard`/`getResults` (Task 5). All assertions that don't call those PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists
git commit -m "feat(tierlists): cast and edit ballots against a frozen community copy"
```

---

### Task 5: Results, the voting board, and the public directory

**Files:**
- Modify: `backend/src/modules/tierlists/service.ts`
- Modify: `backend/src/modules/tierlists/service.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces, on `TierlistsService`:
  - `getResults(tierlistId: string): { histogram: HistogramCell[]; ballotCount: number }`
  - `getVotingBoard(code: string): VotingBoard | undefined` where
    `interface VotingBoard { id: string; ownerUserId: string; name: string; tiers: Array<{id,label,color}>; pool: string[]; access: VoteAccess; votingOpen: boolean; histogram: HistogramCell[]; ballotCount: number }`
  - `listPublicTierlists(limit: number, offset: number): PublicTierlistSummary[]` where
    `interface PublicTierlistSummary { voteCode: string; name: string; poolSize: number; ballotCount: number; votingOpen: boolean }`

`VotingBoard.tiers` deliberately omits `bookKeys` — the community copy has none, and the type makes that impossible to leak by accident. `ownerUserId` is on the board so `routes.ts` can hand it to `resolvePublicLibraryData`; it is NOT sent to the client.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/tierlists/service.test.ts`:

```ts
test("getVotingBoard exposes structure and never the owner's placements", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  const board = service.getVotingBoard(code)!;

  assert.equal(board.name, "Fantasy (community)");
  assert.equal(board.votingOpen, true);
  assert.equal(board.access, "anonymous");
  assert.deepEqual([...board.pool].sort(), ["b1", "b2"]);
  assert.deepEqual(board.tiers.map((t) => t.id), tierIds);
  assert.equal(Object.keys(board.tiers[0]!).includes("bookKeys"), false);
  assert.equal(board.ballotCount, 1);
});

test("getVotingBoard still resolves once voting is closed", () => {
  const service = makeService();
  const { copy, code } = openPoll(service);
  service.setVotingState("u1", copy.id, { open: false });
  const board = service.getVotingBoard(code);
  assert.equal(board?.votingOpen, false);
  assert.equal(board?.ballotCount, 1);
});

test("getVotingBoard is undefined for an unknown code", () => {
  const service = makeService();
  assert.equal(service.getVotingBoard("nosuch"), undefined);
});

test("listPublicTierlists returns community copies only, newest first", () => {
  const service = makeService();
  service.createTierlist("u1", "Private");
  const { code } = openPoll(service);

  const listed = service.listPublicTierlists(10, 0);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.voteCode, code);
  assert.equal(listed[0]?.poolSize, 2);
  assert.equal(listed[0]?.ballotCount, 1);
  assert.equal(listed[0]?.votingOpen, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx tsx --test src/modules/tierlists/service.test.ts
```

Expected: FAIL — `service.getVotingBoard is not a function`.

- [ ] **Step 3: Implement**

Add the exported types above `createTierlistsService`:

```ts
export interface VotingBoard {
  id: string;
  /** For routes.ts's resolvePublicLibraryData call only — never serialized
   *  to a public response. */
  ownerUserId: string;
  name: string;
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  access: VoteAccess;
  votingOpen: boolean;
  histogram: HistogramCell[];
  ballotCount: number;
}

export interface PublicTierlistSummary {
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  votingOpen: boolean;
}
```

Add to the service interface and implement:

```ts
    getResults(tierlistId) {
      return { histogram: repo.histogram(tierlistId), ballotCount: repo.ballotCount(tierlistId) };
    },

    getVotingBoard(code) {
      const row = repo.getByVoteCode(code);
      if (!row) return undefined;
      const { tiers, pool } = readDocument(toTierlist(row));
      return {
        id: row.id,
        ownerUserId: row.owner_user_id,
        name: row.name,
        tiers: tiers.map((t) => ({ id: t.id, label: t.label, color: t.color })),
        pool,
        access: row.vote_access,
        votingOpen: row.voting_open === 1,
        histogram: repo.histogram(row.id),
        ballotCount: repo.ballotCount(row.id)
      };
    },

    listPublicTierlists(limit, offset) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublic(limit, offset).map((row) => {
        const { tiers, pool } = readDocument(toTierlist(row));
        const keys = new Set(pool);
        for (const tier of tiers) for (const key of tier.bookKeys) keys.add(key);
        return {
          voteCode: row.vote_code!,
          name: row.name,
          poolSize: keys.size,
          ballotCount: counts.get(row.id) ?? 0,
          votingOpen: row.voting_open === 1
        };
      });
    },
```

Add the interface declarations:

```ts
  getResults(tierlistId: string): { histogram: HistogramCell[]; ballotCount: number };
  getVotingBoard(code: string): VotingBoard | undefined;
  listPublicTierlists(limit: number, offset: number): PublicTierlistSummary[];
```

- [ ] **Step 4: Run the whole backend suite**

```bash
cd backend && npm test && npm run typecheck
```

Expected: every test in Tasks 3-5 PASSES, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists
git commit -m "feat(tierlists): serve results, the voting board, and the public directory"
```

---

### Task 6: Optional authentication in the auth module

**Files:**
- Modify: `backend/src/modules/auth/guard.ts`
- Modify: `backend/src/modules/auth/index.ts`

**Interfaces:**
- Produces: `getOptionalAuthenticatedUser(request: FastifyRequest): AuthenticatedUser | null`, imported by Task 8 as `import { getOptionalAuthenticatedUser } from "../auth/index.js"`.

This is a change to another module's public surface, so it stands alone: a reviewer may accept or reject it independently of the tierlists work.

- [ ] **Step 1: Add the function**

Append to `backend/src/modules/auth/guard.ts`:

```ts
/** "Who is this, if anyone" — for routes that are genuinely public but
 *  behave differently for a signed-in caller (the tier list voting routes:
 *  a signed-in voter gets one ballot per account, an anonymous one gets a
 *  browser-held ballot id). Deliberately a plain function rather than a
 *  preHandler: it never rejects, so there is no reply to send, nothing to
 *  order against other preHandlers, and no need to widen `request.user`'s
 *  type declaration into a lie on routes where nobody is signed in. */
export function getOptionalAuthenticatedUser(request: FastifyRequest): AuthenticatedUser | null {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) return null;
  return getAuthenticatedUserFromAccessToken(token) ?? null;
}
```

- [ ] **Step 2: Export it**

In `backend/src/modules/auth/index.ts`, change the guard export line to:

```ts
export { authGuard, getOptionalAuthenticatedUser } from "./guard.js";
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/auth
git commit -m "feat(auth): expose optional authentication for genuinely public routes"
```

---

### Task 7: Authenticated voting routes

**Files:**
- Modify: `backend/src/modules/tierlists/routes.ts`

**Interfaces:**
- Consumes: `TierlistsService` (Tasks 3, 5).
- Produces: `POST /tierlists/:id/open-voting`, `PUT /tierlists/:id/voting`, `GET /tierlists/:id/results`.

- [ ] **Step 1: Add the schemas and routes**

In `backend/src/modules/tierlists/routes.ts`, add after `updateTierlistSchema`:

```ts
const voteAccessSchema = z.enum(["anonymous", "members"]);

const openVotingSchema = z.object({ access: voteAccessSchema });

const votingStateSchema = z
  .object({ access: voteAccessSchema.optional(), open: z.boolean().optional() })
  .refine((body) => body.access !== undefined || body.open !== undefined, {
    message: "At least one of access or open must be provided."
  });
```

And inside `tierlistRoutes`, after the existing `delete` route:

```ts
    app.post("/tierlists/:id/open-voting", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = openVotingSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.openVoting(request.user.id, params.data.id, body.data.access);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.code(201).send({ tierlist, voteCode: tierlist.voteCode });
    });

    app.put("/tierlists/:id/voting", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = votingStateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.setVotingState(request.user.id, params.data.id, body.data);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send({ tierlist });
    });

    app.get("/tierlists/:id/results", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      // Ownership-checked BEFORE reading results: getResults takes a plain
      // tier list id, so without this an authenticated user could read any
      // poll's raw histogram by id.
      if (!service.getTierlist(request.user.id, params.data.id)) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send(service.getResults(params.data.id));
    });
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Verify by hand**

Start the backend (`cd backend && npm run dev`), then with a real access token from a logged-in session:

```bash
TOKEN=<paste access token>
ID=<an existing tier list id from GET /tierlists>
curl -s -X POST localhost:3000/tierlists/$ID/open-voting -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"access":"anonymous"}'
```

Expected: `201` with a `voteCode` of 8 lowercase/digit characters, and a `tierlist` whose `sourceTierlistId` is `$ID` and whose tiers all have empty `bookKeys`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/tierlists/routes.ts
git commit -m "feat(tierlists): add authenticated open-voting, voting-state and results routes"
```

---

### Task 8: Public voting routes in a rate-limited scope

**Files:**
- Modify: `backend/src/modules/tierlists/routes.ts`
- Modify: `backend/src/modules/tierlists/plugin.ts`

**Interfaces:**
- Consumes: `TierlistsService` (Tasks 4, 5), `getOptionalAuthenticatedUser` (Task 6), `resolvePublicLibraryData` from `../library/index.js`.
- Produces: `buildPublicTierlistRoutes(service: TierlistsService): FastifyPluginAsync`, registered by `plugin.ts`.

- [ ] **Step 1: Add the public route builder**

At the top of `backend/src/modules/tierlists/routes.ts`, extend the imports:

```ts
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { resolvePublicLibraryData } from "../library/index.js";
import type { Voter } from "./service.js";
```

Add the schemas:

```ts
const codeParamSchema = z.object({ code: z.string().min(1).max(64) });

const placementsSchema = z.object({
  placements: z.array(z.object({ bookKey: z.string().min(1), tierId: z.string().min(1) })).max(500)
});

const listPublicQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
```

Then append the new builder to the file:

```ts
/** The public, unauthenticated surface — the directory, the voting board,
 *  and ballots. Registered in its OWN Fastify encapsulation scope by
 *  plugin.ts specifically so it can carry a tight rate limit that the
 *  authenticated CRUD routes above must NOT inherit, exactly the split
 *  modules/murals/routes.ts makes for GET /murals/shared/:token.
 *
 *  The vote code is an identifier, not a secret: community tier lists are
 *  publicly listed, so nothing here is protected by the code being hard to
 *  guess. vote_access is what authorizes a ballot. */
export function buildPublicTierlistRoutes(service: TierlistsService) {
  return async function publicTierlistRoutes(app: FastifyInstance) {
    app.get("/tierlists/public", async (request, reply) => {
      const query = listPublicQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "Invalid limit/offset." });
      }
      return reply.send({ tierlists: service.listPublicTierlists(query.data.limit, query.data.offset) });
    });

    app.get("/tierlists/voting/:code", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send({ error: "No tier list at that link." });
      }
      const board = service.getVotingBoard(params.data.code);
      if (!board) {
        return reply.code(404).send({ error: "No tier list at that link." });
      }

      // Same privacy boundary the shared-mural route enforces: book keys
      // become redacted public book shapes via library's own resolver,
      // never a raw read of the owner's library.
      const libraryData = resolvePublicLibraryData(board.ownerUserId, {
        bookKeys: board.pool,
        highlightRefs: [],
        needsCurrentlyReading: false,
        statsMetrics: []
      });

      // board.ownerUserId is deliberately NOT spread into the response.
      return reply.send({
        board: {
          name: board.name,
          tiers: board.tiers,
          pool: board.pool,
          access: board.access,
          votingOpen: board.votingOpen,
          ballotCount: board.ballotCount,
          histogram: board.histogram
        },
        books: libraryData.books
      });
    });

    app.post("/tierlists/voting/:code/ballot", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const body = placementsSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "Invalid ballot." });
      }
      const outcome = service.submitBallot(params.data.code, body.data.placements, voterFor(request, null));
      return sendBallotOutcome(reply, service, params.data.code, outcome);
    });

    app.put("/tierlists/voting/:code/ballot/:ballotId", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const ballotId = (request.params as { ballotId?: string }).ballotId ?? null;
      const body = placementsSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "Invalid ballot." });
      }
      const outcome = service.submitBallot(params.data.code, body.data.placements, voterFor(request, ballotId));
      return sendBallotOutcome(reply, service, params.data.code, outcome);
    });

    app.get("/tierlists/voting/:code/ballot/:ballotId", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const ballotId = (request.params as { ballotId?: string }).ballotId ?? null;
      if (!params.success) {
        return reply.code(404).send({ error: "No ballot at that link." });
      }
      const outcome = service.getBallot(params.data.code, voterFor(request, ballotId));
      return sendBallotOutcome(reply, service, params.data.code, outcome);
    });
  };
}

/** A signed-in caller always votes as their account (the DB's partial
 *  unique index is the authority on one-ballot-per-account); everyone else
 *  votes as the ballot id their browser is holding. */
function voterFor(request: FastifyRequest, ballotId: string | null): Voter {
  const user = getOptionalAuthenticatedUser(request);
  return user ? { kind: "user", userId: user.id } : { kind: "anonymous", ballotId };
}

function sendBallotOutcome(reply: FastifyReply, service: TierlistsService, code: string, outcome: BallotOutcome) {
  if (!outcome.ok) {
    if (outcome.reason === "not-found") return reply.code(404).send({ error: "No tier list at that link." });
    if (outcome.reason === "closed") return reply.code(409).send({ error: "Voting is closed for this tier list." });
    if (outcome.reason === "members-only") return reply.code(401).send({ error: "Sign in to vote on this tier list." });
    return reply.code(400).send({ error: "Those placements don't match this tier list." });
  }
  const board = service.getVotingBoard(code);
  return reply.send({
    ballotId: outcome.ballotId,
    placements: outcome.placements,
    results: { histogram: board?.histogram ?? [], ballotCount: board?.ballotCount ?? 0 }
  });
}
```

Extend the fastify type import at the top to `import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";` and add `BallotOutcome` to the `./service.js` type import.

- [ ] **Step 2: Register the scope**

In `backend/src/modules/tierlists/plugin.ts`, replace the top comment and the registration:

```ts
// The tierlists module's Fastify plugin and composition root — mirrors
// modules/murals/plugin.ts's shape: two route builders, each registered in
// its OWN Fastify encapsulation scope so each carries its own rate limit.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openTierlistsDb } from "./adapters/sqlite/connection.js";
import { createSqliteTierlistsRepository } from "./adapters/sqlite/sqliteTierlistsRepository.js";
import { buildPublicTierlistRoutes, buildTierlistRoutes } from "./routes.js";
import type { TierlistsPublicApi } from "./service.js";
import { createTierlistsPublicApi, createTierlistsService } from "./service.js";
```

and, replacing the single `await app.register(buildTierlistRoutes(tierlistsService));`:

```ts
  // No rate limit on the authenticated CRUD surface — ordinary tier-list
  // editing (one PUT per drag/tier-change/rename) shouldn't be throttled,
  // same posture as modules/murals' own authenticated routes (see that
  // module's plugin.ts).
  await app.register(buildTierlistRoutes(tierlistsService));

  // The public surface is the one that needs a tight limit: it is
  // unauthenticated, it WRITES (a ballot), and a community tier list is
  // publicly listed, so its link is meant to be found. Same 30/minute as
  // the public shared-mural route.
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicTierlistRoutes(tierlistsService));
  });
```

- [ ] **Step 3: Typecheck and test**

```bash
cd backend && npm run typecheck && npm test
```

Expected: clean, all tests pass.

- [ ] **Step 4: Verify by hand**

With the backend running and a `CODE` from Task 7:

```bash
CODE=<the voteCode>
curl -s localhost:3000/tierlists/public
curl -s localhost:3000/tierlists/voting/$CODE
TIER=<a tier id from that board>
BOOK=<a book key from that board's pool>
curl -s -X POST localhost:3000/tierlists/voting/$CODE/ballot \
  -H 'content-type: application/json' -d "{\"placements\":[{\"bookKey\":\"$BOOK\",\"tierId\":\"$TIER\"}]}"
```

Expected: the directory lists the poll; the board returns tiers with **no `bookKeys` field** and resolved `books`; the ballot returns a `ballotId` and a histogram with `ballotCount: 2` (the owner's seeded ballot plus yours). Then confirm `curl -s localhost:3000/tierlists/voting/nosuchcode` is a 404.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists
git commit -m "feat(tierlists): add the public voting surface in a rate-limited scope"
```

---

### Task 9: The aggregation function

**Files:**
- Create: `frontend/src/lib/tierlistResults.ts`
- Create: `frontend/scripts/test-tierlist-results.mts`

**Interfaces:**
- Produces:
  - `type AggregationMode = "average" | "plurality" | "median"`
  - `interface HistogramCell { bookKey: string; tierId: string; votes: number }`
  - `interface BookResult { bookKey: string; tierId: string | null; score: number | null; votes: number; spread: number }`
  - `function aggregate(histogram: HistogramCell[], tierIds: string[], pool: string[], mode: AggregationMode): BookResult[]`
  - `const AGGREGATION_MODES: Array<{ mode: AggregationMode; label: string }>`

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/test-tierlist-results.mts`:

```ts
import { aggregate, type HistogramCell } from "../src/lib/tierlistResults";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

const TIERS = ["s", "a", "b"];
const POOL = ["b1", "b2", "b3"];

function cells(...entries: Array<[string, string, number]>): HistogramCell[] {
  return entries.map(([bookKey, tierId, votes]) => ({ bookKey, tierId, votes }));
}

console.log("\n1. Average");
{
  // 2 votes at S (0), 2 at B (2) → mean 1.0 → A
  const results = aggregate(cells(["b1", "s", 2], ["b1", "b", 2]), TIERS, POOL, "average");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  check("mean of 0,0,2,2 lands on the middle tier", b1.tierId === "a");
  check("score is the raw mean", b1.score === 1);
  check("votes counts every ballot that ranked it", b1.votes === 4);
  check("nobody is in the winning tier, so spread is 1", b1.spread === 1);
}

console.log("\n2. Average ties break toward the higher tier");
{
  // 1 vote at S (0), 1 at A (1) → mean 0.5 → tie between S and A → S
  const results = aggregate(cells(["b1", "s", 1], ["b1", "a", 1]), TIERS, POOL, "average");
  check("0.5 rounds to S, not A", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n3. Plurality");
{
  const results = aggregate(cells(["b1", "s", 2], ["b1", "a", 3]), TIERS, POOL, "plurality");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  check("the most-voted tier wins even against a better mean", b1.tierId === "a");
  check("spread is the share outside the winning tier", Math.abs(b1.spread - 2 / 5) < 1e-9);
}

console.log("\n4. Plurality ties break toward the higher tier");
{
  const results = aggregate(cells(["b1", "s", 2], ["b1", "b", 2]), TIERS, POOL, "plurality");
  check("an even split picks S", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n5. Median");
{
  // votes: s,s,s,b,b → 5 votes, 3rd is S
  const results = aggregate(cells(["b1", "s", 3], ["b1", "b", 2]), TIERS, POOL, "median");
  check("odd count takes the middle vote", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n6. Median ties break toward the higher tier");
{
  // votes: s,s,b,b → 4 votes, take the 2nd → S
  const results = aggregate(cells(["b1", "s", 2], ["b1", "b", 2]), TIERS, POOL, "median");
  check("an even split picks the higher tier", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n7. Single vote and no votes");
{
  const results = aggregate(cells(["b1", "a", 1]), TIERS, POOL, "average");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  const b2 = results.find((r) => r.bookKey === "b2")!;
  check("one vote is unanimous", b1.votes === 1 && b1.spread === 0 && b1.tierId === "a");
  check("an unranked book still appears", b2 !== undefined);
  check("an unranked book has no tier", b2.tierId === null && b2.score === null);
  check("an unranked book has zero votes", b2.votes === 0);
  check("every pool book is returned", results.length === 3);
}

console.log("\n8. Unknown tiers are ignored rather than crashing");
{
  const results = aggregate(cells(["b1", "ghost", 5], ["b1", "s", 1]), TIERS, POOL, "average");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  check("a cell naming a deleted tier is dropped", b1.votes === 1 && b1.tierId === "s");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx tsx scripts/test-tierlist-results.mts
```

Expected: FAIL — cannot resolve `../src/lib/tierlistResults`.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/tierlistResults.ts`:

```ts
// Turns a vote histogram into a per-book result. Pure — no network, no
// react-query, no DOM — which is why all three aggregation modes live
// here and are covered by scripts/test-tierlist-results.mts.
//
// The histogram is per-book × per-tier counts, so its size depends on the
// pool and the tier count but NOT on how many people voted: 10 voters and
// 10,000 produce the same input. Every mode is derived from it here rather
// than being fetched separately, so switching modes never hits the network.

export type AggregationMode = "average" | "plurality" | "median";

export interface HistogramCell {
  bookKey: string;
  tierId: string;
  votes: number;
}

export interface BookResult {
  bookKey: string;
  /** null when nobody ranked this book. */
  tierId: string | null;
  /** The mean tier index, kept raw so books can be ordered WITHIN a tier.
   *  null when nobody ranked this book. */
  score: number | null;
  votes: number;
  /** Share of voters who did NOT put the book in its winning tier: 0 is
   *  unanimous. Depends on the mode, since the winning tier does. */
  spread: number;
}

export const AGGREGATION_MODES: Array<{ mode: AggregationMode; label: string }> = [
  { mode: "average", label: "Average" },
  { mode: "plurality", label: "Most-voted" },
  { mode: "median", label: "Median" }
];

export function aggregate(
  histogram: HistogramCell[],
  tierIds: string[],
  pool: string[],
  mode: AggregationMode
): BookResult[] {
  const tierIndex = new Map(tierIds.map((id, index) => [id, index] as const));

  // votesByBook[bookKey][tierIndex] = count. A cell naming a tier that no
  // longer exists is dropped rather than throwing — a frozen community
  // copy shouldn't be able to produce one, but this is public input on a
  // read path.
  const votesByBook = new Map<string, number[]>();
  for (const cell of histogram) {
    const index = tierIndex.get(cell.tierId);
    if (index === undefined) continue;
    const counts = votesByBook.get(cell.bookKey) ?? new Array<number>(tierIds.length).fill(0);
    counts[index] += cell.votes;
    votesByBook.set(cell.bookKey, counts);
  }

  return pool.map((bookKey) => {
    const counts = votesByBook.get(bookKey);
    const total = counts?.reduce((sum, n) => sum + n, 0) ?? 0;
    if (!counts || total === 0) {
      return { bookKey, tierId: null, score: null, votes: 0, spread: 0 };
    }

    const score = counts.reduce((sum, n, index) => sum + n * index, 0) / total;
    const winner = winningIndex(counts, total, score, mode);
    return {
      bookKey,
      tierId: tierIds[winner] ?? null,
      score,
      votes: total,
      spread: 1 - (counts[winner] ?? 0) / total
    };
  });
}

function winningIndex(counts: number[], total: number, score: number, mode: AggregationMode): number {
  if (mode === "average") {
    // Math.round would send an exact .5 DOWN the ladder (1.5 → 2); every
    // tie in this file breaks toward the higher tier, so round the other
    // way at the halfway point.
    return Math.max(0, Math.min(counts.length - 1, Math.ceil(score - 0.5)));
  }

  if (mode === "plurality") {
    let best = 0;
    for (let index = 1; index < counts.length; index++) {
      // Strictly greater, so the earliest (highest) tier keeps a tie.
      if ((counts[index] ?? 0) > (counts[best] ?? 0)) best = index;
    }
    return best;
  }

  // Median: walk the ballots in tier order and stop at the middle one.
  // ceil(total / 2) is the position that breaks an even split toward the
  // higher tier (4 votes → the 2nd, not the 3rd).
  const target = Math.ceil(total / 2);
  let seen = 0;
  for (let index = 0; index < counts.length; index++) {
    seen += counts[index] ?? 0;
    if (seen >= target) return index;
  }
  return counts.length - 1;
}
```

- [ ] **Step 4: Run the test**

```bash
cd frontend && npx tsx scripts/test-tierlist-results.mts
```

Expected: PASS — `14 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/tierlistResults.ts frontend/scripts/test-tierlist-results.mts
git commit -m "feat(frontend): add pure tier list vote aggregation with three modes"
```

---

### Task 10: Extract the ranking board

**Files:**
- Create: `frontend/src/components/tierlist/TierBoard.tsx`
- Modify: `frontend/src/pages/TierListEditorPage.tsx`

**Interfaces:**
- Produces:

```ts
export interface TierBoardProps {
  data: TierlistData;
  books: Array<Record<string, unknown>>;
  onChange: (next: TierlistData) => void;
  /** false on the public voting page: the tier set and the pool are frozen
   *  there, so no add/rename/recolor/reorder/delete affordances render. */
  structureEditable: boolean;
  poolLabel?: string;
}
export function TierBoard(props: TierBoardProps): JSX.Element;
```

**This is a pure refactor: no behaviour changes.** Move `DropZone`, `TierEditorRow`, and the `DndContext` block (currently `TierListEditorPage.tsx:455-562`) plus the move helpers (`locate`, `replaceAt`, `moveBook`, the drag handlers, `activeKey`/`sensors` state) into the new component. The page keeps its own concerns: loading/not-found states, the name rename, edit mode, `setNavHidden`, `useDismissible`, and the add-books sheet.

Gate every structure-editing affordance on `structureEditable` — the tier label input, the up/down buttons, the `OptionsMenu` delete, `TierColorPicker`, and the "+ Add tier" button. When false, render the tier's label as static text.

- [ ] **Step 1: Create the component**

Move the code as described. `TierBoard` owns `useSensors`, the `activeKey` state and `DragOverlay`; it calls `onChange(next)` wherever the page previously called `commit(next)`.

- [ ] **Step 2: Rewire the page**

In `TierListEditorPage.tsx`, replace the moved JSX with:

```tsx
<TierBoard data={data} books={books} onChange={commit} structureEditable={editing} />
```

and delete the now-unused imports (`DndContext`, `DragOverlay`, sensors, `TierEditorRow`, `DropZone`, `createTier`, `bookKey` — keep only what the page still uses).

- [ ] **Step 3: Verify nothing changed**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Then in the browser: open an existing tier list, drag a book from the pool to a tier and confirm it persists across a reload; enter Edit mode and confirm rename, recolor, reorder, delete and "+ Add tier" all still work; on a phone viewport confirm the per-tile `⋮` menus still move books.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/tierlist/TierBoard.tsx frontend/src/pages/TierListEditorPage.tsx
git commit -m "refactor(frontend): extract TierBoard so voting can reuse the ranking board"
```

---

### Task 11: Voting API client and hooks

**Files:**
- Create: `frontend/src/api/tierlistVoting.ts`
- Create: `frontend/src/hooks/useTierlistVoting.ts`
- Create: `frontend/src/hooks/usePublicTierlists.ts`
- Modify: `frontend/src/api/tierlists.ts`

**Interfaces:**
- Produces:

```ts
// api/tierlistVoting.ts
export interface PublicTierlistSummary { voteCode: string; name: string; poolSize: number; ballotCount: number; votingOpen: boolean }
export interface VotingBoard { name: string; tiers: Array<{ id: string; label: string; color: string }>; pool: string[]; access: "anonymous" | "members"; votingOpen: boolean; ballotCount: number; histogram: HistogramCell[] }
export interface BallotResponse { ballotId: string; placements: Array<{ bookKey: string; tierId: string }>; results: { histogram: HistogramCell[]; ballotCount: number } }
export async function fetchPublicTierlists(): Promise<PublicTierlistSummary[]>;
export async function fetchVotingBoard(code: string): Promise<{ board: VotingBoard; books: Array<Record<string, unknown>> }>;
export async function submitBallotApi(code: string, placements: Array<{ bookKey: string; tierId: string }>, ballotId: string | null): Promise<BallotResponse>;
export async function fetchBallotApi(code: string, ballotId: string): Promise<BallotResponse>;
export async function openVotingApi(id: string, access: "anonymous" | "members"): Promise<{ tierlist: Tierlist; voteCode: string }>;
export async function setVotingStateApi(id: string, patch: { access?: "anonymous" | "members"; open?: boolean }): Promise<Tierlist>;
```

Also extend `api/tierlists.ts`'s `Tierlist` interface with `voteCode: string | null; voteAccess: "anonymous" | "members"; votingOpen: boolean; sourceTierlistId: string | null;` to match what the backend now returns.

- [ ] **Step 1: Write the client**

Create `frontend/src/api/tierlistVoting.ts` using `publicFetch` for the four public calls and `apiFetch` for the two authenticated ones (check `api/client.ts` for both — `publicFetch` is what `api/arena.ts` uses for `/arenas/public`). `submitBallotApi` posts to `/tierlists/voting/${code}/ballot` when `ballotId` is null and PUTs to `/tierlists/voting/${code}/ballot/${ballotId}` otherwise.

- [ ] **Step 2: Write the hooks**

`usePublicTierlists.ts`, mirroring `usePublicTournaments.ts` exactly:

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchPublicTierlists } from "../api/tierlistVoting";

export function usePublicTierlists() {
  const query = useQuery({ queryKey: ["tierlists", "public"], queryFn: fetchPublicTierlists });
  return { tierlists: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
```

`useTierlistVoting.ts` exposes the board query plus `submit(placements)`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchVotingBoard, submitBallotApi, type BallotResponse } from "../api/tierlistVoting";

// The anonymous voter's ONLY handle on their ballot. A signed-in voter
// doesn't need it: the backend keys their ballot to their account, and
// ignores whatever id we send. Written solely from a server response —
// never generated here, or two browsers would collide on one id.
function ballotStorageKey(code: string) {
  return `tierlist-ballot:${code}`;
}

export function useTierlistVoting(code: string) {
  const query = useQuery({ queryKey: ["tierlists", "voting", code], queryFn: () => fetchVotingBoard(code) });
  const [ballot, setBallot] = useState<BallotResponse | null>(null);

  async function submit(placements: Array<{ bookKey: string; tierId: string }>): Promise<BallotResponse> {
    const stored = localStorage.getItem(ballotStorageKey(code));
    const response = await submitBallotApi(code, placements, stored);
    localStorage.setItem(ballotStorageKey(code), response.ballotId);
    setBallot(response);
    return response;
  }

  return {
    board: query.data?.board,
    books: query.data?.books ?? [],
    isLoading: query.isLoading,
    error: query.error,
    ballot,
    storedBallotId: localStorage.getItem(ballotStorageKey(code)),
    submit
  };
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd frontend && npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api frontend/src/hooks
git commit -m "feat(frontend): add the tier list voting API client and hooks"
```

---

### Task 12: The public voting page

**Files:**
- Create: `frontend/src/components/tierlist/TierlistResultsView.tsx`
- Create: `frontend/src/pages/VoteTierlistPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `TierBoard` (Task 10), `aggregate`/`AGGREGATION_MODES` (Task 9), `useTierlistVoting` (Task 11).
- Produces: the `/vote/:code` route.

`TierlistResultsView` props: `{ histogram, tierIds, tiers, pool, books, ballotCount }` — it owns the `AggregationMode` state and the segmented control, calls `aggregate` on each render, and renders each tier row with its books ordered by `score` ascending, showing per-book `votes` and `spread`.

- [ ] **Step 1: Build the results view**

Render the segmented control from `AGGREGATION_MODES` (match the existing Arena segmented control's markup), then a read-only board grouped by `tierId`, with books whose `tierId` is null in a trailing "Nobody ranked these" row.

- [ ] **Step 2: Build the page**

`VoteTierlistPage` reads `useParams<{ code: string }>()`, fetches the board, and renders:

- **not found** → a plain "No tier list at that link." message.
- **voting open, not yet submitted** → `TierBoard` with `structureEditable={false}`, all pool books unranked, and a Submit button. Local state holds the working `TierlistData`; **do not** call the save mutation on every drag — this page submits once, explicitly.
- **members-only and not signed in** → the board plus a sign-in link in place of Submit.
- **submitted, or voting closed** → `TierlistResultsView`.

Convert the working board to placements on submit. Put this helper in `lib/tierlistResults.ts` next to `aggregate`, so it is covered by the same pure-logic test file:

```ts
/** A ballot is exactly the books the voter PLACED. Anything still sitting
 *  in the pool is left out entirely — that absence is how "no opinion" is
 *  recorded, and it's why results carry a per-book vote count. */
export function toPlacements(data: { tiers: Array<{ id: string; bookKeys: string[] }> }): Array<{ bookKey: string; tierId: string }> {
  return data.tiers.flatMap((tier) => tier.bookKeys.map((bookKey) => ({ bookKey, tierId: tier.id })));
}
```

Add a section to `scripts/test-tierlist-results.mts` for it:

```ts
console.log("\n9. Ballot conversion");
{
  const placements = toPlacements({ tiers: [{ id: "s", bookKeys: ["b1", "b2"] }, { id: "a", bookKeys: [] }] });
  check("each placed book becomes one placement", placements.length === 2);
  check("placements carry their tier", placements[0]!.tierId === "s");
  check("an empty tier contributes nothing", placements.every((p) => p.tierId === "s"));
}
```

(Import `toPlacements` alongside `aggregate` at the top of that script.)

The starting board for a voter is the frozen structure with an empty ballot — build it from the fetched board:

```ts
const blankBoard: TierlistData = {
  tiers: board.tiers.map((t) => ({ ...t, bookKeys: [] })),
  pool: board.pool
};
```

- [ ] **Step 3: Add the route**

In `App.tsx`, beside the other public routes:

```tsx
<Route path="/vote/:code" element={<VoteTierlistPage />} />
```

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Then in a private browser window (no session), open `/vote/<code>`, rank a few books, submit, and confirm the results appear with all three modes switching instantly and no network request between switches (check the Network tab).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/VoteTierlistPage.tsx frontend/src/components/tierlist/TierlistResultsView.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add the public tier list voting page"
```

---

### Task 13: Owner controls and the public directory

**Files:**
- Modify: `frontend/src/pages/TierListEditorPage.tsx`
- Modify: `frontend/src/pages/ArenaPublicListPage.tsx`

**Interfaces:**
- Consumes: `openVotingApi`/`setVotingStateApi` (Task 11), `usePublicTierlists` (Task 11), `TierlistResultsView` (Task 12).

- [ ] **Step 1: Owner controls in the editor**

When `tierlist.voteCode === null`, add an "Open for voting" action (with the anonymous/members choice) that calls `openVotingApi` and navigates to the created copy.

When `tierlist.voteCode !== null`, this tier list IS a community copy, so:
- hide the structure-editing affordances entirely (pass `structureEditable={false}` to `TierBoard`) and show a line reading "This community tier list is frozen while people vote. Your original stays editable."
- show the `/vote/<code>` link, the ballot count, an access toggle, and a Close/Reopen control, wired to `setVotingStateApi`.
- show `TierlistResultsView` for the owner regardless of whether they have voted.

- [ ] **Step 2: The directory section**

In `ArenaPublicListPage.tsx`, add a second grid below the tournaments one, fed by `usePublicTierlists()`. Match the existing tournament card's classes exactly:

```tsx
{tierlists.length > 0 && (
  <>
    <h2 className="mt-8 mb-3 text-lg font-bold">Tier lists</h2>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tierlists.map((t) => (
        <a
          key={t.voteCode}
          href={`/vote/${t.voteCode}`}
          className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)"
        >
          <h3 className="font-semibold">{t.name}</h3>
          <p className="text-sm text-(--color-text-dim)">
            {t.poolSize} books · {t.ballotCount} {t.ballotCount === 1 ? "vote" : "votes"}
            {!t.votingOpen && " · closed"}
          </p>
        </a>
      ))}
    </div>
  </>
)}
```

Deliberately absent from the card: any preview of the standings, which would leak results past the results-after-you-submit gate, and the owner's username. Update the page's intro line to read "Vote in book bracket tournaments and tier lists — no account needed."

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Browser pass: open a tier list, click "Open for voting", confirm you land on the community copy with a link and a ballot count of 1; open `/arena` **signed out** and confirm the poll is listed with the right counts; vote from a private window and confirm the owner's ballot count rises; switch the poll to members-only and confirm the private window can still read the board but is refused on submit; close voting and confirm the link still resolves and shows final results.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages
git commit -m "feat(frontend): add owner voting controls and list community tier lists"
```

---

### Task 14: Documentation

**Files:**
- Modify: `frontend/README.md`
- Modify: `backend/README.md`

- [ ] **Step 1: Document the feature**

Follow each README's established "Verified with…" entry style, recording: the duplication model, the three aggregation modes, the anonymous-vs-members access modes and what each guarantees about dedupe, the public directory, and the honest limit — **an anonymous ballot is deduped only by a browser-held id, so the counts are a vibe poll, not an election.**

- [ ] **Step 2: Full verification**

```bash
cd backend && npm run typecheck && npm test
cd ../frontend && npm run typecheck && npm run lint && npm run build && npx tsx scripts/test-tierlist-results.mts
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add backend/README.md frontend/README.md
git commit -m "docs: describe tier list voting"
```
