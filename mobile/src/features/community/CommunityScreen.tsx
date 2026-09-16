import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Button, EmptyState, ErrorState, IconButton, Input, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import type { DiscoverItem, PersonResult } from "@scripta/shared/community";
import { fetchDiscover, fetchFeed, followUser, searchPeople, unfollowUser } from "./api";
import {
  COMMUNITY_TABS,
  DISCOVER_FILTERS,
  contentDetail,
  contentKindLabel,
  contentTarget,
  feedHeading,
  feedTarget,
  type CommunityTab,
  type DiscoverFilter,
} from "./communityHome";

export function CommunityScreen() {
  const [tab, setTab] = useState<CommunityTab>("feed");
  const { user } = useAuth();

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Community",
          headerLargeTitleEnabled: false,
          headerRight: () => (
            <IconButton
              accessibilityLabel="My profile"
              name="profile"
              onPress={() => router.push(`/u/${user!.username}` as never)}
            />
          ),
        }}
      />
      <SwipeableTabs
        accessibilityLabel="Community section"
        options={COMMUNITY_TABS}
        value={tab}
        onChange={setTab}
        renderPage={(pageTab) => {
          if (pageTab === "feed") return <FeedPane />;
          if (pageTab === "discover") return <DiscoverPane />;
          return <PeoplePane />;
        }}
      />
    </Screen>
  );
}

function AuthorAvatar({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
  const { colors } = useTheme();
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} contentFit="cover" style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[typography.caption, { color: colors.accent }]}>
        {username.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

function openProfile(username: string) {
  router.push(`/u/${username}` as never);
}

function FeedPane() {
  const { colors } = useTheme();
  const feed = useInfiniteQuery({
    queryKey: ["community", "feed"],
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  if (feed.isPending) return <View style={styles.page}><Skeleton height={120} /></View>;
  if (feed.isError)
    return <View style={styles.page}><ErrorState body="Couldn't load the feed." actionLabel="Retry" onAction={() => void feed.refetch()} /></View>;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={feed.isRefetching}
      onRefresh={() => void feed.refetch()}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={
        <EmptyState title="Nothing here yet" body="Follow people from Discover or People to see what they publish." />
      }
      ListFooterComponent={feed.isFetchingNextPage ? <Skeleton height={80} /> : null}
      renderItem={({ item }) => (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.actor.username}'s profile`}
            onPress={() => openProfile(item.actor.username)}
            style={styles.actorRow}
          >
            <AuthorAvatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} />
            <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
              {feedHeading(item)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${item.content.name}`}
            onPress={() => router.push(feedTarget(item) as never)}
          >
            <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
              {item.content.name}
            </Text>
            <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
              {contentDetail(item.content)}
            </Text>
          </Pressable>
        </View>
      )}
    />
  );
}

function DiscoverPane() {
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

  if (discover.isPending) return <View style={styles.page}><Skeleton height={160} /></View>;
  if (discover.isError)
    return <View style={styles.page}><ErrorState body="Couldn't load published games." actionLabel="Retry" onAction={() => void discover.refetch()} /></View>;

  return (
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

function PeoplePane() {
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
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  page: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 28, height: 28, borderRadius: radii.full },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  headerGap: { gap: spacing.sm, marginBottom: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
