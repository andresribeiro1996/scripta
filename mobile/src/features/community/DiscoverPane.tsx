import { useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FlatList, StyleSheet, View } from "react-native";
import { EmptyState, ErrorState, SearchDock, Skeleton, Toast, searchDockClearance, searchDockFabClearance, spacing, type IconName } from "../../ui";
import { ArenaBooksSheet } from "../arena/ArenaBooksSheet";
import { fetchDiscover } from "./api";
import { DISCOVER_FILTERS, type DiscoverFilter } from "./communityHome";
import { AddBookSheet } from "./AddBookSheet";
import { useDebouncedValue } from "../library/lib/debounce";
import { DiscoverRow } from "./DiscoverRow";

const FILTER_ICONS: Record<DiscoverFilter, IconName> = { all: "filter", tierlist: "tierlist", tournament: "bracket", quiz: "champion" };

export function DiscoverPane({ linkAuthors = true, fab }: { linkAuthors?: boolean; fab?: ReactNode }) {
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
  const [preview, setPreview] = useState<{ id: string; name: string; character: boolean } | null>(null);
  const [addBook, setAddBook] = useState<{ title: string; author: string; coverUrl?: string | null } | null>(null);
  const index = DISCOVER_FILTERS.findIndex((option) => option.value === filter);
  const current = DISCOVER_FILTERS[index];
  const next = DISCOVER_FILTERS[(index + 1) % DISCOVER_FILTERS.length];

  return (
    <View style={styles.grow}>
      {discover.isRefetchError && !discover.isRefetching ? <Toast visible message="Couldn't refresh Discover." tone="error" /> : null}
      <SearchDock
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="Search tier lists, tournaments and quizzes by name or book"
        placeholder="Search"
        fab={fab}
        cycle={{
          icon: FILTER_ICONS[filter],
          active: filter !== "all",
          accessibilityLabel: `Showing ${current.label.toLowerCase()}`,
          accessibilityHint: "Switches to the next type",
          onPress: () => setFilter(next.value),
        }}
      >
        {(scrollProps) => discover.isPending ? (
          <View style={styles.page}>
            <Skeleton height={160} />
          </View>
        ) : discover.isError && !discover.data ? (
          <View style={styles.page}>
            <ErrorState body="Couldn't load tier lists, tournaments and quizzes." actionLabel="Retry" onAction={() => void discover.refetch()} />
          </View>
        ) : (
          <FlatList
            {...scrollProps}
            data={items}
            keyExtractor={(item) => `${item.content.kind}:${item.content.id}`}
            contentContainerStyle={[styles.list, fab ? styles.fabClearance : null]}
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
      </SearchDock>
      <ArenaBooksSheet
        id={preview?.id ?? null}
        name={preview?.name ?? "Tournament"}
        character={preview?.character}
        onAddBook={(book) => {
          setPreview(null);
          setAddBook(book);
        }}
        onClose={() => setPreview(null)}
      />
      {addBook ? <AddBookSheet book={addBook} onClose={() => setAddBook(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  page: { flex: 1, padding: spacing.lg },
  list: { paddingTop: spacing.lg - spacing.md, paddingBottom: searchDockClearance, flexGrow: 1 },
  fabClearance: { paddingBottom: searchDockFabClearance },
});
