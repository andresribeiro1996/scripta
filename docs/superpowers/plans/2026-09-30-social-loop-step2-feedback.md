# Social loop, step 2: your creations talk back: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell owners when other people take part in their games, count only
what the list actually shows, and put a personal badge where it will be seen.
Step 1's leftover error-handling gaps are fixed along the way.

**Architecture:**
- **Game modules.** Tier lists, the arena and quizzes each expose
  `participationByOwner(userId)`, derived at read time from their own
  ballots, votes and plays.
- **Community dashboard.** It merges those as grouped `participation` rows
  into the existing keyset stream, alongside followees' events and new
  followers.
  - Followee events are fetched already filtered to the types the followee
    broadcasts and the digest renders.
  - `personalNewCount` and `followingNewCount` come from the same
    row-building code, in separate capped passes.
- **Clients.**
  - Mobile renders participation rows, a personal badge on the Home tab and
    the Community button, and "new" dots.
  - Web does the same on Home, with the badge on the Home nav item, and marks
    seen when the Activity section scrolls into view.

**Tech Stack:**
- Backend: Fastify, `node:sqlite`, and `node:test` via tsx.
- Shared: `@scripta/shared`, with TypeScript `dist` consumed by all three.
- Mobile: Expo Router, React Native, TanStack Query v5.
- Web: React, React Router, TanStack Query v5, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-30-social-loop-design.md`, section
"Step 2", including "Carried over from step 1" and "Decided while planning
step 2".

**Branch:** `claude/social-loop-step2-feedback`, stacked on step 1's
`claude/app-social-interaction-gaps-9f9c3c` (PR #87). The worktree is
`/Users/andreribeiro/Documents/scripta/.claude/worktrees/app-social-interaction-gaps-9f9c3c`.

## Global Constraints

**Code**
- No comments in new code. Keep existing comments in code you move.
- Write the minimum code; reuse `@scripta/shared` for anything both clients
  need.
- Don't swallow errors. Where a fire-and-forget call can fail, handle the
  failure (reset a latch, or show a message) instead of `.catch(() => {})`.

**Copy**
- Row labels: "Ranked" (tier list), "Voted" (tournament), "Played" (quiz).
- Section title: "Activity".
- Badge text comes from `newCountLabel`: nothing at 0, "99+" above 99.
- Mobile Community messages: "Couldn't load activity.",
  "Couldn't refresh activity." and "Couldn't load more."

**Privacy**
- A participant is named to the owner only when they're signed in, have a
  published profile, and have their `votes` feed setting on. Everyone else
  counts in "N others".

**Counts**
- Each count is capped at 100 and computed separately.
- With a null seen marker, every row counts.

**Backend tests**
- New test files must be added to backend `npm test`'s explicit list. This
  plan adds tests only to files already in it.

**Checks**
- Shared: `npm run build --workspace @scripta/shared` and
  `npm test --workspace @scripta/shared`.
- Backend: `npm run typecheck --workspace backend` and
  `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`.
- Mobile: `npm run typecheck --workspace mobile` and
  `npm test --workspace mobile`.
- Web: `npm run typecheck --workspace frontend`,
  `npm run lint --workspace frontend` and `npm test --workspace frontend`.

**Expected breakage between tasks**
- From Task 2 until Task 3, backend typecheck fails on `newCount` and
  `DigestItem`.
- Until Task 4, mobile typecheck fails the same way.
- Until Task 6, web typecheck fails the same way.
- Each task runs its own package's checks. After Task 6 every package is
  green.

**Git**
- Run `/usr/bin/git` from the worktree root as a plain command.
- Commit after checks pass. Each commit has a why-body and ends with a
  `Co-Authored-By:` trailer.

**Baseline** (branch head `77432b42`): shared 251, backend 509, mobile 143,
web 76, all green.

## Review Focus

1. **A followee with many hidden reading events and an older visible
   publication.** The publication must appear on page 1. Pinned by a Task 3
   test.
2. **A participant who is private, or has `votes` off, or is a guest.** Never
   named, always counted. Pinned by a Task 3 test.
3. **Viewing Activity clears the badge.** The Home tab and Community button
   badges clear after the mark succeeds, without refetching away the "new"
   dots. `clearDashboardCounts` is pinned by a Task 2 test; the wiring is
   checked in the Task 7 device pass.
4. **A dashboard refetch or next-page failure** keeps loaded rows, and on
   mobile keeps the Discover and People tabs. This is checked in the task
   reviews of Tasks 5 and 6.
5. **Paging with participation rows mixed in** must neither repeat nor skip
   rows across the cursor. Pinned by a Task 3 test.

---

### Task 1: The game modules report participation on your games

**Files:**
- Modify: `packages/shared/src/community/types.ts`, adding `GameParticipation`
  and `ParticipationGameKind`
- Modify, tier lists:
  - `backend/src/modules/tierlists/domain/ports.ts`
  - `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts`
  - `backend/src/modules/tierlists/service.ts`
  - Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`
- Modify, arena:
  - `backend/src/modules/arena/domain/ports.ts`
  - `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts`
  - `backend/src/modules/arena/service.ts`
  - Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`
- Modify, quizzes:
  - `backend/src/modules/quizzes/domain/ports.ts`
  - `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.ts`
  - `backend/src/modules/quizzes/service.ts`
  - `backend/src/modules/quizzes/plugin.ts`
  - `backend/src/modules/quizzes/index.ts`
  - Test: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`

**Interfaces:**
- Produces, in `@scripta/shared/community`:

  ```ts
  export type ParticipationGameKind = "tierlist" | "tournament" | "quiz";
  export interface GameParticipation {
    id: string;
    name: string;
    covers: string[];
    participantCount: number;
    latestAt: string;
    recent: Array<{ userId: string; at: string }>;
  }
  ```

