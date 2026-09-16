# Community Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Community on mobile — a sixth "Community" tab (Feed / Discover / People), public profile screens with follow + owner publish chrome, and the display-only "Arena" → "Games" rename — against the live backend API from the backend plan.

**Architecture:** A new `(community)` Expo Router tab group beside `(arena)`, backed by a `features/community` module in the established shape: thin `api.ts` over the `core/api` singleton, pure helpers in `communityHome.ts` (node:test-able, like `arenaHome.ts`), React Query with `["community", …]` keys, screens built from the existing `ui` kit (`Screen`, `SwipeableTabs`, `EmptyState`, `ErrorState`, …). Profile mural rendering reuses the proven shared-mural path (`features/public/adapters.ts` + `features/murals` `MuralCanvas`). Owner publish state is derived from the public profile endpoint's 404 (no new backend surface).

**Tech Stack:** Expo Router SDK 57, React Native, TanStack Query v5 (`useInfiniteQuery` for the feed), `@scripta/shared/community` types, node:test + tsx for logic tests.

**Spec:** `docs/superpowers/specs/2026-09-16-community-design.md` — sections "Mobile", "Decisions locked in with the user", and the rename decision. Backend plan: `docs/superpowers/plans/2026-09-16-community-1-backend-shared.md` (executed — the API is live).

## Global Constraints

- Root `AGENTS.md`: minimum code; no speculative options; **no comments in new code**; keep replies/commands exact.
- Mobile `AGENTS.md`: install Expo packages only via `npx expo install` (this plan adds **no dependencies**); never run `eas build`/`eas submit`/`eas update`/`expo prebuild --clean`; use Expo Go / the installed dev client.
- **Rename is display-only**: user-visible strings "Arena"→"Games", "BookArena"→"Games". Routes (`/arena`, `/my-arena`, `/seed/…`), the `(arena)` group, `Icon name="arena"`, feature file names, and query keys stay untouched.
- Run `npm run build --workspace @scripta/shared` before any mobile typecheck/test (consumers read `dist/`).
- Mobile tests are `node:test` files matching `src/**/*.test.ts` — auto-discovered, no manifest edit needed (unlike backend).
- Typed-route pushes use the repo's `router.push("…" as never)` cast convention.
- Emulator is leased: typecheck + tests with no device first; one emulator verification pass at the very end (Task 5) via `node scripts/dev-emulator.mjs` + `npm run dev:tunnels`. Never kill another worktree's processes; check `npm run dev:status` first.
- Feature screens import the UI kit relatively (`../../ui`); route files use `@/` and are thin wrappers.

## File Structure

```
mobile/src/features/community/
  api.ts               # thin apiClient wrappers over /community/*
  communityHome.ts     # pure helpers: tabs, filters, detail lines, targets (tested)
  communityHome.test.ts
  CommunityScreen.tsx  # Feed / Discover / People tab screen
  ProfileScreen.tsx    # public profile + owner publish chrome
mobile/src/app/(app)/
  _layout.tsx                    # + (community) Tabs.Screen; "Arena"→"Games" (modify)
  (community)/_layout.tsx        # Stack, mirrors (arena)
  (community)/index.tsx          # → CommunityScreen
  (community)/u/[username].tsx   # → ProfileScreen
mobile/src/ui/icon.tsx           # + community/profile glyphs (modify)
mobile/src/features/arena/       # display-string renames only (modify)
```

---

### Task 1: "Games" rename — display strings only

**Files:**
- Modify: `mobile/src/app/(app)/_layout.tsx` (tab title)
- Modify: `mobile/src/features/arena/ArenaHomeScreen.tsx` (header title + accessibility labels)
- Modify: `mobile/src/features/arena/ArenaPublicListScreen.tsx` (header title)
- Modify: `mobile/src/features/arena/arenaHome.ts` (only if `emptyCopy` or labels contain user-visible "Arena" strings — check first)

**Interfaces:**
- Produces: nothing programmatic — the new "Community" tab (Task 3) and screens land against a renamed shell.

- [ ] **Step 1: Rename the strings**

In `(app)/_layout.tsx` (~line 59): `title: "Arena"` → `title: "Games"`.

In `ArenaHomeScreen.tsx`: `title: "Arena"` → `title: "Games"`; `accessibilityLabel="Arena section"` → `"Games section"`; `accessibilityLabel="Browse public arena"` → `"Browse games"`.

In `ArenaPublicListScreen.tsx`: `title: "BookArena"` → `title: "Games"`.

