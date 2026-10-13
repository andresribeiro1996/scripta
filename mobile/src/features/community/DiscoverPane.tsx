import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { CycleButton, EmptyState, ErrorState, SearchDock, Skeleton, Toast, dockClearance, spacing, useDockScroll, type IconName } from "../../ui";
import { ArenaBooksSheet } from "../arena/ArenaBooksSheet";
import { fetchDiscover } from "./api";
import { DISCOVER_FILTERS, type DiscoverFilter } from "./communityHome";
import { AddBookSheet } from "./AddBookSheet";
import { useDebouncedValue } from "../library/lib/debounce";
import { DiscoverRow } from "./DiscoverRow";

const FILTER_ICONS: Record<DiscoverFilter, IconName> = { all: "filter", tierlist: "tierlist", tournament: "bracket", quiz: "champion" };
const FILTER_OPTIONS = DISCOVER_FILTERS.map((option) => ({ ...option, icon: FILTER_ICONS[option.value] }));

export function DiscoverPane({ linkAuthors = true }: { linkAuthors?: boolean }) {
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
  const { scrolling, scrollProps } = useDockScroll();

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.grow}>
      {discover.isRefetchError && !discover.isRefetching ? <Toast visible message="Couldn't refresh Discover." tone="error" /> : null}
      <View style={styles.grow}>
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
              {...scrollProps}
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
        <SearchDock
          hidden={scrolling}
          accessibilityLabel="Search tier lists, tournaments and quizzes by name or book"
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          trailing={<CycleButton options={FILTER_OPTIONS} value={filter} onChange={setFilter} />}
        />
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
  list: { paddingTop: spacing.lg - spacing.md, paddingBottom: dockClearance, flexGrow: 1 },
});
