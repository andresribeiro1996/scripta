// The native Library tab — mirrors frontend's pages/LibraryPage.tsx, plus
// (as in-tab views rather than separate routes — see this task's handoff
// notes) SeriesPage/CollectionsPage/LibraryStylePage. Composes every
// other component in this feature; mobile/src/app/(app)/index.tsx is a
// one-line wrapper around this.
//
// PLATFORM ADAPTATION (see this task's handoff notes for the full
// reasoning): the PWA has Library/Series/Collections/Style as four
// separate routes. This screen owns exactly one Expo Router route — the
// Library tab — and switches between four internal `view`s instead of
// pushing new routes, specifically to avoid touching
// mobile/src/app/(app)/_layout.tsx's <Tabs> (central navigation, which
// this task's file-ownership rules don't grant — see the plan's "Feature
// agents must not edit central navigation" rule). A future task with
// central-navigation ownership could promote these to real routes
// (stack screens pushed from the Library tab) with no changes to any
// component in this feature — every one of them already takes its data
// as props/hooks, not route params.

import { useMemo, useState, type ReactNode } from "react";
import { Alert, RefreshControl, StyleSheet, Text, View } from "react-native";
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
import { Button, EmptyState, ErrorState, Input, Menu, Sheet, type MenuItem } from "../../ui/components";
import { spacing, typography, useTheme } from "../../ui/theme";
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

type ScreenView = "browse" | "series" | "collections" | "style";

export function LibraryScreen({ initialView = "browse" }: { initialView?: ScreenView }) {
  const { colors } = useTheme();
  const { data: library, isPending, isError, error, refetch, isRefetching, updateLibrary, share, unshare } = useLibrary();
  const murals = useMurals();

  const [view, setView] = useState<ScreenView>(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
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

  if (view === "series") return <SubView title="Series" onBack={() => setView("browse")}><GroupsView type="series" /></SubView>;
  if (view === "collections") return <SubView title="Collections" onBack={() => setView("browse")}><GroupsView type="collection" /></SubView>;
  if (view === "style") {
    return (
      <SubView title="Library style" onBack={() => setView("browse")}>
        <LibraryStyleView
          savedStyle={library?.data.style}
          previewBooks={books}
          onSave={(next) => void runUpdate((data) => ({ ...data, style: next }), "Couldn't save the style change.")}
        />
      </SubView>
    );
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
    { label: "Series…", onPress: () => setView("series") },
    { label: "Collections…", onPress: () => setView("collections") },
    { label: "Library style…", onPress: () => setView("style") },
    { label: "Share…", onPress: () => setSharing(true) },
  ];

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderColor: colors.border }]}>
        {selectionMode ? (
          <>
            <Text style={[typography.title, { color: colors.text }]}>{selectedKeys.size} selected</Text>
            <View style={styles.headerActions}>
              <Button label="Delete" variant="destructive" disabled={selectedKeys.size === 0} onPress={handleDeleteSelected} />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setSelectionMode(false);
                  setSelectedKeys(new Set());
                }}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={[typography.heading, { color: colors.text }]} numberOfLines={1}>
              {library?.data.name || "Library"}
            </Text>
            <Button label="Menu" variant="secondary" onPress={() => setMenuOpen(true)} />
          </>
        )}
      </View>

      {isPending && <View style={styles.center} />}
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

      <Menu visible={menuOpen} title={library?.data.name || "Library"} items={actionItems} onClose={() => setMenuOpen(false)} />

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
    </View>
  );
}

function SubView({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderColor: colors.border }]}>
        <Button label="← Library" variant="secondary" onPress={onBack} />
        <Text style={[typography.title, { color: colors.text }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  headerActions: { flexDirection: "row", gap: spacing.sm },
});
