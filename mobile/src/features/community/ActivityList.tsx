import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { activityDay, activityRow, relativeTime, type ActivityItem } from "@scripta/shared/community";
import { EmptyState, ErrorState, Icon, Skeleton, dynamicType, radii, spacing, typography, useTheme, type IconName } from "../../ui";
import { fetchActivity } from "./api";
import { CoverFan, SLOT_HEIGHT, SLOT_WIDTH } from "./CoverFan";

export function ActivityList({ username }: { username: string }) {
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
        <Skeleton height={120} />
      </View>
    );
  if (activity.isError)
    return (
      <View style={styles.body}>
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
      ListEmptyComponent={<View style={styles.body}><EmptyState title="No activity yet" body="Publishing and reading will show up here." /></View>}
      ListFooterComponent={activity.isFetchingNextPage ? <View style={styles.body}><Skeleton height={80} /></View> : null}
      renderItem={({ item, index }) => {
        const day = activityDay(item.createdAt);
        return <ActivityRowView item={item} day={index === 0 || activityDay(items[index - 1]!.createdAt) !== day ? day : null} />;
      }}
    />
  );
}

function iconFor(item: ActivityItem): IconName {
  switch (item.type) {
    case "tierlist_published":
      return "tierlist";
    case "tournament_published":
      return "arena";
    case "voted_on":
      return "vote";
    case "following":
      return "follow";
    case "mural_published":
      return "murals";
    default:
      return "book";
  }
}

function ActivityRowView({ item, day }: { item: ActivityItem; day: string | null }) {
  const { colors } = useTheme();
  const row = activityRow(item);
  const toneColor = row.tone === "accent" ? colors.accent : row.tone === "success" ? colors.success : colors.textDim;
  const toneFill = row.tone === "accent" ? colors.accentSoft : row.tone === "success" ? colors.successSoft : colors.surface;
  const target = row.href ?? (row.username ? `/u/${row.username}` : null);
  const icon = iconFor(item);

  const content = (pressed: boolean) => (
    <View style={[styles.row, { backgroundColor: pressed ? colors.surfacePressed : "transparent", borderBottomColor: colors.border }]}>
      <View style={styles.slot}>
        {row.covers.length ? (
          <CoverFan covers={row.covers} />
        ) : (
          <View style={[styles.medallion, { backgroundColor: toneFill, borderColor: colors.border }]}>
            <Icon name={icon} size={22} color={toneColor} />
          </View>
        )}
      </View>
      <View style={styles.grow}>
        <View style={styles.labelRow}>
          <Icon name={icon} size={13} color={toneColor} />
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.strong, styles.label, { color: toneColor }]}>
            {row.label}
          </Text>
          <Text {...dynamicType} style={[typography.caption, styles.time, { color: colors.textDim }]}>
            {relativeTime(item.createdAt)}
          </Text>
        </View>
        {row.title ? (
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>
            {row.title}
          </Text>
        ) : null}
        {row.meta ? (
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
            {row.meta}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <>
      {day ? (
        <Text {...dynamicType} style={[typography.caption, styles.strong, styles.day, { color: colors.textDim }]}>
          {day}
        </Text>
      ) : null}
      {target ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`${row.label}: ${row.title}`} onPress={() => router.push(target as never)}>
          {({ pressed }) => content(pressed)}
        </Pressable>
      ) : (
        content(false)
      )}
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  body: { padding: spacing.lg },
  list: { paddingBottom: spacing.huge, flexGrow: 1 },
  day: { textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  slot: { width: SLOT_WIDTH, height: SLOT_HEIGHT, justifyContent: "center" },
  medallion: { marginLeft: 14, width: 48, height: 48, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  label: { flexShrink: 1 },
  time: { flexShrink: 0, marginLeft: "auto" },
});
