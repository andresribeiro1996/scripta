# Community Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Community on web — a "Community" nav entry and `/community` page (Discover / Feed / People), profile pages at `/community/u/:username` with follow + owner publish chrome, the old `/arena` directory redirected into Community Discover, and the display-only "Arena" → "Games" rename.

**Architecture:** Follows the frontend's established shapes: thin `api/community.ts` over `apiFetch`/`publicFetch`, hooks in `hooks/useCommunity.ts` (TanStack Query, `["community", …]` keys, `useInfiniteQuery` for the feed), pages built from existing components (`EmptyState`, `SkeletonCardGrid`, `MuralCanvas`). The mural-rendering reconstruction helpers move out of `SharedMuralPage` into `lib/sharedMural.ts` so the profile page reuses them unchanged. Community list helpers (detail lines, targets, feed headings) move into `@scripta/shared/community` — where the mobile app's copies then point — because both platforms need them (root `AGENTS.md`: shared logic lives in `@scripta/shared`, not duplicated per client).

**Tech Stack:** React 19 + Vite + Tailwind (CSS variables), TanStack Query v5, `@scripta/shared/community` types + helpers, oxlint, frontend test scripts (`scripts/test-*.mts`, tsx --test, auto-globbed).

**Spec:** `docs/superpowers/specs/2026-09-16-community-design.md` — sections "Web" and "Absorption". Backend + mobile plans already executed; the API is live and the mobile app is the reference implementation for payload shapes.

## Global Constraints

- Root `AGENTS.md`: minimum code; no speculative options; no comments in new code.
- Frontend `AGENTS.md`: shared logic goes in `@scripta/shared`, not duplicated; verify with `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend` (oxlint), `npm test --workspace frontend`.
- Run `npm run build --workspace @scripta/shared` before any consumer typecheck/test.
- **Rename is display-only**: user-visible strings "Arena"→"Games", "My Arena"→"My Games", "BookArena" strings die with the deleted directory page. Routes, query keys, identifiers, icon names untouched.
- Frontend tests are `scripts/test-*.mts` (auto-globbed — no manifest edit), importing shared code from `../../packages/shared/dist/...`.
- Authed routes live inside `DashboardLayout` (`RequireUsername`); the community surface is authed-in-app on web in v1, same as mobile.

## File Structure

```
packages/shared/src/community/helpers.ts     # contentKindLabel/contentDetail/contentTarget/feedHeading/feedTarget (create)
packages/shared/src/community/index.ts       # + helpers export (modify)
frontend/scripts/test-community-helpers.mts  # shared-helper tests (create)
mobile/src/features/community/communityHome.ts  # re-export shared helpers (modify)
frontend/src/api/community.ts                # 8 api fns + CommunityProfileView (create)
frontend/src/hooks/useCommunity.ts           # 4 hooks (create)
frontend/src/components/NavIcons.tsx         # + CommunityIcon (modify)
frontend/src/layouts/DashboardLayout.tsx     # "Games" rename + Community nav item (modify)
frontend/src/pages/CommunityPage.tsx         # Discover/Feed/People (create)
frontend/src/pages/CommunityProfilePage.tsx  # profile + owner chrome (create)
frontend/src/lib/sharedMural.ts              # extracted reconstruction helpers (create)
frontend/src/pages/SharedMuralPage.tsx       # use lib/sharedMural (modify)
frontend/src/pages/ArenaListPage.tsx         # display rename (modify)
frontend/src/pages/ArenaPublicListPage.tsx   # DELETE (absorbed)
frontend/src/hooks/usePublicTournaments.ts   # DELETE (sole consumer deleted)
frontend/src/hooks/usePublicTierlists.ts     # DELETE (sole consumer deleted)
frontend/src/api/arena.ts                    # - fetchPublicTournaments (modify)
frontend/src/api/tierlistVoting.ts           # - fetchPublicTierlists (modify)
frontend/src/App.tsx                         # routes: + /community, + profile, /arena redirect (modify)
```

---

### Task 1: Community list helpers → `@scripta/shared`, tested; mobile reuses them

**Files:**
- Create: `packages/shared/src/community/helpers.ts`
- Modify: `packages/shared/src/community/index.ts` (+1 export)
- Create: `frontend/scripts/test-community-helpers.mts`
- Modify: `mobile/src/features/community/communityHome.ts` (re-export)

**Interfaces:**
- Produces (from `@scripta/shared/community`): `contentKindLabel(content: PublishedContent): string`, `contentDetail(content: PublishedContent): string`, `contentTarget(content: PublishedContent): string`, `feedHeading(item: FeedItem): string`, `feedTarget(item: FeedItem): string`.
- Mobile keeps exporting the same names from `communityHome.ts` (re-export), so `CommunityScreen.tsx`/`ProfileScreen.tsx` and `communityHome.test.ts` are untouched.

- [ ] **Step 1: Write the failing frontend test**

