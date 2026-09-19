import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { bookKey, buildDashboardCards, digestHeading, digestTarget, resolveQuote, type DigestItem } from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Screen, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { useLibrary } from "../library/hooks/useLibrary";
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
              <View style={styles.entryRow}>
                <Button label="Find people" variant="secondary" onPress={() => router.push("/people" as never)} />
                <Button label="Discover" variant="secondary" onPress={() => router.push("/discover" as never)} />
              </View>
              {!books.length ? (
                <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book manually" onSecondaryAction={() => router.push("/add-book" as never)} />
              ) : cards.map((card) => {
                if (card.kind === "currentlyReading" || card.kind === "upNext") {
                  const keys = card.kind === "currentlyReading" ? card.bookKeys : card.bookKeys.slice(0, 6);
                  const sectionBooks = keys.flatMap((key) => { const book = byKey.get(key); return book ? [book] : []; });
                  if (!sectionBooks.length) return null;
                  return (
                    <View key={card.kind} style={styles.section}>
                      <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>
                        {card.kind === "currentlyReading" ? "Currently reading" : "Up next"}
                      </Text>
                      {sectionBooks.map((book) => (
                        <Button
                          key={bookKey(book)}
                          label={String(book.Title ?? "Untitled")}
                          variant="secondary"
                          onPress={() => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never)}
                        />
                      ))}
                    </View>
                  );
                }
                const quote = resolveQuote({ type: "quote", bookKey: card.bookKey, highlightId: card.highlightId } as never, books);
                if (!quote) return null;
                return (
                  <View key="rediscover" style={styles.section}>
                    <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>Rediscover</Text>
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text {...dynamicType} style={{ color: colors.text, fontSize: 18 }}>{String(quote.highlight.Text)}</Text>
                      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                        {String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}
                      </Text>
                      <Button label="Show another" variant="secondary" onPress={() => setOffset((value) => value + 1)} />
                    </View>
                  </View>
                );
              })}
              <View style={styles.section}>
                <View style={styles.followingRow}>
                  <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>Following</Text>
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
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="link" accessibilityLabel={digestHeading(item)} onPress={() => router.push(digestRoute(item) as never)}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md },
  list: { paddingBottom: spacing.huge, flexGrow: 1 },
  entryRow: { flexDirection: "row", gap: spacing.sm },
  section: { gap: spacing.sm },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grow: { flex: 1 },
  followingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  newBadge: { borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
