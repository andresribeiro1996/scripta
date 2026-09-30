import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Image } from "expo-image";
import { Animated, Dimensions, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { DEFAULT_TIER_PRESET, readerGlyphLabel } from "@scripta/shared";
import { EmptyState, ErrorState, Icon, Input, Skeleton, dynamicType, minimumTouchTarget, radii, spacing, typography, useReducedMotion, useTheme, type IconName } from "../../ui";
import type { ContentTone, DiscoverItem, PublishedContent } from "@scripta/shared/community";
import { useAuth } from "../../core/auth";
import { ArenaBooksSheet } from "../arena/ArenaBooksSheet";
import { fetchDiscover } from "./api";
import { DISCOVER_FILTERS, contentKindLabel, contentStats, contentStatus, contentTarget, type DiscoverFilter } from "./communityHome";
import { AddBookSheet } from "./AddBookSheet";
import { openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";

const FILTER_ICONS: Record<DiscoverFilter, IconName> = { all: "filter", tierlist: "tierlist", tournament: "bracket" };

export function DiscoverPane() {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<DiscoverFilter>("all");
  const [search, setSearch] = useState("");
  const needle = search.trim();
  const { user } = useAuth();
  const discover = useInfiniteQuery({
    queryKey: ["community", "discover", filter, needle],
    queryFn: ({ pageParam }) => fetchDiscover(filter, needle, pageParam, Boolean(user)),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    retry: false,
  });
  const items = discover.data?.pages.flatMap((page) => page.items) ?? [];
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [addBook, setAddBook] = useState<{ title: string; author: string; coverUrl?: string | null } | null>(null);
  const index = DISCOVER_FILTERS.findIndex((option) => option.value === filter);
  const current = DISCOVER_FILTERS[index];
  const next = DISCOVER_FILTERS[(index + 1) % DISCOVER_FILTERS.length];
  const frame = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const reducedMotion = useReducedMotion();
  const dock = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      dock.setValue(scrolling ? 0 : 1);
      return;
    }
    Animated.timing(dock, { duration: 180, toValue: scrolling ? 0 : 1, useNativeDriver: true }).start();
  }, [dock, reducedMotion, scrolling]);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => {
      frame.current?.measureInWindow((_x, y, _width, height) => {
        setOverlap(Math.max(0, Math.min(height, y + height - (Dimensions.get("window").height - event.endCoordinates.height))));
      });
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => setOverlap(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.grow}>
      <View ref={frame} style={styles.grow}>
        <View style={styles.grow}>
          {discover.isPending ? (
            <View style={styles.page}>
              <Skeleton height={160} />
            </View>
          ) : discover.isError && !discover.data ? (
            <View style={styles.page}>
              <ErrorState body="Couldn't load tier lists and tournaments." actionLabel="Retry" onAction={() => void discover.refetch()} />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => `${item.content.kind}:${item.content.id}`}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            onScrollBeginDrag={() => setScrolling(true)}
            onScrollEndDrag={() => setScrolling(false)}
            onMomentumScrollBegin={() => setScrolling(true)}
            onMomentumScrollEnd={() => setScrolling(false)}
              refreshing={discover.isRefetching}
              onRefresh={() => void discover.refetch()}
              ListEmptyComponent={
                <View style={styles.page}>
                  <EmptyState title="Nothing published yet" body="Check back later for new tier lists and tournaments." />
                </View>
              }
              onEndReached={() => {
                if (discover.hasNextPage && !discover.isFetchingNextPage && !discover.isFetchNextPageError) void discover.fetchNextPage();
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                discover.isFetchingNextPage ? (
                  <View style={styles.page}><Skeleton height={80} /></View>
                ) : discover.isFetchNextPageError ? (
                  <View style={styles.page}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void discover.fetchNextPage()} /></View>
                ) : null
              }
              renderItem={({ item }) => <DiscoverRow item={item} onPreviewBooks={setPreview} />}
            />
          )}
        </View>
        <Animated.View
          pointerEvents={scrolling ? "none" : "box-none"}
          style={[styles.dock, { bottom: overlap, opacity: dock, transform: [{ translateY: dock.interpolate({ inputRange: [0, 1], outputRange: [minimumTouchTarget, 0] }) }] }]}
        >
          <View style={styles.grow}>
            <Input
              icon="search"
              accessibilityLabel="Search tier lists and tournaments"
              value={search}
              onChangeText={setSearch}
              placeholder="Search"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={styles.searchField}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Showing ${current.label.toLowerCase()}`}
            accessibilityHint="Switches to the next type"
            onPress={() => setFilter(next.value)}
            style={[styles.cycle, { borderColor: colors.border, backgroundColor: filter === "all" ? colors.surface : colors.accentSoft }]}
          >
            <Icon name={FILTER_ICONS[filter]} size={20} color={filter === "all" ? colors.textDim : colors.text} />
          </Pressable>
        </Animated.View>
      </View>
      <ArenaBooksSheet
        id={preview?.id ?? null}
        name={preview?.name ?? "Tournament"}
        onAddBook={(book) => {
          setPreview(null);
          setAddBook(book);
        }}
        onClose={() => setPreview(null)}
      />
      {addBook ? <AddBookSheet book={addBook} onClose={() => setAddBook(null)} /> : null}
    </KeyboardAvoidingView>
  );
}

function DiscoverRow({ item, onPreviewBooks }: { item: DiscoverItem; onPreviewBooks: (tournament: { id: string; name: string }) => void }) {
  const { colors } = useTheme();
  const { content, author } = item;
  const status = contentStatus(content);
  const glyphLabel = readerGlyphLabel(author.readerGlyph);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${content.name}`} onPress={() => router.push(contentTarget(content) as never)}>
      {({ pressed }) => (
        <View style={[styles.row, { backgroundColor: pressed ? colors.surfacePressed : "transparent", borderBottomColor: colors.border }]}>
          {content.kind === "tierlist" ? <TierlistThumb covers={content.covers} /> : <TournamentThumb covers={content.covers} />}
          <View style={styles.grow}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>
              {content.name}
            </Text>
            <View style={styles.metaRow}>
              <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                {contentKindLabel(content)} ·{" "}
              </Text>
              {author.unavailable ? (
                <View style={[styles.nameRow, styles.shrink]}>
                  <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.metaName, { color: colors.textDim }]}>
                    {author.username}
                  </Text>
                  <ReaderGlyph identity={author.readerGlyph} />
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={glyphLabel ? `Open ${author.username}'s profile, ${glyphLabel}` : `Open ${author.username}'s profile`}
                  hitSlop={spacing.sm}
                  onPress={() => openProfile(author.username)}
                  style={[styles.nameRow, styles.shrink]}
                >
                  <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.metaName, { color: colors.textDim }]}>
                    {author.username}
                  </Text>
                  <ReaderGlyph identity={author.readerGlyph} />
                </Pressable>
              )}
            </View>
            <View style={styles.statusRow}>
              <StatusBadge label={status.label} tone={status.tone} />
              {status.votedBadge ? <StatusBadge label="Voted" tone="info" /> : null}
              {contentStats(content).map((stat) => (
                <Text key={stat.label} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  <Text style={[styles.strong, { color: colors.text }]}>{stat.value}</Text> {stat.label}
                </Text>
              ))}
              {content.kind === "tournament" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`See all ${content.bookCount} books in ${content.name}`}
                  hitSlop={spacing.sm}
                  onPress={() => onPreviewBooks({ id: content.id, name: content.name })}
                >
                  <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>See books</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: ContentTone }) {
  const { colors } = useTheme();
  const palette = {
    neutral: { borderColor: colors.border, backgroundColor: colors.surface, color: colors.textDim },
    accent: { borderColor: colors.accent, backgroundColor: colors.accentSoft, color: colors.accent },
    info: { borderColor: colors.info, backgroundColor: colors.infoSoft, color: colors.info },
    success: { borderColor: colors.success, backgroundColor: colors.successSoft, color: colors.success },
    reference: { borderColor: colors.reference, backgroundColor: colors.referenceSoft, color: colors.reference },
  }[tone];
  return (
    <View style={[styles.badge, { borderColor: palette.borderColor, backgroundColor: palette.backgroundColor }]}>
      <Text {...dynamicType} style={[typography.caption, styles.strong, { color: palette.color }]}>
        {label}
      </Text>
    </View>
  );
}