- Produces:
  - `TierlistsPublicApi.participationByOwner(ownerUserId: string): GameParticipation[]`
  - `ArenaPublicApi.participationByOwner(ownerUserId: string): GameParticipation[]`
  - `QuizzesPublicApi.participationByOwner(ownerUserId: string): GameParticipation[]`
    via the new `getQuizzesPublicApi()`, exported from
    `backend/src/modules/quizzes/index.ts`
  - Each list holds one entry per game that has at least one participant
    other than the owner, in no particular order. `recent` holds up to 10
    signed-in participants other than the owner, latest first.

- [ ] **Step 1: Add the shared type.** Append the two declarations above to
  `packages/shared/src/community/types.ts`, then run
  `npm run build --workspace @scripta/shared`.

- [ ] **Step 2: Write the failing repository tests.** Add a test to each of
  the three repository test files. Follow each file's existing fixture
  helpers (read the top of each file for how rows are inserted). Each test
  must assert:
  - **Tier lists:** `listParticipation(owner)`
    - counts the ballots on the owner's published tier lists (`vote_code`
      not null), excluding the owner's own ballot;
    - counts anonymous ballots (`voter_user_id` null);
    - sets `latest_at` to the latest ballot `created_at`;
    - excludes unpublished tier lists;
    - ignores a ballot edit: an `updated_at` change leaves `latest_at`
      alone.

    `listRecentVoters(tierlistId, owner, 10)` returns signed-in voters only,
    newest ballot first, without the owner.
  - **Arena:** `listParticipation(owner)`
    - counts distinct voters per tournament (`COALESCE(voter_user_id,
      voter_token)`), so one voter across two duels counts once;
    - uses each voter's first vote time, and `latest_at` is the latest of
      those first times;
    - excludes the owner's votes and tournaments still in `seeding`.

    `listRecentVoters(tournamentId, owner, 10)` returns signed-in voters with
    their first vote time, latest first, without the owner.
  - **Quizzes:** `listParticipation(owner)`
    - counts plays on the owner's quizzes, excluding the owner's own play;
    - counts anonymous plays;
    - sets `latest_at` to the latest play `created_at`.

    `listRecentPlayers(quizId, owner, 10)` returns signed-in players, latest
    first, without the owner.

  Run each test file with `DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test <file>`
  from `backend/`. Expected: the new tests fail, because the methods don't
  exist yet.

- [ ] **Step 3: Add the repository methods.** Add them to each port and each
  SQLite repository. Row type in all three:
  `{ id: string; name: string; participants: number; latest_at: string }`,
  plus `public_books: string | null` for tier lists. Recent rows are
  `{ user_id: string; at: string }`.

  Tier lists:

  ```sql
  SELECT t.id, t.name, t.public_books, COUNT(b.id) AS participants, MAX(b.created_at) AS latest_at
  FROM tierlists t
  JOIN tierlist_ballots b ON b.tierlist_id = t.id
  WHERE t.origin_user_id = ? AND t.vote_code IS NOT NULL
    AND (b.voter_user_id IS NULL OR b.voter_user_id != t.origin_user_id)
  GROUP BY t.id
  ```

  ```sql
  SELECT voter_user_id AS user_id, created_at AS at FROM tierlist_ballots
  WHERE tierlist_id = ? AND voter_user_id IS NOT NULL AND voter_user_id != ?
  ORDER BY created_at DESC LIMIT ?
  ```

  Arena:

  ```sql
  SELECT t.id, t.name, COUNT(*) AS participants, MAX(p.first_at) AS latest_at
  FROM (
    SELECT d.tournament_id, COALESCE(v.voter_user_id, v.voter_token) AS voter, MIN(v.created_at) AS first_at
    FROM votes v
    JOIN duels d ON d.id = v.duel_id
    JOIN tournaments o ON o.id = d.tournament_id
    WHERE o.owner_user_id = ? AND (v.voter_user_id IS NULL OR v.voter_user_id != o.owner_user_id)
    GROUP BY d.tournament_id, voter
  ) p
  JOIN tournaments t ON t.id = p.tournament_id
  WHERE t.status != 'seeding'
  GROUP BY t.id
  ```

  ```sql
  SELECT v.voter_user_id AS user_id, MIN(v.created_at) AS at
  FROM votes v JOIN duels d ON d.id = v.duel_id
  WHERE d.tournament_id = ? AND v.voter_user_id IS NOT NULL AND v.voter_user_id != ?
  GROUP BY v.voter_user_id ORDER BY at DESC LIMIT ?
  ```

  Quizzes:

  ```sql
  SELECT q.id, q.name, COUNT(p.id) AS participants, MAX(p.created_at) AS latest_at
  FROM quizzes q JOIN quiz_plays p ON p.quiz_id = q.id
  WHERE q.owner_user_id = ? AND (p.voter_user_id IS NULL OR p.voter_user_id != q.owner_user_id)
  GROUP BY q.id
  ```

  ```sql
  SELECT voter_user_id AS user_id, created_at AS at FROM quiz_plays
  WHERE quiz_id = ? AND voter_user_id IS NOT NULL AND voter_user_id != ?
  ORDER BY created_at DESC LIMIT ?
  ```

  Prepare the statements once, as the repositories already do. Cast
  `participants` with `Number(...)`, as the existing count methods do.

- [ ] **Step 4: Map the rows in each service and expose them.** Each service
  gets `participationByOwner(ownerUserId): GameParticipation[]`, returning
  one entry per row:
  - `id` and `name` from the row;
  - `participantCount: row.participants`;
  - `latestAt: row.latest_at`;
  - `recent` from the recent query with limit 10, mapped to
    `{ userId: r.user_id, at: r.at }`.

  Covers:
  - tier lists: `publishedCovers(row.public_books)`, the existing helper in
    `tierlists/service.ts`;
  - arena: `previewFromSlots(repo.getSlots(row.id)).covers`;
  - quizzes: `[]`.

  Add `participationByOwner` to `TierlistsPublicApi` and `ArenaPublicApi` and
  to their factories.

  For quizzes, add to `service.ts`:

  ```ts
  export interface QuizzesPublicApi {
    participationByOwner(ownerUserId: string): GameParticipation[];
  }

  export function createQuizzesPublicApi(service: QuizzesService): QuizzesPublicApi {
    return { participationByOwner: (ownerUserId) => service.participationByOwner(ownerUserId) };
  }
  ```

  Add to `plugin.ts`, mirroring `getTierlistsPublicApi`:

  ```ts
  let cachedApi: QuizzesPublicApi | null = null;

  export function getQuizzesPublicApi(): QuizzesPublicApi {
    if (!cachedApi) cachedApi = createQuizzesPublicApi(createQuizzesService(createSqliteQuizzesRepository(openQuizzesDb())));
    return cachedApi;
  }
  ```

  Export `getQuizzesPublicApi` and the `QuizzesPublicApi` type from
  `quizzes/index.ts`.

