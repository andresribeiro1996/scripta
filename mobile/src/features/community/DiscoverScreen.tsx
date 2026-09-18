import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Input, Screen, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import type { DiscoverItem } from "@scripta/shared/community";
import { fetchDiscover } from "./api";
import { DISCOVER_FILTERS, contentDetail, contentKindLabel, contentTarget, type DiscoverFilter } from "./communityHome";
import { AuthorAvatar, openProfile } from "./AuthorAvatar";

export function DiscoverScreen() {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<DiscoverFilter>("all");
  const [search, setSearch] = useState("");
  const needle = search.trim();
  const discover = useQuery({
    queryKey: ["community", "discover", filter, needle],
    queryFn: () => fetchDiscover(filter, needle),
    retry: false,
  });
  const items = discover.data?.items ?? [];

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Discover", headerShown: true, headerLargeTitleEnabled: false }} />
      {discover.isPending ? (
        <View style={styles.page}>
          <Skeleton height={160} />
        </View>
      ) : discover.isError ? (
        <View style={styles.page}>
          <ErrorState body="Couldn't load published games." actionLabel="Retry" onAction={() => void discover.refetch()} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.content.kind}:${item.content.id}`}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshing={discover.isRefetching}
          onRefresh={() => void discover.refetch()}
          ListHeaderComponent={
            <View style={styles.headerGap}>
              <Input
                label="Search"
                value={search}
                onChangeText={setSearch}
                placeholder="Search published games"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
              <View style={styles.chips}>
                {DISCOVER_FILTERS.map((option) => {
                  const selected = filter === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setFilter(option.value)}
                      style={[styles.chip, { borderColor: colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
                    >
                      <Text {...dynamicType} style={[typography.caption, { color: selected ? colors.accent : colors.textDim }]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          }
          ListEmptyComponent={<EmptyState title="Nothing published yet" body="Check back later for new tier lists and tournaments." />}
          renderItem={({ item }) => <DiscoverCard item={item} />}
        />
      )}
    </Screen>
  );
}

function DiscoverCard({ item }: { item: DiscoverItem }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${item.content.name}`}
        onPress={() => router.push(contentTarget(item.content) as never)}
        style={styles.grow}
      >
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>
          {contentKindLabel(item.content)}
        </Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
          {item.content.name}
        </Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
          {contentDetail(item.content)}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.author.username}'s profile`}
        onPress={() => openProfile(item.author.username)}
        style={styles.actorRow}
      >
        <AuthorAvatar username={item.author.username} avatarUrl={item.author.avatarUrl} />
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
          {item.author.username}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  page: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerGap: { gap: spacing.sm, marginBottom: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
