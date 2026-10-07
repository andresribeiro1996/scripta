# Author Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every "can this viewer see this reader" decision in the backend community module into one visibility module, and let the owner of an unpublished profile see their own profile and library.

**Architecture:** `backend/src/modules/community/domain/visibility.ts` holds small pure rules over a `Standing`, plus `createVisibility(repo, viewerId)`, which loads and caches each target's standing per request. The community service and `readerVisibility` call it, so no inline `published === 1` check is left. The feed's SQL switch rule stays in SQL, and is named and tested.

**Tech Stack:** TypeScript and Fastify. Tests use `node:test` through `tsx`. SQLite via `node:sqlite`. `@scripta/shared` is consumed through `dist`.

**Spec:** `docs/superpowers/specs/2026-10-07-author-visibility-design.md`

## Global Constraints

- **No comments in code** (`AGENTS.md`).
- **The backend test list is explicit.** `npm test --workspace backend` runs a list of files in `backend/package.json`'s `test` script. A new test file must be added to it, or it never runs.
- **Shared rebuild.** After any change under `packages/shared`, run `npm run build --workspace @scripta/shared` before backend, frontend or mobile checks.
- **Mobile env.** Mobile tests and typecheck need `EXPO_PUBLIC_API_URL=http://localhost:3000`.
- **Behaviour.** Behaviour is unchanged except the spec's three listed changes:
  1. The owner sees their own unpublished profile.
  2. The owner sees their own library. Its route becomes optional-auth.
  3. Suggestions compute `private`.
- **Existing tests.** Existing community and works tests must pass unchanged, except the ones a task names explicitly.
- **Unchanged contracts.** `readerVisibility`'s signature and return shape are unchanged, and works is not edited.
- **Out of scope.** Do not touch:
  - share tokens, vote codes and game publishing
  - the Discover and works `games()` username-only gate
  - the feed SQL logic

## Review Focus

1. **A viewer who is also the target.** `isViewer` must only widen `canViewContent`.
   - The glyph, participant naming, following and reader listing must ignore it.
   - Pinned in Task 1 by the "isViewer only affects content" test.
2. **A target with no `profiles` row.** It must read as unpublished with `DEFAULT_FEED_SETTINGS`, so it is private to strangers and visible to the owner.
   - Pinned in Task 1 by "a user with no profile row".
   - Pinned in Task 3 by "owner without a profiles row sees their own profile".
3. **Followees must not be queried when no rule needs them.** The glyph lookup in the dashboard and Discover must not add a `listFollowees` call per request.
   - Pinned in Task 1 by "followees are read lazily and once".
4. **A stranger still gets the private shell, and 404 on activity and library.** Owner widening must not leak to anyone else. That includes a viewer who follows the unpublished user.
   - Pinned in Task 3 by "a follower of an unpublished user still gets the private shell and 404s".
5. **An invalid token on the library route answers 401, not anonymous.** This matches the profile and activity routes, now that the library route reads an optional viewer.
   - Pinned in Task 3 by the routes test "library rejects an invalid bearer token".

---

### Task 1: The visibility module