```ts
// frontend/scripts/test-community-helpers.mts
// Exercises the community list helpers in @scripta/shared/community — the
// same copy the mobile app re-exports. Run with: npx tsx scripts/test-community-helpers.mts

import type { FeedItem, PublishedContent } from "../../packages/shared/dist/community/index.js";
import { contentDetail, contentKindLabel, contentTarget, feedHeading, feedTarget } from "../../packages/shared/dist/community/index.js";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const tierlist: PublishedContent = {
  kind: "tierlist",
  id: "t1",
  voteCode: "code12ab",
  name: "Top fantasy",
  poolSize: 12,
  ballotCount: 4,
  votingOpen: true
};
const tournament: PublishedContent = {
  kind: "tournament",
  id: "g1",
  name: "Autumn cup",
  bracketSize: 8,
  status: "active",
  bookCount: 8
};
const feedItem: FeedItem = {
  id: "e1",
  actor: { userId: "u1", username: "andre", avatarUrl: null },
  type: "tierlist_published",
  content: tierlist,
  createdAt: "2026-09-10T00:00:00.000Z"
};

check("tier list kind label", contentKindLabel(tierlist) === "Tier list");
check("tournament kind label", contentKindLabel(tournament) === "Tournament");
check("tier list detail", contentDetail(tierlist) === "12 books · 4 ballots");
check("closed tier list detail", contentDetail({ ...tierlist, votingOpen: false }) === "12 books · 4 ballots · closed");
check("tournament detail", contentDetail(tournament) === "8-book bracket · active");
check("tier list target", contentTarget(tierlist) === "/vote/code12ab");
check("tournament target", contentTarget(tournament) === "/arena/g1");
check("feed target follows content", feedTarget(feedItem) === "/vote/code12ab");
check("feed heading", feedHeading(feedItem) === "andre published a tier list");
check(
  "tournament feed heading",
  feedHeading({ ...feedItem, content: tournament, type: "tournament_published" }) === "andre published a tournament"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx tsx scripts/test-community-helpers.mts`
Expected: FAIL — `helpers.js` not exported from the dist.

- [ ] **Step 3: Write the helpers into shared**

```ts
// packages/shared/src/community/helpers.ts
import type { DiscoverItem, FeedItem, PublishedContent } from "./types.js";

export function contentKindLabel(content: PublishedContent): string {
  return content.kind === "tierlist" ? "Tier list" : "Tournament";
}

export function contentDetail(content: PublishedContent): string {
  if (content.kind === "tierlist") {
    return `${content.poolSize} books · ${content.ballotCount} ballots${content.votingOpen ? "" : " · closed"}`;
  }
  return `${content.bracketSize}-book bracket · ${content.status}`;
}

export function contentTarget(content: PublishedContent): string {
  return content.kind === "tierlist" ? `/vote/${content.voteCode}` : `/arena/${content.id}`;
}

export function feedTarget(item: FeedItem): string {
  return contentTarget(item.content);
}

export function feedHeading(item: FeedItem): string {
  const noun = item.content.kind === "tierlist" ? "tier list" : "tournament";
  return `${item.actor.username} published a ${noun}`;
}

export type { DiscoverItem };
```

