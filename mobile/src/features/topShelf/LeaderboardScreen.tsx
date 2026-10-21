import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router, useSegments } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { TopShelfBoard, TopShelfPeriod, TopShelfView } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { EmptyState, ErrorState, Screen, ScrollDock, Skeleton, dynamicType, radii, searchDockClearance, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { contentTarget } from "../community/communityHome";
import { workPath } from "../works/workPath";
import { fetchTopShelf } from "./api";
import { TopShelfBar } from "./TopShelfBar";
import { BOARD_ORDER, barFraction, boardTitle, gameScore, gameScoreLabel, valueLabel } from "./topShelfModel";

const VIEWS: readonly string[] = [...BOARD_ORDER, "champions", "games"];
const COVER = { width: 40, height: 60 } as const;

type Row = { key: string; cover: string | null; title: string; subtitle: string; label: string; fraction: number; onPress: () => void };

export function LeaderboardScreen({ view, period: initialPeriod, genre: initialGenre }: { view: string; period: TopShelfPeriod; genre: string | null }) {
  if (!VIEWS.includes(view)) return <Redirect href={"/top-shelf" as never} />;
  return <Leaderboard view={view as TopShelfView} initialPeriod={initialPeriod} initialGenre={initialGenre} />;
}

function Leaderboard({ view, initialPeriod, initialGenre }: { view: TopShelfView; initialPeriod: TopShelfPeriod; initialGenre: string | null }) {
  const { colors } = useTheme();
  const segments = useSegments();
  const [period, setPeriod] = useState(initialPeriod);
  const [genre, setGenre] = useState(initialGenre);
  const isGames = view === "games";
  const query = useQuery({ queryKey: ["topShelf", period, genre, view], queryFn: () => fetchTopShelf({ period, genre, view }), placeholderData: keepPreviousData, retry: false });
  const data = query.data;

  const bar = <TopShelfBar period={period} onPeriod={setPeriod} genre={genre} onGenre={setGenre} genres={data?.genres ?? []} genreDisabled={isGames} />;

  function rows(): Row[] {
    if (!data) return [];
    if (isGames) {
      const leader = data.games[0] ? gameScore(data.games[0]) : 0;
      return data.games.map((game) => ({
        key: game.item.content.id,
        cover: game.item.content.covers[0] ?? null,
        title: game.item.content.name,
        subtitle: game.item.author.username,
        label: gameScoreLabel(game),
        fraction: barFraction("champions", gameScore(game), leader),
        onPress: () => router.push(contentTarget(game.item.content) as never),
      }));
    }
    const board = view as TopShelfBoard;
    const books = data.boards[board] ?? [];
    return books.map((book) => ({
      key: book.workId,
      cover: book.coverUrl,
      title: book.title,
      subtitle: book.author,
      label: valueLabel(board, book.value),
      fraction: barFraction(board, book.value, books[0]?.value ?? 0),
      onPress: () => router.push(workPath(book.workId, segments) as never),
    }));
  }

  return <Screen top={false}>
    <Stack.Screen options={{ headerShown: true, title: boardTitle(view, genre), headerLargeTitleEnabled: false }} />
    <ScrollDock bar={bar}>
      {(scrollProps) => {
        if (!data) {
          return query.isError
            ? <View style={styles.page}><ErrorState body={query.error instanceof Error ? query.error.message : "Couldn't load this leaderboard."} actionLabel="Retry" onAction={() => void query.refetch()} /></View>
            : <View style={styles.page}><Skeleton height={200} /></View>;
        }
        const list = rows();
        if (list.length === 0) {
          return <View style={styles.page}><EmptyState title={`Nothing here yet${data.period === "month" ? " this month" : ""} — games count once 5 people vote.`} /></View>;
        }
        return (
          <ScrollView {...scrollProps} contentContainerStyle={styles.list}>
            {list.map((row, index) => (
              <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={`${index + 1}. ${row.title}, ${row.label}`} onPress={row.onPress}>
                {({ pressed }) => (
                  <View style={[styles.row, { backgroundColor: pressed ? colors.surfacePressed : "transparent", borderBottomColor: colors.border }]}>
                    <Text {...dynamicType} style={[typography.title, styles.rank, { color: index === 0 ? colors.accent : colors.textDim }]}>{index + 1}</Text>
                    <BookCover cover={row.cover} title={row.title} {...COVER} />
                    <View style={styles.grow}>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{row.title}</Text>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{row.subtitle}</Text>
                      <View style={[styles.track, { backgroundColor: colors.surface }]}>
                        <View style={[styles.fill, { width: `${row.fraction * 100}%`, backgroundColor: colors.accent }]} />
                      </View>
                    </View>
                    <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.strong, styles.value, { color: colors.text }]}>{row.label}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        );
      }}
    </ScrollDock>
  </Screen>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: spacing.xs },
  strong: { fontWeight: "600" },
  page: { flex: 1, padding: spacing.lg },
  list: { paddingBottom: searchDockClearance },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  rank: { width: 24, textAlign: "center", fontWeight: "700" },
  track: { height: 6, borderRadius: radii.full, overflow: "hidden" },
  fill: { height: 6, borderRadius: radii.full },
  value: { maxWidth: 96, textAlign: "right" },
});
