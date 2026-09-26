import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { ErrorState, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { DiscoverPane } from "../community/DiscoverPane";
import { PeoplePane } from "../community/PeoplePane";
import { markDashboardSeen } from "../community/api";
import { defaultHomeTab, homeTabOptions, type HomeTab } from "./homeTabs";
import { FeedRow, digestRoute, useDashboardFeed, useFollowBack } from "./FeedRow";

export function ActivityScreen({ initialTab }: { initialTab?: HomeTab }) {
  const { colors } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<HomeTab>(initialTab ?? "activity");
  const tabInitedRef = useRef(Boolean(initialTab));
  const markedRef = useRef(false);
  const dashboard = useDashboardFeed();
  useEffect(() => {
    if (!markedRef.current && dashboard.data) {
      markedRef.current = true;
      void markDashboardSeen().catch(() => {});
    }
  }, [dashboard.data]);

  const items = dashboard.data?.pages.flatMap((page) => page.items) ?? [];
  const newCount = dashboard.data?.pages[0]?.newCount ?? 0;

  // Picks the opening tab once real data has arrived, then leaves the user's
  // own tab choice alone — otherwise a later refetch could yank them back to
  // Discover mid-swipe just because Activity happened to be empty on load.
  useEffect(() => {
    if (!tabInitedRef.current && dashboard.data) {
      tabInitedRef.current = true;
      setTab(defaultHomeTab(items.length));
    }
  }, [dashboard.data, items.length]);

  const { followingId, followError, followBack } = useFollowBack(dashboard.refetch);

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Activity",
          headerShown: true,
        }}
      />
      {dashboard.isPending ? (
        <View style={styles.page}>
          <ActivityIndicator accessibilityLabel="Loading activity" />
        </View>
      ) : dashboard.isError ? (
        <View style={styles.page}>
          <ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void dashboard.refetch()} />
        </View>
      ) : (
        <View style={styles.grow}>
          {followError ? <Toast visible message={followError} tone="error" /> : null}
          <SwipeableTabs
            accessibilityLabel="Activity sections"
            options={homeTabOptions(newCount)}
            value={tab}
            onChange={setTab}
            renderPage={(value) => {
              if (value === "discover") return <DiscoverPane />;
              if (value === "people") return <PeoplePane />;
              return (
                <FlatList
                  data={items}
                  keyExtractor={(item) => `${item.kind}:${item.id}`}
                  contentContainerStyle={styles.list}
                  keyboardShouldPersistTaps="handled"
                  refreshing={dashboard.isRefetching}
                  onRefresh={() => void dashboard.refetch()}
                  onEndReached={() => {
                    if (dashboard.hasNextPage && !dashboard.isFetchingNextPage) void dashboard.fetchNextPage();
                  }}
                  onEndReachedThreshold={0.4}
                  ListFooterComponent={dashboard.isFetchingNextPage ? <Skeleton height={80} /> : null}
                  ListEmptyComponent={
                    <Text {...dynamicType} style={[typography.caption, styles.emptyFeed, { color: colors.textDim }]}>
                      Nothing here yet. Follow people to see what they publish.
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <FeedRow
                      item={item}
                      onOpen={() => router.push(digestRoute(item) as never)}
                      onFollowBack={() => void followBack(item.actor.userId)}
                      following={followingId === item.actor.userId}
                    />
                  )}
                />
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
  list: { paddingBottom: spacing.huge, flexGrow: 1 },
  emptyFeed: { padding: spacing.lg },
});
