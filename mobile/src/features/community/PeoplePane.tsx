import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { readerGlyphLabel } from "@scripta/shared";
import { Button, EmptyState, ErrorState, Input, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { personCaption, type PersonResult, type SuggestedReader } from "@scripta/shared/community";
import { BookCover } from "../arena/BookCover";
import { fetchSuggestedPeople, followUser, searchPeople, unfollowUser } from "./api";
import { AuthorAvatar, openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";

export function PeoplePane() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needle = query.trim();
  const people = useQuery({
    queryKey: ["community", "people", "search", needle],
    queryFn: () => searchPeople(needle),
    enabled: needle.length > 0,
    retry: false,
  });
  const suggested = useQuery({
    queryKey: ["community", "people", "suggested"],
    queryFn: fetchSuggestedPeople,
    enabled: needle.length === 0,
    retry: false,
  });
  const results: (PersonResult | SuggestedReader)[] = (needle.length > 0 ? people.data?.people : suggested.data?.people) ?? [];

  async function toggle(person: PersonResult) {
    setBusyId(person.user.userId);
    setError(null);
    try {
      if (person.viewerFollows) {
        await unfollowUser(person.user.userId);
      } else {
        await followUser(person.user.userId);
      }
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
    } catch {
      setError("Couldn't update who you follow.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <View style={styles.page}>
        {error ? <Toast visible message={error} tone="error" /> : null}
        <FlatList
          data={results}
          keyExtractor={(item) => item.user.userId}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              <Input
                label="Search people"
                value={query}
                onChangeText={setQuery}
                placeholder="Search by username"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
              {needle.length === 0 && results.length > 0 ? (
                <Text accessibilityRole="header" {...dynamicType} style={[typography.caption, styles.suggestionsCaption, { color: colors.textDim }]}>
                  Readers you might like
                </Text>
              ) : null}
            </>
          }
          ListEmptyComponent={
            needle.length === 0 && suggested.isError ? (
              <ErrorState title="Couldn't load suggestions." actionLabel="Retry" onAction={() => void suggested.refetch()} />
            ) : needle.length > 0 && people.isError ? (
              <ErrorState title="Couldn't search." actionLabel="Retry" onAction={() => void people.refetch()} />
            ) : needle.length > 0 && !people.isPending ? (
              <EmptyState title="No people found" body="Try another username." />
            ) : (
              <EmptyState title="Find people" body="Search a username to follow them." />
            )
          }
          renderItem={({ item }) => {
            const glyphLabel = readerGlyphLabel(item.user.readerGlyph);
            const suggestion = "sharedCount" in item ? item : null;
            const caption = personCaption(item);
            return (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={[`Open ${item.user.username}'s profile`, glyphLabel, caption].filter(Boolean).join(", ")}
                  onPress={() => openProfile(item.user.username)}
                  style={[styles.actorRow, styles.grow]}
                >
                  <AuthorAvatar username={item.user.username} avatarUrl={item.user.avatarUrl} />
                  <View style={styles.grow}>
                    <View style={styles.nameRow}>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.metaName, { color: colors.text }]}>
                        {item.user.username}
                      </Text>
                      <ReaderGlyph identity={item.user.readerGlyph} />
                    </View>
                    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                      {caption}
                    </Text>
                  </View>
                  {suggestion?.sharedBooks.length ? (
                    <View style={styles.covers}>
                      {suggestion.sharedBooks.slice(0, 3).map((book, index) => (
                        <View key={`${index}:${book.coverUrl}`} style={index > 0 ? styles.overlap : undefined}>
                          <BookCover cover={book.coverUrl} title={book.title} width={24} height={36} />
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Pressable>
                {item.private ? null : (
                  <Button
                    label={item.viewerFollows ? "Following" : "Follow"}
                    variant={item.viewerFollows ? "secondary" : "primary"}
                    loading={busyId === item.user.userId}
                    onPress={() => void toggle(item)}
                  />
                )}
              </View>
            );
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  page: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaName: { flexShrink: 1 },
  suggestionsCaption: { marginTop: spacing.sm },
  covers: { flexDirection: "row", alignItems: "center" },
  overlap: { marginLeft: -6 },
});
