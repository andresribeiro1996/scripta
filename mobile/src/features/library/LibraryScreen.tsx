// The native Library tab — mirrors frontend's pages/LibraryPage.tsx. Every
// panel it used to present as a modal (book detail, add, import, reorder,
// share, per-book style and cover) is now a sibling route presented as a form
// sheet, so each one is a real UISheetPresentationController the user can drag
// away. Search now lives in the native header bar and the status/sort choices
// in the overflow menu, so what is left here is the grid and selection mode.
//
// "Collections" is one more page in the same swipeable strip as the shelf
// tabs, not a separate destination behind the overflow menu — Series and
// Collections were easy to miss there. It renders GroupsView, which lists
// both (they're the same underlying resource) as tappable rows into
// GroupDetail; the standalone /collections route still exists for deep
// links (e.g. Home's "Open collection", which goes straight to a group's
// detail screen). The header search bar and its "+" button are re-pointed
// at groups instead of books while this tab is active.

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import {
  bookKey,
  effectiveCardStyle,
  filterBooks,
  LIBRARY_STATUS_TABS,
  orderLibraryBooks,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  sortBooks,
  SORT_OPTIONS,
  type LibraryStatusTab,
  type PerCardStyle,
  type SortKey,
} from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Sheet, Skeleton, SwipeableTabs, type MenuItem } from "../../ui/components";
import type { SearchBarCommands } from "react-native-screens";
import { spacing } from "../../ui/theme";
import { useMurals } from "../murals/useMurals";
import { useLibrary } from "./hooks/useLibrary";
import { useLibraryActions } from "./hooks/useLibraryActions";
import { BookCard } from "./components/BookCard";
import { GroupsView, type GroupsViewHandle } from "./components/GroupsView";
import { LibraryGrid } from "./components/LibraryGrid";

type LibraryTab = LibraryStatusTab | "collections";

const LIBRARY_TABS: readonly { value: LibraryTab; label: string }[] = [...LIBRARY_STATUS_TABS, { value: "collections", label: "Collections" }];

