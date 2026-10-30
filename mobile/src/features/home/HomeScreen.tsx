import { DailyChapterCard } from "../dailyChapter/daily-chapter-card";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { newCountLabel, type DigestItem } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { BrandMark, EmptyState, ErrorState, HeaderActions, IconButton, Screen, Skeleton, Toast, dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { FeedRow, useActivityFeed, useDashboardFeed, useSkipEmptyPages } from "./FeedRow";
import { digestRoute, feedRowModel } from "./feedRowModel";
import { CommentsSheet } from "./CommentsSheet";
import { SavedContentSheet } from "./SavedContentSheet";
import { RecapHomeCard } from "../topShelf/RecapHomeCard";
import { AwardHomeCard, RECENT_AWARDS_QUERY_KEY } from "../awards/AwardHomeCard";
import { ENGAGEMENT_QUERY_KEY, SAVED_STATE_QUERY_KEY, useHomeActions } from "./useHomeActions";

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pulling, setPulling] = useState(false);
  const [comments, setComments] = useState<DigestItem | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const dashboard = useDashboardFeed();
  const items = dashboard.data?.pages.flatMap((page) => page.items) ?? [];
  const actions = useHomeActions(items);
  const activity = useActivityFeed();
  const activityBadge = newCountLabel(activity.data?.pages[0]?.personalNewCount ?? 0);
  const sections = [{ title: "Your reading circle", data: items }];
  useSkipEmptyPages(dashboard, items.length);

  useFocusEffect(useCallback(() => {
    void actions.library.refetch();
    void dashboard.refetch();
    void activity.refetch();
    void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: SAVED_STATE_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: RECENT_AWARDS_QUERY_KEY });
  }, [actions.library.refetch, dashboard.refetch, activity.refetch, queryClient]));

  async function onRefresh() {
    setPulling(true);
    try { await Promise.all([actions.library.refetch(), dashboard.refetch(), activity.refetch(), queryClient.invalidateQueries({ queryKey: ENGAGEMENT_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: SAVED_STATE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: RECENT_AWARDS_QUERY_KEY })]); }
    finally { setPulling(false); }
  }
  const findReaders = () => router.push("/people" as never);
  const error = actions.error ?? (dashboard.isRefetchError && !dashboard.isRefetching ? "Couldn't refresh activity." : null);
  const empty = dashboard.isPending || (dashboard.hasNextPage && !dashboard.isError && !items.length) ? <Skeleton height={80} /> : dashboard.isError && !dashboard.data ? <ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void dashboard.refetch()} /> : dashboard.hasNextPage ? null : <EmptyState title="Your circle starts here" body="Follow readers to see their books, games and murals." secondaryActionLabel="Find people" onSecondaryAction={findReaders} />;
  const noLibrary = actions.library.data === null || actions.library.data?.data.books.length === 0;
  return <Screen top={false}>
    <Stack.Screen options={{ title: "Home", headerShown: true, headerLeft: () => <View style={styles.mark}><BrandMark size={24} /></View>, headerRight: () => <HeaderActions><IconButton name="bell" accessibilityLabel="Open activity" badge={activityBadge} onPress={() => router.push("/activity" as never)} /><IconButton name="bookmark" accessibilityLabel="Open saved games and murals" onPress={() => setSavedOpen(true)} /></HeaderActions> }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <SectionList sections={sections} keyExtractor={(item) => `${item.kind}:${item.id}`} stickySectionHeadersEnabled={false} maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 10 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.list}
      ListHeaderComponent={<>
        <DailyChapterCard />
        <RecapHomeCard />
        <AwardHomeCard />
        {noLibrary ? <View style={styles.onboarding}><EmptyState title="Start your library" body="Bring your books into your reading world." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book" onSecondaryAction={() => router.push("/add-book" as never)} /></View> : null}
      </>}
      renderSectionHeader={({ section }) => <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{section.title}</Text>
        <Pressable accessibilityRole="link" onPress={findReaders} style={styles.sectionAction}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>Find people →</Text></Pressable>
      </View>}
      renderItem={({ item }) => <FeedRow item={item} actions={actions} onOpen={() => router.push(digestRoute(item) as never)} onComments={() => setComments(item)} />}
      renderSectionFooter={({ section }) => !section.data.length ? <View style={styles.onboarding}>{empty}</View> : null}
      ListFooterComponent={dashboard.isFetchingNextPage && items.length ? <View style={styles.onboarding}><Skeleton height={80} /></View> : dashboard.isFetchNextPageError ? <View style={styles.onboarding}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void dashboard.fetchNextPage()} /></View> : undefined}
      onEndReached={() => { if (dashboard.hasNextPage && !dashboard.isFetchingNextPage && !dashboard.isFetchNextPageError) void dashboard.fetchNextPage(); }} onEndReachedThreshold={0.4} refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onRefresh()} />} />
    {comments ? <CommentsSheet key={comments.id} id={comments.id} title={feedRowModel(comments).title || "Activity"} onClose={() => setComments(null)} /> : null}
    {savedOpen ? <SavedContentSheet actions={actions} onClose={() => setSavedOpen(false)} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  mark: { marginRight: spacing.sm },
  list: { paddingBottom: spacing.huge },
  onboarding: { paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  sectionHeader: { marginHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionAction: { minHeight: minimumTouchTarget, justifyContent: "center" },
  strong: { fontWeight: "700" },
  grow: { flex: 1, minWidth: 0 }
});
