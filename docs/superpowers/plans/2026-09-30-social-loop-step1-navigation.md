# Social loop, step 1: one Discover and a Community screen: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge mobile's two public browse lists into one paginated, guest-safe
Discover, and turn the Activity screen into a Community screen reachable from
the Home header. Web gets the same public Discover and pagination.

**Architecture:**
- **Discover:** mobile's `/arena` root route renders the existing
  `DiscoverPane` (now paginated, and it only sends auth when signed in)
  instead of `ArenaPublicListScreen`. It is pushed from Games → Browse, so
  Back returns to Games.
- **Community:** the Activity screen and its route are renamed. Its tab
  helpers move to `communityTabs.ts`, including the rule for when Activity
  counts as seen.
- **Backend:** one fix, so Discover reports next pages and searches past the
  first window.
- **Web:** `/arena` renders a public Discover for guests and redirects
  signed-in users. Discover gets "Load more".

**Tech Stack:**
- Backend: Fastify, `node:sqlite`, and `node:test` via tsx.
- Mobile: Expo Router, React Native and TanStack Query.
- Web: React, React Router, TanStack Query and Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-30-social-loop-design.md`, section
"Step 1".

**Worktree:** `/Users/andreribeiro/Documents/scripta/.claude/worktrees/app-social-interaction-gaps-9f9c3c`,
branch `claude/app-social-interaction-gaps-9f9c3c`.

## Global Constraints

**Code**
- No comments in new code. Keep existing comments in files you move.
- Write the minimum code: reuse `DiscoverPane`, `ArenaBooksSheet`,
  `AddBookSheet`, `IconButton` and `SwipeableTabs`, and add no new
  abstractions.
- Don't swallow new errors. The existing `markDashboardSeen().catch(() => {})`
  stays as it is.

**Routes and links**
- These paths are unchanged: `/arena`, `/arena/:id`, `/vote/:code`, and
  `mobile/app.json`'s app links.
- `/activity` is removed. Nothing outside `HomeScreen.tsx` links to it.

**Copy**
- Mobile screen titles: "Discover" and "Community".
- Community tab labels: "Activity", "Discover", "People".
- Home header button: label "Community", icon `community`.
- Tournament row action: "See books", with the accessibility label
  "See all N books in <name>".
- Web public page: title "Discover", with a "Sign in" link.

**Git**
- Run git as `/usr/bin/git` from the worktree root, as a plain command.
  Commit only after the task's checks pass.

**Checks**
- `@scripta/shared` isn't changed in this plan. It's already built. Don't
  rebuild it unless a check reports missing `dist`, and then run
  `npm run build --workspace @scripta/shared`.
- Backend: `npm run typecheck --workspace backend` and
  `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`. The
  second reproduces CI, which has no `.env`.
- Mobile: `npm run typecheck --workspace mobile` and
  `npm test --workspace mobile`.
- Web: `npm run typecheck --workspace frontend`,
  `npm run lint --workspace frontend` and `npm test --workspace frontend`.
- Baseline on this worktree before any change: backend 451/451, mobile
  130/130, web 74/74, typecheck and lint clean.

## Review Focus

1. **A signed-out visitor opens `/arena` on mobile** (for example from the
   App Link). Discover must load, not show "Not signed in". There's no unit
   test: the request now uses `auth: Boolean(user)`. Check this line in
   Task 2's diff review.
2. **A tier-list-only filter, or a search, when there are more than 20
   items.** The next page and older matches must appear. Pinned by the
   Task 1 backend tests. The client wiring is `getNextPageParam: (p) =>
   p.nextOffset ?? undefined` on both clients.
3. **Opening Community on Discover or People** must not clear Home's "N new".
   Pinned by `shouldMarkSeen` tests in Task 4.
4. **Tapping "See books" in a Discover row** must open the books sheet only,
   not also the tournament. Checked in the Task 6 device pass.
5. **Back from Discover** returns to Games at the same scroll position.
   Checked in the Task 6 device pass.

---

### Task 1: Discover reports next pages and searches past the first window

**Files:**
- Modify: `backend/src/modules/community/service.ts:312-314` (`getDiscover`)
- Test: `backend/src/modules/community/service.test.ts` (add after the test
  ending at line 581)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /community/discover` keeps its shape
  (`{ items, nextOffset }`). `nextOffset` is now non-null whenever more
  matching items exist, for every `type`, with or without `q`.

- [ ] **Step 1: Write the failing tests**

