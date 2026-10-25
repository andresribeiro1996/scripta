import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View, type TextInput } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Stack, router, useNavigation } from "expo-router";
import { looksLikeIsbnQuery, matchesSearch, withWorkIds, workIdOf, type BookSearchResult } from "@scripta/shared";
import { ErrorState, IconButton, Screen, SearchDock, Skeleton, SwipeableTabs, Toast, searchDockClearance, spacing } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { fetchDiscover, searchPeople } from "../community/api";
import { useFollowToggle } from "../community/useFollowToggle";
import { bookSearchApi, searchCatalogWorks } from "../library/api/search";
import { useLibrary } from "../library/hooks/useLibrary";
import { useDebouncedValue } from "../library/lib/debounce";
import { receiveScans } from "./scanBridge";
import { SearchIdle } from "./SearchIdle";
import { SearchResultRow, type ResultActions } from "./SearchResultRow";
import { SEARCH_SCOPES, isNetworkQuery, mergeBookResults, searchQueryFromParam, searchRows, type ResultSection, type SearchScope } from "./searchModel";
import { useRecentSearches } from "./useRecentSearches";

type TabsNavigation = { addListener: (type: "tabPress", listener: () => void) => () => void };

export function SearchScreen({ q, t }: { q?: string | string[]; t?: string | string[] }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [adding, setAdding] = useState<BookSearchResult | null>(null);
  const recent = useRecentSearches();
  const follow = useFollowToggle();
  const library = useLibrary();
  const navigation = useNavigation();
  const inputRef = useRef<TextInput>(null);
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const needle = submitted ?? (isNetworkQuery(trimmed) ? debounced : trimmed);
  const network = isNetworkQuery(needle);

  const catalog = useQuery({ queryKey: ["search", "books", needle], queryFn: () => searchCatalogWorks(needle), enabled: network, placeholderData: keepPreviousData, retry: false });
  const external = useQuery({
    queryKey: ["search", "external", submitted],
    queryFn: () => bookSearchApi.outside(submitted ?? ""),
    enabled: network && (scope === "all" || scope === "books") && submitted !== null && (!looksLikeIsbnQuery(submitted) || (catalog.isSuccess && !catalog.isPlaceholderData && catalog.data.length === 0)),
    staleTime: Infinity,
    retry: false,
  });
  const people = useQuery({ queryKey: ["community", "people", "search", needle], queryFn: () => searchPeople(needle), enabled: network, placeholderData: keepPreviousData, retry: false });
  const games = useInfiniteQuery({
    queryKey: ["community", "discover", "all", needle],
    queryFn: ({ pageParam }) => fetchDiscover("all", needle, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: network,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const books = useMemo(() => library.data?.data.books ?? [], [library.data]);
  const libraryRows = useMemo(() => books.filter((book) => matchesSearch(book, trimmed)), [books, trimmed]);
  const listedWorks = useMemo(() => new Set(withWorkIds(libraryRows, library.data?.works).flatMap((book) => workIdOf(book) ?? [])), [libraryRows, library.data]);
  const bookRows = useMemo(() => mergeBookResults(catalog.data ?? [], external.data ?? [], books, listedWorks), [catalog.data, external.data, books, listedWorks]);
  const gameRows = games.data?.pages.flatMap((page) => page.items) ?? [];
  const rowsFor = (scope: SearchScope) => searchRows({
    scope,
    query: needle,
    submitted: submitted !== null,
    library: { rows: libraryRows, loading: library.isLoading, failed: library.isError && !library.data },
    books: { rows: bookRows, loading: catalog.isLoading && bookRows.length === 0, failed: catalog.isError && !catalog.data },
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

  function searchBooks(text: string) {
    setScope((current) => (current === "people" || current === "games" ? "books" : current));
    submit(text);
  }

  const searchBooksRef = useRef(searchBooks);
  searchBooksRef.current = searchBooks;
  useEffect(() => receiveScans((isbn) => searchBooksRef.current(isbn)), []);

  const incoming = searchQueryFromParam(q);
  const nonce = searchQueryFromParam(t);
  useEffect(() => {
    if (incoming) searchBooksRef.current(incoming);
  }, [incoming, nonce]);

  useEffect(() => navigation.getParent<TabsNavigation>()?.addListener("tabPress", () => {
    if (navigation.isFocused()) inputRef.current?.focus();
  }), [navigation]);

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
      <Stack.Screen options={{ title: "Search", headerShown: true, headerLargeTitleEnabled: false, headerRight: () => <IconButton name="scan" accessibilityLabel="Scan a book's barcode" onPress={() => router.push("/scan" as never)} /> }} />
      <SearchDock
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setSubmitted(null);
        }}
        onSubmitEditing={() => submit(query)}
        inputRef={inputRef}
        accessibilityLabel="Search books, people and games"
        placeholder="Books, people, games"
      >
        {(scrollProps) => (
          <SwipeableTabs
            accessibilityLabel="Search in"
            options={SEARCH_SCOPES}
            value={scope}
            onChange={setScope}
            renderPage={(pageScope) =>
              trimmed ? (
                <FlatList
                  data={rowsFor(pageScope)}
                  keyExtractor={(row) => row.key}
                  {...scrollProps}
                  contentContainerStyle={styles.list}
                  onEndReached={() => {
                    if (pageScope === "games" && games.hasNextPage && !games.isFetchingNextPage && !games.isFetchNextPageError) void games.fetchNextPage();
                  }}
                  onEndReachedThreshold={0.4}
                  ListFooterComponent={
                    pageScope !== "games" ? null : games.isFetchingNextPage ? (
                      <View style={styles.footer}><Skeleton height={80} /></View>
                    ) : games.isFetchNextPageError ? (
                      <View style={styles.footer}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void games.fetchNextPage()} /></View>
                    ) : null
                  }
                  renderItem={({ item }) => <SearchResultRow row={item} actions={actions} />}
                />
              ) : (
                <SearchIdle scope={pageScope} recent={recent.searches} onRecent={submit} onClearRecent={recent.clear} follow={follow} scrollProps={scrollProps} />
              )
            }
          />
        )}
      </SearchDock>
      {follow.error ? <Toast visible message={follow.error} tone="error" /> : null}
      {adding ? (
        <AddBookSheet
          book={{ title: adding.title, author: adding.authors.join(", "), isbn: adding.isbn, coverUrl: adding.coverUrl, year: adding.year, publisher: adding.publisher, workId: adding.workId }}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: searchDockClearance },
  footer: { padding: spacing.lg },
});
