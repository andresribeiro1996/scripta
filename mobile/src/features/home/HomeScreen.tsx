import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View, type ViewToken } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { clearDashboardCounts, isNewDigestItem, newCountLabel, type DashboardFeedPage, type DigestItem } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { BrandMark, EmptyState, ErrorState, IconButton, Screen, Skeleton, Toast, dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { markDashboardSeen } from "../community/api";
import { DASHBOARD_QUERY_KEY, FeedRow, useDashboardFeed, useFollowBack, useSkipEmptyPages } from "./FeedRow";
import { digestRoute, feedRowModel } from "./feedRowModel";
import { homeFeedSections, shouldMarkFeedSeen } from "./homeModel";
import { CommentsSheet } from "./CommentsSheet";
import { SavedContentSheet } from "./SavedContentSheet";
import { ENGAGEMENT_QUERY_KEY, SAVED_STATE_QUERY_KEY, useHomeActions } from "./useHomeActions";

const FEED_VIEWABILITY = { itemVisiblePercentThreshold: 50 };

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const [pulling, setPulling] = useState(false);
  const [comments, setComments] = useState<DigestItem | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const dashboard = useDashboardFeed();
  const items = dashboard.data?.pages.flatMap((page) => page.items) ?? [];
  const actions = useHomeActions(items);
  const { followingId, followError, followBack } = useFollowBack(dashboard.refetch);
  const sections = homeFeedSections(items);
  const firstPage = dashboard.data?.pages[0];
  const seenAt = firstPage?.seenAt ?? null;
  const seenSent = useRef(false);
  const rowVisible = useRef(false);
  useSkipEmptyPages(dashboard, items.length);

  useFocusEffect(useCallback(() => {
    seenSent.current = false;
    void actions.library.refetch();
    void dashboard.refetch();
    void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: SAVED_STATE_QUERY_KEY });
  }, [actions.library.refetch, dashboard.refetch, queryClient]));

  const markSeen = useRef(() => {});
  markSeen.current = () => {
    if (!shouldMarkFeedSeen({ focused, rowVisible: rowVisible.current && items.length > 0, loaded: dashboard.data !== undefined, failed: dashboard.isError, fetching: dashboard.isFetching, sent: seenSent.current })) return;
    seenSent.current = true;
    void markDashboardSeen().then(
      () => queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(DASHBOARD_QUERY_KEY, (data) => data ? clearDashboardCounts(data) : data),
      () => { seenSent.current = false; }
    );
  };
  useEffect(() => { markSeen.current(); }, [focused, dashboard.data, dashboard.isError, dashboard.isFetching]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    rowVisible.current = viewableItems.some((token) => token.item?.kind);
    markSeen.current();
  }).current;

  async function onRefresh() {
    setPulling(true);
    try { await Promise.all([actions.library.refetch(), dashboard.refetch(), queryClient.invalidateQueries({ queryKey: ENGAGEMENT_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: SAVED_STATE_QUERY_KEY })]); }
    finally { setPulling(false); }
  }
  const findReaders = () => router.push("/people" as never);
  const error = followError ?? actions.error ?? (dashboard.isRefetchError && !dashboard.isRefetching ? "Couldn't refresh activity." : null);
  const empty = dashboard.isPending || (dashboard.hasNextPage && !dashboard.isError && !items.length) ? <Skeleton height={80} /> : dashboard.isError && !dashboard.data ? <ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void dashboard.refetch()} /> : dashboard.hasNextPage ? null : <EmptyState title="Your circle starts here" body="Follow readers to see their books, games and murals." actionLabel="Find readers" onAction={findReaders} />;
  const noLibrary = actions.library.data === null || actions.library.data?.data.books.length === 0;
  return <Screen top={false}>
    <Stack.Screen options={{ title: "Home", headerShown: true, headerLeft: () => <View style={styles.mark}><BrandMark size={24} /></View>, headerRight: () => <IconButton name="bookmark" label="Saved" framed accessibilityLabel="Open saved games and murals" onPress={() => setSavedOpen(true)} /> }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <SectionList sections={sections} keyExtractor={(item) => `${item.kind}:${item.id}`} stickySectionHeadersEnabled={false} maintainVisibleContentPosition={{ minIndexForVisible: 0 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.list}
      ListHeaderComponent={noLibrary ? <View style={styles.onboarding}><EmptyState title="Start your library" body="Bring your books into your reading world." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book" onSecondaryAction={() => router.push("/add-book" as never)} /></View> : null}
      renderSectionHeader={({ section }) => <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{section.title}</Text>
        {section.personal ? newCountLabel(firstPage?.personalNewCount ?? 0) ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{newCountLabel(firstPage?.personalNewCount ?? 0)} new</Text> : null : <Pressable accessibilityRole="link" onPress={findReaders} style={styles.sectionAction}><Text {...dynamicType} style={[typography.caption, { color: colors.accent }]}>Find readers</Text></Pressable>}
      </View>}
      renderItem={({ item }) => <FeedRow item={item} actions={actions} onOpen={() => router.push(digestRoute(item) as never)} onComments={() => setComments(item)} onFollowBack={() => { if (item.kind === "follow") void followBack(item.actor.userId); }} following={item.kind === "follow" && followingId === item.actor.userId} isNew={isNewDigestItem(item, seenAt)} />}
      renderSectionFooter={({ section }) => !section.personal && !section.data.length ? <View style={styles.onboarding}>{empty}</View> : null}
      ListFooterComponent={dashboard.isFetchingNextPage && items.length ? <View style={styles.onboarding}><Skeleton height={80} /></View> : dashboard.isFetchNextPageError ? <View style={styles.onboarding}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void dashboard.fetchNextPage()} /></View> : null}
      onEndReached={() => { if (dashboard.hasNextPage && !dashboard.isFetchingNextPage && !dashboard.isFetchNextPageError) void dashboard.fetchNextPage(); }} onEndReachedThreshold={0.4} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={FEED_VIEWABILITY} refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onRefresh()} />} />
    {comments ? <CommentsSheet key={comments.id} id={comments.id} title={feedRowModel(comments).title || "Activity"} onClose={() => setComments(null)} /> : null}
    {savedOpen ? <SavedContentSheet actions={actions} onClose={() => setSavedOpen(false)} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  mark: { marginRight: spacing.sm },
  list: { paddingBottom: spacing.huge },
  onboarding: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  sectionHeader: { marginHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1 },
  sectionAction: { minHeight: minimumTouchTarget, justifyContent: "center" },
  strong: { fontWeight: "700" },
  grow: { flex: 1, minWidth: 0 }
});
