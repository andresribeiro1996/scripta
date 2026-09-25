import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { bookKey, buildDashboardCards, resolveQuote } from "@scripta/shared";
import { Button, EmptyState, ErrorState, Screen, Skeleton, Toast, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { useLibrary } from "../library/hooks/useLibrary";
import { CoverImage } from "../library/components/CoverImage";
import { FeedRow, digestRoute, useDashboardFeed, useFollowBack } from "./FeedRow";

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const library = useLibrary();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [offset, setOffset] = useState(0);
  const [pulling, setPulling] = useState(false);
  const dashboard = useDashboardFeed();
  const { followingId, followError, followBack } = useFollowBack(dashboard.refetch);

  useFocusEffect(useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      setDay(today);
      setOffset(0);
    }
    void library.refetch();
    void dashboard.refetch();
  }, [day, library.refetch, dashboard.refetch]));

  const books = library.data?.data.books ?? [];
  const cards = user ? buildDashboardCards(books, day, `${user.id}:${offset}`) : [];
  const readingCard = cards.find((card) => card.kind === "currentlyReading");
  const upNextCard = cards.find((card) => card.kind === "upNext");
  const rediscoverCard = cards.find((card) => card.kind === "rediscover");
  const quote = rediscoverCard ? resolveQuote({ type: "quote", bookKey: rediscoverCard.bookKey, highlightId: rediscoverCard.highlightId } as never, books) : null;

  const feedItems = dashboard.data?.pages[0]?.items.slice(0, 3) ?? [];
  const newCount = dashboard.data?.pages[0]?.newCount ?? 0;

  const openBook = (key: string) => router.push(`/book/${encodeURIComponent(key)}` as never);

  async function onRefresh() {
    setPulling(true);
    try {
      await Promise.all([library.refetch(), dashboard.refetch()]);
    } finally {
      setPulling(false);
    }
  }

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Home",
          headerShown: true,
        }}
      />
      {library.isPending ? (
        <View style={styles.page}>
          <ActivityIndicator accessibilityLabel="Loading home" />
        </View>
      ) : library.isError ? (
        <View style={styles.page}>
          <ErrorState body="Couldn't load your home." actionLabel="Retry" onAction={() => void library.refetch()} />
        </View>
      ) : (
        <View style={styles.grow}>
          {followError ? <Toast visible message={followError} tone="error" /> : null}
          <ScrollView
            contentContainerStyle={styles.sections}
            refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onRefresh()} />}
          >
            {!books.length ? (
              <View style={styles.page}>
                <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book manually" onSecondaryAction={() => router.push("/add-book" as never)} />
              </View>
            ) : (
              <>
                {readingCard ? (
                  <View style={styles.section}>
                    <SectionHeader title="Reading now" count={String(readingCard.bookKeys.length)} />
                    <BookRow keys={readingCard.bookKeys} books={books} onOpen={openBook} />
                  </View>
                ) : null}
                {quote ? (
                  <View style={styles.sectionPad}>
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>Rediscover</Text>
                      <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{String(quote.highlight.Text)}</Text>
                      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                        {String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}
                      </Text>
                      <Button label="Show another" variant="secondary" onPress={() => setOffset((value) => value + 1)} />
                    </View>
                  </View>
                ) : null}
                {upNextCard ? (
                  <View style={styles.section}>
                    <SectionHeader title="Up next" count={String(upNextCard.bookKeys.length)} />
                    <BookRow keys={upNextCard.bookKeys.slice(0, 10)} books={books} onOpen={openBook} />
                  </View>
                ) : null}
              </>
            )}
            <View style={styles.section}>
              {dashboard.isPending ? (
                <>
                  <SectionHeader title="From people you follow" />
                  <View style={styles.sectionPad}>
                    <Skeleton height={80} />
                  </View>
                </>
              ) : dashboard.isError ? (
                <>
                  <SectionHeader title="From people you follow" />
                  <View style={styles.sectionPad}>
                    <ErrorState body="Couldn't load activity from people you follow." actionLabel="Retry" onAction={() => void dashboard.refetch()} />
                  </View>
                </>
              ) : feedItems.length ? (
                <>
                  <SectionHeader title="From people you follow" count={newCount > 0 ? `· ${newCount} new` : undefined} />
                  {feedItems.map((item) => (
                    <FeedRow
                      key={`${item.kind}:${item.id}`}
                      item={item}
                      onOpen={() => router.push(digestRoute(item) as never)}
                      onFollowBack={() => void followBack(item.actor.userId)}
                      following={followingId === item.actor.userId}
                    />
                  ))}
                  <Pressable accessibilityRole="button" onPress={() => router.push("/activity" as never)} style={styles.linkRow}>
                    <Text {...dynamicType} style={[typography.body, styles.heading, { color: colors.accent }]}>All activity</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => router.push("/activity?tab=people" as never)} style={styles.linkRow}>
                  <Text {...dynamicType} style={[typography.body, styles.heading, { color: colors.accent }]}>Find readers</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </View>
      )}
    </Screen>
  );
}

function SectionHeader({ title, count }: { title: string; count?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.body, styles.heading, { color: colors.text }]}>{title}</Text>
      {count ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{count}</Text> : null}
    </View>
  );
}

function BookRow({ keys, books, onOpen }: { keys: string[]; books: Array<Record<string, unknown>>; onOpen: (key: string) => void }) {
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  const items = keys.flatMap((key) => { const book = byKey.get(key); return book ? [{ key, book }] : []; });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map(({ key, book }) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={`${String(book.Title ?? "Untitled")} by ${String(book.Attribution ?? "Unknown author")}`}
          onPress={() => onOpen(key)}
          style={styles.cover}
        >
          <CoverImage book={book} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md },
  sectionPad: { paddingHorizontal: spacing.lg },
  heading: { fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  grow: { flex: 1 },
  sections: { paddingVertical: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs, paddingHorizontal: spacing.lg },
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  cover: { width: 72, aspectRatio: 2 / 3, borderRadius: radii.md, overflow: "hidden" },
  linkRow: { minHeight: minimumTouchTarget, justifyContent: "center", paddingHorizontal: spacing.lg },
});