- [ ] **Step 5: Run the checks.** Run the three focused test files (they
  should pass), then shared build and test, backend typecheck and the full
  backend tests. Expected: all green. Backend tests go up by the three new
  tests, to 512.

- [ ] **Step 6: Commit.** Commit with the message "Let tier lists, tournaments
  and quizzes report who took part in an owner's games". The body should say
  why: the dashboard derives feedback from the games' own tables, which
  already deduplicate edits and count anonymous participation.

---

### Task 2: Shared digest: participation rows, counts, labels

**Files:**
- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/src/dashboard.test.ts`

**Interfaces:**
- Consumes: `ParticipationGameKind` and `CommunityAuthor` from
  `./community/types.js`.
- Produces:

  ```ts
  export interface ParticipationGame { kind: ParticipationGameKind; id: string; name: string; covers: string[] }
  export type ParticipationItem = { kind: "participation"; id: string; game: ParticipationGame; actors: CommunityAuthor[]; count: number; createdAt: string };
  export type DigestItem = /* the four existing members */ | ParticipationItem;
  export interface DashboardFeedPage { items: DigestItem[]; nextCursor: string | null; seenAt: string | null; personalNewCount: number; followingNewCount: number }
  export function participationLead(item: ParticipationItem): string;
  export function isNewDigestItem(item: DigestItem, seenAt: string | null): boolean;
  export function newCountLabel(count: number): string | null;
  export function clearDashboardCounts<T extends { pages: DashboardFeedPage[] }>(data: T): T;
  ```

  `digestAction`, `digestHeading` and `digestTarget` cover `participation`.
  `newCount` is removed from `DashboardFeedPage`.

- [ ] **Step 1: Write the failing tests.** Add to `dashboard.test.ts`, using a
  participation item builder:

  ```ts
  const participation = (overrides: Partial<ParticipationItem> = {}): ParticipationItem => ({
    kind: "participation",
    id: "tierlist:t1",
    game: { kind: "tierlist", id: "t1", name: "Sci-fi", covers: [] },
    actors: [],
    count: 1,
    createdAt: "2026-09-30T10:00:00.000Z",
    ...overrides
  });
  const named = (username: string) => ({ userId: username, username, avatarUrl: null });

  test("participationLead names up to three readers and counts the rest", () => {
    assert.equal(participationLead(participation({ count: 5 })), "5 people");
    assert.equal(participationLead(participation({ count: 1 })), "1 person");
    assert.equal(participationLead(participation({ actors: [named("ana")], count: 1 })), "ana");
    assert.equal(participationLead(participation({ actors: [named("ana"), named("rui")], count: 2 })), "ana and rui");
    assert.equal(participationLead(participation({ actors: [named("ana"), named("rui"), named("bo")], count: 3 })), "ana, rui and bo");
    assert.equal(participationLead(participation({ actors: [named("ana"), named("rui")], count: 3 })), "ana, rui and 1 other");
    assert.equal(participationLead(participation({ actors: [named("ana"), named("rui")], count: 12 })), "ana, rui and 10 others");
  });

  test("participation rows say what happened to which game, and link to the owner's view", () => {
    const tier = participation({ actors: [named("ana")], count: 4 });
    assert.equal(digestAction(tier), "ranked your tier list Sci-fi");
    assert.equal(digestHeading(tier), "ana and 3 others ranked your tier list Sci-fi");
    assert.equal(digestTarget(tier), "/dashboard/arena/tierlist/t1");
    const cup = participation({ id: "tournament:g1", game: { kind: "tournament", id: "g1", name: "Cup", covers: [] }, count: 2 });
    assert.equal(digestHeading(cup), "2 people voted in your tournament Cup");
    assert.equal(digestTarget(cup), "/arena/g1");
    const quiz = participation({ id: "quiz:q1", game: { kind: "quiz", id: "q1", name: "Covers", covers: [] }, actors: [named("bo")], count: 1 });
    assert.equal(digestHeading(quiz), "bo played your quiz Covers");
    assert.equal(digestTarget(quiz), "/dashboard/arena/quiz/q1");
  });

  test("newCountLabel hides zero and caps at 99+", () => {
    assert.equal(newCountLabel(0), null);
    assert.equal(newCountLabel(7), "7");
    assert.equal(newCountLabel(99), "99");
    assert.equal(newCountLabel(100), "99+");
  });

  test("a row is new when it came after the seen marker, or when there is none", () => {
    const item = participation({ createdAt: "2026-09-30T10:00:00.000Z" });
    assert.equal(isNewDigestItem(item, null), true);
    assert.equal(isNewDigestItem(item, "2026-09-30T09:00:00.000Z"), true);
    assert.equal(isNewDigestItem(item, "2026-09-30T10:00:00.000Z"), false);
  });

  test("clearing the counts keeps the rows and the seen marker", () => {
    const page = { items: [participation()], nextCursor: null, seenAt: "2026-09-30T09:00:00.000Z", personalNewCount: 3, followingNewCount: 2 };
    const cleared = clearDashboardCounts({ pages: [page, { ...page, personalNewCount: 0, followingNewCount: 0 }], pageParams: [undefined, "c"] });
    assert.equal(cleared.pages[0]!.personalNewCount, 0);
    assert.equal(cleared.pages[0]!.followingNewCount, 0);
    assert.equal(cleared.pages[0]!.seenAt, page.seenAt);
    assert.equal(cleared.pages[0]!.items.length, 1);
    assert.deepEqual(cleared.pageParams, [undefined, "c"]);
  });
  ```

  Run `npm test --workspace @scripta/shared`. Expected: fail, because the
  helpers aren't exported.

- [ ] **Step 2: Implement.** In `dashboard.ts`:
  - Import `ParticipationGameKind` alongside the existing community type
    imports.
  - Add `ParticipationGame` and `ParticipationItem`, and extend `DigestItem`.
  - Replace `DashboardFeedPage` with the shape above.
  - Add:

  ```ts
  const PARTICIPATION_VERBS: Record<ParticipationGameKind, string> = {
    tierlist: "ranked your tier list",
    tournament: "voted in your tournament",
    quiz: "played your quiz"
  };

  export function participationLead(item: ParticipationItem): string {
    const names = item.actors.map((actor) => actor.username);
    const others = item.count - names.length;
    if (names.length === 0) return `${item.count} ${item.count === 1 ? "person" : "people"}`;
    if (others <= 0) return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `${names.join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
  }

  export function isNewDigestItem(item: DigestItem, seenAt: string | null): boolean {
    return seenAt === null || item.createdAt > seenAt;
  }

  export function newCountLabel(count: number): string | null {
    if (count <= 0) return null;
    return count > 99 ? "99+" : String(count);
  }

  export function clearDashboardCounts<T extends { pages: DashboardFeedPage[] }>(data: T): T {
    return { ...data, pages: data.pages.map((page) => ({ ...page, personalNewCount: 0, followingNewCount: 0 })) };
  }
  ```

  - `digestAction`: add
    `case "participation": return `${PARTICIPATION_VERBS[item.game.kind]} ${item.game.name}`;`.
  - `digestHeading`: return
    `${participationLead(item)} ${digestAction(item)}` for `participation`,
    and the existing `${item.actor.username} ${digestAction(item)}`
    otherwise.
  - `digestTarget`: add a `participation` case. It returns
    `/dashboard/arena/tierlist/<id>` for tier lists,
    `/dashboard/arena/quiz/<id>` for quizzes, and `/arena/<id>` for
    tournaments.

  The existing test "digestHeading is the actor's username followed by
  digestAction, for every kind" stays as it is, since its items have no
  participation row.

- [ ] **Step 3: Run the checks.** Run `npm run build --workspace @scripta/shared`
  and `npm test --workspace @scripta/shared`. Expected: all pass, with 256
  tests. Backend, mobile and web typecheck are expected to fail until Tasks
  3, 4 and 6.

- [ ] **Step 4: Commit.** Commit with the message "Describe participation in
  your games, and the personal and following counts, in the shared digest".

---

### Task 3: The dashboard serves participation rows and counts only what it shows

**Files:**
- Modify: `backend/src/modules/community/domain/ports.ts`
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/community/service.test.ts`
- Test: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`
- Test: `backend/src/modules/community/routes.test.ts`, updating its
  `getDashboard` fakes to the new shape

**Interfaces:**
- Consumes:
  - `GameParticipation` and `ParticipationGameKind` from Task 1;
  - `ParticipationItem` and the `DashboardFeedPage` shape from Task 2;
  - the three `participationByOwner` functions from Task 1.
- Produces:
  - `CommunityDeps.participation: { tierlists(userId): GameParticipation[]; tournaments(userId): GameParticipation[]; quizzes(userId): GameParticipation[] }`
  - Repository changes:
    - `listEventsByUser(userId, keyset, limit, types?: readonly ActivityEventType[])`.
      When `types` is given, only those types are returned. An empty array
      returns `[]`.
    - New:
      `listEventsByUserSince(userId, since, limit, types: readonly ActivityEventType[]): EventRow[]`
      and `listFollowersSince(followeeId, since, limit): FollowRow[]`.
      Both return rows with `created_at > since`, newest first.
    - Removed: `countEventsByUsersSince` and `countFollowersSince`.
  - `getDashboard` returns
    `{ items, nextCursor, seenAt, personalNewCount, followingNewCount }`.
    For a cursor page, `seenAt` is null and both counts are 0.

- [ ] **Step 1: Write the failing repository test.** Add to
  `sqliteCommunityRepository.test.ts`: insert events of several types for one
  user. Then assert:
  - `listEventsByUser(user, undefined, 10, ["tierlist_published"])` returns
    only that type;
  - a `types` filter combined with a keyset works;
  - `listEventsByUser(user, undefined, 10, [])` returns `[]`;
  - `listEventsByUserSince(user, "<t>", 10, [...])` returns only rows after
    `<t>`, newest first;
  - `listFollowersSince` does the same for follows.

- [ ] **Step 2: Write the failing service tests.** Add to `service.test.ts`:
  - Extend `createDeps` with
    `participation: { tierlists: () => tierlistParticipation, tournaments: () => tournamentParticipation, quizzes: () => quizParticipation }`,
    backed by three arrays it returns.
  - Update `createRepoFake`:
    - implement the `types` filter and the two `...Since` methods;
    - delete `countEventsByUsersSince` and `countFollowersSince`.

  Tests:
  1. **"your games' participation shows as one row per game"**
     - Seed one tier list participation for `viewer`:
       `{ id: "t1", name: "Sci-fi", covers: ["a","b","c","d"], participantCount: 4, latestAt: T2, recent: [{ userId: "ana", at: T2 }, { userId: "ghost", at: T1 }] }`.
     - `ana` has a published profile with default settings. `ghost` has no
       reader profile.
     - Expect one item: `kind "participation"`, `id "tierlist:t1"`,
       `game.covers.length 3`, `count 4`, `createdAt T2`, and `actors`
       usernames `["user-ana"]`.
  2. **"participants who are private or hide their votes are counted, never
     named"**
     - `bo` has an unpublished profile, and `cy` is published with
       `votes: false`.
     - `recent` holds bo and cy, and `participantCount` is 2.
     - Expect `actors` `[]` and `count` 2.
  3. **"no more than three participants are named"**
     - `recent` holds four published readers.
     - Expect three actors, latest first.
  4. **"hidden events can't push a visible one off the first page"**
     - `viewer` follows `alice`, who is published with default settings, so
       reading is off.
     - Emit one `tierlist_published` for alice at T1 (with its tier list ref
       present), then 30 `book_added` events after it.
     - `getDashboard(viewer, undefined, 20).items` contains the publication.
  5. **"counts come from the rows the list shows"**
     - Set `seenAt` to T0.
     - Alice has one visible publication after T0 and five hidden
       `book_added` after T0.
     - There's one new follower after T0, and one participation with
       `latestAt` after T0.
     - Expect `followingNewCount` 1, `personalNewCount` 2, and `seenAt` T0.
  6. **"with no seen marker every row counts"**
     - `seenAt` is null, with one participation and one follower.
     - Expect `personalNewCount` 2.
  7. **"participation rows page with the cursor, without repeats or gaps"**
     - Seed 3 participation games with distinct `latestAt` values and 3
       follower rows interleaved.
     - Page with `limit 2` until `nextCursor` is null.
     - The collected ids equal the full ordered list, with no duplicates.
  8. **"a cursor page carries no counts"**
     - `getDashboard(viewer, cursor, 2)` has `seenAt` null and both counts 0.

  Update every existing test that read `newCount` to the new fields. The
  semantics change: hidden events no longer count.

  Run the file. Expected: the new tests fail.

- [ ] **Step 3: Implement the repository.** In the SQLite repository:
  - Keep the two existing prepared statements for calls without `types`.
    That's the profile activity path.
  - For typed calls, build the statement with one `?` per type. Example for
    the keyset-less case:

    ```ts
    db.prepare(`SELECT * FROM events WHERE user_id = ? AND type IN (${types.map(() => "?").join(",")}) ORDER BY created_at DESC, id DESC LIMIT ?`).all(userId, ...types, limit)
    ```

    Add `AND (created_at < ? OR (created_at = ? AND id < ?))` when there's
    a keyset, or `AND created_at > ?` for `listEventsByUserSince`.
  - `listFollowersSince`:
    `SELECT * FROM follows WHERE followee_id = ? AND created_at > ? ORDER BY created_at DESC, follower_id DESC LIMIT ?`.
  - Delete the two count methods from the port and the implementation.

- [ ] **Step 4: Implement the service.** In `service.ts`:
  - Add `participation` to `CommunityDeps`.
  - Import `GameParticipation` and `ParticipationGameKind` from
    `@scripta/shared/community`, and `ParticipationItem` from
    `@scripta/shared/dashboard`.
  - Add module-level constants:

    ```ts
    const DASHBOARD_COUNT_CAP = 100;
    const NAMED_PARTICIPANTS = 3;
    const DIGEST_TYPES: Record<FeedCategory, ActivityEventType[]> = {
      publications: ["tierlist_published", "tournament_published"],
      votes: ["voted_on"],
      reading: ["book_added", "book_finished"],
      follows: []
    };
    ```

  - Inside `createCommunityService`, add these helpers and use them to
    rewrite `getDashboard`:

    ```ts
    type DigestRow = { id: string; createdAt: string; event?: EventRow; follow?: FollowRow; participation?: ParticipationItem };
    type Bound = { keyset?: CursorKeyset; since?: string };

    const digestTypesFor = (userId: string): ActivityEventType[] => {
      const settings = settingsFor(userId);
      return (Object.keys(DIGEST_TYPES) as FeedCategory[]).flatMap((category) => (settings[category] ? DIGEST_TYPES[category] : []));
    };
    const withinBound = (bound: Bound, createdAt: string, id: string): boolean =>
      bound.since !== undefined ? createdAt > bound.since : !bound.keyset || createdAt < bound.keyset.createdAt || (createdAt === bound.keyset.createdAt && id < bound.keyset.id);
    const newestFirst = (a: DigestRow, b: DigestRow): number => (a.createdAt !== b.createdAt ? b.createdAt.localeCompare(a.createdAt) : a.id < b.id ? 1 : -1);

    const participationItems = (viewerId: string): ParticipationItem[] => {
      const glyphOf = glyphLookup();
      const games: Array<[ParticipationGameKind, GameParticipation[]]> = [
        ["tierlist", deps.participation.tierlists(viewerId)],
        ["tournament", deps.participation.tournaments(viewerId)],
        ["quiz", deps.participation.quizzes(viewerId)]
      ];
      return games.flatMap(([kind, list]) =>
        list.map((game) => {
          const nameable = game.recent.map((entry) => entry.userId).filter((userId) => repo.getProfileRow(userId)?.published === 1 && settingsFor(userId).votes);
          const profiles = deps.resolveProfiles(nameable);
          const actors = nameable.flatMap((userId) => {
            const profile = profiles.get(userId);
            return profile ? [withGlyph(profile, userId, glyphOf)] : [];
          }).slice(0, NAMED_PARTICIPANTS);
          return { kind: "participation" as const, id: `${kind}:${game.id}`, game: { kind, id: game.id, name: game.name, covers: game.covers.slice(0, FEED_COVER_LIMIT) }, actors, count: game.participantCount, createdAt: game.latestAt };
        })
      );
    };

    const followingRows = (followees: string[], bound: Bound, limit: number): DigestRow[] =>
      followees.flatMap((followeeId) => {
        const types = digestTypesFor(followeeId);
        if (types.length === 0) return [];
        const events = bound.since !== undefined ? repo.listEventsByUserSince(followeeId, bound.since, limit, types) : repo.listEventsByUser(followeeId, bound.keyset, limit, types);
        return events.map((event) => ({ id: event.id, createdAt: event.created_at, event }));
      });

    const personalRows = (viewerId: string, participation: ParticipationItem[], bound: Bound, limit: number): DigestRow[] => [
      ...(bound.since !== undefined ? repo.listFollowersSince(viewerId, bound.since, limit) : repo.listFollowersByFollowee(viewerId, bound.keyset, limit)).map((follow) => ({ id: follow.follower_id, createdAt: follow.created_at, follow })),
      ...participation.filter((item) => withinBound(bound, item.createdAt, item.id)).map((item) => ({ id: item.id, createdAt: item.createdAt, participation: item }))
    ];
    ```

  - Extract today's per-row body of the `getDashboard` loop (the
    publication, vote, reading and follow branches) into
    `toDigestItem(row, profiles, glyphOf, followees): DigestItem | undefined`,
    unchanged except for two things:
    - Drop the `broadcasts(...)` check and its settings cache, because
      `followingRows` now fetches only broadcast types.
    - Return the item instead of pushing it.
  - Add:

    ```ts
    const buildItems = (rows: DigestRow[], followees: string[], limit: number): { items: DigestItem[]; last?: DigestRow; more: boolean } => {
      rows.sort(newestFirst);
      const actorIds = new Set<string>();
      for (const row of rows) {
        if (row.event) actorIds.add(row.event.user_id);
        if (row.follow) actorIds.add(row.follow.follower_id);
      }
      const profiles = deps.resolveProfiles([...actorIds]);
      const glyphOf = glyphLookup();
      const items: DigestItem[] = [];
      let last: DigestRow | undefined;
      for (const row of rows) {
        if (items.length === limit) return { items, last, more: true };
        const item = row.participation ?? toDigestItem(row, profiles, glyphOf, followees);
        if (item) {
          items.push(item);
          last = row;
        }
      }
      return { items, last, more: false };
    };
    ```

  - `getDashboard` becomes:

    ```ts
    getDashboard(viewerId, cursor, limit) {
      const keyset = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !keyset) throw new InvalidCursorError();
      const followees = repo.listFollowees(viewerId);
      const participation = participationItems(viewerId);
      const page = buildItems([...followingRows(followees, { keyset }, limit + 1), ...personalRows(viewerId, participation, { keyset }, limit + 1)], followees, limit);
      const nextCursor = page.more && page.last ? encodeCursor({ createdAt: page.last.createdAt, id: page.last.id }) : null;
      if (keyset) return { items: page.items, nextCursor, seenAt: null, personalNewCount: 0, followingNewCount: 0 };
      const seenAt = deps.getDashboardSeenAt(viewerId);
      const bound: Bound = seenAt ? { since: seenAt } : {};
      const personalNewCount = buildItems(personalRows(viewerId, participation, bound, DASHBOARD_COUNT_CAP), followees, DASHBOARD_COUNT_CAP).items.length;
      const followingNewCount = buildItems(followingRows(followees, bound, DASHBOARD_COUNT_CAP), followees, DASHBOARD_COUNT_CAP).items.length;
      return { items: page.items, nextCursor, seenAt, personalNewCount, followingNewCount };
    },
    ```

  - Remove imports that are now unused. `categoryFor` is still used by
    `getActivity`, so keep it if it's used there.

