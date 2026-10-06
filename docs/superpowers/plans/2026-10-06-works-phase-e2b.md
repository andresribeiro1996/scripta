# Phase E2b: Game Storage Speaks Works — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arena, tier lists and quizzes store work ids instead of library copy keys, and the E2a edge translators, the legacy key format, the works sweeps and the games' `rekeyBooks` hooks are deleted.

**Architecture:** One startup pass per game database rewrites stored keys to E1's stored work ids, inside a single `BEGIN IMMEDIATE` transaction gated on the old shape. Tables whose columns sit in a primary key or index are rebuilt by copy and rename. After the pass, each module speaks only the works format: writes store canonical work ids, and reads canonicalize stored ids, because a later catalog merge can still retire one. Public book resolution for game entries goes through one new library helper, `resolvePublicBooksByWork`, which maps a work to the owner's first copy.

**Tech Stack:** Fastify/TypeScript, `node:sqlite`, `zod`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-05-works-phase-e2-design.md`, sections "Removal (E2b)", "Rollback" and "Rollout" (PRs 6–9). E2a (PRs 1–5) shipped on 2026-10-06. The user dropped the 14-day gate because the app has two users. See Execution notes for what replaces it.

## Rulings on spec gaps

Fact-finding on 2026-10-06 found the following. Each is decided here; each costs a rework if wrong.

1. **Stored field names become the wire names:**
   - tier list `data.tiers[].workIds`, with `data.pool` holding work ids;
   - quiz `data.books[].workId` and `data.questions[].workId`.

   The spec left the stored names open. Keeping `bookKeys`/`key` would need a translator at the edge, which is what this phase deletes.
2. **Arena duels store `winner_side` (`'a'`/`'b'`) instead of `winner_key` and `winner_work_id`.**
   - The spec keeps `winner_work_id`. A duel whose sides share a work (after a catalog merge) cannot name its winner by work, and the winner's title and cover come from the winning side.
   - `winnerWorkId` in views is derived from the side.
3. **The pass stores E1's stored work ids as they are and does not canonicalize.**
   - The game databases cannot reach the books catalog from `connection.ts`. Reads must canonicalize anyway, since merges keep happening after any write.
   - Duplicates the pass can see (same stored id) keep the first.
   - Duplicates that only appear after canonicalization are collapsed at read time, keeping the first, exactly as E2a's translators did.
4. **Public books for game entries resolve by work.** Murals and tier-list snapshots looked tier-list entries up as library keys (`murals/domain/publicPayload.ts`, `tierlists/routes.ts`). The new helper `resolvePublicBooksByWork(ownerUserId, workIds)` maps each work to the owner's first copy by library position.
5. **Pre-removal check.**
   - `works-check.mjs` gains its `e2` section in its own small PR (PR 6). It has to be live in production before the user runs it.
   - Each removal PR also updates the module's post-removal section, so the check keeps running after the pass.
6. **Dropping the header folds into the last removal PR (Task 10)** instead of a separate client PR 9. After PR 9 the server ignores the header anyway, so removing it from clients is a no-op the two users get over the air.

## Global Constraints

- Storage before the pass is exactly as E1/E2a left it. After the pass it holds work ids only. No `book_key`, `key` or `bookKey` remains in arena, tier-list or quiz storage.
- Each pass:
  - runs inside one `BEGIN IMMEDIATE`;
  - re-reads its gate inside the transaction (several connections open each database);
  - sets `PRAGMA user_version = 1`;
  - runs before `db.exec(schema)`, so the new indexes never meet an old table.
- Arena's pass turns `PRAGMA foreign_keys` OFF before `BEGIN` and back ON after `COMMIT`, then runs `PRAGMA foreign_key_check` and throws on any row. Otherwise rebuilding `duels` cascades and deletes every vote.
- Within one tier list or quiz, each work appears once (tiers before pool; first book wins). A tournament keeps every slot.
- Every `workId` the API returns is canonical. Unknown work id gives 400 `{ "error": "That book isn't in the catalog." }`. Catalog unreachable gives 503 (`WorkResolutionError`). Duplicate work gives 409 with `duplicateWorkMessage`.
- After each module's switch, its routes accept and return only the works format, with or without the header.
- Murals keep copy keys. `rekeyBooks` keeps only the murals entry; `resolveEntryWorks` and `workIdsByKey` stay for murals.
- No code comments (repo rule). The *why* goes in commit messages.
- Backend test preambles set every `*_DB_PATH` the code opens, including `COVERS_DB_PATH`. Run backend tests as CI does: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`. New `*.test.ts` files join the explicit list in `backend/package.json`'s `"test"` script; deleted ones leave it.
- After each backend task: `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`. If shared, frontend or mobile change: `npm run build --workspace @scripta/shared`, then that package's typecheck, lint and test.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command.
- PRs, each from `origin/main` after the previous one merges:
  - PR 6, check: Task 1;
  - PR 7, arena: Tasks 2–3;
  - PR 8, tier lists: Tasks 4–6;
  - PR 9, quizzes and cleanup: Tasks 7–10.

## Review Focus

1. **A duel whose two sides share a stored work.** After the pass, its votes stay on their own side, because the tally counts `side`, not work. Test in Task 2.
2. **A published tier list whose pool held two editions of one work.**
   - The pass keeps the first entry. The second edition's placements collapse into the first, keeping each ballot's first placement by rowid.
   - The histogram never double-counts a ballot.
   - Test in Task 4.
3. **A frozen snapshot whose length differs from the old pool.**
   - The pass sets `public_books` to NULL.
   - The voting board falls back to the live resolve by work and still shows every book the owner holds.
   - Tests in Tasks 4 and 6.
4. **A stored work id merged away after the pass.**
   - Reads answer the canonical id.
   - A ballot or vote naming the canonical id lands on the stored entry. It is not refused with 400.
   - Tests in Tasks 3, 6 and 8.
5. **Two connections run the migration in turn**, which happens when the plugin, the public-api getter and the sweeps each open the database. The second run is a no-op and must not throw. Tests in Tasks 2, 4 and 7.

---

## PR 6 — Pre-removal check

### Task 1: `e2` section in `works-check.mjs`, restore steps in the README

**Files:**
- Modify: `backend/scripts/works-check.mjs`
- Modify: `backend/README.md` (the "Works check" section under "Works (phase E1)")

- [ ] **Step 1: Add the section.** Append, before the final `console.log`:

```js
const has = (db, table, column) => columns(db, table).includes(column);
const sharedWork = (table, idColumn) => `SELECT COUNT(*) AS n FROM (SELECT ${idColumn} FROM ${table} WHERE work_id IS NOT NULL GROUP BY ${idColumn}, work_id HAVING COUNT(*) > 1)`;
const e2 = {};

for (const [name, envName, check] of [
  ["arena", "ARENA_DB_PATH", (db) => has(db, "tournament_slots", "book_key") ? {
    slotsWithoutWork: count(db, "SELECT COUNT(*) AS n FROM tournament_slots WHERE work_id IS NULL"),
    duelSidesWithoutWork: count(db, "SELECT COUNT(*) AS n FROM duels WHERE book_a_work_id IS NULL OR book_b_work_id IS NULL"),
    tournamentsSharingWork: count(db, sharedWork("tournament_slots", "tournament_id")),
    duelsSharingWork: count(db, "SELECT COUNT(*) AS n FROM duels WHERE book_a_work_id = book_b_work_id"),
    votesOnNeitherSide: count(db, "SELECT COUNT(*) AS n FROM votes AS v JOIN duels AS d ON d.id = v.duel_id WHERE v.book_key NOT IN (d.book_a_key, d.book_b_key)"),
    winnersOnNeitherSide: count(db, "SELECT COUNT(*) AS n FROM duels WHERE winner_key IS NOT NULL AND winner_key NOT IN (book_a_key, book_b_key)")
  } : "migrated"],
  ["tierlists", "TIERLISTS_DB_PATH", (db) => has(db, "tierlist_works", "key") ? {
    entriesWithoutWork: count(db, `SELECT COUNT(*) AS n FROM (
      SELECT t.id, p.value AS key FROM tierlists AS t, json_each(t.data, '$.pool') AS p
      UNION ALL
      SELECT t.id, k.value FROM tierlists AS t, json_each(t.data, '$.tiers') AS tr, json_each(tr.value, '$.bookKeys') AS k
    ) AS e WHERE NOT EXISTS (SELECT 1 FROM tierlist_works AS w WHERE w.tierlist_id = e.id AND w.key = e.key AND w.work_id IS NOT NULL)`),
    placementsWithoutWork: count(db, "SELECT COUNT(*) AS n FROM tierlist_ballot_placements WHERE work_id IS NULL"),
    listsSharingWork: count(db, sharedWork("tierlist_works", "tierlist_id")),
    snapshotMismatches: count(db, "SELECT COUNT(*) AS n FROM tierlists WHERE public_books IS NOT NULL AND json_array_length(public_books) != json_array_length(data, '$.pool')")
  } : "migrated"],
  ["quizzes", "QUIZZES_DB_PATH", (db) => has(db, "quiz_works", "key") ? {
    booksWithoutWork: count(db, `SELECT COUNT(*) AS n FROM quizzes AS q, json_each(q.data, '$.books') AS b
      WHERE NOT EXISTS (SELECT 1 FROM quiz_works AS w WHERE w.quiz_id = q.id AND w.key = json_extract(b.value, '$.key') AND w.work_id IS NOT NULL)`),
    quizzesSharingWork: count(db, sharedWork("quiz_works", "quiz_id"))
  } : "migrated"]
]) {
  const path = process.env[envName];
  if (!path) {
    e2[name] = "no path";
    continue;
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    e2[name] = check(db);
  } finally {
    db.close();
  }
}
report.e2 = e2;
```