Add after the test `"discover filters by type and by name substring, and paginates by offset"`:

```ts
test("a single-type discover filter reports its next page", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { createdAt: "2026-09-01T00:00:00.000Z" }));
  tierlistRefs.set("t2", tierRef("t2", "alice", { createdAt: "2026-09-02T00:00:00.000Z" }));
  tierlistRefs.set("t3", tierRef("t3", "alice", { createdAt: "2026-09-03T00:00:00.000Z" }));

  const page1 = service.getDiscover("tierlist", "", 2, 0);
  assert.deepEqual(page1.items.map((i) => i.content.id), ["t3", "t2"]);
  assert.equal(page1.nextOffset, 2);
  const page2 = service.getDiscover("tierlist", "", 2, 2);
  assert.deepEqual(page2.items.map((i) => i.content.id), ["t1"]);
  assert.equal(page2.nextOffset, null);
});

test("discover search finds a match older than the first page", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("old", tierRef("old", "alice", { name: "Fantasy classics", createdAt: "2026-09-01T00:00:00.000Z" }));
  for (let day = 2; day <= 9; day++) {
    tierlistRefs.set(`t${day}`, tierRef(`t${day}`, "alice", { name: `List ${day}`, createdAt: `2026-09-0${day}T00:00:00.000Z` }));
  }

  const page = service.getDiscover("all", "fantasy", 2, 0);
  assert.deepEqual(page.items.map((i) => i.content.id), ["old"]);
  assert.equal(page.nextOffset, null);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/community/service.test.ts`

Expected: the two new tests FAIL. The first gets `nextOffset` `null`
instead of `2`; the second gets `[]` instead of `["old"]`. Every other test
passes.

- [ ] **Step 3: Implement**

In `getDiscover`, replace:

```ts
      const window = Math.min(offset + limit, DISCOVER_SCAN_CAP);
```

with:

```ts
      const window = needle ? DISCOVER_SCAN_CAP : Math.min(offset + limit + 1, DISCOVER_SCAN_CAP);
```

- [ ] **Step 4: Run the checks**

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/community/service.test.ts`
Expected: PASS, all tests.

Then run from the worktree root: `npm run typecheck --workspace backend` and
`DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`.
Expected: both exit 0, and the test count is 453.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/community/service.ts backend/src/modules/community/service.test.ts
/usr/bin/git commit -m "Let Discover page past its first window and search every published game"
```

The commit body should say why: each type was asked for only `offset + limit`
rows, so a single-type filter never reported a next page and search only saw
the newest page of each type.

---

### Task 2: Mobile Discover pages, works signed out, and previews a tournament's books

**Files:**
- Modify: `mobile/src/features/community/api.ts:48-51` (`fetchDiscover`)
- Modify: `mobile/src/features/community/DiscoverPane.tsx`

**Interfaces:**
- Consumes: `ArenaBooksSheet({ id, name, onAddBook, onClose })` from
  `mobile/src/features/arena/ArenaBooksSheet.tsx`, and
  `AddBookSheet({ book, onClose })` from
  `mobile/src/features/community/AddBookSheet.tsx`. Both are unchanged;
  `AddBookSheet` already shows guests a Sign in prompt. Also `useAuth()`
  from `mobile/src/core/auth`.
- Produces:
  - `fetchDiscover(type: DiscoverType, q: string, offset = 0, signedIn = true)`
  - `DiscoverPane()`, still exported with no props. Task 3 and Task 4 render
    it unchanged.

- [ ] **Step 1: Make the request's auth follow the session**

In `mobile/src/features/community/api.ts`, replace `fetchDiscover` with:

```ts
export async function fetchDiscover(type: DiscoverType, q: string, offset = 0, signedIn = true) {
  const params = new URLSearchParams({ type, q, offset: String(offset) });
  return apiClient.request<{ items: DiscoverItem[]; nextOffset: number | null }>(`/community/discover?${params}`, { auth: signedIn });
}
```

- [ ] **Step 2: Page through Discover with an infinite query**

In `DiscoverPane.tsx`:
- Change the import `import { useQuery } from "@tanstack/react-query";` to
  `import { useInfiniteQuery } from "@tanstack/react-query";`.
- Add `import { useAuth } from "../../core/auth";`,
  `import { ArenaBooksSheet } from "../arena/ArenaBooksSheet";` and
  `import { AddBookSheet } from "./AddBookSheet";`.