- [ ] **Step 5: Wire it.** In `app.ts`, add `getQuizzesPublicApi` to the
  quizzes import, and pass this in the `registerCommunityModule` options:

  ```ts
  participation: {
    tierlists: getTierlistsPublicApi().participationByOwner,
    tournaments: getArenaPublicApi().participationByOwner,
    quizzes: getQuizzesPublicApi().participationByOwner
  },
  ```

  In `routes.test.ts`, change both `getDashboard` fakes to return
  `{ items: [], nextCursor: null, seenAt: null, personalNewCount: 0, followingNewCount: 0 }`.

- [ ] **Step 6: Run the checks.** Run the focused files, then backend
  typecheck and the full backend tests. Expected: all green.

- [ ] **Step 7: Commit.** Commit with the message "Serve participation rows on
  the dashboard, and count only the rows it shows". The body should cover:
  - per-followee type filtering, and why hidden events could starve a page;
  - counts built from the rows, in capped, separate passes;
  - a null seen marker counts everything.

---

### Task 4: Mobile renders participation rows (and compiles against the new digest)

**Files:**
- Modify: `mobile/src/features/home/feedRowModel.ts`
- Test: `mobile/src/features/home/feedRowModel.test.ts`
- Modify: `mobile/src/features/home/FeedRow.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx` (the follow-back guard
  and `newCount` → `personalNewCount` only)
