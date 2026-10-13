import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View, type ViewToken } from "react-native";
import { Text } from "../../ui/Text";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { buildDashboardCards, clearDashboardCounts, isNewDigestItem, localDay, newCountLabel, resolveQuote, type DashboardFeedPage } from "@scripta/shared";
import { BrandMark, Button, EmptyState, ErrorState, Screen, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { useLibrary } from "../library/hooks/useLibrary";
import { markDashboardSeen } from "../community/api";
import { DASHBOARD_QUERY_KEY, FeedRow, useDashboardFeed, useFollowBack, useSkipEmptyPages } from "./FeedRow";
import { digestRoute } from "./feedRowModel";
import { homeSections, shouldMarkFeedSeen } from "./homeModel";
import { NextReadCard } from "./NextReadCard";
import { ReadingCards } from "./ReadingCards";

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const { user } = useAuth();
  const library = useLibrary();
  const [day, setDay] = useState(localDay);
  const [offset, setOffset] = useState(0);
  const [pulling, setPulling] = useState(false);
  const dashboard = useDashboardFeed();
  const { followingId, followError, followBack } = useFollowBack(dashboard.refetch);
  const seenSent = useRef(false);
  const rowVisible = useRef(false);

  useFocusEffect(useCallback(() => {
    const today = localDay();
    if (today !== day) {
      setDay(today);
      setOffset(0);
    }
    seenSent.current = false;
    void library.refetch();
    void dashboard.refetch();
  }, [day, library.refetch, dashboard.refetch]));

  const books = library.data?.data.books ?? [];
  const sections = homeSections(user ? buildDashboardCards(books, day, `${user.id}:${offset}`) : []);
  const quote = sections.highlight ? resolveQuote({ type: "quote", bookKey: sections.highlight.bookKey, highlightId: sections.highlight.highlightId } as never, books) : null;

  const feedItems = dashboard.data?.pages.flatMap((page) => page.items) ?? [];
  const newLabel = newCountLabel(dashboard.data?.pages[0]?.personalNewCount ?? 0);
  const seenAt = dashboard.data?.pages[0]?.seenAt ?? null;
  const feedLoading = dashboard.isPending || (dashboard.hasNextPage && !dashboard.isError && !feedItems.length);
  useSkipEmptyPages(dashboard, feedItems.length);

  const markSeen = useRef(() => {});
  markSeen.current = () => {
    if (!shouldMarkFeedSeen({ focused, rowVisible: rowVisible.current, loaded: dashboard.data !== undefined, failed: dashboard.isError, fetching: dashboard.isFetching, sent: seenSent.current })) return;
    seenSent.current = true;
    void markDashboardSeen().then(
      () => queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(DASHBOARD_QUERY_KEY, (data) => (data ? clearDashboardCounts(data) : data)),
      () => {},
    );
  };
  useEffect(() => {
    markSeen.current();
  }, [focused, dashboard.data, dashboard.isError, dashboard.isFetching]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    rowVisible.current = viewableItems.length > 0;
    markSeen.current();
  }).current;

  const openBook = (key: string) => router.push(`/book/${encodeURIComponent(key)}` as never);
  const findReaders = () => router.push("/community?tab=people" as never);

  async function onRefresh() {
    setPulling(true);
    try {
      await Promise.all([library.refetch(), dashboard.refetch()]);
    } finally {
      setPulling(false);
    }
  }

  const header = (
    <View style={styles.sections}>
      {!library.data ? (
        <View style={styles.sectionPad}>
          {library.isError
            ? <ErrorState body="Couldn't load your home." actionLabel="Retry" onAction={() => void library.refetch()} />
            : <ActivityIndicator accessibilityLabel="Loading home" />}
        </View>
      ) : !books.length ? (
        <View style={styles.sectionPad}>
          <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book manually" onSecondaryAction={() => router.push("/add-book" as never)} />
        </View>
      ) : (
        <>
          {sections.readingKeys.length ? (
            <View style={styles.section}>
              <SectionHeader title="Continue reading" count={String(sections.readingKeys.length)} />
              <ReadingCards keys={sections.readingKeys} books={books} onOpen={openBook} />
            </View>
          ) : null}
          {sections.nextKeys ? (
            <View style={styles.sectionPad}>
              <NextReadCard keys={sections.nextKeys} books={books} />
            </View>
          ) : null}
          {quote ? (
            <View style={styles.sectionPad}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>From your highlights</Text>
                <Text {...dynamicType} display={false} style={[typography.title, { color: colors.text }]}>{String(quote.highlight.Text)}</Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  {String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}
                </Text>
                <Button label="Another" variant="secondary" onPress={() => setOffset((value) => value + 1)} />
              </View>
            </View>
          ) : null}
        </>
      )}
      <SectionHeader title="From people you follow" count={newLabel ? `· ${newLabel} new` : undefined} action={{ label: "Find readers", onPress: findReaders }} />
    </View>
  );

  const feedEmpty = feedLoading ? (
    <View style={styles.sectionPad}><Skeleton height={80} /></View>
  ) : dashboard.isError && !dashboard.data ? (
    <View style={styles.sectionPad}><ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void dashboard.refetch()} /></View>
  ) : dashboard.hasNextPage ? null : (
    <View style={styles.sectionPad}><EmptyState title="Nothing here yet" body="Follow readers to see what they finish and publish." actionLabel="Find readers" onAction={findReaders} /></View>
  );

  const feedFooter = dashboard.isFetchingNextPage ? (
    <View style={styles.sectionPad}><Skeleton height={80} /></View>
  ) : dashboard.isFetchNextPageError ? (
    <View style={styles.sectionPad}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void dashboard.fetchNextPage()} /></View>
  ) : null;

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Home", headerShown: true, headerLeft: () => <View style={styles.mark}><BrandMark size={24} /></View> }} />
      {followError ? (
        <Toast visible message={followError} tone="error" />
      ) : dashboard.isRefetchError && !dashboard.isRefetching ? (
        <Toast visible message="Couldn't refresh activity." tone="error" />
      ) : null}
      <FlatList
        data={feedItems}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        ListHeaderComponent={header}
        ListEmptyComponent={feedEmpty}
        ListFooterComponent={feedFooter}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <FeedRow
            item={item}
            onOpen={() => router.push(digestRoute(item) as never)}
            onFollowBack={() => { if (item.kind === "follow") void followBack(item.actor.userId); }}
            following={item.kind === "follow" && followingId === item.actor.userId}
            isNew={isNewDigestItem(item, seenAt)}
          />
        )}
        onEndReached={() => {
          if (dashboard.hasNextPage && !dashboard.isFetchingNextPage && !dashboard.isFetchNextPageError) void dashboard.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onRefresh()} />}
      />
    </Screen>
  );
}

function SectionHeader({ title, count, action }: { title: string; count?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" {...dynamicType} numberOfLines={1} style={[typography.body, styles.heading, styles.headerTitle, { color: colors.text }]}>{title}</Text>
      {count ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{count}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={action.onPress} style={styles.sectionAction}>
          <Text {...dynamicType} numberOfLines={1} style={[typography.body, { color: colors.accent }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { marginRight: spacing.sm },
  sectionPad: { paddingHorizontal: spacing.lg },
  heading: { fontWeight: "700" },
  headerTitle: { flexShrink: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  list: { paddingBottom: spacing.huge },
  sections: { paddingVertical: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs, paddingHorizontal: spacing.lg },
  sectionAction: { marginLeft: "auto" },
});
