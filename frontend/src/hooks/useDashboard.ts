import { useInfiniteQuery } from "@tanstack/react-query";
import { CIRCLE_DIGEST_KINDS, PERSONAL_DIGEST_KINDS } from "@scripta/shared";
import { fetchDashboard } from "../api/community";

export function useCircleFeed() {
  const query = useInfiniteQuery({
    queryKey: ["community", "dashboard", "circle"],
    queryFn: ({ pageParam }) => fetchDashboard(pageParam, CIRCLE_DIGEST_KINDS),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: 1
  });
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    refetch: query.refetch
  };
}

export function useActivityFeed() {
  const query = useInfiniteQuery({
    queryKey: ["community", "dashboard", "activity"],
    queryFn: ({ pageParam }) => fetchDashboard(pageParam, PERSONAL_DIGEST_KINDS),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: 1
  });
  const firstPage = query.data?.pages[0];
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    seenAt: firstPage?.seenAt ?? null,
    personalNewCount: firstPage?.personalNewCount ?? 0,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch
  };
}
