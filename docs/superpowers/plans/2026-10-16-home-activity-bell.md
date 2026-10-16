# Home Activity Bell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move follows, plays of your games and finished tournaments off mobile Home into a bell-opened Activity screen, and fix the Home feed's duplicate rows, height, alignment, action styles, zero counts and plurals.

**Architecture:**
- The backend digest already filters by `kinds`.
  - Mobile Home asks for circle kinds.
  - A new Activity screen asks for personal kinds.
  - The bell and the Home tab badge read `personalNewCount` from the Activity query.
- The one `users.dashboard_seen_at` timestamp stays. On mobile only the Activity screen marks it.
- Whenever a client names its `kinds`, the backend drops a follower's `voted_on` event on the viewer's own unpromoted game. The participation row already reports it.

**Tech Stack:** Fastify/TypeScript backend with SQLite, `@scripta/shared` (TypeScript, consumed from `dist`), Expo Router + React Query mobile app, `node:test` everywhere.

**Spec:** `docs/superpowers/specs/2026-10-16-home-activity-bell-design.md`

## Global Constraints

- **No comments in code** (root `AGENTS.md`). The why goes in the commit message.
- **Copy, verbatim:**
  - Screen and states:
    - `Activity`
    - `Nothing new yet`
    - `New followers and plays of your games show up here.`
    - `Couldn't load activity.`
    - `Couldn't refresh activity.`
  - Actions:
    - `Follow back`
    - `Following`
    - `View results →`
    - `View rankings →`
    - `View tournament →`
    - `View final bracket →`
    - `Find readers →`
    - `Want to read`
    - `Open in your shelf →`
  - Sentences:
    - `A tournament you joined has finished: <tournament name>`
- **Every touch target stays at least 44pt.** Use `minHeight` or `hitSlop`; never shrink a target to make a row shorter.
- **The action rule:** an action that changes something in place is a secondary `Button`. One that opens a screen is bold accent caption text ending in ` →`.
  - Exception: the filled primary `Button` on an open published game ("Rank this list", "Play quiz", `HomeFeedRow.tsx:26,28`) stays as it is.
- **Header actions follow DESIGN.md:** an `IconButton` with `label` and `framed`, at most two per header.
- **Rebuild shared before typechecking or testing mobile and backend:** `npm run build --workspace @scripta/shared`. Both consume shared's gitignored `dist`.
- **Old clients keep working.**
  - `fetchDashboard(cursor)` with no `kinds` sends today's query string.
  - `POST /community/dashboard/seen` is unchanged.
  - A request with no `kinds` (the legacy default) keeps today's rows.
- **The web frontend (`frontend/`) is not edited.**
- **Reuse:**
  - `Button`, `IconButton` (`badge`) and `HeaderActions` from `mobile/src/ui`.
  - From `@scripta/shared`: `newCountLabel`, `isNewDigestItem`, `clearDashboardCounts`, `participationLead`.
  - From `homeModel.ts`: `shouldMarkFeedSeen`.
  - From `FeedRow.tsx`: `useSkipEmptyPages`, `useFollowBack`.
  - From `feedRowModel.ts`: `feedEventLabel`, `feedPrimaryLabel`, `relativeTime`, `digestRoute`.
- **Commits end with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **A play by readers who can't be named.** All players are private, so `actors` is empty. The row should read "2 people played your quiz Guess the classic" with a fallback tile instead of an avatar. Pinned in Task 4. Task 5's `ActivityRow` draws the tile when `actors` is empty, which the device pass sees.
2. **Mobile Home asks for circle kinds, which don't include `participation`.** A follower's play of the viewer's own quiz must still not appear there; that duplicate is the bug being fixed. A legacy client that sends no `kinds` must still see it as a vote row, or the play vanishes for it. Pinned in Task 3.
3. **What the dedupe must keep:**
   - a follower's play of someone else's game;
   - a vote on the viewer's promoted tier list. Its `ownerUserId` is still the viewer, but participation rows exclude promoted lists.

   Pinned in Task 3.
4. **Engagement still loading.** The zero-count rule must not swallow the loading "…" or make the count jump in. Pinned in Task 7.
5. **A future digest kind added to the build** must land in exactly one of the circle or personal lists, or it silently disappears from mobile. Pinned in Task 2.

The largest-font layout is checked by the device pass under Verification. No unit test can see it.

---

### Task 1: Shared plural helper and singular counts in `contentDetail`

**Files:**
- Create: `packages/shared/src/plural.ts`
- Test: `packages/shared/src/plural.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/works/bookStats.ts`
- Modify: `packages/shared/src/library/readerIdentity.ts`
- Modify: `packages/shared/src/community/helpers.ts`
- Test: `packages/shared/src/community/helpers.test.ts`

**Interfaces:**
- Produces: `plural(count: number, one: string, many: string): string`, exported from `@scripta/shared`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/plural.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { plural } from "./plural.js";

