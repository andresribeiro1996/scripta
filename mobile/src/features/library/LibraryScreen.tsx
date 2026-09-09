// The native Library tab — mirrors frontend's pages/LibraryPage.tsx. Every
// panel it used to present as a modal (book detail, add, import, reorder,
// share, per-book style and cover) is now a sibling route presented as a form
// sheet, so each one is a real UISheetPresentationController the user can drag
// away. What is left here is the grid, its toolbar, and selection mode.

import { useMemo, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import {
  bookKey,
  effectiveCardStyle,
  filterBooks,
  orderLibraryBooks,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  sortBooks,
  type PerCardStyle,
  type SortKey,
  type StatusFilter,
} from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Sheet, Skeleton, type MenuItem } from "../../ui/components";
import { spacing } from "../../ui/theme";
import { useMurals } from "../murals/useMurals";
import { useLibrary } from "./hooks/useLibrary";
import { useLibraryActions } from "./hooks/useLibraryActions";
import { BookCard } from "./components/BookCard";
import { LibraryGrid } from "./components/LibraryGrid";
import { LibraryToolbar } from "./components/LibraryToolbar";

export function LibraryScreen() {
  const { data: library, isPending, isError, error, refetch, isRefetching } = useLibrary();
  const actions = useLibraryActions();
  const murals = useMurals();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("manual");

  // Renaming stays a modal: it is one field, and a form sheet for it would be
  // more ceremony than the edit.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const books = library?.data.books ?? [];
  const style = resolveLibraryStyle(library?.data.style);
  const ordered = useMemo(() => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const displayBooks = useMemo(() => sortBooks(filterBooks(ordered, query, statusFilter), sortKey), [ordered, query, statusFilter, sortKey]);
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const toolbarActive = query.trim() !== "" || statusFilter !== "all" || sortKey !== "manual";

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
    ...(books.length > 0 ? [{ label: "Select…", onPress: () => setSelectionMode(true) }] : []),
    { label: "Series…", onPress: () => router.push("/series" as never) },
    { label: "Collections…", onPress: () => router.push("/collections" as never) },
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
                  name="trash-outline"
                  onPress={selectedKeys.size === 0 ? undefined : handleDeleteSelected}
                  tone="danger"
                />
              ),
            }
          : {
              headerShown: true,
              title: library?.data.name || "Library",
              headerRight: () => (
                <Menu title={library?.data.name || "Library"} items={actionItems}>
                  <IconButton accessibilityLabel="Library actions" name="ellipsis-horizontal" />
                </Menu>
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
        />
      )}

      {!isPending && !isError && books.length > 0 && (
        <>
          <LibraryToolbar query={query} onQueryChange={setQuery} status={statusFilter} onStatusChange={setStatusFilter} sort={sortKey} onSortChange={setSortKey} />
          {displayBooks.length === 0 ? (
            <EmptyState
              title="No books match."
              body="Every book is still here — the search or filters above just don't match any of them."
              actionLabel={toolbarActive ? "Clear search and filters" : undefined}
              onAction={
                toolbarActive
                  ? () => {
                      setQuery("");
                      setStatusFilter("all");
                      setSortKey("manual");
                    }
                  : undefined
              }
            />
          ) : (
            <LibraryGrid
              data={displayBooks}
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
          )}
        </>
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
});
