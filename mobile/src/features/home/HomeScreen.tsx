import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { buildDashboardCards, digestHeading, digestTarget, resolveQuote, type DigestItem } from "@scripta/shared";
import { ApiError } from "../../core/api";
import { Button, EmptyState, ErrorState, Icon, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { useLibrary } from "../library/hooks/useLibrary";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { CoverFan, SLOT_HEIGHT, SLOT_WIDTH } from "../community/CoverFan";
import { DiscoverPane } from "../community/DiscoverPane";
import { PeoplePane } from "../community/PeoplePane";
import { fetchDashboard, followUser, markDashboardSeen } from "../community/api";
import { defaultHomeTab, homeTabOptions, type HomeTab } from "./homeTabs";
import { feedRowModel, relativeTime } from "./feedRow";

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const library = useLibrary();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<HomeTab>("activity");
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const tabInitedRef = useRef(false);
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
  const cards = user ? buildDashboardCards(books, day, `${user.id}:${offset}`) : [];
  const rediscoverCard = cards.find((card) => card.kind === "rediscover");
  const quote = rediscoverCard ? resolveQuote({ type: "quote", bookKey: rediscoverCard.bookKey, highlightId: rediscoverCard.highlightId } as never, books) : null;

  // Picks the opening tab once real data has arrived, then leaves the user's
  // own tab choice alone — otherwise a later refetch could yank them back to
  // Discover mid-swipe just because Activity happened to be empty on load.
  useEffect(() => {
    if (!tabInitedRef.current && dashboard.data) {
      tabInitedRef.current = true;
      setTab(defaultHomeTab(items.length));
    }
  }, [dashboard.data, items.length]);

  // Refetches rather than patching the row in place: the follow lands as an
  // event of its own, so the feed has more to say afterwards than just this
  // row's new state.
  async function followBack(userId: string) {
    setFollowingId(userId);
    try {
      await followUser(userId);
      await dashboard.refetch();
    } catch (reason) {
      setFollowError(reason instanceof ApiError ? reason.message : "Couldn't follow them. Try again.");
    } finally {
      setFollowingId(null);
    }
  }

  // Mobile's profile route is /u/<name>; the shared target is the web app's
  // /community/u/<name>, so the two kinds that point at a person are remapped.
  function digestRoute(item: DigestItem): string {
    return item.kind === "follow" || item.kind === "reading" ? `/u/${item.actor.username}` : digestTarget(item);
  }

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Home",
          headerShown: true,
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
        <View style={styles.grow}>
          {followError ? <Toast visible message={followError} tone="error" /> : null}
          {!books.length ? (
            <View style={styles.page}>
              <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book manually" onSecondaryAction={() => router.push("/add-book" as never)} />
            </View>
          ) : quote ? (
            <View style={styles.page}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>Rediscover</Text>
                <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{String(quote.highlight.Text)}</Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  {String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}
                </Text>
                <Button label="Show another" variant="secondary" onPress={() => setOffset((value) => value + 1)} />
              </View>
            </View>
          ) : null}
          <SwipeableTabs
            accessibilityLabel="Home sections"
            options={homeTabOptions(newCount)}
            value={tab}
            onChange={setTab}
            renderPage={(value) => {
              if (value === "discover") return <DiscoverPane />;
              if (value === "people") return <PeoplePane />;
              return (
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
                  ListEmptyComponent={
                    <Text {...dynamicType} style={[typography.caption, styles.emptyFeed, { color: colors.textDim }]}>
                      Nothing here yet. Follow people to see what they publish.
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <FeedRow
                      item={item}
                      onOpen={() => router.push(digestRoute(item) as never)}
                      onFollowBack={() => void followBack(item.actor.userId)}
                      following={followingId === item.actor.userId}
                    />
                  )}
                />
              );
            }}
          />
        </View>
      )}
    </Screen>
  );
}

/** One activity row. The leading slot is always the same width and always
 *  starts at the same edge, so names line up down the feed; what fills it
 *  says how much the event is worth — a fan of covers for a publication, one
 *  for a book, the actor's avatar for anything that is only about them. */
function FeedRow({ item, onOpen, onFollowBack, following }: { item: DigestItem; onOpen: () => void; onFollowBack: () => void; following: boolean }) {
  const { colors } = useTheme();
  const row = feedRowModel(item);
  const labelColor = row.tone === "accent" ? colors.accent : row.tone === "success" ? colors.success : colors.textDim;

  return (
    <Pressable accessibilityRole="link" accessibilityLabel={digestHeading(item)} onPress={onOpen}>
      {({ pressed }) => (
        <View style={[styles.feedRow, { backgroundColor: pressed ? colors.surfacePressed : "transparent", borderBottomColor: colors.border }]}>
          <View style={styles.slot}>
            {row.covers.length ? (
              <>
                <CoverFan covers={row.covers} />
                <View style={[styles.slotAvatar, { borderColor: colors.background }]}>
                  <AuthorAvatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} />
                </View>
              </>
            ) : (
              // Nothing to preview, so the actor stands in for the covers —
              // at avatar size, not the fan-sized slot, which dwarfed a face.
              <AuthorAvatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} size={AVATAR_SIZE} />
            )}
          </View>
          <View style={styles.grow}>
            <View style={styles.labelRow}>
              <Icon name={row.icon} size={14} color={labelColor} />
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.heading, { color: labelColor }]}>
                {row.label}
              </Text>
              <Text {...dynamicType} style={[typography.caption, styles.timestamp, { color: colors.textDim }]}>
                {relativeTime(item.createdAt)}
              </Text>
            </View>
            {row.title ? (
              <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.heading, { color: colors.text }]}>
                {row.title}
              </Text>
            ) : null}
            <Text numberOfLines={2} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
              {row.meta}
            </Text>
            {row.action === "followBack" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Follow ${item.actor.username} back`}
                accessibilityState={{ busy: following }}
                disabled={following}
                hitSlop={spacing.sm}
                onPress={onFollowBack}
                style={styles.rowAction}
              >
                <Text {...dynamicType} style={[typography.caption, styles.heading, { color: following ? colors.textDim : colors.accent }]}>
                  {following ? "Following…" : "Follow back"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const BADGE_SIZE = 32;
const AVATAR_SIZE = 44;

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md },
  heading: { fontWeight: "700" },
  list: { paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  grow: { flex: 1 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  slot: { width: SLOT_WIDTH, height: SLOT_HEIGHT, justifyContent: "center", alignItems: "center" },
  // Sized explicitly rather than left to the avatar inside it: a box that
  // takes its height from its child sits flush against the slot's bottom
  // edge, where the ring reads as a flattened circle.
  slotAvatar: { position: "absolute", left: 0, bottom: 4, width: BADGE_SIZE, height: BADGE_SIZE, alignItems: "center", justifyContent: "center", borderRadius: radii.full, borderWidth: 2, overflow: "hidden", zIndex: 10 },
  // Centred, not baseline-aligned: a native symbol view has no text
  // baseline, and aligning to one collapses it to nothing.
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  timestamp: { flexShrink: 0, marginLeft: "auto" },
  emptyFeed: { padding: spacing.lg },
  // Padded to clear the 44px floor: the label alone is a 16px-tall target.
  rowAction: { minHeight: minimumTouchTarget - spacing.lg, justifyContent: "center", paddingVertical: spacing.xs },
});
