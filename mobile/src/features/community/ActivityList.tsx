import type { ReactElement } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { activityText } from "@scripta/shared/community";
import { EmptyState, ErrorState, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { fetchActivity } from "./api";

export function ActivityList({ username, ListHeaderComponent }: { username: string; ListHeaderComponent?: ReactElement }) {
  const { colors } = useTheme();
  const activity = useInfiniteQuery({
    queryKey: ["community", "activity", username],
    queryFn: ({ pageParam }) => fetchActivity(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const items = activity.data?.pages.flatMap((page) => page.items) ?? [];

  if (activity.isPending)
    return (
      <View style={styles.body}>
        {ListHeaderComponent}
        <Skeleton height={120} />
      </View>
    );
  if (activity.isError)
    return (
      <View style={styles.body}>
        {ListHeaderComponent}
        <ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void activity.refetch()} />
      </View>
    );

  return (
    <FlatList
      style={styles.grow}
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={activity.isRefetching}
      onRefresh={() => void activity.refetch()}
      onEndReached={() => {
        if (activity.hasNextPage && !activity.isFetchingNextPage) void activity.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={<EmptyState title="No activity yet" body="Publishing and reading will show up here." />}
      ListFooterComponent={activity.isFetchingNextPage ? <Skeleton height={80} /> : null}
      renderItem={({ item }) => {
        const text = activityText(item);
        const row = (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>
              {text.verb} {text.target}
            </Text>
            <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        );
        if (!text.href) return row;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${text.target}`}
            onPress={() => router.push(text.href as never)}
          >
            {row}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  body: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
