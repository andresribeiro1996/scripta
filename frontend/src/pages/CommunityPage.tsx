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
              {item.author.unavailable ? <span className="mt-2 text-xs text-(--color-text-dim)">{item.author.username}</span> : <Link to={`/community/u/${item.author.username}`} className="mt-2 inline-flex items-center gap-1.5 text-xs text-(--color-text-dim) hover:text-(--color-accent)">
                <AuthorAvatar author={item.author} />
                {item.author.username}
              </Link>}
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
            {item.actor.unavailable ? <span className="mb-1 text-xs text-(--color-text-dim)">{feedHeading(item)}</span> : <Link to={`/community/u/${item.actor.username}`} className="mb-1 flex items-center gap-1.5 text-xs text-(--color-text-dim) hover:text-(--color-accent)">
              <AuthorAvatar author={item.actor} />
              {feedHeading(item)}
            </Link>}
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