function TierlistThumb({ covers }: { covers: PublishedContent["covers"] }) {
  const { colors } = useTheme();
  const fan: Array<string | null> = covers.length ? covers.slice(0, 3) : [null];
  const middle = (fan.length - 1) / 2;
  return (
    <View style={styles.thumb} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={styles.ladder}>
        {DEFAULT_TIER_PRESET.map((tier) => (
          <View key={tier.label} style={[styles.grow, { backgroundColor: tier.color }]} />
        ))}
      </View>
      {fan.map((cover, index) => (
        <Cover
          key={cover ?? index}
          uri={cover}
          style={{
            left: FAN_INSET + index * FAN_STEP + (3 - fan.length) * (FAN_STEP / 2),
            top: (THUMB_HEIGHT - FAN_HEIGHT) / 2,
            width: FAN_WIDTH,
            height: FAN_HEIGHT,
            zIndex: index,
            borderColor: colors.background,
            transform: [{ rotate: `${(index - middle) * FAN_TILT}deg` }],
          }}
        />
      ))}
    </View>
  );
}

function TournamentThumb({ covers }: { covers: PublishedContent["covers"] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.thumb} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {[covers[0] ?? null, covers[1] ?? null].map((cover, index) => (
        <Cover
          key={index}
          uri={cover}
          style={{ left: index * (PAIR_WIDTH + PAIR_GAP), top: (THUMB_HEIGHT - PAIR_HEIGHT) / 2, width: PAIR_WIDTH, height: PAIR_HEIGHT, borderColor: colors.background }}
        />
      ))}
      <View style={[styles.versus, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text allowFontScaling={false} style={[styles.versusText, { color: colors.text }]}>VS</Text>
      </View>
    </View>
  );
}

function Cover({ uri, style }: { uri: string | null; style: object }) {
  const { colors } = useTheme();
  return uri ? (
    <Image source={{ uri }} contentFit="cover" style={[styles.cover, style]} />
  ) : (
    <View style={[styles.cover, style, { backgroundColor: colors.border }]} />
  );
}

const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 58;
const LADDER_WIDTH = 4;
const FAN_INSET = LADDER_WIDTH + 6;
const FAN_WIDTH = 34;
const FAN_HEIGHT = 51;
const FAN_STEP = (THUMB_WIDTH - FAN_INSET - FAN_WIDTH) / 2;
const FAN_TILT = 6;
const PAIR_GAP = 4;
const PAIR_WIDTH = (THUMB_WIDTH - PAIR_GAP) / 2;
const PAIR_HEIGHT = 45;
const VERSUS_WIDTH = 26;

const styles = StyleSheet.create({
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "600" },
  page: { flex: 1, padding: spacing.lg },
  list: { paddingTop: spacing.lg - spacing.md, paddingBottom: minimumTouchTarget + spacing.lg * 2, flexGrow: 1 },
  dock: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  searchField: { borderRadius: radii.full },
  cycle: { alignItems: "center", justifyContent: "center", width: minimumTouchTarget, height: minimumTouchTarget, borderWidth: 1, borderRadius: radii.full },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  metaRow: { flexDirection: "row", alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaName: { flexShrink: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  badge: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm },
  thumb: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
  ladder: { position: "absolute", left: 0, top: (THUMB_HEIGHT - FAN_HEIGHT) / 2, width: LADDER_WIDTH, height: FAN_HEIGHT, borderRadius: 2, overflow: "hidden" },
  cover: { position: "absolute", borderRadius: 3, borderWidth: 1 },
  versus: { position: "absolute", left: (THUMB_WIDTH - VERSUS_WIDTH) / 2, top: THUMB_HEIGHT / 2 - 9, width: VERSUS_WIDTH, height: 18, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center", zIndex: 10 },
  versusText: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
});
