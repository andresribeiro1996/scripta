import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Text } from "../../ui/Text";
import { ErrorState, Icon, Skeleton, dynamicType, searchDockClearance, spacing, typography, useTheme, type SearchDockScrollProps } from "../../ui";
import { DiscoverRow } from "../community/DiscoverRow";
import { fetchDiscover, fetchSuggestedReaderPortraits } from "../community/api";
import type { useFollowToggle } from "../community/useFollowToggle";
import { NEW_GAMES, idleSections, type SearchScope } from "./searchModel";
import { SectionTitle } from "./SearchResultRow";
import { ReaderPortraitCard } from "./ReaderPortraitCard";

export function SearchIdle({ scope, recent, onRecent, onClearRecent, follow, scrollProps }: {
  scope: SearchScope;
  recent: string[];
  onRecent: (query: string) => void;
  onClearRecent: () => void;
  follow: ReturnType<typeof useFollowToggle>;
  scrollProps: SearchDockScrollProps;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const readerWidth = Math.min(220, (width - spacing.lg * 2) * 0.68);
  const show = idleSections(scope);
  const readers = useQuery({ queryKey: ["community", "people", "suggested", "portraits"], queryFn: fetchSuggestedReaderPortraits, enabled: show.readers, retry: false });
  const games = useInfiniteQuery({
    queryKey: ["community", "discover", "all", ""],
    queryFn: ({ pageParam }) => fetchDiscover("all", "", pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: show.newGames,
    retry: false,
  });
  const newGames = games.data?.pages[0]?.items.slice(0, NEW_GAMES) ?? [];

  return (
    <ScrollView {...scrollProps} contentContainerStyle={styles.list}>
      {recent.length > 0 ? (
        <View>
          <SectionTitle title="Recent" action={{ label: "Clear", onPress: onClearRecent }} />
          {recent.map((text) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              accessibilityLabel={`Search for ${text}`}
              onPress={() => onRecent(text)}
              style={({ pressed }) => [styles.recent, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
            >
              <Icon name="recent" size={18} color={colors.textDim} />
              <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {show.readers && (readers.isPending || !readers.data || readers.data.length > 0) ? (
        <View>
          <SectionTitle title="Readers you might like" />
          {!readers.data && readers.isError ? (
            <View style={styles.pad}><ErrorState body="Couldn't load readers." actionLabel="Retry" onAction={() => void readers.refetch()} /></View>
          ) : readers.isPending ? (
            <View style={styles.pad}><Skeleton height={280} /></View>
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.readers}
              data={readers.data}
              keyExtractor={(person) => person.user.userId}
              initialNumToRender={3}
              maxToRenderPerBatch={2}
              windowSize={3}
              extraData={follow.busyId}
              renderItem={({ item }) => <ReaderPortraitCard person={item} width={readerWidth} canvasWidth={width - spacing.sm * 2} busy={follow.busyId === item.user.userId} onToggleFollow={() => void follow.toggle(item)} />}
            />
          )}
        </View>
      ) : null}
      {show.newGames && (games.isPending || !games.data || newGames.length > 0) ? (
        <View>
          <SectionTitle title="New games" />
          {!games.data && games.isError ? (
            <View style={styles.pad}><ErrorState body="Couldn't load games." actionLabel="Retry" onAction={() => void games.refetch()} /></View>
          ) : games.isPending ? (
            <View style={styles.pad}><Skeleton height={120} /></View>
          ) : (
            newGames.map((item) => <DiscoverRow key={`${item.content.kind}:${item.content.id}`} item={item} linkAuthor />)
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pad: { paddingHorizontal: spacing.lg },
  list: { paddingBottom: searchDockClearance },
  recent: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, paddingHorizontal: spacing.lg },
  readers: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
