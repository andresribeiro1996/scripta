import { useState } from "react";
import { Link } from "react-router-dom";
import type { DiscoverType } from "@scripta/shared/community";
import { contentDetail, contentKindLabel, contentTarget } from "@scripta/shared/community";
import { AuthorAvatar } from "../components/CommunityAuthorAvatar";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { SkeletonCardGrid } from "../components/Skeleton";
import { useCommunityDiscover } from "../hooks/useCommunity";

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

function retryButton(refetch: () => void) {
  return (
    <button onClick={() => void refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">
      Retry
    </button>
  );
}

export function DiscoverPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-6 text-lg font-bold">Discover</h2>
      <DiscoverPane />
    </div>
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
