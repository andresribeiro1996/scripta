import { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { looksLikeIsbnQuery, matchesSearch, type BookSearchResult } from "@scripta/shared";
import { ErrorState, IconButton, Input, Screen, Segmented, Skeleton, Toast, spacing } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { fetchDiscover, searchPeople } from "../community/api";
import { useFollowToggle } from "../community/useFollowToggle";
import { bookSearchApi, searchCatalogWorks } from "../library/api/search";
import { useLibrary } from "../library/hooks/useLibrary";
import { useDebouncedValue } from "../library/lib/debounce";
import { SearchIdle } from "./SearchIdle";
import { SearchResultRow, type ResultActions } from "./SearchResultRow";
import { SEARCH_SCOPES, isNetworkQuery, mergeBookResults, ownedBooks, searchRows, type ResultSection, type SearchScope } from "./searchModel";
import { useRecentSearches } from "./useRecentSearches";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [adding, setAdding] = useState<BookSearchResult | null>(null);
  const recent = useRecentSearches();
  const follow = useFollowToggle();
  const library = useLibrary();
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const needle = submitted ?? (isNetworkQuery(trimmed) ? debounced : trimmed);
  const network = isNetworkQuery(needle);
  const wantsBooks = network && (scope === "all" || scope === "books");
  const wantsPeople = network && (scope === "all" || scope === "people");
  const wantsGames = network && (scope === "all" || scope === "games");

  const catalog = useQuery({ queryKey: ["search", "books", needle], queryFn: () => searchCatalogWorks(needle), enabled: wantsBooks, placeholderData: keepPreviousData, retry: false });
  const external = useQuery({
    queryKey: ["search", "external", submitted],
    queryFn: () => bookSearchApi.outside(submitted ?? ""),
    enabled: wantsBooks && submitted !== null && (!looksLikeIsbnQuery(submitted) || (catalog.isSuccess && !catalog.isPlaceholderData && catalog.data.length === 0)),
    staleTime: Infinity,
    retry: false,
  });
  const people = useQuery({ queryKey: ["community", "people", "search", needle], queryFn: () => searchPeople(needle), enabled: wantsPeople, placeholderData: keepPreviousData, retry: false });
  const games = useInfiniteQuery({
    queryKey: ["community", "discover", "all", needle],
    queryFn: ({ pageParam }) => fetchDiscover("all", needle, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: wantsGames,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const books = library.data?.data.books ?? [];
  const bookRows = mergeBookResults(catalog.data ?? [], external.data ?? [], ownedBooks(books, library.data?.works));
  const gameRows = games.data?.pages.flatMap((page) => page.items) ?? [];
  const rows = searchRows({
    scope,
    query: needle,
    submitted: submitted !== null,
    library: { rows: books.filter((book) => matchesSearch(book, trimmed)), loading: library.isLoading, failed: library.isError && !library.data },
    books: { rows: bookRows, loading: catalog.isLoading && bookRows.length === 0, failed: catalog.isError && bookRows.length === 0 },
    people: { rows: people.data ?? [], loading: people.isLoading, failed: people.isError && !people.data },
    games: { rows: gameRows, loading: games.isLoading, failed: games.isError && gameRows.length === 0 },
    openLibrary: external.isError ? "failed" : external.isFetching ? "pending" : "idle",
  });

  function submit(text: string) {
    const next = text.trim();
    if (!next) return;
    setQuery(text);
    setSubmitted(next);
    recent.record(next);
  }

  const retries: Record<ResultSection, () => unknown> = { library: library.refetch, books: catalog.refetch, people: people.refetch, games: games.refetch };
  const actions: ResultActions = {
    query: needle,
    follow,
    onOpen: () => recent.record(trimmed),
    onAdd: setAdding,
    onSeeAll: setScope,
    onRetry: (section) => void retries[section](),
    onSearchOpenLibrary: () => submit(query),
    onRetryOpenLibrary: () => void external.refetch(),
  };

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Search", headerShown: true, headerLargeTitleEnabled: false }} />
      <View style={styles.top}>
        <View style={styles.field}>
          <View style={styles.grow}>
            <Input
              icon="search"
              accessibilityLabel="Search books, people and games"
              placeholder="Books, people, games"
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setSubmitted(null);
              }}
              onSubmitEditing={() => submit(query)}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          {query ? (
            <IconButton
              name="close"
              accessibilityLabel="Clear search"
              onPress={() => {
                setQuery("");
                setSubmitted(null);
              }}
            />
          ) : null}
        </View>
        <Segmented accessibilityLabel="Search in" options={SEARCH_SCOPES} value={scope} onChange={setScope} />
      </View>
      {trimmed ? (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          onEndReached={() => {
            if (scope === "games" && games.hasNextPage && !games.isFetchingNextPage && !games.isFetchNextPageError) void games.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            scope !== "games" ? null : games.isFetchingNextPage ? (
              <View style={styles.footer}><Skeleton height={80} /></View>
            ) : games.isFetchNextPageError ? (
              <View style={styles.footer}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void games.fetchNextPage()} /></View>
            ) : null
          }
          renderItem={({ item }) => <SearchResultRow row={item} actions={actions} />}
        />
      ) : (
        <SearchIdle scope={scope} recent={recent.searches} onRecent={submit} onClearRecent={recent.clear} follow={follow} />
      )}
      {follow.error ? <Toast visible message={follow.error} tone="error" /> : null}
      {adding ? (
        <AddBookSheet
          book={{ title: adding.title, author: adding.authors.join(", "), isbn: adding.isbn, coverUrl: adding.coverUrl, year: adding.year, workId: adding.workId }}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  top: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  field: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  list: { paddingBottom: spacing.huge },
  footer: { padding: spacing.lg },
});
