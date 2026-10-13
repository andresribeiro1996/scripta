import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Animated, Dimensions, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { EmptyState, ErrorState, Icon, Input, Skeleton, Toast, minimumTouchTarget, radii, spacing, useReducedMotion, useTheme, type IconName } from "../../ui";
import { ArenaBooksSheet } from "../arena/ArenaBooksSheet";
import { fetchDiscover } from "./api";
import { DISCOVER_FILTERS, type DiscoverFilter } from "./communityHome";
import { AddBookSheet } from "./AddBookSheet";
import { useDebouncedValue } from "../library/lib/debounce";
import { DiscoverRow } from "./DiscoverRow";

const FILTER_ICONS: Record<DiscoverFilter, IconName> = { all: "filter", tierlist: "tierlist", tournament: "bracket", quiz: "champion" };

export function DiscoverPane({ linkAuthors = true }: { linkAuthors?: boolean }) {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<DiscoverFilter>("all");
  const [search, setSearch] = useState("");
  const needle = useDebouncedValue(search.trim(), 300);
  const discover = useInfiniteQuery({
    queryKey: ["community", "discover", filter, needle],
    queryFn: ({ pageParam }) => fetchDiscover(filter, needle, pageParam),
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
      {discover.isRefetchError && !discover.isRefetching ? <Toast visible message="Couldn't refresh Discover." tone="error" /> : null}
      <View ref={frame} style={styles.grow}>
        <View style={styles.grow}>
          {discover.isPending ? (
            <View style={styles.page}>
              <Skeleton height={160} />
            </View>
          ) : discover.isError && !discover.data ? (
            <View style={styles.page}>
              <ErrorState body="Couldn't load tier lists, tournaments and quizzes." actionLabel="Retry" onAction={() => void discover.refetch()} />
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
                  {needle ? (
                    <EmptyState title={`No games match “${needle}”.`} body="Try another name or book." />
                  ) : (
                    <EmptyState title="Nothing published yet" body="Check back later for new tier lists, tournaments and quizzes." />
                  )}
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
              renderItem={({ item }) => <DiscoverRow item={item} onPreviewBooks={setPreview} linkAuthor={linkAuthors} />}
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
              accessibilityLabel="Search tier lists, tournaments and quizzes by name or book"
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

const styles = StyleSheet.create({
  grow: { flex: 1 },
  page: { flex: 1, padding: spacing.lg },
  list: { paddingTop: spacing.lg - spacing.md, paddingBottom: minimumTouchTarget + spacing.lg * 2, flexGrow: 1 },
  dock: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  searchField: { borderRadius: radii.full },
  cycle: { alignItems: "center", justifyContent: "center", width: minimumTouchTarget, height: minimumTouchTarget, borderWidth: 1, borderRadius: radii.full },
});
