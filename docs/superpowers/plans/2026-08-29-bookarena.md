# BookArena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BookArena — an owner-created, publicly-votable single-elimination book bracket tournament — as a new backend module plus new frontend pages/components, without disturbing any existing module.

**Architecture:** A new, fully independent `backend/src/modules/arena/` module (own SQLite DB, hexagonal `domain/ports+types+errors` → `service.ts` → `adapters/sqlite` → `routes.ts`/`plugin.ts`, exactly mirroring `modules/covers/` and `modules/gallery/`), plus a new in-process interval that auto-settles duels whose timer has expired and advances the bracket. The frontend adds a standalone `api/arena.ts` resource (mirroring `api/gallery.ts`, not the `library.ts` whole-document pattern), a handful of `components/arena/*` pieces reusing `CoverImage`/`BookSearchList`, and both authed (`/dashboard/arena/...`) and — for the first time in this app — unauthenticated public (`/arena`, `/arena/:id`) routes.

**Tech Stack:** Fastify 5 + zod + `node:sqlite` (backend, no new dependencies); React 19 + react-router-dom 7 + `@tanstack/react-query` + Tailwind v4 (frontend, no new dependencies). Backend tests use Node's built-in `node:test` + `node:assert/strict`, run through `tsx` — the first automated tests in this repo (see Task 3's own note on why, and why that's a safe, zero-dependency addition rather than a bigger infra decision).

**Spec:** `docs/superpowers/specs/2026-08-29-bookarena-design.md`

## Global Constraints

- Every module boundary rule in `backend/README.md` applies: only `arena/index.ts` may be imported from outside the module; everything else (`domain/`, `adapters/`, `service.ts`, `routes.ts`, `plugin.ts`) is private.
- No ORM, raw SQL only, one `CREATE TABLE IF NOT EXISTS` schema file run on every boot (no migration framework exists — additive schema changes only, per the rest of this codebase).
- `user_id`/`owner_user_id` fields are trusted opaque strings from a verified JWT (via `authGuard`) — never a real foreign key to auth's `users` table, matching every other module.
- Vote tallies are always computed with `COUNT(*) ... GROUP BY book_key` at read/settle time — no incremented counter columns anywhere (avoids counter-drift races entirely).
- A tournament's seeded books are a denormalized snapshot (`book_key`/title/author/cover) copied in at seed time — there is no shared Book table to reference instead.
- Bracket size must be a power of two, ≥ 2.
- A vote locks in permanently once cast (`UNIQUE(duel_id, voter_token)`, `INSERT OR IGNORE`) — no vote-changing.
- No new dependencies for scheduling or realtime — the round-settlement sweep is a plain `setInterval`, and the frontend uses react-query polling (`refetchInterval`), matching this codebase's existing "no background job queue, no websockets" reality.

---

## Task 1: Arena module scaffolding — domain types, ports, errors, schema, connection

**Files:**
- Create: `backend/src/modules/arena/domain/types.ts`
- Create: `backend/src/modules/arena/domain/ports.ts`
- Create: `backend/src/modules/arena/domain/errors.ts`
- Create: `backend/src/modules/arena/adapters/sqlite/schema.sql`
- Create: `backend/src/modules/arena/adapters/sqlite/connection.ts`
- Modify: `backend/src/config/env.ts`

**Interfaces:**
- Produces: `TournamentRow`, `TournamentSlotRow`, `DuelRow`, `VoteRow` (snake_case row shapes), the `ArenaRepository` port, every `ArenaError` subclass, `openArenaDb(): DatabaseSync`, and `env.ARENA_DB_PATH` — every later task in this module builds on these exact names.

This task has no tests of its own — matches this codebase's existing convention that pure type/port declarations and schema files (see `modules/covers/domain/*`, `modules/gallery/adapters/sqlite/schema.sql`) aren't unit-tested directly, only exercised through `service.ts` (Task 3) and the real database (Task 5's integration script).

- [ ] **Step 1: Add the `ARENA_DB_PATH` env var**

In `backend/src/config/env.ts`, add this line next to the other `*_DB_PATH` entries (right after `COVERS_DB_PATH`/`SOCIALS_DB_PATH`):

```ts
  // modules/arena's own SQLite file — same one-file-per-module isolation
  // as every other module's *_DB_PATH above.
  ARENA_DB_PATH: z.string().min(1).default("./data/arena.sqlite"),
```

- [ ] **Step 2: Write `domain/types.ts`**

```ts
// Domain types for the arena module.
//
// Row shapes mirror the SQLite columns exactly (see adapters/sqlite/
// schema.sql) — same snake_case-row / camelCase-service split every
// other module uses. Both books on a duel are denormalized directly
// onto the DuelRow (title/author/cover for each side) rather than
// joined from TournamentSlotRow — a duel needs to keep showing its two
// books' details on its own, with no join, for as long as it exists.

export interface TournamentRow {
  id: string;
  owner_user_id: string;
  name: string;
  bracket_size: number;
  round_duration_minutes: number;
  status: "seeding" | "active" | "completed";
  current_round: number;
  created_at: string;
  updated_at: string;
}

/** The seeded pool, one row per bracket slot. title/author/cover_url are
 *  a SNAPSHOT copied in at seed time — there's no shared Book table
 *  anywhere in this app to reference instead (modules/library's own
 *  schema treats a library document as an opaque per-account blob). */
export interface TournamentSlotRow {
  tournament_id: string;
  slot_index: number;
  book_key: string;
  title: string;
  author: string;
  cover_url: string | null;
}

export interface DuelRow {
  id: string;
  tournament_id: string;
  round_number: number;
  duel_index: number;
  book_a_key: string;
  book_a_title: string;
  book_a_author: string;
  book_a_cover: string | null;
  book_b_key: string;
  book_b_title: string;
  book_b_author: string;
  book_b_cover: string | null;
  winner_key: string | null;
  status: "active" | "tied_pending_tiebreak" | "settled";
  opens_at: string;
  closes_at: string;
  settled_at: string | null;
}

/** voter_token is a random UUID the frontend generates once per browser
 *  (see frontend/src/lib/arenaVoter.ts) — this is what makes "anyone can
 *  vote, no account needed" possible at all. */
export interface VoteRow {
  id: string;
  duel_id: string;
  voter_token: string;
  book_key: string;
  created_at: string;
}

/** A single seeded book — the shape both PUT /arenas/:id/slots and
 *  POST /arenas/:id/random-fill accept, and what tournament_slots and
 *  each side of a duel get built from. */
export interface SeedBookInput {
  key: string;
  title: string;
  author: string;
  cover: string | null;
}
```

- [ ] **Step 3: Write `domain/ports.ts`**

```ts
// Ports: everything the arena domain (service.ts) needs from the
// outside world. One repository port, same "SQLite in, plain rows out"
// shape as modules/library's own LibraryRepository — unlike gallery/
// covers, arena has no separate blob store, so there's nothing to split
// a second port out for.

import type { DuelRow, TournamentRow, TournamentSlotRow, VoteRow } from "./types.js";

export interface ArenaRepository {
  insertTournament(row: TournamentRow): void;
  getTournament(id: string): TournamentRow | undefined;
  /** Ownership-checked lookup — for anything that mutates a tournament
   *  (seed, start, delete) or an owner-only action on one of its duels. */
  getOwnedTournament(id: string, ownerUserId: string): TournamentRow | undefined;
  listTournamentsByOwner(ownerUserId: string): TournamentRow[];
  listPublicTournaments(limit: number, offset: number): TournamentRow[];
  updateTournamentStatus(id: string, status: TournamentRow["status"], currentRound: number): void;
  /** Cascades to this tournament's slots/duels/votes (ON DELETE CASCADE
   *  in schema.sql) — see connection.ts's PRAGMA foreign_keys = ON. */
  deleteTournament(id: string): void;

  /** Full-replace, same semantics PUT /library already uses (see that
   *  module's own routes.ts comment) — deletes every existing slot for
   *  this tournament first, then inserts the given ones. */
  replaceSlots(tournamentId: string, slots: TournamentSlotRow[]): void;
  getSlots(tournamentId: string): TournamentSlotRow[];

  insertDuels(duels: DuelRow[]): void;
  getDuel(id: string): DuelRow | undefined;
  getDuelsForTournament(tournamentId: string): DuelRow[];
  getDuelsForRound(tournamentId: string, roundNumber: number): DuelRow[];
  updateDuelSettlement(id: string, status: DuelRow["status"], winnerKey: string | null, settledAt: string | null): void;
  /** Backs the scheduler's sweep (service.ts's runScheduledSweep) —
   *  every `status = 'active'` duel whose closes_at has passed. */
  findActiveDuelsPastDeadline(nowIso: string): DuelRow[];

  /** Returns `true` if this call actually inserted the vote, `false` if
   *  this exact (duel_id, voter_token) pair already voted — see the
   *  SQLite adapter's own comment for why (INSERT OR IGNORE, same
   *  race-safe idiom modules/covers already uses for first-write-wins). */
  insertVote(row: VoteRow): boolean;
  /** `{ [book_key]: count }` — only keys with at least one vote appear. */
  countVotesByBook(duelId: string): Record<string, number>;
  hasVoted(duelId: string, voterToken: string): boolean;
}
```

- [ ] **Step 4: Write `domain/errors.ts`**

```ts
// Typed errors the arena domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/gallery/domain/errors.ts.

export class ArenaError extends Error {}

export class TournamentNotFoundError extends ArenaError {
  constructor() {
    super("No tournament with that id, or you don't own it.");
  }
}

export class TournamentAlreadyStartedError extends ArenaError {
  constructor() {
    super("This tournament has already started or completed.");
  }
}

export class InvalidBracketSizeError extends ArenaError {
  constructor() {
    super("Bracket size must be a power of two, at least 2 (e.g. 4, 8, 16, 32).");
  }
}

export class IncompleteSeedError extends ArenaError {
  constructor(expected: number, actual: number) {
    super(`This bracket needs ${expected} seeded books before it can start (currently ${actual}).`);
  }
}

export class NotEnoughBooksError extends ArenaError {
  constructor(expected: number, actual: number) {
    super(`Random-fill needs at least ${expected} candidate books (got ${actual}).`);
  }
}

export class DuplicateSlotError extends ArenaError {
  constructor() {
    super("Each bracket slot can only be assigned once.");
  }
}

export class InvalidSlotIndexError extends ArenaError {
  constructor(bracketSize: number) {
    super(`Slot index must be between 0 and ${bracketSize - 1}.`);
  }
}

export class DuplicateBookError extends ArenaError {
  constructor() {
    super("The same book can't fill two bracket slots.");
  }
}

export class DuelNotFoundError extends ArenaError {
  constructor() {
    super("No such duel.");
  }
}

export class DuelNotVotableError extends ArenaError {
  constructor() {
    super("This duel isn't open for voting right now.");
  }
}

export class InvalidBookError extends ArenaError {
  constructor() {
    super("That book isn't one of this duel's two books.");
  }
}

export class AlreadyVotedError extends ArenaError {
  constructor() {
    super("You've already voted on this duel.");
  }
}

export class DuelNotTiedError extends ArenaError {
  constructor() {
    super("This duel isn't waiting on a tie-break.");
  }
}
```

- [ ] **Step 5: Write `adapters/sqlite/schema.sql`**

```sql
-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql.
-- Unlike gallery/library (per-account) and like covers (global-ish), a
-- tournament is CREATED by one account (owner_user_id, an opaque string
-- from a verified JWT — no real FK to auth's users table, same
-- convention as every other module) but its slots/duels/votes are
-- PUBLIC: anyone with the tournament id can read the bracket and vote,
-- no account required.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tournaments (
  id                       TEXT PRIMARY KEY,
  owner_user_id            TEXT NOT NULL,
  name                     TEXT NOT NULL,
  bracket_size             INTEGER NOT NULL,
  round_duration_minutes   INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'seeding', -- 'seeding' | 'active' | 'completed'
  current_round            INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tournaments_owner ON tournaments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

-- The seeded pool, one row per bracket slot — title/author/cover are a
-- SNAPSHOT copied in at seed time (see domain/types.ts's own comment).
CREATE TABLE IF NOT EXISTS tournament_slots (
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_index     INTEGER NOT NULL,
  book_key       TEXT NOT NULL,
  title          TEXT NOT NULL,
  author         TEXT NOT NULL,
  cover_url      TEXT,
  PRIMARY KEY (tournament_id, slot_index)
);

-- Both books are denormalized directly onto the duel row rather than
-- joined from tournament_slots — reading or voting on one duel should
-- never need a join.
CREATE TABLE IF NOT EXISTS duels (
  id              TEXT PRIMARY KEY,
  tournament_id   TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number    INTEGER NOT NULL,
  duel_index      INTEGER NOT NULL,
  book_a_key      TEXT NOT NULL,
  book_a_title    TEXT NOT NULL,
  book_a_author   TEXT NOT NULL,
  book_a_cover    TEXT,
  book_b_key      TEXT NOT NULL,
  book_b_title    TEXT NOT NULL,
  book_b_author   TEXT NOT NULL,
  book_b_cover    TEXT,
  winner_key      TEXT,
  status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'tied_pending_tiebreak' | 'settled'
  opens_at        TEXT NOT NULL,
  closes_at       TEXT NOT NULL,
  settled_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_duels_tournament_round ON duels(tournament_id, round_number);
-- Backs the scheduler's own sweep — see sqliteArenaRepository.ts's
-- findActiveDuelsPastDeadline.
CREATE INDEX IF NOT EXISTS idx_duels_status_closes_at ON duels(status, closes_at);

-- voter_token is a random UUID the frontend generates once per browser
-- and stores in localStorage — this is what makes "anyone can vote, no
-- account needed" possible at all. The UNIQUE constraint is what makes a
-- vote lock in once cast (INSERT OR IGNORE in the adapter, same
-- race-safe idiom modules/covers already uses for first-write-wins).
CREATE TABLE IF NOT EXISTS votes (
  id            TEXT PRIMARY KEY,
  duel_id       TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  voter_token   TEXT NOT NULL,
  book_key      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (duel_id, voter_token)
);

CREATE INDEX IF NOT EXISTS idx_votes_duel_book ON votes(duel_id, book_key);
```

- [ ] **Step 6: Write `adapters/sqlite/connection.ts`**

```ts
// Opens (and migrates) this module's own SQLite database — mirrors
// modules/covers/adapters/sqlite/connection.ts exactly.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openArenaDb(): DatabaseSync {
  mkdirSync(dirname(env.ARENA_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.ARENA_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: no errors (nothing imports these files yet, so this just confirms the new files themselves are valid TypeScript).

```bash
git add backend/src/modules/arena/domain backend/src/modules/arena/adapters/sqlite/schema.sql backend/src/modules/arena/adapters/sqlite/connection.ts backend/src/config/env.ts
git commit -m "feat(arena): add domain types, ports, errors, and SQLite schema/connection"
```

---

## Task 2: SQLite repository adapter

**Files:**
- Create: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts`

**Interfaces:**
- Consumes: `ArenaRepository` (Task 1), `TournamentRow`/`TournamentSlotRow`/`DuelRow`/`VoteRow` (Task 1), `DatabaseSync` from `node:sqlite`.
- Produces: `createSqliteArenaRepository(db: DatabaseSync): ArenaRepository` — Task 4's `plugin.ts` wires this to the real database; Task 3's tests use a hand-written in-memory fake instead (same "no real database needed to unit-test the domain" seam `backend/README.md` already describes for every other module).

No dedicated test for this file — matches this codebase's existing convention (no module's SQLite adapter has its own test; each is exercised indirectly through the real app). Task 5's manual integration script is what actually exercises this file against a live SQLite database end-to-end.