(The last line exists only because the plan's earlier draft imported `DiscoverItem` — drop it; keep the file to the five functions and the one type import actually used.)

Add to `packages/shared/src/community/index.ts`:

```ts
export * from "./helpers.js";
```

- [ ] **Step 4: Point mobile at the shared copy**

In `mobile/src/features/community/communityHome.ts`, delete the five function implementations (`contentKindLabel`, `contentDetail`, `contentTarget`, `feedTarget`, `feedHeading`) and re-export the shared ones instead, keeping the local tab/filter tables and types:

```ts
import type { DiscoverItem, FeedItem } from "@scripta/shared/community";
import { contentDetail, contentKindLabel, contentTarget, feedHeading, feedTarget } from "@scripta/shared/community";

export { contentDetail, contentKindLabel, contentTarget, feedHeading, feedTarget };

export const COMMUNITY_TABS = [ /* unchanged */ ] as const;
export type CommunityTab = (typeof COMMUNITY_TABS)[number]["value"];

export const DISCOVER_FILTERS = [ /* unchanged */ ] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];
```

Keep the `COMMUNITY_TABS`/`DISCOVER_FILTERS` arrays and their types exactly as they are today (copy them over unchanged). If the `DiscoverItem`/`FeedItem` type imports become unused after the deletion, drop them.

- [ ] **Step 5: Build + verify everything**

Run: `npm run build --workspace @scripta/shared && cd frontend && npx tsx scripts/test-community-helpers.mts && npm run typecheck --workspace frontend && npm test --workspace frontend && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: shared build clean; helper tests 10/10; frontend + mobile typechecks clean; frontend + mobile suites fully green (mobile's `communityHome.test.ts` now exercises the shared implementations through the re-exports).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/community frontend/scripts/test-community-helpers.mts mobile/src/features/community/communityHome.ts
git commit -m "feat(shared): community list helpers, mobile re-exports them"
```

---

### Task 2: "Games" rename — display strings only

**Files:**
- Modify: `frontend/src/layouts/DashboardLayout.tsx` (~line 44)
- Modify: `frontend/src/pages/ArenaListPage.tsx` (~line 89)

**Interfaces:**
- Produces: nothing programmatic; Task 4's Community nav item lands beside the renamed entry.

- [ ] **Step 1: Rename the strings**

`DashboardLayout.tsx` NAV_GROUPS: `label: "Arena"` → `label: "Games"` (keep `description: "Book-bracket tournaments"` — still accurate).

`ArenaListPage.tsx` line 89: `<h2 ...>Arena</h2>` → `<h2 ...>Games</h2>`.

Then run `rg -n "Arena|BookArena|My Arena" frontend/src` and rename ONLY user-visible display strings (headings, copy, labels, aria-labels saying "Arena"). Never touch routes, query keys, identifiers, icon names, file names. The `BookArena` occurrences in `ArenaPublicListPage.tsx` die with that file in Task 4 — leave it.

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/layouts/DashboardLayout.tsx frontend/src/pages/ArenaListPage.tsx
git commit -m "feat(frontend): rename Arena branding to Games — display strings only"
```

---

### Task 3: `api/community.ts` + `hooks/useCommunity.ts`

**Files:**
- Create: `frontend/src/api/community.ts`
- Create: `frontend/src/hooks/useCommunity.ts`

**Interfaces:**
- Consumes: `apiFetch` + `ApiError` from `api/client`; `PublicBookData`/`PublicHighlight`/`ShelfTheme` types (sharedMurals/theme imports — mirror `api/sharedMurals.ts`'s import sources); `ResolvedTierlist`/`MuralBlock` from `@scripta/shared` (same source `api/sharedMurals.ts` uses); shared community types.
- Produces: `fetchFeed(cursor?)`, `fetchDiscover(type, q, offset?)`, `fetchPeople(q)`, `fetchCommunityProfile(username)`, `followUser(userId)`, `unfollowUser(userId)`, `publishProfile(muralId)`, `unpublishProfile()`; `CommunityProfileView`; hooks `useCommunityFeed`, `useCommunityDiscover(type, q)`, `useCommunityPeople(q)`, `useCommunityProfile(username)` (with `isNotFound`).

- [ ] **Step 1: Write `api/community.ts`**

```ts
import type { MuralBlock, ResolvedTierlist } from "@scripta/shared";
import type {
  DiscoverItem,
  DiscoverType,
  FeedItem,
  Page,
  PersonResult,
  PublishedProfile,
  TierlistSummary,
  TournamentSummary
} from "@scripta/shared/community";
import { apiFetch } from "./client";
import type { PublicBookData, PublicHighlight } from "./sharedMurals";
import type { ShelfTheme } from "../lib/libraryStyle";

export interface CommunityProfileView {
  profile: PublishedProfile;
  mural: {
    mural: { id: string; name: string; blocks: MuralBlock[]; coverImageUrl: string | null };
    library: {
      books: PublicBookData[];
      highlights: PublicHighlight[];
      currentlyReading: PublicBookData[];
      stats: Record<string, number>;
      shelfTheme?: ShelfTheme;
    };
    imageUrls: Record<string, string | null>;
    tierlists: Record<string, ResolvedTierlist>;
  } | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
}

export async function fetchFeed(cursor?: string): Promise<Page<FeedItem>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return (await apiFetch(`/community/feed${query}`)) as Page<FeedItem>;
}

export async function fetchDiscover(type: DiscoverType, q: string, offset = 0): Promise<{ items: DiscoverItem[]; nextOffset: number | null }> {
  const params = new URLSearchParams({ type, q, offset: String(offset) });
  return (await apiFetch(`/community/discover?${params}`)) as { items: DiscoverItem[]; nextOffset: number | null };
}

export async function fetchPeople(q: string): Promise<PersonResult[]> {
  const body = (await apiFetch(`/community/people?q=${encodeURIComponent(q)}`)) as { people: PersonResult[] };
  return body.people;
}

export async function fetchCommunityProfile(username: string): Promise<CommunityProfileView> {
  return (await apiFetch(`/community/profiles/${encodeURIComponent(username)}`)) as CommunityProfileView;
}

export async function followUser(userId: string): Promise<void> {
  await apiFetch("/community/follows", { method: "POST", body: JSON.stringify({ userId }) });
}

export async function unfollowUser(userId: string): Promise<void> {
  await apiFetch(`/community/follows/${userId}`, { method: "DELETE" });
}

export async function publishProfile(muralId: string): Promise<void> {
  await apiFetch("/community/profile/publish", { method: "PUT", body: JSON.stringify({ muralId }) });
}