Replace the `discover` query and the `items` line with:

```ts
  const { user } = useAuth();
  const discover = useInfiniteQuery({
    queryKey: ["community", "discover", filter, needle],
    queryFn: ({ pageParam }) => fetchDiscover(filter, needle, pageParam, Boolean(user)),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    retry: false,
  });
  const items = discover.data?.pages.flatMap((page) => page.items) ?? [];
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [addBook, setAddBook] = useState<{ title: string; author: string; coverUrl?: string | null } | null>(null);
```

On the `FlatList`, add these props and change `renderItem`:

```tsx
              onEndReached={() => {
                if (discover.hasNextPage && !discover.isFetchingNextPage) void discover.fetchNextPage();
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={discover.isFetchingNextPage ? <View style={styles.page}><Skeleton height={80} /></View> : null}
              renderItem={({ item }) => <DiscoverRow item={item} onPreviewBooks={setPreview} />}
```

Just before the closing `</KeyboardAvoidingView>`, after the dock's
`</View>`, render the two sheets:

```tsx
      <ArenaBooksSheet
        id={preview?.id ?? null}
        name={preview?.name ?? "Tournament"}
        onAddBook={(book) => {
          setPreview(null);
          setAddBook(book);
        }}
        onClose={() => setPreview(null)}
      />
      {addBook ? <AddBookSheet book={addBook} onClose={() => setAddBook(null)} /> : null}
```

- [ ] **Step 3: Give tournament rows a "See books" action**

Change `DiscoverRow`'s signature to:

```tsx
function DiscoverRow({ item, onPreviewBooks }: { item: DiscoverItem; onPreviewBooks: (tournament: { id: string; name: string }) => void }) {
```

Inside `<View style={styles.statusRow}>`, after the `contentStats(...)` map,
add:

```tsx
              {content.kind === "tournament" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`See all ${content.bookCount} books in ${content.name}`}
                  hitSlop={spacing.sm}
                  onPress={() => onPreviewBooks({ id: content.id, name: content.name })}
                >
                  <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>See books</Text>
                </Pressable>
              ) : null}
```

This is a nested `Pressable`, the same pattern as the author chip in the same
row, so it takes its own press without triggering the row's navigation.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck --workspace mobile` and `npm test --workspace mobile`.
Expected: both exit 0, 130 tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile/src/features/community/api.ts mobile/src/features/community/DiscoverPane.tsx
/usr/bin/git commit -m "Page through Discover, load it signed out, and preview a tournament's books from it"
```

---

### Task 3: Discover replaces the old public list at /arena

**Files:**
- Create: `mobile/src/features/community/DiscoverScreen.tsx`
- Modify: `mobile/src/app/arena/index.tsx`
- Delete: `mobile/src/features/arena/ArenaPublicListScreen.tsx`
- Modify: `mobile/src/features/arena/api.ts`, removing `fetchPublicTournaments`
  (lines 43-45)
- Modify: `mobile/src/features/tierlists/api.ts`, removing the
  `PublicTierlistSummary` interface (lines 18-26) and `fetchPublicTierlists`
  (lines 71-73)

**Interfaces:**
- Consumes: `DiscoverPane` from Task 2, and `Screen` from `mobile/src/ui`.
- Produces: `DiscoverScreen()`, the root-stack screen at `/arena`. Games →
  Browse (`ArenaHomeScreen.tsx:83`, unchanged) pushes it.

- [ ] **Step 1: Create the screen**

`mobile/src/features/community/DiscoverScreen.tsx`:

```tsx
import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { DiscoverPane } from "./DiscoverPane";

export function DiscoverScreen() {
  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: "Discover" }} />
      <DiscoverPane />
    </Screen>
  );
}
```

- [ ] **Step 2: Route `/arena` to it**

Replace the whole of `mobile/src/app/arena/index.tsx` with:

```tsx
import { DiscoverScreen } from "../../features/community/DiscoverScreen";