- [ ] **Step 1: Write the adapter**

```ts
// The SQLite implementation of the ArenaRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// ArenaRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { ArenaRepository } from "../../domain/ports.js";
import type { DuelRow, TournamentRow, TournamentSlotRow, VoteRow } from "../../domain/types.js";

export function createSqliteArenaRepository(db: DatabaseSync): ArenaRepository {
  const insertTournamentStmt = db.prepare(`
    INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status, current_round, created_at, updated_at)
    VALUES ($id, $owner_user_id, $name, $bracket_size, $round_duration_minutes, $status, $current_round, $created_at, $updated_at)
  `);
  const getTournamentStmt = db.prepare(`SELECT * FROM tournaments WHERE id = ?`);
  const getOwnedTournamentStmt = db.prepare(`SELECT * FROM tournaments WHERE id = ? AND owner_user_id = ?`);
  const listByOwnerStmt = db.prepare(`SELECT * FROM tournaments WHERE owner_user_id = ? ORDER BY created_at DESC`);
  const listPublicStmt = db.prepare(`SELECT * FROM tournaments ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const updateStatusStmt = db.prepare(`
    UPDATE tournaments SET status = $status, current_round = $current_round, updated_at = $updated_at WHERE id = $id
  `);
  const deleteTournamentStmt = db.prepare(`DELETE FROM tournaments WHERE id = ?`);

  const deleteSlotsStmt = db.prepare(`DELETE FROM tournament_slots WHERE tournament_id = ?`);
  const insertSlotStmt = db.prepare(`
    INSERT INTO tournament_slots (tournament_id, slot_index, book_key, title, author, cover_url)
    VALUES ($tournament_id, $slot_index, $book_key, $title, $author, $cover_url)
  `);
  const getSlotsStmt = db.prepare(`SELECT * FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index ASC`);

  const insertDuelStmt = db.prepare(`
    INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_a_cover,
      book_b_key, book_b_title, book_b_author, book_b_cover, winner_key, status, opens_at, closes_at, settled_at)
    VALUES ($id, $tournament_id, $round_number, $duel_index, $book_a_key, $book_a_title, $book_a_author, $book_a_cover,
      $book_b_key, $book_b_title, $book_b_author, $book_b_cover, $winner_key, $status, $opens_at, $closes_at, $settled_at)
  `);
  const getDuelStmt = db.prepare(`SELECT * FROM duels WHERE id = ?`);
  const getDuelsForTournamentStmt = db.prepare(`SELECT * FROM duels WHERE tournament_id = ? ORDER BY round_number ASC, duel_index ASC`);
  const getDuelsForRoundStmt = db.prepare(`SELECT * FROM duels WHERE tournament_id = ? AND round_number = ? ORDER BY duel_index ASC`);
  const updateDuelSettlementStmt = db.prepare(`
    UPDATE duels SET status = $status, winner_key = $winner_key, settled_at = $settled_at WHERE id = $id
  `);
  const findDueStmt = db.prepare(`SELECT * FROM duels WHERE status = 'active' AND closes_at <= ?`);

  // OR IGNORE, not a plain INSERT — two votes for the same (duel_id,
  // voter_token) racing (a double-click, a retried request) would
  // otherwise throw on the UNIQUE constraint instead of just quietly
  // staying "already voted" — same reasoning modules/covers' own
  // cover_cache insert already documents.
  const insertVoteStmt = db.prepare(`
    INSERT OR IGNORE INTO votes (id, duel_id, voter_token, book_key, created_at)
    VALUES ($id, $duel_id, $voter_token, $book_key, $created_at)
  `);
  const countVotesStmt = db.prepare(`SELECT book_key, COUNT(*) as n FROM votes WHERE duel_id = ? GROUP BY book_key`);
  const hasVotedStmt = db.prepare(`SELECT 1 FROM votes WHERE duel_id = ? AND voter_token = ?`);

  return {
    insertTournament(row) {
      insertTournamentStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $name: row.name,
        $bracket_size: row.bracket_size,
        $round_duration_minutes: row.round_duration_minutes,
        $status: row.status,
        $current_round: row.current_round,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },
    getTournament(id) {
      return getTournamentStmt.get(id) as TournamentRow | undefined;
    },
    getOwnedTournament(id, ownerUserId) {
      return getOwnedTournamentStmt.get(id, ownerUserId) as TournamentRow | undefined;
    },
    listTournamentsByOwner(ownerUserId) {
      return listByOwnerStmt.all(ownerUserId) as TournamentRow[];
    },
    listPublicTournaments(limit, offset) {
      return listPublicStmt.all(limit, offset) as TournamentRow[];
    },
    updateTournamentStatus(id, status, currentRound) {
      updateStatusStmt.run({ $id: id, $status: status, $current_round: currentRound, $updated_at: new Date().toISOString() });
    },
    deleteTournament(id) {
      deleteTournamentStmt.run(id); // ON DELETE CASCADE removes its slots/duels/votes too
    },

    replaceSlots(tournamentId, slots) {
      deleteSlotsStmt.run(tournamentId);
      for (const slot of slots) {
        insertSlotStmt.run({
          $tournament_id: slot.tournament_id,
          $slot_index: slot.slot_index,
          $book_key: slot.book_key,
          $title: slot.title,
          $author: slot.author,
          $cover_url: slot.cover_url
        });
      }
    },
    getSlots(tournamentId) {
      return getSlotsStmt.all(tournamentId) as TournamentSlotRow[];
    },

    insertDuels(duels) {
      for (const duel of duels) {
        insertDuelStmt.run({
          $id: duel.id,
          $tournament_id: duel.tournament_id,
          $round_number: duel.round_number,
          $duel_index: duel.duel_index,
          $book_a_key: duel.book_a_key,
          $book_a_title: duel.book_a_title,
          $book_a_author: duel.book_a_author,
          $book_a_cover: duel.book_a_cover,
          $book_b_key: duel.book_b_key,
          $book_b_title: duel.book_b_title,
          $book_b_author: duel.book_b_author,
          $book_b_cover: duel.book_b_cover,
          $winner_key: duel.winner_key,
          $status: duel.status,
          $opens_at: duel.opens_at,
          $closes_at: duel.closes_at,
          $settled_at: duel.settled_at
        });
      }
    },
    getDuel(id) {
      return getDuelStmt.get(id) as DuelRow | undefined;
    },
    getDuelsForTournament(tournamentId) {
      return getDuelsForTournamentStmt.all(tournamentId) as DuelRow[];
    },
    getDuelsForRound(tournamentId, roundNumber) {
      return getDuelsForRoundStmt.all(tournamentId, roundNumber) as DuelRow[];
    },
    updateDuelSettlement(id, status, winnerKey, settledAt) {
      updateDuelSettlementStmt.run({ $id: id, $status: status, $winner_key: winnerKey, $settled_at: settledAt });
    },
    findActiveDuelsPastDeadline(nowIso) {
      return findDueStmt.all(nowIso) as DuelRow[];
    },

    insertVote(row) {
      const result = insertVoteStmt.run({
        $id: row.id,
        $duel_id: row.duel_id,
        $voter_token: row.voter_token,
        $book_key: row.book_key,
        $created_at: row.created_at
      });
      return result.changes > 0;
    },
    countVotesByBook(duelId) {
      const rows = countVotesStmt.all(duelId) as Array<{ book_key: string; n: number }>;
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.book_key] = row.n;
      return counts;
    },
    hasVoted(duelId, voterToken) {
      return hasVotedStmt.get(duelId, voterToken) !== undefined;
    }
  };
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: no errors.

```bash
git add backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts
git commit -m "feat(arena): add SQLite repository adapter"
```

---

## Task 3: Service layer — bracket/duel business logic (TDD)