export async function unpublishProfile(): Promise<void> {
  await apiFetch("/community/profile/publish", { method: "DELETE" });
}
```

Import sources to verify before finalizing (mirror `api/sharedMurals.ts` exactly): `MuralBlock`/`ResolvedTierlist` and `ShelfTheme` — check that file's own import lines and use the same modules (`ShelfTheme` may come from `../lib/libraryStyle` or `@scripta/shared` — use whatever `sharedMurals.ts` does for its `shelfTheme` field).

- [ ] **Step 2: Write `hooks/useCommunity.ts`**

```ts
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { fetchCommunityProfile, fetchDiscover, fetchFeed, fetchPeople } from "../api/community";
import type { DiscoverType } from "@scripta/shared/community";

export function useCommunityFeed() {
  const query = useInfiniteQuery({
    queryKey: ["community", "feed"],
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  });
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isPending,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch
  };
}

export function useCommunityDiscover(type: DiscoverType, q: string) {
  const query = useQuery({ queryKey: ["community", "discover", type, q], queryFn: () => fetchDiscover(type, q), retry: false });
  return { items: query.data?.items ?? [], isLoading: query.isPending, error: query.error, refetch: query.refetch };
}

export function useCommunityPeople(q: string) {
  const query = useQuery({ queryKey: ["community", "people", q], queryFn: () => fetchPeople(q), enabled: q.trim().length > 0, retry: false });
  return { people: query.data ?? [], isLoading: query.isPending, error: query.error, refetch: query.refetch };
}

export function useCommunityProfile(username: string) {
  const query = useQuery({ queryKey: ["community", "profile", username], queryFn: () => fetchCommunityProfile(username), enabled: Boolean(username), retry: false });
  return {
    view: query.data,
    isLoading: query.isPending,
    error: query.error,
    isNotFound: query.error instanceof ApiError && query.error.status === 404,
    refetch: query.refetch
  };
}
```

- [ ] **Step 3: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/community.ts frontend/src/hooks/useCommunity.ts
git commit -m "feat(frontend): community api wrappers and query hooks"
```

---

### Task 4: Community page, nav item, route, and `/arena` absorption

**Files:**
- Modify: `frontend/src/components/NavIcons.tsx` (+ `CommunityIcon`)
- Modify: `frontend/src/layouts/DashboardLayout.tsx` (+ nav item, + icon import)
- Create: `frontend/src/pages/CommunityPage.tsx`
- Modify: `frontend/src/App.tsx` (+ route, `/arena` redirect, remove `ArenaPublicListPage`)
- Delete: `frontend/src/pages/ArenaPublicListPage.tsx`, `frontend/src/hooks/usePublicTournaments.ts`, `frontend/src/hooks/usePublicTierlists.ts`
- Modify: `frontend/src/api/arena.ts` (− `fetchPublicTournaments`), `frontend/src/api/tierlistVoting.ts` (− `fetchPublicTierlists`) — both confirmed sole-consumed by the deleted hooks; re-grep before deleting each.

**Interfaces:**
- Consumes: Task 1 helpers, Task 3 api/hooks, `EmptyState` (icon/title/body/action), `SkeletonCardGrid`, `Link`/`useSearchParams` from react-router-dom, `useAuth` not needed here.
- Produces: route `/community?tab=discover|feed|people` (Discover default); push targets `/community/u/:username` (Task 5).

- [ ] **Step 1: Add `CommunityIcon` to `NavIcons.tsx`**

```tsx
export function CommunityIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M16.5 14.6c2.2.2 3.7 1.7 4.2 4" />
    </svg>
  );
}
```

- [ ] **Step 2: Nav item**

In `DashboardLayout.tsx`, add `CommunityIcon` to the existing NavIcons import and insert after the Games entry in the middle group:

```tsx
      { to: "/community", label: "Community", end: false, description: "Follow readers and their published games", icon: CommunityIcon }
```

- [ ] **Step 3: Write `CommunityPage.tsx`**