Grep the arena feature for other user-visible occurrences (`rg -n "Arena|BookArena" mobile/src/features/arena/`) and rename only DISPLAY strings (copy, labels, titles) — never identifiers, route paths, query keys, or the icon name. `arenaHome.ts`'s `emptyCopy` may mention "tournament"/"tier list" only; if it says "Arena" anywhere user-visible, rename it too.

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: clean; all tests pass (no behavior changed).

- [ ] **Step 3: Commit**

```bash
git add mobile/src/app/(app)/_layout.tsx mobile/src/features/arena
git commit -m "feat(mobile): rename Arena branding to Games — display strings only"
```

---

### Task 2: community feature — api wrappers + tested pure helpers

**Files:**
- Create: `mobile/src/features/community/api.ts`
- Create: `mobile/src/features/community/communityHome.ts`
- Create: `mobile/src/features/community/communityHome.test.ts`

**Interfaces:**
- Consumes: `apiClient` from `core/api` (auth via `{ auth: true }`, anonymous by omission — mirror `features/tierlists/api.ts`'s `fetchPublicTierlists`); `ApiError` from `core/api` (has `.status`); types from `@scripta/shared/community`: `DiscoverItem`, `DiscoverType`, `FeedItem`, `Page`, `PersonResult`, `PublishedProfile`, `TierlistSummary`, `TournamentSummary`; `PublicBookData`/`PublicHighlight` types from `../public/api`; `ResolvedTierlist` type from `@scripta/shared`.
- Produces: the 8 API functions Task 3/4 call — `fetchFeed(cursor?)`, `fetchDiscover(type, q, offset?)`, `searchPeople(q)`, `fetchProfile(username)`, `followUser(userId)`, `unfollowUser(userId)`, `publishProfile(muralId)`, `unpublishProfile()`; `CommunityProfileView` (mobile-side response type); helpers `COMMUNITY_TABS`, `DISCOVER_FILTERS`, `contentKindLabel`, `contentDetail`, `contentTarget`, `feedHeading`, `feedTarget`.

- [ ] **Step 1: Write the failing helper tests**

```ts
// mobile/src/features/community/communityHome.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiscoverItem, FeedItem } from "@scripta/shared/community";
import {
  COMMUNITY_TABS,
  DISCOVER_FILTERS,
  contentDetail,
  contentKindLabel,
  contentTarget,
  feedHeading,
  feedTarget,
} from "./communityHome.js";

const tierlist = {
  kind: "tierlist",
  id: "t1",
  voteCode: "code12ab",
  name: "Top fantasy",
  poolSize: 12,
  ballotCount: 4,
  votingOpen: true,
} as const;

const tournament = {
  kind: "tournament",
  id: "g1",
  name: "Autumn cup",
  bracketSize: 8,
  status: "active",
  bookCount: 8,
} as const;

const actor = { userId: "u1", username: "andre", avatarUrl: null };

test("tab and filter option tables", () => {
  assert.deepEqual(COMMUNITY_TABS.map((t) => t.value), ["feed", "discover", "people"]);
  assert.deepEqual(DISCOVER_FILTERS.map((f) => f.value), ["all", "tierlist", "tournament"]);
});

test("content labels and detail lines", () => {
  assert.equal(contentKindLabel(tierlist), "Tier list");
  assert.equal(contentKindLabel(tournament), "Tournament");
  assert.equal(contentDetail(tierlist), "12 books · 4 ballots");
  assert.equal(contentDetail({ ...tierlist, votingOpen: false }), "12 books · 4 ballots · closed");
  assert.equal(contentDetail(tournament), "8-book bracket · active");
});

test("content targets route by kind", () => {
  assert.equal(contentTarget(tierlist), "/vote/code12ab");
  assert.equal(contentTarget(tournament), "/arena/g1");
  const feedItem: FeedItem = {
    id: "e1",
    actor,
    type: "tierlist_published",
    content: tierlist,
    createdAt: "2026-09-10T00:00:00.000Z",
  };
  assert.equal(feedTarget(feedItem), "/vote/code12ab");
  assert.equal(feedHeading(feedItem), "andre published a tier list");
  assert.equal(
    feedHeading({ ...feedItem, content: tournament, type: "tournament_published" }),
    "andre published a tournament"
  );
});
```

Run: `cd mobile && npx tsx --test src/features/community/communityHome.test.ts`
Expected: FAIL — `./communityHome.js` missing.

- [ ] **Step 2: Write `communityHome.ts`**

```ts
import type { DiscoverItem, FeedItem } from "@scripta/shared/community";

export const COMMUNITY_TABS = [
  { value: "feed", label: "Feed" },
  { value: "discover", label: "Discover" },
  { value: "people", label: "People" },
] as const;

export type CommunityTab = (typeof COMMUNITY_TABS)[number]["value"];

export const DISCOVER_FILTERS = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" },
] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];

type Content = DiscoverItem["content"];

export function contentKindLabel(content: Content): string {
  return content.kind === "tierlist" ? "Tier list" : "Tournament";
}

export function contentDetail(content: Content): string {
  if (content.kind === "tierlist") {
    return `${content.poolSize} books · ${content.ballotCount} ballots${content.votingOpen ? "" : " · closed"}`;
  }
  return `${content.bracketSize}-book bracket · ${content.status}`;
}

export function contentTarget(content: Content): string {
  return content.kind === "tierlist" ? `/vote/${content.voteCode}` : `/arena/${content.id}`;
}

export function feedTarget(item: FeedItem): string {
  return contentTarget(item.content);
}

export function feedHeading(item: FeedItem): string {
  const noun = item.content.kind === "tierlist" ? "tier list" : "tournament";
  return `${item.actor.username} published a ${noun}`;
}
```

Re-run the test: PASS (4 tests).

- [ ] **Step 3: Write `api.ts`**

Read `mobile/src/features/public/api.ts` first and align the `stats`/`shelfTheme`/`tierlists` field types below with that file's shared-mural response types (they must satisfy `MuralCanvas`'s props the same way `fetchSharedMural`'s response does).

```ts
import type {
  DiscoverItem,
  DiscoverType,
  FeedItem,
  Page,
  PersonResult,
  PublishedProfile,
  ResolvedTierlist,
  TierlistSummary,
  TournamentSummary,
} from "@scripta/shared/community";
import type { MuralBlock } from "@scripta/shared";
import { apiClient } from "../../core/api";
import type { PublicBookData, PublicHighlight } from "../public/api";

export interface CommunityProfileView {
  profile: PublishedProfile;
  mural: {
    mural: { id: string; name: string; blocks: MuralBlock[]; coverImageUrl: string | null };
    library: {
      books: PublicBookData[];
      highlights: PublicHighlight[];
      currentlyReading: PublicBookData[];
      stats: Record<string, number | null>;
      shelfTheme: Record<string, unknown> | null;
    };
    imageUrls: Record<string, string | null>;
    tierlists: Record<string, ResolvedTierlist>;
  } | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
}

export type CommunityPage<T> = Page<T>;

export async function fetchFeed(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiClient.request<Page<FeedItem>>(`/community/feed${query}`, { auth: true });
}

export async function fetchDiscover(type: DiscoverType, q: string, offset = 0) {
  const params = new URLSearchParams({ type, q, offset: String(offset) });
  return apiClient.request<{ items: DiscoverItem[]; nextOffset: number | null }>(`/community/discover?${params}`);
}

export async function searchPeople(q: string) {
  return apiClient.request<{ people: PersonResult[] }>(`/community/people?q=${encodeURIComponent(q)}`, { auth: true });
}

export async function fetchProfile(username: string) {
  return apiClient.request<CommunityProfileView>(`/community/profiles/${encodeURIComponent(username)}`, { auth: true });
}

export function followUser(userId: string) {
  return apiClient.request("/community/follows", { method: "POST", body: { userId }, auth: true });
}

export function unfollowUser(userId: string) {
  return apiClient.request(`/community/follows/${userId}`, { method: "DELETE", auth: true });
}

export function publishProfile(muralId: string) {
  return apiClient.request("/community/profile/publish", { method: "PUT", body: { muralId }, auth: true });
}

export function unpublishProfile() {
  return apiClient.request("/community/profile/publish", { method: "DELETE", auth: true });
}
```

Adjust `import type { MuralBlock }` source if `@scripta/shared`'s murals domain is imported differently elsewhere in mobile (check `features/public/adapters.ts` / `SharedMuralScreen.tsx` for the established import shape — `Mural`/`MuralBlock` come from `@scripta/shared` root there).

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: clean; all tests pass (24 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/community
git commit -m "feat(mobile): community api wrappers and tested list helpers"
```

---

### Task 3: Community tab — screen, icon, wiring

**Files:**
- Modify: `mobile/src/ui/icon.tsx` (+2 glyphs)
- Modify: `mobile/src/app/(app)/_layout.tsx` (+1 Tabs.Screen)
- Create: `mobile/src/app/(app)/(community)/_layout.tsx`
- Create: `mobile/src/app/(app)/(community)/index.tsx`
- Create: `mobile/src/features/community/CommunityScreen.tsx`

**Interfaces:**
- Consumes: Task 2's api + helpers; `useAuth()` (`user.id`, `user.username` — non-null inside the authed shell); `useQueryClient`; `Screen`, `SwipeableTabs`, `Input`, `EmptyState`, `ErrorState`, `Skeleton`, `Toast`, `IconButton`, `dynamicType`, `radii`, `spacing`, `typography`, `useTheme` from `../../ui` (mirror `ArenaHomeScreen.tsx`'s import list); `Image` from `expo-image`.
- Produces: route `/community` (tab), push targets `/community/u/<username>` (Task 4 renders them).

- [ ] **Step 1: Add the glyphs**

In `mobile/src/ui/icon.tsx`, add to `GLYPHS` (after the `arena` entry) and to `FILLED` (community becomes a tab and needs the selected variant):

```tsx
  community: { ios: "person.3", android: "group" },
```

```tsx
  community: { ios: "person.3.fill", android: "group" },
```

Also add a non-tab glyph for the "My profile" header button (GLYPHS only, no FILLED entry):

```tsx
  profile: { ios: "person.circle", android: "account_circle" },
```

`IconName` derives from the registry — no type edits.

- [ ] **Step 2: Wire the tab and route files**

In `(app)/_layout.tsx`, after the `(arena)` Tabs.Screen line, add:

```tsx
      <Tabs.Screen name="(community)" options={{ title: "Community", tabBarIcon: ({ color, focused, size }) => <Icon name="community" filled={focused} color={color} size={size} /> }} />
```

```tsx
// mobile/src/app/(app)/(community)/_layout.tsx
import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export default function CommunityStackLayout() {
  return <Stack screenOptions={useScreenOptions()} />;
}
```

```tsx
// mobile/src/app/(app)/(community)/index.tsx
import { CommunityScreen } from "@/features/community/CommunityScreen";

export default function CommunityPage() {
  return <CommunityScreen />;
}
```

- [ ] **Step 3: Write `CommunityScreen.tsx`**

```tsx
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Button, EmptyState, ErrorState, IconButton, Input, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import type { DiscoverItem, PersonResult } from "@scripta/shared/community";
import { fetchDiscover, fetchFeed, followUser, searchPeople, unfollowUser } from "./api";
import {
  COMMUNITY_TABS,
  DISCOVER_FILTERS,
  contentDetail,
  contentKindLabel,
  contentTarget,
  feedHeading,
  feedTarget,
  type CommunityTab,
  type DiscoverFilter,
} from "./communityHome";

export function CommunityScreen() {
  const [tab, setTab] = useState<CommunityTab>("feed");
  const { user } = useAuth();

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Community",
          headerLargeTitleEnabled: false,
          headerRight: () => (
            <IconButton
              accessibilityLabel="My profile"
              name="profile"
              onPress={() => router.push(`/community/u/${user!.username}` as never)}
            />
          ),
        }}
      />
      <SwipeableTabs
        accessibilityLabel="Community section"
        options={COMMUNITY_TABS}
        value={tab}
        onChange={setTab}
        renderPage={(pageTab) => {
          if (pageTab === "feed") return <FeedPane />;
          if (pageTab === "discover") return <DiscoverPane />;
          return <PeoplePane />;
        }}
      />
    </Screen>
  );
}