**Files:**
- Create: `backend/src/modules/arena/service.ts`
- Create: `backend/src/modules/arena/service.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `ArenaRepository`, `SeedBookInput`, every `ArenaError` subclass, row types (all Task 1).
- Produces: `ArenaService` interface and `createArenaService(repo: ArenaRepository): ArenaService`, with methods `createTournament`, `listMine`, `listPublic`, `getTournamentView`, `setSlotsManual`, `randomFill`, `start`, `vote`, `settleEarly`, `tiebreak`, `deleteTournament`, `runScheduledSweep` — Task 4's `routes.ts` and `plugin.ts` call these by these exact names.

This is this repo's **first automated test suite**. There's no test framework installed (`backend/README.md`'s own "Not built" section flags this: the hexagonal split "makes [unit testing] easy to add... but there's no test suite exercising it yet"). Rather than pulling in Vitest/Jest, this task uses Node 22's **built-in** `node:test` + `node:assert/strict` — zero new dependencies, run through the `tsx` already in `devDependencies` (same "avoid an extra native/build dependency" instinct that led this backend to `node:sqlite` over `better-sqlite3`). The test file hands `createArenaService` an in-memory object implementing `ArenaRepository` — exactly the seam the README describes, just finally used.

- [ ] **Step 1: Add the `test` script**

In `backend/package.json`, add to `"scripts"`:

```json
    "test": "tsx --test src/modules/arena/service.test.ts",
```

(Scoped to this one file for now, since it's the only test file in the repo; broaden the glob here as more modules grow their own `*.test.ts` files.)

- [ ] **Step 2: Write the failing tests**

```ts
// backend/src/modules/arena/service.test.ts
//
// Exercises service.ts against a hand-written in-memory ArenaRepository
// fake — no real SQLite database needed, same seam backend/README.md
// describes for every other module's service layer.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AlreadyVotedError,
  DuelNotTiedError,
  DuelNotVotableError,
  IncompleteSeedError,
  InvalidBookError,
  InvalidBracketSizeError,
  NotEnoughBooksError,
  TournamentNotFoundError
} from "./domain/errors.js";
import type { ArenaRepository } from "./domain/ports.js";
import type { DuelRow, TournamentRow, TournamentSlotRow, VoteRow } from "./domain/types.js";
import { createArenaService } from "./service.js";

function createInMemoryArenaRepository(): ArenaRepository {
  const tournaments = new Map<string, TournamentRow>();
  const slots = new Map<string, TournamentSlotRow[]>();
  const duels = new Map<string, DuelRow>();
  const votes: VoteRow[] = [];

  return {
    insertTournament(row) {
      tournaments.set(row.id, { ...row });
    },
    getTournament(id) {
      return tournaments.get(id);
    },
    getOwnedTournament(id, ownerUserId) {
      const t = tournaments.get(id);
      return t && t.owner_user_id === ownerUserId ? t : undefined;
    },
    listTournamentsByOwner(ownerUserId) {
      return [...tournaments.values()].filter((t) => t.owner_user_id === ownerUserId);
    },
    listPublicTournaments(limit, offset) {
      return [...tournaments.values()].slice(offset, offset + limit);
    },
    updateTournamentStatus(id, status, currentRound) {
      const t = tournaments.get(id);
      if (t) {
        t.status = status;
        t.current_round = currentRound;
      }
    },
    deleteTournament(id) {
      tournaments.delete(id);
      slots.delete(id);
      for (const [duelId, duel] of duels) if (duel.tournament_id === id) duels.delete(duelId);
    },

    replaceSlots(tournamentId, newSlots) {
      slots.set(tournamentId, newSlots.map((s) => ({ ...s })));
    },
    getSlots(tournamentId) {
      return [...(slots.get(tournamentId) ?? [])];
    },

    insertDuels(newDuels) {
      for (const duel of newDuels) duels.set(duel.id, { ...duel });
    },
    getDuel(id) {
      return duels.get(id);
    },
    getDuelsForTournament(tournamentId) {
      return [...duels.values()].filter((d) => d.tournament_id === tournamentId);
    },
    getDuelsForRound(tournamentId, roundNumber) {
      return [...duels.values()].filter((d) => d.tournament_id === tournamentId && d.round_number === roundNumber);
    },
    updateDuelSettlement(id, status, winnerKey, settledAt) {
      const d = duels.get(id);
      if (d) {
        d.status = status;
        d.winner_key = winnerKey;
        d.settled_at = settledAt;
      }
    },
    findActiveDuelsPastDeadline(nowIso) {
      return [...duels.values()].filter((d) => d.status === "active" && d.closes_at <= nowIso);
    },

    insertVote(row) {
      const alreadyVoted = votes.some((v) => v.duel_id === row.duel_id && v.voter_token === row.voter_token);
      if (alreadyVoted) return false;
      votes.push({ ...row });
      return true;
    },
    countVotesByBook(duelId) {
      const counts: Record<string, number> = {};
      for (const v of votes) if (v.duel_id === duelId) counts[v.book_key] = (counts[v.book_key] ?? 0) + 1;
      return counts;
    },
    hasVoted(duelId, voterToken) {
      return votes.some((v) => v.duel_id === duelId && v.voter_token === voterToken);
    }
  };
}

function makeBook(n: number) {
  return { key: `book-${n}`, title: `Book ${n}`, author: `Author ${n}`, cover: null };
}

test("createTournament rejects a non-power-of-two bracket size", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  assert.throws(
    () => service.createTournament("owner-1", { name: "Test", bracketSize: 6, roundDurationMinutes: 60 }),
    InvalidBracketSizeError
  );
});

test("start rejects an incompletely-seeded tournament", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 4, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  assert.throws(() => service.start(tournament.id, "owner-1"), IncompleteSeedError);
});

test("random-fill rejects a pool smaller than the bracket", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 4, roundDurationMinutes: 60 });
  assert.throws(
    () => service.randomFill(tournament.id, "owner-1", [makeBook(1), makeBook(2)]),
    NotEnoughBooksError
  );
});

test("a full round of voting settles duels and advances to the next round, ending at a champion", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 4, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) },
    { slotIndex: 2, book: makeBook(3) },
    { slotIndex: 3, book: makeBook(4) }
  ]);
  service.start(tournament.id, "owner-1");

  let view = service.getTournamentView(tournament.id);
  assert.equal(view?.duels.length, 2);
  assert.equal(view?.status, "active");

  const [duelA, duelB] = view!.duels;
  // book-1 beats book-2 (2 votes to 1); book-3 beats book-4 (1 vote to 0)
  service.vote(tournament.id, duelA.id, "voter-1", "book-1");
  service.vote(tournament.id, duelA.id, "voter-2", "book-1");
  service.vote(tournament.id, duelA.id, "voter-3", "book-2");
  service.vote(tournament.id, duelB.id, "voter-1", "book-3");

  // Force-settle both duels early (owner action), same path the
  // scheduler's timer-driven sweep uses internally.
  service.settleEarly(tournament.id, "owner-1", duelA.id);
  service.settleEarly(tournament.id, "owner-1", duelB.id);

  view = service.getTournamentView(tournament.id);
  assert.equal(view?.status, "active"); // round 2 (the final) generated
  assert.equal(view?.currentRound, 2);
  const final = view!.duels.find((d) => d.roundNumber === 2)!;
  assert.deepEqual(
    [final.bookA.key, final.bookB.key].sort(),
    ["book-1", "book-3"]
  );

  service.vote(tournament.id, final.id, "voter-1", "book-1");
  service.settleEarly(tournament.id, "owner-1", final.id);

  view = service.getTournamentView(tournament.id);
  assert.equal(view?.status, "completed");
  assert.equal(view?.duels.find((d) => d.roundNumber === 2)?.winnerKey, "book-1");
});

test("a tied duel waits for the owner's tie-break instead of auto-advancing", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;

  service.vote(tournament.id, duel.id, "voter-1", "book-1");
  service.vote(tournament.id, duel.id, "voter-2", "book-2");
  service.settleEarly(tournament.id, "owner-1", duel.id);

  let view = service.getTournamentView(tournament.id);
  assert.equal(view?.duels[0]?.status, "tied_pending_tiebreak");
  assert.equal(view?.status, "active"); // not yet completed — waiting on the owner

  service.tiebreak(tournament.id, "owner-1", duel.id, "book-2");

  view = service.getTournamentView(tournament.id);
  assert.equal(view?.duels[0]?.status, "settled");
  assert.equal(view?.duels[0]?.winnerKey, "book-2");
  assert.equal(view?.status, "completed"); // that was the only (final) duel

  assert.throws(() => service.tiebreak(tournament.id, "owner-1", duel.id, "book-1"), DuelNotTiedError);
});

test("a voter can't vote twice on the same duel, or for a book not in it", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;

  service.vote(tournament.id, duel.id, "voter-1", "book-1");
  assert.throws(() => service.vote(tournament.id, duel.id, "voter-1", "book-2"), AlreadyVotedError);
  assert.throws(() => service.vote(tournament.id, duel.id, "voter-2", "book-999"), InvalidBookError);
});

test("runScheduledSweep only settles duels whose deadline has actually passed", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  service.vote(tournament.id, duel.id, "voter-1", "book-1");

  // "Now" is before the duel's closes_at (round_duration_minutes: 60) —
  // the sweep must leave it alone.
  service.runScheduledSweep(new Date(Date.parse(duel.opensAt) + 1000).toISOString());
  assert.equal(service.getTournamentView(tournament.id)?.duels[0]?.status, "active");

  // "Now" is well past closes_at — the sweep must settle it.
  service.runScheduledSweep(new Date(Date.parse(duel.closesAt) + 1000).toISOString());
  assert.equal(service.getTournamentView(tournament.id)?.duels[0]?.status, "settled");
});

test("only the owner can seed, start, settle, or tie-break a tournament", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  assert.throws(
    () => service.setSlotsManual(tournament.id, "someone-else", [{ slotIndex: 0, book: makeBook(1) }]),
    TournamentNotFoundError
  );
});

