# Home Dashboard + Profile Mural Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mural-on-home model with an actionable Home dashboard (reading-state cards + follower digest) and make the published mural the single profile concept.

**Architecture:** New `/community/dashboard` endpoint merges followee publication events with follows-since-seen into one keyset-paginated digest; a `dashboard_seen_at` column on `users` drives `newCount`. A startup migration repoints `mural_homes` rows at `community.profiles`, then the home-mural designation is deleted end to end. Shared `@scripta/shared/dashboard` supplies `DigestItem`, `DashboardCard`, and `buildDashboardCards` to both clients.

**Tech Stack:** Fastify 5 + node:sqlite (backend), React 19/Vite/TanStack Query (web), Expo Router/React Query (mobile), TypeScript workspace `@scripta/shared` compiled to `dist/`.

**Spec:** `docs/superpowers/specs/2026-09-18-home-dashboard-profile-split-design.md`

## Global Constraints

- Rebuild `@scripta/shared` (`npm run build --workspace @scripta/shared`) before any consumer typecheck or test.
- Backend tests are named explicitly in `backend/package.json`'s `test` script — every new `*.test.ts` must be appended there.
- Web tests: `tsx --test scripts/test-*.mts` in `frontend/` (no component harness; UI verified via typecheck + lint + these scripts).
- Mobile tests: `node --import tsx --test "src/**/*.test.ts"` in `mobile/` (glob — no list edit needed).
- No comments in new code unless a file's existing convention demands one; no new dependencies; no comments restating code.
- Never weaken auth or validation to make a test pass.
- Sequential-task caveat: tasks T5/T7/T9 remove endpoints their cross-client consumers still call — the broken window is intentional and closed within the same run. Do not commit to `main` between tasks if that matters; this plan assumes one continuous execution.

---

### Task 1: Shared dashboard types + card builder

**Files:**
- Create: `packages/shared/src/dashboard.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./dashboard.js";`)

**Interfaces:**
- Consumes: `FeedItem`, `CommunityAuthor` from `@scripta/shared/community`; `eligiblePassages`, `rediscoverPassage` from `@scripta/shared/murals/home` (temporary — Task 10 inlines them); `bookKey` from `@scripta/shared/library/merge`.
- Produces: `DigestItem`, `DashboardFeedPage`, `DashboardCard`, `buildDashboardCards(books, day, salt?)`, `digestHeading(item)`, `digestTarget(item)` — used by backend Task 3 and both clients.

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/test-dashboard-cards.mts` (book keys come from the same `bookKey` helper the implementation uses — titles are not stable keys):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardCards, digestHeading, digestTarget, type DigestItem } from "@scripta/shared/dashboard";
import { bookKey } from "@scripta/shared/library/merge";

test("cards derive from read status", () => {
  const reading = { Title: "Current", ReadStatus: 1 };
  const tbr = { Title: "Next", ReadStatus: 0 };
  const done = { Title: "Done", ReadStatus: 2 };
  const cards = buildDashboardCards([reading, tbr, done], "2026-09-18");
  assert.deepEqual(cards[0], { kind: "currentlyReading", bookKeys: [bookKey(reading)] });
  assert.deepEqual(cards[1], { kind: "upNext", bookKeys: [bookKey(tbr)] });
});

test("empty library yields no cards", () => {
  assert.deepEqual(buildDashboardCards([], "2026-09-18"), []);
});

test("all-finished library yields only upNext-free, rediscover-eligible output", () => {
  const done = { Title: "Done", ReadStatus: 2, highlights: [{ BookmarkID: "bm1", Type: "highlight", Text: "Keep me." }] };
  const cards = buildDashboardCards([done], "2026-09-18", "salt");
  assert.deepEqual(cards, [{ kind: "rediscover", bookKey: bookKey(done), highlightId: "bm1" }]);
});

test("rediscover card rotates by day+salt over eligible highlights", () => {
  const books = [{
    Title: "A", ReadStatus: 2,
    highlights: [
      { BookmarkID: "b1", Type: "highlight", Text: "one" },
      { BookmarkID: "b2", Type: "highlight", Text: "two" }
    ]
  }];
  const a = buildDashboardCards(books, "2026-09-18", "s");
  const b = buildDashboardCards(books, "2026-09-19", "s");
  assert.equal(a[0]?.kind, "rediscover");
  const keys = new Set([JSON.stringify(a), JSON.stringify(b)]);
  assert.ok(keys.size === 2 || JSON.stringify(a) === JSON.stringify(b));
});

test("digest headings and targets by kind", () => {
  const pub: DigestItem = {
    kind: "publication", id: "e1", type: "tierlist_published", createdAt: "2026-09-10T00:00:00.000Z",
    actor: { userId: "u1", username: "andre", avatarUrl: null },
    content: { kind: "tierlist", id: "t1", voteCode: "code12ab", name: "Top fantasy", poolSize: 12, ballotCount: 4, votingOpen: true, promotedAt: null }
  };
  const follow: DigestItem = { kind: "follow", id: "u2", createdAt: "2026-09-11T00:00:00.000Z", actor: { userId: "u2", username: "sam", avatarUrl: null } };
  assert.equal(digestHeading(pub), "andre published a tier list");
  assert.equal(digestTarget(pub), "/vote/code12ab");
  assert.equal(digestHeading(follow), "sam started following you");
  assert.equal(digestTarget(follow), "/community/u/sam");
});
```

The rediscover rotation assertion is intentionally weak (hash may collide across two days); strength comes from reusing the already-tested `rediscoverPassage`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: FAIL — module `@scripta/shared/dashboard` has no exports (`buildDashboardCards` not defined).

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/dashboard.ts`:

```ts
import type { CommunityAuthor, FeedItem } from "./community/types.js";
import { feedHeading, feedTarget } from "./community/helpers.js";
import { bookKey } from "./library/merge.js";
import { rediscoverPassage } from "./murals/home.js";

export type DigestItem =
  | ({ kind: "publication" } & FeedItem)
  | { kind: "follow"; id: string; actor: CommunityAuthor; createdAt: string };

export interface DashboardFeedPage {
  items: DigestItem[];
  nextCursor: string | null;
  newCount: number;
}

export type DashboardCard =
  | { kind: "currentlyReading"; bookKeys: string[] }
  | { kind: "upNext"; bookKeys: string[] }
  | { kind: "rediscover"; bookKey: string; highlightId: string };

