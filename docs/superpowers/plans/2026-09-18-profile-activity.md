# Profile Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Mural | Activity tab pair to community profiles (own and others') backed by six event types with per-category public visibility settings, plus add-to-my-library sheets on public book contexts.

**Architecture:** Server-side event recording only — community events table gains a payload column and per-type partial unique indexes; the library save path diffs blobs to emit book events (skipped for imports via an explicit `source` flag); arena votes and tierlist ballots emit condensed `voted_on` events; a public keyset-paginated activity endpoint filters categories by the owner's `feedSettings`. Both clients render tabs on the existing profile screens and add a shared-status "add book" sheet to shared library, tournament, and tierlist vote pages.

**Tech Stack:** Fastify + node:sqlite + zod (backend), TypeScript library `@scripta/shared` (build with tsc), React 19 + Vite + TanStack Query (web), Expo Router + React Query + react-native (mobile), `node:test` via tsx everywhere (no vitest/jest).

**Spec:** `docs/superpowers/specs/2026-09-18-profile-activity-design.md` — plus two amendments recorded in Task 12 (import saves ride `PUT /library` and carry `source: "import"`; vote emission is best-effort with a logged error instead of failing the vote response).

## Global Constraints

- Verify shared before consumers: `npm run build --workspace @scripta/shared` before any consumer typecheck/test.
- Backend tests are an **explicit file list** in `backend/package.json` `"test"` — every new `*.test.ts` must be appended or CI never runs it.
- Frontend tests are `scripts/test-*.mts` (globbed); mobile tests are `src/**/*.test.ts` (globbed). Both are pure-logic `node:test` — no component rendering anywhere.
- No new env vars. No new dependencies. `@scripta/shared` must stay platform-free (no React, no node APIs).
- Never weaken auth, validation, or error handling to make a test pass.
- Commit after every task. Terse imperative commit messages, no comments-in-code unless the surrounding file uses them.
- Working tree may contain unrelated in-progress mobile changes (`collection/`, `GroupDetail`, etc.) — **stage only files this plan touches**, never `git add -A` / `git add .`.

## File Structure (map of all changes)

**Shared** — `packages/shared/src/community/types.ts` (activity types), `helpers.ts` (category/settings/text helpers). Consumers read `dist/`.

**Backend community** — `adapters/sqlite/schema.sql` (events rebuild + `profiles.feed_settings`), `adapters/sqlite/connection.ts` (guarded migration), `domain/types.ts` (EventRow.payload, ProfileRow.feed_settings, ref types), `domain/ports.ts` (repo signatures), `service.ts` (emissions, `getActivity`, feed settings, dashboard filter), `routes.ts` (activity + feed-settings endpoints), `plugin.ts` (untouched), plus test fakes in `routes.test.ts` / `service.test.ts`.

**Backend cross-module** — `arena/service.ts` + `tierlists/service.ts` (`voted_on` hooks), `library/service.ts` (save diff + `addBook`), `library/routes.ts` (`POST /library/books`, `source` flag), `app.ts` (hook wiring).

**Frontend** — `api/community.ts`, `api/library.ts`, `hooks/useCommunity.ts`, new `components/AddBookSheet.tsx`, `pages/CommunityProfilePage.tsx` (tabs/activity/settings), `pages/SharedLibraryPage.tsx`, `pages/ArenaViewPage.tsx` + `components/arena/DuelCard.tsx`, `pages/VoteTierlistPage.tsx`, `pages/LibraryPage.tsx` (import flag), new `scripts/test-activity-helpers.mts`.

**Mobile** — `features/community/api.ts`, new `features/community/ActivityList.tsx` + `FeedSettingsDialog.tsx` + `AddBookSheet.tsx`, new `features/library/lib/recommendation.ts` (+test), `features/community/ProfileScreen.tsx`, `features/public/SharedLibraryScreen.tsx`, `features/arena/ArenaViewScreen.tsx` + `ArenaBooksSheet.tsx`, `features/tierlists/VoteTierlistScreen.tsx`, `features/library/hooks/useLibraryActions.ts` (import flag).

---

### Task 1: Shared activity types and helpers

**Files:**
- Modify: `packages/shared/src/community/types.ts`
- Modify: `packages/shared/src/community/helpers.ts`
- Test: `frontend/scripts/test-activity-helpers.mts` (new; auto-globbed by frontend `tsx --test scripts/test-*.mts`)

**Interfaces:**
- Produces (used by every later task): `ActivityEventType`, `FeedCategory`, `FeedSettings`, `DEFAULT_FEED_SETTINGS`, `normalizeFeedSettings(v: unknown): FeedSettings | null`, `categoryFor(type: ActivityEventType): FeedCategory`, `ActivityItem`, `BookRecommendationInput`, `activityText(item: ActivityItem): { verb: string; target: string; href: string | null }`.

- [ ] **Step 1: Add types to `packages/shared/src/community/types.ts`** (append; keep `CommunityEventType` exactly as-is — the dashboard feed still uses it):

```ts
export type ActivityEventType =
  | CommunityEventType
  | "book_added"
  | "book_finished"
  | "following"
  | "mural_published"
  | "voted_on";

export interface ActivityItem {
  id: string;
  type: ActivityEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type FeedCategory = "publications" | "reading" | "votes" | "follows";

export interface FeedSettings {
  publications: boolean;
  reading: boolean;
  votes: boolean;
  follows: boolean;
}

export interface BookRecommendationInput {
  title: string;
  author: string;
  isbn?: string | null;
  coverUrl?: string | null;
  readStatus: 0 | 1 | 2;
}
```

- [ ] **Step 2: Add helpers to `packages/shared/src/community/helpers.ts`.** Top import: `import { statusLabel } from "../library/covers.js";` plus types from `./types.js`. Then:

```ts
export const DEFAULT_FEED_SETTINGS: FeedSettings = {
  publications: true,
  reading: false,
  votes: true,
  follows: true
};

export function normalizeFeedSettings(value: unknown): FeedSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const keys: FeedCategory[] = ["publications", "reading", "votes", "follows"];
  const out: Partial<FeedSettings> = {};
  for (const k of keys) {
    if (typeof v[k] !== "boolean") return null;
    out[k] = v[k] as boolean;
  }
  return out as FeedSettings;
}

export function categoryFor(type: ActivityEventType): FeedCategory {
  if (type === "book_added" || type === "book_finished") return "reading";
  if (type === "voted_on") return "votes";
  if (type === "following") return "follows";
  return "publications";
}

export function activityText(item: ActivityItem): { verb: string; target: string; href: string | null } {
  switch (item.type) {
    case "tierlist_published":
      return { verb: "Published a tierlist", target: String(item.payload.name ?? ""), href: (item.payload.href as string | undefined) ?? null };
    case "tournament_published":
      return { verb: "Published a tournament", target: String(item.payload.name ?? ""), href: (item.payload.href as string | undefined) ?? null };
    case "book_added":
      return { verb: "Added", target: `${String(item.payload.title ?? "")} — ${statusLabel(Number(item.payload.status ?? 0))}`, href: null };
    case "book_finished":
      return { verb: "Finished", target: String(item.payload.title ?? ""), href: null };
    case "following":
      return { verb: "Followed", target: `@${String(item.payload.username ?? "")}`, href: null };
    case "mural_published":
      return { verb: "Published", target: "a mural", href: null };
    case "voted_on":
      return item.payload.game === "tierlist"
        ? { verb: "Ranked books on", target: String(item.payload.name ?? ""), href: null }
        : { verb: "Voted in", target: String(item.payload.name ?? ""), href: null };
  }
}
```