**Files:**
- Create: `backend/src/modules/community/domain/visibility.ts`
- Create: `backend/src/modules/community/domain/visibility.test.ts`
- Modify: `backend/src/modules/community/domain/ports.ts` (the `visibilityRows` return type)
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts` (`visibilityStmt` and `visibilityRows`)
- Modify: `backend/package.json` (add the new test file to `test`)

**Interfaces:**
- Produces, all exported from `domain/visibility.ts`:
  - `interface Standing { published: boolean; isViewer: boolean; followedByViewer: boolean; settings: FeedSettings }`
  - `interface ReaderListing { followed: boolean; published: boolean; showGlyph: boolean }`
  - `canViewContent(s: Standing): boolean`
  - `isPrivate(s: Standing): boolean`
  - `showsGlyph(s: Standing): boolean`
  - `canNameAsParticipant(s: Standing): boolean`
  - `canFollow(s: Standing, followsViewer: boolean): boolean`
  - `readerListing(s: Standing): ReaderListing | undefined`
  - `createVisibility(repo: CommunityRepository, viewerId: string | null)`. It returns:
    ```ts
    {
      standing(userId: string): Standing;
      standings(userIds: string[]): Map<string, Standing>;
      canViewContent(userId: string): boolean;
      isPrivate(userId: string): boolean;
      showsGlyph(userId: string): boolean;
      canNameAsParticipant(userId: string): boolean;
      canFollow(userId: string): boolean;
    }
    ```
  - `type Visibility = ReturnType<typeof createVisibility>`
- Produces, in `domain/ports.ts`: `export interface VisibilityRow { user_id: string; published: number; show_publications: number; show_reading: number; show_votes: number; show_follows: number; show_reader_glyph: number }`. `visibilityRows(userIds: string[]): VisibilityRow[]`.

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/community/domain/visibility.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FEED_SETTINGS, type FeedSettings } from "@scripta/shared/community";
import type { CommunityRepository, VisibilityRow } from "./ports.js";
import type { ProfileRow } from "./types.js";
import { canFollow, canNameAsParticipant, canViewContent, createVisibility, isPrivate, readerListing, showsGlyph, type Standing } from "./visibility.js";

const standing = (over: Partial<Standing> = {}): Standing => ({ published: false, isViewer: false, followedByViewer: false, settings: DEFAULT_FEED_SETTINGS, ...over });
const on = (over: Partial<FeedSettings>): FeedSettings => ({ ...DEFAULT_FEED_SETTINGS, ...over });

test("content is visible when published or to the owner", () => {
  assert.equal(canViewContent(standing()), false);
  assert.equal(canViewContent(standing({ published: true })), true);
  assert.equal(canViewContent(standing({ isViewer: true })), true);
  assert.equal(canViewContent(standing({ followedByViewer: true, settings: on({ reading: true }) })), false);
  assert.equal(isPrivate(standing()), true);
  assert.equal(isPrivate(standing({ isViewer: true })), false);
  assert.equal(isPrivate(standing({ published: true })), false);
});

test("the glyph needs a published profile and the glyph switch", () => {
  assert.equal(showsGlyph(standing({ published: true, settings: on({ readerGlyph: true }) })), true);
  assert.equal(showsGlyph(standing({ published: true })), false);
  assert.equal(showsGlyph(standing({ settings: on({ readerGlyph: true }) })), false);
});

test("participants are named only when published with votes shown", () => {
  assert.equal(canNameAsParticipant(standing({ published: true })), true);
  assert.equal(canNameAsParticipant(standing({ published: true, settings: on({ votes: false }) })), false);
  assert.equal(canNameAsParticipant(standing({ settings: on({ votes: true }) })), false);
});

test("an unpublished reader can be followed only by someone they follow", () => {
  assert.equal(canFollow(standing({ published: true }), false), true);
  assert.equal(canFollow(standing(), true), true);
  assert.equal(canFollow(standing(), false), false);
});

test("reader listings follow publication, follows and reading sharing", () => {
  assert.deepEqual(readerListing(standing({ published: true })), { followed: false, published: true, showGlyph: false });
  assert.deepEqual(readerListing(standing({ published: true, followedByViewer: true })), { followed: true, published: true, showGlyph: false });
  assert.deepEqual(readerListing(standing({ followedByViewer: true, settings: on({ reading: true }) })), { followed: true, published: false, showGlyph: false });
  assert.equal(readerListing(standing({ followedByViewer: true })), undefined);
  assert.equal(readerListing(standing({ settings: on({ reading: true }) })), undefined);
  assert.deepEqual(readerListing(standing({ published: true, settings: on({ readerGlyph: true }) })), { followed: false, published: true, showGlyph: true });
});

test("isViewer only affects content", () => {
  const self = standing({ isViewer: true, settings: on({ readerGlyph: true, votes: true, reading: true }) });
  assert.equal(canViewContent(self), true);
  assert.equal(showsGlyph(self), false);
  assert.equal(canNameAsParticipant(self), false);
  assert.equal(canFollow(self, false), false);
  assert.equal(readerListing(self), undefined);
});

function fakeRepo(profiles: Record<string, { published: number; settings?: FeedSettings }>, follows: Array<[string, string]>) {
  const calls = { getProfileRow: 0, getFeedSettings: 0, listFollowees: 0, getFollow: 0, visibilityRows: 0 };
  const row = (id: string): ProfileRow => ({ user_id: id, published: profiles[id]!.published, mural_id: null, published_at: null, updated_at: "2026-10-07T00:00:00.000Z", feed_settings: null });
  const repo = {
    getProfileRow(id: string) { calls.getProfileRow++; return profiles[id] ? row(id) : undefined; },
    getFeedSettings(id: string) { calls.getFeedSettings++; return profiles[id]?.settings ?? null; },
    listFollowees(id: string) { calls.listFollowees++; return follows.filter(([from]) => from === id).map(([, to]) => to); },
    getFollow(from: string, to: string) { calls.getFollow++; return follows.some(([a, b]) => a === from && b === to) ? { follower_id: from, followee_id: to, created_at: "" } : undefined; },
    visibilityRows(ids: string[]): VisibilityRow[] {
      calls.visibilityRows++;
      return ids.filter((id) => profiles[id]).map((id) => {
        const s = profiles[id]!.settings ?? DEFAULT_FEED_SETTINGS;
        return { user_id: id, published: profiles[id]!.published, show_publications: Number(s.publications), show_reading: Number(s.reading), show_votes: Number(s.votes), show_follows: Number(s.follows), show_reader_glyph: Number(s.readerGlyph ?? false) };
      });
    }
  } as unknown as CommunityRepository;
  return { repo, calls };
}

test("a user with no profile row reads as unpublished with default settings", () => {
  const { repo } = fakeRepo({}, []);
  const visibility = createVisibility(repo, "viewer");
  assert.deepEqual({ ...visibility.standing("ghost") }, { published: false, isViewer: false, followedByViewer: false, settings: DEFAULT_FEED_SETTINGS });
  assert.equal(visibility.isPrivate("ghost"), true);
  assert.equal(createVisibility(repo, "ghost").canViewContent("ghost"), true);
});

test("standings are read once per user and followees lazily and once", () => {
  const { repo, calls } = fakeRepo({ a: { published: 1, settings: on({ readerGlyph: true }) }, b: { published: 0 } }, [["viewer", "b"]]);
  const visibility = createVisibility(repo, "viewer");
  assert.equal(visibility.showsGlyph("a"), true);
  assert.equal(visibility.showsGlyph("a"), true);
  assert.equal(calls.getProfileRow, 1);
  assert.equal(calls.getFeedSettings, 1);
  assert.equal(calls.listFollowees, 0);
  assert.equal(visibility.standing("b").followedByViewer, true);
  assert.equal(visibility.standing("a").followedByViewer, false);
  assert.equal(calls.listFollowees, 1);
});

test("a signed-out reader never reads followees", () => {
  const { repo, calls } = fakeRepo({ a: { published: 1 } }, []);
  assert.equal(createVisibility(repo, null).standing("a").followedByViewer, false);
  assert.equal(calls.listFollowees, 0);
});

test("canFollow checks the reverse follow only for an unpublished target", () => {
  const { repo, calls } = fakeRepo({ pub: { published: 1 }, priv: { published: 0 } }, [["priv", "me"]]);
  const visibility = createVisibility(repo, "me");
  assert.equal(visibility.canFollow("pub"), true);
  assert.equal(calls.getFollow, 0);
  assert.equal(visibility.canFollow("priv"), true);
  assert.equal(createVisibility(repo, "other").canFollow("priv"), false);
});

test("standings batch one rows query and skip users without a profile row", () => {
  const { repo, calls } = fakeRepo({ a: { published: 1 }, b: { published: 0, settings: on({ reading: true }) } }, [["viewer", "b"]]);
  const map = createVisibility(repo, "viewer").standings(["a", "b", "ghost"]);
  assert.deepEqual([...map.keys()], ["a", "b"]);
  assert.equal(map.get("b")!.settings.reading, true);
  assert.equal(map.get("b")!.followedByViewer, true);
  assert.equal(calls.visibilityRows, 1);
  assert.equal(calls.getProfileRow, 0);
  assert.equal(createVisibility(repo, "viewer").standings([]).size, 0);
});
```