test("a settled or already-completed duel can't be voted on", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  service.vote(tournament.id, duel.id, "voter-1", "book-1");
  service.settleEarly(tournament.id, "owner-1", duel.id);

  assert.throws(() => service.vote(tournament.id, duel.id, "voter-2", "book-1"), DuelNotVotableError);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module './service.js'` (it doesn't exist yet).

- [ ] **Step 4: Write `service.ts`**

```ts
// Business logic for the arena module. Depends only on the
// ArenaRepository port, not on SQLite — same reasoning as every other
// module's service.ts.
//
// The core mechanic: a duel is "settled" (differing votes → a winner) or
// "tied_pending_tiebreak" (equal votes → waits for the owner) via one
// shared internal settleDuelInternal, called either by the scheduler's
// timer-driven sweep (runScheduledSweep) or the owner's early-settle
// action (settleEarly) — both converge on identical tie-handling and
// round-advancement logic, just with a different `force` flag for
// whether closes_at must already have passed.

import { randomUUID } from "node:crypto";
import {
  AlreadyVotedError,
  DuelNotFoundError,
  DuelNotTiedError,
  DuelNotVotableError,
  DuplicateBookError,
  DuplicateSlotError,
  IncompleteSeedError,
  InvalidBookError,
  InvalidBracketSizeError,
  InvalidSlotIndexError,
  NotEnoughBooksError,
  TournamentNotFoundError
} from "./domain/errors.js";
import type { ArenaRepository } from "./domain/ports.js";
import type { DuelRow, SeedBookInput, TournamentRow, TournamentSlotRow } from "./domain/types.js";

export interface TournamentSummary {
  id: string;
  name: string;
  bracketSize: number;
  roundDurationMinutes: number;
  status: TournamentRow["status"];
  currentRound: number;
  createdAt: string;
  ownerUserId: string;
}

export interface DuelSideView extends SeedBookInput {
  votes: number;
}

export interface DuelView {
  id: string;
  roundNumber: number;
  duelIndex: number;
  bookA: DuelSideView;
  bookB: DuelSideView;
  winnerKey: string | null;
  status: DuelRow["status"];
  opensAt: string;
  closesAt: string;
  hasVoted: boolean;
}

export interface TournamentView extends TournamentSummary {
  slots: Array<{ slotIndex: number } & SeedBookInput>;
  duels: DuelView[];
}

export interface ArenaService {
  createTournament(ownerUserId: string, input: { name: string; bracketSize: number; roundDurationMinutes: number }): TournamentSummary;
  listMine(ownerUserId: string): TournamentSummary[];
  listPublic(limit: number, offset: number): TournamentSummary[];
  getTournamentView(id: string, voterToken?: string): TournamentView | null;
  setSlotsManual(tournamentId: string, ownerUserId: string, entries: Array<{ slotIndex: number; book: SeedBookInput }>): void;
  randomFill(tournamentId: string, ownerUserId: string, pool: SeedBookInput[]): void;
  start(tournamentId: string, ownerUserId: string): void;
  vote(tournamentId: string, duelId: string, voterToken: string, bookKey: string): void;
  settleEarly(tournamentId: string, ownerUserId: string, duelId: string): void;
  tiebreak(tournamentId: string, ownerUserId: string, duelId: string, winnerBookKey: string): void;
  deleteTournament(tournamentId: string, ownerUserId: string): void;
  runScheduledSweep(nowIso?: string): void;
}

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

function toTournamentSummary(row: TournamentRow): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    bracketSize: row.bracket_size,
    roundDurationMinutes: row.round_duration_minutes,
    status: row.status,
    currentRound: row.current_round,
    createdAt: row.created_at,
    ownerUserId: row.owner_user_id
  };
}

function winnerBookFromDuel(d: DuelRow): SeedBookInput {
  return d.winner_key === d.book_a_key
    ? { key: d.book_a_key, title: d.book_a_title, author: d.book_a_author, cover: d.book_a_cover }
    : { key: d.book_b_key, title: d.book_b_title, author: d.book_b_author, cover: d.book_b_cover };
}

function buildDuelsForRound(
  tournamentId: string,
  roundNumber: number,
  books: SeedBookInput[],
  opensAtIso: string,
  roundDurationMinutes: number
): DuelRow[] {
  const closesAt = new Date(new Date(opensAtIso).getTime() + roundDurationMinutes * 60_000).toISOString();
  const rows: DuelRow[] = [];
  for (let i = 0; i < books.length; i += 2) {
    const a = books[i]!;
    const b = books[i + 1]!;
    rows.push({
      id: randomUUID(),
      tournament_id: tournamentId,
      round_number: roundNumber,
      duel_index: i / 2,
      book_a_key: a.key,
      book_a_title: a.title,
      book_a_author: a.author,
      book_a_cover: a.cover,
      book_b_key: b.key,
      book_b_title: b.title,
      book_b_author: b.author,
      book_b_cover: b.cover,
      winner_key: null,
      status: "active",
      opens_at: opensAtIso,
      closes_at: closesAt,
      settled_at: null
    });
  }
  return rows;
}

export function createArenaService(repo: ArenaRepository): ArenaService {
  /** Checks whether every duel in a round has settled, and if so either
   *  generates the next round (from the winners, same pairing logic as
   *  the first round) or — if that round had exactly one duel — marks
   *  the tournament completed. Called after any duel settles, whether
   *  via the scheduler's sweep, an early settle, or a tie-break. */
  function maybeAdvanceRound(tournament: TournamentRow, roundNumber: number, nowIso: string): void {
    const roundDuels = repo.getDuelsForRound(tournament.id, roundNumber);
    if (roundDuels.some((d) => d.status !== "settled")) return;

    const winners = roundDuels.sort((a, b) => a.duel_index - b.duel_index).map(winnerBookFromDuel);

    if (winners.length === 1) {
      repo.updateTournamentStatus(tournament.id, "completed", roundNumber);
      return;
    }

    const nextRoundNumber = roundNumber + 1;
    const nextDuels = buildDuelsForRound(tournament.id, nextRoundNumber, winners, nowIso, tournament.round_duration_minutes);
    repo.insertDuels(nextDuels);
    repo.updateTournamentStatus(tournament.id, "active", nextRoundNumber);
  }

  /** Shared by runScheduledSweep (force: false — only settles if
   *  closes_at has passed) and settleEarly (force: true — the owner's
   *  "settle now" action). Idempotent: a duel that's no longer `active`
   *  (already settled, or already tied-pending) is left alone, so a
   *  scheduler tick racing an owner's early settle can't double-process
   *  the same duel. */
  function settleDuelInternal(tournament: TournamentRow, duel: DuelRow, force: boolean, nowIso: string): void {
    if (duel.status !== "active") return;
    if (!force && duel.closes_at > nowIso) return;

    const counts = repo.countVotesByBook(duel.id);
    const votesA = counts[duel.book_a_key] ?? 0;
    const votesB = counts[duel.book_b_key] ?? 0;

    if (votesA === votesB) {
      repo.updateDuelSettlement(duel.id, "tied_pending_tiebreak", null, null);
      return;
    }

    const winnerKey = votesA > votesB ? duel.book_a_key : duel.book_b_key;
    repo.updateDuelSettlement(duel.id, "settled", winnerKey, nowIso);
    maybeAdvanceRound(tournament, duel.round_number, nowIso);
  }

  function toDuelView(d: DuelRow, voterToken: string | undefined): DuelView {
    const counts = repo.countVotesByBook(d.id);
    return {
      id: d.id,
      roundNumber: d.round_number,
      duelIndex: d.duel_index,
      bookA: { key: d.book_a_key, title: d.book_a_title, author: d.book_a_author, cover: d.book_a_cover, votes: counts[d.book_a_key] ?? 0 },
      bookB: { key: d.book_b_key, title: d.book_b_title, author: d.book_b_author, cover: d.book_b_cover, votes: counts[d.book_b_key] ?? 0 },
      winnerKey: d.winner_key,
      status: d.status,
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      hasVoted: voterToken ? repo.hasVoted(d.id, voterToken) : false
    };
  }

  return {
    createTournament(ownerUserId, input) {
      if (!isPowerOfTwo(input.bracketSize)) throw new InvalidBracketSizeError();
      const now = new Date().toISOString();
      const row: TournamentRow = {
        id: randomUUID(),
        owner_user_id: ownerUserId,
        name: input.name,
        bracket_size: input.bracketSize,
        round_duration_minutes: input.roundDurationMinutes,
        status: "seeding",
        current_round: 0,
        created_at: now,
        updated_at: now
      };
      repo.insertTournament(row);
      return toTournamentSummary(row);
    },

    listMine(ownerUserId) {
      return repo.listTournamentsByOwner(ownerUserId).map(toTournamentSummary);
    },

    listPublic(limit, offset) {
      return repo.listPublicTournaments(limit, offset).map(toTournamentSummary);
    },

    getTournamentView(id, voterToken) {
      const tournament = repo.getTournament(id);
      if (!tournament) return null;
      const slots = repo.getSlots(id).sort((a, b) => a.slot_index - b.slot_index);
      const duels = repo
        .getDuelsForTournament(id)
        .sort((a, b) => a.round_number - b.round_number || a.duel_index - b.duel_index);
      return {
        ...toTournamentSummary(tournament),
        slots: slots.map((s) => ({ slotIndex: s.slot_index, key: s.book_key, title: s.title, author: s.author, cover: s.cover_url })),
        duels: duels.map((d) => toDuelView(d, voterToken))
      };
    },

    setSlotsManual(tournamentId, ownerUserId, entries) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();

      const indices = new Set(entries.map((e) => e.slotIndex));
      if (indices.size !== entries.length) throw new DuplicateSlotError();
      if (entries.some((e) => e.slotIndex < 0 || e.slotIndex >= tournament.bracket_size)) {
        throw new InvalidSlotIndexError(tournament.bracket_size);
      }
      const keys = new Set(entries.map((e) => e.book.key));
      if (keys.size !== entries.length) throw new DuplicateBookError();

      // Full-replace, same semantics as PUT /library — see this module's
      // own domain/ports.ts comment on replaceSlots.
      const rows: TournamentSlotRow[] = entries.map((e) => ({
        tournament_id: tournamentId,
        slot_index: e.slotIndex,
        book_key: e.book.key,
        title: e.book.title,
        author: e.book.author,
        cover_url: e.book.cover
      }));
      repo.replaceSlots(tournamentId, rows);
    },

    randomFill(tournamentId, ownerUserId, pool) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      if (pool.length < tournament.bracket_size) throw new NotEnoughBooksError(tournament.bracket_size, pool.length);

      // Fisher-Yates.
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const chosen = shuffled.slice(0, tournament.bracket_size);
      const rows: TournamentSlotRow[] = chosen.map((book, i) => ({
        tournament_id: tournamentId,
        slot_index: i,
        book_key: book.key,
        title: book.title,
        author: book.author,
        cover_url: book.cover
      }));
      repo.replaceSlots(tournamentId, rows);
    },

    start(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const slots = repo.getSlots(tournamentId).sort((a, b) => a.slot_index - b.slot_index);
      if (slots.length !== tournament.bracket_size) throw new IncompleteSeedError(tournament.bracket_size, slots.length);

      const books: SeedBookInput[] = slots.map((s) => ({ key: s.book_key, title: s.title, author: s.author, cover: s.cover_url }));
      const nowIso = new Date().toISOString();
      const duels = buildDuelsForRound(tournamentId, 1, books, nowIso, tournament.round_duration_minutes);
      repo.insertDuels(duels);
      repo.updateTournamentStatus(tournamentId, "active", 1);
    },

    vote(tournamentId, duelId, voterToken, bookKey) {
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      if (duel.status !== "active" || new Date() >= new Date(duel.closes_at)) throw new DuelNotVotableError();
      if (bookKey !== duel.book_a_key && bookKey !== duel.book_b_key) throw new InvalidBookError();

      const inserted = repo.insertVote({
        id: randomUUID(),
        duel_id: duelId,
        voter_token: voterToken,
        book_key: bookKey,
        created_at: new Date().toISOString()
      });
      if (!inserted) throw new AlreadyVotedError();
    },

    settleEarly(tournamentId, ownerUserId, duelId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      settleDuelInternal(tournament, duel, true, new Date().toISOString());
    },

    tiebreak(tournamentId, ownerUserId, duelId, winnerBookKey) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      if (duel.status !== "tied_pending_tiebreak") throw new DuelNotTiedError();
      if (winnerBookKey !== duel.book_a_key && winnerBookKey !== duel.book_b_key) throw new InvalidBookError();

      const nowIso = new Date().toISOString();
      repo.updateDuelSettlement(duelId, "settled", winnerBookKey, nowIso);
      maybeAdvanceRound(tournament, duel.round_number, nowIso);
    },

    deleteTournament(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      repo.deleteTournament(tournamentId);
    },

    runScheduledSweep(nowIso = new Date().toISOString()) {
      for (const duel of repo.findActiveDuelsPastDeadline(nowIso)) {
        const tournament = repo.getTournament(duel.tournament_id);
        if (!tournament) continue; // shouldn't happen (ON DELETE CASCADE), but never let one bad row crash the sweep
        settleDuelInternal(tournament, duel, false, nowIso);
      }
    }
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: no errors.