- [ ] **Step 2: Verify locally against the dev databases.** Run:

```bash
cd backend && ARENA_DB_PATH=data/dev/arena.sqlite TIERLISTS_DB_PATH=data/dev/tierlists.sqlite QUIZZES_DB_PATH=data/dev/quizzes.sqlite node scripts/works-check.mjs
```

Expected: an `e2` object with the three sections and numeric counts, and no SQL error. (`data/dev` exists once `scripts/dev-account.mjs` has seeded it. If it is missing, run the same command against a fresh `mktemp -d` directory after `node --import tsx scripts/dev-account.mjs`.)

- [ ] **Step 3: README.** In `backend/README.md`, under the "Works check" section, add:

```markdown
Before each E2b removal PR merges, read the `e2` section. Arena and tier lists need every `*WithoutWork` count at 0. Quizzes also need `quizzesSharingWork` at 0: a published question's prompt comes from its own book, so merging two books would put one book's text under the other's question. The other counts show what the pass will collapse. After a removal deploys, that module reads `migrated`.

Rolling back a removal means restoring that one game database to just before its deploy (see "Rolling back production to a point in time" under Backups). Older code cannot read the rebuilt tables.
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/works-check.mjs backend/README.md && git commit -m "Add the pre-removal section to the works check

The E2b removal rewrites stored game keys to works and drops entries
without one, so each removal PR waits for these counts on production.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 7 — Arena

### Task 2: The arena storage pass

**Files:**
- Create: `backend/src/modules/arena/adapters/sqlite/worksPass.ts`
- Create: `backend/src/modules/arena/adapters/sqlite/worksPass.test.ts`
- Modify: `backend/package.json` (`"test"` list)

**Interfaces:**
- Produces: `migrateArenaToWorks(db: DatabaseSync): void`. It is a no-op unless `tournament_slots` still has `book_key`. It is not wired into `applyArenaMigrations` until Task 3.

- [ ] **Step 1: Write the failing test** — `worksPass.test.ts`. It builds the E1 shape by hand, so it never depends on the schema file:

```ts
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrateArenaToWorks } from "./worksPass.js";

const E1_SCHEMA = `
  CREATE TABLE tournaments (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT, bracket_size INTEGER NOT NULL, round_duration_minutes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'seeding', current_round INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
  CREATE TABLE tournament_slots (tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, slot_index INTEGER NOT NULL, book_key TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, cover_url TEXT, work_id TEXT, PRIMARY KEY (tournament_id, slot_index));
  CREATE TABLE duels (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, round_number INTEGER NOT NULL, duel_index INTEGER NOT NULL,
    book_a_key TEXT NOT NULL, book_a_title TEXT NOT NULL, book_a_author TEXT NOT NULL, book_a_cover TEXT, book_a_work_id TEXT,
    book_b_key TEXT NOT NULL, book_b_title TEXT NOT NULL, book_b_author TEXT NOT NULL, book_b_cover TEXT, book_b_work_id TEXT,
    winner_key TEXT, winner_work_id TEXT, status TEXT NOT NULL DEFAULT 'active', opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, settled_at TEXT);
  CREATE TABLE votes (id TEXT PRIMARY KEY, duel_id TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE, voter_token TEXT NOT NULL, voter_user_id TEXT, book_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', UNIQUE (duel_id, voter_token));
  CREATE INDEX idx_votes_duel_book ON votes(duel_id, book_key);
`;

function e1Db() {
  const db = new DatabaseSync(":memory:");
  db.exec(E1_SCHEMA);
  db.exec(`
    INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status) VALUES ('t1', 'u1', 'T', 2, 60, 'active');
    INSERT INTO tournament_slots VALUES ('t1', 0, 'isbn:1', 'Dune', 'Herbert', NULL, 'w-dune'), ('t1', 1, 'ta:dune|herbert', 'Dune again', 'Herbert', NULL, 'w-dune');
    INSERT INTO duels VALUES ('d1', 't1', 1, 0, 'isbn:1', 'Dune', 'Herbert', NULL, 'w-dune', 'ta:dune|herbert', 'Dune again', 'Herbert', NULL, 'w-dune', 'ta:dune|herbert', 'w-dune', 'settled', 'x', 'y', 'z');
    INSERT INTO votes (id, duel_id, voter_token, book_key) VALUES ('v1', 'd1', 'a', 'isbn:1'), ('v2', 'd1', 'b', 'ta:dune|herbert'), ('v3', 'd1', 'c', 'ta:dune|herbert'), ('v4', 'd1', 'd', 'isbn:gone');
  `);
  return db;
}

const columnNames = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