Add `src/modules/community/domain/visibility.test.ts` to `backend/package.json`'s `test` script, right after `src/modules/community/service.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run, from `backend/`: `npx tsx --test src/modules/community/domain/visibility.test.ts`
Expected: FAIL, with "Cannot find module './visibility.js'".

- [ ] **Step 3: Widen `visibilityRows`**

In `domain/ports.ts`, add:
```ts
export interface VisibilityRow {
  user_id: string;
  published: number;
  show_publications: number;
  show_reading: number;
  show_votes: number;
  show_follows: number;
  show_reader_glyph: number;
}
```
and change the port method to `visibilityRows(userIds: string[]): VisibilityRow[];`.

In `adapters/sqlite/sqliteCommunityRepository.ts`:
- Change `visibilityStmt` to:
  ```ts
  const visibilityStmt = db.prepare(`SELECT user_id, published, show_publications, show_reading, show_votes, show_follows, show_reader_glyph FROM profiles WHERE user_id IN (SELECT value FROM json_each(?))`);
  ```
- Change `visibilityRows`'s cast to `as unknown as VisibilityRow[]`, and import `type VisibilityRow` from `../../domain/ports.js`.

- [ ] **Step 4: Implement the module**

`backend/src/modules/community/domain/visibility.ts`:
```ts
import { DEFAULT_FEED_SETTINGS, type FeedSettings } from "@scripta/shared/community";
import type { CommunityRepository, VisibilityRow } from "./ports.js";

export interface Standing {
  published: boolean;
  isViewer: boolean;
  followedByViewer: boolean;
  settings: FeedSettings;
}

export interface ReaderListing {
  followed: boolean;
  published: boolean;
  showGlyph: boolean;
}

export const canViewContent = (s: Standing): boolean => s.published || s.isViewer;
export const isPrivate = (s: Standing): boolean => !canViewContent(s);
export const showsGlyph = (s: Standing): boolean => s.published && s.settings.readerGlyph === true;
export const canNameAsParticipant = (s: Standing): boolean => s.published && s.settings.votes;
export const canFollow = (s: Standing, followsViewer: boolean): boolean => s.published || followsViewer;

export function readerListing(s: Standing): ReaderListing | undefined {
  const followed = s.followedByViewer && (s.published || s.settings.reading);
  if (!s.published && !followed) return undefined;
  return { followed, published: s.published, showGlyph: showsGlyph(s) };
}

const settingsOf = (row: VisibilityRow): FeedSettings => ({
  publications: row.show_publications === 1,
  reading: row.show_reading === 1,
  votes: row.show_votes === 1,
  follows: row.show_follows === 1,
  readerGlyph: row.show_reader_glyph === 1
});

export function createVisibility(repo: CommunityRepository, viewerId: string | null) {
  let followees: Set<string> | undefined;
  const follows = (userId: string): boolean => {
    if (viewerId === null) return false;
    followees ??= new Set(repo.listFollowees(viewerId));
    return followees.has(userId);
  };
  const make = (userId: string, published: boolean, settings: FeedSettings): Standing => ({
    published,
    isViewer: userId === viewerId,
    get followedByViewer() {
      return follows(userId);
    },
    settings
  });
  const cache = new Map<string, Standing>();
  const standing = (userId: string): Standing => {
    let found = cache.get(userId);
    if (!found) {
      found = make(userId, repo.getProfileRow(userId)?.published === 1, repo.getFeedSettings(userId) ?? DEFAULT_FEED_SETTINGS);
      cache.set(userId, found);
    }
    return found;
  };
  return {
    standing,
    standings(userIds: string[]): Map<string, Standing> {
      const found = new Map<string, Standing>();
      if (userIds.length === 0) return found;
      for (const row of repo.visibilityRows(userIds)) found.set(row.user_id, make(row.user_id, row.published === 1, settingsOf(row)));
      return found;
    },
    canViewContent: (userId: string): boolean => canViewContent(standing(userId)),
    isPrivate: (userId: string): boolean => isPrivate(standing(userId)),
    showsGlyph: (userId: string): boolean => showsGlyph(standing(userId)),
    canNameAsParticipant: (userId: string): boolean => canNameAsParticipant(standing(userId)),
    canFollow(userId: string): boolean {
      const s = standing(userId);
      return canFollow(s, !s.published && viewerId !== null && repo.getFollow(userId, viewerId) !== undefined);
    }
  };
}

export type Visibility = ReturnType<typeof createVisibility>;
```