```bash
git add backend/src/modules/arena/service.ts backend/src/modules/arena/service.test.ts backend/package.json
git commit -m "feat(arena): add service layer with bracket/duel/round logic and tests"
```

---

## Task 4: Routes, scheduler, plugin composition, and app registration

**Files:**
- Create: `backend/src/modules/arena/routes.ts`
- Create: `backend/src/modules/arena/plugin.ts`
- Create: `backend/src/modules/arena/index.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `ArenaService` (Task 3), `createSqliteArenaRepository`/`openArenaDb` (Tasks 1–2), `authGuard` from `modules/auth/index.js`.
- Produces: `registerArenaModule` (the module's public surface, imported only from `app.ts`), and every HTTP route in the spec's route table. Task 5's integration script and every frontend task depend on these exact paths/shapes.

No new unit tests here — matches this codebase's existing convention that `routes.ts`/`plugin.ts` (thin HTTP/composition glue) aren't unit-tested directly in any module; Task 5's manual script is what exercises this over real HTTP.

- [ ] **Step 1: Write `routes.ts`**

```ts
// HTTP layer for the arena module: request validation and mapping
// service results to responses. No business logic here — see service.ts.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { AlreadyVotedError, ArenaError, DuelNotFoundError, TournamentNotFoundError } from "./domain/errors.js";
import type { ArenaService } from "./service.js";

function statusForArenaError(err: ArenaError): number {
  if (err instanceof TournamentNotFoundError || err instanceof DuelNotFoundError) return 404;
  if (err instanceof AlreadyVotedError) return 409;
  return 400;
}

const idParamSchema = z.object({ id: z.string().uuid() });
const duelParamSchema = z.object({ id: z.string().uuid(), duelId: z.string().uuid() });

const seedBookSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  cover: z.string().url().nullable().optional().transform((v) => v ?? null)
});

const createTournamentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  bracketSize: z.number().int().min(2).max(128),
  roundDurationMinutes: z.number().int().min(1).max(60 * 24 * 30)
});

const setSlotsSchema = z.object({
  slots: z.array(z.object({ slotIndex: z.number().int().min(0), book: seedBookSchema }))
});

const randomFillSchema = z.object({ pool: z.array(seedBookSchema).min(1) });

const voteSchema = z.object({ voterToken: z.string().uuid(), bookKey: z.string().min(1) });

const tiebreakSchema = z.object({ winnerBookKey: z.string().min(1) });

const listPublicQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

const getTournamentQuerySchema = z.object({ voterToken: z.string().uuid().optional() });

export function buildArenaRoutes(service: ArenaService) {
  return async function arenaRoutes(app: FastifyInstance) {
    app.post("/arenas", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createTournamentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {name, bracketSize, roundDurationMinutes}." });
      try {
        const tournament = service.createTournament(request.user.id, parsed.data);
        return reply.code(201).send({ tournament });
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.get("/arenas/mine", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ tournaments: service.listMine(request.user.id) });
    });

    app.get("/arenas/public", async (request, reply) => {
      const parsed = listPublicQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid limit/offset." });
      return reply.send({ tournaments: service.listPublic(parsed.data.limit, parsed.data.offset) });
    });

    // Deliberately NOT behind authGuard — the whole point of BookArena is
    // that anyone with the link can view and vote. ownerUserId is a
    // plain opaque id in the response (not sensitive — same trust level
    // already used elsewhere), so the frontend can compute "am I the
    // owner" itself against its own session, with no new auth primitive
    // needed here.
    app.get("/arenas/:id", async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const query = getTournamentQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "Invalid voterToken." });
      const tournament = service.getTournamentView(params.data.id, query.data.voterToken);
      if (!tournament) return reply.code(404).send({ error: "No such tournament." });
      return reply.send({ tournament });
    });

    app.put("/arenas/:id/slots", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const body = setSlotsSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {slots: [{slotIndex, book}, ...]}." });
      try {
        service.setSlotsManual(params.data.id, request.user.id, body.data.slots);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/random-fill", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const body = randomFillSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {pool: [book, ...]}." });
      try {
        service.randomFill(params.data.id, request.user.id, body.data.pool);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/start", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      try {
        service.start(params.data.id, request.user.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.delete("/arenas/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      try {
        service.deleteTournament(params.data.id, request.user.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/duels/:duelId/settle", { preHandler: authGuard }, async (request, reply) => {
      const params = duelParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid id." });
      try {
        service.settleEarly(params.data.id, request.user.id, params.data.duelId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/duels/:duelId/tiebreak", { preHandler: authGuard }, async (request, reply) => {
      const params = duelParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid id." });
      const body = tiebreakSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {winnerBookKey}." });
      try {
        service.tiebreak(params.data.id, request.user.id, params.data.duelId, body.data.winnerBookKey);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });
  };
}

// Registered in its OWN Fastify encapsulation scope (plugin.ts) so it can
// carry its own rate limit, independent of every other /arenas route —
// same reasoning as modules/covers/plugin.ts's two-scopes split: this is
// the app's first anonymous (unauthenticated) WRITE endpoint, worth
// protecting on its own rather than sharing a limit with authed routes.
export function buildVoteRoute(service: ArenaService) {
  return async function voteRoute(app: FastifyInstance) {
    app.post("/arenas/:id/duels/:duelId/vote", async (request, reply) => {
      const params = duelParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid id." });
      const body = voteSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {voterToken, bookKey}." });
      try {
        service.vote(params.data.id, params.data.duelId, body.data.voterToken, body.data.bookKey);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });
  };
}
```

- [ ] **Step 2: Write `plugin.ts`**

```ts
// Composition root — mirrors modules/covers/plugin.ts's shape, plus this
// module's own addition: a background interval that settles duels whose
// timer has expired and advances the bracket. The FIRST background timer
// in this codebase (no job queue/cron exists elsewhere) — a plain
// setInterval is the simplest thing that could work at this app's scale,
// same "no new dependency for something this small" instinct as
// node:sqlite over better-sqlite3.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openArenaDb } from "./adapters/sqlite/connection.js";
import { createSqliteArenaRepository } from "./adapters/sqlite/sqliteArenaRepository.js";
import { buildArenaRoutes, buildVoteRoute } from "./routes.js";
import { createArenaService } from "./service.js";

const SWEEP_INTERVAL_MS = 30_000;

export async function arenaPlugin(app: FastifyInstance) {
  const db = openArenaDb();
  const repo = createSqliteArenaRepository(db);
  const service = createArenaService(repo);

  const sweep = setInterval(() => {
    try {
      service.runScheduledSweep();
    } catch (err) {
      app.log.error(err, "arena round-settlement sweep failed");
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref(); // don't keep the process alive just for this timer
  app.addHook("onClose", (_instance, done) => {
    clearInterval(sweep);
    done();
  });

  // Own scope, own (tighter) rate limit — see buildVoteRoute's own
  // comment for why this route needs to be separate from the rest.
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 20, timeWindow: "1 minute" });
    await scoped.register(buildVoteRoute(service));
  });

  await app.register(buildArenaRoutes(service));
}
```

- [ ] **Step 3: Write `index.ts`**

```ts
// Public interface of the arena module. Everything else in
// modules/arena/ is private implementation — same convention as
// modules/covers/index.ts and modules/library/index.ts.

export { arenaPlugin as registerArenaModule } from "./plugin.js";
```

- [ ] **Step 4: Register the module in `app.ts`**

In `backend/src/app.ts`, add the import alongside the others:

```ts
import { registerArenaModule } from "./modules/arena/index.js";
```

And register it alongside the others (order doesn't matter — each module is independently encapsulated):

```ts
  app.register(registerArenaModule);
```

- [ ] **Step 5: Typecheck and commit**

Run: `cd backend && npm run typecheck && npm test`
Expected: no type errors; all tests still pass (this task added no new tests, so this just confirms nothing broke).

```bash
git add backend/src/modules/arena/routes.ts backend/src/modules/arena/plugin.ts backend/src/modules/arena/index.ts backend/src/app.ts
git commit -m "feat(arena): add routes, round-settlement scheduler, and register the module"
```

---

## Task 5: Manual integration script

**Files:**
- Create: `backend/scripts/test-arena-flow.mjs`

**Interfaces:**
- Consumes: every route from Task 4, running against a live `npm run dev` server.

- [ ] **Step 1: Write the script**

Mirrors `backend/scripts/test-auth-flow.mjs`'s exact style (a plain Node script with a `check()` helper printing ✓/✗ per assertion — not a test framework, a readable repeatable way to poke every endpoint). Signs up a throwaway account first (reusing the same pattern that script already establishes), then walks: create → manual-seed → start → vote from two different tokens → early-settle → verify winner → confirm a tie goes to `tied_pending_tiebreak` → resolve it → confirm tournament completion → confirm `GET /arenas/public` lists it → confirm `DELETE` removes it.

```js
// Walks through the full BookArena flow against a running dev server and
// prints each step's result. Not a test framework — see
// scripts/test-auth-flow.mjs's own header comment for why this shape.
// Requires the server already running (npm run dev) in another terminal.
//
// Usage:
//   node scripts/test-arena-flow.mjs
//   node scripts/test-arena-flow.mjs http://localhost:3000   (custom base URL)

const base = process.argv[2] || "http://localhost:3000";
const unique = Date.now();
const email = `arena-test-${unique}@example.com`;
const username = `arenatest${unique}`;
const password = "a perfectly fine password";

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function book(n) {
  return { key: `book-${unique}-${n}`, title: `Test Book ${n}`, author: `Author ${n}`, cover: null };
}

async function main() {
  console.log(`Testing against ${base}\nUsing throwaway account: ${email} / @${username}\n`);

  console.log("1. Sign up a throwaway account");
  const signupRes = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, password })
  });
  const { accessToken } = await signupRes.json();
  check("signup returns an access token", typeof accessToken === "string");
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };

  console.log("\n2. Create a 4-book tournament");
  const createRes = await fetch(`${base}/arenas`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "Test Bracket", bracketSize: 4, roundDurationMinutes: 60 })
  });
  const { tournament } = await createRes.json();
  check("create returns 201", createRes.status === 201, `got ${createRes.status}`);
  check("status starts as seeding", tournament?.status === "seeding");
  const tournamentId = tournament.id;

  console.log("\n3. Reject bracket sizes that aren't a power of two");
  const badSizeRes = await fetch(`${base}/arenas`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "Bad", bracketSize: 6, roundDurationMinutes: 60 })
  });
  check("non-power-of-two bracket size returns 400", badSizeRes.status === 400, `got ${badSizeRes.status}`);

  console.log("\n4. Manually seed all 4 slots");
  const seedRes = await fetch(`${base}/arenas/${tournamentId}/slots`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      slots: [0, 1, 2, 3].map((i) => ({ slotIndex: i, book: book(i) }))
    })
  });
  check("seeding returns 204", seedRes.status === 204, `got ${seedRes.status}`);

  console.log("\n5. Start the tournament");
  const startRes = await fetch(`${base}/arenas/${tournamentId}/start`, { method: "POST", headers: authHeaders });
  check("start returns 204", startRes.status === 204, `got ${startRes.status}`);

  console.log("\n6. Read the bracket publicly, no auth header");
  const viewRes = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: view } = await viewRes.json();
  check("public GET returns 200", viewRes.status === 200, `got ${viewRes.status}`);
  check("round 1 has 2 duels", view.duels.length === 2);
  const [duelA, duelB] = view.duels;

  console.log("\n7. Vote from two different anonymous tokens, then early-settle");
  await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: crypto.randomUUID(), bookKey: duelA.bookA.key })
  });
  const secondVoteToken = crypto.randomUUID();
  const firstVoteRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: secondVoteToken, bookKey: duelA.bookA.key })
  });
  check("second distinct voter's vote is accepted", firstVoteRes.status === 204, `got ${firstVoteRes.status}`);
  const dupeVoteRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: secondVoteToken, bookKey: duelA.bookB.key })
  });
  check("same voter voting again on the same duel returns 409", dupeVoteRes.status === 409, `got ${dupeVoteRes.status}`);

  const settleARes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/settle`, { method: "POST", headers: authHeaders });
  check("owner early-settle returns 204", settleARes.status === 204, `got ${settleARes.status}`);

  console.log("\n8. Settle the second duel with NO votes at all (a tie: 0-0) and resolve it");
  const settleBRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelB.id}/settle`, { method: "POST", headers: authHeaders });
  check("settling an unvoted duel returns 204", settleBRes.status === 204, `got ${settleBRes.status}`);
  const afterTieRes = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: afterTie } = await afterTieRes.json();
  const settledDuelB = afterTie.duels.find((d) => d.id === duelB.id);
  check("a 0-0 duel is tied_pending_tiebreak, not auto-decided", settledDuelB.status === "tied_pending_tiebreak");

  const tiebreakRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelB.id}/tiebreak`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ winnerBookKey: duelB.bookA.key })
  });
  check("owner tie-break returns 204", tiebreakRes.status === 204, `got ${tiebreakRes.status}`);

  console.log("\n9. Confirm round 2 (the final) was generated");
  const round2Res = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: round2 } = await round2Res.json();
  const final = round2.duels.find((d) => d.roundNumber === 2);
  check("the final duel exists", Boolean(final));
  check("tournament is still active, awaiting the final", round2.status === "active");

  console.log("\n10. Settle the final and confirm the tournament completes");
  await fetch(`${base}/arenas/${tournamentId}/duels/${final.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: crypto.randomUUID(), bookKey: final.bookA.key })
  });
  await fetch(`${base}/arenas/${tournamentId}/duels/${final.id}/settle`, { method: "POST", headers: authHeaders });
  const finalRes = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: completed } = await finalRes.json();
  check("tournament status is completed", completed.status === "completed", `got ${completed.status}`);

  console.log("\n11. It shows up in the public directory, and can be deleted");
  const publicRes = await fetch(`${base}/arenas/public`);
  const { tournaments: publicList } = await publicRes.json();
  check("the tournament appears in /arenas/public", publicList.some((t) => t.id === tournamentId));

  const deleteRes = await fetch(`${base}/arenas/${tournamentId}`, { method: "DELETE", headers: authHeaders });
  check("delete returns 204", deleteRes.status === 204, `got ${deleteRes.status}`);
  const afterDeleteRes = await fetch(`${base}/arenas/${tournamentId}`);
  check("it 404s after deletion", afterDeleteRes.status === 404, `got ${afterDeleteRes.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against a live dev server**

In one terminal: `cd backend && npm run dev`
In another: `cd backend && node scripts/test-arena-flow.mjs`
Expected: every check prints ✓; final line reads `N passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/test-arena-flow.mjs
git commit -m "feat(arena): add manual end-to-end integration script"
```

---

## Task 6: Frontend API layer and voter identity

**Files:**
- Create: `frontend/src/api/arena.ts`
- Create: `frontend/src/lib/arenaVoter.ts`

**Interfaces:**
- Consumes: `apiFetch`/`publicFetch` (`frontend/src/api/client.ts`).
- Produces: `SeedBook`, `TournamentSummary`, `Duel`, `TournamentView` types and every `create/fetch/set/random-fill/start/vote/settle/tiebreak/delete Tournament*` function — every later frontend task imports from here; `getVoterToken()` — Tasks 7–9 use this.

- [ ] **Step 1: Write `lib/arenaVoter.ts`**

```ts
// Anonymous voter identity for BookArena — a random UUID generated once
// per browser and persisted in localStorage, sent with every vote so a
// duel can enforce "one vote per voter" (backend's votes table UNIQUE
// constraint) without requiring an account. Not a security boundary —
// clearing storage gets a fresh token — see the design spec's own
// "Known simplifications" note (docs/superpowers/specs/2026-08-29-bookarena-design.md).

const STORAGE_KEY = "bookarena.voterToken";

export function getVoterToken(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (private browsing, blocked site data) —
    // voting still works, it just won't be remembered as "already voted"
    // across a reload. Acceptable given this is already an
    // unenforceable-by-design anti-abuse measure, not a real one.
    return crypto.randomUUID();
  }
}
```

- [ ] **Step 2: Write `api/arena.ts`**

```ts
// Thin wrapper functions over apiFetch/publicFetch for every /arenas
// route — same shape as api/gallery.ts (a standalone backend resource,
// not a field on the account's library document).

