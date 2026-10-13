import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { personCaption, type SuggestedReader } from "@scripta/shared/community";
import { Text } from "../../ui/Text";
import { Button, ErrorState, Icon, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { DiscoverRow } from "../community/DiscoverRow";
import { fetchDiscover, fetchSuggestedPeople } from "../community/api";
import type { useFollowToggle } from "../community/useFollowToggle";
import { NEW_GAMES, idleSections, type SearchScope } from "./searchModel";
import { SectionTitle } from "./SearchResultRow";

export function SearchIdle({ scope, recent, onRecent, onClearRecent, follow }: {
  scope: SearchScope;
  recent: string[];
  onRecent: (query: string) => void;
  onClearRecent: () => void;
  follow: ReturnType<typeof useFollowToggle>;
}) {
  const { colors } = useTheme();
  const show = idleSections(scope);
  const readers = useQuery({ queryKey: ["community", "people", "suggested"], queryFn: fetchSuggestedPeople, enabled: show.readers, retry: false });
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
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
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
            <View style={styles.pad}><Skeleton height={150} /></View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.readers}>
              {readers.data.map((person) => (
                <ReaderCard key={person.user.userId} person={person} busy={follow.busyId === person.user.userId} onToggleFollow={() => void follow.toggle(person)} />
              ))}
            </ScrollView>
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

function ReaderCard({ person, busy, onToggleFollow }: { person: SuggestedReader; busy: boolean; onToggleFollow: () => void }) {
  const { colors } = useTheme();
  const caption = personCaption(person);
  return (
    <View style={[styles.reader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${person.user.username}'s profile, ${caption}`} onPress={() => openProfile(person.user.username)} style={styles.readerOpen}>
        <AuthorAvatar username={person.user.username} avatarUrl={person.user.avatarUrl} size={44} />
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{person.user.username}</Text>
        <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{caption}</Text>
      </Pressable>
      {person.private ? null : <Button label={person.viewerFollows ? "Following" : "Follow"} variant="secondary" loading={busy} onPress={onToggleFollow} />}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
  pad: { paddingHorizontal: spacing.lg },
  list: { paddingBottom: spacing.huge },
  recent: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, paddingHorizontal: spacing.lg },
  readers: { gap: spacing.md, paddingHorizontal: spacing.lg },
  reader: { width: 136, gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  readerOpen: { alignItems: "center", gap: spacing.xs },
});