- [ ] **Step 3: Write the failing helper test** `frontend/scripts/test-activity-helpers.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FEED_SETTINGS,
  activityText,
  categoryFor,
  normalizeFeedSettings
} from "../../packages/shared/dist/community/index.js";

test("categoryFor maps every activity type", () => {
  assert.equal(categoryFor("tierlist_published"), "publications");
  assert.equal(categoryFor("tournament_published"), "publications");
  assert.equal(categoryFor("mural_published"), "publications");
  assert.equal(categoryFor("book_added"), "reading");
  assert.equal(categoryFor("book_finished"), "reading");
  assert.equal(categoryFor("voted_on"), "votes");
  assert.equal(categoryFor("following"), "follows");
});

test("normalizeFeedSettings accepts only full boolean objects", () => {
  assert.deepEqual(normalizeFeedSettings({ publications: true, reading: false, votes: true, follows: true }), {
    publications: true, reading: false, votes: true, follows: true
  });
  assert.equal(normalizeFeedSettings({ publications: true }), null);
  assert.equal(normalizeFeedSettings({ publications: "yes", reading: false, votes: true, follows: true }), null);
  assert.equal(normalizeFeedSettings(null), null);
  assert.equal(normalizeFeedSettings(undefined), null);
});

test("defaults keep reading private", () => {
  assert.equal(DEFAULT_FEED_SETTINGS.reading, false);
  assert.equal(DEFAULT_FEED_SETTINGS.publications, true);
});

test("activityText renders each event kind", () => {
  assert.deepEqual(
    activityText({ id: "1", type: "book_added", payload: { title: "Dune", status: 0 }, createdAt: "x" }),
    { verb: "Added", target: "Dune — Not read", href: null }
  );
  assert.deepEqual(
    activityText({ id: "2", type: "tierlist_published", payload: { name: "Best of 2025", href: "/vote/abc" }, createdAt: "x" }),
    { verb: "Published a tierlist", target: "Best of 2025", href: "/vote/abc" }
  );
  assert.deepEqual(
    activityText({ id: "3", type: "voted_on", payload: { game: "tournament", name: "March Madness" }, createdAt: "x" }),
    { verb: "Voted in", target: "March Madness", href: null }
  );
  assert.deepEqual(
    activityText({ id: "4", type: "voted_on", payload: { game: "tierlist", name: "Cosy reads" }, createdAt: "x" }),
    { verb: "Ranked books on", target: "Cosy reads", href: null }
  );
  assert.deepEqual(
    activityText({ id: "5", type: "following", payload: { username: "mia" }, createdAt: "x" }),
    { verb: "Followed", target: "@mia", href: null }
  );
  assert.deepEqual(
    activityText({ id: "6", type: "mural_published", payload: { muralId: "m1" }, createdAt: "x" }),
    { verb: "Published", target: "a mural", href: null }
  );
});
```

- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared` then `npm test --workspace frontend`. Expected: build succeeds; `test-activity-helpers` passes (statusLabel(0) must read "Not read" — check `packages/shared/src/library/covers.ts:40-43`; if the label differs, assert against the real label).

- [ ] **Step 5: Commit** — `git add packages/shared/src/community/types.ts packages/shared/src/community/helpers.ts frontend/scripts/test-activity-helpers.mts && git commit -m "feat(shared): activity event types, feed settings, activity text helpers"`

---

### Task 2: Community schema migration — events payload + per-type uniqueness + feed_settings

**Files:**
- Modify: `backend/src/modules/community/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/community/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/community/domain/types.ts`
- Modify: `backend/src/modules/community/domain/ports.ts`
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts`
- Test: `backend/src/modules/community/adapters/sqlite/schema.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `EventRow` gains `payload: string | null`; `ProfileRow` gains `feed_settings: string | null`; `CommunityRefType = "tierlist" | "tournament" | "book" | "user" | "mural"`; repo `insertEvent(row: EventRow): void` (unchanged signature, new column), `getFeedSettings(userId): FeedSettings | null` (null = row missing), `updateFeedSettings(userId, settings: FeedSettings): void`, `listEventsByUser` unchanged signature (rows now carry payload).

- [ ] **Step 1: Write the failing migration test** `backend/src/modules/community/adapters/sqlite/schema.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