export default function ArenaPublicRoute() {
  return <DiscoverScreen />;
}
```

- [ ] **Step 3: Delete the old list and its only fetchers**

```bash
/usr/bin/git rm mobile/src/features/arena/ArenaPublicListScreen.tsx
```

In `mobile/src/features/arena/api.ts`, delete:

```ts
export async function fetchPublicTournaments() {
  return (await apiClient.request<{ tournaments: TournamentSummary[] }>("/arenas/public")).tournaments;
}
```

In `mobile/src/features/tierlists/api.ts`, delete the `PublicTierlistSummary`
interface and:

```ts
export async function fetchPublicTierlists() {
  return (await apiClient.request<{ tierlists: PublicTierlistSummary[] }>("/tierlists/public")).tierlists;
}
```

Leave the backend endpoints alone; they stay for compatibility.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck --workspace mobile` and `npm test --workspace mobile`.
Expected: both exit 0. The typecheck proves nothing else imported the deleted
code.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile/src/features/community/DiscoverScreen.tsx mobile/src/app/arena/index.tsx mobile/src/features/arena/api.ts mobile/src/features/tierlists/api.ts
/usr/bin/git commit -m "Open Discover from Games Browse instead of the old public list"
```

---

### Task 4: The Activity screen becomes Community, reachable from the Home header

**Files:**
- Rename: `mobile/src/features/home/homeTabs.ts` → `mobile/src/features/home/communityTabs.ts`
- Rename: `mobile/src/features/home/homeTabs.test.ts` → `mobile/src/features/home/communityTabs.test.ts`
- Rename: `mobile/src/features/home/ActivityScreen.tsx` → `mobile/src/features/home/CommunityScreen.tsx`
- Rename: `mobile/src/app/(app)/(home)/activity.tsx` → `mobile/src/app/(app)/(home)/community.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx` (header, and the links at
  lines 143 and 148)

**Interfaces:**
- Consumes: `DiscoverPane` (Task 2), `PeoplePane`, `markDashboardSeen`,
  `useDashboardFeed`, `IconButton({ name, accessibilityLabel, label, onPress, framed })`.
- Produces:
  - `type CommunityTab = "activity" | "discover" | "people"`
  - `communityTabOptions(newCount: number)`
  - `defaultCommunityTab(activityItemCount: number): CommunityTab`
  - `parseCommunityTab(value: string | undefined): CommunityTab | undefined`
  - `shouldMarkSeen(tab: CommunityTab, activityItemCount: number, loadFailed: boolean): boolean`
  - `CommunityScreen({ initialTab?: CommunityTab })`
  - the route `/community?tab=activity|discover|people`

- [ ] **Step 1: Move the files**

```bash
/usr/bin/git mv mobile/src/features/home/homeTabs.ts mobile/src/features/home/communityTabs.ts
/usr/bin/git mv mobile/src/features/home/homeTabs.test.ts mobile/src/features/home/communityTabs.test.ts
/usr/bin/git mv mobile/src/features/home/ActivityScreen.tsx mobile/src/features/home/CommunityScreen.tsx
/usr/bin/git mv "mobile/src/app/(app)/(home)/activity.tsx" "mobile/src/app/(app)/(home)/community.tsx"
```

- [ ] **Step 2: Write the failing tests**

Replace the contents of `mobile/src/features/home/communityTabs.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { communityTabOptions, defaultCommunityTab, parseCommunityTab, shouldMarkSeen } from "./communityTabs.js";

test("the tabs read Activity, Discover and People", () => {
  assert.deepEqual(communityTabOptions(0).map((tab) => tab.label), ["Activity", "Discover", "People"]);
});

test("Activity only carries a badge when there's something new", () => {
  assert.equal(communityTabOptions(0).find((tab) => tab.value === "activity")?.badge, undefined);
  assert.equal(communityTabOptions(3).find((tab) => tab.value === "activity")?.badge, 3);
  assert.equal(communityTabOptions(3).find((tab) => tab.value === "discover")?.badge, undefined);
});

test("an empty feed opens on Discover instead of a dead Activity tab", () => {
  assert.equal(defaultCommunityTab(0), "discover");
  assert.equal(defaultCommunityTab(1), "activity");
});

test("a tab param opens that tab, and anything else falls back to the default", () => {
  assert.equal(parseCommunityTab("activity"), "activity");
  assert.equal(parseCommunityTab("discover"), "discover");
  assert.equal(parseCommunityTab("people"), "people");
  assert.equal(parseCommunityTab("feed"), undefined);
  assert.equal(parseCommunityTab(undefined), undefined);
});

