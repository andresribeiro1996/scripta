import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchSavedContent } from "../api/community";
import { EmptyState } from "../components/EmptyState";
import { FeedCard } from "../components/home/FeedCard";
import { Page } from "../components/page/Page";
import { BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { SAVED_LIST_KEY, useFeedActions } from "../hooks/useFeedActions";

export function SavedPage() {
  const query = useInfiniteQuery({
    queryKey: SAVED_LIST_KEY,
    queryFn: ({ pageParam }) => fetchSavedContent(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: 1
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const actions = useFeedActions(items, { trackSaved: false });
  const { fetchNextPage } = query;
  const skipping = items.length === 0 && query.hasNextPage && !query.isError;

  useEffect(() => {
    if (items.length === 0 && query.hasNextPage && !query.isFetchingNextPage && !query.isError) void fetchNextPage();
  }, [items.length, query.hasNextPage, query.isFetchingNextPage, query.isError, fetchNextPage]);

  return (
    <Page title="Saved" back={{ to: "/dashboard", label: "Home" }}>
      <div className="mt-8">
        {items.length > 0 ? <div className="flex flex-col gap-4">{items.map((item) => <FeedCard key={`${item.kind}:${item.id}`} item={item} actions={actions} books={[]} works={undefined} isSaved />)}</div> : null}
        {query.isPending || skipping ? <p role="status">Loading saved items…</p> : null}
        {query.isError ? (
          <div role="alert" className="space-y-3">
            <p>Couldn't load saved items.</p>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void (query.isFetchNextPageError ? fetchNextPage() : query.refetch())}>Retry</button>
          </div>
        ) : null}
        {!query.isPending && !query.isError && items.length === 0 && !query.hasNextPage ? (
          <EmptyState title="Nothing saved yet" body="Bookmark a game or mural to find it here." />
        ) : null}
        {items.length > 0 && query.hasNextPage ? (
          <div className="mt-4 flex justify-center"><button type="button" className={BUTTON_SECONDARY} disabled={query.isFetchingNextPage} onClick={() => void fetchNextPage()}>Load more</button></div>
        ) : null}
      </div>
    </Page>
  );
}