process.env.COMMUNITY_DB_PATH = join(mkdtempSync(join(tmpdir(), "community-schema-")), "community.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret";

const { openCommunityDb } = await import("./connection.js");

test("fresh database gets events payload column, partial unique indexes, and profiles.feed_settings", () => {
  const db = openCommunityDb();
  const eventCols = (db.prepare("PRAGMA table_info(events)").getAll() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(eventCols.includes("payload"));
  const profileCols = (db.prepare("PRAGMA table_info(profiles)").getAll() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(profileCols.includes("feed_settings"));
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").getAll() as Array<{ name: string }>).map((r) => r.name);
  assert.ok(indexes.includes("idx_events_publication_ref"));
  assert.ok(indexes.includes("idx_events_user_type_ref"));
});

test("legacy events table is rebuilt preserving rows and dropping the global unique", async () => {
  const legacyPath = process.env.COMMUNITY_DB_PATH + ".legacy";
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (ref_type, ref_id)
    );
    INSERT INTO events (id, user_id, type, ref_type, ref_id, created_at)
      VALUES ('e1', 'u1', 'tierlist_published', 'tierlist', 't1', '2026-01-01T00:00:00.000Z'),
             ('e2', 'u2', 'tierlist_published', 'tierlist', 't1', '2026-01-02T00:00:00.000Z');
  `);
  legacy.close();

  process.env.COMMUNITY_DB_PATH = legacyPath;
  const mod = await import("./connection.js");
  const db = mod.openCommunityDb();
  const rows = db.prepare("SELECT id, payload FROM events ORDER BY id").all() as Array<{ id: string; payload: string | null }>;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].payload, null);
  const eventCols = (db.prepare("PRAGMA table_info(events)").getAll() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(eventCols.includes("payload"));
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").getAll() as Array<{ name: string }>).map((r) => r.name);
  assert.ok(indexes.includes("idx_events_publication_ref"));
  db.close();
});
```

Note: `openCommunityDb` reads `env.COMMUNITY_DB_PATH` once per call via `config/env.js` — if env is frozen at import time in this module, instead create the legacy DB at the SAME path the module already resolved (write legacy schema into `process.env.COMMUNITY_DB_PATH` with a raw `DatabaseSync` before the first `openCommunityDb()` call in that test file run, in a second test *file* if needed). Adapt to whichever ordering works; the assertions stay as written.

- [ ] **Step 2: Add the test file to `backend/package.json` "test"** — append ` src/modules/community/adapters/sqlite/schema.test.ts` to the explicit list.

- [ ] **Step 3: Run it, expect failure** — `npm test --workspace backend 2>&1 | rg "schema.test"`. Expected: FAIL (no payload column / no indexes).

- [ ] **Step 4: Rewrite `schema.sql`** — replace the `events` table and its index block with:

```sql
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_publication_ref
  ON events(ref_type, ref_id)
  WHERE type IN ('tierlist_published', 'tournament_published');
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_user_type_ref
  ON events(user_id, type, ref_id)
  WHERE type IN ('voted_on', 'following', 'mural_published');
```

And `profiles` gains nothing in `schema.sql` (column added by connection migration so existing DBs get it too).

- [ ] **Step 5: Add the guarded migration to `connection.ts`** after `db.exec(schema);`:

```ts
function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).getAll() as Array<{ name: string }>).map((c) => c.name);
}

function migrateSchema(db: DatabaseSync): void {
  if (!tableColumns(db, "events").includes("payload")) {
    db.exec(`
      CREATE TABLE events_new (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
        ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
      );
      INSERT INTO events_new (id, user_id, type, ref_type, ref_id, payload, created_at)
        SELECT id, user_id, type, ref_type, ref_id, NULL, created_at FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
    `);
    db.exec(schema);
  }
  if (!tableColumns(db, "profiles").includes("feed_settings")) {
    db.exec("ALTER TABLE profiles ADD COLUMN feed_settings TEXT");
  }
}
```

Call `migrateSchema(db);` after the first `db.exec(schema);`. (Re-executing the schema after a rebuild restores the indexes the `DROP TABLE` removed.)

- [ ] **Step 6: Update domain types.** `domain/types.ts`: `import type { ActivityEventType } ...` — set `CommunityRefType = "tierlist" | "tournament" | "book" | "user" | "mural"`, `EventRow.type: ActivityEventType`, add `payload: string | null` to `EventRow`, add `feed_settings: string | null` to `ProfileRow`. `domain/ports.ts`: add `getFeedSettings(userId: string): FeedSettings | null;` and `updateFeedSettings(userId: string, settings: FeedSettings): void;` (import `FeedSettings` from `@scripta/shared/community`).

- [ ] **Step 7: Update the sqlite repository.** `insertEvent` statement gains `$payload`; bind `payload: row.payload === null ? null : row.payload` (service stringifies). `getProfileRow`'s `SELECT *` picks up `feed_settings` automatically. Add prepared statements:

```ts
const getFeedSettingsStmt = db.prepare("SELECT feed_settings FROM profiles WHERE user_id = ?");
const updateFeedSettingsStmt = db.prepare(`
  INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at, feed_settings)
  VALUES ($user_id, 0, NULL, NULL, $updated_at, $feed_settings)
  ON CONFLICT(user_id) DO UPDATE SET feed_settings = excluded.feed_settings, updated_at = excluded.updated_at
`);
```

with methods `getFeedSettings` (returns parsed-or-null: return the raw string; parsing happens in the service) — actually return `FeedSettings | null`: parse with `normalizeFeedSettings` from `@scripta/shared/community`, falling back to null. `updateFeedSettings` binds `JSON.stringify(settings)` and `new Date().toISOString()`.

- [ ] **Step 8: Run backend tests** — `npm test --workspace backend`. Existing community tests must still pass; fix the repo fake in `service.test.ts` (`createRepoFake`) by adding `payload: null` where it builds `EventRow`s and stub `getFeedSettings: () => null`, `updateFeedSettings: () => {}`.

- [ ] **Step 9: Commit** — schema, connection, domain, repository, schema.test.ts, package.json: `git commit -m "feat(community): events payload column, per-type unique indexes, feed_settings"`

---

### Task 3: Community service — emissions, activity endpoint, feed settings, dashboard filter

**Files:**
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/modules/community/routes.ts`
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts` (if it asserts EventRow literals)
- Modify: `backend/src/modules/community/service.test.ts`, `backend/src/modules/community/routes.test.ts` (fakes)
- Modify: `backend/package.json` (only if new test files — none planned)

**Interfaces:**
- Consumes: Task 1 helpers (`DEFAULT_FEED_SETTINGS`, `normalizeFeedSettings`, `categoryFor`, `Page<ActivityItem>`), Task 2 repo methods.
- Produces:
  - `CommunityService` gains: `getActivity(username: string, viewerId: string | undefined, cursor: string | undefined, limit: number): Page<ActivityItem>`; `getFeedSettings(userId: string): FeedSettings`; `updateFeedSettings(userId: string, settings: FeedSettings): void`.
  - `emitEvent` signature becomes `(userId: string, type: ActivityEventType, refType: CommunityRefType, refId: string, payload?: Record<string, unknown>): void` (same for `CommunityPublicApi.emitEvent`).
  - `PublicProfileView` gains `feedSettings?: FeedSettings` (set only when the viewer is the owner).
  - Dashboard skips publication events whose actor has `feedSettings.publications === false`.
  - `follow` emits `following` (ref = followee id, payload `{ username }`) only when the follow row was actually inserted — `repo.insertFollow` now returns `boolean` (port + sqlite `.changes > 0` + fakes).
  - `publishProfile` emits `mural_published` (ref = muralId) when `existing?.mural_id !== muralId`.

- [ ] **Step 1: Failing service tests first** (append to `service.test.ts`; reuse its `createRepoFake`/`createDeps`/`tierRef`/`tournRef` factories):

```ts
test("publishProfile emits mural_published only when the mural changes", () => {
  const repo = createRepoFake();
  const service = createCommunityService(createDeps(repo));
  repo.upsertProfile({ user_id: "u1", published: 1, mural_id: "m1", published_at: null, updated_at: "x", feed_settings: null });
  service.publishProfile("u1", "m1");
  assert.equal(repo.events.filter((e) => e.type === "mural_published").length, 0);
  service.publishProfile("u1", "m2");
  assert.equal(repo.events.filter((e) => e.type === "mural_published").length, 1);
});

test("follow emits following once; refollow emits nothing", () => {
  const repo = createRepoFake();
  const deps = createDeps(repo);
  const service = createCommunityService(deps);
  repo.upsertProfile({ user_id: "u2", published: 1, mural_id: null, published_at: null, updated_at: "x", feed_settings: null });
  service.follow("u1", "u2");
  service.unfollow("u1", "u2");
  service.follow("u1", "u2");
  const events = repo.events.filter((e) => e.type === "following");
  assert.equal(events.length, 1);
  assert.equal(events[0].ref_id, "u2");
});

test("getActivity filters categories by feed settings but not for the owner", () => {
  const repo = createRepoFake();
  const deps = createDeps(repo);
  const service = createCommunityService(deps);
  repo.upsertProfile({ user_id: "u1", published: 1, mural_id: null, published_at: null, updated_at: "x", feed_settings: null });
  repo.updateFeedSettings("u1", { publications: true, reading: false, votes: false, follows: true });
  service.emitEvent("u1", "book_added", "book", "b1", { title: "Dune", status: 0 });
  service.emitEvent("u1", "voted_on", "tournament", "t9", { game: "tournament", name: "X" });
  service.emitEvent("u1", "following", "user", "u2", { username: "mia" });
  const stranger = service.getActivity("owner-username", undefined, undefined, 20);
  assert.deepEqual(stranger.items.map((i) => i.type), ["following"]);
  const owner = service.getActivity("owner-username", "u1", undefined, 20);
  assert.equal(owner.items.length, 3);
});

test("getActivity 404s on unknown username and unpublished profile", () => {
  const repo = createRepoFake();
  const service = createCommunityService(createDeps(repo));
  assert.throws(() => service.getActivity("ghost", undefined, undefined, 20), ProfileNotFoundError);
  assert.throws(() => service.getActivity("owner-username", undefined, undefined, 20), ProfileNotFoundError);
});
```

(Adapt fixture names — `owner-username` must be the username `createDeps` resolves for `u1` via its `findUserIdByUsername` fake; mirror how existing `getProfileByUsername` tests do it.) Also add a dashboard test: with the actor's `publications = false`, `getDashboard` omits their publication event but still shows follow rows.

- [ ] **Step 2: Run, expect failures** (`npm test --workspace backend 2>&1 | rg "community/service"`).

- [ ] **Step 3: Implement in `service.ts`:**

1. Extend `CommunityService` and `CommunityPublicApi.emitEvent` per Interfaces. `emitEvent` implementation: `repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, payload: payload ? JSON.stringify(payload) : null, created_at: new Date().toISOString() })`.
2. `follow()`: `const inserted = repo.insertFollow(...); if (inserted) { const author = deps.resolveProfiles([followeeId]).get(followeeId); this.emitEvent(followerId, "following", "user", followeeId, { username: author?.username ?? "" }); }`
3. `publishProfile()`: capture `const previous = existing?.mural_id ?? null;` before upsert; after upsert `if (previous !== muralId) this.emitEvent(userId, "mural_published", "mural", muralId);`
4. Private `settingsFor(userId): FeedSettings` = `normalizeFeedSettings(JSON.parse-safe of repo.getFeedSettings(userId)?.feed_settings) ?? DEFAULT_FEED_SETTINGS` — wrap `JSON.parse` in try/catch returning null (corrupt JSON → defaults).
5. `getFeedSettings(userId)` returns `settingsFor`. `updateFeedSettings(userId, settings)` calls `repo.updateFeedSettings`.
6. `getActivity(username, viewerId, cursor, limit)`: `const userId = deps.findUserIdByUsername(username); if (!userId) throw ProfileNotFoundError; const row = repo.getProfileRow(userId); if (!row || row.published !== 1) throw ProfileNotFoundError;` keyset via `decodeCursor`/`InvalidCursorError` exactly like `getDashboard`. `const allowAll = viewerId === userId; const settings = allowAll ? null : settingsFor(userId);` fetch `repo.listEventsByUser(userId, keyset, limit + 1)`, then filter/map:

```ts
const items: ActivityItem[] = [];
let nextCursor: string | null = null;
let last: EventRow | undefined;
for (const event of events) {
  if (items.length === limit) { if (last) nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id }); break; }
  if (!allowAll && !settings[categoryFor(event.type)]) { last = event; continue; }
  const payload = parsePayload(event.payload);
  if (!payload) continue;
  if (event.type === "tierlist_published" || event.type === "tournament_published") {
    const enriched = enrichPublication(event, payload);
    if (!enriched) continue;
    items.push({ id: event.id, type: event.type, payload: enriched, createdAt: event.created_at });
  } else {
    items.push({ id: event.id, type: event.type, payload, createdAt: event.created_at });
  }
  last = event;
}
return { items, nextCursor };
```

where `parsePayload` JSON.parses in try/catch (corrupt row → `null` → row skipped) and `enrichPublication` resolves `deps.tierlists.get(refId)` / `deps.tournaments.get(refId)`, returning `{ ...payload, name: summary.name, href: contentTarget-like }` — compute href the same way the existing `feedTarget` does (`/vote/${voteCode}` for tierlists with a voteCode, `/arena/${id}` for tournaments) — or reuse `deps` summaries already mapped via `toTierlistSummary`/`toTournamentSummary` in this file. Content gone → skip the row (established fail-safe).

7. `getProfileByUsername`: after assembling `view`, `if (viewerId === userId) view.feedSettings = settingsFor(userId);` and add `feedSettings?: FeedSettings` to `PublicProfileView`.
8. `getDashboard`: in the publication branches, before pushing, look up (and memoize in a local `Map<string, FeedSettings>`) `settingsFor(event.user_id)` and `continue` when `settings.publications === false`. Follow rows unfiltered.

- [ ] **Step 4: Routes.** In `routes.ts` add `const feedSettingsSchema = z.object({ publications: z.boolean(), reading: z.boolean(), votes: z.boolean(), follows: z.boolean() });` and `const activityQuerySchema = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });`. Authed builder:

```ts
app.put("/community/profile/feed-settings", { preHandler: authGuard }, async (request, reply) => {
  const parsed = feedSettingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Expected { publications, reading, votes, follows } booleans." });
  service.updateFeedSettings(request.user.id, parsed.data);
  return reply.code(204).send();
});
```

Public builder (inside the same rate-limited registration):

```ts
app.get("/community/profiles/:username/activity", async (request, reply) => {
  const { username } = request.params as { username: string };
  const q = activityQuerySchema.safeParse(request.query);
  if (!q.success) return reply.code(400).send({ error: "Invalid activity query." });
  const viewer = getOptionalAuthenticatedUser(request);
  try {
    const page = service.getActivity(username, viewer?.id, q.data.cursor, q.data.limit);
    return reply.header("Cache-Control", "no-store").send(page);
  } catch (error) {
    if (error instanceof CommunityError) return reply.code(statusForCommunityError(error)).send({ error: error.message });
    throw error;
  }
});
```

- [ ] **Step 5: Update test fakes.** `routes.test.ts` `fakeService` gains `getActivity: () => ({ items: [], nextCursor: null })`, `getFeedSettings: () => DEFAULT_FEED_SETTINGS`, `updateFeedSettings: () => {}`. `service.test.ts` fake repo: `insertFollow` returns `true`, `getFeedSettings`/`updateFeedSettings` stubs, `events` array stores `payload`.

- [ ] **Step 6: Verify** — `npm test --workspace backend` and `npm run typecheck --workspace backend`. All green.

- [ ] **Step 7: Commit** — `git commit -m "feat(community): activity endpoint, feed settings, following/mural emissions"`

---

### Task 4: Arena `voted_on` emission

**Files:**
- Modify: `backend/src/modules/arena/service.ts`
- Modify: `backend/src/modules/arena/service.test.ts` (fake repo may need `getTournament`)

**Interfaces:**
- Consumes: nothing new from community yet (hook injected in Task 7).
- Produces: `createArenaService(repo, emitPublished?, emitVotedOn?)` where `export type EmitVotedOn = (voterUserId: string, tournamentId: string, tournamentName: string | null) => void;`

- [ ] **Step 1: Failing test** in `arena/service.test.ts` — build a service with a fake repo whose `insertVote` returns `true` and `getTournament` returns `{ name: "Spring Bracket", ... }`; call `vote()` with `voterUserId` set; assert the hook fired once with `("voter-1", "<tournamentId>", "Spring Bracket")`. Second call with `insertVote` returning `false` → `AlreadyVotedError` and **no** hook call. Anonymous vote (`voterUserId` null) with `insertVote` true → no hook call.

- [ ] **Step 2: Implement.** In `service.ts`: add the `EmitVotedOn` type, third optional factory param, and inside `vote()` after `if (!inserted) throw new AlreadyVotedError();`:

```ts
if (voterUserId && emitVotedOn) {
  emitVotedOn(voterUserId, tournamentId, repo.getTournament(tournamentId)?.name ?? null);
}
```

- [ ] **Step 3: Verify** — `npm test --workspace backend` (arena tests), `npm run typecheck --workspace backend`.

- [ ] **Step 4: Commit** — `git commit -m "feat(arena): emit voted_on hook on signed-in duel votes"`

---

### Task 5: Tierlist `voted_on` emission

**Files:**
- Modify: `backend/src/modules/tierlists/service.ts`
- Modify: `backend/src/modules/tierlists/service.test.ts`

**Interfaces:**
- Produces: `createTierlistsService(repo, emitPublished?, emitVotedOn?)` where `export type EmitVotedOn = (voterUserId: string, tierlistId: string, tierlistName: string, placementCount: number) => void;`

- [ ] **Step 1: Failing test** — service with fake repo; `submitBallot(code, placements, { kind: "user", userId: "voter-1" })` where no prior ballot exists → hook fires once with placement count; second `submitBallot` (edit, same voter) → no second hook call; anonymous voter (`{ kind: "anonymous", ballotId: null }`) first ballot → no hook.

- [ ] **Step 2: Implement.** In `submitBallot`, after `repo.saveBallot(ballot, placements);`:

```ts
if (!existing && voter.kind === "user" && emitVotedOn) {
  emitVotedOn(voter.userId, row.id, row.name, placements.length);
}
```

- [ ] **Step 3: Verify** — `npm test --workspace backend` (tierlists), typecheck.

- [ ] **Step 4: Commit** — `git commit -m "feat(tierlists): emit voted_on hook on first signed-in ballot"`

---

### Task 6: Library — save diff emission, import flag, `POST /library/books`

**Files:**
- Modify: `backend/src/modules/library/service.ts`
- Modify: `backend/src/modules/library/routes.ts`
- Modify: `backend/src/modules/library/service.test.ts`

**Interfaces:**
- Consumes: `buildManualBook` + `ManualBookFields` from `@scripta/shared/library/bookSearch`, `BookRecommendationInput` from `@scripta/shared/community`.
- Produces:
  - `createLibraryService(repo, publicUrlFor, emitBookEvents?)` where `export type EmitBookEvents = (userId: string, events: Array<{ type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> }>) => void;`
  - `LibraryService` gains `addBook(userId: string, input: BookRecommendationInput): { key: string; updated: boolean }`.
  - `PUT /library` body schema gains optional `source: z.enum(["import"]).optional()`; when `"import"`, no diff emission.

- [ ] **Step 1: Failing tests** in `library/service.test.ts` (fake repo records `upsertDocument` calls; fake `emitBookEvents` records events):

1. Saving a library where a book key is new emits one `book_added` with payload `{ title, author, isbn, coverUrl, status }` from that book's `Title`/`Attribution`/`ISBN`/`_coverUrl`/`ReadStatus`.
2. Saving where an existing book's `ReadStatus` went `1 → 2` emits one `book_finished`.
3. Saving with unchanged books emits nothing.
4. `saveLibrary(userId, data, expectedUpdatedAt, "import")` emits nothing even with 50 new books.
5. `addBook` with no existing match appends a `manual:` book with the right `ReadStatus`, persists, emits `book_added`, returns `{ updated: false }` and a key starting `manual:`.
6. `addBook` matching by ISBN updates `ReadStatus` in place, returns `{ updated: true }`, emits `book_finished` only when new status is 2, and does not duplicate the book.
7. `addBook` with no ISBN matches by case-insensitive title+author.
8. `addBook` with identical status on an existing book returns `{ updated: true }`? — No: assert it returns `{ updated: false }` and emits nothing. (Decide: same-status update is a no-op.)

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement `service.ts`:**

1. `saveLibrary(userId, data, expectedUpdatedAt?, source?: "import")` — before `repo.upsertDocument`, snapshot `const previous = source === "import" ? null : repo.getDocument(userId);` (parse its `data` JSON in try/catch → `null` on failure). After a successful upsert, if `previous`, compute the diff:

```ts
const prevByKey = new Map<string, Record<string, unknown>>();
for (const book of booksOf(previous)) prevByKey.set(String(book.ContentID), book);
const events: Array<{ type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> }> = [];
for (const book of booksOf(next)) {
  const key = String(book.ContentID ?? "");
  if (!key) continue;
  const prev = prevByKey.get(key);
  const status = Number(book.ReadStatus ?? 0);
  if (!prev) {
    events.push({ type: "book_added", refId: key, payload: bookPayload(book, status) });
  } else if (Number(prev.ReadStatus ?? 0) !== 2 && status === 2) {
    events.push({ type: "book_finished", refId: key, payload: bookPayload(book, status) });
  }
}
if (events.length > 0) emitBookEvents?.(userId, events);
```

`booksOf(row)` extracts `(row.data as { books?: unknown[] }).books ?? []` (row may already be an object or a JSON string — match however `saveLibrary` currently receives `data`, since `repo.upsertDocument(userId, JSON.stringify(data), ...)` shows `data` is the raw object). `bookPayload(book, status)` = `{ title: String(book.Title ?? ""), author: String(book.Attribution ?? ""), isbn: book.ISBN == null ? null : String(book.ISBN), coverUrl: typeof book._coverUrl === "string" ? book._coverUrl : null, status }`. Wrap the whole diff+emit block in `try { ... } catch { /* activity must never fail a save */ }`.

2. `addBook(userId, input)`:

```ts
const row = repo.getDocument(userId);
const doc = parseBooks(row);
const needle = input.isbn ? norm(input.isbn) : null;
const match = doc.books.find((book) =>
  needle ? norm(String(book.ISBN ?? "")) === needle
    : norm(String(book.Title ?? "")) === norm(input.title) && norm(String(book.Attribution ?? "")) === norm(input.author)
);
```

with `norm = (s) => s.trim().toLowerCase()`. Match → same key path as the status cycle: if `Number(book.ReadStatus) === input.readStatus` return `{ key, updated: false }`; else set `ReadStatus`, `___PercentRead` (`input.readStatus === 2 ? 100 : 0`), `DateLastRead` (`input.readStatus === 2 ? todayISO : null`), upsert, emit `book_finished` when status 2, return `{ key, updated: true }`. No match → `const key = \`manual:${randomUUID()}\``; book = `{ ...buildManualBook({ title: input.title, author: input.author, isbn: input.isbn ?? "", publisher: null, readStatus: input.readStatus, rating: null, dateRead: input.readStatus === 2 ? new Date().toISOString().slice(0, 10) : null }, key.slice("manual:".length)), ...(input.coverUrl ? { _coverUrl: input.coverUrl } : {}) }`; append + upsert + emit `book_added`; return `{ key, updated: false }`. (`randomUUID` from `node:crypto`.)

3. Keep `getPublicByToken`/share paths untouched.

- [ ] **Step 4: Routes.** Extend `saveLibrarySchema` with `source: z.enum(["import"]).optional()`; pass `parsed.data.source` to `service.saveLibrary`. New route in `buildLibraryRoutes`:

```ts
const addBookSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  isbn: z.string().min(1).nullable().optional(),
  coverUrl: z.string().min(1).nullable().optional(),
  readStatus: z.union([z.literal(0), z.literal(1), z.literal(2)])
});

app.post("/library/books", { preHandler: authGuard }, async (request, reply) => {
  const parsed = addBookSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Expected { title, author, readStatus } — isbn/coverUrl optional." });
  return reply.send(service.addBook(request.user.id, parsed.data));
});
```

- [ ] **Step 5: Verify** — `npm test --workspace backend`, `npm run typecheck --workspace backend`.

- [ ] **Step 6: Commit** — `git commit -m "feat(library): book event diff on save, import source flag, addBook upsert endpoint"`

---

### Task 7: Wire the hooks in `app.ts` + full backend pass

**Files:**
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `EmitVotedOn` (arena), `EmitVotedOn` (tierlists), `EmitBookEvents` (library), `getCommunityPublicApi().emitEvent` with payload (Task 3).

- [ ] **Step 1: Wire arena** — extend the existing `registerArenaModule` opts:

```ts
emitVotedOn: (voterUserId, tournamentId, name) => {
  try {
    getCommunityPublicApi().emitEvent(voterUserId, "voted_on", "tournament", tournamentId, { game: "tournament", id: tournamentId, name: name ?? "" });
  } catch (error) {
    app.log.error(error, "failed to record voted_on for tournament");
  }
}
```

- [ ] **Step 2: Wire tierlists** analogously: `emitEvent(voterUserId, "voted_on", "tierlist", tierlistId, { game: "tierlist", id: tierlistId, name: tierlistName })` with the same try/catch + `app.log.error`.

- [ ] **Step 3: Wire library** — change line 83 to:

```ts
app.register(registerLibraryModule, {
  emitBookEvents: (userId, events) => {
    for (const event of events) {
      try {
        getCommunityPublicApi().emitEvent(userId, event.type, "book", event.refId, event.payload);
      } catch (error) {
        app.log.error(error, "failed to record book activity event");
      }
    }
  }
});
```

and update `registerLibraryModule`/`libraryPlugin` to accept and forward the optional hook into `createLibraryService`.

- [ ] **Step 4: Verify** — `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All green.

- [ ] **Step 5: Commit** — `git commit -m "feat(backend): wire voted_on and book event emissions into community events"`

---

### Task 8: Web — profile tabs, activity list, feed settings

**Files:**
- Modify: `frontend/src/api/community.ts`, `frontend/src/hooks/useCommunity.ts`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Test: `frontend/scripts/test-activity-helpers.mts` already covers shared logic; page itself has no render tests (repo has none).

**Interfaces:**
- Consumes: `ActivityItem`, `activityText`, `FeedSettings`, `Page` from `@scripta/shared/community`; `apiFetch`/`publicFetch` from `./client`; query key `["community", "profile", username]`.
- Produces: `fetchActivity(username, cursor?)`, `updateFeedSettings(settings)` (api), `useCommunityActivity(username)` (hook, useInfiniteQuery keyed `["community", "activity", username]`).

- [ ] **Step 1: API + hook.** In `api/community.ts`:

```ts
export async function fetchActivity(username: string, cursor?: string): Promise<Page<ActivityItem>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return publicFetch(`/community/profiles/${encodeURIComponent(username)}/activity${query}`) as Promise<Page<ActivityItem>>;
}
export async function updateFeedSettings(settings: FeedSettings): Promise<void> {
  await apiFetch("/community/profile/feed-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
}
```

`CommunityProfileView` gains `feedSettings?: FeedSettings`. In `hooks/useCommunity.ts` add `useCommunityActivity(username)` mirroring `useCommunityFeed`'s useInfiniteQuery shape (`getNextPageParam: (last) => last.nextCursor ?? undefined`).

- [ ] **Step 2: Profile page tabs.** In `CommunityProfilePage.tsx`: add `const [tab, setTab] = useState<"mural" | "activity">("mural");` and `const activity = useCommunityActivity(username ?? "");`. Render a tab bar between the header and the content (two buttons, `aria-selected`, accent underline on active, matching the page's Tailwind tokens):

```tsx
<div className="mb-5 flex gap-1 border-b border-(--color-border)" role="tablist">
  {(["mural", "activity"] as const).map((t) => (
    <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === t ? "border-(--color-accent) text-(--color-text)" : "border-transparent text-(--color-text-dim)"}`}>
      {t === "mural" ? "Mural" : "Activity"}
    </button>
  ))}
</div>
```

Wrap the existing mural + Published sections in `{tab === "mural" && (<>...</>)}`. Activity tab: flatten `activity.data.pages` into items, render rows via `activityText(item)` — publications get `<Link to={href}>`, others a plain row; relative date via `new Date(item.createdAt).toLocaleDateString()`; `hasNextPage` → "Load more" button calling `fetchNextPage`; empty state text "No activity yet."

- [ ] **Step 3: Feed settings control.** In `OwnerControls` add a third button "Feed settings" opening a `Sheet` (from `../components/Sheet`) with four checkbox rows (`publications` "Publications", `reading` "Reading activity", `votes` "Votes", `follows` "Follows"), initialized from `view?.feedSettings ?? DEFAULT_FEED_SETTINGS`; Save calls `updateFeedSettings` then the existing `run()`-style invalidate of `["community", "profile", username]`; error surfaces via the sheet.

- [ ] **Step 4: Verify** — `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`.

- [ ] **Step 5: Commit** — `git commit -m "feat(web): profile mural/activity tabs, activity list, feed settings sheet"`

---

### Task 9: Web — AddBookSheet + three public contexts + import flag

**Files:**
- Create: `frontend/src/components/AddBookSheet.tsx`
- Modify: `frontend/src/api/library.ts`, `frontend/src/pages/SharedLibraryPage.tsx`, `frontend/src/pages/ArenaViewPage.tsx`, `frontend/src/components/arena/DuelCard.tsx`, `frontend/src/pages/VoteTierlistPage.tsx`, `frontend/src/pages/LibraryPage.tsx`

**Interfaces:**
- Consumes: `BookRecommendationInput` (shared), `apiFetch`, `useAuth`, `useToast`, `Sheet`, `buildManualBook` not needed client-side (server builds).
- Produces: `addBookToLibrary(rec: BookRecommendationInput): Promise<{ key: string; updated: boolean }>`; `<AddBookSheet book={{ title, author, isbn?, coverUrl? }} onClose />` handling sign-out prompt internally.

- [ ] **Step 1: API.** In `api/library.ts`:

```ts
export async function addBookToLibrary(rec: BookRecommendationInput): Promise<{ key: string; updated: boolean }> {
  return apiFetch("/library/books", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) }) as Promise<{ key: string; updated: boolean }>;
}
```

- [ ] **Step 2: `AddBookSheet.tsx`** — props `{ book: { title: string; author: string; isbn?: string | null; coverUrl?: string | null }, onClose: () => void }`. Uses `Sheet` shell; `useAuth()` → if `!session`, render "Sign in to add books to your library" + `<Link to="/login" state={{ from: location }}>`; else three buttons Not read / Reading / Finished → `addBookToLibrary({ ...book, readStatus })` → `toast({ message: updated ? "Updated in your library." : "Added to your library." })` + `onClose()`; error → `toast({ message: "Could not add the book.", kind: "error" })` and stay open. `CoverImage`/initials block for `book.coverUrl` (copy the `DuelSideCard` cover-image pattern if simpler).

- [ ] **Step 3: SharedLibraryPage** — replace line 78's `onClick={() => {}}` with `onClick={() => setSelected(book)}`; add `const [selected, setSelected] = useState<Record<string, unknown> | null>(null);` and render `{selected && <AddBookSheet book={{ title: String(selected.Title ?? ""), author: String(selected.Attribution ?? ""), isbn: selected.ISBN == null ? null : String(selected.ISBN), coverUrl: typeof selected._coverUrl === "string" ? selected._coverUrl : null }} onClose={() => setSelected(null)} />}`.

- [ ] **Step 4: ArenaViewPage + DuelCard** — `DuelCard` gains optional `onAddBook?: (side: DuelSide) => void`, forwarded to `DuelSideCard`; inside the side card's root `<button>`, render an absolutely-positioned sibling-free "+" `span` turned button is invalid (nested button) — instead render the "+" **outside** the vote button: wrap each side in a `relative` div, keep the vote `<button>`, and add `<button type="button" aria-label={`Add ${side.title} to library`} onClick={(e) => { e.stopPropagation(); onAddBook?.(side); }} className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/50 p-1 text-white">+</button>`. Adjust `DuelSideCard` root accordingly (button stays full-size; wrapper gains `relative`). Page: `const [picked, setPicked] = useState<DuelSide | null>(null);` → `onAddBook={setPicked}` → `<AddBookSheet book={{ title: picked.title, author: picked.author, isbn: null, coverUrl: picked.cover ?? null }} ...>`.

- [ ] **Step 5: VoteTierlistPage** — add a "Books" button in both header branches (`justify-between` row keeps flex balance; on the results branch place it next to the `<h1>` inside a flex row). It opens a `Sheet` listing `publicBooks` rows (cover thumb via `_coverUrl`/initials + title + author); each row is a button → `setSheetBook(pub)` → `<AddBookSheet book={{ title: pub.title, author: pub.author, isbn: pub.isbn, coverUrl: pub.coverUrl }} />`.

- [ ] **Step 6: Import flag** — `LibraryPage.tsx` `mergeAndSave(parsed, source?)` → `updateLibrary` path must carry `source` into `saveLibrary`. Check `hooks/useLibrary.ts` + `api/library.ts saveLibrary(data, updatedAt?)`: thread a third param `source?: "import"` down to the PUT body (`body: JSON.stringify({ updatedAt, source, data })`). Call sites: the two file-import sites pass `"import"` (`parseImportedFile` paths, lines 142 and 684); manual `handleAddBook` passes nothing.

- [ ] **Step 7: Verify** — `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`.

- [ ] **Step 8: Commit** — `git commit -m "feat(web): add-to-library sheet on shared library, arena, vote pages; import source flag"`

---

### Task 10: Mobile — profile tabs, activity list, feed settings

**Files:**
- Modify: `mobile/src/features/community/api.ts`, `mobile/src/features/community/ProfileScreen.tsx`
- Create: `mobile/src/features/community/ActivityList.tsx`, `mobile/src/features/community/FeedSettingsDialog.tsx`

**Interfaces:**
- Consumes: shared `activityText`/`FeedSettings` from `@scripta/shared/community` (mobile imports dist directly, like `communityHome.ts`), `apiClient.request`, ui `Dialog`/`Button`/`Toast`/`EmptyState` from `../../ui`.
- Produces: `fetchActivity(username, cursor?)`, `updateFeedSettings(settings)` (api); `<ActivityList username />` (InfiniteQuery FlatList); `<FeedSettingsDialog visible settings onClose />`.

- [ ] **Step 1: API.** In `features/community/api.ts`:

```ts
export async function fetchActivity(username: string, cursor?: string): Promise<Page<ActivityItem>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiClient.request(`/community/profiles/${encodeURIComponent(username)}/activity${query}`);
}
export function updateFeedSettings(settings: FeedSettings) {
  return apiClient.request("/community/profile/feed-settings", { method: "PUT", body: settings, auth: true });
}
```

- [ ] **Step 2: `ActivityList.tsx`** — `useInfiniteQuery` keyed `["community", "activity", username]`, `FlatList` with `onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}`, `RefreshControl` wired to `refetch`, rows = `Pressable` only when `activityText(item).href` exists (else plain `View`), each row: verb + target (typography body/caption tokens like `publishedRows`), relative date right-aligned. `ListEmptyComponent` `EmptyState` "No activity yet."

- [ ] **Step 3: `FeedSettingsDialog.tsx`** — `Dialog` (from `../../ui`) with four `Button` rows whose labels toggle state ("Publications: On/Off" etc., `variant` secondary/destructive-free), a Save button calling `updateFeedSettings` + `onClose`, local state initialized from props; failure → `Toast tone="error"`.

- [ ] **Step 4: ProfileScreen tabs** — `const [tab, setTab] = useState<"mural" | "activity">("mural");` + a two-button row (same styling family as `COMMUNITY_TABS` handling in CommunityScreen — reuse its segmented-control approach). `ListHeaderComponent` shows mural + Published section only on `tab === "mural"`; activity tab renders `<ActivityList username={username} />` as the FlatList content (or swap `data`). Owner controls gain "Feed settings" button opening the dialog with `view.feedSettings ?? DEFAULT_FEED_SETTINGS`.

- [ ] **Step 5: Verify** — `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`.

- [ ] **Step 6: Commit** — `git commit -m "feat(mobile): profile activity tab, activity list, feed settings dialog"`

---

### Task 11: Mobile — AddBookSheet + three public contexts + import flag

**Files:**
- Create: `mobile/src/features/library/lib/recommendation.ts`, `mobile/src/features/community/AddBookSheet.tsx`
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts`, `mobile/src/features/library/api/client.ts` (add-book API), `mobile/src/features/public/SharedLibraryScreen.tsx`, `mobile/src/features/arena/ArenaViewScreen.tsx`, `mobile/src/features/arena/ArenaBooksSheet.tsx`, `mobile/src/features/tierlists/VoteTierlistScreen.tsx`
- Test: `mobile/src/features/library/lib/recommendation.test.ts` (new; auto-globbed)

**Interfaces:**
- Produces: `toRecommendation(book: { title: string; author: string; isbn?: string | null; coverUrl?: string | null }, readStatus: 0 | 1 | 2): BookRecommendationInput`; `addBookToLibrary(rec)` API; `<AddBookSheet book onClose />` handling signed-out via `router.push("/(public)/login", { returnTo })`.

- [ ] **Step 1: Failing test** `recommendation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { toRecommendation } from "./recommendation.js";

test("toRecommendation maps and defaults isbn/cover", () => {
  assert.deepEqual(
    toRecommendation({ title: "Dune", author: "Frank Herbert", isbn: "9780441172719", coverUrl: "https://x/c.jpg" }, 2),
    { title: "Dune", author: "Frank Herbert", isbn: "9780441172719", coverUrl: "https://x/c.jpg", readStatus: 2 }
  );
  assert.deepEqual(
    toRecommendation({ title: "Dune", author: "Frank Herbert" }, 0),
    { title: "Dune", author: "Frank Herbert", isbn: null, coverUrl: null, readStatus: 0 }
  );
});
```

- [ ] **Step 2: Implement mapper** (trivial passthrough with null defaults) + API in `features/library/api/client.ts` (`apiClient.request("/library/books", { method: "POST", body: rec, auth: true })`).

- [ ] **Step 3: `AddBookSheet.tsx`** — ui `Sheet`; `useAuth()` → signed-out: text + Button "Sign in" → `router.push({ pathname: "/(public)/login", params: { returnTo: currentPath } } as never)` (copy VoteTierlistScreen's pattern); signed-in: cover via `BookCover` (width ~96 height ~138, initials fallback is built-in) + title/author + three `Button`s → `addBookToLibrary(toRecommendation(...))` → `Toast` success "Added to your library." / "Updated in your library." → `onClose()`; failure → error Toast, stay open.

- [ ] **Step 4: SharedLibraryScreen** — line 23 `onPress={() => undefined}` → `onPress={() => setSelected(book)}` + sheet state (book mapping like web Step 3: `Title`/`Attribution`/`ISBN`/`_coverUrl`).

- [ ] **Step 5: Arena** — bracket `Side` becomes `Pressable` (wrap or swap the `View`) → `onAddBook(side)`; `ArenaBooksSheet` rows: same swap on its row `View`; both open `<AddBookSheet book={{ title: side.title, author: side.author }} />` (arena sides have no ISBN — mapper nulls it).

- [ ] **Step 6: VoteTierlistScreen** — add a `Button label={`Books (${board.books.length})`}` into the existing `styles.row` button rows (both voting and results branches) opening a `Sheet` listing `board.books` (reuse the `ArenaBooksSheet` row layout inline); row press → `AddBookSheet` with `title/author/isbn/coverUrl` from the `PublicBookData` shape.

- [ ] **Step 7: Import flag** — `useLibraryActions.merge` must save with `source: "import"`. Thread the param like web Step 6: `features/library/api/client.ts saveLibrary(data, expectedUpdatedAt?, source?)` → body `{ updatedAt, source, data }`; `updateLibrary`/`useLibrary` plumbing passes it only from `merge` (`addBook`/`cycleStatus` pass nothing).

- [ ] **Step 8: Verify** — `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`.

- [ ] **Step 9: Commit** — `git commit -m "feat(mobile): add-to-library sheet on shared library, arena, vote screens; import source flag"`

---

### Task 12: Spec amendments + full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-profile-activity-design.md`

- [ ] **Step 1: Amend the spec** (two bullets under "Decisions locked in with the user", each noting it supersedes earlier text):
  1. Imports are saved by clients through the same `PUT /library` as normal edits; the import skip is implemented as an explicit `source: "import"` field on that request (trusted client flag; the only writer is this app's own clients), replacing "import endpoints bypass the diff".
  2. Vote/ballot emission is best-effort: the event insert cannot be transactional with the vote (separate module DB connections), and failing the response after the vote row is committed would make the missing event permanent (retry hits `AlreadyVotedError`). Emission errors are logged and swallowed; ordering guarantees no phantom event (vote row first, event second), replacing "a failed event insert must fail the vote response".

- [ ] **Step 2: Full verification, in this order:**

```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend && npm test --workspace backend
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
npm run typecheck --workspace mobile && npm test --workspace mobile
```

All five must pass. Fix anything found, committing fixes per package.

- [ ] **Step 3: Manual smoke (emulator lease, one pass)** — per root AGENTS this is the only rendered-behaviour change class in the plan worth a device: start `node scripts/dev-emulator.mjs` + `npm run dev:release` (never hardcode ports; `npm run dev:status` after), then on the emulator: profile shows both tabs; activity rows render for the signed-in user; feed settings toggles persist; a shared-library book adds to the library. Do **not** take the emulator lease for backend/shared/type work — this is the single end-of-plan pass.

- [ ] **Step 4: Commit** — `git commit -m "docs: record profile-activity spec amendments from planning"`