test("the pass drops arena keys, keeps every slot, and moves votes and winners to sides", () => {
  const db = e1Db();
  migrateArenaToWorks(db);
  assert.deepEqual(columnNames(db, "tournament_slots"), ["tournament_id", "slot_index", "work_id", "title", "author", "cover_url"]);
  assert.equal(columnNames(db, "duels").some((c) => c.endsWith("_key") || c === "winner_work_id"), false);
  assert.deepEqual(db.prepare("SELECT slot_index, work_id, title FROM tournament_slots ORDER BY slot_index").all().map((r) => ({ ...r })), [
    { slot_index: 0, work_id: "w-dune", title: "Dune" },
    { slot_index: 1, work_id: "w-dune", title: "Dune again" }
  ]);
  assert.equal((db.prepare("SELECT winner_side FROM duels WHERE id = 'd1'").get() as { winner_side: string }).winner_side, "b");
  assert.deepEqual(db.prepare("SELECT side, COUNT(*) AS n FROM votes GROUP BY side ORDER BY side").all().map((r) => ({ ...r })), [{ side: "a", n: 1 }, { side: "b", n: 2 }]);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
  assert.equal((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
});

test("deleting a tournament after the pass still cascades to its duels and votes", () => {
  const db = e1Db();
  migrateArenaToWorks(db);
  db.prepare("DELETE FROM tournaments WHERE id = 't1'").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM votes").get() as { n: number }).n, 0);
});

test("a second run, and a fresh database, are no-ops", () => {
  const db = e1Db();
  migrateArenaToWorks(db);
  migrateArenaToWorks(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM votes").get() as { n: number }).n, 3);
  const fresh = new DatabaseSync(":memory:");
  migrateArenaToWorks(fresh);
  assert.equal((fresh.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 0);
});
```

Add `src/modules/arena/adapters/sqlite/worksPass.test.ts` to `backend/package.json`'s `"test"` list.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx tsx --test src/modules/arena/adapters/sqlite/worksPass.test.ts`
Expected: FAIL with `Cannot find module './worksPass.js'`.

- [ ] **Step 3: Implement** — `worksPass.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);

export function migrateArenaToWorks(db: DatabaseSync): void {
  if (!hasColumn(db, "tournament_slots", "book_key")) return;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (hasColumn(db, "tournament_slots", "book_key")) {
        db.exec(`
          CREATE TABLE tournament_slots_new (
            tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            slot_index INTEGER NOT NULL,
            work_id TEXT,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            cover_url TEXT,
            PRIMARY KEY (tournament_id, slot_index)
          );
          INSERT INTO tournament_slots_new (tournament_id, slot_index, work_id, title, author, cover_url)
            SELECT tournament_id, slot_index, work_id, title, author, cover_url FROM tournament_slots;
          DROP TABLE tournament_slots;
          ALTER TABLE tournament_slots_new RENAME TO tournament_slots;

          CREATE TABLE votes_new (
            id TEXT PRIMARY KEY,
            duel_id TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
            voter_token TEXT NOT NULL,
            voter_user_id TEXT,
            side TEXT NOT NULL CHECK (side IN ('a', 'b')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            UNIQUE (duel_id, voter_token)
          );
          INSERT INTO votes_new (id, duel_id, voter_token, voter_user_id, side, created_at)
            SELECT v.id, v.duel_id, v.voter_token, v.voter_user_id, CASE WHEN v.book_key = d.book_a_key THEN 'a' ELSE 'b' END, v.created_at
            FROM votes AS v JOIN duels AS d ON d.id = v.duel_id
            WHERE v.book_key IN (d.book_a_key, d.book_b_key);
          DROP TABLE votes;

          CREATE TABLE duels_new (
            id TEXT PRIMARY KEY,
            tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            round_number INTEGER NOT NULL,
            duel_index INTEGER NOT NULL,
            book_a_work_id TEXT,
            book_a_title TEXT NOT NULL,
            book_a_author TEXT NOT NULL,
            book_a_cover TEXT,
            book_b_work_id TEXT,
            book_b_title TEXT NOT NULL,
            book_b_author TEXT NOT NULL,
            book_b_cover TEXT,
            winner_side TEXT CHECK (winner_side IN ('a', 'b')),
            status TEXT NOT NULL DEFAULT 'active',
            opens_at TEXT NOT NULL,
            closes_at TEXT NOT NULL,
            settled_at TEXT
          );
          INSERT INTO duels_new (id, tournament_id, round_number, duel_index, book_a_work_id, book_a_title, book_a_author, book_a_cover,
              book_b_work_id, book_b_title, book_b_author, book_b_cover, winner_side, status, opens_at, closes_at, settled_at)
            SELECT id, tournament_id, round_number, duel_index, book_a_work_id, book_a_title, book_a_author, book_a_cover,
              book_b_work_id, book_b_title, book_b_author, book_b_cover,
              CASE WHEN winner_key = book_a_key THEN 'a' WHEN winner_key = book_b_key THEN 'b' END,
              status, opens_at, closes_at, settled_at
            FROM duels;
          DROP TABLE duels;
          ALTER TABLE duels_new RENAME TO duels;
          ALTER TABLE votes_new RENAME TO votes;
          PRAGMA user_version = 1;
        `);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  const broken = db.prepare("PRAGMA foreign_key_check").all();
  if (broken.length > 0) throw new Error(`arena works pass left ${broken.length} broken foreign keys`);
}
```

A side's key can appear on both sides only if a duel paired a book with itself, which E1's duplicate checks prevent. So `CASE WHEN … = book_a_key THEN 'a' ELSE 'b'` is unambiguous for every vote that matches a side.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/arena/adapters/sqlite/worksPass.test.ts && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/arena/adapters/sqlite/worksPass.ts backend/src/modules/arena/adapters/sqlite/worksPass.test.ts backend/package.json && git commit -m "Add the arena pass that moves stored keys to works

Rebuilds slots and duels without keys and turns each vote into the side
it was cast for, so a duel whose sides later share a work keeps its
tally. Foreign keys go off around the rebuild: dropping duels with them
on cascades and deletes every vote.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Arena speaks only works

**Files:**
- Modify: `backend/src/modules/arena/adapters/sqlite/connection.ts`, `schema.sql`, `sqliteArenaRepository.ts`
- Modify: `backend/src/modules/arena/domain/types.ts`, `domain/ports.ts`, `service.ts`, `wire.ts`, `routes.ts`, `plugin.ts`, `index.ts`
- Delete: `backend/src/modules/arena/worksSweep.ts`, `worksSweep.test.ts`
- Modify: `backend/src/app.ts` (the `rekeyBooks` hook list and `startWorksSweep` list)
- Modify: `backend/scripts/works-check.mjs` (the E1 `arena` section), `backend/scripts/test-arena-flow.mjs`, `backend/scripts/three-users.mjs` (arena calls)
- Test: `backend/src/modules/arena/{service,routes}.test.ts`, `adapters/sqlite/sqliteArenaRepository.test.ts`, `backend/package.json` (drop `src/modules/arena/worksSweep.test.ts`)

**Interfaces:**
- Consumes: `migrateArenaToWorks` (Task 2); `knownWorkIds`, `canonicalWorkIds`, `UnknownWorkError`, `WorkResolutionError` from `library/index.js`.
- Produces:
  - `SeedBookInput = { workId: string; title: string; author: string; cover: string | null }`
  - `TournamentSlotRow = { tournament_id; slot_index; work_id: string | null; title; author; cover_url }`
  - `DuelRow` without `*_key`/`winner_work_id`, with `winner_side: "a" | "b" | null`
  - `VoteRow.side: "a" | "b"` instead of `book_key`
  - repository `countVotesBySide(duelId): { a: number; b: number }`
  - repository `updateDuelSettlement(id, status, winnerSide: "a" | "b" | null, settledAt)`
  - service `vote(tournamentId, duelId, voterToken, workId: string, voterUserId?)`
  - service `tiebreak(tournamentId, ownerUserId, duelId, workId: string)`
  - service `setSlotsManual(tournamentId, ownerUserId, entries: Array<{ slotIndex: number; book: SeedBookInput }>)`
  - service `randomFill(tournamentId, ownerUserId, pool: SeedBookInput[])`
  - `SeedBookView = { workId: string | null; title; author; cover }`
  - `DuelView` with `winnerWorkId` and without `winnerKey`
  - the `wire.ts` exports `summariesForWire(summaries)` and `tournamentForWire(view)` (no `works` flag).

Rules:

1. **Connection.** In `applyArenaMigrations`, run the E1 `ALTER TABLE … ADD COLUMN work_id`/`book_*_work_id`/`winner_work_id` block only while `tournament_slots` still has `book_key`. Otherwise it would add `winner_work_id` back after the pass. Then call `migrateArenaToWorks(db)` immediately before `db.exec(schema)`. The `voter_user_id` ALTER and the duplicate-vote cleanup stay where they are (both run against the old `votes`).
2. **Schema.** `schema.sql` declares `tournament_slots`, `duels` and `votes` exactly as Task 2's `*_new` tables. Indexes:
   - `idx_tournament_slots_work ON tournament_slots(work_id)`;
   - `idx_duels_tournament_round`, `idx_duels_status_closes_at` (unchanged);
   - `idx_votes_duel_side ON votes(duel_id, side)` (replaces `idx_votes_duel_book`);
   - `idx_votes_voter_user`, `idx_votes_duel_user` (unchanged).
3. **Repository.** Every statement drops the key columns. `countVotesStmt` is `SELECT side, COUNT(*) AS n FROM votes WHERE duel_id = ? GROUP BY side`. The settlement statement is `UPDATE duels SET status = $status, winner_side = $winner_side, settled_at = $settled_at WHERE id = $id`. Remove `rekeyBooks` from the repository, the port and every fake.
4. **Service.**
   - `winnerBookFromDuel` picks side A or B by `winner_side`. `winnerFromDuels` and `summariesWithPreviews` test `winner_side !== null` instead of `winner_key`.
   - `settleDuelInternal` compares `votes.a` with `votes.b` and stores the winning side.
   - `toDuelView` derives `winnerWorkId` from the side and reads `votes` per side.
   - `sideOf(duel, workId)` replaces `sideKey`. It canonicalizes `[workId, book_a_work_id, book_b_work_id]` through the injected `canonicalWorks` and returns `'a'` when side A matches (A first), `'b'` when side B matches, else throws `InvalidBookError`.
   - `setSlotsManual` keeps its slot checks. A repeated `workId` throws `DuplicateBookError(book.title)`.
   - `randomFill` dedupes the pool by `workId` (first wins) before the `NotEnoughBooksError` check.
   - Drop `ResolveBookWorks`, `BookChoice` and every `key` field.
   - `seedingSlots` stays: routes use it as the ownership check before resolving work ids.
5. **Wire.** `wire.ts` keeps only the canonicalizing view functions: the `canonical` branch of `bookForWire`, `duelForWire` emitting `winnerWorkId` and `summaryForWire`. Delete the key branch, the `works` parameters and `keyedSeedBooks`.
6. **Routes.**
   - Delete `seedBookSchema`, `setSlotsSchema`, `randomFillSchema`, `voteSchema`, `tiebreakSchema`, every `worksFormat` call and every legacy `else` branch.
   - `PUT /arenas/:id/slots`:
     1. Parse `setWorkSlotsSchema`.
     2. Call `service.seedingSlots(id, user)`.
     3. Run `ids = knownWorkIds(books.map((b) => b.workId))`.
     4. If two ids are equal, throw `DuplicateBookError(title of the later one)`.
     5. Call `service.setSlotsManual` with `book.workId = ids[i]`.
   - `random-fill` does the same with `randomFillWorksSchema`.
   - Vote passes `body.workId`; tiebreak passes `body.winnerWorkId`.
   - Errors: `UnknownWorkError` gives 400, `WorkResolutionError` gives 503 and `ArenaError` gives its status, as in E2a.
   - GET routes send `summariesForWire(...)` / `tournamentForWire(...)`.
   - `buildArenaRoutes(service)` loses its `resolveWorks` parameter.
7. **Hooks and sweeps.** In `app.ts`, remove `rekeyArenaBooks` from the hook list and `sweepArenaWorks` from `startWorksSweep`. Delete `arena/worksSweep.ts` and its test, and drop both exports from `arena/index.ts` and the `rekeyBooks` wiring in `arena/plugin.ts`.
8. **Scripts.**
   - `works-check.mjs`'s E1 `arena` section: when `tournament_slots` has no `book_key`, report:
     - `slotsNull`: `work_id IS NULL`;
     - `duelSidesNull`: unchanged;
     - `winnersNull`: `winner_side IS NOT NULL AND CASE winner_side WHEN 'a' THEN book_a_work_id ELSE book_b_work_id END IS NULL`.
   - `test-arena-flow.mjs` and the arena calls in `three-users.mjs` send the works format:
     - read `works` from `GET /library`;
     - seed with `{ workId, title, author, cover }`;
     - vote with `{ voterToken, workId }`;
     - read sides by `workId`.

- [ ] **Step 1: Rewrite the tests first.**
  - `sqliteArenaRepository.test.ts`:
    - fixtures use `work_id`, sides and `winner_side`;
    - delete the E1-migration and `rekeyBooks` tests;
    - add "an E1-shaped arena database is migrated on open": build Task 2's `E1_SCHEMA` rows, call `applyArenaMigrations`, assert the votes per side survive and `idx_votes_duel_side` exists.
  - `service.test.ts`: seed with `{ workId, title, author, cover }` and vote by work. Keep Task 5 (E2a)'s merged-work and shared-work vote tests, adapted to `vote(…, workId)`.
  - `routes.test.ts`:
    - delete the header-less key tests (the PUT slots key echo, the legacy 409/503/404 tests, and the key half of "GET … speak works with the header and keys without it");
    - keep every works-format test and drop the header from those requests;
    - add "a request without the works header gets works too".

  Run `cd backend && npx tsx --test src/modules/arena/*.test.ts src/modules/arena/adapters/sqlite/*.test.ts` and see them fail.
- [ ] **Step 2: Apply rules 1–8**, then run `cd backend && npm run typecheck` until clean.
- [ ] **Step 3: Verify:** `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test && npm run test:fixture`. Expected: PASS. The fixture check exercises `three-users.mjs` against a scratch server.
- [ ] **Step 4: Commit**

```bash
git add backend && git commit -m "Store arena brackets as works and drop the key format

Slots and duels hold work ids, votes and winners hold a side, and every
arena route speaks works with or without the header. The arena works
sweep and rekey hook go: entries get their work when they are written.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 8 — Tier lists

### Task 4: The tier-list storage pass

**Files:**
- Create: `backend/src/modules/tierlists/adapters/sqlite/worksPass.ts`
- Create: `backend/src/modules/tierlists/adapters/sqlite/worksPass.test.ts`
- Modify: `backend/package.json` (`"test"` list)

**Interfaces:**
- Produces:
  - `rewriteBoard(dataJson: string, publicBooksJson: string | null, workByKey: Map<string, string>): { data: string; publicBooks: string | null }`, a pure function;
  - `migrateTierlistsToWorks(db: DatabaseSync): void`, a no-op unless `tierlist_works` still has `key`. It is not wired until Task 5.

- [ ] **Step 1: Write the failing tests** — `worksPass.test.ts`:

```ts
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrateTierlistsToWorks, rewriteBoard } from "./worksPass.js";

const works = new Map([["k1", "w1"], ["k2", "w1"], ["k3", "w3"]]);

test("rewriteBoard swaps keys for works, tiers before pool, first edition wins, orphans dropped", () => {
  const data = JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["k2"] }], pool: ["k1", "k3", "k-orphan"] });
  assert.deepEqual(JSON.parse(rewriteBoard(data, null, works).data), { tiers: [{ id: "s", label: "S", color: "#000000", workIds: ["w1"] }], pool: ["w3"] });
});

