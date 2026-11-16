import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { CIRCLE_DIGEST_KINDS, PERSONAL_DIGEST_KINDS } from "@scripta/shared";
import { AFTER_FOLLOW } from "@scripta/shared/community";
import { ApiError } from "../../core/api";
import { fetchDashboard, followUser } from "../community/api";
import { useT } from "../../i18n";

export const DASHBOARD_QUERY_KEY = ["community", "dashboard"] as const;

export function useDashboardFeed() {
  return useInfiniteQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchDashboard(pageParam, CIRCLE_DIGEST_KINDS),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
}

export const ACTIVITY_QUERY_KEY = ["community", "dashboard", "activity"] as const;

export function useActivityFeed() {
  return useInfiniteQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchDashboard(pageParam, PERSONAL_DIGEST_KINDS),
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

export function useFollowBack() {
  const t = useT();
  const queryClient = useQueryClient();
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  async function followBack(userId: string) {
    setFollowingId(userId);
    try {
      await followUser(userId);
      for (const queryKey of AFTER_FOLLOW) await queryClient.invalidateQueries({ queryKey });
    } catch (reason) {
      setFollowError(reason instanceof ApiError ? reason.message : t("community.followFailed"));
    } finally {
      setFollowingId(null);
    }
  }
  return { followingId, followError, followBack };
}

export { FeedRow } from "./HomeFeedRow";
