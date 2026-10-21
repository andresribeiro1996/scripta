import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Stack, router, useLocalSearchParams, useSegments } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { TopShelfBook, TopShelfPeriod, TopShelfView } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { EmptyState, ErrorState, Icon, Screen, ScrollDock, Skeleton, dynamicType, minimumTouchTarget, radii, searchDockClearance, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { DiscoverRow } from "../community/DiscoverRow";
import { workPath } from "../works/workPath";
import { fetchTopShelf } from "./api";
import { TopShelfBar } from "./TopShelfBar";
import { boardTitle, emptySections, valueLabel, visibleBoards } from "./topShelfModel";

function topShelfHref(view: TopShelfView, period: TopShelfPeriod, genre: string | null) {
  return { pathname: "/top-shelf/[view]", params: { view, period, ...(genre ? { genre } : {}) } } as never;
}

export function TopShelfScreen() {
  const { colors } = useTheme();
  const segments = useSegments();
  const params = useLocalSearchParams<{ period?: string; genre?: string }>();
  const [period, setPeriod] = useState<TopShelfPeriod>(params.period === "all" ? "all" : "month");
  const [genre, setGenre] = useState<string | null>(params.genre ?? null);
  const query = useQuery({ queryKey: ["topShelf", period, genre], queryFn: () => fetchTopShelf({ period, genre }), placeholderData: keepPreviousData, retry: false });
  const data = query.data;
  const openBook = (book: TopShelfBook) => router.push(workPath(book.workId, segments) as never);

  const bar = <TopShelfBar period={period} onPeriod={setPeriod} genre={genre} onGenre={setGenre} genres={data?.genres ?? []} genreDisabled={false} />;

  return <Screen top={false}>
    <Stack.Screen options={{ headerShown: true, title: "Top Shelf", headerLargeTitleEnabled: false }} />
    <ScrollDock bar={bar}>
      {(scrollProps) => {
        if (query.isError || !data) {
          return query.isError
            ? <View style={styles.page}><ErrorState body={query.error instanceof Error ? query.error.message : "Couldn't load Top Shelf."} actionLabel="Retry" onAction={() => void query.refetch()} /></View>
            : <View style={styles.page}><Skeleton height={200} /></View>;
        }
        const empty = emptySections(data);
        if (empty.podium && empty.records && (empty.genres || genre !== null) && empty.games) {
          return <View style={styles.page}><EmptyState title={`Nothing here yet${data.period === "month" ? " this month" : ""} — games count once 5 people vote.`} /></View>;
        }
        return (
        <ScrollView {...scrollProps} contentContainerStyle={styles.list}>
          {empty.podium ? null : <Podium books={data.boards.champions ?? []} title={data.period === "month" ? "Book of the month" : "All-time champions"} onOpen={openBook} />}
          {empty.records ? null : (
            <Section title="Records">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {visibleBoards(data.period).flatMap((board) => {
                  const leader = data.boards[board]?.[0];
                  if (!leader) return [];
                  return [
                    <Pressable key={board} accessibilityRole="button" accessibilityLabel={`${boardTitle(board, null)}, ${leader.title}, ${valueLabel(board, leader.value)}`} onPress={() => router.push(topShelfHref(board, period, genre))} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{boardTitle(board, null)}</Text>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{leader.title}</Text>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.accent }]}>{valueLabel(board, leader.value)}</Text>
                    </Pressable>,
                  ];
                })}
              </ScrollView>
            </Section>
          )}
          {empty.genres || genre ? null : (
            <Section title="Champions by genre" onMore={() => router.push(topShelfHref("champions", period, null))}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {data.genreChampions.map((entry) => (
                  <Pressable key={entry.genre} accessibilityRole="button" accessibilityLabel={`${entry.genre} champions, ${entry.book.title}`} onPress={() => router.push(topShelfHref("champions", period, entry.genre))} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{entry.genre}</Text>
                    <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{entry.book.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Section>
          )}
          {empty.games ? null : (
            <Section title="Hottest games" onMore={() => router.push(topShelfHref("games", period, genre))}>
              {data.games.map((game) => (
                <DiscoverRow key={game.item.content.id} item={game.item} linkAuthor stats={[{ value: game.likes, label: "likes" }, { value: game.votes, label: "votes" }, { value: game.comments, label: "comments" }]} />
              ))}
            </Section>
          )}
        </ScrollView>
        );
      }}
    </ScrollDock>
  </Screen>;
}

function Section({ title, onMore, children }: { title: string; onMore?: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text {...dynamicType} accessibilityRole="header" style={[typography.title, styles.strong, { color: colors.text }]}>{title}</Text>
        {onMore ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`See all ${title.toLowerCase()}`} onPress={onMore} style={styles.more}>
            <Icon name="chevronRight" size={20} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const PODIUM_COVER = { 1: { width: 96, height: 144 }, 2: { width: 72, height: 108 }, 3: { width: 72, height: 108 } } as const;

function Podium({ books, title, onOpen }: { books: TopShelfBook[]; title: string; onOpen: (book: TopShelfBook) => void }) {
  const { colors } = useTheme();
  const order = [books[1], books[0], books[2]].map((book, slot) => book && { book, place: ([2, 1, 3] as const)[slot]! });
  return (
    <View style={styles.section}>
      <Text {...dynamicType} accessibilityRole="header" style={[typography.title, styles.strong, styles.podiumTitle, { color: colors.text }]}>{title}</Text>
      <View style={styles.podium}>
        {order.map((entry, slot) => entry ? (
          <Pressable key={entry.book.workId} accessibilityRole="button" accessibilityLabel={`${entry.place}. ${entry.book.title}`} onPress={() => onOpen(entry.book)} style={styles.podiumSlot}>
            <BookCover cover={entry.book.coverUrl} title={entry.book.title} {...PODIUM_COVER[entry.place]} />
            <Text {...dynamicType} style={[typography.title, styles.strong, { color: entry.place === 1 ? colors.accent : colors.textDim }]}>{entry.place}</Text>
            {entry.place === 1 ? <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, styles.center, { color: colors.text }]}>{entry.book.title}</Text> : null}
            {entry.place === 1 ? <View style={styles.recapSpace} /> : null}
          </Pressable>
        ) : <View key={slot} style={styles.podiumSlot} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
  page: { flex: 1, padding: spacing.lg },
  list: { paddingTop: spacing.md, paddingBottom: searchDockClearance },
  section: { marginBottom: spacing.xl },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  more: { width: minimumTouchTarget, height: minimumTouchTarget, marginVertical: -spacing.sm, alignItems: "center", justifyContent: "center" },
  strip: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  card: { width: 160, gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  podiumTitle: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  podium: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.lg },
  podiumSlot: { flex: 1, alignItems: "center", gap: spacing.xs },
  recapSpace: { height: minimumTouchTarget },
});