test("a snapshot is zipped with the old pool and follows the new one, else it is cleared", () => {
  const data = JSON.stringify({ tiers: [], pool: ["k1", "k2", "k3"] });
  const books = [{ title: "A" }, { title: "A again" }, { title: "C" }];
  const rewritten = rewriteBoard(data, JSON.stringify(books), works);
  assert.deepEqual(JSON.parse(rewritten.data).pool, ["w1", "w3"]);
  assert.deepEqual(JSON.parse(rewritten.publicBooks!), [{ title: "A", key: "k1", workId: "w1" }, { title: "C", key: "k3", workId: "w3" }]);
  assert.equal(rewriteBoard(data, JSON.stringify(books.slice(0, 2)), works).publicBooks, null);
  assert.equal(rewriteBoard(data, null, works).publicBooks, null);
});

function e1Db() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tierlists (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, origin_user_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, vote_access TEXT NOT NULL DEFAULT 'anonymous', voting_open INTEGER NOT NULL DEFAULT 0, source_tierlist_id TEXT, promoted_at TEXT, public_books TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE tierlist_ballots (id TEXT PRIMARY KEY, tierlist_id TEXT NOT NULL, voter_user_id TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE tierlist_ballot_placements (ballot_id TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE, tierlist_id TEXT NOT NULL, book_key TEXT NOT NULL, tier_id TEXT NOT NULL, work_id TEXT, PRIMARY KEY (ballot_id, book_key));
    CREATE TABLE tierlist_works (tierlist_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (tierlist_id, key));
    INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, vote_code, voting_open, public_books) VALUES
      ('t1', '__app__', 'u1', 'Promoted', '{"tiers":[{"id":"s","label":"S","color":"#000000","bookKeys":[]}],"pool":["k1","k2","k3"]}', 'code1', 0, '[{"title":"A"},{"title":"A again"},{"title":"C"}]');
    INSERT INTO tierlist_works VALUES ('t1', 'k1', 'w1'), ('t1', 'k2', 'w1'), ('t1', 'k3', 'w3');
    INSERT INTO tierlist_ballots (id, tierlist_id) VALUES ('b1', 't1');
    INSERT INTO tierlist_ballot_placements VALUES ('b1', 't1', 'k2', 's', 'w1'), ('b1', 't1', 'k1', 'a', 'w1'), ('b1', 't1', 'k3', 's', 'w3');
  `);
  return db;
}

test("the pass rewrites a promoted list, keeps each ballot's first placement per work, and rebuilds the side tables", () => {
  const db = e1Db();
  migrateTierlistsToWorks(db);
  const row = db.prepare("SELECT data, public_books FROM tierlists WHERE id = 't1'").get() as { data: string; public_books: string };
  assert.deepEqual(JSON.parse(row.data).pool, ["w1", "w3"]);
  assert.equal(JSON.parse(row.public_books).length, 2);
  assert.deepEqual(db.prepare("SELECT work_id, tier_id FROM tierlist_ballot_placements ORDER BY work_id").all().map((r) => ({ ...r })), [
    { work_id: "w1", tier_id: "s" },
    { work_id: "w3", tier_id: "s" }
  ]);
  assert.deepEqual(db.prepare("SELECT work_id FROM tierlist_works ORDER BY work_id").all().map((r) => ({ ...r })), [{ work_id: "w1" }, { work_id: "w3" }]);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
  migrateTierlistsToWorks(db);
  assert.deepEqual(JSON.parse((db.prepare("SELECT data FROM tierlists").get() as { data: string }).data).pool, ["w1", "w3"]);
});
```

Add the file to `backend/package.json`'s `"test"` list.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/worksPass.test.ts`
Expected: FAIL with `Cannot find module './worksPass.js'`.

- [ ] **Step 3: Implement** — `worksPass.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function rewriteBoard(dataJson: string, publicBooksJson: string | null, workByKey: Map<string, string>) {
  const doc = parse(dataJson);
  const board = isRecord(doc) ? doc : {};
  const seen = new Set<string>();
  const take = (keys: unknown) =>
    (Array.isArray(keys) ? keys : []).flatMap((key) => {
      const work = typeof key === "string" ? workByKey.get(key) : undefined;
      if (!work || seen.has(work)) return [];
      seen.add(work);
      return [work];
    });
  const tiers = (Array.isArray(board.tiers) ? board.tiers : []).filter(isRecord).map(({ bookKeys, ...tier }) => ({ ...tier, workIds: take(bookKeys) }));
  const oldPool = Array.isArray(board.pool) ? board.pool : [];
  const pool = take(oldPool);
  let publicBooks: string | null = null;
  const snapshot = publicBooksJson === null ? undefined : parse(publicBooksJson);
  if (Array.isArray(snapshot) && snapshot.length === oldPool.length) {
    const byWork = new Map<string, Record<string, unknown>>();
    snapshot.forEach((book, index) => {
      const key = oldPool[index];
      const work = typeof key === "string" ? workByKey.get(key) : undefined;
      if (work && isRecord(book) && !byWork.has(work)) byWork.set(work, { ...book, key, workId: work });
    });
    publicBooks = JSON.stringify(pool.flatMap((work) => (byWork.has(work) ? [byWork.get(work)!] : [])));
  }
  return { data: JSON.stringify({ ...board, tiers, pool }), publicBooks };
}

export function migrateTierlistsToWorks(db: DatabaseSync): void {
  if (!hasColumn(db, "tierlist_works", "key")) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasColumn(db, "tierlist_works", "key")) {
      const workByList = new Map<string, Map<string, string>>();
      for (const row of db.prepare("SELECT tierlist_id, key, work_id FROM tierlist_works WHERE work_id IS NOT NULL").all() as Array<{ tierlist_id: string; key: string; work_id: string }>) {
        if (!workByList.has(row.tierlist_id)) workByList.set(row.tierlist_id, new Map());
        workByList.get(row.tierlist_id)!.set(row.key, row.work_id);
      }
      const update = db.prepare("UPDATE tierlists SET data = ?, public_books = ? WHERE id = ?");
      for (const row of db.prepare("SELECT id, data, public_books FROM tierlists").all() as Array<{ id: string; data: string; public_books: string | null }>) {
        const rewritten = rewriteBoard(row.data, row.public_books, workByList.get(row.id) ?? new Map());
        update.run(rewritten.data, rewritten.publicBooks, row.id);
      }
      db.exec(`
        CREATE TABLE tierlist_ballot_placements_new (
          ballot_id TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE,
          tierlist_id TEXT NOT NULL,
          work_id TEXT NOT NULL,
          tier_id TEXT NOT NULL,
          PRIMARY KEY (ballot_id, work_id)
        );
        INSERT OR IGNORE INTO tierlist_ballot_placements_new (ballot_id, tierlist_id, work_id, tier_id)
          SELECT p.ballot_id, p.tierlist_id, COALESCE(p.work_id, w.work_id), p.tier_id
          FROM tierlist_ballot_placements AS p
          LEFT JOIN tierlist_works AS w ON w.tierlist_id = p.tierlist_id AND w.key = p.book_key
          WHERE COALESCE(p.work_id, w.work_id) IS NOT NULL
          ORDER BY p.rowid;
        DROP TABLE tierlist_ballot_placements;
        ALTER TABLE tierlist_ballot_placements_new RENAME TO tierlist_ballot_placements;
        CREATE TABLE tierlist_works_new (tierlist_id TEXT NOT NULL, work_id TEXT NOT NULL, PRIMARY KEY (tierlist_id, work_id));
        INSERT OR IGNORE INTO tierlist_works_new (tierlist_id, work_id) SELECT tierlist_id, work_id FROM tierlist_works WHERE work_id IS NOT NULL;
        DROP TABLE tierlist_works;
        ALTER TABLE tierlist_works_new RENAME TO tierlist_works;
        PRAGMA user_version = 1;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
```

Rebuilding `tierlist_ballot_placements`, a child table, is safe with foreign keys on: no table references it.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/worksPass.test.ts && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists/adapters/sqlite backend/package.json && git commit -m "Add the tier-list pass that moves stored keys to works

Boards, frozen snapshots and ballot placements move to work ids. A
snapshot is zipped with the old pool before entries drop, and cleared
when the lengths never lined up, so the board falls back to a live read.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Public books by work

**Files:**
- Modify: `backend/src/modules/library/publicResolver.ts`, `backend/src/modules/library/index.ts`
- Test: `backend/src/modules/library/publicViews.test.ts`

**Interfaces:**
- Consumes: `copyKeysForWorks`, `canonicalWorkIds` (`library/works.ts`).
- Produces: `resolvePublicBooksByWork(ownerUserId: string, workIds: string[]): Map<string, PublicBookData>`. It is keyed by each requested id as given, and holds only the works the owner has a copy of. Each value is that copy's public book, whose own `workId` is canonical.

- [ ] **Step 1: Write the failing test** — in `publicViews.test.ts`. It uses the file's `service` and `openBooksDb`, and the `resolveWorks` import from E2a's Task 3:

```ts
test("public books resolve by work through the owner's first copy, and follow a merge", () => {
  const userId = "by-work";
  service.saveLibrary(userId, { books: [{ Title: "Kindred", Attribution: "Octavia Butler", ReadStatus: 1 }] });
  const rows = openLibraryDb().prepare("SELECT book_key, work_id FROM library_books WHERE user_id = ? ORDER BY position").all(userId) as Array<{ book_key: string; work_id: string }>;
  const books = resolvePublicBooksByWork(userId, [rows[0]!.work_id, "not-a-work"]);
  assert.deepEqual([...books.keys()], [rows[0]!.work_id]);
  assert.equal(books.get(rows[0]!.work_id)!.key, rows[0]!.book_key);
  const [target] = resolveWorks([{ isbn: null, title: "A Separate Merge Target", author: "Someone Else" }]);
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target!, rows[0]!.work_id);
  assert.equal(resolvePublicBooksByWork(userId, [rows[0]!.work_id]).get(rows[0]!.work_id)!.workId, target);
});
```

- [ ] **Step 2: Run to verify it fails:** `cd backend && npx tsx --test src/modules/library/publicViews.test.ts`. Expected: FAIL, `resolvePublicBooksByWork` is not exported.

- [ ] **Step 3: Implement** — in `publicResolver.ts`, importing `copyKeysForWorks` from `./works.js` next to `canonicalWorkIds`:

```ts
export function resolvePublicBooksByWork(ownerUserId: string, workIds: string[]): Map<string, PublicBookData> {
  const canonical = canonicalWorkIds(workIds);
  const keys = copyKeysForWorks(ownerUserId, [...new Set(canonical.values())]);
  const books = resolvePublicLibraryData(ownerUserId, { bookKeys: [...new Set(keys.values())], highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] }).books;
  const byKey = new Map(books.map((book) => [book.key, book]));
  const result = new Map<string, PublicBookData>();
  for (const id of workIds) {
    const key = keys.get(canonical.get(id) ?? "");
    const book = key === undefined ? undefined : byKey.get(key);
    if (book) result.set(id, book);
  }
  return result;
}
```

Export it from `library/index.ts`. (If `resolvePublicLibraryData` rejects a request missing an optional field the type marks required, pass the same fields `tierlists/routes.ts` passes today.)

- [ ] **Step 4: Verify:** `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library && git commit -m "Resolve public books by work

