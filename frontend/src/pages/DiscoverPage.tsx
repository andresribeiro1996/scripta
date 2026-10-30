import { useState } from "react";
import { Navigate } from "react-router-dom";
import type { DiscoverType } from "@scripta/shared/community";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { DiscoverTicket } from "../components/games/DiscoverTicket";
import { CommunityIcon } from "../components/NavIcons";
import { Page } from "../components/page/Page";
import { SkeletonCardGrid } from "../components/Skeleton";
import { useCommunityDiscover } from "../hooks/useCommunity";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { area } from "../lib/areas";
import { discoverDestination } from "../lib/landing";
import { BUTTON_SECONDARY, chipClass, FIELD_CLASS } from "../components/page/buttonClasses";
import { SearchIcon, ToolbarRow } from "../components/Toolbar";

const DISCOVER_FILTERS: Array<{ value: DiscoverType; label: string }> = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" },
  { value: "quiz", label: "Quizzes" }
];

function retryButton(refetch: () => void) {
  return (
    <button onClick={() => void refetch()} className={BUTTON_SECONDARY}>
      Retry
    </button>
  );
}

export function DiscoverPage() {
  return (
    <Page width="wide" title="Community" tabs={area("community").tabs}>
      <DiscoverPane />
    </Page>
  );
}

export function PublicDiscoverPage() {
  const { session } = useAuth();
  const destination = discoverDestination(session);
  if (destination) return <Navigate to={destination} replace />;
  return (
    <Page width="wide" title="Games">
      <DiscoverPane />
    </Page>
  );
}

function DiscoverPane() {
  const [type, setType] = useState<DiscoverType>("all");
  const [search, setSearch] = useState("");
  const needle = useDebouncedValue(search.trim(), 300);
  const { items, isLoading, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError, isRefetchError, isRefetching } = useCommunityDiscover(type, needle);

  return (
    <div>
      <ToolbarRow>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative min-w-0 flex-1 sm:w-85 sm:flex-none">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--color-text-dim)">
              <SearchIcon />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tier lists, tournaments and quizzes"
              aria-label="Search tier lists, tournaments and quizzes by name or book"
              className={`${FIELD_CLASS} w-full pl-10`}
            />
          </div>
          <div role="group" aria-label="Type" className="-mx-4 -my-1 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:my-0 sm:w-auto sm:overflow-visible sm:p-0">
            {DISCOVER_FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={type === f.value} onClick={() => setType(f.value)} className={chipClass(type === f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </ToolbarRow>
      {isLoading && <SkeletonCardGrid count={4} label="Loading published games" tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}
      {!isLoading && error && items.length === 0 && <EmptyState title="Couldn't load published games." action={retryButton(refetch)} />}
      {!isLoading && !error && items.length === 0 && (
        needle ? (
          <EmptyState icon={CommunityIcon} title={`No games match “${needle}”.`} body="Try another name or book." />
        ) : (
          <EmptyState icon={CommunityIcon} title="Nothing published yet." body="Published tier lists, tournaments and quizzes show up here." />
        )
      )}
      {!isLoading && items.length > 0 && (
        <>
          {isRefetchError && !isRefetching && (
            <p role="alert" className="mb-3 text-sm text-(--color-danger)">
              Couldn't refresh Discover.
            </p>
          )}
          <ul className={`game-ticket-grid ${type === "quiz" ? "auto-rows-fr" : ""}`}>
            {items.map((item) => (
              <DiscoverTicket key={`${item.content.kind}:${item.content.id}`} item={item} />
            ))}
          </ul>
          {isFetchNextPageError && !isFetchingNextPage && (
            <p role="alert" className="mt-3 text-sm text-(--color-danger)">
              Couldn't load more.
            </p>
          )}
          {hasNextPage && (
            <button
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="mt-3 min-h-11 w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm text-(--color-text-dim) hover:border-(--color-accent) disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