test("plural uses the singular for exactly one and the plural otherwise", () => {
  assert.equal(plural(0, "play", "plays"), "0 plays");
  assert.equal(plural(1, "play", "plays"), "1 play");
  assert.equal(plural(2, "play", "plays"), "2 plays");
});
```

In `packages/shared/src/community/helpers.test.ts`, add after the test `"a quiz reads as a quiz in every content helper"`:

```ts
test("content counts of one read in the singular", () => {
  assert.equal(contentDetail(quiz({ questionCount: 1, playCount: 1 })), "1 question · 1 play");
  assert.equal(contentDetail({ kind: "tierlist", id: "t1", voteCode: "abc", name: "Fantasy", poolSize: 1, ballotCount: 1, votingOpen: true, promotedAt: null, covers: [] }), "1 book · 1 ballot");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @scripta/shared`

Expected: FAIL. `plural.test.ts` can't resolve `./plural.js`, and the singular test gets `"1 questions · 1 plays"`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/plural.ts`:

```ts
export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
```

In `packages/shared/src/index.ts`, add after `export * from "./dashboard.js";`:

```ts
export * from "./plural.js";
```

In `packages/shared/src/works/bookStats.ts`:
- Delete line 16 (`const plural = …`).
- Add to the imports: `import { plural } from "../plural.js";`

In `packages/shared/src/library/readerIdentity.ts`:
- Delete line 41 (`const plural = (n: number, word: string) => …`).
- Add `import { plural } from "../plural.js";`
- Change its three call sites to the three-argument form:
  - `plural(MIN_BOOKS - n, "more book")` → `plural(MIN_BOOKS - n, "more book", "more books")`
  - `plural(marks, "mark")` → `plural(marks, "mark", "marks")`
  - `plural(wide, "genre")` → `plural(wide, "genre", "genres")`

In `packages/shared/src/community/helpers.ts`, add `import { plural } from "../plural.js";` and change `contentDetail`'s tierlist and quiz cases to:

```ts
    case "tierlist":
      return `${plural(content.poolSize, "book", "books")} · ${plural(content.ballotCount, "ballot", "ballots")}${content.promotedAt ? " · permanent reference" : content.votingOpen ? "" : " · closed"}`;
```

```ts
    case "quiz":
      return `${plural(content.questionCount, "question", "questions")} · ${plural(content.playCount, "play", "plays")}${content.playOpen ? "" : " · closed"}`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @scripta/shared && npm run typecheck --workspace @scripta/shared`

Expected: PASS. The `readerIdentity.test.ts` cases "Finish 2 more books" and "Finish 1 more book" still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/plural.ts packages/shared/src/plural.test.ts packages/shared/src/index.ts packages/shared/src/works/bookStats.ts packages/shared/src/library/readerIdentity.ts packages/shared/src/community/helpers.ts packages/shared/src/community/helpers.test.ts && git commit -m "Pluralise content counts with one shared helper

contentDetail printed \"1 plays\" on Home's quiz rows. Two private plural
helpers already existed; they become the one export.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared dashboard query takes `kinds`

**Files:**
- Modify: `packages/shared/src/dashboard.ts`
- Modify: `packages/shared/src/community/api.ts`
- Test: `packages/shared/src/dashboard.test.ts`

**Interfaces:**
- Produces:
  - `CIRCLE_DIGEST_KINDS` = `["publication", "vote", "reading", "mural", "started"] as const`
  - `PERSONAL_DIGEST_KINDS` = `["follow", "participation", "completion"] as const`, checked with `satisfies readonly DigestKind[]`. Task 4 derives its type guard from it.
  - `dashboardQuery(cursor?: string, kinds?: readonly string[]): string`
  - `fetchDashboard(cursor?: string, kinds?: readonly string[]): Promise<DashboardFeedPage>` on the object `createCommunityApi` returns.
- All of these are exported from `@scripta/shared`. `fetchDashboard` comes through `@scripta/shared/community`'s `createCommunityApi`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/dashboard.test.ts`, add `CIRCLE_DIGEST_KINDS, PERSONAL_DIGEST_KINDS` to the import from `./dashboard.js`. Add after the test `"the dashboard query lists every kind this build can draw, then carries the cursor encoded"`:

```ts
test("Home and Activity ask for disjoint kinds that together cover every kind this build draws", () => {
  const all = dashboardQuery().slice("?kinds=".length).split(",");
  assert.deepEqual([...CIRCLE_DIGEST_KINDS, ...PERSONAL_DIGEST_KINDS].sort(), [...all].sort());
  assert.equal(dashboardQuery(undefined, PERSONAL_DIGEST_KINDS), "?kinds=follow,participation,completion");
  assert.equal(dashboardQuery("a b", CIRCLE_DIGEST_KINDS), "?kinds=publication,vote,reading,mural,started&cursor=a%20b");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @scripta/shared`

Expected: FAIL. `CIRCLE_DIGEST_KINDS` and `PERSONAL_DIGEST_KINDS` are undefined.

- [ ] **Step 3: Implement**

In `packages/shared/src/dashboard.ts`, replace `dashboardQuery` with:

```ts
const ALL_DIGEST_KINDS: readonly string[] = [...Object.keys(DIGEST_KINDS), "started"];
export const CIRCLE_DIGEST_KINDS = ["publication", "vote", "reading", "mural", "started"] as const;
export const PERSONAL_DIGEST_KINDS = ["follow", "participation", "completion"] as const satisfies readonly DigestKind[];

export function dashboardQuery(cursor?: string, kinds: readonly string[] = ALL_DIGEST_KINDS): string {
  const query = `?kinds=${kinds.join(",")}`;
  return cursor ? `${query}&cursor=${encodeURIComponent(cursor)}` : query;
}
```

In `packages/shared/src/community/api.ts`, change `fetchDashboard` to:

```ts
    async fetchDashboard(cursor?: string, kinds?: readonly string[]): Promise<DashboardFeedPage> {
      return withKnownDigestItems(await request<DashboardFeedPage>(`/community/dashboard${dashboardQuery(cursor, kinds)}`, { auth: "required" }));
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared`

Expected: PASS. The existing test still asserts the exact eight-kind string for `dashboardQuery()`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/src/community/api.ts packages/shared/src/dashboard.test.ts && git commit -m "Let dashboard fetches name the kinds they want

Mobile Home and the new Activity screen each fetch half of the digest.
The test pins that the two lists cover every kind, so a new kind can't
fall out of both.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Backend drops follower votes on the viewer's own games

**Files:**
- Modify: `backend/src/modules/community/service.ts`
- Test: `backend/src/modules/community/service.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `getDashboard(viewerId, cursor, limit, kinds)` (`service.ts:470`). The route passes `undefined` when the client sent no `kinds` (`routes.ts:119`).
- Produces: unchanged signatures. When `kinds` was sent, a `voted_on` event on an unpromoted game owned by `viewerId` yields no item.

- [ ] **Step 1: Write the failing test**

In `backend/src/modules/community/service.test.ts`, add after the test `"the dashboard drops quiz items whose quiz was deleted or changed owner"`:

```ts
test("a follower's play of the viewer's own game is left out whenever the client names its kinds", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, quizRefs, tierlistRefs, quizParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  quizRefs.set("mine", quizRef("mine", "viewer"));
  quizRefs.set("theirs", quizRef("theirs", "bob"));
  tierlistRefs.set("promoted", tierRef("promoted", "viewer", { promotedAt: at(1) }));
  repo.insertEvent({ id: "play-mine", user_id: "alice", type: "voted_on", ref_type: "quiz", ref_id: "mine", payload: null, created_at: at(4) });
  repo.insertEvent({ id: "play-theirs", user_id: "alice", type: "voted_on", ref_type: "quiz", ref_id: "theirs", payload: null, created_at: at(3) });
  repo.insertEvent({ id: "rank-promoted", user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: "promoted", payload: null, created_at: at(2) });
  quizParticipation.push({ id: "mine", name: "Mine", covers: [], participantCount: 1, latestAt: at(4), recent: [] });
  const ids = (kinds?: ReadonlySet<string>) => service.getDashboard("viewer", undefined, 20, kinds).items.map((item) => item.id);

  assert.deepEqual(ids(ALL_KINDS), ["quiz:mine", "play-theirs", "rank-promoted"]);
  assert.deepEqual(ids(new Set(["publication", "vote", "reading", "mural", "started"])), ["play-theirs", "rank-promoted"]);
  assert.deepEqual(ids(), ["play-mine", "play-theirs", "rank-promoted"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm exec --workspace backend -- tsx --test --test-name-pattern="viewer's own game" src/modules/community/service.test.ts`

Expected: FAIL. The first assertion gets `["quiz:mine", "play-mine", "play-theirs", "rank-promoted"]`.

- [ ] **Step 3: Implement**

In `backend/src/modules/community/service.ts`:

1. Give `toDigestItem` a fifth parameter, `hideOwnGameVotes = false`.
   - In its `voted_on` branch, delete the two-line comment ("The voter is not the owner here…"). It is no longer true.
   - Replace the `const content = …` expression (the three nested IIFEs) with:

```ts
        const quiz = event.ref_type === "quiz" ? deps.quizzes.get(event.ref_id) : undefined;
        const tierlist = event.ref_type === "tierlist" ? deps.tierlists.get(event.ref_id) : undefined;
        const tournament = event.ref_type !== "quiz" && event.ref_type !== "tierlist" ? deps.tournaments.get(event.ref_id) : undefined;
        const ownerId = quiz?.ownerUserId ?? tournament?.ownerUserId ?? (tierlist && !tierlist.promotedAt ? tierlist.ownerUserId : undefined);
        if (hideOwnGameVotes && ownerId === viewerId) return undefined;
        const content = quiz ? toQuizSummary(quiz) : tierlist ? toTierlistSummary(tierlist) : tournament ? toTournamentSummary(tournament) : undefined;
```

   The `ranking` line and the `return` after it stay as they are.

2. Change `getDashboard`'s fourth parameter from `kinds = LEGACY_DIGEST_KINDS` to `requested?: ReadonlySet<string>`. Make the first line of its body:

```ts
      const kinds = requested ?? LEGACY_DIGEST_KINDS;
```

3. Give `buildItems` a sixth parameter, `hideOwnGameVotes = false`, after `horizon`. Pass it on in the line that builds each item:

```ts
      const item = row.participation ?? row.completion ?? toDigestItem(row, profiles, glyphOf, viewerId, hideOwnGameVotes);
```

4. In `getDashboard`, pass the flag on the `buildItems` call inside the refill loop:

```ts
        const page = buildItems([...windows.flat(), ...participationRows(participation, pageBound), ...completionRows(completions, pageBound)], viewerId, limit - items.length, glyphOf, horizon, requested !== undefined);
```

The other `toDigestItem` call (`service.ts:355`, single-event lookups) and `countItems` stay as they are.

5. In `backend/README.md`, append to the bullet that starts `- **Profiles, follows and a feed.**`, after its first sentence (the one ending "…from the last 30 days)."):

```markdown
 When the client names its `kinds`, a followee's vote on one of the viewer's own games is left out, because the participation row already reports it. A promoted tier list doesn't count as the viewer's, since participation rows exclude it. The legacy request with no `kinds` keeps the vote.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`

Expected: PASS, including every existing dashboard paging test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/community/service.ts backend/src/modules/community/service.test.ts backend/README.md && git commit -m "Show a follower's play of your game once, as participation

The digest returned both the follower's voted_on event (\"played a quiz
→ Play quiz\", on your own quiz) and the participation row (\"played
your quiz → View results\"). Every client that sends kinds has always
asked for participation too, so only the legacy no-kinds request keeps
the vote. Promoted tier lists are excluded from participation, so votes
on them stay.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mobile activity row model

**Files:**
- Create: `mobile/src/features/home/activityModel.ts`
- Test: `mobile/src/features/home/activityModel.test.ts`

**Interfaces:**
- Consumes:
  - `feedEventLabel(item: DigestItem): string` and `feedPrimaryLabel(item: DigestItem): string | null` from `./feedRowModel`;
  - `participationLead` from `@scripta/shared`;
  - `PERSONAL_DIGEST_KINDS` (Task 2).
- Produces:

```ts
export type PersonalItem = Extract<DigestItem, { kind: (typeof PERSONAL_DIGEST_KINDS)[number] }>;
export type ActivityAction = { kind: "followBack" } | { kind: "following" } | { kind: "open"; label: string };
export interface ActivityRowModel { lead: string; verb: string; target: string; action: ActivityAction }
export function isPersonalItem(item: DigestItem): item is PersonalItem;
export function activityRowModel(item: PersonalItem): ActivityRowModel;
export function activitySentence(row: ActivityRowModel): string;
```

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/features/home/activityModel.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DigestItem } from "@scripta/shared";
import { activityRowModel, activitySentence, isPersonalItem, type PersonalItem } from "./activityModel.js";

const actor = { userId: "u1", username: "alice", avatarUrl: null };
const createdAt = "2026-10-14T10:00:00.000Z";
const quizPlay: PersonalItem = { kind: "participation", id: "quiz:q", game: { kind: "quiz", id: "q", name: "Guess the classic", covers: [] }, actors: [actor], count: 1, createdAt };

test("a follow offers Follow back until it is mutual, then says Following", () => {
  const follow: PersonalItem = { kind: "follow", id: "u1", actor, viewerFollows: false, createdAt };
  assert.equal(activitySentence(activityRowModel(follow)), "alice followed you");
  assert.deepEqual(activityRowModel(follow).action, { kind: "followBack" });
  assert.deepEqual(activityRowModel({ ...follow, viewerFollows: true }).action, { kind: "following" });
});

test("a play of your game names who played, what they did and which game, and opens its results", () => {
  assert.equal(activitySentence(activityRowModel(quizPlay)), "alice played your quiz Guess the classic");
  assert.deepEqual(activityRowModel(quizPlay).action, { kind: "open", label: "View results" });
  const ranked: PersonalItem = { ...quizPlay, id: "tierlist:t", game: { kind: "tierlist", id: "t", name: "Fantasy", covers: [] } };
  assert.equal(activitySentence(activityRowModel(ranked)), "alice ranked your tier list Fantasy");
  assert.deepEqual(activityRowModel(ranked).action, { kind: "open", label: "View rankings" });
  const voted: PersonalItem = { ...quizPlay, id: "tournament:b", game: { kind: "tournament", id: "b", name: "Best of", covers: [] } };
  assert.deepEqual(activityRowModel(voted).action, { kind: "open", label: "View tournament" });
});

test("a play by readers who can't be named still reads as a sentence", () => {
  assert.equal(activitySentence(activityRowModel({ ...quizPlay, actors: [], count: 2 })), "2 people played your quiz Guess the classic");
});

test("a finished tournament names the tournament and opens its bracket", () => {
  const done: PersonalItem = { kind: "completion", id: "completed:t", actor, tournament: { kind: "tournament", id: "t", name: "Best of 2026", bracketSize: 8, status: "completed", bookCount: 8, covers: [] }, winner: { title: "Dune", author: "Frank Herbert", coverUrl: null }, createdAt };
  assert.equal(activitySentence(activityRowModel(done)), "A tournament you joined has finished: Best of 2026");
  assert.deepEqual(activityRowModel(done).action, { kind: "open", label: "View final bracket" });
});

test("only follows, plays of your games and finished tournaments belong in Activity", () => {
  const reading: DigestItem = { kind: "reading", id: "r", actor, book: { title: "Dune", author: "Frank Herbert", coverUrl: null }, finished: true, createdAt };
  assert.equal(isPersonalItem(quizPlay), true);
  assert.equal(isPersonalItem(reading), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm exec --workspace mobile -- node --import tsx --test src/features/home/activityModel.test.ts`

Expected: FAIL with a module-not-found error for `./activityModel.js`.

- [ ] **Step 3: Implement**

Create `mobile/src/features/home/activityModel.ts`:

```ts
import { PERSONAL_DIGEST_KINDS, participationLead, type DigestItem } from "@scripta/shared";
import { feedEventLabel, feedPrimaryLabel } from "./feedRowModel";

export type PersonalItem = Extract<DigestItem, { kind: (typeof PERSONAL_DIGEST_KINDS)[number] }>;
export type ActivityAction = { kind: "followBack" } | { kind: "following" } | { kind: "open"; label: string };
export interface ActivityRowModel { lead: string; verb: string; target: string; action: ActivityAction }

export function isPersonalItem(item: DigestItem): item is PersonalItem {
  return (PERSONAL_DIGEST_KINDS as readonly string[]).includes(item.kind);
}

export function activityRowModel(item: PersonalItem): ActivityRowModel {
  if (item.kind === "follow") return { lead: item.actor.username, verb: feedEventLabel(item), target: "", action: item.viewerFollows ? { kind: "following" } : { kind: "followBack" } };
  if (item.kind === "participation") return { lead: participationLead(item), verb: feedEventLabel(item), target: item.game.name, action: { kind: "open", label: feedPrimaryLabel(item)! } };
  return { lead: "", verb: `${feedEventLabel(item)}:`, target: item.tournament.name, action: { kind: "open", label: feedPrimaryLabel(item)! } };
}

export function activitySentence(row: ActivityRowModel): string {
  return [row.lead, row.verb, row.target].filter(Boolean).join(" ");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm exec --workspace mobile -- node --import tsx --test src/features/home/activityModel.test.ts && npm run typecheck --workspace mobile`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/home/activityModel.ts mobile/src/features/home/activityModel.test.ts && git commit -m "Model Activity rows as one sentence and one action

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Activity screen, row, route and bell glyph

**Files:**
- Modify: `mobile/src/ui/theme.tsx`
- Modify: `mobile/src/ui/icon.tsx`
- Modify: `mobile/src/features/home/FeedRow.tsx`
- Create: `mobile/src/features/home/ActivityRow.tsx`
- Create: `mobile/src/features/home/ActivityScreen.tsx`
- Create: `mobile/src/app/(app)/(home)/activity.tsx`
- Modify: `mobile/src/features/community/DiscoverRow.tsx`
- Modify: `mobile/src/features/tierlists/TierlistResults.tsx`

**Interfaces:**
- Consumes: from Task 2, `PERSONAL_DIGEST_KINDS` and `fetchDashboard(cursor, kinds)`; from Task 4, `PersonalItem`, `isPersonalItem`, `activityRowModel`, `activitySentence`.
- Produces:
  - `ACTIVITY_QUERY_KEY = ["community", "dashboard", "activity"] as const` and `useActivityFeed()`, both from `mobile/src/features/home/FeedRow.tsx`.
  - `captionHitSlop` from `mobile/src/ui` (the theme): the `hitSlop` that grows a caption-sized text link to 44pt.
  - The `bell` `IconName`.
  - The `/activity` route.

No unit test: everything here is view code, already covered by Task 4's model tests and the device pass. Verification is typecheck plus the whole mobile suite.

- [ ] **Step 1: Add `captionHitSlop` and the bell glyph**

In `mobile/src/ui/theme.tsx`, directly after `export const minimumTouchTarget = 44;`:

```ts
export const captionHitSlop = { top: (minimumTouchTarget - typography.caption.lineHeight) / 2, bottom: (minimumTouchTarget - typography.caption.lineHeight) / 2, left: spacing.sm, right: spacing.sm };
```

`spacing` and `typography` are declared above that line (`theme.tsx:23` and `:26-29`).

In `mobile/src/ui/icon.tsx`, add to the outline `GLYPHS` table, after `settings`:

```ts
  bell: { ios: "bell", android: "notifications" },
```

The same value already exists three times as a literal. Replace those with `captionHitSlop`:
- `mobile/src/features/community/DiscoverRow.tsx:43` and `:117`: `hitSlop={{ top: 14, bottom: 14, left: spacing.sm, right: spacing.sm }}` becomes `hitSlop={captionHitSlop}`. Add `captionHitSlop` to the file's `../../ui` import.
- `mobile/src/features/tierlists/TierlistResults.tsx`: delete `const hitSlop = { top: 14, bottom: 14, left: 8, right: 8 };` (line 11). Every `hitSlop={hitSlop}` becomes `hitSlop={captionHitSlop}`, imported from the file's existing `ui` import.

- [ ] **Step 2: Add `useActivityFeed`**

In `mobile/src/features/home/FeedRow.tsx`:
- Add `import { PERSONAL_DIGEST_KINDS } from "@scripta/shared";`
- Add below `useDashboardFeed`:

```ts
export const ACTIVITY_QUERY_KEY = ["community", "dashboard", "activity"] as const;

export function useActivityFeed() {
  return useInfiniteQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchDashboard(pageParam, PERSONAL_DIGEST_KINDS),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
}
```

- [ ] **Step 3: Create `ActivityRow`**

Create `mobile/src/features/home/ActivityRow.tsx`:

```tsx
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Button, Icon, captionHitSlop, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { activityRowModel, activitySentence, type PersonalItem } from "./activityModel";
import { relativeTime } from "./feedRowModel";

export function ActivityRow({ item, isNew, following, onOpen, onFollowBack }: { item: PersonalItem; isNew: boolean; following: boolean; onOpen: () => void; onFollowBack: () => void }) {
  const { colors } = useTheme();
  const row = activityRowModel(item);
  const avatar = item.kind === "follow" ? item.actor : item.kind === "participation" ? item.actors[0] : undefined;
  const time = relativeTime(item.createdAt);
  return <View style={[styles.row, { borderBottomColor: colors.border }]}>
    <Pressable accessibilityRole="link" accessibilityLabel={`${activitySentence(row)}, ${time}`} onPress={onOpen} style={({ pressed }) => [styles.main, { opacity: pressed ? 0.6 : 1 }]}>
      {avatar ? <AuthorAvatar username={avatar.username} avatarUrl={avatar.avatarUrl} /> : <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><Icon name={item.kind === "completion" ? "champion" : "community"} size={16} color={colors.accent} /></View>}
      <View style={styles.copy}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.text }]}>{row.lead ? <Text style={styles.strong}>{row.lead} </Text> : null}{row.verb}{row.target ? <Text style={styles.strong}> {row.target}</Text> : null}</Text>
        <View style={styles.stamp}>{isNew ? <View style={[styles.newDot, { backgroundColor: colors.accent }]} /> : null}<Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{time}</Text></View>
      </View>
    </Pressable>
    {row.action.kind === "followBack" ? <Button variant="secondary" label="Follow back" accessibilityLabel={`Follow ${row.lead} back`} loading={following} onPress={onFollowBack} />
      : row.action.kind === "following" ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Following</Text>
      : <Pressable accessibilityRole="link" hitSlop={captionHitSlop} onPress={onOpen} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{row.action.label} →</Text></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  row: { marginHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  main: { flex: 1, minWidth: 0, minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  tile: { width: 28, height: 28, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  stamp: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  newDot: { width: 6, height: 6, borderRadius: radii.full },
  strong: { fontWeight: "700" }
});
```

The 28pt tile matches `AuthorAvatar`'s default size (`mobile/src/features/community/AuthorAvatar.tsx:30`), so the sentences line up.

- [ ] **Step 4: Create `ActivityScreen`**

Create `mobile/src/features/home/ActivityScreen.tsx`:

```tsx
import { useCallback, useEffect, useRef } from "react";
import { FlatList, StyleSheet, View, type ViewToken } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { clearDashboardCounts, isNewDigestItem, type DashboardFeedPage } from "@scripta/shared";
import { EmptyState, ErrorState, Screen, Skeleton, Toast, spacing } from "../../ui";
import { markDashboardSeen } from "../community/api";
import { ActivityRow } from "./ActivityRow";
import { isPersonalItem } from "./activityModel";
import { ACTIVITY_QUERY_KEY, useActivityFeed, useFollowBack, useSkipEmptyPages } from "./FeedRow";
import { digestRoute } from "./feedRowModel";
import { shouldMarkFeedSeen } from "./homeModel";

const ACTIVITY_VIEWABILITY = { itemVisiblePercentThreshold: 50 };

export function ActivityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const feed = useActivityFeed();
  const items = (feed.data?.pages.flatMap((page) => page.items) ?? []).filter(isPersonalItem);
  const seenAt = feed.data?.pages[0]?.seenAt ?? null;
  const { followingId, followError, followBack } = useFollowBack(feed.refetch);
  const seenSent = useRef(false);
  const rowVisible = useRef(false);
  useSkipEmptyPages(feed, items.length);

  useFocusEffect(useCallback(() => {
    seenSent.current = false;
    void feed.refetch();
  }, [feed.refetch]));

  const markSeen = useRef(() => {});
  markSeen.current = () => {
    if (!shouldMarkFeedSeen({ focused, rowVisible: rowVisible.current && items.length > 0, loaded: feed.data !== undefined, failed: feed.isError, fetching: feed.isFetching, sent: seenSent.current })) return;
    seenSent.current = true;
    void markDashboardSeen().then(
      () => queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(ACTIVITY_QUERY_KEY, (data) => data ? clearDashboardCounts(data) : data),
      () => { seenSent.current = false; }
    );
  };
  useEffect(() => { markSeen.current(); }, [focused, feed.data, feed.isError, feed.isFetching]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    rowVisible.current = viewableItems.length > 0;
    markSeen.current();
  }).current;

  const error = followError ?? (feed.isRefetchError && !feed.isRefetching ? "Couldn't refresh activity." : null);
  const empty = feed.isPending || (feed.hasNextPage && !feed.isError) ? <Skeleton height={64} /> : feed.isError && !feed.data ? <ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void feed.refetch()} /> : <EmptyState title="Nothing new yet" body="New followers and plays of your games show up here." />;
  return <Screen top={false}>
    <Stack.Screen options={{ title: "Activity", headerShown: true }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <FlatList data={items} keyExtractor={(item) => `${item.kind}:${item.id}`} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.list}
      renderItem={({ item }) => <ActivityRow item={item} isNew={isNewDigestItem(item, seenAt)} following={item.kind === "follow" && followingId === item.actor.userId} onOpen={() => router.push(digestRoute(item) as never)} onFollowBack={() => { if (item.kind === "follow") void followBack(item.actor.userId); }} />}
      ListEmptyComponent={<View style={styles.state}>{empty}</View>}
      ListFooterComponent={feed.isFetchingNextPage && items.length ? <View style={styles.state}><Skeleton height={64} /></View> : feed.isFetchNextPageError ? <View style={styles.state}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void feed.fetchNextPage()} /></View> : null}
      onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) void feed.fetchNextPage(); }} onEndReachedThreshold={0.4}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={ACTIVITY_VIEWABILITY} />
  </Screen>;
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.huge },
  state: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg }
});
```

- [ ] **Step 5: Create the route**

Create `mobile/src/app/(app)/(home)/activity.tsx`:

```tsx
import { ActivityScreen } from "@/features/home/ActivityScreen";

export default function ActivityRoute() {
  return <ActivityScreen />;
}
```

- [ ] **Step 6: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/ui/theme.tsx mobile/src/ui/icon.tsx mobile/src/features/home/FeedRow.tsx mobile/src/features/home/ActivityRow.tsx mobile/src/features/home/ActivityScreen.tsx "mobile/src/app/(app)/(home)/activity.tsx" mobile/src/features/community/DiscoverRow.tsx mobile/src/features/tierlists/TierlistResults.tsx && git commit -m "Add the Activity screen for follows and plays of your games

It fetches only personal digest kinds and owns mark-seen on mobile, so
the shared seen timestamp now moves when someone actually looks at
these items.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Home shows the reading circle only, with the bell

**Files:**
- Modify: `mobile/src/features/home/FeedRow.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/features/home/HomeFeedRow.tsx`
- Modify: `mobile/src/features/home/homeModel.ts`
- Test: `mobile/src/features/home/homeModel.test.ts`
- Modify: `mobile/src/app/(app)/_layout.tsx`
- Modify: `mobile/README.md`

**Interfaces:**
- Consumes: from Task 2, `CIRCLE_DIGEST_KINDS`; from Task 5, `useActivityFeed`, the `bell` glyph and the `/activity` route.
- Produces:
  - `FeedRow` drops its `onFollowBack`, `following` and `isNew` props.
  - `homeModel.ts` exports only `shouldMarkFeedSeen`.

- [ ] **Step 1: Update the model test**

In `mobile/src/features/home/homeModel.test.ts`:
- Delete the test `"personal events precede the circle while preserving order within each section"`.
- Delete the now-unused `actor`, `createdAt` and `DigestItem` lines.
- Change the import to `import { shouldMarkFeedSeen } from "./homeModel.js";`

- [ ] **Step 2: Remove `homeFeedSections`**

In `mobile/src/features/home/homeModel.ts`:
- Delete `homeFeedSections`.
- Delete the `DigestItem` import if nothing else uses it.

- [ ] **Step 3: Home's feed asks for circle kinds**

In `mobile/src/features/home/FeedRow.tsx`:
- Extend the shared import to `import { CIRCLE_DIGEST_KINDS, PERSONAL_DIGEST_KINDS } from "@scripta/shared";`
- In `useDashboardFeed`, change the `queryFn` to `({ pageParam }) => fetchDashboard(pageParam, CIRCLE_DIGEST_KINDS)`.

- [ ] **Step 4: Tab badge reads the Activity feed**

In `mobile/src/app/(app)/_layout.tsx`:
- Replace `import { useDashboardFeed } from "../../features/home/FeedRow";` with `import { useActivityFeed } from "../../features/home/FeedRow";`
- In `AppTabs`, replace `const { data } = useDashboardFeed();` with `const { data } = useActivityFeed();`

- [ ] **Step 5: Rewrite HomeScreen for one section and the bell**

In `mobile/src/features/home/HomeScreen.tsx`, make these changes:

1. **Remove** these imports and the code that uses them:
   - from `react`: `useEffect`, `useRef`
   - `type ViewToken`
   - `useIsFocused`
   - `type InfiniteData`
   - `clearDashboardCounts`, `isNewDigestItem`, `type DashboardFeedPage`
   - `markDashboardSeen`
   - `DASHBOARD_QUERY_KEY`, `useFollowBack`
   - `homeFeedSections`, `shouldMarkFeedSeen`
   - `FEED_VIEWABILITY`

   Also remove:
   - the `focused`, `seenAt`, `seenSent`, `rowVisible`, `firstPage` and `markSeen` declarations;
   - the `useEffect` that calls `markSeen`;
   - `onViewableItemsChanged`;
   - the `useFollowBack` line.

2. **Add** these imports:
   - `HeaderActions` from `../../ui`
   - `useActivityFeed` from `./FeedRow`

   Keep `newCountLabel`, `type DigestItem`, `useDashboardFeed`, `useSkipEmptyPages` and `FeedRow`.

3. **Declarations.** After `const actions = useHomeActions(items);`:

```tsx
  const activity = useActivityFeed();
  const activityBadge = newCountLabel(activity.data?.pages[0]?.personalNewCount ?? 0);
  const sections = [{ title: "Your reading circle", data: items }];
```

4. **Focus and refresh.**
   - In the `useFocusEffect` callback: drop `seenSent.current = false;`, add `void activity.refetch();`, and add `activity.refetch` to its dependency list.
   - In `onRefresh`, add `activity.refetch()` to the `Promise.all` array.

5. **Errors.** Change the `error` line to:

```tsx
  const error = actions.error ?? (dashboard.isRefetchError && !dashboard.isRefetching ? "Couldn't refresh activity." : null);
```

6. **Header.** Change `headerRight` to:

```tsx
headerRight: () => <HeaderActions><IconButton name="bell" label="Activity" framed accessibilityLabel="Open activity" badge={activityBadge} onPress={() => router.push("/activity" as never)} /><IconButton name="bookmark" label="Saved" framed accessibilityLabel="Open saved games and murals" onPress={() => setSavedOpen(true)} /></HeaderActions>
```

7. **Section header.** Change `renderSectionHeader` to:

```tsx
      renderSectionHeader={({ section }) => <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{section.title}</Text>
        <Pressable accessibilityRole="link" onPress={findReaders} style={styles.sectionAction}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>Find readers →</Text></Pressable>
      </View>}
```

8. **Rows, footer and viewability.**
   - `renderItem` becomes:

```tsx
      renderItem={({ item }) => <FeedRow item={item} actions={actions} onOpen={() => router.push(digestRoute(item) as never)} onComments={() => setComments(item)} />}
```

   - `renderSectionFooter` becomes `({ section }) => !section.data.length ? <View style={styles.onboarding}>{empty}</View> : null`.
   - Delete the `onViewableItemsChanged={…}` and `viewabilityConfig={…}` props from the `SectionList`.

- [ ] **Step 6: Drop the follow-back props from `FeedRow`**

In `mobile/src/features/home/HomeFeedRow.tsx`:
- Remove `onFollowBack`, `following` and `isNew` from the `FeedRow` props, both the destructuring and the type.
- Delete the follow-back `Pressable` (the line beginning `{item.kind === "follow" && !item.viewerFollows ?`).
- Delete the `newDot` element inside `styles.stamp`.
- Delete the `newDot` style.

Home now requests only circle kinds, and the Saved sheet only returns saved content, so no follow row reaches `FeedRow` any more.

`FeedRow`'s participation and completion branches stay. It is typed for `DigestItem` because the Saved sheet passes `DigestItem`, and narrowing that type is out of scope.

- [ ] **Step 7: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`

Expected: PASS.

Update the Home section of `mobile/README.md`:

1. Replace its first paragraph (it begins "Home uses the Open shelf feed:") with:

```markdown
Home shows “Your reading circle”: followed readers’ publications, reading activity and murals. The labelled Activity button in the header has a bell and an unread badge. It opens the Activity screen: new followers (with Follow back), plays of your games, and winners from tournaments you joined. Seeing that screen marks them seen, which also clears the Home tab badge. Own reading/progress and next-book widgets no longer occupy Home. Posts use theme tokens, inset separators and aligned actions.
```

2. In the next paragraph, delete the sentence "Personal grouped notifications have sharing and their relevant primary action."

- [ ] **Step 8: Commit**

```bash
git add mobile/src/features/home/FeedRow.tsx mobile/src/features/home/HomeScreen.tsx mobile/src/features/home/HomeFeedRow.tsx mobile/src/features/home/homeModel.ts mobile/src/features/home/homeModel.test.ts "mobile/src/app/(app)/_layout.tsx" mobile/README.md && git commit -m "Give Home's personal items to the bell

Follows and plays of your games stayed on Home for 30 days whether
seen or not, so a busy week pushed the reading circle off the first
screen. Home now fetches circle kinds only and stops marking seen;
the bell and the tab badge count from the Activity feed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Home posts — height, alignment, actions, zero counts, verb colour

**Files:**
- Modify: `mobile/src/features/home/feedRowModel.ts`
- Test: `mobile/src/features/home/feedRowModel.test.ts`
- Modify: `mobile/src/features/home/HomeFeedRow.tsx`
- Modify: `mobile/src/features/home/FeedPreview.tsx`

**Interfaces:**
- Consumes: `captionHitSlop` (Task 5); `SLOT_WIDTH` from `mobile/src/features/community/CoverFan.tsx`.
- Produces: `reactionCount(count: number | undefined): string | null` from `feedRowModel.ts`.

- [ ] **Step 1: Write the failing test**

In `mobile/src/features/home/feedRowModel.test.ts`, add `reactionCount` to the import from `./feedRowModel.js`, then add:

```ts
test("a reaction count hides at zero but still shows the loading ellipsis", () => {
  assert.equal(reactionCount(undefined), "…");
  assert.equal(reactionCount(0), null);
  assert.equal(reactionCount(1), "1");
  assert.equal(reactionCount(12), "12");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm exec --workspace mobile -- node --import tsx --test src/features/home/feedRowModel.test.ts`

Expected: FAIL, because `reactionCount` is not a function.

- [ ] **Step 3: Implement `reactionCount`**

Add to `mobile/src/features/home/feedRowModel.ts`, after `hasActivityThread`:

```ts
export function reactionCount(count: number | undefined): string | null {
  return count === undefined ? "…" : count === 0 ? null : String(count);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm exec --workspace mobile -- node --import tsx --test src/features/home/feedRowModel.test.ts`

Expected: PASS.

- [ ] **Step 5: Apply the post changes in `HomeFeedRow.tsx`**

1. **Imports.**
   - Add `reactionCount` to the `./feedRowModel` import.
   - Add `captionHitSlop` to the `../../ui` import.
   - Add `import { SLOT_WIDTH } from "../community/CoverFan";`

2. **Verb colour.** In the `feedEventLabel` text under the actor name, change the colour to `{ color: colors.textDim }`. This removes the `colors.success` case for finished books.

3. **Primary link.** On the `action` link `Pressable` (the one rendering `{primary} →`), add `hitSlop={captionHitSlop}`.

4. **Heading.** On the `heading` `Pressable`, add `hitSlop={10}`. That is `(44 - typography.title.lineHeight 24) / 2`.

5. **Reading action.** Replace the whole `{item.kind === "reading" ? <Pressable …>…</Pressable> : null}` expression with:

```tsx
        {item.kind === "reading" ? owned
          ? <Pressable accessibilityRole="link" hitSlop={captionHitSlop} onPress={() => router.push(`/book/${encodeURIComponent(bookKey(owned))}` as never)} style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1 }]}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>Open in your shelf →</Text></Pressable>
          : <View style={styles.primary}><Button variant="secondary" label="Want to read" loading={actions.wanting} onPress={() => actions.wantToRead(item)} /></View>
        : null}
```

6. **Counts.**
   - Before `return`, add:

```tsx
  const likes = reactionCount(engagement?.likes);
  const comments = reactionCount(engagement?.comments);
```

   - In the like `Pressable`, replace the count `<Text …>{engagement?.likes ?? "…"}</Text>` with:

```tsx
{likes ? <Text {...dynamicType} style={[typography.caption, styles.count, { color: colors.textDim }]}>{likes}</Text> : null}
```

   - In the comment `Pressable`, replace the count `<Text …>{engagement?.comments ?? "…"}</Text>` with:

```tsx
{comments ? <Text {...dynamicType} style={[typography.caption, styles.count, { color: colors.textDim }]}>{comments}</Text> : null}
```

7. **Touch areas.** Add `hitSlop={6}` to:
   - the bookmark `Pressable`,
   - both reaction `Pressable`s,
   - the share `Pressable`.

   Add `hitSlop={4}` to the actor `Pressable` (`styles.reader`).

8. **Styles.**

```ts
  post: { marginHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, gap: spacing.sm },
  reader: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.sm },
  compactPreview: { minWidth: SLOT_WIDTH, alignItems: "flex-start" },
  heading: { justifyContent: "center" },
  textAction: { alignSelf: "flex-start", justifyContent: "center" },
  iconAction: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  reaction: { minHeight: 32, minWidth: 64, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.sm },
  share: { marginLeft: "auto", minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.sm }
```

   These replace the existing entries with the same names. Leave every other style as it is.

9. **Unused imports.** If `minimumTouchTarget` is no longer used in the file, remove it from the import.

- [ ] **Step 6: Cover-sized icon tile in `FeedPreview.tsx`**

1. In the non-tier-list branch, replace:

```tsx
<View style={styles.emptyPreview}><Icon name={feedRowModel(item).icon} size={32} color={colors.accent} /></View>
```

   with:

```tsx
<View style={[styles.iconTile, { backgroundColor: colors.surface }]}><Icon name={feedRowModel(item).icon} size={24} color={colors.accent} /></View>
```

2. Replace the `emptyPreview` style with:

```ts
  iconTile: { width: 48, height: 72, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
```

- [ ] **Step 7: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/features/home/feedRowModel.ts mobile/src/features/home/feedRowModel.test.ts mobile/src/features/home/HomeFeedRow.tsx mobile/src/features/home/FeedPreview.tsx && git commit -m "Tighten Home posts and give their actions one rule

Posts were ~265pt because every title, link, bookmark and reaction forced
a 44pt box; they keep 44pt touch areas through hitSlop instead. In-place
actions are buttons, links that open a screen end in an arrow, zero
counts hide, and only finished books had a green verb.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Verification (after Task 7, main session)

1. **Run the gate:** `node scripts/gate.mjs`. It runs every Verify command for the packages touched: shared, backend, mobile.
2. **Device pass.** Run `node scripts/dev-status.mjs --json` first. If another worktree holds the emulator, stop and report.
   - Otherwise dispatch `device-checker` with this worktree's path. Check against the fixture:
     - **Home:**
       - an "Activity" button with a bell glyph and the badge sits left of "Saved";
       - one section, "Your reading circle", with "Find readers →";
       - no "Around your shelf";
       - alice's play of the dev quiz does not appear;
       - Piranesi shows a "Want to read" button;
       - quiz and book titles start at the same x;
       - post heights are about 180pt (link) and 205pt (Want to read).
     - **Activity** (tap the bell):
       - "fixture_alice played your quiz Guess the classic" with "View results →";
       - "fixture_charlie followed you" with a "Follow back" button;
       - "fixture_alice followed you" with grey "Following".
       - After leaving and returning to Home, the bell badge and the Home tab badge are gone.
     - **Both screens:** time labels never get younger down the list.
     - **Largest system font:** repeat Home and Activity. The sentence wraps, the action stays fully visible, and nothing clips.
3. **Branch review:** `branch-reviewer` with the spec and this plan. Run `node scripts/codex-review.mjs branch docs/superpowers/specs/2026-10-16-home-activity-bell-design.md docs/superpowers/plans/2026-10-16-home-activity-bell.md` in parallel.