- [ ] **Step 5: Run the tests and typecheck**

From the worktree root:
```bash
cd backend && npx tsx --test src/modules/community/domain/visibility.test.ts && cd ..
npm run typecheck --workspace backend
npm test --workspace backend
```
Expected: the new tests pass, typecheck exits 0, and the full backend suite passes. `readerVisibility` still reads only the columns it used, so nothing else changes yet.

If the service-test repo fake (`community/service.test.ts`, `visibilityRows() { return []; }`) fails typecheck against the wider type, leave it as is. An empty array satisfies `VisibilityRow[]`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/community/domain/visibility.ts backend/src/modules/community/domain/visibility.test.ts backend/src/modules/community/domain/ports.ts backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts backend/package.json
git commit -m "Add one community visibility module with pure rules and a per-request reader"
```

### Task 2: Route the existing checks through the module (no behaviour change)

**Files:**
- Modify: `backend/src/modules/community/service.ts` (`glyphLookup`, `participationItems`, `follow`, `searchPeople`, `suggestPeople`, `createCommunityPublicApi().readerVisibility`)
- Modify: `backend/src/modules/community/adapters/sqlite/schema.test.ts` (the feed-defaults agreement test)
- Modify: `backend/README.md` (the community visibility rules bullet)

**Interfaces:**
- Consumes: `createVisibility` and `readerListing` from `./domain/visibility.js` (Task 1).
- Produces: no new exports. `CommunityPublicApi.readerVisibility` keeps its signature `(viewerId: string | null, userIds: string[]) => Map<string, { followed: boolean; published: boolean; showGlyph: boolean }>`.

- [ ] **Step 1: Write the feed-defaults test first**

Add to `backend/src/modules/community/adapters/sqlite/schema.test.ts`, using the file's existing setup helpers. Read the top of the file for how it opens a database and builds the repository, and reuse those helpers.
```ts
test("a profile row's column defaults are the shared feed defaults", () => {
  const db = /* the file's existing in-memory community db helper */;
  db.prepare(`INSERT INTO profiles (user_id, published, updated_at) VALUES ('fresh', 0, '2026-10-07T00:00:00.000Z')`).run();
  assert.deepEqual(createSqliteCommunityRepository(db).getFeedSettings("fresh"), DEFAULT_FEED_SETTINGS);
});
```
If `profiles` has another NOT NULL column without a default, add it to the INSERT with a neutral value. If an existing test already asserts exactly this, skip this step and name that test in your report.

Run: `cd backend && npx tsx --test src/modules/community/adapters/sqlite/schema.test.ts`
Expected: PASS. This pins today's behaviour.

- [ ] **Step 2: Rewire the service**

In `service.ts`, import:
```ts
import { createVisibility, readerListing, type ReaderListing } from "./domain/visibility.js";
```

`glyphLookup` becomes:
```ts
  const glyphLookup = (): ((userId: string) => IdentityKey | null) => {
    const visibility = createVisibility(repo, null);
    const cache = new Map<string, IdentityKey | null>();
    return (userId) => {
      if (cache.has(userId)) return cache.get(userId) ?? null;
      const glyph = visibility.showsGlyph(userId) ? deps.readerGlyphFor(userId) : null;
      cache.set(userId, glyph);
      return glyph;
    };
  };
