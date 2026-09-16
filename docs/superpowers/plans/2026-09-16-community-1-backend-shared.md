# Community Backend + Shared Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `community` backend module (follows, opt-in published profiles, publish-event store, feed/discover/people API) and the `@scripta/shared/community` entry point, with tierlists/arena emitting publish events at their two existing publish moments.

**Architecture:** One new module per the repo's module pattern (own SQLite file, plugin → routes → service → domain → adapters). Cross-module reads are injected from `app.ts` as plain functions/options — the same wiring direction `muralsPlugin` already receives `getTierlistData`. The feed joins a small `events` table to content summaries at read time; rows whose content or actor vanished are dropped, never 500. Murals gains a public-API layer (payload assembly extracted from the shared-token route so the profile page reuses it); auth's `publicProfile.ts` gains the four small lookups community needs.

**Tech Stack:** Fastify 5, `@fastify/rate-limit`, `node:sqlite` (`DatabaseSync`), zod, TypeScript (strict, ESM `.js` specifiers), `@scripta/shared` workspace package, `node:test` + `tsx` for tests.

**Spec:** `docs/superpowers/specs/2026-09-16-community-design.md` — read it first; this plan argues from it.

## Global Constraints

- Root `AGENTS.md`: minimum code that works; no speculative options; **no comments in new code** — the non-obvious *why* goes in the commit message. (Existing repo files carry legacy comments; don't add new ones, don't delete unrelated ones.)
- One module per domain under `backend/src/modules/<domain>/`; routes, service, adapters stay inside it. Cross-module reads only via injected functions — never import another module's internals.
- `node:sqlite` prepared statements are created once at repository creation; named params are passed to `.run()`/`.get()` with **`$`-prefixed keys** (repo convention, see `sqliteArenaRepository.ts`).
- No cross-module foreign keys. User ids are opaque strings trusted because auth verified the JWT.
- **Any new `*.test.ts` file must be appended to backend `npm test`'s explicit file list** (`backend/package.json` `test` script) or CI will not run it.
- Never weaken auth, validation, or error handling to make a test pass.
- Run `npm run build --workspace @scripta/shared` before any consumer's typecheck/test (consumers read `dist/`).
- ESM: relative imports in backend/shared TS use `.js` extensions.
- Public, unauthenticated routes get a module-scoped rate limit (30/min) and `Cache-Control: no-store`, matching the murals share route.

## Deviations from the spec (deliberate, small)

1. **Feed cursor is a URL-safe `createdAt~id` string, not base64.** `Buffer` is Node-only and `@scripta/shared` must stay platform-neutral (no Node APIs — `packages/AGENTS.md`).
2. **Discover paginates by `limit`/`offset` with a `nextOffset`, not a cursor.** It merges the two existing public lists, both offset-paginated; the feed (the unbounded surface) keeps the spec's keyset cursor.
3. **Murals' public payload lives in `murals/publicApi.ts` + `murals/domain/publicPayload.ts`, not on `MuralsService`.** Keeps the `resolvePublicLibraryData` import chain out of `service.ts`, so existing murals unit tests don't start hitting the library resolver.
4. **Emission is injected as a narrow `emitPublished(copyId | tournamentId, ownerUserId)` per module**, with the 4-arg adapter living in `app.ts` — tierlists/arena never learn community's full event vocabulary.

## File Structure

```
packages/shared/src/community/
  types.ts                  # DTOs (CommunityAuthor, FeedItem, DiscoverItem, Page, …)
  cursor.ts                 # encodeCursor/decodeCursor keyset helper
  index.ts                  # barrel
backend/src/config/env.ts                      # + COMMUNITY_DB_PATH (modify)
backend/.env.example                           # + COMMUNITY_DB_PATH (modify)
backend/src/modules/community/
  domain/types.ts          # FollowRow, ProfileRow, EventRow
  domain/ports.ts          # CommunityRepository
  domain/errors.ts         # CommunityError hierarchy
  adapters/sqlite/connection.ts
  adapters/sqlite/schema.sql
  adapters/sqlite/sqliteCommunityRepository.ts
  adapters/sqlite/sqliteCommunityRepository.test.ts
  service.ts               # CommunityService + createCommunityService
  service.test.ts          # in-memory fake, service-level tests
  routes.ts                # buildCommunityRoutes (authed) + buildPublicCommunityRoutes
  routes.test.ts           # public scope via fastify inject
  plugin.ts                # communityPlugin + getCommunityPublicApi
  index.ts                 # registerCommunityModule export
backend/src/modules/tierlists/                 # (modify) repo methods, refs, emit, plugin opts
backend/src/modules/arena/                     # (modify) getPublicSummary, refs, emit, plugin opts
backend/src/modules/murals/
  domain/publicPayload.ts  # MuralPublicPayload + resolveMuralPublicPayload (moved from routes)
  publicApi.ts             # MuralsPublicApi (ownsMural, getMuralPublicPayload)
  plugin.ts                # + getMuralsPublicApi (modify)
  routes.ts                # shared-token handler refactored onto resolveMuralPublicPayload (modify)
  index.ts                 # + public API exports (modify)
backend/src/modules/auth/
  publicProfile.ts         # + 4 lookups (modify)
  publicProfile.test.ts    # new
backend/src/app.ts                             # wiring (modify)
backend/package.json                           # test file list (modify, twice)
```

---

### Task 1: `@scripta/shared/community` entry point

**Files:**
- Create: `packages/shared/src/community/types.ts`
- Create: `packages/shared/src/community/cursor.ts`
- Create: `packages/shared/src/community/index.ts`
- Modify: `packages/shared/package.json` (exports map)

**Interfaces:**
- Consumes: `ReaderProfile` from `@scripta/shared`'s murals domain.
- Produces: every type later tasks import from `@scripta/shared/community` — `CommunityAuthor`, `FollowState`, `TierlistSummary`, `TournamentSummary`, `PublishedContent`, `CommunityEventType`, `DiscoverType`, `FeedItem`, `DiscoverItem`, `PersonResult`, `PublishedProfile`, `Page<T>`, `encodeCursor`, `decodeCursor`.

- [ ] **Step 1: Write the types file**

```ts
// packages/shared/src/community/types.ts
import type { ReaderProfile } from "../murals/murals.js";

export type CommunityAuthor = ReaderProfile & { userId: string };

export interface FollowState {
  following: boolean;
  followerCount: number;
  followingCount: number;
}

export interface TierlistSummary {
  kind: "tierlist";
  id: string;
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  votingOpen: boolean;
}

export interface TournamentSummary {
  kind: "tournament";
  id: string;
  name: string;
  bracketSize: number;
  status: "active" | "completed";
  bookCount: number;
}

export type PublishedContent = TierlistSummary | TournamentSummary;

export type CommunityEventType = "tierlist_published" | "tournament_published";

export type DiscoverType = "all" | "tierlist" | "tournament";

export interface FeedItem {
  id: string;
  actor: CommunityAuthor;
  type: CommunityEventType;
  content: PublishedContent;
  createdAt: string;
}

export interface DiscoverItem {
  author: CommunityAuthor;
  content: PublishedContent;
}

export interface PersonResult {
  user: CommunityAuthor;
  followerCount: number;
  viewerFollows?: boolean;
}

export interface PublishedProfile {
  user: CommunityAuthor;
  publishedAt: string;
  followerCount: number;
  followingCount: number;
  viewerFollows?: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

- [ ] **Step 2: Write the cursor helper**

```ts
// packages/shared/src/community/cursor.ts
const SEPARATOR = "~";

export interface CursorPosition {
  createdAt: string;
  id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return `${encodeURIComponent(position.createdAt)}${SEPARATOR}${encodeURIComponent(position.id)}`;
}