- Modify: `mobile/src/features/home/CommunityScreen.tsx` (the same, only)

**Interfaces:**
- Consumes: `ParticipationItem`, `participationLead` and `digestHeading` from
  `@scripta/shared`.
- Produces:
  - `feedRowModel` handles `participation`.
  - `digestRoute` routes participation rows as follows:
    - tier list: `/tierlist/<id>`
    - quiz: `/quiz/<id>`
    - tournament: `/arena/<id>`
  - `FeedRow` renders participation rows. Its props are unchanged in this
    task.

- [ ] **Step 1: Write the failing test.** Add to `feedRowModel.test.ts`:

  ```ts
  test("participation in your game leads with the game and names who took part", () => {
    const row = feedRowModel({
      kind: "participation",
      id: "tierlist:t1",
      game: { kind: "tierlist", id: "t1", name: "Sci-fi", covers: ["a.png"] },
      actors: [{ userId: "u1", username: "ana", avatarUrl: null }],
      count: 4,
      createdAt: "2026-09-30T00:00:00.000Z"
    });
    assert.equal(row.label, "Ranked");
    assert.equal(row.icon, "tierlist");
    assert.equal(row.title, "Sci-fi");
    assert.equal(row.detail, "ana and 3 others");
    assert.deepEqual(row.covers, ["a.png"]);
    assert.equal(row.action, null);
  });
  ```

  Also assert that `feedRowAccessibilityLabel` for that item equals
  `digestHeading(item)`.