```

In `participationItems`, add `const visibility = createVisibility(repo, viewerId);` after `const glyphOf = glyphLookup();`. Replace the `nameable` filter with:
```ts
        const nameable = game.recent.map((entry) => entry.userId).filter((userId) => visibility.canNameAsParticipant(userId));
```

In `follow`, replace the published line
```ts
      if (repo.getProfileRow(followeeId)?.published !== 1 && !repo.getFollow(followeeId, followerId)) throw new ProfileNotFoundError();
```
with
```ts
      if (!createVisibility(repo, followerId).canFollow(followeeId)) throw new ProfileNotFoundError();
```

In `searchPeople`, add `const visibility = createVisibility(repo, viewerId);` after `const glyphOf = glyphLookup();`, and change `private: repo.getProfileRow(id)?.published !== 1` to `private: visibility.isPrivate(id)`.

In `suggestPeople`, add `const visibility = createVisibility(repo, viewerId);` after `const glyphOf = glyphLookup();`, and change `private: false,` to `private: visibility.isPrivate(entry.id),`.

`createCommunityPublicApi().readerVisibility` becomes:
```ts
    readerVisibility(viewerId, userIds) {
      const visible = new Map<string, ReaderListing>();
      for (const [userId, standing] of createVisibility(repo, viewerId).standings(userIds)) {
        const listing = readerListing(standing);
        if (listing) visible.set(userId, listing);
      }
      return visible;
    }