Tier lists, their snapshots, mural tier-list blocks and quiz covers are
about to store work ids, while public book data is still read from the
owner's library copies; the owner's first copy of each work stands in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Tier lists speak only works

**Files:**
- Modify: `backend/src/modules/tierlists/adapters/sqlite/connection.ts`, `schema.sql`, `sqliteTierlistsRepository.ts`
- Modify: `backend/src/modules/tierlists/domain/types.ts`, `domain/ports.ts`, `domain/boardKeys.ts`, `service.ts`, `wire.ts`, `routes.ts`, `plugin.ts`, `index.ts`
- Delete: `backend/src/modules/tierlists/worksSweep.ts`, `worksSweep.test.ts`
- Modify: `backend/src/modules/murals/domain/publicPayload.ts`, `backend/src/modules/murals/routes.ts`, `backend/src/modules/community/routes.ts`, `backend/src/app.ts`
- Modify: `backend/scripts/works-check.mjs` (E1 `tierlists` loop entry), `backend/scripts/three-users.mjs` (tier-list calls)
- Test: `backend/src/modules/tierlists/{routes,service,wire}.test.ts`, `adapters/sqlite/sqliteTierlistsRepository.test.ts`, `backend/src/modules/murals/home.test.ts`, `backend/package.json` (drop `src/modules/tierlists/worksSweep.test.ts`)