- [ ] **Step 2: Implement `feedRowModel`.** Add:

  ```ts
  case "participation":
    return {
      covers: item.game.covers,
      icon: item.game.kind === "tierlist" ? "tierlist" : item.game.kind === "tournament" ? "bracket" : "champion",
      label: item.game.kind === "tierlist" ? "Ranked" : item.game.kind === "tournament" ? "Voted" : "Played",
      tone: "accent",
      title: item.game.name,
      detail: participationLead(item),
      action: null
    };
  ```

  `feedRowAccessibilityLabel` returns `digestHeading(item)` for
  `participation`, since there's no single actor glyph.

- [ ] **Step 3: Update `FeedRow`.** For participation rows:
  - `digestRoute` returns the three routes above.
  - **Leading slot:**
    - with covers: the `CoverFan`, overlaid with the first actor's avatar
      when there is one;
    - without covers: the first actor's `AuthorAvatar` at `AVATAR_SIZE`;
    - with neither: `<Icon name="community" size={AVATAR_SIZE / 2} color={colors.textDim} />`
      centred in the slot.
  - **Name row:** only `row.detail`, the lead text. No username and no
    `ReaderGlyph`.

  Other kinds are unchanged. Every `item.actor` access must be narrowed away
  from `participation`.

- [ ] **Step 4: Fix the two screens so they compile.** In `HomeScreen.tsx` and
  `CommunityScreen.tsx`:
  - Replace `newCount` with `const newCount = dashboard.data?.pages[0]?.personalNewCount ?? 0;`.
  - Guard follow-back:
    - `onFollowBack={() => { if (item.kind === "follow") void followBack(item.actor.userId); }}`
    - `following={item.kind === "follow" && followingId === item.actor.userId}`