```
and change the `CommunityPublicApi.readerVisibility` return type to `Map<string, ReaderListing>`. It is the same shape.

Leave `settingsFor` in place: `getActivity`, `getOwnProfile`, the profile view's `feedSettings` and the backfill still use it.

- [ ] **Step 3: Document the rules**

In `backend/README.md`, find the community module's notes. If there is no notes section for community, add the bullet after the module table. Add:
```markdown
- **Who sees a reader (community).** `community/domain/visibility.ts` decides it.
  - Profile content (mural, published lists, activity, library) is visible when the profile is published, or to its owner.
  - Strangers get a `private` shell for an unpublished profile.
  - The reader glyph needs a published profile with the glyph switch on.
  - Participants are named only when published, with votes shown.
  - An unpublished reader can be followed only by someone they follow.
  - Works readers list a reader who is published, or followed with reading shared.
  - **Feed rule.** The dashboard feed is gated only by the author's per-category switches (`authorShows` in the SQLite repository), not by publishing.
  - **Username-only.** Discover and works `games()` are gated only by the author having a username.
```

- [ ] **Step 4: Run all backend checks**

```bash
npm run typecheck --workspace backend
npm test --workspace backend
```
Expected: exit 0, with every existing community, works and auth test passing unchanged. A failure means behaviour drifted, so fix the code, not the test.

Then check that no inline published checks remain:
```bash
rg -n "published === 1|published !== 1|show_reader_glyph" backend/src/modules/community/service.ts backend/src/modules/works
```
Expected: the only hits are in `getProfileByUsername`, `visibleUserId`, `getOwnProfile`, `publishProfile`/`unpublishProfile`/`setShelfMural` (own-state writes), and `getProfileByUsername`'s `publishedAt`. Task 3 removes the visibility ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/community/service.ts backend/src/modules/community/adapters/sqlite/schema.test.ts backend/README.md
git commit -m "Route community glyph, naming, follow and people checks through the visibility module"
```

### Task 3: The owner sees their own unpublished profile and library

**Files:**
- Modify: `backend/src/modules/community/service.ts` (`visibleUserId`, `publishedUserId`, `getProfileByUsername`, `getLibrary`, `getActivity`, and the `CommunityService` interface)
- Modify: `backend/src/modules/community/routes.ts` (the library route)
- Modify: `backend/src/modules/community/service.test.ts`
- Modify: `backend/src/modules/community/routes.test.ts`
- Modify: `packages/shared/src/community/api.ts` (`fetchProfileLibrary` auth)
- Modify: `packages/shared/src/community/api.test.ts`

**Interfaces:**
- Consumes: `createVisibility` (Task 1).
- Produces: `CommunityService.getLibrary(username: string, viewerId?: string): { data: Record<string, unknown> | null }`. Shared `createCommunityApi().fetchProfileLibrary` sends `auth: "optional"`.

- [ ] **Step 1: Write the failing tests**

In `service.test.ts`:

Replace the test "getProfileByUsername 404s for an unknown username and for the viewer's own unpublished profile" with:
```ts
test("getProfileByUsername 404s for an unknown username", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getProfileByUsername("ghost"), ProfileNotFoundError);
});

test("the owner sees their own unpublished profile in full", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, readerProfiles, ownedMurals, muralPayloads, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  ownedMurals.add("alice:m1");
  muralPayloads.set("alice:m1", fakePayload);
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  profiles.set("alice", profileRow("alice", { published: 0, mural_id: "m1" }));
  const view = service.getProfileByUsername("alice", "alice");
  assert.equal(view.private, false);
  assert.equal(view.profile.publishedAt, null);
  assert.deepEqual(view.mural, fakePayload);
  assert.deepEqual(view.published.tierlists.map((t) => t.id), ["t1"]);
  assert.ok(view.feedSettings);
});

test("owner without a profiles row sees their own profile", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  const view = service.getProfileByUsername("alice", "alice");
  assert.equal(view.private, false);
  assert.equal(view.mural, null);
});

test("a follower of an unpublished user still gets the private shell and 404s", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, readerProfiles, libraries } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  libraries.set("alice", { books: [] });
  profiles.set("alice", profileRow("alice", { published: 0 }));
  repo.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: at(1) });
  const view = service.getProfileByUsername("alice", "bob");
  assert.equal(view.private, true);
  assert.equal(view.mural, null);
  assert.throws(() => service.getActivity("alice", "bob", undefined, 10), ProfileNotFoundError);
  assert.throws(() => service.getLibrary("alice", "bob"), ProfileNotFoundError);
  assert.throws(() => service.getLibrary("alice"), ProfileNotFoundError);
});
```