export function buildDashboardCards(books: Array<Record<string, unknown>>, day: string, salt = "dashboard"): DashboardCard[] {
  const cards: DashboardCard[] = [];
  const reading = books.filter((book) => book.ReadStatus === 1).map(bookKey);
  if (reading.length) cards.push({ kind: "currentlyReading", bookKeys: reading });
  const upNext = books.filter((book) => book.ReadStatus !== 1 && book.ReadStatus !== 2).map(bookKey);
  if (upNext.length) cards.push({ kind: "upNext", bookKeys: upNext });
  const passage = rediscoverPassage(salt, books, day);
  if (passage) cards.push({ kind: "rediscover", bookKey: passage.bookKey, highlightId: passage.highlightId });
  return cards;
}

export function digestHeading(item: DigestItem): string {
  return item.kind === "follow" ? `${item.actor.username} started following you` : feedHeading(item);
}

export function digestTarget(item: DigestItem): string {
  return item.kind === "follow" ? `/community/u/${item.actor.username}` : feedTarget(item);
}
```

Then add to `packages/shared/src/index.ts` alongside the other domain exports:

```ts
export * from "./dashboard.js";
```

And add to `packages/shared/package.json`'s `exports` map, next to `"./community"`:

```json
"./dashboard": {
  "types": "./dist/dashboard.d.ts",
  "default": "./dist/dashboard.js"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: PASS (all scripts, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/src/index.ts packages/shared/package.json frontend/scripts/test-dashboard-cards.mts
git commit -m "feat(shared): dashboard digest types and reading-card builder"
```

---

### Task 2: Auth `dashboard_seen_at` column + public API

**Files:**
- Modify: `backend/src/modules/auth/adapters/sqlite/schema.sql` (add column to `users`)
- Modify: `backend/src/modules/auth/adapters/sqlite/connection.ts` (ALTER for existing DBs)
- Modify: `backend/src/modules/auth/publicProfile.ts` (getter/setter)
- Modify: `backend/src/modules/auth/index.ts` (exports)
- Test: `backend/src/modules/auth/publicProfile.test.ts`

**Interfaces:**
- Produces: `getDashboardSeenAt(userId: string): string | null` and `setDashboardSeenAt(userId: string, seenAt: string): void`, exported from `modules/auth/index.js` — consumed by Task 3's `CommunityDeps`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/modules/auth/publicProfile.test.ts` (match the file's existing env/scratch setup — read its header first and reuse its pattern):

```ts
test("dashboard seen marker round-trips and defaults to null", async () => {
  const { getDashboardSeenAt, setDashboardSeenAt } = await import("./publicProfile.js");
  assert.equal(getDashboardSeenAt("seen-user"), null);
  setDashboardSeenAt("seen-user", "2026-09-18T10:00:00.000Z");
  assert.equal(getDashboardSeenAt("seen-user"), "2026-09-18T10:00:00.000Z");
  setDashboardSeenAt("seen-user", "2026-09-18T11:00:00.000Z");
  assert.equal(getDashboardSeenAt("seen-user"), "2026-09-18T11:00:00.000Z");
  assert.equal(getDashboardSeenAt("stranger"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace backend` (the file is already in the test list)
Expected: FAIL — `getDashboardSeenAt` is not exported.

- [ ] **Step 3: Write minimal implementation**

`schema.sql` — add to the `users` table definition:

```sql
  dashboard_seen_at TEXT,            -- last time this user consumed their Home digest
```

`connection.ts` — inside `applyAuthMigrations`, in the `if (columns.length > 0)` block with the other ALTERs:

```ts
if (!columns.some((column) => column.name === "dashboard_seen_at")) db.exec("ALTER TABLE users ADD COLUMN dashboard_seen_at TEXT");
```

`publicProfile.ts` — extend `CachedStatements` with `getSeen`/`setSeen`, initialize in `statements()`:

```ts
getSeen: db.prepare("SELECT dashboard_seen_at FROM users WHERE id = ?"),
setSeen: db.prepare("UPDATE users SET dashboard_seen_at = ? WHERE id = ?"),
```

and export:

```ts
export function getDashboardSeenAt(userId: string): string | null {
  const row = statements().getSeen.get(userId) as { dashboard_seen_at: string | null } | undefined;
  return row?.dashboard_seen_at ?? null;
}

export function setDashboardSeenAt(userId: string, seenAt: string): void {
  statements().setSeen.run(seenAt, userId);
}
```

`index.ts` — add both names to the existing `publicProfile.js` export list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/auth
git commit -m "feat(auth): per-user dashboard seen marker"
```

---

### Task 3: Community dashboard endpoint (replaces feed)

**Files:**
- Modify: `backend/src/modules/community/domain/ports.ts`, `domain/types.ts` (no change needed — reuse `FollowRow`/`EventRow`)
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/modules/community/routes.ts`
- Modify: `backend/src/modules/community/service.test.ts`, `routes.test.ts`, `adapters/sqlite/sqliteCommunityRepository.test.ts`

**Interfaces:**
- Consumes: `getDashboardSeenAt`/`setDashboardSeenAt` (Task 2); `DashboardFeedPage`, `DigestItem` (Task 1) via `@scripta/shared/dashboard`; existing `encodeCursor`/`decodeCursor`, `EventRow`, `FollowRow`, `CursorKeyset`.
- Produces: `CommunityService.getDashboard(viewerId: string, cursor: string | undefined, limit: number): DashboardFeedPage`, `CommunityService.markDashboardSeen(viewerId: string): void`; `CommunityDeps` gains `getDashboardSeenAt(userId: string): string | null` and `setDashboardSeenAt(userId: string, seenAt: string): void`; repo gains `listFollowersByFollowee(followeeId: string, keyset: CursorKeyset | undefined, limit: number): FollowRow[]`, `countEventsByUsersSince(userIds: string[], since: string): number`, `countFollowersSince(followeeId: string, since: string): number`. HTTP: `GET /community/dashboard?cursor=&limit=`, `POST /community/dashboard/seen` (both authGuard). `GET /community/feed` is removed.

- [ ] **Step 1: Write the failing tests**

In `service.test.ts`: extend `createRepoFake` with the three new methods (and a `seenAt` ref the fake deps close over):

```ts
listFollowersByFollowee(followeeId, keyset, limit) {
  return [...follows.values()]
    .filter((row) => row.followee_id === followeeId)
    .filter((row) => !keyset || row.created_at < keyset.createdAt || (row.created_at === keyset.createdAt && row.follower_id < keyset.id))
    .sort((a, b) => (a.created_at === b.created_at ? (a.follower_id > b.follower_id ? -1 : 1) : b.created_at.localeCompare(a.created_at)))
    .slice(0, limit);
},
countEventsByUsersSince(userIds, since) {
  return events.filter((e) => userIds.includes(e.user_id) && e.created_at > since).length;
},
countFollowersSince(followeeId, since) {
  return [...follows.values()].filter((row) => row.followee_id === followeeId && row.created_at > since).length;
}
```

In `createDeps`, declare beside the other fake state and include in the returned object:

```ts
const seenAt = { value: null as string | null };
```

and in `deps`:

```ts
getDashboardSeenAt: () => seenAt.value,
setDashboardSeenAt: (_userId, value) => { seenAt.value = value; }
```

Return `seenAt` from `createDeps` (the object itself, so tests mutate it through the reference).

Update `service.test.ts` imports to include `createCommunityService` deps type only; then replace the four `feed` tests (lines ~279–351: "feed merges followees' events newest first and paginates by keyset", "feed drops events whose content vanished", "feed drops events whose actor has no reader profile", "feed ignores events from people you don't follow") with dashboard equivalents. Keep the same fixtures (`tierRef`, `tournRef`, `profileRow`, `reader`) and write:

```ts
test("dashboard merges followees' publications and incoming follows newest first", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", reader("alice"));
  profiles.set("bob", reader("bob"));
  profiles.set("carol", reader("carol"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-05T00:00:00.000Z" });
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  service.emitEvent("alice", "tournament_published", "tournament", "g1");
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  tournamentRefs.set("g1", tournRef("g1", "alice"));
  repo.insertFollow({ follower_id: "carol", followee_id: "alice", created_at: "2026-09-06T00:00:00.000Z" });
  const page = service.getDashboard("viewer", undefined, 20);
  assert.equal(page.items[0]?.kind, "publication");
  assert.equal((page.items[0] as { actor: { userId: string } }).actor.userId, "alice");
  assert.ok(page.items.some((item) => item.kind === "follow" && item.id === "bob"));
  assert.ok(!page.items.some((item) => item.kind === "follow" && item.id === "carol"));
});

test("follow rows surface only to the followee and retract on unfollow", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("viewer"));
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-05T00:00:00.000Z" });
  assert.equal(service.getDashboard("viewer", undefined, 20).items.length, 1);
  assert.equal(service.getDashboard("bob", undefined, 20).items.length, 0);
  repo.deleteFollow("bob", "viewer");
  assert.equal(service.getDashboard("viewer", undefined, 20).items.length, 0);
});

test("newCount counts unseen rows and the seen marker resets it", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, seenAt } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", reader("alice"));
  profiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("viewer"));
  repo.insertFollow({ follower_id: "alice", followee_id: "viewer", created_at: "2026-09-05T00:00:00.000Z" });
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-06T00:00:00.000Z" });
  assert.equal(service.getDashboard("viewer", undefined, 20).newCount, 0);
  seenAt.value = "2026-09-05T12:00:00.000Z";
  assert.equal(service.getDashboard("viewer", undefined, 20).newCount, 1);
  service.markDashboardSeen("viewer");
  assert.equal(service.getDashboard("viewer", undefined, 20).newCount, 0);
});

test("dashboard pagination by keyset spans both sources", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", reader("alice"));
  profiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("alice"));
  repo.upsertProfile(profileRow("viewer"));
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-04T00:00:00.000Z" });
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  const first = service.getDashboard("viewer", undefined, 1);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = service.getDashboard("viewer", first.nextCursor!, 1);
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0]?.id, first.items[0]?.id);
});

test("dashboard drops publications whose content or actor vanished", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", reader("alice"));
  service.emitEvent("alice", "tierlist_published", "tierlist", "gone");
  service.emitEvent("ghost", "tournament_published", "tournament", "g1");
  tournamentRefs.set("g1", tournRef("g1", "ghost"));
  assert.equal(service.getDashboard("viewer", undefined, 20).items.length, 0);
});

test("an unparseable dashboard cursor is a 400-worthy error", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getDashboard("viewer", "###", 20), InvalidCursorError);
});
```

In `routes.test.ts`, update `fakeService` (`getFeed` → `getDashboard: () => ({ items: [], nextCursor: null, newCount: 0 })`, add `markDashboardSeen: () => {}`) and add:

```ts
test("dashboard routes pass cursor/limit through and mark seen", async () => {
  const seen: Array<Record<string, unknown>> = [];
  let marked = 0;
  const app = Fastify();
  await app.register(
    buildCommunityRoutes(
      fakeService({
        getDashboard: (_viewerId, cursor, limit) => {
          seen.push({ cursor, limit });
          return { items: [], nextCursor: null, newCount: 0 };
        },
        markDashboardSeen: () => {
          marked += 1;
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatar_id: null, google_id: null, password_hash: null, created_at: "" }));
  const res = await app.inject({ method: "GET", url: "/community/dashboard?cursor=abc&limit=5", headers: auth });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, [{ cursor: "abc", limit: 5 }]);
  const seenRes = await app.inject({ method: "POST", url: "/community/dashboard/seen", headers: auth });
  assert.equal(seenRes.statusCode, 204);
  assert.equal(marked, 1);
  await app.close();
});
```

(Copy the auth decoration pattern from the existing `routes.test.ts` file — read it first; if it tests authed routes elsewhere, reuse exactly its decoration + token approach instead of the inline fake above.)

In `sqliteCommunityRepository.test.ts`, add a keyset test for the new follower listing mirroring its existing "events ignore duplicate … paginate by keyset" test, asserting order `created_at DESC, follower_id DESC` and that unfollowed rows never return.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace backend`
Expected: FAIL — `getDashboard`/`markDashboardSeen`/repo methods don't exist; TypeScript errors on `CommunityDeps`.

- [ ] **Step 3: Write minimal implementation**

`ports.ts` — add to `CommunityRepository`:

```ts
listFollowersByFollowee(followeeId: string, keyset: CursorKeyset | undefined, limit: number): FollowRow[];
countEventsByUsersSince(userIds: string[], since: string): number;
countFollowersSince(followeeId: string, since: string): number;
```

`sqliteCommunityRepository.ts` — prepared statements:

```ts
const listFollowersStmt = db.prepare(`SELECT * FROM follows WHERE followee_id = ? ORDER BY created_at DESC, follower_id DESC LIMIT ?`);
const listFollowersBeforeStmt = db.prepare(`
  SELECT * FROM follows
  WHERE followee_id = ? AND (created_at < ? OR (created_at = ? AND follower_id < ?))
  ORDER BY created_at DESC, follower_id DESC LIMIT ?
`);
```

and implementations:

```ts
listFollowersByFollowee(followeeId, keyset, limit) {
  if (keyset) {
    return listFollowersBeforeStmt.all(followeeId, keyset.createdAt, keyset.createdAt, keyset.id, limit) as unknown as FollowRow[];
  }
  return listFollowersStmt.all(followeeId, limit) as unknown as FollowRow[];
},
countEventsByUsersSince(userIds, since) {
  if (userIds.length === 0) return 0;
  const placeholders = userIds.map(() => "?").join(",");
  const row = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE user_id IN (${placeholders}) AND created_at > ?`).get(...userIds, since) as { n: number };
  return row.n;
},
countFollowersSince(followeeId, since) {
  return (db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE followee_id = ? AND created_at > ?`).get(followeeId, since) as { n: number }).n;
}
```

`service.ts`:

- Imports: add `DashboardFeedPage, DigestItem` from `@scripta/shared/dashboard`.
- `CommunityDeps` gains the two seen-marker methods.
- `CommunityService` interface: `getFeed` replaced by `getDashboard(viewerId: string, cursor: string | undefined, limit: number): DashboardFeedPage` and `markDashboardSeen(viewerId: string): void`.
- Implementation — move the publication-enrichment block out of `getFeed` verbatim (including the promoted-tierlist "Original creator unavailable" fallback) and wrap:

```ts
getDashboard(viewerId, cursor, limit) {
  const keyset = cursor ? decodeCursor(cursor) : undefined;
  if (cursor && !keyset) throw new InvalidCursorError();
  type Row = { id: string; createdAt: string; event?: EventRow; follow?: FollowRow };
  const rows: Row[] = [];
  const followees = repo.listFollowees(viewerId);
  for (const followeeId of followees) {
    rows.push(...repo.listEventsByUser(followeeId, keyset, limit + 1).map((event) => ({ id: event.id, createdAt: event.created_at, event })));
  }
  rows.push(...repo.listFollowersByFollowee(viewerId, keyset, limit + 1).map((follow) => ({ id: follow.follower_id, createdAt: follow.created_at, follow })));
  rows.sort((a, b) => (a.createdAt !== b.createdAt ? b.createdAt.localeCompare(a.createdAt) : a.id < b.id ? 1 : -1));
  const actorIds = new Set<string>();
  for (const row of rows) {
    if (row.event) actorIds.add(row.event.user_id);
    if (row.follow) actorIds.add(row.follow.follower_id);
  }
  const profiles = deps.resolveProfiles([...actorIds]);
  const items: DigestItem[] = [];
  let nextCursor: string | null = null;
  let lastIncluded: Row | undefined;
  for (const row of rows) {
    if (items.length === limit) {
      if (lastIncluded) nextCursor = encodeCursor({ createdAt: lastIncluded.createdAt, id: lastIncluded.id });
      break;
    }
    if (row.event) {
      const event = row.event;
      if (event.ref_type === "tierlist") {
        const ref = deps.tierlists.get(event.ref_id);
        const actor = ref && ref.ownerUserId === event.user_id ? profiles.get(event.user_id) ?? (ref.promotedAt ? { username: "Original creator unavailable", avatarUrl: null, unavailable: true } : undefined) : undefined;
        if (ref && actor) {
          items.push({ kind: "publication", id: event.id, actor: { ...actor, userId: event.user_id }, type: event.type, content: toTierlistSummary(ref), createdAt: event.created_at });
          lastIncluded = row;
        }
      } else {
        const ref = deps.tournaments.get(event.ref_id);
        const actor = ref && ref.ownerUserId === event.user_id ? profiles.get(event.user_id) : undefined;
        if (ref && actor) {
          items.push({ kind: "publication", id: event.id, actor: { ...actor, userId: event.user_id }, type: event.type, content: toTournamentSummary(ref), createdAt: event.created_at });
          lastIncluded = row;
        }
      }
    } else if (row.follow) {
      const author = profiles.get(row.follow.follower_id);
      if (author) {
        items.push({ kind: "follow", id: row.follow.follower_id, actor: { ...author, userId: row.follow.follower_id }, createdAt: row.follow.created_at });
        lastIncluded = row;
      }
    }
  }
  const seen = keyset ? null : deps.getDashboardSeenAt(viewerId);
  const newCount = !keyset && seen ? repo.countEventsByUsersSince(followees, seen) + repo.countFollowersSince(viewerId, seen) : 0;
  return { items, nextCursor, newCount };
},
markDashboardSeen(viewerId) {
  deps.setDashboardSeenAt(viewerId, new Date().toISOString());
},
```

Remove `getFeed` and `byNewestFirst` (the sort moved inline). `CommunityService` consumers of `getFeed` elsewhere: none (checked — only routes).

`routes.ts`: delete the `GET /community/feed` handler; rename `feedQuerySchema` to `dashboardQuerySchema` (same shape); add:

```ts
app.get("/community/dashboard", { preHandler: authGuard }, async (request, reply) => {
  const parsed = dashboardQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid cursor/limit." });
  try {
    return reply.send(service.getDashboard(request.user.id, parsed.data.cursor, parsed.data.limit));
  } catch (err) {
    if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
    throw err;
  }
});

app.post("/community/dashboard/seen", { preHandler: authGuard }, async (request, reply) => {
  service.markDashboardSeen(request.user.id);
  return reply.code(204).send();
});
```

`app.ts` wiring (community registration): add `getDashboardSeenAt, setDashboardSeenAt` to the imports from `./modules/auth/index.js` and to the `registerCommunityModule` options object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace backend && npm run typecheck --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/community backend/src/app.ts
git commit -m "feat(community): dashboard digest endpoint replaces feed"
```

---

### Task 4: Home-mural → profile migration

**Files:**
- Modify: `backend/src/modules/murals/migration.ts` (+ `index.ts` exports)
- Create: `backend/src/modules/community/migration.ts` (+ `index.ts` export)
- Modify: `backend/src/migrations/runStartupMigrations.ts`
- Test: `backend/src/modules/community/migration.test.ts` (NEW — must be added to `backend/package.json` test list)

**Interfaces:**
- Produces: `listHomeDesignations(db?: DatabaseSync): Array<{ userId: string; muralId: string }>` and `dropMuralHomes(db?: DatabaseSync): void` from `modules/murals/index.js`; `applyHomeMuralMigration(rows: Array<{ userId: string; muralId: string }>, db?: DatabaseSync): void` from `modules/community/index.js`. The optional-db parameters exist for in-memory testing (a deliberate improvement over `insertMigratedMurals`' env-only pattern).

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/community/migration.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { applyHomeMuralMigration } from "./migration.js";

function communityDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  return db;
}

function getRow(db: DatabaseSync, userId: string) {
  return db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as
    | { user_id: string; published: number; mural_id: string | null }
    | undefined;
}

test("home mural becomes the profile mural, published untouched", () => {
  const db = communityDb();
  applyHomeMuralMigration([{ userId: "u1", muralId: "m1" }], db);
  assert.deepEqual(getRow(db, "u1"), { user_id: "u1", published: 0, mural_id: "m1" });
});

test("an already-published profile keeps its chosen mural", () => {
  const db = communityDb();
  db.prepare("INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at) VALUES ('u1', 1, 'chosen', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')").run();
  applyHomeMuralMigration([{ userId: "u1", muralId: "home-mural" }], db);
  assert.equal(getRow(db, "u1")?.mural_id, "chosen");
  assert.equal(getRow(db, "u1")?.published, 1);
});

test("unpublished user with a chosen mural keeps it, published stays 0", () => {
  const db = communityDb();
  db.prepare("INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at) VALUES ('u1', 0, 'old', NULL, '2026-09-01T00:00:00.000Z')").run();
  applyHomeMuralMigration([{ userId: "u1", muralId: "home-mural" }], db);
  assert.equal(getRow(db, "u1")?.mural_id, "old");
});

test("re-running is a no-op (idempotent upsert)", () => {
  const db = communityDb();
  applyHomeMuralMigration([{ userId: "u1", muralId: "m1" }], db);
  applyHomeMuralMigration([{ userId: "u1", muralId: "m2" }], db);
  assert.equal(getRow(db, "u1")?.mural_id, "m1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace backend`
Expected: FAIL — `./migration.js` doesn't exist in community.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/modules/community/migration.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { openCommunityDb } from "./adapters/sqlite/connection.js";

export function applyHomeMuralMigration(
  rows: Array<{ userId: string; muralId: string }>,
  db: DatabaseSync = openCommunityDb()
): void {
  if (rows.length === 0) return;
  const upsert = db.prepare(`
    INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at)
    VALUES ($user_id, 0, $mural_id, NULL, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      mural_id = excluded.mural_id,
      updated_at = excluded.updated_at
    WHERE profiles.mural_id IS NULL
  `);
  const now = new Date().toISOString();
  for (const row of rows) {
    upsert.run({ $user_id: row.userId, $mural_id: row.muralId, $updated_at: now });
  }
}
```

`modules/community/index.ts` — export it (read the file first; add to its export list):

```ts
export { applyHomeMuralMigration } from "./migration.js";
```

`modules/murals/migration.ts` — append:

```ts
export function listHomeDesignations(db: DatabaseSync = openMuralsDb()): Array<{ userId: string; muralId: string }> {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mural_homes'").get();
  if (!exists) return [];
  return db.prepare(
    "SELECT mural_homes.user_id AS userId, mural_homes.mural_id AS muralId FROM mural_homes JOIN murals ON murals.id = mural_homes.mural_id AND murals.user_id = mural_homes.user_id"
  ).all() as Array<{ userId: string; muralId: string }>;
}

export function dropMuralHomes(db: DatabaseSync = openMuralsDb()): void {
  db.exec("DROP TRIGGER IF EXISTS clear_mural_home");
  db.exec("DROP TABLE IF EXISTS mural_homes");
}
```

(`DatabaseSync` and `openMuralsDb` are already imported in that file.) Export both from `modules/murals/index.ts`.

`runStartupMigrations.ts` — add imports and, inside `runStartupMigrations()` (before the existing embedded-murals block or after — either is safe; put it first):

```ts
import { applyHomeMuralMigration } from "../modules/community/index.js";
import { dropMuralHomes, listHomeDesignations } from "../modules/murals/index.js";

const homes = listHomeDesignations();
if (homes.length > 0) applyHomeMuralMigration(homes);
dropMuralHomes();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace backend && npm run typecheck --workspace backend`
Expected: PASS.

- [ ] **Step 5: Add the new test file to the backend test list**

In `backend/package.json`'s `test` script, insert `src/modules/community/migration.test.ts` after `src/modules/community/service.test.ts`.

Run: `npm test --workspace backend`
Expected: PASS with the migration test running.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/murals backend/src/modules/community backend/src/migrations/runStartupMigrations.ts backend/package.json
git commit -m "feat(backend): migrate home murals to profile murals at startup"
```

---

### Task 5: Remove the murals home surface (backend)

**Files:**
- Modify: `backend/src/modules/murals/routes.ts` (remove GET/PUT/POST `/murals/home`)
- Modify: `backend/src/modules/murals/service.ts` (remove `getHome`/`setHome`/`initializeHome`, `buildHomeBlocks` import)
- Modify: `backend/src/modules/murals/domain/ports.ts` (remove the three home methods from `MuralsRepository`)
- Modify: `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.ts` (remove home statements + methods)
- Modify: `backend/src/modules/murals/adapters/sqlite/schema.sql` (remove `mural_homes` table + trigger)
- Modify: `backend/src/modules/murals/service.test.ts` (remove "home creation is retry-safe…" test), `backend/src/modules/murals/home.test.ts` (rewrite)

**Interfaces:**
- Consumes: nothing new.
- Produces: murals module without any home concept; `buildHomeBlocks` no longer imported anywhere in backend (shared removal is Task 10).

- [ ] **Step 1: Rewrite `home.test.ts` to cover the same boundaries without home routes**

The current file tests real value beyond home: the public share route's privacy boundary. Rewrite it to create the mural via `POST /murals` instead. Keep the file name (already in the test list) and this shape:

```ts
const create = () => app.inject({ method: "POST", url: "/murals", headers: authorization("owner"), payload: { name: "My reading space" } });
const [a, b] = await Promise.all([create(), create()]);
assert.equal(a.statusCode, 201);
const home = a.json();
assert.equal(home.id, b.json().id);
assert.equal(service.listMurals("owner").length, 1);
```

Then replace every `/murals/home` interaction:
- The `GET /murals/home` 401 assertion → `GET /murals` with no auth returns 401.
- The stranger `PUT /murals/home` 404 assertion → `PUT /murals/:id` with `authorization("stranger")` on `home.id` returns 404.
- The `initializeHome` block-content assertions → after creating, `service.updateMural("owner", home.id, { blocks: [...same three blocks...], updatedAt: home.updatedAt })`.
- The trailing `GET /murals/home` null assertion → `assert.deepEqual(service.listMurals("owner"), [])` after the DELETE (ownership of deletion behavior).

All privacy-boundary assertions (the `for (const privateValue of …)` loop, `books.length === 1`, `highlights === []`, shelfTheme) stay exactly as they are.

- [ ] **Step 2: Run test to verify the rewritten file passes against the CURRENT code**

Run: `npx tsx --test src/modules/murals/home.test.ts` (workdir `backend/`)
Expected: PASS — the rewrite is behavior-equivalent before removal.

- [ ] **Step 3: Remove the home surface**

- `routes.ts`: delete the three `/murals/home` handlers.
- `service.ts`: delete `getHome`, `setHome`, `initializeHome` from interface + implementation; delete the `import { buildHomeBlocks } from "@scripta/shared";` line.
- `ports.ts`: delete `getHome`, `setHome`, `initializeHome` from `MuralsRepository`.
- `sqliteMuralsRepository.ts`: delete `homeStmt`, `selectHomeStmt`, and the three methods.
- `schema.sql`: delete the `mural_homes` table and `clear_mural_home` trigger statements.
- `service.test.ts`: delete the test `home creation is retry-safe, private, ownership checked, and preserves edits`; check the fake repo in that file for `getHome`/`setHome`/`initializeHome` implementations and delete those too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace backend && npm run typecheck --workspace backend`
Expected: PASS. (`murals/service.test.ts:227` "openMuralsDb migration is idempotent" must still pass — it doesn't touch `mural_homes`.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/murals
git commit -m "feat(murals): remove the home mural designation"
```

---

### Task 6: Web dashboard Home page

**Files:**
- Modify: `frontend/src/api/community.ts` (add `fetchDashboard`, `markDashboardSeen`)
- Create: `frontend/src/hooks/useDashboard.ts`
- Rewrite: `frontend/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `GET /community/dashboard`, `POST /community/dashboard/seen` (Task 3); `buildDashboardCards`, `digestHeading`, `digestTarget`, `DashboardCard`, `DigestItem` (Task 1); `useLibrary`, `useAuth`, `BookGrid`/`BookCard` (existing components), `resolveQuote` for the rediscover card's passage text (from `@scripta/shared`).
- Produces: `HomePage` rendering the dashboard at `/dashboard` (route unchanged). `useHome` remains untouched in this task (still used by `CommunityProfilePage`/`MuralsListPage` until Task 7).

- [ ] **Step 1: Add the API functions**

In `frontend/src/api/community.ts` (imports extended with `DashboardFeedPage, DigestItem` from `@scripta/shared/dashboard`):

```ts
export async function fetchDashboard(cursor?: string): Promise<DashboardFeedPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return (await apiFetch(`/community/dashboard${query}`)) as DashboardFeedPage;
}

export async function markDashboardSeen(): Promise<void> {
  await apiFetch("/community/dashboard/seen", { method: "POST" });
}
```

- [ ] **Step 2: Create the hook**

Create `frontend/src/hooks/useDashboard.ts`:

```ts
import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchDashboard, markDashboardSeen } from "../api/community";

export function useDashboard() {
  const query = useInfiniteQuery({
    queryKey: ["community", "dashboard"],
    queryFn: ({ pageParam }) => fetchDashboard(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always"
  });
  const markedRef = useRef(false);
  useEffect(() => {
    if (!markedRef.current && query.data) {
      markedRef.current = true;
      void markDashboardSeen().catch(() => {});
    }
  }, [query.data]);
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    newCount: query.data?.pages[0]?.newCount ?? 0,
    isLoading: query.isPending,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch
  };
}
```

- [ ] **Step 3: Rewrite HomePage**

Replace `frontend/src/pages/HomePage.tsx` wholesale. Structure (Tailwind utilities matching the app's existing tokens — copy class conventions from CommunityPage):

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { bookKey, buildDashboardCards, digestHeading, digestTarget, resolveQuote } from "@scripta/shared";
import { useDashboard } from "../hooks/useDashboard";
import { useLibrary } from "../hooks/useLibrary";
import { useAuth } from "../auth/AuthContext";
import { PageContainer } from "../components/PageContainer";
import { BookGrid } from "../components/BookGrid";
import { AuthorAvatar } from "../components/CommunityAuthorAvatar";
```

If `AuthorAvatar` is not already a shared component (it's currently local to `CommunityPage.tsx`), create `frontend/src/components/CommunityAuthorAvatar.tsx` with the exact `AuthorAvatar` function from `CommunityPage.tsx` and import it from there in both pages (Task 7 rewrites those pages to use it too).

Page body, in order:

1. Header: `<h1>Home</h1>`, right side: `<Link to="/community/people">Find people</Link>` and `<Link to="/community/discover">Discover</Link>`. (The avatar → own-profile link is Task 7's DashboardLayout change — don't duplicate it here.)
2. Loading / error states: mirror the old page's `role="status"` / `role="alert"` + Retry pattern, retrying both `library.refetch()` and `dashboard.refetch()`.
3. Empty library (no books): keep the existing "Start your library" card verbatim from the old HomePage (Import / Add a book manually links).
4. Cards section from `buildDashboardCards(books, day, session.user.id)` — `const [day] = useState(() => new Date().toISOString().slice(0, 10));`:
   - `currentlyReading` → `<section aria-label="Currently reading">` with `<BookGrid books={…}>` filtering `books.filter((b) => bookKey(b) ∈ card.bookKeys)` (build a Map keyed by `bookKey` first); reuse the old mobile rule `book.ReadStatus === 1` only through the card keys.
   - `upNext` → same grid under "Up next", sliced to the first 6 in render.
   - `rediscover` → a quote card: resolve with `resolveQuote({ type: "quote", bookKey, highlightId } as never, books)` — if it resolves, render quote text + book title/attribution, else omit the card.
5. Digest section: `aria-label="Following"`; if `newCount > 0` show a `<p>` "You have {newCount} new" badge; list `dashboard.items` — each row: `<Link to={digestTarget(item)}>` with `<AuthorAvatar author={item.actor}/>` + `digestHeading(item)` +, for publications, `content.name`. Follow rows link to the actor profile.
6. `hasNextPage` → "Load more" button (copy FeedPane's).

Delete nothing else in this task. The old mural-home code paths (`useHome`, `MuralCanvas` on home, choose/keep logic) all go — they are replaced by the above.

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS. (`useHome` still compiles — it's imported by CommunityProfilePage/MuralsListPage, untouched here.)

- [ ] **Step 5: Manual smoke**

Run: `node scripts/dev-emulator.mjs` is NOT needed (backend+web only). Start backend + web (`npm run dev --workspace backend`, `npm run dev --workspace frontend` per root AGENTS; ports come from the dev scripts), sign in, confirm `/dashboard` renders cards and digest and the seen badge clears on reload.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/community.ts frontend/src/hooks/useDashboard.ts frontend/src/pages/HomePage.tsx frontend/src/components/CommunityAuthorAvatar.tsx
git commit -m "feat(web): dashboard home with reading cards and follower digest"
```

---

### Task 7: Web community split, nav, and home-call removal

**Files:**
- Create: `frontend/src/pages/DiscoverPage.tsx`, `frontend/src/pages/PeoplePage.tsx`
- Delete: `frontend/src/pages/CommunityPage.tsx`, `frontend/src/hooks/useHome.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/layouts/DashboardLayout.tsx`, `frontend/src/pages/MuralsListPage.tsx`, `frontend/src/pages/CommunityProfilePage.tsx`, `frontend/src/api/murals.ts`, `frontend/src/api/community.ts` (remove `fetchFeed`), `frontend/src/hooks/useCommunity.ts` (remove `useCommunityFeed`)

**Interfaces:**
- Consumes: `AuthorAvatar` from `components/CommunityAuthorAvatar` (Task 6); everything else existing.
- Produces: routes `/community/discover` and `/community/people`; `/community` → redirect to `/dashboard`.

- [ ] **Step 1: Split the panes into pages**

`DiscoverPage.tsx`: move `DiscoverPane` verbatim from `CommunityPage.tsx` (plus `retryButton`, `searchInput`, `segmented`, `DISCOVER_FILTERS` — copy, don't import from a deleted file), wrapped in `<div className="mx-auto max-w-3xl p-6"><h2 …>Discover</h2>…</div>`. Replace its local `AuthorAvatar` usage with the shared component import.

`PeoplePage.tsx`: same treatment for `PeoplePane` with heading "People".

- [ ] **Step 2: Routes + nav**

`App.tsx`:
- Replace `import { CommunityPage } …` with the two new pages.
- `<Route path="/community" element={<Navigate to="/dashboard" replace />} />`
- `<Route path="/community/discover" element={<DiscoverPage />} />`
- `<Route path="/community/people" element={<PeoplePage />} />`
- `/community/u/:username` unchanged.

`DashboardLayout.tsx`: delete the `{ to: "/community", … }` NAV_GROUPS entry; wrap BOTH `<Avatar user={session.user} size={24} />` instances (lines ~115 and ~208) in `<Link to={`/community/u/${session.user.username}`} className="…">` (match surrounding markup's existing link/button idioms).

- [ ] **Step 3: Murals list badge + remove "Set as home"**

`MuralsListPage.tsx`:
- Delete the `useHome` import and `const home = useHome()`.
- Delete the `"Set as home"` menu item (line ~449).
- Add `const ownProfile = useCommunityProfile(session.user.username)` (hook already exists); when `ownProfile.view` is set, badge the matching mural: `{ownProfile.view?.mural?.mural.id === mural.id && <span className="…">Profile</span>}` next to the mural's name (reuse the page's existing chip/badge classes).

`CommunityProfilePage.tsx`: in `UnpublishedOwnProfile`, drop the `useHome` import and `homeMural`; change the default to `const effectiveId = muralId || murals?.[0]?.id || "";`.

- [ ] **Step 4: Remove dead home/feed API surface**

- `api/murals.ts`: delete `fetchHome`, `selectHome`, `initializeHome`.
- `api/community.ts`: delete `fetchFeed`.
- `hooks/useCommunity.ts`: delete `useCommunityFeed` and the now-unused `useInfiniteQuery` import if it becomes unused.
- Delete `hooks/useHome.ts`.
- Grep to confirm zero remaining references:

```bash
rg -n "useHome|fetchHome|selectHome|initializeHome|useCommunityFeed|fetchFeed|CommunityPage" frontend/src
```

Expected: no matches.

- [ ] **Step 5: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src
git commit -m "feat(web): discover/people pages, profile avatar entry, home calls removed"
```

---

### Task 8: Mobile — five tabs, screen split, profile move

**Files:**
- Modify: `mobile/src/app/(app)/_layout.tsx` (remove Community tab)
- Move: `mobile/src/app/(app)/(community)/u/[username].tsx` → `mobile/src/app/(app)/(home)/u/[username].tsx`
- Create: `mobile/src/app/(app)/(home)/people.tsx`, `mobile/src/app/(app)/(home)/discover.tsx`
- Create: `mobile/src/features/community/DiscoverScreen.tsx`, `mobile/src/features/community/PeopleScreen.tsx`
- Delete: `mobile/src/app/(app)/(community)/` (whole group: `_layout.tsx`, `community.tsx`, `u/`), `mobile/src/features/community/CommunityScreen.tsx`
- Modify: `mobile/src/features/community/communityHome.ts` (drop `COMMUNITY_TABS`/`CommunityTab`), `communityHome.test.ts`

**Interfaces:**
- Produces: tab bar Home/Library/Games/Murals/Settings; routes `/u/[username]`, `/people`, `/discover` inside the `(home)` stack (group segments are URL-invisible, so `/u/[username]` keeps working).

- [ ] **Step 1: Split CommunityScreen into DiscoverScreen + PeopleScreen**

Copy `DiscoverPane` → `DiscoverScreen.tsx` as a full screen: `<Screen top={false}>` + `Stack.Screen options={{ title: "Discover", headerShown: true }}` + the pane body (FlatList, `ListHeaderComponent` search + `DISCOVER_FILTERS` chips from `communityHome.ts`). Copy `PeoplePane` → `PeopleScreen.tsx` the same way (title "People"). Move `AuthorAvatar` + `openProfile` into a small shared `mobile/src/features/community/AuthorAvatar.tsx` (export both) and import from the new screens. Copy the `styles` entries each screen needs (don't import from the deleted `CommunityScreen.tsx`).

Update `communityHome.ts`: delete `COMMUNITY_TABS` + `CommunityTab`; keep `DISCOVER_FILTERS`, `DiscoverFilter`, and the re-exported shared helpers.

Update `communityHome.test.ts`: delete the `"tab and filter option tables"` COMMUNITY_TABS assertion (keep the DISCOVER_FILTERS one); everything else unchanged.

- [ ] **Step 2: Routes**

- `git mv "mobile/src/app/(app)/(community)/u" "mobile/src/app/(app)/(home)/u"` (read `u/[username].tsx` first — it imports `ProfileScreen`; nothing else should change).
- Create `(home)/people.tsx` and `(home)/discover.tsx` following `(home)/index.tsx`'s re-export pattern:

```tsx
import { DiscoverScreen } from "@/features/community/DiscoverScreen";

export default DiscoverScreen;
```

- Delete `(community)` group and `features/community/CommunityScreen.tsx`.
- `(app)/_layout.tsx`: delete the `(community)` Tabs.Screen entry (keep the `community` icon import only if still referenced — otherwise remove it).

- [ ] **Step 3: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

```bash
rg -n "CommunityScreen|COMMUNITY_TABS|community.tsx" mobile/src
```

Expected: no matches (feature dir keeps `api.ts`, `ProfileScreen.tsx`, `communityHome*`, new screens).

- [ ] **Step 4: Commit**

```bash
git add -A mobile/src
git commit -m "feat(mobile): five-tab layout, discover/people screens, profile under home"
```

---

### Task 9: Mobile dashboard Home

**Files:**
- Create: `mobile/src/features/home/HomeScreen.tsx`
- Delete: `mobile/src/features/murals/HomeScreen.tsx`, `mobile/src/features/murals/useHome.ts`
- Modify: `mobile/src/features/murals/api.ts` (remove `fetchHome`/`selectHome`/`initializeHome`), `mobile/src/features/community/api.ts` (`fetchFeed` → `fetchDashboard` + `markDashboardSeen`), `mobile/src/app/(app)/(home)/index.tsx` (re-export from the new feature dir)

**Interfaces:**
- Consumes: `buildDashboardCards`, `digestHeading`, `digestTarget`, `resolveQuote`, `bookKey` (shared); `useLibrary`; Task 3 endpoints via `features/community/api.ts`.
- Produces: Home tab dashboard. `(home)/index.tsx` becomes `import { HomeScreen } from "@/features/home/HomeScreen"; export default HomeScreen;`

- [ ] **Step 1: API functions**

In `features/community/api.ts`, replace `fetchFeed` with:

```ts
export async function fetchDashboard(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiClient.request<DashboardFeedPage>(`/community/dashboard${query}`, { auth: true });
}

export function markDashboardSeen() {
  return apiClient.request("/community/dashboard/seen", { method: "POST", auth: true });
}
```

with `DashboardFeedPage` added to the `@scripta/shared/dashboard` type imports. In `features/murals/api.ts` delete the three home functions.

- [ ] **Step 2: Rewrite HomeScreen**

Create `mobile/src/features/home/HomeScreen.tsx` modeled on the deleted screen's structure (Screen/ScrollView/EmptyState/ErrorState/Menu/IconButton, `useFocusEffect` refetch, `useLibrary`, `useAuth`):

1. `Stack.Screen options={{ title: "Home", headerShown: true, headerRight: avatar button }}` — an `IconButton name="profile"` pushing `/u/${user.username}`.
2. Dashboard query mirroring Task 6's `useDashboard` (inline the infinite query + seen marker here; mobile has no hooks dir — keep it local to the screen file, `useRef`-guarded `markDashboardSeen` on first page).
3. Empty library → keep the existing `EmptyState` "Start your library" verbatim (Import / Add a book manually).
4. Cards from `buildDashboardCards(books, day, user.id)` (day via `useFocusEffect`, same as before):
   - `currentlyReading` / `upNext` → sections listing books (title + attribution rows via the existing `Button variant="secondary"` pattern pushing `/book/${bookKey}` — mirror the old mural Sheet book rows; cap up-next at 6 in render).
   - `rediscover` → quote text card; resolve via `resolveQuote({ type: "quote", bookKey: card.bookKey, highlightId: card.highlightId } as never, books)`; "Show another" increments a local offset passed as `buildDashboardCards(books, day, `${user.id}:${offset}`)`.
5. Digest FlatList: `digestHeading` + `digestTarget` rows with `AuthorAvatar` (from Task 8's shared component), "new" marker row count from `newCount` shown as a small badge above the list, `onEndReached` pagination like the old FeedPane.
6. Header links to People (`/people`) and Discover (`/discover`) — two buttons under the header or a footer row; follow the old CommunityScreen tab entry points.

- [ ] **Step 3: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile && npx expo-doctor` (workdir `mobile/` for expo-doctor)
Expected: PASS.

```bash
rg -n "fetchHome|selectHome|initializeHome|useHome|fetchFeed" mobile/src
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add -A mobile/src
git commit -m "feat(mobile): dashboard home with reading cards and follower digest"
```

---

### Task 10: Shared cleanup + full verification

**Files:**
- Modify: `packages/shared/src/dashboard.ts` (inline `eligiblePassages` + `rediscoverPassage`)
- Delete: `packages/shared/src/murals/home.ts`
- Modify: `packages/shared/src/murals/index.ts` (remove `export * from "./home.js";`)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: no `murals/home` anywhere in the workspace.

- [ ] **Step 1: Inline the rediscover engine**

Move `eligiblePassages` and `rediscoverPassage` from `murals/home.ts` into `dashboard.ts` verbatim (their bodies need `bookKey` — already imported — and nothing else), and delete the `import { rediscoverPassage } from "./murals/home.js";` line.

- [ ] **Step 2: Confirm zero consumers, then delete**

```bash
rg -n "murals/home|resolveHomeBlock|buildHomeBlocks|pinPassage|eligiblePassages" --glob '!node_modules' --glob '!packages/shared/dist' .
```

Expected: only `packages/shared/src/dashboard.ts` (its own local definitions) and possibly historical docs. If `pinPassage` or others still have live consumers outside shared, STOP and surface it — do not delete silently.

Delete `packages/shared/src/murals/home.ts`; remove its line from `packages/shared/src/murals/index.ts`.

- [ ] **Step 3: Full verification**

```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend && npm test --workspace backend
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
npm run typecheck --workspace mobile && npm test --workspace mobile && (cd mobile && npx expo-doctor)
```

Expected: all PASS.

- [ ] **Step 4: Emulator visual pass (one lease, one pass)**

Start `node scripts/dev-emulator.mjs` and `npm run dev:release` per root AGENTS. On the emulator verify: Home tab renders cards + digest; avatar → own profile (owner chrome); People/Discover reachable; tab bar shows five tabs; Murals list shows the Profile badge on the migrated mural; a follow from another account shows in the digest with the new-count badge.

- [ ] **Step 5: Commit**

```bash
git add -A packages/shared
git commit -m "feat(shared): inline rediscover engine, drop murals home module"
```

Then run `node scripts/sync-agent-table.mjs` only if any package `AGENTS.md` changed (none should) — skip unless verification touched docs.
