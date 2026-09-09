// The native Library tab — mirrors frontend's pages/LibraryPage.tsx. Series,
// Collections and Library style are sibling routes in the same stack, so each
// gets the platform's own header, back chevron and swipe-back; this screen is
// just the grid.

import { useMemo, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import {
  bookKey,
  clearBookCover,
  effectiveCardStyle,
  filterBooks,
  nextReadStatus,
  orderLibraryBooks,
  removeBooksFromAllGroups,
  reorderOnDrop,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  setBookCover,
  sortBooks,
  type LibraryData,
  type PerCardStyle,
  type SortKey,
  type StatusFilter,
} from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Sheet, Skeleton, type MenuItem } from "../../ui/components";
import { spacing } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import { useMurals } from "../murals/useMurals";
import { useLibrary } from "./hooks/useLibrary";
import { buildMergedLibrary } from "./lib/mergeAndSave";
import { attemptUpdate } from "./lib/attemptUpdate";
import { AddBookSheet } from "./components/AddBookSheet";
import { BookCard } from "./components/BookCard";
import { BookDetailSheet } from "./components/BookDetailSheet";
import { CoverPickerSheet } from "./components/CoverPickerSheet";
import { GroupsView } from "./components/GroupsView";
import { ImportSheet } from "./components/ImportSheet";
import { LibraryGrid } from "./components/LibraryGrid";
import { LibraryStyleView } from "./components/LibraryStyleView";
import { LibraryToolbar } from "./components/LibraryToolbar";
import { PerCardStyleSheet } from "./components/PerCardStyleSheet";
import { ReorderSheet } from "./components/ReorderSheet";
import { ShareSheetBody } from "./components/ShareSheet";

