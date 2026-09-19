import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchDashboard, markDashboardSeen } from "../api/community";

export function useDashboard() {
  const query = useInfiniteQuery({
    queryKey: ["community", "dashboard"],
    queryFn: ({ pageParam }) => fetchDashboard(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always"
  });
  const markedRef = useRef(false);
  useEffect(() => {
    if (!markedRef.current && query.data) {
      markedRef.current = true;
      void markDashboardSeen().catch(() => {});
    }
  }, [query.data]);
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    newCount: query.data?.pages[0]?.newCount ?? 0,
    isLoading: query.isPending,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch
  };
}
