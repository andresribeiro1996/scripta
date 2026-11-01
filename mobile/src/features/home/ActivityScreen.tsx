import { useCallback, useEffect, useRef } from "react";
import { FlatList, StyleSheet, View, type ListViewToken } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { clearDashboardCounts, isNewDigestItem, type DashboardFeedPage } from "@scripta/shared";
import { isPersonalItem, shouldMarkFeedSeen } from "@scripta/shared/community";
import { EmptyState, ErrorState, Screen, Skeleton, Toast, spacing } from "../../ui";
import { markDashboardSeen } from "../community/api";
import { useT } from "../../i18n";
import { ActivityRow } from "./ActivityRow";
import { ACTIVITY_QUERY_KEY, useActivityFeed, useFollowBack, useSkipEmptyPages } from "./FeedRow";
import { digestRoute } from "./feedRowModel";

const ACTIVITY_VIEWABILITY = { itemVisiblePercentThreshold: 50 };

export function ActivityScreen() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const feed = useActivityFeed();
  const items = (feed.data?.pages.flatMap((page) => page.items) ?? []).filter(isPersonalItem);
  const seenAt = feed.data?.pages[0]?.seenAt ?? null;
  const { followingId, followError, followBack } = useFollowBack(feed.refetch);
  const seenSent = useRef(false);
  const rowVisible = useRef(false);
  useSkipEmptyPages(feed, items.length);

  useFocusEffect(useCallback(() => {
    seenSent.current = false;
    void feed.refetch();
  }, [feed.refetch]));

  const markSeen = useRef(() => {});
  markSeen.current = () => {
    if (!shouldMarkFeedSeen({ focused, rowVisible: rowVisible.current && items.length > 0, loaded: feed.data !== undefined, failed: feed.isError, fetching: feed.isFetching, sent: seenSent.current })) return;
    seenSent.current = true;
    void markDashboardSeen().then(
      () => queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(ACTIVITY_QUERY_KEY, (data) => data ? clearDashboardCounts(data) : data),
      () => { seenSent.current = false; }
    );
  };
  useEffect(() => { markSeen.current(); }, [focused, feed.data, feed.isError, feed.isFetching]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    rowVisible.current = viewableItems.length > 0;
    markSeen.current();
  }).current;

  const error = followError ?? (feed.isRefetchError && !feed.isRefetching ? t("community.refreshActivityFailed") : null);
  const empty = feed.isPending || (feed.hasNextPage && !feed.isError) ? <Skeleton height={64} /> : feed.isError && !feed.data ? <ErrorState body={t("community.activityLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void feed.refetch()} /> : <EmptyState title={t("community.nothingNewTitle")} body={t("community.nothingNewBody")} />;
  return <Screen top={false}>
    <Stack.Screen options={{ title: t("community.activity"), headerShown: true }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <FlatList data={items} keyExtractor={(item) => `${item.kind}:${item.id}`} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.list}
      renderItem={({ item }) => <ActivityRow item={item} isNew={isNewDigestItem(item, seenAt)} following={item.kind === "follow" && followingId === item.actor.userId} onOpen={() => router.push(digestRoute(item) as never)} onFollowBack={() => { if (item.kind === "follow") void followBack(item.actor.userId); }} />}
      ListEmptyComponent={<View style={styles.state}>{empty}</View>}
      ListFooterComponent={feed.isFetchingNextPage && items.length ? <View style={styles.state}><Skeleton height={64} /></View> : feed.isFetchNextPageError ? <View style={styles.state}><ErrorState body={t("book.loadMoreFailed")} actionLabel={t("shell.retry")} onAction={() => void feed.fetchNextPage()} /></View> : undefined}
      onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) void feed.fetchNextPage(); }} onEndReachedThreshold={0.4}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={ACTIVITY_VIEWABILITY} />
  </Screen>;
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.huge },
  state: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg }
});
