import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, EmptyState, Input, Screen, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import type { PersonResult } from "@scripta/shared/community";
import { followUser, searchPeople, unfollowUser } from "./api";
import { AuthorAvatar, openProfile } from "./AuthorAvatar";

export function PeopleScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needle = query.trim();
  const people = useQuery({
    queryKey: ["community", "people", needle],
    queryFn: () => searchPeople(needle),
    enabled: needle.length > 0,
    retry: false,
  });
  const results = people.data?.people ?? [];

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
    <Screen top={false}>
      <Stack.Screen options={{ title: "People", headerShown: true, headerLargeTitleEnabled: false }} />
      <View style={styles.page}>
        {error ? <Toast visible message={error} tone="error" /> : null}
        <FlatList
          data={results}
          keyExtractor={(item) => item.user.userId}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
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
          }
          ListEmptyComponent={
            needle.length > 0 && !people.isPending ? (
              <EmptyState title="No people found" body="Try another username." />
            ) : (
              <EmptyState title="Find people" body="Search a username to follow them." />
            )
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.user.username}'s profile`}
                onPress={() => openProfile(item.user.username)}
                style={[styles.actorRow, styles.grow]}
              >
                <AuthorAvatar username={item.user.username} avatarUrl={item.user.avatarUrl} />
                <View style={styles.grow}>
                  <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>
                    {item.user.username}
                  </Text>
                  <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                    {item.followerCount} {item.followerCount === 1 ? "follower" : "followers"}
                  </Text>
                </View>
              </Pressable>
              <Button
                label={item.viewerFollows ? "Following" : "Follow"}
                variant={item.viewerFollows ? "secondary" : "primary"}
                loading={busyId === item.user.userId}
                onPress={() => void toggle(item)}
              />
            </View>
          )}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  page: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