Extend the test "getLibrary serves a published owner's library and 404s otherwise" by adding before its closing `});`:
```ts
  assert.deepEqual(service.getLibrary("bob", "bob"), { data: { books: [{ Title: "Emma" }] } });
```

The helper names (`fakePayload`, `tierRef`, `profileRow`, `reader`, `at`, the `createDeps` maps) are the ones the neighbouring tests already use. If a map has a different name in `createDeps`, use the real one.

In `routes.test.ts`, find the test "library endpoint returns the owner's library and 404s when unpublished" (around :571). Read how the profile-route tests in the same file sign a request (the bearer-token helper used by the test around :164, "viewer from the bearer token") and how they assert a 401 for a bad token (around :120). Add:
```ts
test("library passes the bearer viewer to the service", async () => {
  /* build the app with buildPublicCommunityRoutes(fakeService({ getLibrary: (username, viewerId) => ({ data: { username, viewerId: viewerId ?? null } }) })) the same way the :164 test does */
  /* GET /community/profiles/alice/library with that test's valid bearer header */
  /* assert 200 and body.data.viewerId equals that test's user id */
});

test("library rejects an invalid bearer token", async () => {
  /* same app; GET /community/profiles/alice/library with Authorization: "Bearer not-a-token" */
  /* assert status 401, as the discover/profile bad-token test does */
});
```
Write these two tests as concrete code that mirrors the existing :120 and :164 tests line for line. The comments above describe what to copy, and none of them may stay in the file.

In `packages/shared/src/community/api.test.ts`, change the `fetchProfileLibrary` case's expected init from `{ auth: "none" }` to `{ auth: "optional" }`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npx tsx --test src/modules/community/service.test.ts src/modules/community/routes.test.ts; cd ..
npm test --workspace @scripta/shared
```
Expected:
- The owner tests fail with `ProfileNotFoundError`.
- The new routes tests fail, because the viewer is undefined and the bad token gets a 200.
- The shared test fails on the `fetchProfileLibrary` auth.

- [ ] **Step 3: Implement**

In `service.ts`, replace `visibleUserId` and `publishedUserId` with:
```ts
  const contentOwner = (username: string, viewerId: string | undefined): string => {
    const userId = deps.findUserIdByUsername(username);
    if (!userId || !createVisibility(repo, viewerId ?? null).canViewContent(userId)) throw new ProfileNotFoundError();
    return userId;
  };
```

`getActivity`'s first line becomes `const userId = contentOwner(username, viewerId);`.

`getLibrary` becomes:
```ts
    getLibrary(username, viewerId) {
      return { data: deps.resolveLibrary(contentOwner(username, viewerId)) };
    },