**Interfaces:**
- Consumes:
  - `migrateTierlistsToWorks` (Task 4) and `resolvePublicBooksByWork` (Task 5);
  - `knownWorkIds`, `canonicalByKey`, `firstKeyPerWork`, `duplicateWorkMessage`, `UnknownWorkError`, `WorkResolutionError`;
  - `sendWorksError` (`backend/src/worksFormat.ts`).
- Produces:
  - stored and returned `data` is `{ tiers: Array<{ id; label; color; workIds: string[] }>; pool: string[] }`;
  - `Placement = { workId: string; tierId: string }` and `HistogramCell = { workId: string; tierId: string; votes: number }`;
  - `TierlistData.tiers[].workIds`, whose ids `getTierlistData` returns canonical;
  - repository `setWorks(tierlistId, workIds: string[])`, derived from `data` by `insert`/`update`/`publish`;
  - `tierlists/wire.ts` exports `canonicalBoard(data: unknown): { tiers; pool }` (first canonical work wins, tiers before pool, other tier fields kept) and `canonicalFirst(storedIds: string[]): { canonical: Map<string, string>; first: Set<string> }`;
  - `tierlistsForWire` is deleted.

Rules:

1. **Connection and schema.**
   - In `applyTierlistsMigrations`'s existing-database branch, call `migrateTierlistsToWorks(db)` just before the final `db.exec(schema)`.
   - Delete the E1 `ALTER TABLE tierlist_ballot_placements ADD COLUMN work_id` block. After the pass the column is part of the table, and a pre-E1 database no longer exists anywhere.
   - `schema.sql` declares `tierlist_ballot_placements` and `tierlist_works` as Task 4's `*_new` tables.
   - Indexes: `idx_tierlist_placements_histogram ON tierlist_ballot_placements(tierlist_id, work_id, tier_id)` and `idx_tierlist_works_work ON tierlist_works(work_id)`. Delete `idx_tierlist_placements_work`.
2. **Domain and repository.**
   - Rename `bookKeys` to `workIds` and `Placement.bookKey`/`HistogramCell.bookKey` to `workId` everywhere in the module.
   - `boardKeys(data)` becomes `boardWorks(data)`, reading `tiers[].workIds` and `pool`.
   - Placement and histogram statements use `work_id`. `insertPlacementStmt` no longer joins `tierlist_works`.
   - `insert`, `update` and `publish` replace the list's `tierlist_works` rows with `boardWorks(data)` (`DELETE` then `INSERT OR IGNORE`). The `works` maps disappear from the port and the service.
   - Remove `storedWorks` and `rekeyBooks` from the repository, port, service and fakes. Remove the `rekeyTierBoard` import.
3. **Wire.** `wire.ts` keeps E2a's logic with the stored work id in the role the key used to play:
   - `canonicalBoard` is `boardToWorks` over `workIds`, with the map from `canonicalByKey(new Map(ids.map((id) => [id, id])))`.
   - `canonicalFirst(ids)` returns that canonical map plus `firstKeyPerWork(ids, canonical)`'s values as the `first` set.
   - `histogramToWorks`/`placementsToWorks` take `HistogramCell`/`Placement` with `workId`. They keep only cells and placements whose stored id is in `first`, and emit the canonical id.
   - `placementsFromWorks(sent, ids, storedByCanonical)` maps each sent canonical id to the board's stored id (`firstKeyPerWork(pool, canonical)` inverted), and returns null for one not on the board.
   - `boardBooks(pool, snapshot, live)`:
     - snapshot entries are matched by their canonicalized `workId`;
     - it falls back to `live()` when `snapshot` is null;
     - `live` is `resolvePublicBooksByWork(owner, pool)` in pool order.
   - Delete `boardKeysInOrder`, `keyedBoard`, `tierlistToWorks` and the key-snapshot zip.
4. **Routes.**
   - Delete `createTierlistSchema`, `updateTierlistSchema`, `placementsSchema`, `resolveBoard`, `withWorks`, every `worksFormat` call and every legacy branch.
   - Create and PUT:
     1. Parse the works schemas.
     2. A repeated id gives 400 "Duplicate tier or book.".
     3. Run `ids = knownWorkIds(all)`.
     4. A repeated canonical id gives 409 `duplicateWorkMessage({ workId: null, title: null })`.
     5. Store the canonical ids.
     6. Create with `access` builds `publicBooks` from `resolvePublicBooksByWork(user, pool)` in pool order. It keeps the 400 "A selected book is no longer in your library." when a work has no copy.
   - Open-voting builds its snapshot the same way, still without a length guard.
   - Owner reads, the voting toggle and results answer `canonicalBoard`.
   - The voting board answers `canonicalBoard(…).pool`, histograms through `canonicalFirst`, and `books: boardBooks(…)`.
   - Ballots map placements through `placementsFromWorks`. Unknown work or not on the board gives 400 "Those placements don't match this tier list.".
   - `buildTierlistRoutes(service)` loses its `resolveWorks` parameter.