export function LibraryScreen() {
  const { data: library, isPending, isError, error, refetch, isRefetching, updateLibrary, share, unshare } = useLibrary();
  const murals = useMurals();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("manual");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [detailBookKey, setDetailBookKey] = useState<string | null>(null);
  const [styleBookKey, setStyleBookKey] = useState<string | null>(null);
  const [coverBookKey, setCoverBookKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [reordering, setReordering] = useState(false);
  const [addingBook, setAddingBook] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [sharing, setSharing] = useState(false);

  const books = library?.data.books ?? [];
  const style = resolveLibraryStyle(library?.data.style);
  const ordered = useMemo(() => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const displayBooks = useMemo(() => sortBooks(filterBooks(ordered, query, statusFilter), sortKey), [ordered, query, statusFilter, sortKey]);
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const toolbarActive = query.trim() !== "" || statusFilter !== "all" || sortKey !== "manual";

  const detailBook = detailBookKey ? books.find((b) => bookKey(b) === detailBookKey) ?? null : null;
  const styleBook = styleBookKey ? books.find((b) => bookKey(b) === styleBookKey) ?? null : null;
  const coverBook = coverBookKey ? books.find((b) => bookKey(b) === coverBookKey) ?? null : null;

  async function runUpdate(mutate: (data: LibraryData) => LibraryData, failureMessage: string, onSuccess?: () => void) {
    return attemptUpdate(() => updateLibrary(mutate), () => Alert.alert(failureMessage), onSuccess);
  }

  async function handleRenameLibrary() {
    const name = nameDraft.trim();
    setEditingName(false);
    if ((library?.data.name ?? "") === name) return;
    await runUpdate((data) => ({ ...data, name }), "Couldn't save the new name.");
  }

  async function handleMerge(parsed: LibraryData) {
    await updateLibrary((data) => buildMergedLibrary(data, parsed));
  }

  function handleAddBook(book: Record<string, unknown>) {
    return handleMerge({ books: [book] });
  }

  function handleReorderMove(draggedKey: string, targetKey: string) {
    void runUpdate((data) => {
      const reorderedBooks = reorderOnDrop(data.books, data.groups ?? [], draggedKey, targetKey);
      return reorderedBooks === data.books ? data : { ...data, books: reorderedBooks };
    }, "Couldn't save the new order.");
  }

  function handleSetStatus(book: Record<string, unknown>) {
    const key = bookKey(book);
    void runUpdate(
      (data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? { ...b, ReadStatus: nextReadStatus(b.ReadStatus) } : b)) }),
      "Couldn't save the status change.",
    );
  }

  function handleSaveBookStyle(book: Record<string, unknown>, bookStyle: PerCardStyle | undefined) {
    const key = bookKey(book);
    void runUpdate((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? { ...b, _style: bookStyle } : b)) }), "Couldn't save the style change.");
  }

  function handleSaveBookCover(book: Record<string, unknown>, image: GalleryImage) {
    const key = bookKey(book);
    void runUpdate((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? setBookCover(b, image.id, image.url) : b)) }), "Couldn't save the cover change.");
  }

  function handleRemoveBookCover(book: Record<string, unknown>) {
    const key = bookKey(book);
    void runUpdate((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? clearBookCover(b) : b)) }), "Couldn't save the cover change.");
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
          void runUpdate(
            (data) => ({
              ...data,
              books: data.books.filter((b) => !keys.has(bookKey(b))),
              groups: removeBooksFromAllGroups(data.groups ?? [], keys),
            }),
            "Couldn't delete — nothing was changed.",
            () => {
              void murals.scrubBooks(keys).catch(() => Alert.alert("The books were deleted, but some mural references couldn't be updated."));
              setSelectedKeys(new Set());
              setSelectionMode(false);
            },
          );
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
    { label: "Add book…", onPress: () => setAddingBook(true) },
    { label: "Import / sync…", onPress: () => setImportVisible(true) },
    ...(books.length > 1 ? [{ label: "Reorder…", onPress: () => setReordering(true) }] : []),
    ...(books.length > 0 ? [{ label: "Select…", onPress: () => setSelectionMode(true) }] : []),
    { label: "Series…", onPress: () => router.push("/series" as never) },
    { label: "Collections…", onPress: () => router.push("/collections" as never) },
    { label: "Library style…", onPress: () => router.push("/style" as never) },
    { label: "Share…", onPress: () => setSharing(true) },
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
          onAction={() => setImportVisible(true)}
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
                    onPress={() => setDetailBookKey(bookKey(book))}
                    style={cardStyle}
                    showActions
                    onOpenStyle={selectionMode ? undefined : () => setStyleBookKey(bookKey(book))}
                    onOpenCoverPicker={selectionMode ? undefined : () => setCoverBookKey(bookKey(book))}
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

      <BookDetailSheet
        book={detailBook}
        onOpenStyle={(b) => setStyleBookKey(bookKey(b))}
        onOpenCoverPicker={(b) => setCoverBookKey(bookKey(b))}
        onSetStatus={handleSetStatus}
        onClose={() => setDetailBookKey(null)}
      />

      <PerCardStyleSheet
        key={styleBookKey ?? "none"}
        visible={styleBook !== null}
        name={String(styleBook?.Title ?? "")}
        priorityText="the series and library-wide"
        currentOverride={styleBook?._style as PerCardStyle | undefined}
        seedStyle={effectiveCardStyle(style, bookSeriesGroup.get(styleBookKey ?? "")?.style)}
        onSave={(bookStyle) => styleBook && handleSaveBookStyle(styleBook, bookStyle)}
        onClose={() => setStyleBookKey(null)}
      />

      <CoverPickerSheet
        visible={coverBook !== null}
        title={String(coverBook?.Title ?? "")}
        currentImageId={typeof coverBook?._coverImageId === "string" ? (coverBook._coverImageId as string) : null}
        onSelect={(image) => coverBook && handleSaveBookCover(coverBook, image)}
        onRemoveCover={() => coverBook && handleRemoveBookCover(coverBook)}
        onClose={() => setCoverBookKey(null)}
      />

      <ReorderSheet visible={reordering} orderedBooks={ordered} onMove={handleReorderMove} onClose={() => setReordering(false)} />

      <AddBookSheet visible={addingBook} onAdd={handleAddBook} onClose={() => setAddingBook(false)} />

      <ImportSheet visible={importVisible} title={books.length > 0 ? "Import more / sync Goodreads" : "Import library"} onMerge={handleMerge} onClose={() => setImportVisible(false)} />

      <Sheet visible={sharing} title={`Share "${library?.data.name || "Library"}"`} onClose={() => setSharing(false)}>
        <ShareSheetBody
          title={library?.data.name || "Library"}
          shareToken={library?.shareToken ?? null}
          shareUrl={library?.shareUrl ?? null}
          onShare={async () => {
            const updated = await share();
            return { shareToken: updated.shareToken as string, shareUrl: updated.shareUrl as string };
          }}
          onUnshare={async () => {
            await unshare();
          }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { padding: spacing.lg, gap: spacing.md },
  loadingRow: { flexDirection: "row", gap: spacing.md },
});
