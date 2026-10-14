import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../core/api";
import { fetchDashboard, followUser } from "../community/api";

export const DASHBOARD_QUERY_KEY = ["community", "dashboard"] as const;

export function useDashboardFeed() {
  return useInfiniteQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchDashboard(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
}

export function useSkipEmptyPages({ hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage }: { hasNextPage: boolean; isFetchingNextPage: boolean; isFetchNextPageError: boolean; fetchNextPage: () => Promise<unknown> }, rows: number) {
  useEffect(() => {
    if (rows === 0 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [rows, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
}

export function useFollowBack(refetch: () => Promise<unknown>) {
  const queryClient = useQueryClient();
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  // Refetches rather than patching the row in place: the follow lands as an
  // event of its own, so the feed has more to say afterwards than just this
  // row's new state.
  async function followBack(userId: string) {
    setFollowingId(userId);
    try {
      await followUser(userId);
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
      await refetch();
    } catch (reason) {
      setFollowError(reason instanceof ApiError ? reason.message : "Couldn't follow them. Try again.");
    } finally {
      setFollowingId(null);
    }
  }
  return { followingId, followError, followBack };
}

export { FeedRow } from "./HomeFeedRow";