- [ ] **Step 5: Run the checks.** Run mobile typecheck and tests. Expected:
  green, with 144 tests.

- [ ] **Step 6: Commit.** Commit with the message "Show who took part in your
  games in the mobile activity feed".

---

### Task 5: Mobile badges, "new" dots, the seen marker, and Community that survives failures

**Files:**
- Modify: `mobile/src/ui/components.tsx` (an optional badge on `IconButton`,
  and `SwipeableTabs` accepting `badge?: number | string`)
- Modify: `mobile/src/features/home/communityTabs.ts`, and its test
- Modify: `mobile/src/app/(app)/_layout.tsx` (the Home tab badge)
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/features/home/CommunityScreen.tsx`
- Modify: `mobile/src/features/home/FeedRow.tsx` (an `isNew` prop)

**Interfaces:**
- Consumes: `newCountLabel`, `isNewDigestItem` and `clearDashboardCounts`
  from `@scripta/shared`, and `useDashboardFeed` from `./FeedRow`.
- Produces:
  - `IconButton` takes an optional `badge?: string | null`.
  - `FeedRow` takes an optional `isNew?: boolean`.
  - `communityTabOptions(newCount)` sets the Activity badge to
    `newCountLabel(newCount)` as a string. The accessibility label becomes
    `Activity, <label> new`.

- [ ] **Step 1: Update the tab test.** In `communityTabs.test.ts`, the badge
  assertion becomes:
  - `communityTabOptions(3)`'s Activity badge is `"3"`;
  - `communityTabOptions(150)`'s is `"99+"`;
  - `communityTabOptions(0)`'s is `undefined`.

  Run it and see it fail. Then change `communityTabOptions` to use
  `newCountLabel` (undefined when null), and widen `SwipeableTabs`' option
  type to `badge?: number | string`.

- [ ] **Step 2: Add a badge to `IconButton`.**
  - Add the prop `badge?: string | null`.
  - When set, render a pill positioned absolutely at the button's top-right
    corner (`top: -6, right: -6`). Use the existing `styles.tabBadge` /
    `styles.tabBadgeText` with `colors.accent` / `colors.onAccent`.
  - Append the count to the accessibility label as `${accessibilityLabel}, ${badge} new`.

- [ ] **Step 3: Badge the Home tab.** In `(app)/_layout.tsx`, move the
  `<>…<Tabs>…</>` return into a new component `AppTabs` in the same file,
  rendered after the auth gates. Hooks can't run after the early returns.
  - `AppTabs` calls `useDashboardFeed()`, reads
    `data?.pages[0]?.personalNewCount ?? 0`, and sets these on the `(home)`
    screen:
    - `tabBarBadge: newCountLabel(count) ?? undefined`
    - `tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent }`
  - Keep `GenreEnrichment` and `AppearanceSync` exactly where they render
    today.

- [ ] **Step 4: Update Home.** In `HomeScreen.tsx`:
  - The header Community `IconButton` gets
    `badge={newCountLabel(personalNewCount)}`.
  - The last section's title is "Activity" in all three places, and its
    count shows `· ${label} new` when the label isn't null.
  - `FeedRow` gets `isNew={isNewDigestItem(item, seenAt)}`, where `seenAt`
    is `dashboard.data?.pages[0]?.seenAt ?? null`.

- [ ] **Step 5: `FeedRow`'s new dot.** When `isNew` is set:
  - render an 8×8 `colors.accent` circle just before the timestamp in the
    label row;
  - append `, new` to the row's accessibility label.

- [ ] **Step 6: Community.** In `CommunityScreen.tsx`:
  - **Tab options:** `communityTabOptions(personalNewCount)`.
  - **Rows:** `FeedRow` gets `isNew` as on Home.
  - **When the seen mark succeeds,** clear the cached counts so the badges
    drop without refetching away the dots. Get the client with
    `useQueryClient()` from `@tanstack/react-query`, then:

    ```ts
    queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(["community", "dashboard"], (data) => (data ? clearDashboardCounts(data) : data))
    ```

  - **When the seen mark fails,** set `markedRef.current = false` so it
    retries, instead of `.catch(() => {})`.
  - **Keep loaded rows and the other tabs** when the dashboard fails, on the
    pattern `DiscoverPane` uses:
    - The whole-screen spinner stays only while `dashboard.isPending`.
      Otherwise always render `SwipeableTabs`.
    - The Activity page shows the "Couldn't load activity." `ErrorState`
      with Retry only when `dashboard.isError && !dashboard.data`. Discover
      and People are always available.
    - `onEndReached` also requires `!dashboard.isFetchNextPageError`.
    - The footer shows the skeleton while `isFetchingNextPage`; otherwise,
      on `isFetchNextPageError`, "Couldn't load more." with Retry calling
      `fetchNextPage`.
    - A `<Toast visible message="Couldn't refresh activity." tone="error" />`
      shows while `dashboard.isRefetchError && !dashboard.isRefetching`.

- [ ] **Step 7: Run the checks.** Run mobile typecheck and tests. Expected:
  green, with 144 tests. Tab assertions change inside the existing test.

- [ ] **Step 8: Commit.** Commit with the message "Badge Home and the
  Community button with what's new for you, and keep Community usable when
  loading fails".

---

### Task 6: Web: participation rows, the Home badge, seen on scroll, and failures that keep Home

**Files:**
- Modify: `frontend/src/hooks/useDashboard.ts`
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/layouts/DashboardLayout.tsx`

