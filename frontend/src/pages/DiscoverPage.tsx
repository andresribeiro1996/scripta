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
import { BUTTON_SECONDARY, chipClass } from "../components/page/buttonClasses";
import { SCROLL_FADE } from "../components/page/surfaceClasses";
import { SearchField, ToolbarRow } from "../components/Toolbar";
import { useT } from "../i18n";

const DISCOVER_FILTERS = [
  { value: "all", label: "library.filterAll" },
  { value: "tierlist", label: "shell.tabTierLists" },
  { value: "tournament", label: "shell.tabTournaments" },
  { value: "quiz", label: "shell.tabQuizzes" }
] as const satisfies ReadonlyArray<{ value: DiscoverType; label: string }>;

function RetryButton({ refetch }: { refetch: () => void }) {
  const t = useT();
  return (
    <button onClick={() => void refetch()} className={BUTTON_SECONDARY}>
      {t("library.retry")}
    </button>
  );
}

export function DiscoverPage() {
  const t = useT();
  return (
    <Page width="wide" title={t("shell.areaCommunity")} subtitle={t("community.discoverSubtitle")} tabs={area("community").tabs}>
      <DiscoverPane />
    </Page>
  );
}

export function PublicDiscoverPage() {
  const t = useT();
  const { session } = useAuth();
  const destination = discoverDestination(session);
  if (destination) return <Navigate to={destination} replace />;
  return (
    <Page width="wide" title={t("shell.areaGames")} subtitle={t("community.discoverSubtitle")}>
      <DiscoverPane />
    </Page>
  );
}

function DiscoverPane() {
  const t = useT();
  const [type, setType] = useState<DiscoverType>("all");
  const [search, setSearch] = useState("");
  const needle = useDebouncedValue(search.trim(), 300);
  const { items, isLoading, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError, isRefetchError, isRefetching } = useCommunityDiscover(type, needle);

  return (
    <div>
      <ToolbarRow>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t("community.searchGames")}
            label={t("community.searchGamesLabel")}
            className="flex-1 sm:flex-none"
          />
          <div role="group" aria-label={t("community.type")} className={`-mx-4 -my-1 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 py-1 ${SCROLL_FADE} sm:mx-0 sm:my-0 sm:w-auto sm:overflow-visible sm:p-0`}>
            {DISCOVER_FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={type === f.value} onClick={() => setType(f.value)} className={chipClass(type === f.value)}>
                {t(f.label)}
              </button>
            ))}
          </div>
        </div>
      </ToolbarRow>
      {isLoading && <SkeletonCardGrid count={4} label={t("community.loadingGames")} tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}
      {!isLoading && error && items.length === 0 && <EmptyState title={t("community.gamesLoadFailed")} action={<RetryButton refetch={refetch} />} />}
      {!isLoading && !error && items.length === 0 && (
        needle ? (
          <EmptyState icon={CommunityIcon} title={t("community.noGamesMatch", { needle })} body={t("community.noGamesMatchBody")} />
        ) : (
          <EmptyState icon={CommunityIcon} title={t("community.nothingPublished")} body={t("community.nothingPublishedDiscoverBody")} />
        )
      )}
      {!isLoading && items.length > 0 && (
        <>
          {isRefetchError && !isRefetching && (
            <p role="alert" className="mb-3 text-sm text-(--color-danger)">
              {t("community.discoverRefreshFailed")}
            </p>
          )}
          <ul className={`game-ticket-grid ${type === "quiz" ? "auto-rows-fr" : ""}`}>
            {items.map((item) => (
              <DiscoverTicket key={`${item.content.kind}:${item.content.id}`} item={item} />
            ))}
          </ul>
          {isFetchNextPageError && !isFetchingNextPage && (
            <p role="alert" className="mt-3 text-sm text-(--color-danger)">
              {t("community.loadMoreFailed")}
            </p>
          )}
          {hasNextPage && (
            <button
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="mt-3 min-h-11 w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm text-(--color-text-dim) hover:border-(--color-accent) disabled:opacity-50"
            >
              {isFetchingNextPage ? t("library.loadingEllipsis") : t("library.loadMore")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
