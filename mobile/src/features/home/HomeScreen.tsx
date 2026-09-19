import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { bookKey, buildDashboardCards, digestHeading, digestTarget, effectiveCardStyle, resolveLibraryStyle, resolveQuote, type DigestItem, type LibraryStyleSettings, type PerCardStyle } from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Screen, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { useLibrary } from "../library/hooks/useLibrary";
import { BookCard } from "../library/components/BookCard";
import { useLibraryGridColumns } from "../library/components/LibraryGrid";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { fetchDashboard, markDashboardSeen } from "../community/api";

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const library = useLibrary();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [offset, setOffset] = useState(0);
  const markedRef = useRef(false);
  const dashboard = useInfiniteQuery({
    queryKey: ["community", "dashboard"],
    queryFn: ({ pageParam }) => fetchDashboard(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
  useFocusEffect(useCallback(() => {
    setDay(new Date().toISOString().slice(0, 10));
    setOffset(0);
    void dashboard.refetch();
    void library.refetch();
  }, [dashboard.refetch, library.refetch]));
  useEffect(() => {
    if (!markedRef.current && dashboard.data) {
      markedRef.current = true;
      void markDashboardSeen().catch(() => {});
    }
  }, [dashboard.data]);

  const style = resolveLibraryStyle(library.data?.data.style);
  const { columns, contentWidth } = useLibraryGridColumns(style);
  // Half a tile short of a whole column, so the row shows the edge of the next
  // cover and reads as something to swipe rather than as everything there is.
  const coverWidth = Math.max(72, Math.round((contentWidth - spacing.lg * 2 - style.cardGap * columns) / (columns + 0.5)));
  const books = library.data?.data.books ?? [];
  const items = dashboard.data?.pages.flatMap((page) => page.items) ?? [];
  const newCount = dashboard.data?.pages[0]?.newCount ?? 0;
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  const cards = user ? buildDashboardCards(books, day, `${user.id}:${offset}`) : [];

  function digestRoute(item: DigestItem): string {
    return item.kind === "follow" ? `/u/${item.actor.username}` : digestTarget(item);
  }

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Home",
          headerShown: true,
          headerRight: user?.username ? () => (
            <IconButton accessibilityLabel="Your profile" name="profile" onPress={() => router.push(`/u/${user.username}` as never)} />
          ) : undefined,
        }}
      />
      {dashboard.isPending || library.isPending ? (
        <View style={styles.page}>
          <ActivityIndicator accessibilityLabel="Loading home" />
        </View>
      ) : dashboard.isError || library.isError ? (
        <View style={styles.page}>
          <ErrorState body="Couldn't load your home." actionLabel="Retry" onAction={() => { void dashboard.refetch(); void library.refetch(); }} />
        </View>
      ) : (
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
          ListHeaderComponent={
            <View style={styles.page}>
              {!books.length ? (
                <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book manually" onSecondaryAction={() => router.push("/add-book" as never)} />
              ) : cards.map((card) => {
                if (card.kind === "currentlyReading" || card.kind === "upNext") {
                  // Reading is every book at ReadStatus 1 and Up next everything
                  // unstarted, so both are capped: a row scrolls, but a library's
                  // worth of covers is still a library's worth of cover lookups.
                  const keys = card.bookKeys.slice(0, card.kind === "currentlyReading" ? 12 : 6);
                  const sectionBooks = keys.flatMap((key) => { const book = byKey.get(key); return book ? [book] : []; });
                  if (!sectionBooks.length) return null;
                  return (
                    <View key={card.kind} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>
                        {card.kind === "currentlyReading" ? "Currently reading" : "Up next"}
                      </Text>
                      <BookRail books={sectionBooks} width={coverWidth} style={style} onOpen={(book) => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never)} />
                    </View>
                  );
                }
                const quote = resolveQuote({ type: "quote", bookKey: card.bookKey, highlightId: card.highlightId } as never, books);
                if (!quote) return null;
                return (
                  <View key="rediscover" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>Rediscover</Text>
                    <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{String(quote.highlight.Text)}</Text>
                    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                      {String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}
                    </Text>
                    <Button label="Show another" variant="secondary" onPress={() => setOffset((value) => value + 1)} />
                  </View>
                );
              })}
              <View style={styles.section}>
                <View style={styles.followingRow}>
                  <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>Following</Text>
                  {newCount > 0 ? (
                    <View style={[styles.newBadge, { backgroundColor: colors.accentSoft }]}>
                      <Text {...dynamicType} style={[typography.caption, { color: colors.accent }]}>{newCount} new</Text>
                    </View>
                  ) : null}
                </View>
                {items.length === 0 ? (
                  <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                    Nothing here yet. Follow people to see what they publish.
                  </Text>
                ) : null}
                {/* Under the section they act on, rather than above the whole
                    page: finding people is what an empty feed needs next. */}
                <View style={styles.entryRow}>
                  <Button label="Find people" variant="secondary" onPress={() => router.push("/people" as never)} />
                  <Button label="Discover" variant="secondary" onPress={() => router.push("/discover" as never)} />
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="link" accessibilityLabel={digestHeading(item)} onPress={() => router.push(digestRoute(item) as never)}>
              {({ pressed }) => <View style={[styles.card, { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border }]}>
                <View style={styles.actorRow}>
                  <AuthorAvatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} />
                  <View style={styles.grow}>
                    <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>
                      {digestHeading(item)}
                    </Text>
                    {item.kind === "publication" ? (
                      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                        {item.content.name}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

/** A horizontal row of the library's own cards, so a cover on Home is the
 *  same object it is in the library — per-book style overrides included. */
function BookRail({ books, width, style, onOpen }: {
  books: Array<Record<string, unknown>>;
  width: number;
  style: LibraryStyleSettings;
  onOpen: (book: Record<string, unknown>) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: style.cardGap }}
    >
      {books.map((book) => (
        <View key={bookKey(book)} style={{ width }}>
          <BookCard
            book={book}
            style={effectiveCardStyle(style, undefined, book._style as PerCardStyle | undefined)}
            onPress={() => onOpen(book)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md },
  heading: { fontWeight: "700" },
  list: { paddingBottom: spacing.huge, flexGrow: 1 },
  entryRow: { flexDirection: "row", gap: spacing.sm },
  section: { gap: spacing.sm },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grow: { flex: 1 },
  followingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  newBadge: { borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
