import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchDashboard } from "../api/community";

export const DASHBOARD_QUERY_KEY = ["community", "dashboard"] as const;

export function useDashboard() {
  const query = useInfiniteQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchDashboard(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always"
  });
  const firstPage = query.data?.pages[0];
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    seenAt: firstPage?.seenAt ?? null,
    personalNewCount: firstPage?.personalNewCount ?? 0,
    followingNewCount: firstPage?.followingNewCount ?? 0,
    isLoading: query.isPending,
    error: query.error,
    isFetching: query.isFetching,
    isFetchNextPageError: query.isFetchNextPageError,
    isRefetchError: query.isRefetchError,
    isRefetching: query.isRefetching,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch
  };
}