export function LibraryScreen() {
  const { data: library, isPending, isError, error, refetch, isRefetching } = useLibrary();
  const actions = useLibraryActions();
  const murals = useMurals();

  // Home hands its search over as ?q=. The native search bar owns its own
  // text, so both have to be driven: `setText`/`clearText` are the only way to
  // move the visible field, and without them the grid would filter against a
  // query the header never shows. Both platforms implement them (Android via
  // SearchBarManager).
  const { q } = useLocalSearchParams<{ q?: string }>();
  const searchBar = useRef<SearchBarCommands>(null);
  const [query, setQuery] = useState(q ?? "");
  useEffect(() => {
    setQuery(q ?? "");
    if (q) searchBar.current?.setText(q);
    else searchBar.current?.clearText();
  }, [q]);
  const [statusFilter, setStatusFilter] = useState<LibraryTab>(LIBRARY_STATUS_TABS[0].value);
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [groupQuery, setGroupQuery] = useState("");
  const groupsView = useRef<GroupsViewHandle>(null);
  const onCollectionsTab = statusFilter === "collections";
  // The header search bar is one physical field shared by every tab; switch
  // its displayed text to match whichever domain (books vs. groups) is now
  // showing, same as the `q` sync above.
  useEffect(() => {
    searchBar.current?.setText(onCollectionsTab ? groupQuery : query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCollectionsTab]);

  // Renaming stays a modal: it is one field, and a form sheet for it would be
  // more ceremony than the edit.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const books = library?.data.books ?? [];
  const style = resolveLibraryStyle(library?.data.style);
  const ordered = useMemo(() => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  // The status shown is a shelf (one of the three tabs), not a clearable
  // filter — only search and sort get reset here.
  const toolbarActive = query.trim() !== "" || sortKey !== "manual";

  function clearSearchAndFilters() {
    searchBar.current?.clearText();
    setQuery("");
    setSortKey("manual");
  }

  async function handleRenameLibrary() {
    const name = nameDraft.trim();
    setEditingName(false);
    if ((library?.data.name ?? "") === name) return;
    await actions.renameLibrary(name);
  }

  function handleToggleSelect(book: Record<string, unknown>) {
    const key = bookKey(book);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDeleteSelected() {
    if (selectedKeys.size === 0) return;
    const keys = selectedKeys;
    Alert.alert(`Delete ${keys.size} book${keys.size === 1 ? "" : "s"}?`, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void actions.deleteBooks(keys, () => {
            void murals.scrubBooks(keys).catch(() => Alert.alert("The books were deleted, but some mural references couldn't be updated."));
            setSelectedKeys(new Set());
            setSelectionMode(false);
          });
        },
      },
    ]);
  }

  const actionItems: MenuItem[] = [
    // Sort and Select act on the book grid, which isn't showing on the
    // Collections tab — GroupsView has its own search and selection.
    ...(onCollectionsTab
      ? []
      : [
          {
            // Sort used to sit above the grid as a row of pills, which cost
            // real space before a single cover. As a submenu it reads the
            // way the platform's own library apps present the same choice,
            // and `selected` puts the tick on the live one. Status now
            // lives in the swipeable tabs above the grid instead of here.
            label: "Sort",
            items: SORT_OPTIONS.map((option) => ({
              label: option.label,
              selected: option.value === sortKey,
              onPress: () => setSortKey(option.value),
            })),
          },
        ]),
    {
      label: "Rename library…",
      onPress: () => {
        setNameDraft(library?.data.name ?? "");
        setEditingName(true);
      },
    },
    { label: "Add book…", onPress: () => router.push("/add-book" as never) },
    { label: "Import / sync…", onPress: () => router.push("/import" as never) },
    ...(books.length > 1 ? [{ label: "Reorder…", onPress: () => router.push("/reorder" as never) }] : []),
    ...(!onCollectionsTab && books.length > 0 ? [{ label: "Select…", onPress: () => setSelectionMode(true) }] : []),
    { label: "Library style…", onPress: () => router.push("/style" as never) },
    { label: "Share…", onPress: () => router.push("/share" as never) },
  ];

  return (
    <Screen top={false}>
      <Stack.Screen
        options={selectionMode
          ? {
              headerShown: true,
              title: `${selectedKeys.size} selected`,
              // Selection is a mode, not a place — its own back is Cancel, so
              // the stack's back chevron would be the wrong affordance here.
              headerBackVisible: false,
              headerLeft: () => (
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => { setSelectionMode(false); setSelectedKeys(new Set()); }}
                />
              ),
              headerRight: () => (
                <IconButton
                  accessibilityLabel={`Delete ${selectedKeys.size} selected`}
                  name="delete"
                  onPress={selectedKeys.size === 0 ? undefined : handleDeleteSelected}
                  tone="danger"
                />
              ),
            }
          : {
              headerShown: true,
              title: library?.data.name || "Library",
              // Only worth a search field once there is something to search;
              // an empty library gets the plain header instead. It's the
              // same physical field on every tab, just re-pointed at book
              // search or group search (see the sync effect above).
              headerSearchBarOptions: books.length > 0
                ? onCollectionsTab
                  ? {
                      ref: searchBar,
                      autoCapitalize: "none",
                      placeholder: "Search collections",
                      hideWhenScrolling: true,
                      onChangeText: (event) => setGroupQuery(event.nativeEvent.text),
                      onCancelButtonPress: () => setGroupQuery(""),
                    }
                  : {
                      ref: searchBar,
                      autoCapitalize: "none",
                      placeholder: "Search title or author",
                      // iOS only: the bar tucks under the large title until the
                      // grid is pulled back down.
                      hideWhenScrolling: true,
                      onChangeText: (event) => setQuery(event.nativeEvent.text),
                      onCancelButtonPress: () => setQuery(""),
                    }
                : undefined,
              headerRight: () => (
                <View style={styles.headerActions}>
                  {onCollectionsTab && <IconButton accessibilityLabel="New collection" name="add" onPress={() => groupsView.current?.startCreating()} />}
                  <Menu title={library?.data.name || "Library"} items={actionItems}>
                    <IconButton accessibilityLabel="Library actions" name="more" />
                  </Menu>
                </View>
              ),
            }}
      />

      {/* Was an empty <View>, so the app's home screen was blank on every cold
          start until the library resolved. */}
      {isPending && (
        <View style={styles.loading}>
          <Skeleton height={44} radius={8} />
          <View style={styles.loadingRow}>
            <Skeleton height={190} radius={12} width="48%" />
            <Skeleton height={190} radius={12} width="48%" />
          </View>
          <View style={styles.loadingRow}>
            <Skeleton height={190} radius={12} width="48%" />
            <Skeleton height={190} radius={12} width="48%" />
          </View>
        </View>
      )}
      {isError && <ErrorState body={error instanceof Error ? error.message : "Couldn't load your library."} actionLabel="Retry" onAction={() => refetch()} />}

      {!isPending && !isError && books.length === 0 && (
        <EmptyState
          title="No library saved yet."
          body="Import a library.json, KoboReader.sqlite, Goodreads CSV, or StoryGraph CSV — or add a book by hand."
          actionLabel="Import library…"
          onAction={() => router.push("/import" as never)}
          secondaryActionLabel="Add a book manually"
          onSecondaryAction={() => router.push("/add-book" as never)}
        />
      )}

      {!isPending && !isError && books.length > 0 && (
        <SwipeableTabs
          accessibilityLabel="Library shelf"
          options={LIBRARY_TABS}
          value={statusFilter}
          onChange={setStatusFilter}
          renderPage={(status) => {
            if (status === "collections") return <GroupsView ref={groupsView} search={groupQuery} />;
            const pageBooks = sortBooks(filterBooks(ordered, query, status), sortKey);
            if (pageBooks.length === 0) {
              return (
                <EmptyState
                  title="No books match."
                  body="Every book is still here — the search above just doesn't match any of them."
                  actionLabel={toolbarActive ? "Clear search and sort" : undefined}
                  onAction={toolbarActive ? clearSearchAndFilters : undefined}
                />
              );
            }
            return (
              <LibraryGrid
                data={pageBooks}
                keyExtractor={(book, i) => String(book.ContentID ?? i)}
                style={style}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
                renderItem={(book) => {
                  const seriesGroup = bookSeriesGroup.get(bookKey(book));
                  const cardStyle = effectiveCardStyle(style, seriesGroup?.style, book._style as PerCardStyle | undefined);
                  return (
                    <BookCard
                      book={book}
                      onPress={() => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never)}
                      style={cardStyle}
                      showActions
                      onOpenStyle={selectionMode ? undefined : () => router.push(`/book/${encodeURIComponent(bookKey(book))}/style` as never)}
                      onOpenCoverPicker={selectionMode ? undefined : () => router.push(`/book/${encodeURIComponent(bookKey(book))}/cover` as never)}
                      selectable={selectionMode}
                      selected={selectedKeys.has(bookKey(book))}
                      onToggleSelect={handleToggleSelect}
                    />
                  );
                }}
              />
            );
          }}
        />
      )}

      <Sheet visible={editingName} title="Rename library" onClose={() => setEditingName(false)}>
        <Input label="Library name" autoFocus value={nameDraft} onChangeText={setNameDraft} onSubmitEditing={() => void handleRenameLibrary()} onBlur={() => void handleRenameLibrary()} />
      </Sheet>

    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { padding: spacing.lg, gap: spacing.md },
  loadingRow: { flexDirection: "row", gap: spacing.md },
  headerActions: { flexDirection: "row", alignItems: "center" },
});