test("activity counts as seen only while its rows are on screen", () => {
  assert.equal(shouldMarkSeen("activity", 2, false), true);
  assert.equal(shouldMarkSeen("activity", 0, false), false);
  assert.equal(shouldMarkSeen("activity", 2, true), false);
  assert.equal(shouldMarkSeen("discover", 2, false), false);
  assert.equal(shouldMarkSeen("people", 2, false), false);
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd mobile && node --import tsx --test src/features/home/communityTabs.test.ts`
Expected: FAIL. The imports `communityTabOptions`, `defaultCommunityTab`,
`parseCommunityTab` and `shouldMarkSeen` don't exist yet.

- [ ] **Step 4: Implement the tab helpers**

Replace the contents of `mobile/src/features/home/communityTabs.ts` with the
following. The doc comment on `defaultCommunityTab` is kept from
`homeTabs.ts`.

```ts
const COMMUNITY_TABS = [
  { value: "activity", label: "Activity" },
  { value: "discover", label: "Discover" },
  { value: "people", label: "People" },
] as const;

export type CommunityTab = (typeof COMMUNITY_TABS)[number]["value"];

export function communityTabOptions(newCount: number): Array<{ value: CommunityTab; label: string; badge?: number; accessibilityLabel?: string }> {
  return COMMUNITY_TABS.map((tab) =>
    tab.value === "activity" && newCount > 0
      ? { ...tab, badge: newCount, accessibilityLabel: `${tab.label}, ${newCount} new` }
      : { ...tab },
  );
}

/** A feed with nothing in it is a dead end on the tab it would otherwise
 *  open on, so an empty Activity opens on Discover instead. */
export function defaultCommunityTab(activityItemCount: number): CommunityTab {
  return activityItemCount === 0 ? "discover" : "activity";
}

export function parseCommunityTab(value: string | undefined): CommunityTab | undefined {
  return COMMUNITY_TABS.find((tab) => tab.value === value)?.value;
}

export function shouldMarkSeen(tab: CommunityTab, activityItemCount: number, loadFailed: boolean): boolean {
  return tab === "activity" && activityItemCount > 0 && !loadFailed;
}
```

Run: `cd mobile && node --import tsx --test src/features/home/communityTabs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Turn the screen into CommunityScreen**

In `mobile/src/features/home/CommunityScreen.tsx`:
- Replace the `homeTabs` import with:

  ```ts
  import { communityTabOptions, defaultCommunityTab, shouldMarkSeen, type CommunityTab } from "./communityTabs";
  ```

- Rename the component and its prop:

  ```tsx
  export function CommunityScreen({ initialTab }: { initialTab?: CommunityTab }) {
  ```

- Change `useState<HomeTab>` to `useState<CommunityTab>`.
- Replace the seen effect (today: "if not marked and `dashboard.data` →
  mark") with the version below. It has to be declared after `items` is
  computed, so move it below the `items` and `newCount` lines.

  ```tsx
  useEffect(() => {
    if (!markedRef.current && shouldMarkSeen(tab, items.length, dashboard.isError)) {
      markedRef.current = true;
      void markDashboardSeen().catch(() => {});
    }
  }, [tab, items.length, dashboard.isError]);
  ```

- In the tab-initialising effect, change `setTab(defaultHomeTab(items.length))`
  to `setTab(defaultCommunityTab(items.length))`.
- Change the header title from `"Activity"` to `"Community"`.
- Change `accessibilityLabel="Activity sections"` to
  `accessibilityLabel="Community sections"`.
- Change `options={homeTabOptions(newCount)}` to
  `options={communityTabOptions(newCount)}`.

- [ ] **Step 6: Point the route at it**

Replace the whole of `mobile/src/app/(app)/(home)/community.tsx` with:

```tsx
import { useLocalSearchParams } from "expo-router";
import { CommunityScreen } from "@/features/home/CommunityScreen";
import { parseCommunityTab } from "@/features/home/communityTabs";

export default function CommunityRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <CommunityScreen initialTab={parseCommunityTab(tab)} />;
}
```

- [ ] **Step 7: Add the Home header button, and repoint Home's links**

In `mobile/src/features/home/HomeScreen.tsx`:
- Add `IconButton` to the existing `from "../../ui"` import.
- Add `headerRight` to the `Stack.Screen` options, beside `headerLeft`:

  ```tsx
            headerRight: () => (
              <IconButton framed name="community" label="Community" accessibilityLabel="Community" onPress={() => router.push("/community" as never)} />
            ),
  ```

- Change `router.push("/activity" as never)` to
  `router.push("/community?tab=activity" as never)`.
- Change `router.push("/activity?tab=people" as never)` to
  `router.push("/community?tab=people" as never)`.

- [ ] **Step 8: Run the checks**

Run: `npm run typecheck --workspace mobile` and `npm test --workspace mobile`.

Expected: both exit 0 and the mobile test count is 133. `homeTabs.test.ts` had
2 tests; `communityTabs.test.ts` has 5. Then run
`grep -rn 'ActivityScreen\|homeTabs\|"/activity' mobile/src`. Expected: no
matches. The profile activity API path `/community/profiles/…/activity` in
`community/api.ts` is unrelated; the leading quote in the pattern excludes
it.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add -A mobile/src/features/home "mobile/src/app/(app)/(home)"
/usr/bin/git commit -m "Rename Activity to Community, open it from the Home header, and mark it seen only on the Activity tab"
```

The commit body should say why the seen rule changed: opening on Discover or
People used to clear Home's new-activity count without the rows ever being
shown.

---

### Task 5: Web: public Discover at /arena, and Load more

**Files:**
- Modify: `frontend/src/lib/landing.ts`
- Test: `frontend/scripts/test-landing.mts`
- Modify: `frontend/src/hooks/useCommunity.ts:25-28` (`useCommunityDiscover`)
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Modify: `frontend/src/App.tsx:50`

**Interfaces:**
- Consumes: `fetchDiscover(type, q, offset)` from
  `frontend/src/api/community.ts`, which is unchanged: `apiFetch` only sends a
  token when there's a session. Also `useAuth()` from
  `frontend/src/auth/AuthContext` (`{ session }`).
- Produces:
  - `discoverDestination(session: Session | null): string | null`
  - `useCommunityDiscover(type, q)`, which now also returns `hasNextPage`,
    `isFetchingNextPage` and `fetchNextPage`
  - `PublicDiscoverPage()`, exported from `DiscoverPage.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/scripts/test-landing.mts`, change the import to:

```ts
import { discoverDestination, landingDestination, modeFromSearch } from "../src/lib/landing.ts";
```

and add:

```ts
test("a session takes /arena to the signed-in Discover; a stranger browses the public one", () => {
  const session = { user: { id: "reader", email: "reader@example.com", username: "reader", avatarId: null }, accessToken: "access", refreshToken: "refresh" };
  assert.equal(discoverDestination(session), "/community/discover");
  assert.equal(discoverDestination(null), null);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx tsx --test scripts/test-landing.mts`
Expected: FAIL, because `discoverDestination` isn't exported.

- [ ] **Step 3: Implement the destination**

In `frontend/src/lib/landing.ts`, add:

```ts
export function discoverDestination(session: Session | null): string | null {
  return session ? "/community/discover" : null;
}
```

Run: `cd frontend && npx tsx --test scripts/test-landing.mts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Paginate the Discover hook**

In `frontend/src/hooks/useCommunity.ts`, replace `useCommunityDiscover` with:

```ts
export function useCommunityDiscover(type: DiscoverType, q: string) {
  const query = useInfiniteQuery({
    queryKey: ["community", "discover", type, q],
    queryFn: ({ pageParam }) => fetchDiscover(type, q, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    retry: false
  });
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage
  };
}
```

- [ ] **Step 5: Add "Load more" and the public page**

In `frontend/src/pages/DiscoverPage.tsx`:
- Change the router import to `import { Link, Navigate } from "react-router-dom";`.
- Add `import { useAuth } from "../auth/AuthContext";` and
  `import { discoverDestination } from "../lib/landing";`.
- In `DiscoverPane`, destructure the new fields:

  ```ts
  const { items, isLoading, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useCommunityDiscover(type, search.trim());
  ```

- After the `</ul>` block, still inside the `items.length > 0` branch's
  fragment, add the Load more button. Wrap the `<ul>` and the button in
  `<>…</>`.

  ```tsx
          {hasNextPage && (
            <button
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="mt-3 w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm text-(--color-text-dim) hover:border-(--color-accent) disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
  ```

- Add the public page after `DiscoverPage`:

  ```tsx
  export function PublicDiscoverPage() {
    const { session } = useAuth();
    const destination = discoverDestination(session);
    if (destination) return <Navigate to={destination} replace />;
    return (
      <div className="min-h-screen bg-(--color-bg) text-(--color-text)">
        <div className="mx-auto max-w-3xl p-6">
          <header className="mb-6 flex items-center justify-between gap-3">
            <h1 className="text-lg font-bold">Discover</h1>
            <Link to="/login" className="text-sm text-(--color-accent) hover:underline">
              Sign in
            </Link>
          </header>
          <DiscoverPane />
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 6: Route `/arena` to it**

In `frontend/src/App.tsx`:
- Replace
  `<Route path="/arena" element={<Navigate to="/community/discover" replace />} />`
  with `<Route path="/arena" element={<PublicDiscoverPage />} />`.
- Add `PublicDiscoverPage` to the existing import from `./pages/DiscoverPage`.
- If `Navigate` is now unused in `App.tsx`, remove it from the import. Lint
  will say.

- [ ] **Step 7: Run the checks**

Run: `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend`
and `npm test --workspace frontend`.
Expected: all exit 0, with 75 web tests.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add frontend/src/lib/landing.ts frontend/scripts/test-landing.mts frontend/src/hooks/useCommunity.ts frontend/src/pages/DiscoverPage.tsx frontend/src/App.tsx
/usr/bin/git commit -m "Show guests a public Discover at /arena and page Discover with Load more"
```

The commit body should say why: `/arena` redirected guests into a signed-in
route, so a public tournament page's back link ended at the sign-in wall.

---

### Task 6: Device pass (mobile), short and time-boxed

Only if the emulator is free. This pass renders; it doesn't change code.

- [ ] **Step 1:** Run `node scripts/dev-status.mjs --json` once. If another
  worktree holds the emulator, stop and report "device occupied". Don't wait,
  retry, take the lease or start a second emulator.
  - An `emulator-5554` with no lease holder is adopted by `dev-emulator.mjs`.
    That is not "a second emulator", and the load warning doesn't block it.
- [ ] **Step 2:** Run `node scripts/dev-emulator.mjs` from the worktree root.
  It claims this worktree's port slot and boots the seeded dev account.
- [ ] **Step 3:** Check each of these, and zoom into the screenshot for every
  label you check (uiautomator reports text that Android draws clipped):
  1. The Home header shows the framed **Community** button. Tapping it opens
     **Community**, with tabs **Activity · Discover · People**.
  2. Games → **Browse** opens **Discover**. Scroll down, then press Back:
     you're on Games at the scroll position you left.
  3. In Discover, a tournament row's **See books** opens the books sheet, and
     the tournament screen does *not* open. Tapping a book opens "Add to
     library". Close it without adding.
  4. Home's "All activity" or "Find readers" link opens Community on the
     matching tab.
  5. Signed in: Games → **Browse** → tap an author's name in a Discover row.
     Report exactly what appears. In particular, does a second tab bar or a
     Home screen appear under the profile? Then report what each Back press
     returns to, until you're back on Games.
- [ ] **Step 4:** Change app state only through the app's UI. Never write to
  `backend/data/*` or sqlite. Undo any test change through the UI, and report
  anything you couldn't undo.
- [ ] **Step 5:** Run `npm run dev:release` to release the slot and the
  lease, then report pass or fail per check, with screenshot paths.

---

### Task 7: Keep signed-in Discover inside the Games tab

Added after the Task 6 device pass. From the root-stack `/arena`, tapping an
author pushed a second copy of the tab shell: Home was highlighted, there was
no header back arrow, and two Back presses were needed to reach Games.

**Files:**
- Modify: `mobile/src/features/community/DiscoverPane.tsx`, adding an optional
  `linkAuthors` prop
- Modify: `mobile/src/features/community/DiscoverScreen.tsx`, adding an
  `inTabs` prop
- Modify: `mobile/src/app/arena/index.tsx`
- Create: `mobile/src/app/(app)/(arena)/discover.tsx`
- Modify: `mobile/src/app/(app)/(arena)/_layout.tsx`, anchoring `my-arena`
- Modify: `mobile/src/features/arena/ArenaHomeScreen.tsx:83`, so Browse pushes
  `/discover`
- Move: `mobile/src/app/(app)/(home)/u/[username].tsx` →
  `mobile/src/app/(app)/(home,arena,library)/u/[username].tsx`

**Interfaces:**
- Produces:
  - `DiscoverPane({ linkAuthors = true }: { linkAuthors?: boolean })`
  - `DiscoverScreen({ inTabs }: { inTabs: boolean })`
  - the in-tab route `/discover`
  - the shared profile route `/u/[username]` in the Home, Games and Library stacks

- [ ] **Step 1: Let the pane show author names as plain text**

In `DiscoverPane.tsx`:
- Change the signature to
  `export function DiscoverPane({ linkAuthors = true }: { linkAuthors?: boolean }) {`.
- Pass the prop to each row:
  `renderItem={({ item }) => <DiscoverRow item={item} onPreviewBooks={setPreview} linkAuthor={linkAuthors} />}`.
- Change `DiscoverRow`'s signature to
  `function DiscoverRow({ item, onPreviewBooks, linkAuthor }: { item: DiscoverItem; onPreviewBooks: (tournament: { id: string; name: string }) => void; linkAuthor: boolean }) {`.
- Change the author condition from `{author.unavailable ? (` to
  `{author.unavailable || !linkAuthor ? (`. The existing plain-text branch
  (name plus `ReaderGlyph`, no `Pressable`) then renders.

- [ ] **Step 2: One screen, two placements**

Replace the whole of `DiscoverScreen.tsx` with:

```tsx
import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { DiscoverPane } from "./DiscoverPane";

export function DiscoverScreen({ inTabs }: { inTabs: boolean }) {
  return (
    <Screen bottom={!inTabs} top={false}>
      <Stack.Screen options={{ headerShown: true, title: "Discover" }} />
      <DiscoverPane linkAuthors={inTabs} />
    </Screen>
  );
}
```

Replace the whole of `mobile/src/app/arena/index.tsx` with:

```tsx
import { DiscoverScreen } from "../../features/community/DiscoverScreen";

export default function ArenaPublicRoute() {
  return <DiscoverScreen inTabs={false} />;
}
```

Create `mobile/src/app/(app)/(arena)/discover.tsx`:

```tsx
import { DiscoverScreen } from "@/features/community/DiscoverScreen";

export default function DiscoverRoute() {
  return <DiscoverScreen inTabs />;
}
```

- [ ] **Step 3: Keep My Games as the Games tab's first screen**

Undeclared routes are sorted, so `discover` would come before `my-arena` and
become the tab's default. That's the trap the Library stack's comments
describe. Replace the whole of `mobile/src/app/(app)/(arena)/_layout.tsx`
with:

```tsx
import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "my-arena",
};

export default function ArenaStackLayout() {
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="my-arena" />
    </Stack>
  );
}
```

- [ ] **Step 4: Browse pushes the in-tab Discover, and profiles open in either tab**

- In `ArenaHomeScreen.tsx:83`, change `router.push("/arena" as never)` to
  `router.push("/discover" as never)`.
- Move the profile route so the Home, Games and Library stacks share it. Library is included because My shelf's Activity tab pushes `/u/<name>` from the Library stack:

  ```bash
  mkdir -p "mobile/src/app/(app)/(home,arena,library)/u"
  /usr/bin/git mv "mobile/src/app/(app)/(home)/u/[username].tsx" "mobile/src/app/(app)/(home,arena,library)/u/[username].tsx"
  ```

  Remove the now-empty `(home)/u` directory if it's left behind.

- [ ] **Step 5: Run the checks**

Run: `npm run typecheck --workspace mobile` and `npm test --workspace mobile`.
Expected: both exit 0, with 133 tests.

Then run `find "mobile/src/app" -path "*u/\[username\].tsx"`. Expected: only
`mobile/src/app/(app)/(home,arena,library)/u/[username].tsx`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add -A mobile/src
/usr/bin/git commit -m "Keep Browse's Discover and the profiles it opens inside the Games tab"
```

The commit body should say why. Pushing a profile from the root-stack
`/arena` stacked a second tab shell with no back arrow. `/arena` stays the
public and link entry, with author names as plain text.

---

### Task 8: Device recheck (mobile), short

The same rules as Task 6: the lease check first, UI-only state changes, zoom
into labels, time-boxed, and `npm run dev:release` at the end. Check:

1. Tapping the Games tab opens **My Games**, not Discover.
2. Games → **Browse** opens **Discover**. The Games tab stays highlighted and
   the header has a back arrow.
3. In that Discover, tap an author's name. The profile opens with the Games
   tab still highlighted and a back arrow. Back returns to Discover, and Back
   again returns to Games.
4. Home header **Community** → the **Discover** tab → an author's name opens
   the profile in the Home tab. Back returns to Community.
5. Open `/arena` directly by deep link, per `docs/dev-workflow.md`'s
   "Driving the app". Discover shows, and author names are plain text, not
   tappable.

---

## After the tasks

1. Run a whole-branch review and every check listed in Global Constraints.
2. Push the branch and open a PR against `main`.
3. Bind the PR, and report CI.