5. **Murals and profiles.**
   - `getTierlistData` (`service.ts`'s `createTierlistsPublicApi`) returns `{ name, ...canonicalBoard(data) }`.
   - `murals/domain/publicPayload.ts` stops adding tier-list entries to `bookKeys`. It resolves them with `resolvePublicBooksByWork(row.user_id, ids)` and appends those books to `libraryData.books`, skipping any whose `key` is already there.
   - `murals/routes.ts` and `community/routes.ts` drop `worksFormat` and `tierlistsForWire` and send the payload as it is.
   - Delete `tierlistsForWire` and `wireRepo` from `plugin.ts` and the export from `index.ts`.
6. **Hooks and sweeps.** In `app.ts`, remove `rekeyTierlistsBooks` and `sweepTierlistsWorks`. Delete `tierlists/worksSweep.ts`, its test and both exports.
7. **Scripts.**
   - In `works-check.mjs`'s E1 loop, the `tierlists` entry reports, once `tierlist_works` has no `key`:
     - `itemsWithoutRows`, counting lists with a non-empty board only: `json_array_length(data, '$.pool') > 0`;
     - `rowsNull: 0`;
     - `placementsNull: 0`.
   - `three-users.mjs` creates tier lists and ballots in the works format (`tiers[].workIds`, `pool`, placements `{ workId, tierId }`), taking work ids from `GET /library`'s `works`.

- [ ] **Step 1: Rewrite the tests first.**
  - `wire.test.ts` covers `canonicalBoard`, `canonicalFirst`, `histogramToWorks`, `placementsFromWorks` and `boardBooks`, all over stored work ids, including one stored id merged into another (`canonicalByKey` takes the catalog stub as E2a's tests did).
  - `sqliteTierlistsRepository.test.ts`:
    - fixtures use work ids;
    - delete the rekey and E1-migration tests;
    - add "an E1-shaped tier-list database is migrated on open" (Task 4's fixture through `applyTierlistsMigrations`).
  - `routes.test.ts`:
    - delete the header-less key tests and the key halves of mixed tests;
    - keep every works test without the header;
    - add "a ballot naming a work that was merged after the list was written lands on the stored entry": write the list, merge its stored work into a new one through `openBooksDb`, then post a ballot with the canonical id and expect 200 and a histogram cell for it;
    - add "a published list with a cleared snapshot shows its books from the library": set `public_books = NULL` on the row, then fetch the voting board.
  - `home.test.ts`: the shared mural's tier-list block resolves its books (`books` contains the tier-list work's book) with and without the header.

  Run the tier-list and mural tests and see them fail.
- [ ] **Step 2: Apply rules 1–7**, then run `cd backend && npm run typecheck` until clean.
- [ ] **Step 3: Verify:** `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test && npm run test:fixture`. Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add backend && git commit -m "Store tier lists as works and drop the key format

Boards, ballots and snapshots hold work ids; reads canonicalize them, so
a later catalog merge still shows one entry and still takes votes. Mural
tier-list blocks resolve their books by work. The tier-list works sweep
and rekey hook go.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 9 — Quizzes and cleanup

### Task 7: The quiz storage pass

**Files:**
- Create: `backend/src/modules/quizzes/adapters/sqlite/worksPass.ts`, `worksPass.test.ts`
- Modify: `backend/package.json` (`"test"` list)

**Interfaces:**
- Produces:
  - `rewriteQuiz(dataJson: string, workByKey: Map<string, string>): string`, a pure function;
  - `migrateQuizzesToWorks(db: DatabaseSync): void`, a no-op unless `quiz_works` still has `key`. It is not wired until Task 8.

- [ ] **Step 1: Write the failing tests:**

```ts
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrateQuizzesToWorks, rewriteQuiz } from "./worksPass.js";

const works = new Map([["k1", "w1"], ["k2", "w2"], ["k3", "w1"]]);
const book = (key: string, title: string) => ({ key, title, author: "A", coverUrl: null, quote: null, blurb: null });

test("rewriteQuiz moves books and questions to works, first book per work, orphans dropped", () => {
  const data = JSON.stringify({ sourceLabel: "Shelf", questionCount: 4, allowedTypes: ["cover_title"], books: [book("k1", "One"), book("k2", "Two"), book("k3", "One again"), book("k-orphan", "Gone")], questions: [{ id: "q0", type: "cover_title", bookKey: "k2", options: ["a"], answerIndex: 0 }, { id: "q1", type: "cover_title", bookKey: "k-orphan", options: ["b"], answerIndex: 0 }] });
  const rewritten = JSON.parse(rewriteQuiz(data, works));
  assert.deepEqual(rewritten.books.map((b: { workId: string; title: string }) => [b.workId, b.title]), [["w1", "One"], ["w2", "Two"]]);
  assert.equal("key" in rewritten.books[0], false);
  assert.deepEqual(rewritten.questions.map((q: { workId: string | null }) => q.workId), ["w2", null]);
  assert.equal(rewritten.sourceLabel, "Shelf");
});

test("the pass rewrites stored quizzes and rebuilds quiz_works, once", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE quizzes (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, play_open INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE quiz_works (quiz_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (quiz_id, key));
  `);
  db.prepare("INSERT INTO quizzes (id, owner_user_id, name, data) VALUES ('q', 'u', 'Q', ?)").run(JSON.stringify({ books: [book("k1", "One"), book("k2", "Two")], questions: null }));
  db.exec("INSERT INTO quiz_works VALUES ('q', 'k1', 'w1'), ('q', 'k2', 'w2')");
  migrateQuizzesToWorks(db);
  migrateQuizzesToWorks(db);
  assert.deepEqual(JSON.parse((db.prepare("SELECT data FROM quizzes").get() as { data: string }).data).books.map((b: { workId: string }) => b.workId), ["w1", "w2"]);
  assert.deepEqual(db.prepare("SELECT quiz_id, work_id FROM quiz_works ORDER BY work_id").all().map((r) => ({ ...r })), [{ quiz_id: "q", work_id: "w1" }, { quiz_id: "q", work_id: "w2" }]);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
});
```

Add the file to `backend/package.json`'s `"test"` list.

- [ ] **Step 2: Run to verify it fails.** Run `cd backend && npx tsx --test src/modules/quizzes/adapters/sqlite/worksPass.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `worksPass.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function rewriteQuiz(dataJson: string, workByKey: Map<string, string>): string {
  let doc: unknown;
  try {
    doc = JSON.parse(dataJson);
  } catch (error) {
    if (error instanceof SyntaxError) return dataJson;
    throw error;
  }
  if (!isRecord(doc)) return dataJson;
  const seen = new Set<string>();
  const books = (Array.isArray(doc.books) ? doc.books : []).filter(isRecord).flatMap(({ key, ...book }) => {
    const workId = typeof key === "string" ? workByKey.get(key) : undefined;
    if (!workId || seen.has(workId)) return [];
    seen.add(workId);
    return [{ workId, ...book }];
  });
  const questions = Array.isArray(doc.questions)
    ? doc.questions.filter(isRecord).map(({ bookKey, ...question }) => ({ id: question.id, type: question.type, workId: (typeof bookKey === "string" ? workByKey.get(bookKey) : undefined) ?? null, options: question.options, answerIndex: question.answerIndex }))
    : doc.questions;
  return JSON.stringify({ ...doc, books, questions });
}

export function migrateQuizzesToWorks(db: DatabaseSync): void {
  if (!hasColumn(db, "quiz_works", "key")) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasColumn(db, "quiz_works", "key")) {
      const workByQuiz = new Map<string, Map<string, string>>();
      for (const row of db.prepare("SELECT quiz_id, key, work_id FROM quiz_works WHERE work_id IS NOT NULL").all() as Array<{ quiz_id: string; key: string; work_id: string }>) {
        if (!workByQuiz.has(row.quiz_id)) workByQuiz.set(row.quiz_id, new Map());
        workByQuiz.get(row.quiz_id)!.set(row.key, row.work_id);
      }
      const update = db.prepare("UPDATE quizzes SET data = ? WHERE id = ?");
      for (const row of db.prepare("SELECT id, data FROM quizzes").all() as Array<{ id: string; data: string }>) {
        update.run(rewriteQuiz(row.data, workByQuiz.get(row.id) ?? new Map()), row.id);
      }
      db.exec(`
        CREATE TABLE quiz_works_new (quiz_id TEXT NOT NULL, work_id TEXT NOT NULL, PRIMARY KEY (quiz_id, work_id));
        INSERT OR IGNORE INTO quiz_works_new (quiz_id, work_id) SELECT quiz_id, work_id FROM quiz_works WHERE work_id IS NOT NULL;
        DROP TABLE quiz_works;
        ALTER TABLE quiz_works_new RENAME TO quiz_works;
        PRAGMA user_version = 1;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
```

- [ ] **Step 4: Verify:** `cd backend && npx tsx --test src/modules/quizzes/adapters/sqlite/worksPass.test.ts && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/quizzes/adapters/sqlite backend/package.json && git commit -m "Add the quiz pass that moves stored keys to works

Quiz books and published questions move to work ids through quiz_works;
quiz_play_answers is keyed by question id and needs nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Quizzes speak only works

**Files:**
- Modify: `backend/src/modules/quizzes/adapters/sqlite/connection.ts`, `schema.sql`, `sqliteQuizzesRepository.ts`
- Modify: `backend/src/modules/quizzes/domain/types.ts`, `domain/ports.ts`, `service.ts`, `wire.ts`, `routes.ts`, `plugin.ts`, `index.ts`
- Delete: `backend/src/modules/quizzes/worksSweep.ts`, `worksSweep.test.ts`
- Modify: `backend/src/app.ts`, `backend/scripts/works-check.mjs` (E1 `quizzes` loop entry), `backend/scripts/test-quiz-flow.mjs`, `backend/scripts/three-users.mjs` (quiz calls, if any)
- Test: `backend/src/modules/quizzes/{routes,service}.test.ts`, `adapters/sqlite/sqliteQuizzesRepository.test.ts`, `backend/package.json` (drop `src/modules/quizzes/worksSweep.test.ts`)

**Interfaces:**
- Consumes:
  - `migrateQuizzesToWorks` (Task 7) and `resolvePublicBooksByWork` (Task 5);
  - `knownWorkIds`, `resolveTitleWorks`, `canonicalWorkIds`, `duplicateWorkMessage`;
  - `sendWorksError`.