import { apiFetch, publicFetch } from "./client";

export interface SeedBook {
  key: string;
  title: string;
  author: string;
  cover: string | null;
}

export interface TournamentSummary {
  id: string;
  name: string;
  bracketSize: number;
  roundDurationMinutes: number;
  status: "seeding" | "active" | "completed";
  currentRound: number;
  createdAt: string;
  ownerUserId: string;
}

export interface DuelSide extends SeedBook {
  votes: number;
}

export interface Duel {
  id: string;
  roundNumber: number;
  duelIndex: number;
  bookA: DuelSide;
  bookB: DuelSide;
  winnerKey: string | null;
  status: "active" | "tied_pending_tiebreak" | "settled";
  opensAt: string;
  closesAt: string;
  hasVoted: boolean;
}

export interface TournamentView extends TournamentSummary {
  slots: Array<{ slotIndex: number } & SeedBook>;
  duels: Duel[];
}

export async function createTournament(input: { name: string; bracketSize: number; roundDurationMinutes: number }): Promise<TournamentSummary> {
  const body = (await apiFetch("/arenas", { method: "POST", body: JSON.stringify(input) })) as { tournament: TournamentSummary };
  return body.tournament;
}

export async function fetchMyTournaments(): Promise<TournamentSummary[]> {
  const body = (await apiFetch("/arenas/mine")) as { tournaments: TournamentSummary[] };
  return body.tournaments;
}

export async function fetchPublicTournaments(): Promise<TournamentSummary[]> {
  const body = (await publicFetch("/arenas/public")) as { tournaments: TournamentSummary[] };
  return body.tournaments;
}

/** Public — works with no session at all. `voterToken` lets the backend
 *  fill in each active duel's `hasVoted`. */
export async function fetchTournament(id: string, voterToken: string): Promise<TournamentView> {
  const body = (await publicFetch(`/arenas/${id}?voterToken=${encodeURIComponent(voterToken)}`)) as { tournament: TournamentView };
  return body.tournament;
}

/** Full-replace — same semantics as PUT /library. Send every slot the
 *  seeding UI currently has assigned, not just the changed ones. */
export async function setTournamentSlots(id: string, slots: Array<{ slotIndex: number; book: SeedBook }>): Promise<void> {
  await apiFetch(`/arenas/${id}/slots`, { method: "PUT", body: JSON.stringify({ slots }) });
}

export async function randomFillTournament(id: string, pool: SeedBook[]): Promise<void> {
  await apiFetch(`/arenas/${id}/random-fill`, { method: "POST", body: JSON.stringify({ pool }) });
}

export async function startTournament(id: string): Promise<void> {
  await apiFetch(`/arenas/${id}/start`, { method: "POST" });
}

/** Public — no session required, this is the whole point of BookArena. */
export async function voteOnDuel(tournamentId: string, duelId: string, voterToken: string, bookKey: string): Promise<void> {
  await publicFetch(`/arenas/${tournamentId}/duels/${duelId}/vote`, { method: "POST", body: JSON.stringify({ voterToken, bookKey }) });
}

export async function settleDuelEarly(tournamentId: string, duelId: string): Promise<void> {
  await apiFetch(`/arenas/${tournamentId}/duels/${duelId}/settle`, { method: "POST" });
}

export async function resolveTiebreak(tournamentId: string, duelId: string, winnerBookKey: string): Promise<void> {
  await apiFetch(`/arenas/${tournamentId}/duels/${duelId}/tiebreak`, { method: "POST", body: JSON.stringify({ winnerBookKey }) });
}

export async function deleteTournament(id: string): Promise<void> {
  await apiFetch(`/arenas/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: no errors (nothing imports these yet).

```bash
git add frontend/src/api/arena.ts frontend/src/lib/arenaVoter.ts
git commit -m "feat(arena): add frontend API client and anonymous voter identity"
```

---

## Task 7: React-query hooks

**Files:**
- Create: `frontend/src/hooks/useArena.ts`
- Create: `frontend/src/hooks/useMyTournaments.ts`
- Create: `frontend/src/hooks/usePublicTournaments.ts`

**Interfaces:**
- Consumes: everything from `api/arena.ts` and `lib/arenaVoter.ts` (Task 6).
- Produces: `useArena(id)` → `{ tournament, isLoading, error, voterToken, vote, refetch }`; `useMyTournaments()` / `usePublicTournaments()` → `{ tournaments, isLoading, error }` — Tasks 11–14's pages consume these.

- [ ] **Step 1: Write `useArena.ts`**

```ts
// Reads and votes on a single tournament — used by ArenaViewPage.tsx
// (voting) and ArenaSeedPage.tsx (seeding, which just needs the read side).
//
// Polls while the tournament is still running — this app has no
// realtime/websocket layer (see the arena module's own design notes), so
// a short interval is the simplest way for vote counts, round advances,
// and completion to show up without a manual refresh. Stops polling once
// the tournament is completed, since nothing more will ever change.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTournament, voteOnDuel } from "../api/arena";
import { getVoterToken } from "../lib/arenaVoter";

const POLL_INTERVAL_MS = 5000;

export function useArena(id: string) {
  const queryClient = useQueryClient();
  const voterToken = getVoterToken();
  const queryKey = ["arena", id, voterToken];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchTournament(id, voterToken),
    refetchInterval: (q) => (q.state.data?.status === "completed" ? false : POLL_INTERVAL_MS)
  });

  async function vote(duelId: string, bookKey: string) {
    await voteOnDuel(id, duelId, voterToken, bookKey);
    await queryClient.invalidateQueries({ queryKey });
  }

  return { tournament: query.data, isLoading: query.isLoading, error: query.error, voterToken, vote, refetch: query.refetch };
}
```

- [ ] **Step 2: Write `useMyTournaments.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchMyTournaments } from "../api/arena";