function AuthorAvatar({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
  const { colors } = useTheme();
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} contentFit="cover" style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[typography.caption, { color: colors.accent }]}>
        {username.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

function openProfile(username: string) {
  router.push(`/community/u/${username}` as never);
}

function FeedPane() {
  const { colors } = useTheme();
  const feed = useInfiniteQuery({
    queryKey: ["community", "feed"],
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  if (feed.isPending) return <View style={styles.page}><Skeleton height={120} /></View>;
  if (feed.isError)
    return <View style={styles.page}><ErrorState body="Couldn't load the feed." actionLabel="Retry" onAction={() => void feed.refetch()} /></View>;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={feed.isRefetching}
      onRefresh={() => void feed.refetch()}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={
        <EmptyState title="Nothing here yet" body="Follow people from Discover or People to see what they publish." />
      }
      ListFooterComponent={feed.isFetchingNextPage ? <Skeleton height={80} /> : null}
      renderItem={({ item }) => (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.actor.username}'s profile`}
            onPress={() => openProfile(item.actor.username)}
            style={styles.actorRow}
          >
            <AuthorAvatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} />
            <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
              {feedHeading(item)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${item.content.name}`}
            onPress={() => router.push(feedTarget(item) as never)}
          >
            <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
              {item.content.name}
            </Text>
            <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
              {contentDetail(item.content)}
            </Text>
          </Pressable>
        </View>
      )}
    />
  );
}

function DiscoverPane() {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<DiscoverFilter>("all");
  const [search, setSearch] = useState("");
  const needle = search.trim();
  const discover = useQuery({
    queryKey: ["community", "discover", filter, needle],
    queryFn: () => fetchDiscover(filter, needle),
    retry: false,
  });
  const items = discover.data?.items ?? [];

  if (discover.isPending) return <View style={styles.page}><Skeleton height={160} /></View>;
  if (discover.isError)
    return <View style={styles.page}><ErrorState body="Couldn't load published games." actionLabel="Retry" onAction={() => void discover.refetch()} /></View>;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => `${item.content.kind}:${item.content.id}`}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      refreshing={discover.isRefetching}
      onRefresh={() => void discover.refetch()}
      ListHeaderComponent={
        <View style={styles.headerGap}>
          <Input
            label="Search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search published games"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          <View style={styles.chips}>
            {DISCOVER_FILTERS.map((option) => {
              const selected = filter === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(option.value)}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
                >
                  <Text {...dynamicType} style={[typography.caption, { color: selected ? colors.accent : colors.textDim }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      }
      ListEmptyComponent={<EmptyState title="Nothing published yet" body="Check back later for new tier lists and tournaments." />}
      renderItem={({ item }) => <DiscoverCard item={item} />}
    />
  );
}

function DiscoverCard({ item }: { item: DiscoverItem }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${item.content.name}`}
        onPress={() => router.push(contentTarget(item.content) as never)}
        style={styles.grow}
      >
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>
          {contentKindLabel(item.content)}
        </Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
          {item.content.name}
        </Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
          {contentDetail(item.content)}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.author.username}'s profile`}
        onPress={() => openProfile(item.author.username)}
        style={styles.actorRow}
      >
        <AuthorAvatar username={item.author.username} avatarUrl={item.author.avatarUrl} />
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
          {item.author.username}
        </Text>
      </Pressable>
    </View>
  );
}

function PeoplePane() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needle = query.trim();
  const people = useQuery({
    queryKey: ["community", "people", needle],
    queryFn: () => searchPeople(needle),
    enabled: needle.length > 0,
    retry: false,
  });
  const results = people.data?.people ?? [];

  async function toggle(person: PersonResult) {
    setBusyId(person.user.userId);
    setError(null);
    try {
      if (person.viewerFollows) {
        await unfollowUser(person.user.userId);
      } else {
        await followUser(person.user.userId);
      }
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
    } catch {
      setError("Couldn't update who you follow.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.page}>
      {error ? <Toast visible message={error} tone="error" /> : null}
      <FlatList
        data={results}
        keyExtractor={(item) => item.user.userId}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <Input
            label="Search people"
            value={query}
            onChangeText={setQuery}
            placeholder="Search by username"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        }
        ListEmptyComponent={
          needle.length > 0 && !people.isPending ? (
            <EmptyState title="No people found" body="Try another username." />
          ) : (
            <EmptyState title="Find people" body="Search a username to follow them." />
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.user.username}'s profile`}
              onPress={() => openProfile(item.user.username)}
              style={[styles.actorRow, styles.grow]}
            >
              <AuthorAvatar username={item.user.username} avatarUrl={item.user.avatarUrl} />
              <View style={styles.grow}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>
                  {item.user.username}
                </Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  {item.followerCount} {item.followerCount === 1 ? "follower" : "followers"}
                </Text>
              </View>
            </Pressable>
            <Button
              label={item.viewerFollows ? "Following" : "Follow"}
              variant={item.viewerFollows ? "secondary" : "primary"}
              loading={busyId === item.user.userId}
              onPress={() => void toggle(item)}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  page: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 28, height: 28, borderRadius: radii.full },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  headerGap: { gap: spacing.sm, marginBottom: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
```

Match the exact `Button` prop names against `mobile/src/ui/components.tsx` before finalizing (`label`/`variant`/`loading`/`onPress` per ArenaHomeScreen's usage; if `variant` values differ — e.g. `"secondary"` vs `"outline"` — use the real ones).

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/ui/icon.tsx "mobile/src/app/(app)" mobile/src/features/community
git commit -m "feat(mobile): community tab with feed, discover, and people"
```

---

### Task 4: Profile screen — follow, mural body, published lists, owner chrome

**Files:**
- Create: `mobile/src/app/(app)/(community)/u/[username].tsx`
- Create: `mobile/src/features/community/ProfileScreen.tsx`

**Interfaces:**
- Consumes: Task 2 api (`fetchProfile`, `followUser`, `unfollowUser`, `publishProfile`, `unpublishProfile`, `CommunityProfileView`); `useAuth()` for self-detection; `useMurals()` (`mobile/src/features/murals/useMurals.ts`) for the mural picker; `reconstructBooks`/`reconstructTierlists` from `../public/adapters`; `MuralCanvas` from `../murals` (mobile, used exactly as `SharedMuralScreen.tsx` uses it); `Dialog`, `Button` from ui; `ApiError` from `core/api` for the 404-as-unpublished rule.
- Produces: route `/community/u/[username]` — the target every author chip in Task 3 pushes.

- [ ] **Step 1: Write the route file**

```tsx
// mobile/src/app/(app)/(community)/u/[username].tsx
import { useLocalSearchParams } from "expo-router";
import { ProfileScreen } from "@/features/community/ProfileScreen";

export default function CommunityProfileRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return <ProfileScreen username={username} />;
}
```

- [ ] **Step 2: Write `ProfileScreen.tsx`**

Owner rules baked in: when the profile is **self** and published → owner chrome (Switch mural / Unpublish) instead of Follow; when the profile is **self and unpublished** (the route 404s) → "Publish profile" empty state with the mural picker dialog; when **another user and unpublished** → plain "not published" empty state.

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { Mural, MuralBlock } from "@scripta/shared";
import { ensureBookBlockHeights } from "@scripta/shared";
import { ApiError } from "../../core/api";
import { useAuth } from "../../core/auth";
import { Button, Dialog, EmptyState, ErrorState, Screen, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { MuralCanvas } from "../murals";
import { MURALS_QUERY_KEY, useMurals } from "../murals/useMurals";
import { reconstructBooks, reconstructTierlists } from "../public/adapters";
import type { GalleryImage } from "../gallery/api";
import { fetchProfile, followUser, publishProfile, unfollowProfile, unfollowUser } from "./api";
import { contentDetail, contentKindLabel, contentTarget } from "./communityHome";

export function ProfileScreen({ username }: { username: string }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ["community", "profile", username],
    queryFn: () => fetchProfile(username),
    enabled: Boolean(username),
    retry: false,
  });

  const isUnpublished = profile.error instanceof ApiError && profile.error.status === 404;
  const view = profile.data;
  const isSelf = view?.profile.user.userId === user?.id;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFollow() {
    if (!view) return;
    await run(async () => {
      if (view.profile.viewerFollows) await unfollowUser(view.profile.user.userId);
      else await followUser(view.profile.user.userId);
    });
  }

  if (profile.isPending) return <Centered><Skeleton height={180} /></Centered>;

  if (profile.isError) {
    if (isUnpublished && isSelf) {
      return (
        <Centered>
          <Stack.Screen options={{ headerShown: true, title: "My profile" }} />
          <EmptyState title="Your profile isn't published" body="Publish one of your murals to appear in the community." />
          <Button label="Publish profile" loading={busy} onPress={() => setPickerOpen(true)} />
          {error ? <ToastLikeError message={error} /> : null}
          <MuralPicker
            visible={pickerOpen}
            busy={busy}
            onClose={() => setPickerOpen(false)}
            onPick={(muralId) => run(async () => {
              await publishProfile(muralId);
              setPickerOpen(false);
            })}
          />
        </Centered>
      );
    }
    if (isUnpublished) {
      return (
        <Centered>
          <Stack.Screen options={{ headerShown: true, title: username }} />
          <EmptyState title="Not published" body="This reader hasn't published a profile." />
        </Centered>
      );
    }
    return (
      <Centered>
        <ErrorState title="Profile unavailable" body="Couldn't load this profile." actionLabel="Retry" onAction={() => void profile.refetch()} />
      </Centered>
    );
  }

  const muralData = view!.mural;
  const books = useMemo(() => (muralData ? reconstructBooks(muralData.library.books, muralData.library.currentlyReading, muralData.library.highlights) : []), [muralData]);
  const images = useMemo<GalleryImage[]>(() => (muralData ? Object.entries(muralData.imageUrls).filter((entry): entry is [string, string] => entry[1] !== null).map(([id, url]) => ({ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" })) : []), [muralData]);
  const tierlists = useMemo(() => reconstructTierlists(muralData?.tierlists ?? {}), [muralData]);
  const mural: Mural | null = muralData
    ? {
        id: muralData.mural.id,
        name: muralData.mural.name,
        blocks: ensureBookBlockHeights(muralData.mural.blocks as MuralBlock[]),
        createdAt: "",
        updatedAt: "",
        coverImageUrl: muralData.mural.coverImageUrl ?? undefined,
        shareToken: null,
        shareUrl: null,
        folderId: null,
      }
    : null;

  return (
    <Screen bottom>
      <Stack.Screen options={{ headerShown: true, title: view!.profile.user.username }} />
      {error ? <ToastLikeError message={error} /> : null}
      <FlatList
        data={publishedRows(view!)}
        keyExtractor={(row) => `${row.kind}:${row.id}`}
        contentContainerStyle={styles.list}
        refreshing={profile.isRefetching}
        onRefresh={() => void profile.refetch()}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.identityRow}>
              {view!.profile.user.avatarUrl ? (
                <Image source={{ uri: view!.profile.user.avatarUrl }} contentFit="cover" style={styles.bigAvatar} />
              ) : (
                <View style={[styles.bigAvatar, styles.avatarFallback, { backgroundColor: colors.accentSoft }]}>
                  <Text {...dynamicType} style={[typography.title, { color: colors.accent }]}>
                    {view!.profile.user.username.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.grow}>
                <Text {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
                  {view!.profile.user.username}
                </Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  {view!.profile.followerCount} {view!.profile.followerCount === 1 ? "follower" : "followers"} · {view!.profile.followingCount} following
                </Text>
              </View>
            </View>
            {isSelf ? (
              <View style={styles.ownerRow}>
                <Button label="Switch mural" variant="secondary" loading={busy} onPress={() => setPickerOpen(true)} />
                <Button label="Unpublish" variant="destructive" loading={busy} onPress={() => setConfirmingUnpublish(true)} />
              </View>
            ) : (
              <Button
                label={view!.profile.viewerFollows ? "Following" : "Follow"}
                variant={view!.profile.viewerFollows ? "secondary" : "primary"}
                loading={busy}
                onPress={() => void toggleFollow()}
              />
            )}
            {mural && mural.blocks.length > 0 ? (
              <MuralCanvas
                mural={mural}
                books={books}
                images={images}
                tierlists={tierlists}
                shelfThemeOverride={muralData!.library.shelfTheme}
                statsOverride={muralData!.library.stats}
              />
            ) : null}
            <Text {...dynamicType} style={[typography.title, styles.strong, styles.sectionTitle, { color: colors.text }]}>
              Published
            </Text>
          </View>
        }
        ListEmptyComponent={<EmptyState title="Nothing published yet" body="Tier lists and tournaments show up here." />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${item.name}`}
            onPress={() => (item as { target?: string }).target as unknown as never}
          >
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>
                {item.kind === "tierlist" ? "Tier list" : "Tournament"}
              </Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
                {item.name}
              </Text>
              <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                {item.detail}
              </Text>
            </View>
          </Pressable>
        )}
      />
      <MuralPicker
        visible={pickerOpen}
        busy={busy}
        onClose={() => setPickerOpen(false)}
        onPick={(muralId) => run(async () => {
          await publishProfile(muralId);
          setPickerOpen(false);
        })}
      />
      <Dialog visible={confirmingUnpublish} title="Unpublish your profile?" onClose={() => setConfirmingUnpublish(false)}>
        <View style={styles.dialogGap}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
            Your page disappears and people stop finding you in search. You can publish again any time.
          </Text>
          <Button label="Unpublish" variant="destructive" loading={busy} onPress={() => run(async () => {
            await unpublishProfile();
            setConfirmingUnpublish(false);
          })} />
        </View>
      </Dialog>
    </Screen>
  );
}

type PublishedRow = { kind: "tierlist" | "tournament"; id: string; name: string; detail: string; target: string };

function publishedRows(view: NonNullable<ReturnType<typeof fetchProfile>>): PublishedRow[] {
  const rows: PublishedRow[] = [];
  for (const item of view.published.tierlists) {
    rows.push({ kind: "tierlist", id: item.id, name: item.name, detail: contentDetail(item), target: contentTarget(item) });
  }
  for (const item of view.published.tournaments) {
    rows.push({ kind: "tournament", id: item.id, name: item.name, detail: contentDetail(item), target: contentTarget(item) });
  }
  return rows;
}

function Centered({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.centered, { backgroundColor: colors.background }]}>{children}</View>;
}

function ToastLikeError({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <Text {...dynamicType} style={[typography.caption, styles.errorText, { color: colors.danger ?? colors.accent }]}>
      {message}
    </Text>
  );
}

function MuralPicker({
  visible,
  busy,
  onClose,
  onPick,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onPick: (muralId: string) => void;
}) {
  const { colors } = useTheme();
  const murals = useMurals();
  const [selected, setSelected] = useState<string | null>(null);
  const items = murals.data ?? [];
  return (
    <Dialog visible={visible} title="Publish profile" onClose={onClose}>
      <View style={styles.dialogGap}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
          Pick the mural that becomes your public page.
        </Text>
        {murals.isPending ? (
          <Skeleton height={120} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={styles.pickerList}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selected === item.id }}
                onPress={() => setSelected(item.id)}
                style={[styles.pickerRow, { borderColor: colors.border, backgroundColor: selected === item.id ? colors.accentSoft : colors.surface }]}
              >
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        )}
        <Button
          label="Publish"
          disabled={!selected}
          loading={busy}
          onPress={() => selected && onPick(selected)}
        />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  centered: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  identityRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  bigAvatar: { width: 64, height: 64, borderRadius: radii.full },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  ownerRow: { flexDirection: "row", gap: spacing.sm },
  sectionTitle: { marginTop: spacing.md },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  dialogGap: { gap: spacing.md },
  pickerList: { maxHeight: 240, flexGrow: 0 },
  pickerRow: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
  errorText: { textAlign: "center" },
});
```

Executor notes (adapt, don't invent behavior):
- `unpublishProfile` import: the api function is named `unpublishProfile` — make sure no name clash with a local; adjust the import list to the real names from Task 2 (`fetchProfile, followUser, publishProfile, unfollowUser, unpublishProfile`).
- Check `mobile/src/ui` for the real `Button` `variant` values and `Dialog` props (title/onClose children) against existing usages (ArenaHomeScreen's delete dialog); use the real names.
- Check whether `colors.danger` exists in the theme; if not, use the theme's existing error/destructive color token.
- If `React.ReactNode` needs an import, `import type { ReactNode } from "react"` and use `ReactNode`.
- The `useMemo` calls must not sit after a conditional return — if hooks-order errors arise, hoist all `useMemo`s above the early returns (they all null-guard `muralData` already).
- `publishedRows`' parameter type: use the exported `CommunityProfileView` from `./api` instead of the `ReturnType<typeof fetchProfile>` trick — cleaner: `view: CommunityProfileView`.
- The renderItem's odd cast exists because `target` rides on the row; simpler: put `router.push(item.target as never)` directly (import `router` from `expo-router`) and drop the cast gymnastics.

- [ ] **Step 3: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: clean; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add "mobile/src/app/(app)/(community)" mobile/src/features/community
git commit -m "feat(mobile): community profile screen with follow and owner publish chrome"
```

---

### Task 5: Full verify + one emulator verification pass

**Files:** none created — verification only.

- [ ] **Step 1: Headless verification**

Run:
```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace mobile
npm test --workspace mobile
cd mobile && npx expo-doctor
```
Expected: all green, no expo-doctor issues that this change introduced.

- [ ] **Step 2: Emulator lease + render pass** (per root `AGENTS.md` — this change renders new UI, so one lease is justified)

Check `npm run dev:status` first. Then, following `scripts/` README conventions:
```bash
node scripts/dev-emulator.mjs        # lease this worktree's emulator slot
npm run dev --workspace backend      # backend for the app to talk to
npm run dev:tunnels                  # this worktree's adb reverse tunnels
npm run mobile                       # Expo on the emulator
```
On the emulator: sign in, open the **Community** tab (Feed / Discover / People panes swipe), open any author chip → profile renders header + mural + Published lists, follow/unfollow toggles, "My profile" → own profile; verify the **Games** tab label. Capture `adb exec-out screencap -p` screenshots as evidence. Do NOT run `adb root`.

- [ ] **Step 3: Release the lease and report**

Stop what you started (keep other worktrees' processes alone), run `npm run dev:status` to confirm a clean slot state, and report: what rendered, what (if anything) misbehaved, screenshots' paths.

No commit — this task only reports.