**Interfaces:**
- Consumes: `digestHeading`, `digestTarget`, `isNewDigestItem`,
  `newCountLabel`, `clearDashboardCounts` and `ParticipationItem` from
  `@scripta/shared`, and `markDashboardSeen` from `../api/community`.
- Produces: `useDashboard()` returns:
  - `items`, `seenAt`, `personalNewCount` and `followingNewCount`;
  - `isLoading` and `error`;
  - `isFetchNextPageError`, `isRefetchError` and `isRefetching`;
  - `hasNextPage`, `isFetchingNextPage`, `fetchNextPage` and `refetch`.

  It no longer marks seen by itself.

- [ ] **Step 1: The hook.** Remove the mark-on-load effect and its ref from
  `useDashboard`. Return the fields above, reading the counts and `seenAt`
  from `query.data?.pages[0]` with defaults of 0 and null.

- [ ] **Step 2: Mark seen when Activity is on screen.** In `HomePage.tsx`:
  - Put a ref on the Activity `<section>`.
  - In an effect, create an `IntersectionObserver` with threshold `0.25`.
    - When the section intersects, the dashboard has loaded (not loading)
      and has no error, and a `markedRef` isn't set: set the ref, then call
      `markDashboardSeen()`.
    - On success, update the cache with
      `queryClient.setQueryData(["community", "dashboard"], (data) => data && clearDashboardCounts(data))`.
    - On failure, reset `markedRef` so it retries.
  - Disconnect on cleanup.

- [ ] **Step 3: The Activity section.**
  - **Title and count:** the title is "Activity" (was "Following"). The
    count line shows `${newCountLabel(personalNewCount)} new for you` when
    the label isn't null.
  - **Participation rows:**
    - `<Link to={digestTarget(item)}>`, the first actor's `AuthorAvatar`
      when there is one, then `digestHeading(item)` as the text.
    - Other kinds render as today.
    - Every row whose `isNewDigestItem(item, seenAt)` is true gets
      `<span className="rounded-full bg-(--color-accent-soft) px-2 text-xs font-semibold text-(--color-accent)">New</span>`.
  - **Failures keep Home:**
    - The page-level "Couldn't load your home." now depends only on
      `library.isError`, so reading cards show even when the dashboard fails.
    - Inside Activity:
      - When `dashboard.error && items.length === 0`, show
        `<div role="alert"><p>Couldn't load activity.</p><button …>Retry</button></div>`.
      - When `isRefetchError && !isRefetching`, show a `role="alert"` line
        "Couldn't refresh activity." above the rows.
      - When `isFetchNextPageError && !isFetchingNextPage`, show a
        `role="alert"` line "Couldn't load more." above Load more.

    Use the classes `DiscoverPage.tsx` already uses for those lines.

- [ ] **Step 4: Badge Home in the nav.** In `DashboardLayout.tsx`:
  - Call `useDashboard()` and compute
    `const homeBadge = newCountLabel(personalNewCount)`.
  - Where the nav renders an item with `item.to === "/dashboard"` and
    `homeBadge` is set, add
    `<span className="ml-auto rounded-full bg-(--color-accent) px-1.5 text-[10px] font-bold text-(--color-on-accent)">{homeBadge}</span>`
    and an `aria-label` of `Home, ${homeBadge} new` on the link.
    - That's the sidebar, the drawer, and the bottom bar.
    - In the bottom bar, position it on the icon's top-right, since that
      bar stacks icon and label.

- [ ] **Step 5: Run the checks.** Run web typecheck, lint and tests.
  Expected: green, with 76 tests. Then run every package's checks once, as
  listed in Global Constraints. Expected: all green.

- [ ] **Step 6: Commit.** Commit with the message "Show who took part in your
  games on web Home, badge Home, and mark Activity seen when it's on screen".

---

### Task 7: Device pass (mobile), short

Only if `node scripts/dev-status.mjs --json` shows the emulator free and the
1-minute load average under about 40. Otherwise skip it and report why. The
rules are the same as step 1's device passes:
- check the lease first;
- change state only through the UI, never write to `backend/data/*` or
  sqlite, and undo any change through the UI;
- zoom into labels;
- time-box to about 10 minutes;
- run `npm run dev:release` at the end.

Check:
1. **Community opens with rows.** Home → the Community button opens
   Community on Activity. Swipe to Discover and People and back. Nothing
   crashes.
2. **The badge clears.** If the badge on Home's Community button or on the
   Home tab shows a number, view the Activity tab. Both badges clear, and
   the rows' "new" dots stay until you leave and come back.
3. **The seeded account's participation rows**, if the fixture has
   participation on its games, read "Ranked" / "Voted" / "Played" with
   names. Tapping one opens the owner's view of that game.

---

## After the tasks

1. Run a whole-branch review and every check.
2. Push `claude/social-loop-step2-feedback`, and open a PR stacked on #87,
   with its base set to `claude/app-social-interaction-gaps-9f9c3c`.
3. Bind it and report.