export function decodeCursor(cursor: string): CursorPosition | undefined {
  const parts = cursor.split(SEPARATOR);
  if (parts.length !== 2) return undefined;
  try {
    const createdAt = decodeURIComponent(parts[0]);
    const id = decodeURIComponent(parts[1]);
    if (!createdAt || !id) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 3: Write the barrel and register the entry point**

```ts
// packages/shared/src/community/index.ts
export * from "./types.js";
export * from "./cursor.js";
```

In `packages/shared/package.json`, add to the `exports` map (after the `"./tierlists/*"` entry):

```json
    "./community": {
      "types": "./dist/community/index.d.ts",
      "default": "./dist/community/index.js"
    }
```

- [ ] **Step 4: Build and verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace @scripta/shared`
Expected: clean build; `dist/community/index.js` and `dist/community/index.d.ts` exist.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/community packages/shared/package.json
git commit -m "feat(shared): community DTOs and keyset cursor entry point"
```

---

### Task 2: Community module scaffold — env, schema, connection, domain, SQLite repository

**Files:**
- Modify: `backend/src/config/env.ts` (after the `TIERLISTS_DB_PATH` line)
- Modify: `backend/.env.example` (next to `TIERLISTS_DB_PATH`)
- Create: `backend/src/modules/community/adapters/sqlite/schema.sql`
- Create: `backend/src/modules/community/adapters/sqlite/connection.ts`
- Create: `backend/src/modules/community/domain/types.ts`
- Create: `backend/src/modules/community/domain/ports.ts`
- Create: `backend/src/modules/community/domain/errors.ts`
- Create: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts`
- Create: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`
- Modify: `backend/package.json` (append the new test file to the `test` script)

**Interfaces:**
- Consumes: `env` from `backend/src/config/env.js`; `CommunityEventType` from `@scripta/shared/community` (Task 1).
- Produces: `openCommunityDb(): DatabaseSync`; `createSqliteCommunityRepository(db): CommunityRepository` with `insertFollow`, `deleteFollow`, `getFollow`, `listFollowees`, `countFollowers`, `countFollowing`, `getProfileRow`, `upsertProfile`, `insertEvent`, `listEventsByUser` — the exact port Task 7's service compiles against.

- [ ] **Step 1: Add the env var**

In `backend/src/config/env.ts`, directly after the `TIERLISTS_DB_PATH` entry:

```ts
  COMMUNITY_DB_PATH: z.string().min(1).default("./data/community.sqlite"),
```

In `backend/.env.example`, next to `TIERLISTS_DB_PATH`:

```
COMMUNITY_DB_PATH=./data/community.sqlite
```

- [ ] **Step 2: Write the schema**

```sql
-- backend/src/modules/community/adapters/sqlite/schema.sql
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id      TEXT PRIMARY KEY,
  published    INTEGER NOT NULL DEFAULT 0,
  mural_id     TEXT,
  published_at TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
```

- [ ] **Step 3: Write the connection (mirrors arena's)**

```ts
// backend/src/modules/community/adapters/sqlite/connection.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openCommunityDb(): DatabaseSync {
  mkdirSync(dirname(env.COMMUNITY_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.COMMUNITY_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
```

- [ ] **Step 4: Write the domain types**

```ts
// backend/src/modules/community/domain/types.ts
import type { CommunityEventType } from "@scripta/shared/community";

export interface FollowRow {
  follower_id: string;
  followee_id: string;
  created_at: string;
}

export interface ProfileRow {
  user_id: string;
  published: number;
  mural_id: string | null;
  published_at: string | null;
  updated_at: string;
}

export type CommunityRefType = "tierlist" | "tournament";

export interface EventRow {
  id: string;
  user_id: string;
  type: CommunityEventType;
  ref_type: CommunityRefType;
  ref_id: string;
  created_at: string;
}
```

- [ ] **Step 5: Write the port**

```ts
// backend/src/modules/community/domain/ports.ts
import type { EventRow, FollowRow, ProfileRow } from "./types.js";

export interface CursorKeyset {
  createdAt: string;
  id: string;
}

export interface CommunityRepository {
  insertFollow(row: FollowRow): void;
  deleteFollow(followerId: string, followeeId: string): boolean;
  getFollow(followerId: string, followeeId: string): FollowRow | undefined;
  listFollowees(followerId: string): string[];
  countFollowers(userId: string): number;
  countFollowing(userId: string): number;

  getProfileRow(userId: string): ProfileRow | undefined;
  upsertProfile(row: ProfileRow): void;

  insertEvent(row: EventRow): void;
  listEventsByUser(userId: string, keyset: CursorKeyset | undefined, limit: number): EventRow[];
}
```

- [ ] **Step 6: Write the errors**

```ts
// backend/src/modules/community/domain/errors.ts
export class CommunityError extends Error {}

export class ProfileNotFoundError extends CommunityError {
  constructor() {
    super("No published profile at that address.");
  }
}

export class SelfFollowError extends CommunityError {
  constructor() {
    super("You can't follow yourself.");
  }
}

export class NotFollowingError extends CommunityError {
  constructor() {
    super("You aren't following that profile.");
  }
}

export class UsernameRequiredError extends CommunityError {
  constructor() {
    super("Choose a username before publishing your profile.");
  }
}

export class MuralNotOwnedError extends CommunityError {
  constructor() {
    super("No mural of yours with that id.");
  }
}

export class InvalidCursorError extends CommunityError {
  constructor() {
    super("Invalid feed cursor.");
  }
}
```

- [ ] **Step 7: Write the failing repository test**

```ts
// backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const tempRoot = mkdtempSync(join(tmpdir(), "community-repo-"));
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789abcdef";
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(tempRoot, "gallery-files");
process.env.COMMUNITY_DB_PATH = join(tempRoot, "community.sqlite");

const { openCommunityDb } = await import("./connection.js");
const { createSqliteCommunityRepository } = await import("./sqliteCommunityRepository.js");

function repo() {
  return createSqliteCommunityRepository(openCommunityDb());
}

test("follows are idempotent and counted per side", () => {
  const r = repo();
  r.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: "2026-09-10T00:00:00.000Z" });
  r.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: "2026-09-10T00:00:00.000Z" });
  assert.equal(r.getFollow("bob", "alice")?.followee_id, "alice");
  assert.equal(r.countFollowers("alice"), 1);
  assert.equal(r.countFollowing("bob"), 1);
  assert.deepEqual(r.listFollowees("bob"), ["alice"]);
});

test("deleteFollow reports whether a row was removed", () => {
  const r = repo();
  r.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: "2026-09-10T00:00:00.000Z" });
  assert.equal(r.deleteFollow("bob", "alice"), true);
  assert.equal(r.deleteFollow("bob", "alice"), false);
});

test("profiles upsert in place", () => {
  const r = repo();
  r.upsertProfile({ user_id: "alice", published: 1, mural_id: "m1", published_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" });
  r.upsertProfile({ user_id: "alice", published: 1, mural_id: "m2", published_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z" });
  assert.equal(r.getProfileRow("alice")?.mural_id, "m2");
});

test("events ignore duplicate (ref_type, ref_id) and paginate by keyset", () => {
  const r = repo();
  r.insertEvent({ id: "e1", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", created_at: "2026-09-02T00:00:00.000Z" });
  r.insertEvent({ id: "e2", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", created_at: "2026-09-03T00:00:00.000Z" });
  r.insertEvent({ id: "e3", user_id: "alice", type: "tournament_published", ref_type: "tournament", ref_id: "g1", created_at: "2026-09-01T00:00:00.000Z" });
  assert.equal(r.listEventsByUser("alice", undefined, 10).length, 2);

  const page = r.listEventsByUser("alice", { createdAt: "2026-09-02T00:00:00.000Z", id: "e1" }, 10);
  assert.deepEqual(page.map((e) => e.id), ["e3"]);
  assert.deepEqual(r.listEventsByUser("bob", undefined, 10), []);
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `cd backend && npx tsx --test src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`
Expected: FAIL — cannot find `./sqliteCommunityRepository.js`.

- [ ] **Step 9: Write the repository**

```ts
// backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts
import type { DatabaseSync } from "node:sqlite";
import type { CommunityRepository, CursorKeyset } from "../../domain/ports.js";
import type { EventRow, FollowRow, ProfileRow } from "../../domain/types.js";

export function createSqliteCommunityRepository(db: DatabaseSync): CommunityRepository {
  const insertFollowStmt = db.prepare(`
    INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at)
    VALUES ($follower_id, $followee_id, $created_at)
  `);
  const deleteFollowStmt = db.prepare(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`);
  const getFollowStmt = db.prepare(`SELECT * FROM follows WHERE follower_id = ? AND followee_id = ?`);
  const listFolloweesStmt = db.prepare(`SELECT followee_id FROM follows WHERE follower_id = ? ORDER BY created_at DESC`);
  const countFollowersStmt = db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?`);
  const countFollowingStmt = db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?`);

  const getProfileStmt = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`);
  const upsertProfileStmt = db.prepare(`
    INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at)
    VALUES ($user_id, $published, $mural_id, $published_at, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      published = excluded.published,
      mural_id = excluded.mural_id,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at
  `);

  const insertEventStmt = db.prepare(`
    INSERT OR IGNORE INTO events (id, user_id, type, ref_type, ref_id, created_at)
    VALUES ($id, $user_id, $type, $ref_type, $ref_id, $created_at)
  `);
  const listEventsStmt = db.prepare(`
    SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const listEventsBeforeStmt = db.prepare(`
    SELECT * FROM events
    WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?
  `);

  return {
    insertFollow(row) {
      insertFollowStmt.run({ $follower_id: row.follower_id, $followee_id: row.followee_id, $created_at: row.created_at });
    },
    deleteFollow(followerId, followeeId) {
      return deleteFollowStmt.run(followerId, followeeId).changes > 0;
    },
    getFollow(followerId, followeeId) {
      return getFollowStmt.get(followerId, followeeId) as FollowRow | undefined;
    },
    listFollowees(followerId) {
      return (listFolloweesStmt.all(followerId) as Array<{ followee_id: string }>).map((row) => row.followee_id);
    },
    countFollowers(userId) {
      return (countFollowersStmt.get(userId) as { n: number }).n;
    },
    countFollowing(userId) {
      return (countFollowingStmt.get(userId) as { n: number }).n;
    },
    getProfileRow(userId) {
      return getProfileStmt.get(userId) as ProfileRow | undefined;
    },
    upsertProfile(row) {
      upsertProfileStmt.run({
        $user_id: row.user_id,
        $published: row.published,
        $mural_id: row.mural_id,
        $published_at: row.published_at,
        $updated_at: row.updated_at
      });
    },
    insertEvent(row) {
      insertEventStmt.run({
        $id: row.id,
        $user_id: row.user_id,
        $type: row.type,
        $ref_type: row.ref_type,
        $ref_id: row.ref_id,
        $created_at: row.created_at
      });
    },
    listEventsByUser(userId, keyset, limit) {
      if (keyset) {
        return listEventsBeforeStmt.all(userId, keyset.createdAt, keyset.createdAt, keyset.id, limit) as EventRow[];
      }
      return listEventsStmt.all(userId, limit) as EventRow[];
    }
  };
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `cd backend && npx tsx --test src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`
Expected: PASS (4 tests). `INSERT OR IGNORE` makes the duplicate event a no-op, so `e2` never lands — that is the idempotency the test asserts.

- [ ] **Step 11: Register the test file and commit**

In `backend/package.json`'s `test` script, append ` src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts` to the end of the file list.

```bash
git add backend/src/modules/community backend/src/config/env.ts backend/.env.example backend/package.json
git commit -m "feat(backend): community module scaffold — follows, profiles, events tables"
```

---

### Task 3: Tierlists — published refs, public API extensions, publish emission

**Files:**
- Modify: `backend/src/modules/tierlists/domain/ports.ts` (+2 repo methods)
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts` (+2 statements/methods)
- Modify: `backend/src/modules/tierlists/service.ts` (`PublishedTierlistRef`, 3 service methods, `emitPublished` param, `TierlistsPublicApi` extensions)
- Modify: `backend/src/modules/tierlists/plugin.ts` (options interface, thread `emitPublished`)
- Test: `backend/src/modules/tierlists/service.test.ts` (extend fake + 2 tests)

**Interfaces:**
- Produces: `PublishedTierlistRef { id, ownerUserId, createdAt, voteCode, name, poolSize, ballotCount, votingOpen }` exported from `tierlists/service.ts`; `TierlistsPublicApi` gains `listPublished(limit, offset)`, `getPublished(id)`, `listPublishedByOwner(ownerUserId)`; `createTierlistsService(repo, emitPublished?)`.
- `emitPublished?: (communityCopyId: string, ownerUserId: string) => void` — called exactly once per `openVoting`.

- [ ] **Step 1: Write the failing tests**

In `tierlists/service.test.ts`, extend the in-memory fake `TierlistsRepository` with the two new port methods (adapt names to whatever store variables the fake already uses for its `listPublic` filter — same rows, same filter, plus `owner_user_id` for the by-owner variant):

```ts
getPublicById(id) {
  return this.allRows().find((row) => row.id === id && row.source_tierlist_id !== null);
},
listPublicByUser(ownerUserId) {
  return this.allRows()
    .filter((row) => row.owner_user_id === ownerUserId && row.source_tierlist_id !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
```

Add tests (adapt setup lines to the file's existing helpers — its own create-list / `openVoting` call style; the assertions are the contract):

```ts
test("openVoting emits exactly one publish event for the community copy", () => {
  const emitted: Array<[string, string]> = [];
  const service = createTierlistsService(repo, (copyId, ownerUserId) => emitted.push([copyId, ownerUserId]));
  const original = /* create a tier list with the file's existing helper */;
  const copy = service.openVoting(userId, original.id, "anonymous");
  assert.ok(copy);
  assert.deepEqual(emitted, [[copy.id, userId]]);
});

test("published refs carry owner + timestamps; ordinary lists are excluded", () => {
  const service = createTierlistsService(repo);
  const ordinary = service.createTierlist(userId, { name: "Private list" });
  const copy = service.openVoting(userId, ordinary.id, "anonymous");
  const refs = service.listPublishedRefs(20, 0);
  assert.deepEqual(refs.map((r) => r.id), [copy!.id]);
  assert.equal(refs[0].ownerUserId, userId);
  assert.equal(service.getPublishedRef(ordinary.id), undefined);
  assert.equal(service.getPublishedRef(copy!.id)?.name, `${ordinary.name} (community)`);
  assert.deepEqual(service.listPublishedRefsByOwner(userId).map((r) => r.id), [copy!.id]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/tierlists/service.test.ts`
Expected: FAIL — `listPublishedRefs` missing, fake missing port methods, `createTierlistsService` arity mismatch.

- [ ] **Step 3: Implement**

`domain/ports.ts` — add to `TierlistsRepository`:

```ts
  getPublicById(id: string): TierlistRow | undefined;
  listPublicByUser(ownerUserId: string): TierlistRow[];
```

`sqliteTierlistsRepository.ts` — new prepared statements (next to `listPublicStmt`) + methods:

```ts
  const getPublicByIdStmt = db.prepare(`SELECT * FROM tierlists WHERE id = ? AND source_tierlist_id IS NOT NULL`);
  const listPublicByUserStmt = db.prepare(`SELECT * FROM tierlists WHERE owner_user_id = ? AND source_tierlist_id IS NOT NULL ORDER BY created_at DESC`);
```

```ts
    getPublicById(id) {
      return getPublicByIdStmt.get(id) as TierlistRow | undefined;
    },
    listPublicByUser(ownerUserId) {
      return listPublicByUserStmt.all(ownerUserId) as TierlistRow[];
    },
```

`service.ts` — new exported type + shared mapper. Place `toPublishedRef` next to the existing `listPublicTierlists`, then refactor that method to reuse it (its public response shape must not change):

```ts
export interface PublishedTierlistRef {
  id: string;
  ownerUserId: string;
  createdAt: string;
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  votingOpen: boolean;
}

function toPublishedRef(row: TierlistRow, ballotCount: number): PublishedTierlistRef {
  const { tiers, pool } = readDocument(toTierlist(row));
  const keys = new Set(pool);
  for (const tier of tiers) for (const key of tier.bookKeys) keys.add(key);
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    voteCode: row.vote_code!,
    name: row.name,
    poolSize: keys.size,
    ballotCount,
    votingOpen: row.voting_open === 1
  };
}
```

Three new methods on `TierlistsService` (interface + implementation):

```ts
    listPublishedRefs(limit, offset) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublic(limit, offset).map((row) => toPublishedRef(row, counts.get(row.id) ?? 0));
    },
    getPublishedRef(id) {
      const row = repo.getPublicById(id);
      return row ? toPublishedRef(row, repo.ballotCount(id)) : undefined;
    },
    listPublishedRefsByOwner(ownerUserId) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublicByUser(ownerUserId).map((row) => toPublishedRef(row, counts.get(row.id) ?? 0));
    },
```

`listPublicTierlists` becomes:

```ts
    listPublicTierlists(limit, offset) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublic(limit, offset).map((row) => {
        const ref = toPublishedRef(row, counts.get(row.id) ?? 0);
        return { voteCode: ref.voteCode, name: ref.name, poolSize: ref.poolSize, ballotCount: ref.ballotCount, votingOpen: ref.votingOpen };
      });
    }
```

Factory + emission — change the signature and add one line in `openVoting` right after `repo.insertCommunityCopy(copy, ballot, placements);`:

```ts
export type EmitPublished = (communityCopyId: string, ownerUserId: string) => void;

export function createTierlistsService(repo: TierlistsRepository, emitPublished?: EmitPublished): TierlistsService {
```

```ts
      repo.insertCommunityCopy(copy, ballot, placements);
      emitPublished?.(copy.id, userId);
      return toTierlist(copy);
```

`TierlistsPublicApi` + factory extension:

```ts
export interface TierlistsPublicApi {
  getTierlistData(ownerUserId: string, tierlistId: string): TierlistData | undefined;
  listPublished(limit: number, offset: number): PublishedTierlistRef[];
  getPublished(id: string): PublishedTierlistRef | undefined;
  listPublishedByOwner(ownerUserId: string): PublishedTierlistRef[];
}
```

```ts
    listPublished: (limit, offset) => service.listPublishedRefs(limit, offset),
    getPublished: (id) => service.getPublishedRef(id),
    listPublishedByOwner: (ownerUserId) => service.listPublishedRefsByOwner(ownerUserId)
```

`plugin.ts` — options + threading:

```ts
import type { EmitPublished } from "./service.js";

export interface TierlistsPluginOptions {
  emitPublished?: EmitPublished;
}

export async function tierlistsPlugin(app: FastifyInstance, opts: TierlistsPluginOptions = {}) {
  const db = openTierlistsDb();
  const tierlistsRepository = createSqliteTierlistsRepository(db);
  const tierlistsService = createTierlistsService(tierlistsRepository, opts.emitPublished);
```

- [ ] **Step 4: Run tierlists tests + typecheck**

Run: `cd backend && npx tsx --test src/modules/tierlists/service.test.ts && npm run typecheck --workspace backend`
Expected: tierlists tests PASS (including all pre-existing ones — the fake gained methods, nothing else moved), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists
git commit -m "feat(tierlists): published refs + publish emission hook for community"
```

---

### Task 4: Arena — public summary, published refs, publish emission

**Files:**
- Modify: `backend/src/modules/arena/service.ts` (`getPublicSummary`, `PublishedTournamentRef`, `ArenaPublicApi`, `emitPublished` param)
- Modify: `backend/src/modules/arena/plugin.ts` (options interface, `getArenaPublicApi` singleton)
- Test: `backend/src/modules/arena/service.test.ts` (+1 test)

**Interfaces:**
- Produces: `PublishedTournamentRef { id, ownerUserId, createdAt, name, bracketSize, status: "active" | "completed" }` and `ArenaPublicApi { listPublished(limit, offset), getPublished(id), listPublishedByOwner(ownerUserId) }` exported from `arena/service.ts`; `createArenaService(repo, emitPublished?)`; `getArenaPublicApi(): ArenaPublicApi` from `arena/plugin.ts`.

- [ ] **Step 1: Write the failing test**

Append to `arena/service.test.ts` (reuse the file's existing helpers to create + fully seed a tournament; the fake already implements `getTournament`/`getSlots`):

```ts
test("start emits exactly one publish event and the public summary flips", () => {
  const emitted: Array<[string, string]> = [];
  const service = createArenaService(repo, (tournamentId, ownerUserId) => emitted.push([tournamentId, ownerUserId]));
  const t = /* create + seed a tournament with the file's existing helpers */;
  assert.equal(service.getPublicSummary(t.id), undefined);
  service.start(t.id, ownerId);
  assert.deepEqual(emitted, [[t.id, ownerId]]);
  assert.equal(service.getPublicSummary(t.id)?.status, "active");
  assert.throws(() => service.start(t.id, ownerId), TournamentAlreadyStartedError);
  assert.equal(emitted.length, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/arena/service.test.ts`
Expected: FAIL — `getPublicSummary` missing, `createArenaService` arity.

- [ ] **Step 3: Implement**

`service.ts` — factory signature and emission in `start()` (one line after `repo.updateTournamentStatus(tournamentId, "active", 1);`):

```ts
export type EmitPublished = (tournamentId: string, ownerUserId: string) => void;

export function createArenaService(repo: ArenaRepository, emitPublished?: EmitPublished): ArenaService {
```

```ts
      repo.updateTournamentStatus(tournamentId, "active", 1);
      emitPublished?.(tournamentId, ownerUserId);
```

New method on the `ArenaService` interface + implementation (if `listMine`/`listPublic` already share a row→`TournamentSummary` mapping helper, call it instead of the inline mapping below):

```ts
  getPublicSummary(tournamentId: string): TournamentSummary | undefined;
```

```ts
    getPublicSummary(tournamentId) {
      const tournament = repo.getTournament(tournamentId);
      if (!tournament || tournament.status === "seeding") return undefined;
      const slots = repo.getSlots(tournament.id);
      return {
        id: tournament.id,
        name: tournament.name,
        bracketSize: tournament.bracket_size,
        roundDurationMinutes: tournament.round_duration_minutes,
        status: tournament.status,
        currentRound: tournament.current_round,
        createdAt: tournament.created_at,
        ownerUserId: tournament.owner_user_id,
        covers: slots.map((s) => s.cover_url).filter((c): c is string => c !== null).slice(0, 4),
        filledSlots: slots.length
      };
    },
```

Refs + public API (bottom of `service.ts`):

```ts
export interface PublishedTournamentRef {
  id: string;
  ownerUserId: string;
  createdAt: string;
  name: string;
  bracketSize: number;
  status: "active" | "completed";
}

export interface ArenaPublicApi {
  listPublished(limit: number, offset: number): PublishedTournamentRef[];
  getPublished(id: string): PublishedTournamentRef | undefined;
  listPublishedByOwner(ownerUserId: string): PublishedTournamentRef[];
}

function toPublishedRef(summary: TournamentSummary): PublishedTournamentRef {
  return {
    id: summary.id,
    ownerUserId: summary.ownerUserId,
    createdAt: summary.createdAt,
    name: summary.name,
    bracketSize: summary.bracketSize,
    status: summary.status === "completed" ? "completed" : "active"
  };
}

export function createArenaPublicApi(service: ArenaService): ArenaPublicApi {
  return {
    listPublished: (limit, offset) => service.listPublic(limit, offset).map(toPublishedRef),
    getPublished: (id) => {
      const summary = service.getPublicSummary(id);
      return summary ? toPublishedRef(summary) : undefined;
    },
    listPublishedByOwner: (ownerUserId) =>
      service.listMine(ownerUserId).filter((s) => s.status !== "seeding").map(toPublishedRef)
  };
}
```

`plugin.ts` — options + singleton (same lazy pattern as tierlists'):

```ts
import type { ArenaPublicApi, EmitPublished } from "./service.js";
import { createArenaPublicApi, createArenaService } from "./service.js";

export interface ArenaPluginOptions {
  emitPublished?: EmitPublished;
}

export async function arenaPlugin(app: FastifyInstance, opts: ArenaPluginOptions = {}) {
  const db = openArenaDb();
  const repo = createSqliteArenaRepository(db);
  const service = createArenaService(repo, opts.emitPublished);
```

```ts
let cachedApi: ArenaPublicApi | null = null;

export function getArenaPublicApi(): ArenaPublicApi {
  if (!cachedApi) {
    const service = createArenaService(createSqliteArenaRepository(openArenaDb()));
    cachedApi = createArenaPublicApi(service);
  }
  return cachedApi;
}
```

- [ ] **Step 4: Run arena tests + typecheck**

Run: `cd backend && npx tsx --test src/modules/arena/service.test.ts && npm run typecheck --workspace backend`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/arena
git commit -m "feat(arena): public summary + refs + publish emission hook for community"
```

---

### Task 5: Murals — extract the public payload, add the public API layer

**Files:**
- Create: `backend/src/modules/murals/domain/publicPayload.ts`
- Create: `backend/src/modules/murals/publicApi.ts`
- Modify: `backend/src/modules/murals/routes.ts` (shared-token handler delegates to `resolveMuralPublicPayload`)
- Modify: `backend/src/modules/murals/plugin.ts` (+ `getMuralsPublicApi`)
- Modify: `backend/src/modules/murals/index.ts` (+ public API exports)

**Interfaces:**
- Produces: `MuralPublicPayload { mural, library, profile, imageUrls, tierlists }`; `resolveMuralPublicPayload(row, blocks, getTierlistData?)`; `MuralsPublicApi { ownsMural(userId, muralId): boolean; getMuralPublicPayload(userId, muralId): MuralPublicPayload | null }`; `getMuralsPublicApi(getTierlistData?): MuralsPublicApi`. The `GET /murals/shared/:token` response envelope must stay exactly as it is today.

- [ ] **Step 1: Write `domain/publicPayload.ts`**

Move the payload assembly out of `buildPublicMuralRoutes`'s handler (`routes.ts`, everything from `const refs = extractReferences(blocks);` through the reply payload) into this function — the body below is that code, verbatim except for the return shape:

```ts
// backend/src/modules/murals/domain/publicPayload.ts
import type { ReaderProfile } from "@scripta/shared";
import { env } from "../../../config/env.js";
import { resolvePublicReaderProfile } from "../../auth/index.js";
import { resolvePublicLibraryData } from "../../library/index.js";
import type { TierlistData } from "../../tierlists/index.js";
import { extractReferences } from "./blockRefs.js";
import type { MuralRow } from "./types.js";

type PublicLibraryData = ReturnType<typeof resolvePublicLibraryData>;

export interface MuralPublicPayload {
  mural: { id: string; name: string; blocks: unknown[]; coverImageUrl: string | null };
  library: PublicLibraryData;
  profile: ReaderProfile | undefined;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, TierlistData>;
}

export function resolveMuralPublicPayload(
  row: MuralRow,
  blocks: unknown,
  getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined
): MuralPublicPayload {
  const refs = extractReferences(blocks);

  const tierlistIds: string[] = [];
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const candidate = block as { type?: unknown; tierlistId?: unknown };
      if (candidate.type !== "tierlist" || typeof candidate.tierlistId !== "string" || !candidate.tierlistId) continue;
      if (!tierlistIds.includes(candidate.tierlistId)) tierlistIds.push(candidate.tierlistId);
    }
  }
  const tierlists = Object.fromEntries(
    tierlistIds
      .map((id) => [id, getTierlistData?.(row.user_id, id)] as const)
      .filter((entry): entry is readonly [string, TierlistData] => entry[1] !== undefined)
  );
  const tierlistBookKeys = new Set<string>();
  for (const tierlist of Object.values(tierlists)) {
    for (const key of tierlist.pool) tierlistBookKeys.add(key);
    for (const tier of tierlist.tiers) for (const key of tier.bookKeys) tierlistBookKeys.add(key);
  }

  const libraryData = resolvePublicLibraryData(row.user_id, {
    bookKeys: [...refs.bookKeys, ...tierlistBookKeys],
    collectionIds: [...refs.collectionIds],
    highlightRefs: refs.highlightRefs,
    needsCurrentlyReading: refs.needsCurrentlyReading,
    statsMetrics: [...refs.statsMetrics],
    needsShelfTheme: refs.needsShelfTheme
  });

  const imageIds = [...refs.imageIds, ...(row.cover_image_id ? [row.cover_image_id] : [])];
  const imageUrls = Object.fromEntries(imageIds.map((id) => [id, `${env.PUBLIC_API_URL}/gallery/${id}/file`]));

  return {
    mural: {
      id: row.id,
      name: row.name,
      blocks: (Array.isArray(blocks) ? blocks : []).map((block) => {
        if (!block || typeof block !== "object") return block;
        if (block.type === "quote" && block.mode === "rediscover") return { id: block.id, type: "text", layout: block.layout, style: block.style, heading: "Private passage", body: "Rediscovered passages are only visible to the owner." };
        if (block.type === "shelf" && typeof block.collectionId === "string") {
          const { collectionId, ...rest } = block;
          return { ...rest, bookKeys: libraryData.collectionBooks?.[collectionId] ?? [] };
        }
        return block;
      }),
      coverImageUrl: row.cover_image_id ? imageUrls[row.cover_image_id] : row.cover_image_url
    },
    library: libraryData,
    profile: refs.needsShelfTheme ? resolvePublicReaderProfile(row.user_id) : undefined,
    imageUrls,
    tierlists
  };
}
```

- [ ] **Step 2: Refactor the shared-token route onto it**

In `buildPublicMuralRoutes`, delete the moved code and replace with (keep the token lookup, `JSON.parse` guard and 404s exactly as they are):

```ts
      const payload = resolveMuralPublicPayload(row, blocks, getTierlistData);
      reply.header("Cache-Control", "no-store");
      return reply.send({
        mural: payload.mural,
        books: payload.library.books,
        highlights: payload.library.highlights,
        currentlyReading: payload.library.currentlyReading,
        stats: payload.library.stats,
        shelfTheme: payload.library.shelfTheme,
        profile: payload.profile,
        imageUrls: payload.imageUrls,
        tierlists: payload.tierlists
      });
```

Remove imports `routes.ts` no longer uses (`extractReferences`, `resolvePublicLibraryData`, `resolvePublicReaderProfile`, and `env` if nothing else in the file uses it).

- [ ] **Step 3: Write `publicApi.ts`**

```ts
// backend/src/modules/murals/publicApi.ts
import type { TierlistData } from "../tierlists/index.js";
import type { MuralsRepository } from "./domain/ports.js";
import { resolveMuralPublicPayload, type MuralPublicPayload } from "./domain/publicPayload.js";

export interface MuralsPublicApi {
  ownsMural(userId: string, muralId: string): boolean;
  getMuralPublicPayload(userId: string, muralId: string): MuralPublicPayload | null;
}

export function createMuralsPublicApi(
  repo: MuralsRepository,
  getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined
): MuralsPublicApi {
  return {
    ownsMural(userId, muralId) {
      return repo.getOwned(muralId, userId) !== undefined;
    },
    getMuralPublicPayload(userId, muralId) {
      const row = repo.getOwned(muralId, userId);
      if (!row) return null;
      let blocks: unknown;
      try {
        blocks = JSON.parse(row.blocks);
      } catch {
        return null;
      }
      return resolveMuralPublicPayload(row, blocks, getTierlistData);
    }
  };
}
```

- [ ] **Step 4: Expose `getMuralsPublicApi` from the plugin and index**

In `murals/plugin.ts`:

```ts
import { createMuralsPublicApi, type MuralsPublicApi } from "./publicApi.js";

let cachedPublicApi: MuralsPublicApi | null = null;

export function getMuralsPublicApi(getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined): MuralsPublicApi {
  if (!cachedPublicApi) {
    cachedPublicApi = createMuralsPublicApi(createSqliteMuralsRepository(openMuralsDb()), getTierlistData);
  }
  return cachedPublicApi;
}
```

In `murals/index.ts`, add:

```ts
export { getMuralsPublicApi } from "./plugin.js";
export { createMuralsPublicApi, type MuralsPublicApi } from "./publicApi.js";
export type { MuralPublicPayload } from "./domain/publicPayload.js";
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: clean typecheck; all existing tests pass (murals service tests untouched — no service changes in this task).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/murals
git commit -m "refactor(murals): extract public payload + add ownsMural/getMuralPublicPayload surface"
```

---

### Task 6: Auth — publicProfile lookups for community

**Files:**
- Modify: `backend/src/modules/auth/publicProfile.ts` (rewrite; `resolvePublicReaderProfile`'s behavior stays identical)
- Modify: `backend/src/modules/auth/index.ts` (+4 exports)
- Create: `backend/src/modules/auth/publicProfile.test.ts`
- Modify: `backend/package.json` (append the new test file to the `test` script)

**Interfaces:**
- Produces: `resolvePublicReaderProfiles(userIds): Map<string, ReaderProfile>`, `userHasUsername(userId): boolean`, `findUserIdByUsername(username): string | undefined`, `searchUsernameOwners(query, limit): string[]` — all exported from `auth/index.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/auth/publicProfile.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const tempRoot = mkdtempSync(join(tmpdir(), "public-profile-"));
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789abcdef";
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(tempRoot, "gallery-files");

const { openAuthDb } = await import("./adapters/sqlite/connection.js");
const db = openAuthDb();
const insertUser = db.prepare(
  `INSERT INTO users (id, email, username, auth_version, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
);
insertUser.run("u1", "alice@test.dev", "alice");
insertUser.run("u2", "noname@test.dev", null);
insertUser.run("u3", "bob@test.dev", "bobby");
insertUser.run("u4", "alina@test.dev", "alina");

const { resolvePublicReaderProfile, resolvePublicReaderProfiles, userHasUsername, findUserIdByUsername, searchUsernameOwners } = await import("./publicProfile.js");

test("resolvePublicReaderProfile keeps its existing shape", () => {
  assert.deepEqual(resolvePublicReaderProfile("u1"), { username: "alice", avatarUrl: null });
  assert.equal(resolvePublicReaderProfile("u2"), undefined);
  assert.equal(resolvePublicReaderProfile("missing"), undefined);
});

test("batch resolution skips username-less and missing users", () => {
  const map = resolvePublicReaderProfiles(["u1", "u2", "u3", "missing"]);
  assert.equal(map.size, 2);
  assert.equal(map.get("u3")?.username, "bobby");
});

test("username existence and lookup by name", () => {
  assert.equal(userHasUsername("u1"), true);
  assert.equal(userHasUsername("u2"), false);
  assert.equal(findUserIdByUsername("alice"), "u1");
  assert.equal(findUserIdByUsername("nobody"), undefined);
});

test("username search matches substrings and escapes LIKE wildcards", () => {
  assert.deepEqual(searchUsernameOwners("ali", 10).sort(), ["u1", "u4"]);
  assert.deepEqual(searchUsernameOwners("%", 10), []);
  assert.deepEqual(searchUsernameOwners("bobby", 10), ["u3"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/auth/publicProfile.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Rewrite `publicProfile.ts`**

```ts
import type { DatabaseSync } from "node:sqlite";
import type { ReaderProfile } from "@scripta/shared";
import { env } from "../../config/env.js";
import { openAuthDb } from "./adapters/sqlite/connection.js";

interface CachedStatements {
  db: DatabaseSync;
  find: ReturnType<DatabaseSync["prepare"]>;
  findIdByUsername: ReturnType<DatabaseSync["prepare"]>;
  search: ReturnType<DatabaseSync["prepare"]>;
}

let cached: CachedStatements | null = null;

function statements(): CachedStatements {
  if (!cached) {
    const db = openAuthDb();
    cached = {
      db,
      find: db.prepare("SELECT username, avatar_id FROM users WHERE id = ?"),
      findIdByUsername: db.prepare("SELECT id FROM users WHERE username = ?"),
      search: db.prepare("SELECT id FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY username LIMIT ?")
    };
  }
  return cached;
}

function toReaderProfile(row: { username: string | null; avatar_id: string | null } | undefined): ReaderProfile | undefined {
  if (!row?.username) return undefined;
  return { username: row.username, avatarUrl: row.avatar_id ? `${env.PUBLIC_API_URL}/auth/avatar/${row.avatar_id}/file` : null };
}

export function resolvePublicReaderProfile(userId: string): ReaderProfile | undefined {
  return toReaderProfile(statements().find.get(userId) as { username: string | null; avatar_id: string | null } | undefined);
}

export function resolvePublicReaderProfiles(userIds: string[]): Map<string, ReaderProfile> {
  const out = new Map<string, ReaderProfile>();
  for (const userId of userIds) {
    const profile = resolvePublicReaderProfile(userId);
    if (profile) out.set(userId, profile);
  }
  return out;
}

export function userHasUsername(userId: string): boolean {
  return Boolean((statements().find.get(userId) as { username: string | null } | undefined)?.username);
}

export function findUserIdByUsername(username: string): string | undefined {
  const row = statements().findIdByUsername.get(username) as { id: string } | undefined;
  return row?.id;
}

export function searchUsernameOwners(query: string, limit: number): string[] {
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = statements().search.all(`%${escaped}%`, limit) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
```

In `auth/index.ts`, replace the existing publicProfile export line with:

```ts
export {
  resolvePublicReaderProfile,
  resolvePublicReaderProfiles,
  userHasUsername,
  findUserIdByUsername,
  searchUsernameOwners
} from "./publicProfile.js";
```

- [ ] **Step 4: Register the test, run auth tests + typecheck**

Append ` src/modules/auth/publicProfile.test.ts` to `backend/package.json`'s `test` script, then:

Run: `cd backend && npx tsx --test src/modules/auth/publicProfile.test.ts && npm test --workspace backend && npm run typecheck --workspace backend`
Expected: new tests PASS; full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/auth backend/package.json
git commit -m "feat(auth): username/profile lookups for the community module"
```

---

### Task 7: Community service — follows

**Files:**
- Create: `backend/src/modules/community/service.ts`
- Create: `backend/src/modules/community/service.test.ts`
- Modify: `backend/package.json` (append the new test file to the `test` script)

**Interfaces:**
- Consumes: `CommunityRepository` (Task 2), `PublishedTierlistRef` (Task 3), `PublishedTournamentRef` (Task 4), `MuralsPublicApi`/`MuralPublicPayload` (Task 5), auth lookups' signatures (Task 6), shared types (Task 1).
- Produces: `CommunityDeps` (the full injection surface `app.ts` wires), `CommunityService`, `createCommunityService(deps)`. Tasks 8–10 extend the service interface with `publishProfile`, `unpublishProfile`, `getProfileByUsername`, `getFeed`, `getDiscover`, `searchPeople`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/modules/community/service.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReaderProfile } from "@scripta/shared";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralPublicPayload } from "../murals/publicApi.js";
import type { CommunityRepository, CursorKeyset } from "./domain/ports.js";
import type { EventRow, FollowRow, ProfileRow } from "./domain/types.js";
import { NotFollowingError, ProfileNotFoundError, SelfFollowError } from "./domain/errors.js";
import { createCommunityService, type CommunityDeps } from "./service.js";

function createRepoFake() {
  const follows = new Map<string, FollowRow>();
  const profiles = new Map<string, ProfileRow>();
  const events: EventRow[] = [];
  const key = (a: string, b: string) => `${a}:${b}`;
  const repo: CommunityRepository = {
    insertFollow(row) {
      follows.set(key(row.follower_id, row.followee_id), { ...row });
    },
    deleteFollow(followerId, followeeId) {
      return follows.delete(key(followerId, followeeId));
    },
    getFollow(followerId, followeeId) {
      return follows.get(key(followerId, followeeId));
    },
    listFollowees(followerId) {
      return [...follows.values()].filter((row) => row.follower_id === followerId).map((row) => row.followee_id);
    },
    countFollowers(userId) {
      return [...follows.values()].filter((row) => row.followee_id === userId).length;
    },
    countFollowing(userId) {
      return [...follows.values()].filter((row) => row.follower_id === userId).length;
    },
    getProfileRow(userId) {
      return profiles.get(userId);
    },
    upsertProfile(row) {
      profiles.set(row.user_id, { ...row });
    },
    insertEvent(row) {
      if (events.some((e) => e.ref_type === row.ref_type && e.ref_id === row.ref_id)) return;
      events.push({ ...row });
    },
    listEventsByUser(userId, keyset: CursorKeyset | undefined, limit) {
      return events
        .filter((e) => e.user_id === userId)
        .filter((e) => !keyset || e.created_at < keyset.createdAt || (e.created_at === keyset.createdAt && e.id < keyset.id))
        .sort((a, b) => (a.created_at === b.created_at ? (a.id > b.id ? -1 : 1) : b.created_at.localeCompare(a.created_at)))
        .slice(0, limit);
    }
  };
  return { repo, follows, profiles, events };
}

function createDeps(repo: CommunityRepository) {
  const readerProfiles = new Map<string, ReaderProfile>();
  const usernames = new Map<string, string>();
  const ownedMurals = new Set<string>();
  const muralPayloads = new Map<string, MuralPublicPayload | null>();
  const tierlistRefs = new Map<string, PublishedTierlistRef>();
  const tournamentRefs = new Map<string, PublishedTournamentRef>();
  const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  const deps: CommunityDeps = {
    repo,
    resolveProfile: (id) => readerProfiles.get(id),
    resolveProfiles: (ids) => {
      const out = new Map<string, ReaderProfile>();
      for (const id of ids) {
        const p = readerProfiles.get(id);
        if (p) out.set(id, p);
      }
      return out;
    },
    userHasUsername: (id) => usernames.has(id),
    findUserIdByUsername: (name) => [...usernames.entries()].find(([, n]) => n === name)?.[0],
    searchUsernameOwners: (q, limit) =>
      [...usernames.entries()]
        .filter(([, n]) => n.toLowerCase().includes(q.toLowerCase()))
        .map(([id]) => id)
        .slice(0, limit),
    murals: {
      ownsMural: (userId, muralId) => ownedMurals.has(`${userId}:${muralId}`),
      getMuralPublicPayload: (userId, muralId) => muralPayloads.get(`${userId}:${muralId}`) ?? null
    },
    tierlists: {
      list: (limit, offset) => [...tierlistRefs.values()].sort(byNewest).slice(offset, offset + limit),
      get: (id) => tierlistRefs.get(id),
      listByOwner: (owner) => [...tierlistRefs.values()].filter((r) => r.ownerUserId === owner).sort(byNewest)
    },
    tournaments: {
      list: (limit, offset) => [...tournamentRefs.values()].sort(byNewest).slice(offset, offset + limit),
      get: (id) => tournamentRefs.get(id),
      listByOwner: (owner) => [...tournamentRefs.values()].filter((r) => r.ownerUserId === owner).sort(byNewest)
    }
  };
  return { deps, readerProfiles, usernames, ownedMurals, muralPayloads, tierlistRefs, tournamentRefs };
}

function profileRow(userId: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: userId,
    published: 1,
    mural_id: null,
    published_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function reader(userId: string): ReaderProfile {
  return { username: `user-${userId}`, avatarUrl: null };
}

export function tierRef(id: string, owner: string, overrides: Partial<PublishedTierlistRef> = {}): PublishedTierlistRef {
  return {
    id,
    ownerUserId: owner,
    createdAt: "2026-09-02T00:00:00.000Z",
    voteCode: `code-${id}`,
    name: `List ${id}`,
    poolSize: 5,
    ballotCount: 2,
    votingOpen: true,
    ...overrides
  };
}

export function tournRef(id: string, owner: string, overrides: Partial<PublishedTournamentRef> = {}): PublishedTournamentRef {
  return {
    id,
    ownerUserId: owner,
    createdAt: "2026-09-03T00:00:00.000Z",
    name: `Cup ${id}`,
    bracketSize: 8,
    status: "active",
    ...overrides
  };
}

test("follow requires the target to have a published profile", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.follow("bob", "alice"), ProfileNotFoundError);
  profiles.set("alice", profileRow("alice"));
  service.follow("bob", "alice");
  assert.throws(() => service.follow("bob", "bob"), SelfFollowError);
  service.follow("bob", "alice");
  assert.equal(repo.countFollowers("alice"), 1);
});

test("unfollow without an existing follow throws", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.unfollow("bob", "alice"), NotFollowingError);
});

test("follow state reports direction-specific counts", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice"));
  profiles.set("dave", profileRow("dave"));
  service.follow("bob", "alice");
  service.follow("carol", "alice");
  service.follow("alice", "dave");
  assert.deepEqual(service.getFollowState("bob", "alice"), { following: true, followerCount: 2, followingCount: 1 });
  assert.deepEqual(service.getFollowState("dave", "alice"), { following: false, followerCount: 2, followingCount: 1 });
});

test("emitEvent is idempotent per (ref_type, ref_id)", () => {
  const { repo, events } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  service.emitEvent("alice", "tournament_published", "tournament", "g1");
  assert.equal(events.length, 2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts`
Expected: FAIL — `./service.js` doesn't exist.

- [ ] **Step 3: Write the service**

```ts
// backend/src/modules/community/service.ts
import { randomUUID } from "node:crypto";
import type { ReaderProfile } from "@scripta/shared";
import type { CommunityEventType, FollowState } from "@scripta/shared/community";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralPublicPayload, MuralsPublicApi } from "../murals/publicApi.js";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import { NotFollowingError, ProfileNotFoundError, SelfFollowError } from "./domain/errors.js";
import type { CommunityRepository } from "./domain/ports.js";

export type CommunityRefType = "tierlist" | "tournament";

export interface CommunityDeps {
  repo: CommunityRepository;
  resolveProfile(userId: string): ReaderProfile | undefined;
  resolveProfiles(userIds: string[]): Map<string, ReaderProfile>;
  userHasUsername(userId: string): boolean;
  findUserIdByUsername(username: string): string | undefined;
  searchUsernameOwners(query: string, limit: number): string[];
  murals: Pick<MuralsPublicApi, "ownsMural" | "getMuralPublicPayload">;
  tierlists: {
    list(limit: number, offset: number): PublishedTierlistRef[];
    get(id: string): PublishedTierlistRef | undefined;
    listByOwner(ownerUserId: string): PublishedTierlistRef[];
  };
  tournaments: {
    list(limit: number, offset: number): PublishedTournamentRef[];
    get(id: string): PublishedTournamentRef | undefined;
    listByOwner(ownerUserId: string): PublishedTournamentRef[];
  };
}

export interface CommunityService {
  follow(followerId: string, followeeId: string): void;
  unfollow(followerId: string, followeeId: string): void;
  getFollowState(viewerId: string, userId: string): FollowState;
  emitEvent(userId: string, type: CommunityEventType, refType: CommunityRefType, refId: string): void;
}

export function createCommunityService(deps: CommunityDeps): CommunityService {
  const { repo } = deps;
  return {
    follow(followerId, followeeId) {
      if (followerId === followeeId) throw new SelfFollowError();
      const row = repo.getProfileRow(followeeId);
      if (!row || row.published !== 1) throw new ProfileNotFoundError();
      repo.insertFollow({ follower_id: followerId, followee_id: followeeId, created_at: new Date().toISOString() });
    },
    unfollow(followerId, followeeId) {
      if (!repo.deleteFollow(followerId, followeeId)) throw new NotFollowingError();
    },
    getFollowState(viewerId, userId) {
      return {
        following: repo.getFollow(viewerId, userId) !== undefined,
        followerCount: repo.countFollowers(userId),
        followingCount: repo.countFollowing(userId)
      };
    },
    emitEvent(userId, type, refType, refId) {
      repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, created_at: new Date().toISOString() });
    }
  };
}
```

Tasks 8–10 add imports (`DiscoverItem`, `FeedItem`, …) and interface members; keep the import list minimal at each commit so typecheck stays clean.

- [ ] **Step 4: Register the test, run, verify pass**

Append ` src/modules/community/service.test.ts` to `backend/package.json`'s `test` script, then:

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts && npm run typecheck --workspace backend`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/community backend/package.json
git commit -m "feat(community): follow graph service with published-profile gating"
```

---

### Task 8: Community service — publish profile, public profile view

**Files:**
- Modify: `backend/src/modules/community/service.ts`
- Test: `backend/src/modules/community/service.test.ts` (+6 tests)

**Interfaces:**
- Produces: `PublicProfileView { profile: PublishedProfile, mural: MuralPublicPayload | null, published: { tierlists: TierlistSummary[], tournaments: TournamentSummary[] } }`; `CommunityService` gains `publishProfile(userId, muralId)`, `unpublishProfile(userId)`, `getProfileByUsername(username, viewerId?)`.

- [ ] **Step 1: Write the failing tests**

Append to `service.test.ts`; extend the errors import with `MuralNotOwnedError, UsernameRequiredError`, and the shared-community import will be needed later — for now add these tests:

```ts
const fakePayload = {} as MuralPublicPayload;

test("publish requires a username, then an owned mural", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.publishProfile("alice", "m1"), UsernameRequiredError);
  usernames.set("alice", "alice");
  assert.throws(() => service.publishProfile("alice", "m1"), MuralNotOwnedError);
  ownedMurals.add("alice:m1");
  service.publishProfile("alice", "m1");
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 1);
  assert.equal(row.mural_id, "m1");
});

test("republish swaps the mural and keeps the original published_at", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  ownedMurals.add("alice:m2");
  service.publishProfile("alice", "m1");
  const first = repo.getProfileRow("alice")!;
  service.publishProfile("alice", "m2");
  const second = repo.getProfileRow("alice")!;
  assert.equal(second.mural_id, "m2");
  assert.equal(second.published_at, first.published_at);
});

test("unpublish clears published, keeps the row, and is a no-op when never published", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  service.unpublishProfile("ghost");
  profiles.set("alice", profileRow("alice"));
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.publishProfile("alice", "m1");
  service.unpublishProfile("alice");
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 0);
  assert.equal(row.mural_id, "m1");
});

test("getProfileByUsername assembles identity, mural, and published content", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames, muralPayloads, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice", { mural_id: "m1" }));
  muralPayloads.set("alice:m1", fakePayload);
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  tournamentRefs.set("g1", tournRef("g1", "alice"));
  service.follow("bob", "alice");

  const view = service.getProfileByUsername("alice", "bob");
  assert.equal(view.profile.user.username, "user-alice");
  assert.equal(view.profile.viewerFollows, true);
  assert.equal(view.profile.followerCount, 1);
  assert.equal(view.mural, fakePayload);
  assert.deepEqual(view.published.tierlists.map((t) => t.id), ["t1"]);
  assert.deepEqual(view.published.tournaments.map((t) => t.id), ["g1"]);

  const anonymous = service.getProfileByUsername("alice");
  assert.equal(anonymous.profile.viewerFollows, undefined);
});

test("getProfileByUsername 404s for unknown and unpublished profiles", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getProfileByUsername("ghost"), ProfileNotFoundError);
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.getProfileByUsername("alice"), ProfileNotFoundError);
});

test("a profile mural deleted later resolves to null without breaking the view", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice", { mural_id: "deleted" }));
  const view = service.getProfileByUsername("alice");
  assert.equal(view.mural, null);
  assert.equal(view.profile.user.username, "user-alice");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts`
Expected: FAIL — `publishProfile` is not a function.

- [ ] **Step 3: Implement**

Extend the shared-community type import with `PublishedProfile, TierlistSummary, TournamentSummary, PublishedContent`, and add to `service.ts`:

```ts
export interface PublicProfileView {
  profile: PublishedProfile;
  mural: MuralPublicPayload | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
}

function toTierlistSummary(ref: PublishedTierlistRef): TierlistSummary {
  return { kind: "tierlist", id: ref.id, voteCode: ref.voteCode, name: ref.name, poolSize: ref.poolSize, ballotCount: ref.ballotCount, votingOpen: ref.votingOpen };
}

function toTournamentSummary(ref: PublishedTournamentRef): TournamentSummary {
  return { kind: "tournament", id: ref.id, name: ref.name, bracketSize: ref.bracketSize, status: ref.status, bookCount: ref.bracketSize };
}
```

Extend `CommunityService` with `publishProfile(userId: string, muralId: string): void;`, `unpublishProfile(userId: string): void;`, `getProfileByUsername(username: string, viewerId?: string): PublicProfileView;` and implement inside `createCommunityService`:

```ts
    publishProfile(userId, muralId) {
      if (!deps.userHasUsername(userId)) throw new UsernameRequiredError();
      if (!deps.murals.ownsMural(userId, muralId)) throw new MuralNotOwnedError();
      const existing = repo.getProfileRow(userId);
      const now = new Date().toISOString();
      repo.upsertProfile({
        user_id: userId,
        published: 1,
        mural_id: muralId,
        published_at: existing?.published_at ?? now,
        updated_at: now
      });
    },
    unpublishProfile(userId) {
      const existing = repo.getProfileRow(userId);
      if (!existing) return;
      repo.upsertProfile({ ...existing, published: 0, updated_at: new Date().toISOString() });
    },
    getProfileByUsername(username, viewerId) {
      const userId = deps.findUserIdByUsername(username);
      if (!userId) throw new ProfileNotFoundError();
      const row = repo.getProfileRow(userId);
      if (!row || row.published !== 1) throw new ProfileNotFoundError();
      const author = deps.resolveProfiles([userId]).get(userId);
      if (!author) throw new ProfileNotFoundError();
      const mural = row.mural_id ? deps.murals.getMuralPublicPayload(userId, row.mural_id) : null;
      return {
        profile: {
          user: author,
          publishedAt: row.published_at ?? row.updated_at,
          followerCount: repo.countFollowers(userId),
          followingCount: repo.countFollowing(userId),
          viewerFollows: viewerId ? repo.getFollow(viewerId, userId) !== undefined : undefined
        },
        mural,
        published: {
          tierlists: deps.tierlists.listByOwner(userId).map(toTierlistSummary),
          tournaments: deps.tournaments.listByOwner(userId).map(toTournamentSummary)
        }
      };
    }
```

(`toTournamentSummary`/`toTierlistSummary` are reused by Tasks 9–10; `PublishedContent` becomes used there too.)

- [ ] **Step 4: Run + verify pass**

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts && npm run typecheck --workspace backend`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/community
git commit -m "feat(community): opt-in published profiles with mural body and published content"
```

---

### Task 9: Community service — events feed

**Files:**
- Modify: `backend/src/modules/community/service.ts`
- Test: `backend/src/modules/community/service.test.ts` (+5 tests)

**Interfaces:**
- Produces: `CommunityService` gains `getFeed(viewerId, cursor, limit): Page<FeedItem>` — keyset-paginated via `encodeCursor`/`decodeCursor`, dropping rows whose content (`get` returns undefined or owner mismatch) or actor (no `ReaderProfile`) is gone.

- [ ] **Step 1: Write the failing tests**

Append to `service.test.ts`; extend the service import with `InvalidCursorError` from `./domain/errors.js`:

```ts
test("feed merges followees' events newest first and paginates by keyset", () => {
  const { repo, profiles, events } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice"));
  profiles.set("bob", profileRow("bob"));
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { createdAt: "2026-09-02T00:00:00.000Z" }));
  tournamentRefs.set("g1", tournRef("g1", "bob", { createdAt: "2026-09-01T00:00:00.000Z" }));
  events.push(
    { id: "e1", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", created_at: "2026-09-02T00:00:00.000Z" },
    { id: "e2", user_id: "bob", type: "tournament_published", ref_type: "tournament", ref_id: "g1", created_at: "2026-09-01T00:00:00.000Z" }
  );
  service.follow("me", "alice");
  service.follow("me", "bob");

  const page1 = service.getFeed("me", undefined, 1);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.items[0].id, "e1");
  assert.equal(page1.items[0].actor.username, "user-alice");
  assert.equal(page1.items[0].content.kind, "tierlist");
  assert.notEqual(page1.nextCursor, null);

  const page2 = service.getFeed("me", page1.nextCursor!, 1);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].id, "e2");
  assert.equal(page2.items[0].content.kind, "tournament");
  assert.equal(page2.nextCursor, null);
});

test("feed drops events whose content vanished", () => {
  const { repo, profiles, events } = createRepoFake();
  const { deps, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice"));
  readerProfiles.set("alice", reader("alice"));
  events.push({ id: "e1", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "gone", created_at: "2026-09-02T00:00:00.000Z" });
  service.follow("me", "alice");
  assert.deepEqual(service.getFeed("me", undefined, 10), { items: [], nextCursor: null });
});

test("feed drops events whose actor has no reader profile", () => {
  const { repo, profiles, events } = createRepoFake();
  const { deps, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice"));
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  events.push({ id: "e1", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", created_at: "2026-09-02T00:00:00.000Z" });
  service.follow("me", "alice");
  assert.deepEqual(service.getFeed("me", undefined, 10), { items: [], nextCursor: null });
});

test("feed ignores events from people you don't follow", () => {
  const { repo, profiles, events } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice"));
  profiles.set("bob", profileRow("bob"));
  readerProfiles.set("bob", reader("bob"));
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  events.push({ id: "e1", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", created_at: "2026-09-02T00:00:00.000Z" });
  service.follow("me", "bob");
  assert.deepEqual(service.getFeed("me", undefined, 10), { items: [], nextCursor: null });
});

test("an unparseable cursor is a 400-worthy error, not an empty page", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getFeed("me", "garbage", 10), InvalidCursorError);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts`
Expected: FAIL — `getFeed` is not a function.

- [ ] **Step 3: Implement**

Extend the shared-community import with `decodeCursor, encodeCursor, FeedItem, Page, PublishedContent`; add `InvalidCursorError` to the errors import; add `EventRow` to the domain types import; add to `service.ts` (module level):

```ts
function byNewestFirst(a: EventRow, b: EventRow): number {
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
  return a.id < b.id ? 1 : -1;
}
```

Extend `CommunityService` with `getFeed(viewerId: string, cursor: string | undefined, limit: number): Page<FeedItem>;` and implement:

```ts
    getFeed(viewerId, cursor, limit) {
      const keyset = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !keyset) throw new InvalidCursorError();
      const collected: EventRow[] = [];
      for (const followeeId of repo.listFollowees(viewerId)) {
        collected.push(...repo.listEventsByUser(followeeId, keyset ?? undefined, limit + 1));
      }
      collected.sort(byNewestFirst);
      const items: FeedItem[] = [];
      let nextCursor: string | null = null;
      for (const event of collected) {
        if (items.length === limit) {
          nextCursor = encodeCursor({ createdAt: event.created_at, id: event.id });
          break;
        }
        if (event.ref_type === "tierlist") {
          const ref = deps.tierlists.get(event.ref_id);
          const actor = ref && ref.ownerUserId === event.user_id ? deps.resolveProfiles([event.user_id]).get(event.user_id) : undefined;
          if (ref && actor) {
            items.push({ id: event.id, actor, type: event.type, content: toTierlistSummary(ref), createdAt: event.created_at });
          }
        } else {
          const ref = deps.tournaments.get(event.ref_id);
          const actor = ref && ref.ownerUserId === event.user_id ? deps.resolveProfiles([event.user_id]).get(event.user_id) : undefined;
          if (ref && actor) {
            items.push({ id: event.id, actor, type: event.type, content: toTournamentSummary(ref), createdAt: event.created_at });
          }
        }
      }
      return { items, nextCursor };
    }
```

- [ ] **Step 4: Run + verify pass**

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts && npm run typecheck --workspace backend`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/community
git commit -m "feat(community): keyset-paginated followees' publish feed"
```

---

### Task 10: Community service — discover + people search

**Files:**
- Modify: `backend/src/modules/community/service.ts`
- Test: `backend/src/modules/community/service.test.ts` (+4 tests)

**Interfaces:**
- Produces: `CommunityService` gains `getDiscover(type: DiscoverType, q: string, limit: number, offset: number): { items: DiscoverItem[]; nextOffset: number | null }` and `searchPeople(viewerId, q, limit): PersonResult[]`.

- [ ] **Step 1: Write the failing tests**

Append to `service.test.ts`:

```ts
test("discover merges both content kinds newest first", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { createdAt: "2026-09-02T00:00:00.000Z" }));
  tournamentRefs.set("g1", tournRef("g1", "bob", { createdAt: "2026-09-01T00:00:00.000Z" }));

  const page = service.getDiscover("all", "", 10, 0);
  assert.deepEqual(
    page.items.map((item) => [item.content.kind, item.author.username]),
    [["tierlist", "user-alice"], ["tournament", "user-bob"]]
  );
  assert.equal(page.nextOffset, null);
});

test("discover filters by type and by name substring, and paginates by offset", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { name: "Fantasy ranked" }));
  tierlistRefs.set("t2", tierRef("t2", "alice", { createdAt: "2026-09-04T00:00:00.000Z" }));
  tournamentRefs.set("g1", tournRef("g1", "alice"));

  assert.deepEqual(service.getDiscover("tournament", "", 10, 0).items.map((i) => i.content.kind), ["tournament"]);
  const searched = service.getDiscover("all", "fantasy", 10, 0);
  assert.deepEqual(searched.items.map((i) => i.content.name), ["Fantasy ranked"]);

  const page1 = service.getDiscover("all", "", 1, 0);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.nextOffset, 1);
  const page2 = service.getDiscover("all", "", 1, 1);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.nextOffset, 2);
  const page3 = service.getDiscover("all", "", 1, 2);
  assert.equal(page3.items.length, 1);
  assert.equal(page3.nextOffset, null);
});

test("discover drops rows whose author has no reader profile", () => {
  const { repo } = createRepoFake();
  const { deps, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  assert.deepEqual(service.getDiscover("all", "", 10, 0), { items: [], nextOffset: null });
});

test("people search excludes self and unpublished profiles", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  usernames.set("alina", "alina");
  usernames.set("bob", "bobby");
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("alina", reader("alina"));
  profiles.set("alice", profileRow("alice"));
  profiles.set("alina", profileRow("alina", { published: 0 }));

  const results = service.searchPeople("me", "ali", 10);
  assert.deepEqual(results.map((r) => r.user.username), ["user-alice"]);
  assert.deepEqual(results.map((r) => r.viewerFollows), [false]);

  service.follow("me", "alice");
  const after = service.searchPeople("me", "ali", 10);
  assert.deepEqual(after.map((r) => r.viewerFollows), [true]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts`
Expected: FAIL — `getDiscover` is not a function.

- [ ] **Step 3: Implement**

Extend the shared-community import with `DiscoverItem, DiscoverType, PersonResult`; add to `service.ts` (module level):

```ts
const DISCOVER_SCAN_CAP = 500;
```

Extend `CommunityService` with:

```ts
  getDiscover(type: DiscoverType, q: string, limit: number, offset: number): { items: DiscoverItem[]; nextOffset: number | null };
  searchPeople(viewerId: string, q: string, limit: number): PersonResult[];
```

Implement:

```ts
    getDiscover(type, q, limit, offset) {
      const needle = q.trim().toLowerCase();
      const window = Math.min(offset + limit, DISCOVER_SCAN_CAP);
      const entries: Array<{ userId: string; content: PublishedContent; createdAt: string }> = [];
      if (type !== "tournament") {
        for (const ref of deps.tierlists.list(window, 0)) entries.push({ userId: ref.ownerUserId, content: toTierlistSummary(ref), createdAt: ref.createdAt });
      }
      if (type !== "tierlist") {
        for (const ref of deps.tournaments.list(window, 0)) entries.push({ userId: ref.ownerUserId, content: toTournamentSummary(ref), createdAt: ref.createdAt });
      }
      const authors = deps.resolveProfiles([...new Set(entries.map((e) => e.userId))]);
      const visible = entries
        .flatMap((entry) => {
          const author = authors.get(entry.userId);
          if (!author) return [];
          if (needle && !entry.content.name.toLowerCase().includes(needle)) return [];
          return [{ author, content: entry.content, createdAt: entry.createdAt }];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        items: visible.slice(offset, offset + limit).map(({ author, content }) => ({ author, content })),
        nextOffset: offset + limit < visible.length ? offset + limit : null
      };
    },
    searchPeople(viewerId, q, limit) {
      const needle = q.trim();
      if (!needle) return [];
      const candidates = deps.searchUsernameOwners(needle, limit * 2).filter((id) => id !== viewerId);
      const visible = candidates.filter((id) => repo.getProfileRow(id)?.published === 1).slice(0, limit);
      const authors = deps.resolveProfiles(visible);
      return visible.flatMap((id) => {
        const user = authors.get(id);
        if (!user) return [];
        return [{ user, followerCount: repo.countFollowers(id), viewerFollows: repo.getFollow(viewerId, id) !== undefined }];
      });
    }
```

- [ ] **Step 4: Run + verify pass**

Run: `cd backend && npx tsx --test src/modules/community/service.test.ts && npm run typecheck --workspace backend`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/community
git commit -m "feat(community): discover feed and people search"
```

---

### Task 11: Community routes, plugin, app wiring, end-to-end verify

**Files:**
- Create: `backend/src/modules/community/routes.ts`
- Create: `backend/src/modules/community/routes.test.ts`
- Create: `backend/src/modules/community/plugin.ts`
- Create: `backend/src/modules/community/index.ts`
- Modify: `backend/src/modules/arena/index.ts` (+ `getArenaPublicApi` export)
- Modify: `backend/src/app.ts` (wiring)
- Modify: `backend/package.json` (append the routes test to the `test` script)

**Interfaces:**
- Consumes: everything built so far. `getOptionalAuthenticatedUser(request): AuthenticatedUser | null` (auth/guard.ts).
- Produces: HTTP surface `POST/DELETE /community/follows`, `PUT/DELETE /community/profile/publish`, `GET /community/feed`, `GET /community/people` (authed); `GET /community/profiles/:username`, `GET /community/discover` (public, rate-limited, no-store). `registerCommunityModule(app, deps)` and `getCommunityPublicApi()` for app.ts.

- [ ] **Step 1: Write the failing routes test**

The public scope only — the authed handlers need the JWT decorator stack; their shape is line-for-line the arena module's proven authed-route pattern and the service beneath them is fully tested.

```ts
// backend/src/modules/community/routes.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { ProfileNotFoundError } from "./domain/errors.js";
import { buildPublicCommunityRoutes } from "./routes.js";
import type { CommunityService } from "./service.js";

function fakeService(overrides: Partial<CommunityService> = {}): CommunityService {
  return {
    follow: () => {},
    unfollow: () => {},
    getFollowState: () => ({ following: false, followerCount: 0, followingCount: 0 }),
    publishProfile: () => {},
    unpublishProfile: () => {},
    getProfileByUsername: () => {
      throw new ProfileNotFoundError();
    },
    getFeed: () => ({ items: [], nextCursor: null }),
    getDiscover: () => ({ items: [], nextOffset: null }),
    searchPeople: () => [],
    emitEvent: () => {},
    ...overrides
  };
}

test("public profile 404s when unpublished", async () => {
  const app = Fastify();
  await app.register(buildPublicCommunityRoutes(fakeService()));
  const res = await app.inject({ method: "GET", url: "/community/profiles/ghost" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("discover passes type/q/limit/offset through", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const app = Fastify();
  await app.register(
    buildPublicCommunityRoutes(
      fakeService({
        getDiscover: (type, q, limit, offset) => {
          seen.push({ type, q, limit, offset });
          return { items: [], nextOffset: null };
        }
      })
    )
  );
  const res = await app.inject({ method: "GET", url: "/community/discover?type=tierlist&q=fantasy&limit=5&offset=5" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, [{ type: "tierlist", q: "fantasy", limit: 5, offset: 5 }]);
  await app.close();
});

test("discover rejects a bad type with 400", async () => {
  const app = Fastify();
  await app.register(buildPublicCommunityRoutes(fakeService()));
  const res = await app.inject({ method: "GET", url: "/community/discover?type=nope" });
  assert.equal(res.statusCode, 400);
  await app.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx tsx --test src/modules/community/routes.test.ts`
Expected: FAIL — `./routes.js` doesn't exist.

- [ ] **Step 3: Write `routes.ts`**

```ts
// backend/src/modules/community/routes.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { CommunityError, InvalidCursorError, ProfileNotFoundError } from "./domain/errors.js";
import type { CommunityService } from "./service.js";

const followSchema = z.object({ userId: z.string().min(1) });
const publishSchema = z.object({ muralId: z.string().min(1) });
const feedQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
const peopleQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
const discoverQuerySchema = z.object({
  type: z.enum(["all", "tierlist", "tournament"]).default("all"),
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

function statusForCommunityError(err: CommunityError): number {
  if (err instanceof ProfileNotFoundError) return 404;
  if (err instanceof InvalidCursorError) return 400;
  return 400;
}

export function buildCommunityRoutes(service: CommunityService) {
  return async function communityRoutes(app: FastifyInstance) {
    app.post("/community/follows", { preHandler: authGuard }, async (request, reply) => {
      const parsed = followSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {userId}." });
      try {
        service.follow(request.user.id, parsed.data.userId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.delete("/community/follows/:userId", { preHandler: authGuard }, async (request, reply) => {
      const { userId } = request.params as { userId: string };
      try {
        service.unfollow(request.user.id, userId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.put("/community/profile/publish", { preHandler: authGuard }, async (request, reply) => {
      const parsed = publishSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {muralId}." });
      try {
        service.publishProfile(request.user.id, parsed.data.muralId);
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.delete("/community/profile/publish", { preHandler: authGuard }, async (request, reply) => {
      service.unpublishProfile(request.user.id);
      return reply.code(204).send();
    });

    app.get("/community/feed", { preHandler: authGuard }, async (request, reply) => {
      const parsed = feedQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid cursor/limit." });
      try {
        return reply.send(service.getFeed(request.user.id, parsed.data.cursor, parsed.data.limit));
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.get("/community/people", { preHandler: authGuard }, async (request, reply) => {
      const parsed = peopleQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Expected ?q= and optional ?limit=." });
      return reply.send({ people: service.searchPeople(request.user.id, parsed.data.q, parsed.data.limit) });
    });
  };
}

export function buildPublicCommunityRoutes(service: CommunityService) {
  return async function publicCommunityRoutes(app: FastifyInstance) {
    app.get("/community/profiles/:username", async (request, reply) => {
      const { username } = request.params as { username: string };
      try {
        const viewer = getOptionalAuthenticatedUser(request);
        const view = service.getProfileByUsername(username, viewer?.id);
        reply.header("Cache-Control", "no-store");
        return reply.send(view);
      } catch (err) {
        if (err instanceof ProfileNotFoundError) return reply.code(404).send({ error: "No published profile at that address." });
        throw err;
      }
    });

    app.get("/community/discover", async (request, reply) => {
      const parsed = discoverQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid type/q/limit/offset." });
      reply.header("Cache-Control", "no-store");
      return reply.send(service.getDiscover(parsed.data.type, parsed.data.q, parsed.data.limit, parsed.data.offset));
    });
  };
}
```

`statusForCommunityError` currently maps everything not-404 to 400 — keep the two named branches anyway; Tasks in plan 2 (web) rely on the 404/400 distinction, and new error classes slot into the one function.

- [ ] **Step 4: Write `plugin.ts` and `index.ts`**

Add to `service.ts` (module level — the emission surface app.ts hands to tierlists/arena):

```ts
export interface CommunityPublicApi {
  emitEvent(userId: string, type: CommunityEventType, refType: CommunityRefType, refId: string): void;
}

export function createCommunityPublicApi(repo: CommunityRepository): CommunityPublicApi {
  return {
    emitEvent(userId, type, refType, refId) {
      repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, created_at: new Date().toISOString() });
    }
  };
}
```

```ts
// backend/src/modules/community/plugin.ts
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openCommunityDb } from "./adapters/sqlite/connection.js";
import { createSqliteCommunityRepository } from "./adapters/sqlite/sqliteCommunityRepository.js";
import { buildCommunityRoutes, buildPublicCommunityRoutes } from "./routes.js";
import type { CommunityDeps, CommunityPublicApi } from "./service.js";
import { createCommunityPublicApi, createCommunityService } from "./service.js";

export async function communityPlugin(app: FastifyInstance, opts: CommunityDeps) {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const service = createCommunityService({ ...opts, repo });

  await app.register(buildCommunityRoutes(service));

  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicCommunityRoutes(service));
  });
}

let cachedPublicApi: CommunityPublicApi | null = null;

export function getCommunityPublicApi(): CommunityPublicApi {
  if (!cachedPublicApi) {
    cachedPublicApi = createCommunityPublicApi(createSqliteCommunityRepository(openCommunityDb()));
  }
  return cachedPublicApi;
}
```

```ts
// backend/src/modules/community/index.ts
export { communityPlugin as registerCommunityModule, getCommunityPublicApi } from "./plugin.js";
export type { CommunityPublicApi } from "./service.js";
```

- [ ] **Step 5: Wire `app.ts`**

In `backend/src/app.ts` — imports:

```ts
import { getArenaPublicApi, registerArenaModule } from "./modules/arena/index.js";
import { getCommunityPublicApi, registerCommunityModule } from "./modules/community/index.js";
import { getMuralsPublicApi } from "./modules/murals/index.js";
import {
  findUserIdByUsername,
  resolvePublicReaderProfile,
  resolvePublicReaderProfiles,
  searchUsernameOwners,
  userHasUsername
} from "./modules/auth/index.js";
```

(Adjust the existing `registerArenaModule` import line rather than duplicating it; `murals/index.ts` already exports `getMuralsPublicApi` since Task 5.)

In `arena/index.ts`, add:

```ts
export { getArenaPublicApi } from "./plugin.js";
```

Registration — community right after murals; arena and tierlists registrations gain their `emitPublished` adapters:

```ts
  app.register(registerMuralsModule, {
    getTierlistData: getTierlistsPublicApi().getTierlistData
  });
  app.register(registerCommunityModule, {
    resolveProfile: resolvePublicReaderProfile,
    resolveProfiles: resolvePublicReaderProfiles,
    userHasUsername,
    findUserIdByUsername,
    searchUsernameOwners,
    murals: getMuralsPublicApi(getTierlistsPublicApi().getTierlistData),
    tierlists: getTierlistsPublicApi(),
    tournaments: getArenaPublicApi()
  });
  app.register(registerArenaModule, {
    emitPublished: (tournamentId, ownerUserId) => getCommunityPublicApi().emitEvent(ownerUserId, "tournament_published", "tournament", tournamentId)
  });
```

and the existing tierlists registration becomes:

```ts
  app.register(registerTierlistsModule, {
    emitPublished: (copyId, ownerUserId) => getCommunityPublicApi().emitEvent(ownerUserId, "tierlist_published", "tierlist", copyId)
  });
```

Append ` src/modules/community/routes.test.ts` to `backend/package.json`'s `test` script.

- [ ] **Step 6: Full verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: clean build, clean typecheck, all tests PASS (now including community repo/service/routes).

Boot smoke (skip if `backend/.env` doesn't exist):

```bash
cd backend && (PORT=3999 npx tsx src/server.ts &) && sleep 3 && curl -s http://localhost:3999/community/discover && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3999/community/profiles/nobody && pkill -f "tsx src/server.ts"
```

Expected: `{"items":[],"nextOffset":null}` then `404`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/community backend/src/modules/arena/index.ts backend/src/app.ts backend/package.json
git commit -m "feat(community): routes, plugin, and app wiring — community API is live"
```

---

## Plan-complete checklist

- [ ] `npm run build --workspace @scripta/shared` — green
- [ ] `npm run typecheck --workspace backend` — green
- [ ] `npm test --workspace backend` — green, including the three new test files in the explicit list
- [ ] Boot smoke: `/community/discover` returns an empty page; unknown profile 404s
- [ ] `openVoting` + arena `start` each emit exactly one event (covered by their service tests)

Plans 2 (web) and 3 (mobile) consume this API and the shared types; run this plan first.