- Produces:
  - stored and returned books are `QuizBook` (`{ workId, …content }`) and published questions are `QuizQuestion` (`{ id, type, workId: string | null, options, answerIndex }`), both from `@scripta/shared`;
  - `StoredQuizBook`/`StoredQuizQuestion` are deleted;
  - service `publishQuiz(userId, id, resolvedBooks: Array<{ workId: string; coverUrl: string | null }>)`;
  - repository `setWorks(quizId, workIds: string[])`, derived from `data.books` on insert and update;
  - `quizzes/wire.ts` exports `quizToWorks(quiz)`: canonical ids, first book per canonical work, and question `workId`s canonical.

Rules:

1. **Connection and schema.**
   - `applyQuizzesMigrations` calls `migrateQuizzesToWorks(db)` before `db.exec(schema)`.
   - `schema.sql` declares `quiz_works (quiz_id TEXT NOT NULL, work_id TEXT NOT NULL, PRIMARY KEY (quiz_id, work_id))` with `idx_quiz_works_work ON quiz_works(work_id)`.
2. **Domain, repository and service.**
   - Use the shared `QuizBook`/`QuizQuestion`.
   - `publishQuiz` fills covers by `workId` and stores `question.book.workId`.
   - `toPublicQuestion` looks books up by `workId`.
   - Remove `storedWorks` and `rekeyBooks` from the repository, port and fakes. The repository writes `quiz_works` from the stored books' `workId`s.
3. **Routes.**
   - Delete `createQuizSchema`/`updateQuizSchema` and the legacy branches, `resolveBooks`, `withWorks`'s `works` flag and every `worksFormat` call.
   - Define the works schemas without deriving from the deleted ones: a book is `{ workId?: string (1–200 chars), title, author, coverUrl, quote, blurb }` with the same limits `quizBookSchema` has today.
   - Create keeps E2a's create rules: 400 for an unresolvable title, first book per work. PUT keeps E2a's PUT rules: 404 before resolving, 400 unresolvable, 409 duplicate.
   - Both store the canonical `workId` on each book.
   - Publish resolves missing covers with `resolvePublicBooksByWork(user, ids)` and passes `{ workId, coverUrl }` per book.
   - Reads answer `quizToWorks`.
4. **Hooks and sweeps.** In `app.ts`, remove `rekeyQuizzesBooks` and `sweepQuizzesWorks`. The `rekeyBooks` hook loop becomes `rekeyMuralsBooks` alone, and `startWorksSweep` keeps the library and mural steps. Delete `quizzes/worksSweep.ts`, its test and both exports.
5. **Scripts.**
   - The E1 `quizzes` loop entry reports, once `quiz_works` has no `key`:
     - `itemsWithoutRows`, counting quizzes with at least one book: `json_array_length(data, '$.books') > 0`;
     - `rowsNull: 0`.
   - `test-quiz-flow.mjs` sends books with `workId` (from `GET /library`'s `works`) or title-only pool books.

- [ ] **Step 1: Rewrite the tests first.**
  - Repository fixtures use `workId`. Delete the rekey test. Add "an E1-shaped quiz database is migrated on open".
  - `routes.test.ts`:
    - delete the header-less key tests and the key halves of mixed ones;
    - keep the works tests without the header;
    - add "a published question whose book's work was merged answers the canonical work": publish a quiz, merge one book's stored work through `openBooksDb`, then `GET /quizzes/:id` shows that question's `workId` as the merge target.

  Run the quiz tests and see them fail.
- [ ] **Step 2: Apply rules 1–5**, then run `cd backend && npm run typecheck` until clean.
- [ ] **Step 3: Verify:** `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test && npm run test:fixture`. Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add backend && git commit -m "Store quizzes as works and drop the key format

Quiz books and questions hold work ids; reads canonicalize them. The
quiz works sweep and rekey hook go, which leaves murals as the only
user of the library rekey hook.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Delete the leftover translation helpers

**Files:**
- Modify: `backend/src/modules/library/works.ts`, `backend/src/modules/library/index.ts`, `backend/src/modules/library/works.test.ts`

Rules: delete every export of `library/works.ts` that no non-test file imports any more. Expected candidates are `keysForWorks`, `keepFirstPerWork` and `firstDuplicateWork`. Check each with `rg -n "<name>" backend/src --glob '!*.test.ts'` before deleting it. Then delete its tests and its `index.ts` export. Keep `resolveEntryWorks`, `workIdsByKey`, `canonicalWorkIds`, `canonicalByKey`, `firstKeyPerWork`, `knownWorkIds`, `resolveTitleWorks`, `copyKeysForWorks` and `duplicateWorkMessage` if anything still imports them. Today murals, the rekey hook and the game wire files do.

- [ ] **Step 1:** Run the `rg` check for every export of `library/works.ts` and list the unused ones in the commit body.
- [ ] **Step 2:** Delete them, their tests and their exports.
- [ ] **Step 3: Verify:** `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`. Expected: PASS.
- [ ] **Step 4: Commit** with the message `Delete the work helpers only the game translators used`, the unused-export list in the body, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 10: Drop the works header

**Files:**
- Delete: `backend/src/worksFormat.test.ts`
- Rename: `backend/src/worksFormat.ts` → `backend/src/worksErrors.ts`. It keeps only `sendWorksError`; update its importers.
- Modify: `backend/package.json` (drop `src/worksFormat.test.ts`; add `src/worksErrors.test.ts` if you move the 503 test there)
- Modify: `backend/src/app.ts` (keep the `WorkResolutionError` → 503 handler and CORS `maxAge`)
- Modify: `frontend/src/api/client.ts` (remove `headers.set("X-Scripta-Works", "1")`), `mobile/src/core/apiClient.ts` (remove `headers["X-Scripta-Works"] = "1"`), `mobile/src/core/apiClient.test.ts` (delete the header assertions and the "every request asks for the works format" test)
- Modify: `backend/README.md`. Replace the "Works format (phase E2)" section with one paragraph:

```markdown
### Works in the games (phase E2)

Arena, tier lists and quizzes store work ids. Clients send and receive `workId`, `workIds` and `winnerWorkId`, and every returned id is canonical, because reads follow catalog merges made after a write. Library documents carry `works` (book key → canonical work id), and public books carry `key` and `workId`. Murals still hold library copy keys. Spec: `docs/superpowers/specs/2026-10-05-works-phase-e2-design.md`.
```

- [ ] **Step 1:** Move `worksFormat.test.ts`'s CORS preflight and 503 test into `src/worksErrors.test.ts` with the same preamble, dropping its `x-scripta-works` header and its two `worksFormat` tests. Register the file in `backend/package.json`.
- [ ] **Step 2:** Apply the file changes above, then confirm with `rg -n "X-Scripta-Works|x-scripta-works|worksFormat|legacy client" backend/src frontend/src mobile/src`. Expected: no matches.
- [ ] **Step 3: Verify.** Run: `npm run build --workspace @scripta/shared && cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test && cd ../frontend && npm run typecheck && npm run lint && npm test && cd ../mobile && EXPO_PUBLIC_API_URL=http://localhost npm run typecheck && EXPO_PUBLIC_API_URL=http://localhost npm test`. Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add backend frontend mobile && git commit -m "Drop the works header

Every game route speaks works now, so the opt-in header and the
legacy-client log have nothing left to switch. The client change is JS
only and ships over the air.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Execution notes

- **Order and base.** Each PR is cut from `origin/main` after the previous one merges: PR 6 (Task 1), PR 7 (Tasks 2–3), PR 8 (Tasks 4–6), PR 9 (Tasks 7–10). Three background sessions started on 2026-10-06 touch the same files (library save stripping, read-before-write in tier-list and quiz routes, dev covers). Bring each branch up to date with `main` before its PR.
- **Before merging PR 7, 8 or 9.** All three checks below must hold:
  - The user has run the works check on production and sent the `e2` section. The module's `*WithoutWork` counts must be 0, and for quizzes `quizzesSharingWork` too. Command:

```bash
railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/works-check.mjs'
```

  - `deploy-ops` (read-only) confirms Litestream is replicating that module's database. Note the deploy time; it is the restore point if the PR has to be undone.
  - Both users' phones run the latest OTA update, and web tabs are refreshed. After a removal, an old build's key-format game requests get 400.
- **After each removal deploys.** The user re-runs the works check. That module's `e2` entry reads `migrated`, and its E1 entry reports zero nulls.
- **Rollback.** Revert the PR, and restore that one game database with Litestream to just before the deploy. Older code cannot read the rebuilt tables.
- **Mobile.** Only Task 10 touches mobile, and it removes one header line, so it ships as an OTA update on merge.