export function useMyTournaments() {
  const query = useQuery({ queryKey: ["arenas", "mine"], queryFn: fetchMyTournaments });
  return { tournaments: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
```

- [ ] **Step 3: Write `usePublicTournaments.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchPublicTournaments } from "../api/arena";

export function usePublicTournaments() {
  const query = useQuery({ queryKey: ["arenas", "public"], queryFn: fetchPublicTournaments });
  return { tournaments: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

```bash
git add frontend/src/hooks/useArena.ts frontend/src/hooks/useMyTournaments.ts frontend/src/hooks/usePublicTournaments.ts
git commit -m "feat(arena): add react-query hooks for tournaments and voting"
```

---

## Task 8: `DuelCard` component

**Files:**
- Create: `frontend/src/components/arena/DuelCard.tsx`

**Interfaces:**
- Consumes: `Duel`/`DuelSide` (Task 6), `CoverImage` from `components/BookCard.tsx`.
- Produces: `<DuelCard duel={...} onVote={(bookKey) => void} votingDisabledReason={string | null} />` — Task 9 (`BracketTree`) and Tasks 13 (`ArenaViewPage`) render this per duel.

- [ ] **Step 1: Write the component**

```tsx
// Head-to-head voting card for one duel: two books side by side, a vote
// button on each, a live tally bar, and a countdown to closes_at.
// Reuses CoverImage (components/BookCard.tsx) rather than reimplementing
// cover rendering — it takes a `book: Record<string, unknown>`, so each
// duel side is adapted into that shape via toCoverImageBook below.

import { useEffect, useState } from "react";
import type { Duel, DuelSide } from "../../api/arena";
import { CoverImage } from "../BookCard";

function toCoverImageBook(side: DuelSide): Record<string, unknown> {
  return { Title: side.title, Attribution: side.author, _coverUrl: side.cover ?? undefined };
}

function useCountdown(closesAt: string): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    function tick() {
      const remainingMs = new Date(closesAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        setLabel("Closing…");
        return;
      }
      const totalSeconds = Math.floor(remainingMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setLabel(hours > 0 ? `${hours}h ${minutes}m left` : minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [closesAt]);
  return label;
}

function DuelSideCard({
  side,
  totalVotes,
  isWinner,
  canVote,
  onVote
}: {
  side: DuelSide;
  totalVotes: number;
  isWinner: boolean;
  canVote: boolean;
  onVote: () => void;
}) {
  const pct = totalVotes > 0 ? Math.round((side.votes / totalVotes) * 100) : 0;
  return (
    <button
      onClick={onVote}
      disabled={!canVote}
      className={`group relative flex flex-1 flex-col overflow-hidden rounded-xl border-2 text-left transition-colors ${
        isWinner ? "border-(--color-accent)" : "border-(--color-border)"
      } ${canVote ? "cursor-pointer hover:border-(--color-accent)" : "cursor-default"}`}
    >
      <div className="relative aspect-2/3 w-full bg-(--color-border)">
        <CoverImage book={toCoverImageBook(side)} />
      </div>
      <div className="p-3">
        <h4 className="truncate text-sm font-semibold">{side.title}</h4>
        <p className="truncate text-xs text-(--color-text-dim)">{side.author}</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-(--color-border)">
          <div className="h-full bg-(--color-accent)" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-(--color-text-dim)">
          {side.votes} vote{side.votes === 1 ? "" : "s"} ({pct}%)
        </p>
      </div>
    </button>
  );
}

export function DuelCard({
  duel,
  onVote,
  votingDisabledReason
}: {
  duel: Duel;
  onVote: (bookKey: string) => void;
  /** Non-null when voting shouldn't be allowed right now (already voted,
   *  duel settled, tournament not active) — shown instead of the
   *  countdown. */
  votingDisabledReason: string | null;
}) {
  const countdown = useCountdown(duel.closesAt);
  const totalVotes = duel.bookA.votes + duel.bookB.votes;
  const canVote = duel.status === "active" && !votingDisabledReason;

  return (
    <div className="rounded-2xl border border-(--color-border) bg-(--color-surface) p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-(--color-text-dim)">
        <span>
          Round {duel.roundNumber} · Duel {duel.duelIndex + 1}
        </span>
        <span>
          {duel.status === "active"
            ? (votingDisabledReason ?? countdown)
            : duel.status === "tied_pending_tiebreak"
              ? "Tied — awaiting tie-break"
              : "Settled"}
        </span>
      </div>
      <div className="flex gap-3">
        <DuelSideCard
          side={duel.bookA}
          totalVotes={totalVotes}
          isWinner={duel.winnerKey === duel.bookA.key}
          canVote={canVote}
          onVote={() => onVote(duel.bookA.key)}
        />
        <div className="flex items-center px-1 text-sm font-bold text-(--color-text-dim)">VS</div>
        <DuelSideCard
          side={duel.bookB}
          totalVotes={totalVotes}
          isWinner={duel.winnerKey === duel.bookB.key}
          canVote={canVote}
          onVote={() => onVote(duel.bookB.key)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/src/components/arena/DuelCard.tsx
git commit -m "feat(arena): add DuelCard voting component"
```

---

## Task 9: `BracketTree` component

**Files:**
- Create: `frontend/src/components/arena/BracketTree.tsx`

**Interfaces:**
- Consumes: `TournamentView` (Task 6).
- Produces: `<BracketTree tournament={...} renderDuel={(duelId) => ReactNode} />` — Task 13 (`ArenaViewPage`) uses this with `renderDuel` producing a `DuelCard` per duel (kept as a render-prop so `BracketTree` itself never needs to know about voting/hasVoted logic).

- [ ] **Step 1: Write the component**

```tsx
// Groups a tournament's duels by round and lays them out as columns — a
// classic single-elimination bracket. Uses flex/CSS spacing rather than
// SVG connector lines — good enough at this app's bracket sizes (up to
// 128) and much simpler to keep in sync with real DOM sizing.
//
// `renderDuel` is a render-prop rather than this component fetching/
// rendering DuelCard itself, so BracketTree stays ignorant of voting,
// hasVoted, or any other duel-interaction concern — it only knows how to
// lay duels out.

import type { ReactNode } from "react";
import type { TournamentView } from "../../api/arena";

export function BracketTree({ tournament, renderDuel }: { tournament: TournamentView; renderDuel: (duelId: string) => ReactNode }) {
  const rounds = new Map<number, TournamentView["duels"]>();
  for (const duel of tournament.duels) {
    const list = rounds.get(duel.roundNumber) ?? [];
    list.push(duel);
    rounds.set(duel.roundNumber, list);
  }
  const roundNumbers = [...rounds.keys()].sort((a, b) => a - b);
  const lastRoundNumber = roundNumbers.at(-1);

  return (
    <div className="flex gap-8 overflow-x-auto pb-4">
      {roundNumbers.map((roundNumber) => {
        const duels = [...rounds.get(roundNumber)!].sort((a, b) => a.duelIndex - b.duelIndex);
        const isFinal = roundNumber === lastRoundNumber && duels.length === 1;
        return (
          <div key={roundNumber} className="flex w-72 shrink-0 flex-col justify-around gap-6">
            <h3 className="text-center text-xs font-semibold tracking-wide text-(--color-text-dim) uppercase">
              {isFinal ? "Final" : `Round ${roundNumber}`}
            </h3>
            {duels.map((duel) => (
              <div key={duel.id}>{renderDuel(duel.id)}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/src/components/arena/BracketTree.tsx
git commit -m "feat(arena): add BracketTree bracket layout component"
```

---

## Task 10: `SeedSlotGrid` component

**Files:**
- Create: `frontend/src/components/arena/SeedSlotGrid.tsx`

**Interfaces:**
- Consumes: `SeedBook` (Task 6), `useLibrary` (`hooks/useLibrary.ts`), `bookKey` (`lib/merge.ts`), `BookSearchList` (`components/murals/pickers.tsx`), `CoverImage` (`components/BookCard.tsx`).
- Produces: `<SeedSlotGrid bracketSize={n} slots={Array<SeedBook|null>} onChange={(slots) => void} />` — Task 12 (`ArenaSeedPage`) owns the actual `slots` state and persists it via `setTournamentSlots`/`randomFillTournament`.

- [ ] **Step 1: Write the component**

```tsx
// The seeding step for a bracket: `bracketSize` empty slots, filled
// either by "Random fill" (shuffles the account's whole library and
// picks `bracketSize` books) or by clicking a slot and picking a book
// from a search list (reusing BookSearchList — the same searchable
// click-to-select list murals' block editors already use for exactly
// this "pick a book from my library" interaction).
//
// Purely local/controlled — ArenaSeedPage.tsx owns actually persisting
// `slots` via PUT /arenas/:id/slots or POST /arenas/:id/random-fill.

import { useState } from "react";
import type { SeedBook } from "../../api/arena";
import { useLibrary } from "../../hooks/useLibrary";
import { bookKey } from "../../lib/merge";
import { CoverImage } from "../BookCard";
import { BookSearchList } from "../murals/pickers";

function toSeedBook(book: Record<string, unknown>): SeedBook {
  return {
    key: bookKey(book),
    title: String(book.Title ?? "Untitled"),
    author: String(book.Attribution ?? "Unknown author"),
    cover: typeof book._coverUrl === "string" ? book._coverUrl : null
  };
}

export function SeedSlotGrid({
  bracketSize,
  slots,
  onChange
}: {
  bracketSize: number;
  slots: Array<SeedBook | null>;
  onChange: (slots: Array<SeedBook | null>) => void;
}) {
  const { data: library } = useLibrary();
  const books = ((library?.data as { books?: Array<Record<string, unknown>> } | undefined)?.books ?? []) as Array<Record<string, unknown>>;
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const usedKeys = new Set(slots.filter((s): s is SeedBook => s !== null).map((s) => s.key));
  const filledCount = slots.filter(Boolean).length;

  function randomFill() {
    const shuffled = [...books].sort(() => Math.random() - 0.5).slice(0, bracketSize).map(toSeedBook);
    onChange(Array.from({ length: bracketSize }, (_, i) => shuffled[i] ?? null));
  }

  function assignSlot(index: number, book: Record<string, unknown>) {
    const next = [...slots];
    next[index] = toSeedBook(book);
    onChange(next);
    setPickingSlot(null);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-text-dim)">
          {filledCount} / {bracketSize} slots filled
        </p>
        <button
          onClick={randomFill}
          disabled={books.length < bracketSize}
          title={books.length < bracketSize ? `Your library needs at least ${bracketSize} books to random-fill.` : undefined}
          className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Random fill
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {slots.map((slot, i) => (
          <button
            key={i}
            onClick={() => setPickingSlot(i)}
            className="flex aspect-2/3 flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-(--color-border) bg-(--color-surface) text-xs text-(--color-text-dim) hover:border-(--color-accent)"
          >
            {slot ? (
              <div className="relative h-full w-full">
                <CoverImage book={{ Title: slot.title, Attribution: slot.author, _coverUrl: slot.cover ?? undefined }} />
              </div>
            ) : (
              <span>Slot {i + 1}</span>
            )}
          </button>
        ))}
      </div>

      {pickingSlot !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPickingSlot(null)}>
          <div
            className="w-full max-w-md rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">Pick a book for slot {pickingSlot + 1}</h3>
            <BookSearchList books={books.filter((b) => !usedKeys.has(bookKey(b)))} onSelect={(book) => assignSlot(pickingSlot, book)} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/src/components/arena/SeedSlotGrid.tsx
git commit -m "feat(arena): add SeedSlotGrid seeding component"
```

---

## Task 11: `ArenaListPage` (dashboard: my tournaments + create)

**Files:**
- Create: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/layouts/DashboardLayout.tsx`

**Interfaces:**
- Consumes: `useMyTournaments` (Task 7), `createTournament` (Task 6).
- Produces: the `/dashboard/arena` route and its "Arena" nav entry.

- [ ] **Step 1: Write the page**

```tsx
// "My tournaments" — list + create form. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTournament } from "../api/arena";
import { useMyTournaments } from "../hooks/useMyTournaments";

const BRACKET_SIZES = [4, 8, 16, 32, 64];

export function ArenaListPage() {
  const { tournaments, isLoading, refetch } = useMyTournaments();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [bracketSize, setBracketSize] = useState(16);
  const [roundHours, setRoundHours] = useState(24);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const tournament = await createTournament({ name: name.trim(), bracketSize, roundDurationMinutes: roundHours * 60 });
      await refetch();
      navigate(`/dashboard/arena/${tournament.id}/seed`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <h2 className="mb-6 text-lg font-bold">Arena</h2>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-text-dim)">
          Bracket tournaments from your library —{" "}
          <a href="/arena" className="text-(--color-accent) underline">
            browse public tournaments
          </a>
          .
        </p>
        <button onClick={() => setShowCreate(true)} className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white">
          New tournament
        </button>
      </div>

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tournaments.map((t) => (
          <a
            key={t.id}
            href={t.status === "seeding" ? `/dashboard/arena/${t.id}/seed` : `/arena/${t.id}`}
            className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)"
          >
            <h3 className="font-semibold">{t.name}</h3>
            <p className="text-sm text-(--color-text-dim)">
              {t.bracketSize}-book bracket · {t.status}
            </p>
          </a>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div
            className="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-semibold">New tournament</h3>

            <label className="mb-3 block text-sm">
              Name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
              />
            </label>

            <label className="mb-3 block text-sm">
              Bracket size
              <select
                value={bracketSize}
                onChange={(e) => setBracketSize(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
              >
                {BRACKET_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} books
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-4 block text-sm">
              Round length (hours)
              <input
                type="number"
                min={1}
                value={roundHours}
                onChange={(e) => setRoundHours(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-lg px-3 py-1.5 text-sm text-(--color-text-dim)">
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={creating || !name.trim()}
                className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create & seed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route and nav entry**

In `frontend/src/App.tsx`, add the import:

```tsx
import { ArenaListPage } from "./pages/ArenaListPage";
```

And the route, inside the existing `<DashboardLayout>` block:

```tsx
            <Route path="/dashboard/arena" element={<ArenaListPage />} />
```

In `frontend/src/layouts/DashboardLayout.tsx`, add to `NAV_ITEMS` (after "Murals", say):

```ts
  { to: "/dashboard/arena", label: "Arena", end: false },
```

- [ ] **Step 3: Typecheck, lint, and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/src/pages/ArenaListPage.tsx frontend/src/App.tsx frontend/src/layouts/DashboardLayout.tsx
git commit -m "feat(arena): add ArenaListPage with create flow and nav entry"
```

---

## Task 12: `ArenaSeedPage`

**Files:**
- Create: `frontend/src/pages/ArenaSeedPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useArena` (Task 7), `SeedSlotGrid` (Task 10), `setTournamentSlots`/`startTournament` (Task 6), `useAuth` (`auth/AuthContext.tsx`).
- Produces: the `/dashboard/arena/:id/seed` route.

- [ ] **Step 1: Write the page**

```tsx
// The seeding step for one tournament: SeedSlotGrid for picking books,
// then "Start" once every slot is filled. Redirects away if the current
// session isn't this tournament's owner, or if it's already started
// (seeding is a one-time step).

import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { setTournamentSlots, startTournament, type SeedBook } from "../api/arena";
import { useAuth } from "../auth/AuthContext";
import { SeedSlotGrid } from "../components/arena/SeedSlotGrid";
import { useArena } from "../hooks/useArena";

export function ArenaSeedPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { tournament, isLoading, refetch } = useArena(id!);
  const [slots, setSlots] = useState<Array<SeedBook | null>>([]);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!tournament) return;
    // Seed local slot state from whatever's already saved (e.g. reopening
    // this page after a partial manual seed).
    const bySlotIndex = new Map(tournament.slots.map((s) => [s.slotIndex, s]));
    setSlots(Array.from({ length: tournament.bracketSize }, (_, i) => bySlotIndex.get(i) ?? null));
  }, [tournament]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </div>
    );
  }
  if (!tournament) return <Navigate to="/dashboard/arena" replace />;
  if (tournament.ownerUserId !== session?.user.id) return <Navigate to="/dashboard/arena" replace />;
  if (tournament.status !== "seeding") return <Navigate to={`/arena/${tournament.id}`} replace />;

  const filledCount = slots.filter(Boolean).length;
  const canStart = filledCount === tournament.bracketSize;

  async function handleStart() {
    setStarting(true);
    try {
      const filled = slots.filter((s): s is SeedBook => s !== null);
      await setTournamentSlots(
        tournament!.id,
        filled.map((book, i) => ({ slotIndex: i, book }))
      );
      await startTournament(tournament!.id);
      navigate(`/arena/${tournament!.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <h2 className="mb-6 text-lg font-bold">Seed &quot;{tournament.name}&quot;</h2>
      <SeedSlotGrid bracketSize={tournament.bracketSize} slots={slots} onChange={setSlots} />

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() =>
            void setTournamentSlots(
              tournament.id,
              slots.filter((s): s is SeedBook => s !== null).map((book, i) => ({ slotIndex: i, book }))
            ).then(() => refetch())
          }
          className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm"
        >
          Save progress
        </button>
        <button
          onClick={() => void handleStart()}
          disabled={!canStart || starting}
          className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start tournament"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `frontend/src/App.tsx`:

```tsx
import { ArenaSeedPage } from "./pages/ArenaSeedPage";
```

```tsx
            <Route path="/dashboard/arena/:id/seed" element={<ArenaSeedPage />} />
```

- [ ] **Step 3: Typecheck, lint, and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/src/pages/ArenaSeedPage.tsx frontend/src/App.tsx
git commit -m "feat(arena): add ArenaSeedPage"
```

---

## Task 13: `ArenaViewPage` (public bracket + voting)

**Files:**
- Create: `frontend/src/pages/ArenaViewPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useArena` (Task 7), `BracketTree` (Task 9), `DuelCard` (Task 8), `settleDuelEarly`/`resolveTiebreak` (Task 6), `useAuth`.
- Produces: the **public, unauthenticated** `/arena/:id` route — the first such route in this app.

- [ ] **Step 1: Write the page**

```tsx
// The public bracket + voting page — anyone with the link, no account
// needed. Owner-only controls (settle early, tie-break) are computed
// purely client-side by comparing the logged-in session's own user id
// (if any) against the tournament's plain ownerUserId field — no new
// auth primitive needed on the (deliberately unauthenticated) GET route.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { resolveTiebreak, settleDuelEarly } from "../api/arena";
import { useAuth } from "../auth/AuthContext";
import { BracketTree } from "../components/arena/BracketTree";
import { DuelCard } from "../components/arena/DuelCard";
import { useArena } from "../hooks/useArena";

export function ArenaViewPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const { tournament, isLoading, vote, refetch } = useArena(id!);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [busyDuelId, setBusyDuelId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-sm text-(--color-text-dim)">No such tournament.</p>
      </div>
    );
  }

  const isOwner = session?.user.id === tournament.ownerUserId;

  async function handleVote(duelId: string, bookKey: string) {
    setVoteError(null);
    try {
      await vote(duelId, bookKey);
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : "Couldn't record that vote.");
    }
  }

  async function handleSettle(duelId: string) {
    setBusyDuelId(duelId);
    try {
      await settleDuelEarly(tournament!.id, duelId);
      await refetch();
    } finally {
      setBusyDuelId(null);
    }
  }

  async function handleTiebreak(duelId: string, winnerBookKey: string) {
    setBusyDuelId(duelId);
    try {
      await resolveTiebreak(tournament!.id, duelId, winnerBookKey);
      await refetch();
    } finally {
      setBusyDuelId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <h2 className="mb-1 text-lg font-bold">{tournament.name}</h2>
      <p className="mb-4 text-sm text-(--color-text-dim)">
        {tournament.bracketSize}-book bracket · {tournament.status === "completed" ? "Completed" : `Round ${tournament.currentRound}`}
      </p>
      {voteError && <p className="mb-4 text-sm text-(--color-danger)">{voteError}</p>}

      <BracketTree
        tournament={tournament}
        renderDuel={(duelId) => {
          const duel = tournament.duels.find((d) => d.id === duelId)!;
          const votingDisabledReason = duel.hasVoted ? "You already voted" : tournament.status !== "active" ? "Tournament not active" : null;
          return (
            <div>
              <DuelCard duel={duel} onVote={(bookKey) => void handleVote(duel.id, bookKey)} votingDisabledReason={votingDisabledReason} />
              {isOwner && duel.status === "active" && (
                <button
                  onClick={() => void handleSettle(duel.id)}
                  disabled={busyDuelId === duel.id}
                  className="mt-2 w-full rounded-lg border border-(--color-border) py-1 text-xs text-(--color-text-dim) hover:bg-(--color-surface-hover)"
                >
                  Settle now
                </button>
              )}
              {isOwner && duel.status === "tied_pending_tiebreak" && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookA.key)}
                    disabled={busyDuelId === duel.id}
                    className="flex-1 rounded-lg bg-(--color-accent) py-1 text-xs font-medium text-white"
                  >
                    {duel.bookA.title} wins
                  </button>
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookB.key)}
                    disabled={busyDuelId === duel.id}
                    className="flex-1 rounded-lg bg-(--color-accent) py-1 text-xs font-medium text-white"
                  >
                    {duel.bookB.title} wins
                  </button>
                </div>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Register the route — outside `RequireAuth`**

In `frontend/src/App.tsx`, add the import:

```tsx
import { ArenaViewPage } from "./pages/ArenaViewPage";
```

And add the route as a **top-level sibling of `/login`**, not nested inside `<RequireAuth>` — this is the point of the whole route:

```tsx
      <Route path="/arena/:id" element={<ArenaViewPage />} />
```

- [ ] **Step 3: Typecheck, lint, and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/src/pages/ArenaViewPage.tsx frontend/src/App.tsx
git commit -m "feat(arena): add public ArenaViewPage with voting and owner controls"
```

---

## Task 14: `ArenaPublicListPage` (public directory)

**Files:**
- Create: `frontend/src/pages/ArenaPublicListPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `usePublicTournaments` (Task 7).
- Produces: the public, unauthenticated `/arena` route.

- [ ] **Step 1: Write the page**

```tsx
// Public directory of every tournament — the "also listed" half of
// "tournaments are public: a shareable link, and also listed" (see the
// design spec). No auth, no PageContainer's dashboard chrome (this route
// lives outside DashboardLayout entirely) — just a minimal standalone page.

import { usePublicTournaments } from "../hooks/usePublicTournaments";

export function ArenaPublicListPage() {
  const { tournaments, isLoading } = usePublicTournaments();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-bold">BookArena</h1>
      <p className="mb-6 text-sm text-(--color-text-dim)">Vote in book bracket tournaments — no account needed.</p>

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}
      {!isLoading && tournaments.length === 0 && <p className="text-sm text-(--color-text-dim)">No tournaments yet.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tournaments.map((t) => (
          <a key={t.id} href={`/arena/${t.id}`} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)">
            <h3 className="font-semibold">{t.name}</h3>
            <p className="text-sm text-(--color-text-dim)">
              {t.bracketSize}-book bracket · {t.status === "completed" ? "Completed" : `Round ${t.currentRound}`}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route — outside `RequireAuth`**

In `frontend/src/App.tsx`:

```tsx
import { ArenaPublicListPage } from "./pages/ArenaPublicListPage";
```

```tsx
      <Route path="/arena" element={<ArenaPublicListPage />} />
```

- [ ] **Step 3: Typecheck, lint, and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/src/pages/ArenaPublicListPage.tsx frontend/src/App.tsx
git commit -m "feat(arena): add public tournament directory page"
```

---

## Final end-to-end verification

1. Backend: `cd backend && npm run typecheck && npm test` — all green.
2. `cd backend && npm run dev`, then in another terminal `node scripts/test-arena-flow.mjs` — all checks pass.
3. Frontend: `cd frontend && npm run typecheck && npm run lint`.
4. `cd frontend && npm run dev` against the running backend:
   - Sign in, go to **Arena** in the nav, create a tournament, seed it both via Random fill and by manually reassigning a slot, Start it.
   - Open the resulting `/arena/:id` link in an incognito window (no session) — confirm you can vote, can't vote twice, and see the countdown.
   - As the owner (original window), use "Settle now" on a duel; confirm the bracket advances.
   - Force a 0-0 tie on a duel (settle one with no votes) and confirm the tie-break buttons appear and resolve it.
   - Let a duel's timer actually expire (create one with a 1-minute round for this check) and confirm the scheduler sweep settles it automatically within ~30s, with no manual action.
   - Visit `/arena` (no session) and confirm the tournament is listed.