```
and the `CommunityService` interface line becomes `getLibrary(username: string, viewerId?: string): { data: Record<string, unknown> | null };`.

`getProfileByUsername` becomes:
```ts
    getProfileByUsername(username, viewerId) {
      const userId = deps.findUserIdByUsername(username);
      if (!userId) throw new ProfileNotFoundError();
      const author = deps.resolveProfiles([userId]).get(userId);
      if (!author) throw new ProfileNotFoundError();
      const visibility = createVisibility(repo, viewerId ?? null);
      const shown = visibility.canViewContent(userId);
      const published = visibility.standing(userId).published;
      const row = repo.getProfileRow(userId);
      const mural = shown && row?.mural_id ? deps.murals.getMuralPublicPayload(userId, row.mural_id) : null;
      const glyphOf = glyphLookup();
      const view: CommunityProfileView = {
        private: visibility.isPrivate(userId),
        profile: {
          user: withGlyph(author, userId, glyphOf),
          publishedAt: published && row ? row.published_at ?? row.updated_at : null,
          followerCount: repo.countFollowers(userId),
          followingCount: repo.countFollowing(userId),
          viewerFollows: viewerId ? repo.getFollow(viewerId, userId) !== undefined : undefined
        },
        mural,
        published: {
          tierlists: shown ? deps.tierlists.listByOwner(userId).map(toTierlistSummary) : [],
          tournaments: shown ? deps.tournaments.listByOwner(userId).map(toTournamentSummary) : [],
          quizzes: shown ? deps.quizzes.listByOwner(userId).map(toQuizSummary) : []
        }
      };
      if (viewerId === userId) view.feedSettings = settingsFor(userId);
      return view;
    },
```
Keep the order of the 404 checks as above: unknown username, then no reader profile. A stranger viewing an unpublished user still passes both and gets the shell.

In `routes.ts`, the library route becomes:
```ts
    app.get("/community/profiles/:username/library", async (request, reply) => {
      const { username } = request.params as { username: string };
      try {
        const viewer = getOptionalAuthenticatedUser(request);
        const library = service.getLibrary(username, viewer?.id);
        reply.header("Cache-Control", "no-store");
        return reply.send(library);
      } catch (err) {
        if (err instanceof ProfileNotFoundError) return reply.code(404).send({ error: "No published profile at that address." });
        throw err;
      }
    });
```

In `packages/shared/src/community/api.ts`, `fetchProfileLibrary`'s init becomes `{ auth: "optional" }`.

- [ ] **Step 4: Run all checks**

```bash
npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared
npm run typecheck --workspace backend && npm test --workspace backend
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile
```
Expected: all exit 0.

Then check the visibility checks are gone:
```bash
rg -n "published === 1|published !== 1|show_reader_glyph|visibleUserId|publishedUserId" backend/src/modules/community/service.ts backend/src/modules/works
```
Expected: only own-state hits (`getOwnProfile`, `publishProfile`, `unpublishProfile`, `setShelfMural`).

- [ ] **Step 5: Check the mobile own-profile screen**

Read `mobile/src/features/community/ProfileScreen.tsx`. The owner now gets `private: false`, so confirm the screen never offers Follow on the viewer's own profile. Look for a check comparing `view.profile.user.userId` or `username` to the signed-in user.
- If there is one, note it in your report.
- If there is none, hide the follow button when `view.profile.user.userId === user?.id`, using the screen's existing auth hook (`useAuth` from `../../core/auth`). Add a case to the nearest existing mobile test if the screen has pure helpers. Otherwise state in the report that the device pass covers it.

Web needs no change: `frontend/src/pages/CommunityProfilePage.tsx` renders `OwnShelfView` for the viewer's own handle before it fetches.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/community packages/shared/src/community mobile/src/features/community
git commit -m "Let the owner see their own unpublished profile and library

The profile and library routes 404'd for the owner of an unpublished
profile while activity let them in. Profile content now follows one rule:
published, or the owner. The library route reads an optional viewer, so
the shared client sends the token when one is held."
```

### Task 4: Gate and ship

- [ ] **Step 1: Run the full CI sequence**

```bash
npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile && npm run test:scripts
```
Expected: exit 0.

- [ ] **Step 2: Run the `security-review` skill on the branch.** This branch changes who can see what. Fix anything it confirms before pushing.

- [ ] **Step 3: Dispatch `device-checker`** for one short pass, with this worktree, a screenshot directory, and these checks:
  1. Signed in as a reader whose profile is unpublished, open their own `/u/<username>`. The full profile shows, the Library tab loads, and there is no Follow button.
  2. Signed in as another reader, open that unpublished profile. It shows "This profile is private".
  3. Open a published reader's profile and library. Both load.

- [ ] **Step 4: Use the `ship` skill.** Push `claude/author-visibility`, open the PR against `main` titled "Author visibility in one community module", and turn auto-merge on. Do not deploy. The device pass gates the merge, not the PR, so if it is still running when CI goes green, hold auto-merge until it reports.