Segmented control mirrors `ArenaListPage.tsx:95-108`'s inline button group; cards reuse `ArenaPublicListPage`'s card styling; search inputs copy the exact input classes used in `ArenaListPage.tsx:124-127` (mirror, don't invent).

```tsx
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { CommunityAuthor, DiscoverType, PersonResult } from "@scripta/shared/community";
import { contentDetail, contentKindLabel, contentTarget, feedHeading, feedTarget } from "@scripta/shared/community";
import { followUser, unfollowUser } from "../api/community";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { SkeletonCardGrid } from "../components/Skeleton";
import { useCommunityDiscover, useCommunityFeed, useCommunityPeople } from "../hooks/useCommunity";

const TABS = [
  { value: "discover", label: "Discover" },
  { value: "feed", label: "Feed" },
  { value: "people", label: "People" }
] as const;

type CommunityTab = (typeof TABS)[number]["value"];

const DISCOVER_FILTERS: Array<{ value: DiscoverType; label: string }> = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" }
];

const segmented = (active: boolean, first: boolean) =>
  `flex min-h-11 flex-1 items-center justify-center px-3 text-sm font-semibold ${first ? "" : "border-l border-(--color-border)"} ${
    active ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"
  }`;

const searchInput =
  "mb-3 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none focus:border-(--color-accent)";

export function CommunityPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: CommunityTab = TABS.some((t) => t.value === tabParam) ? (tabParam as CommunityTab) : "discover";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-6 hidden text-lg font-bold sm:block">Community</h2>
      <div className="mb-4 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) sm:w-72">
        {TABS.map((t, i) => (
          <button key={t.value} onClick={() => setParams({ tab: t.value })} aria-pressed={tab === t.value} className={segmented(tab === t.value, i === 0)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "discover" && <DiscoverPane />}
      {tab === "feed" && <FeedPane />}
      {tab === "people" && <PeoplePane />}
    </div>
  );
}

function AuthorAvatar({ author, size = 20 }: { author: CommunityAuthor; size?: number }) {
  if (author.avatarUrl) {
    return <img src={author.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-[10px] font-bold text-(--color-accent)"
      style={{ width: size, height: size }}
    >
      {author.username.slice(0, 1).toUpperCase()}
    </span>
  );
}

function retryButton(refetch: () => void) {
  return (
    <button onClick={() => void refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">
      Retry
    </button>
  );
}

function DiscoverPane() {
  const [type, setType] = useState<DiscoverType>("all");
  const [search, setSearch] = useState("");
  const { items, isLoading, error, refetch } = useCommunityDiscover(type, search.trim());

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search published games" aria-label="Search published games by name" className={searchInput} />
      <div className="mb-4 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) sm:w-72">
        {DISCOVER_FILTERS.map((f, i) => (
          <button key={f.value} onClick={() => setType(f.value)} aria-pressed={type === f.value} className={segmented(type === f.value, i === 0)}>
            {f.label}
          </button>
        ))}
      </div>
      {isLoading && <SkeletonCardGrid count={4} label="Loading published games" tileClassName="min-h-[110px]" />}
      {!isLoading && error && <EmptyState title="Couldn't load published games." action={retryButton(refetch)} />}
      {!isLoading && !error && items.length === 0 && (
        <EmptyState icon={CommunityIcon} title="Nothing published yet." body="Published tier lists and tournaments show up here." />
      )}
      {!isLoading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={`${item.content.kind}:${item.content.id}`} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
              <Link to={contentTarget(item.content)} className="block">
                <p className="text-xs font-semibold text-(--color-accent)">{contentKindLabel(item.content)}</p>
                <h3 className="font-semibold">{item.content.name}</h3>
                <p className="text-sm text-(--color-text-dim)">{contentDetail(item.content)}</p>
              </Link>
              <Link to={`/community/u/${item.author.username}`} className="mt-2 inline-flex items-center gap-1.5 text-xs text-(--color-text-dim) hover:text-(--color-accent)">
                <AuthorAvatar author={item.author} />
                {item.author.username}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedPane() {
  const { items, isLoading, error, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useCommunityFeed();

  if (isLoading) return <SkeletonCardGrid count={3} label="Loading feed" tileClassName="min-h-[110px]" />;
  if (error) return <EmptyState title="Couldn't load the feed." action={retryButton(refetch)} />;
  if (items.length === 0) {
    return <EmptyState icon={CommunityIcon} title="Nothing here yet." body="Follow people from Discover or People to see what they publish." />;
  }
  return (
    <div>
      <div className="grid grid-cols-1 gap-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <Link to={`/community/u/${item.actor.username}`} className="mb-1 flex items-center gap-1.5 text-xs text-(--color-text-dim) hover:text-(--color-accent)">
              <AuthorAvatar author={item.actor} />
              {feedHeading(item)}
            </Link>
            <Link to={feedTarget(item)} className="block">
              <h3 className="font-semibold">{item.content.name}</h3>
              <p className="text-sm text-(--color-text-dim)">{contentDetail(item.content)}</p>
            </Link>
          </div>
        ))}
      </div>
      {hasNextPage && (
        <button
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mt-4 w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm text-(--color-text-dim) hover:border-(--color-accent) disabled:opacity-50"
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function PeoplePane() {
  const [search, setSearch] = useState("");
  const needle = search.trim();
  const { people, isLoading, error, refetch } = useCommunityPeople(needle);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(person: PersonResult) {
    setBusyId(person.user.userId);
    try {
      if (person.viewerFollows) await unfollowUser(person.user.userId);
      else await followUser(person.user.userId);
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by username" aria-label="Search people by username" className={searchInput} />
      {needle.length === 0 && <EmptyState icon={CommunityIcon} title="Find people." body="Search a username to follow them." />}
      {needle.length > 0 && isLoading && <SkeletonCardGrid count={2} label="Searching" tileClassName="min-h-[72px]" />}
      {needle.length > 0 && !isLoading && error && <EmptyState title="Couldn't search." action={retryButton(refetch)} />}
      {needle.length > 0 && !isLoading && !error && people.length === 0 && <EmptyState title="No people found." body="Try another username." />}
      {needle.length > 0 && !isLoading && !error && people.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {people.map((person) => (
            <div key={person.user.userId} className="flex items-center justify-between gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
              <Link to={`/community/u/${person.user.username}`} className="flex items-center gap-2">
                <AuthorAvatar author={person.user} size={32} />
                <span>
                  <span className="block text-sm font-semibold">{person.user.username}</span>
                  <span className="block text-xs text-(--color-text-dim)">
                    {person.followerCount} {person.followerCount === 1 ? "follower" : "followers"}
                  </span>
                </span>
              </Link>
              <button
                onClick={() => void toggle(person)}
                disabled={busyId === person.user.userId}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                  person.viewerFollows ? "border-(--color-border) text-(--color-text-dim)" : "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)"
                }`}
              >
                {busyId === person.user.userId ? "…" : person.viewerFollows ? "Following" : "Follow"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Route + redirect + absorption**

In `App.tsx`:
- Import `CommunityPage` (inside the DashboardLayout section); remove the `ArenaPublicListPage` import.
- Inside the `<Route element={<DashboardLayout />}>` group, add:

```tsx
              <Route path="/community" element={<CommunityPage />} />
```

- Replace the public directory route:

```tsx
        <Route path="/arena" element={<ArenaPublicListPage />} />
```

with:

```tsx
        <Route path="/arena" element={<Navigate to="/community?tab=discover" replace />} />
```

- Delete `frontend/src/pages/ArenaPublicListPage.tsx`, `frontend/src/hooks/usePublicTournaments.ts`, `frontend/src/hooks/usePublicTierlists.ts`.
- Re-grep `fetchPublicTournaments` and `fetchPublicTierlists` for remaining consumers — with the hooks gone there should be none — then delete `fetchPublicTournaments` from `api/arena.ts` and `fetchPublicTierlists` from `api/tierlistVoting.ts` (plus any now-unused imports in those files).

- [ ] **Step 5: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: clean; suites green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/NavIcons.tsx frontend/src/layouts/DashboardLayout.tsx frontend/src/pages/CommunityPage.tsx frontend/src/App.tsx frontend/src/api/arena.ts frontend/src/api/tierlistVoting.ts
git rm frontend/src/pages/ArenaPublicListPage.tsx frontend/src/hooks/usePublicTournaments.ts frontend/src/hooks/usePublicTierlists.ts
git commit -m "feat(frontend): community page with discover, feed, and people — /arena directory absorbed"
```

---

### Task 5: Profile page — follow, mural body, published lists, owner chrome

**Files:**
- Create: `frontend/src/lib/sharedMural.ts`
- Modify: `frontend/src/pages/SharedMuralPage.tsx` (use the extracted helpers)
- Create: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/App.tsx` (+ `/community/u/:username` route)

**Interfaces:**
- Consumes: `useCommunityProfile` (+ `isNotFound`), follow/publish api fns, `buildReconstructedBooks`/`toPrivateBook` (extracted), `MuralCanvas` (same props `SharedMuralPage` passes), `useAuth` (`session.user.id`, `session.user.username` — nullable), `useHome` (home mural id as the picker default), `useMurals` (picker options), `ensureBookBlockHeights` from `lib/murals`.
- Produces: route `/community/u/:username`; owner rules identical to mobile — unpublished-self renders the publish flow (picker defaults to the home mural), loaded-self renders Switch mural/Unpublish, other-user renders Follow/Following.

- [ ] **Step 1: Extract the reconstruction helpers**

Create `frontend/src/lib/sharedMural.ts` by MOVING `toPrivateBook` and `buildReconstructedBooks` verbatim out of `SharedMuralPage.tsx` (they are module-local there — keep their bodies byte-identical, add `export`), with the imports that body needs:

```ts
import type { PublicBookData, PublicHighlight } from "../api/sharedMurals";
import { bookKey } from "./merge";

export function toPrivateBook(pub: PublicBookData): Record<string, unknown> {
  /* moved verbatim from SharedMuralPage.tsx */
}

export function buildReconstructedBooks(
  books: PublicBookData[],
  currentlyReading: PublicBookData[],
  highlights: PublicHighlight[]
): Array<Record<string, unknown>> {
  /* moved verbatim from SharedMuralPage.tsx */
}
```

In `SharedMuralPage.tsx`: delete both local functions, add `import { buildReconstructedBooks } from "../lib/sharedMural";` (drop `toPrivateBook` usage there — it's only called via `buildReconstructedBooks`; if the page calls `toPrivateBook` directly anywhere, import it too), and remove now-unused imports (`bookKey` if only the helpers used it).

- [ ] **Step 2: Write `CommunityProfilePage.tsx`**

```tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MuralBlock } from "@scripta/shared";
import { ensureBookBlockHeights, type Mural } from "../lib/murals";
import { contentDetail, contentKindLabel, contentTarget } from "@scripta/shared/community";
import { fetchMurals } from "../api/murals";
import { followUser, publishProfile, unfollowUser, unpublishProfile } from "../api/community";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { SkeletonCardGrid } from "../components/Skeleton";
import type { GalleryImage } from "../api/gallery";
import { useHome } from "../hooks/useHome";
import { useCommunityProfile } from "../hooks/useCommunity";
import { buildReconstructedBooks } from "../lib/sharedMural";

export function CommunityProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { view, isLoading, isNotFound, refetch } = useCommunityProfile(username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwnHandle = Boolean(username) && session?.user.username === username;
  const isSelf = view?.profile.user.userId === session?.user.id;

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

  if (isLoading || (!view && !isNotFound && !error)) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <SkeletonCardGrid count={2} label="Loading profile" tileClassName="min-h-[120px]" />
      </div>
    );
  }

  if (isNotFound) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {isOwnHandle ? (
          <UnpublishedOwnProfile
            busy={busy}
            error={error}
            onPublish={(muralId) => run(async () => void (await publishProfile(muralId)))}
          />
        ) : (
          <EmptyState icon={CommunityIcon} title="Not published." body="This reader hasn't published a profile." />
        )}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState title="Profile unavailable." body="Couldn't load this profile." action={retryButton(refetch)} />
      </div>
    );
  }

  const muralData = view.mural;
  const books = muralData ? buildReconstructedBooks(muralData.library.books, muralData.library.currentlyReading, muralData.library.highlights) : [];
  const images: GalleryImage[] = muralData
    ? Object.entries(muralData.imageUrls)
        .filter((entry): entry is [string, string] => entry[1] !== null)
        .map(([id, url]) => ({ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" }))
    : [];
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
        folderId: null
      }
    : null;
  const publishedRows = [
    ...view.published.tierlists.map((item) => ({ kind: contentKindLabel(item), name: item.name, detail: contentDetail(item), target: contentTarget(item) })),
    ...view.published.tournaments.map((item) => ({ kind: contentKindLabel(item), name: item.name, detail: contentDetail(item), target: contentTarget(item) }))
  ];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {view.profile.user.avatarUrl ? (
            <img src={view.profile.user.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-(--color-accent-soft) text-lg font-bold text-(--color-accent)">
              {view.profile.user.username.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span>
            <span className="block text-lg font-bold">{view.profile.user.username}</span>
            <span className="block text-sm text-(--color-text-dim)">
              {view.profile.followerCount} {view.profile.followerCount === 1 ? "follower" : "followers"} · {view.profile.followingCount} following
            </span>
          </span>
        </div>
        {isSelf ? (
          <OwnerControls
            busy={busy}
            currentMuralId={muralData?.mural.id ?? null}
            onSwitch={(muralId) => run(async () => void (await publishProfile(muralId)))}
            onUnpublish={() => run(async () => void (await unpublishProfile()))}
          />
        ) : (
          <FollowControls
            busy={busy}
            following={view.profile.viewerFollows === true}
            userId={view.profile.user.userId}
            onToggle={(next) =>
              run(async () => {
                if (next === "unfollow") await unfollowUser(view.profile.user.userId);
                else await followUser(view.profile.user.userId);
              })
            }
          />
        )}
      </div>
      {error && <p className="mb-4 text-sm text-(--color-danger, --color-accent)">{error}</p>}
      {mural && mural.blocks.length > 0 && muralData && (
        <div className="mb-8">
          <MuralCanvas
            mural={mural}
            editMode={false}
            books={books}
            images={images}
            profile={view.profile.user}
            shelfThemeOverride={muralData.library.shelfTheme}
            statsOverride={muralData.library.stats}
            tierlistData={(tierlistId) => muralData.tierlists[tierlistId]}
          />
        </div>
      )}
      <h3 className="mb-3 text-lg font-bold">Published</h3>
      {publishedRows.length === 0 ? (
        <EmptyState title="Nothing published yet." body="Tier lists and tournaments show up here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {publishedRows.map((row) => (
            <Link key={`${row.kind}:${row.target}`} to={row.target} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)">
              <p className="text-xs font-semibold text-(--color-accent)">{row.kind}</p>
              <h4 className="font-semibold">{row.name}</h4>
              <p className="text-sm text-(--color-text-dim)">{row.detail}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

Then add the three support components to the same file (concise, existing input/button class vocabulary):

```tsx
function UnpublishedOwnProfile({
  busy,
  error,
  onPublish
}: {
  busy: boolean;
  error: string | null;
  onPublish: (muralId: string) => void;
}) {
  const { data: murals } = useQuery({ queryKey: ["murals"], queryFn: fetchMurals });
  const home = useHome();
  const [muralId, setMuralId] = useState<string>("");
  const effectiveId = muralId || home.home?.id || murals?.[0]?.id || "";
  return (
    <div className="mx-auto max-w-md text-center">
      <EmptyState icon={CommunityIcon} title="Your profile isn't published." body="Publish one of your murals to appear in the community." />
      {error && <p className="mb-3 text-sm text-(--color-danger, --color-accent)">{error}</p>}
      <div className="flex items-center justify-center gap-2">
        <select
          value={effectiveId}
          onChange={(e) => setMuralId(e.target.value)}
          aria-label="Mural to publish"
          className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
        >
          {(murals ?? []).map((mural) => (
            <option key={mural.id} value={mural.id}>
              {mural.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => effectiveId && onPublish(effectiveId)}
          disabled={!effectiveId || busy}
          className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-(--color-onaccent, white) disabled:opacity-50"
        >
          {busy ? "Publishing…" : "Publish profile"}
        </button>
      </div>
    </div>
  );
}

function OwnerControls({
  busy,
  currentMuralId,
  onSwitch,
  onUnpublish
}: {
  busy: boolean;
  currentMuralId: string | null;
  onSwitch: (muralId: string) => void;
  onUnpublish: () => void;
}) {
  const { data: murals } = useQuery({ queryKey: ["murals"], queryFn: fetchMurals });
  const [confirming, setConfirming] = useState(false);
  const [muralId, setMuralId] = useState<string>(currentMuralId ?? "");
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <select
          value={muralId}
          onChange={(e) => setMuralId(e.target.value)}
          aria-label="Profile mural"
          className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
        >
          {(murals ?? []).map((mural) => (
            <option key={mural.id} value={mural.id}>
              {mural.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => muralId && muralId !== currentMuralId && onSwitch(muralId)}
          disabled={busy || !muralId || muralId === currentMuralId}
          className="rounded-lg border border-(--color-border) px-3 py-2 text-sm hover:border-(--color-accent) disabled:opacity-50"
        >
          {busy ? "Working…" : "Switch mural"}
        </button>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--color-text-dim)">Hide your profile?</span>
          <button onClick={onUnpublish} disabled={busy} className="rounded-lg bg-(--color-danger, #b3261e) px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Unpublish
          </button>
          <button onClick={() => setConfirming(false)} className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
          Unpublish profile
        </button>
      )}
    </div>
  );
}

function FollowControls({
  busy,
  following,
  userId,
  onToggle
}: {
  busy: boolean;
  following: boolean;
  userId: string;
  onToggle: (next: "follow" | "unfollow") => void;
}) {
  return (
    <button
      onClick={() => onToggle(following ? "unfollow" : "follow")}
      disabled={busy}
      className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold disabled:opacity-50 ${
        following ? "border-(--color-border) text-(--color-text-dim)" : "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)"
      }`}
    >
      {busy ? "…" : following ? "Following" : "Follow"}
    </button>
  );
}
```

Executor notes (verify against the real code, adapt names only):
- `retryButton` and `CommunityIcon` are used from Task 4's `CommunityPage.tsx` — `retryButton` is module-local THERE, so either duplicate the 6-line helper here or (better) move it into a shared location both pages import; `CommunityIcon` is exported from `components/NavIcons` — import it.
- `useHome()` returns `{ home?... }` — check the real hook's return shape (research shows `useHome()` spreads the query: `data` is the mural or null — use `const { data: homeMural } = useHome()` and default to `homeMural?.id`).
- `--color-danger`/`--color-onaccent` may not exist as CSS vars — check `frontend/src` theme tokens and use the real ones (the fallback syntax `var(--x, y)` in Tailwind arbitrary values compiles, but prefer the real token).
- `type ReactNode`/imports: prune to what compiles; `useQuery` import comes from `@tanstack/react-query`.

- [ ] **Step 3: Route**

In `App.tsx`, inside the `DashboardLayout` group next to `/community`:

```tsx
              <Route path="/community/u/:username" element={<CommunityProfilePage />} />
```

(+ import.)

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: clean; suites green (SharedMuralPage refactor is behavior-preserving — its rendering path is exercised by nothing in the frontend suite, so typecheck + the page compiling is the gate; a manual `/shared/murals/:token` visit in Task 6 covers it).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/sharedMural.ts frontend/src/pages/SharedMuralPage.tsx frontend/src/pages/CommunityProfilePage.tsx frontend/src/App.tsx
git commit -m "feat(frontend): community profile page with follow and owner publish chrome"
```

---

### Task 6: Full verify

**Files:** none — verification only.

- [ ] **Step 1: Everything green**

Run:
```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
npm run typecheck --workspace mobile
npm test --workspace mobile
npm run build --workspace frontend
```
Expected: all green including the full Vite production build (integration gate for the new pages).

- [ ] **Step 2: Manual smoke (report results, screenshots optional)**

With `npm run dev --workspace backend` and `npm run dev --workspace frontend` up: sign in, check the sidebar reads **Games** and **Community**; `/arena` lands on Community Discover; Discover shows published content with author chips; search + filters work; open an author chip → profile (mural + Published + Follow); own profile via People → owner chrome; Feed shows followed users' publishes with a working "Load more" when applicable. Also visit a known `/shared/murals/:token` link to confirm the refactor didn't change it. Report anything that misbehaves.

No commit — this task only reports.
