import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Stack, useRouter } from "expo-router";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { clearDashboardCounts, isNewDigestItem, type DashboardFeedPage } from "@scripta/shared";
import { ErrorState, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { DiscoverPane } from "../community/DiscoverPane";
import { PeoplePane } from "../community/PeoplePane";
import { markDashboardSeen } from "../community/api";
import { communityTabOptions, defaultCommunityTab, shouldMarkSeen, type CommunityTab } from "./communityTabs";
import { DASHBOARD_QUERY_KEY, FeedRow, useDashboardFeed, useFollowBack, useSkipEmptyPages } from "./FeedRow";
import { digestRoute } from "./feedRowModel";

export function CommunityScreen({ initialTab }: { initialTab?: CommunityTab }) {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const markedRef = useRef(false);
  const dashboard = useDashboardFeed();

  const items = dashboard.data?.pages.flatMap((page) => page.items) ?? [];
  const newCount = dashboard.data?.pages[0]?.personalNewCount ?? 0;
  const seenAt = dashboard.data?.pages[0]?.seenAt ?? null;
  const loaded = dashboard.data !== undefined;
  useSkipEmptyPages(dashboard, items.length);

  // Picks the opening tab once real data has arrived, then leaves the user's
  // own tab choice alone — otherwise a later refetch could yank them back to
  // Discover mid-swipe just because Activity happened to be empty on load.
  const [chosenTab, setChosenTab] = useState<CommunityTab | undefined>(initialTab);
  if (chosenTab === undefined && dashboard.data) setChosenTab(defaultCommunityTab(items.length));
  const tab = chosenTab ?? "activity";

  useEffect(() => {
    if (!markedRef.current && shouldMarkSeen(tab, loaded, dashboard.isError, dashboard.isFetching)) {
      markedRef.current = true;
      void markDashboardSeen().then(
        () => queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(DASHBOARD_QUERY_KEY, (data) => (data ? clearDashboardCounts(data) : data)),
        () => { markedRef.current = false; },
      );
    }
  }, [tab, loaded, dashboard.isError, dashboard.isFetching, queryClient]);

  const { followingId, followError, followBack } = useFollowBack(dashboard.refetch);

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Community",
          headerShown: true,
        }}
      />
      {dashboard.isPending ? (
        <View style={styles.page}>
          <ActivityIndicator accessibilityLabel="Loading activity" />
        </View>
      ) : (
        <View style={styles.grow}>
          {followError ? <Toast visible message={followError} tone="error" /> : null}
          <SwipeableTabs
            accessibilityLabel="Community sections"
            options={communityTabOptions(newCount)}
            value={tab}
            onChange={setChosenTab}
            renderPage={(value) => {
              if (value === "discover") return <DiscoverPane />;
              if (value === "people") return <PeoplePane />;
              if (dashboard.isError && !dashboard.data) {
                return (
                  <View style={styles.page}>
                    <ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void dashboard.refetch()} />
                  </View>
                );
              }
              return (
                <View style={styles.grow}>
                  {dashboard.isRefetchError && !dashboard.isRefetching ? <Toast visible message="Couldn't refresh activity." tone="error" /> : null}
                  <FlatList
                    data={items}
                    keyExtractor={(item) => `${item.kind}:${item.id}`}
                    contentContainerStyle={styles.list}
                    keyboardShouldPersistTaps="handled"
                    refreshing={dashboard.isRefetching}
                    onRefresh={() => void dashboard.refetch()}
                    onEndReached={() => {
                      if (dashboard.hasNextPage && !dashboard.isFetchingNextPage && !dashboard.isFetchNextPageError) void dashboard.fetchNextPage();
                    }}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={
                      dashboard.isFetchingNextPage ? (
                        <Skeleton height={80} />
                      ) : dashboard.isFetchNextPageError ? (
                        <View style={styles.page}>
                          <ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void dashboard.fetchNextPage()} />
                        </View>
                      ) : null
                    }
                    ListEmptyComponent={
                      dashboard.hasNextPage ? null : (
                        <Text {...dynamicType} style={[typography.caption, styles.emptyFeed, { color: colors.textDim }]}>
                          Nothing here yet. Follow people to see what they publish.
                        </Text>
                      )
                    }
                    renderItem={({ item }) => (
                      <FeedRow
                        item={item}
                        onOpen={() => router.push(digestRoute(item) as never)}
                        onFollowBack={() => { if (item.kind === "follow") void followBack(item.actor.userId); }}
                        following={item.kind === "follow" && followingId === item.actor.userId}
                        isNew={isNewDigestItem(item, seenAt)}
                      />
                    )}
                  />
                </View>
              );
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  list: { paddingTop: spacing.lg - spacing.md, paddingBottom: spacing.huge, flexGrow: 1 },
  emptyFeed: { padding: spacing.lg },
});
