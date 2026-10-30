// The native Library tab — mirrors frontend's pages/LibraryPage.tsx. Every
// panel it used to present as a modal (book detail, add, import, reorder,
// per-book style and cover) is now a sibling route presented as a form
// sheet, so each one is a real UISheetPresentationController the user can drag
// away. Status lives in the swipeable tabs, and one bottom dock below them
// holds the search and the sort or type control of the tab in view, so what is
// left here is the grid and selection mode.
//
// "Collections" is one more page in the same swipeable strip as the shelf
// tabs, not a separate destination behind the overflow menu — Series and
// Collections were easy to miss there. It renders GroupsView, which lists
// both (they're the same underlying resource) as tappable rows into
// GroupDetail; the standalone /collections route still exists for deep
// links (e.g. Home's "Open collection", which goes straight to a group's
// detail screen). The dock's search and the floating action button are
// re-pointed at groups instead of books while this tab is active.

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { router, Stack, useLocalSearchParams } from "expo-router";
import {
  bookKey,
  effectiveCardStyle,
  filterBooks,
  findDuplicates,
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
import { ActionSheet, Button, EmptyState, ErrorState, Fab, IconButton, Input, Screen, Sheet, Skeleton, SwipeableTabs, type ActionItem, type MenuItem } from "../../ui/components";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { ShareActions } from "../socials";
import { ConfirmDialog, SearchDock, dynamicType, searchDockClearance, searchDockFabClearance, useTheme } from "../../ui";
import { radii, spacing, typography } from "../../ui/theme";
import { useToast } from "../../ui/ToastHost";
import { useMurals } from "../murals/useMurals";
import { useLibrary } from "./hooks/useLibrary";
import { useLibraryActions } from "./hooks/useLibraryActions";
import { BookCard } from "./components/BookCard";
import { AddBookOptionsSheet } from "./components/AddBookOptionsSheet";
import { DuplicatesSheetBody } from "./components/DuplicatesSheet";
import { GroupsView, TYPE_FILTER_OPTIONS, type GroupsViewHandle, type TypeFilter } from "./components/GroupsView";
import { LibraryGrid } from "./components/LibraryGrid";
import { LibraryShareImage } from "./components/LibraryShareImage";
import { LIBRARY_SHARE_LAYOUTS, shelfShareBooks, type LibraryShareLayout } from "./lib/libraryShareBooks";

type LibraryTab = LibraryStatusTab | "collections";

const LIBRARY_TABS: readonly { value: LibraryTab; label: string }[] = [...LIBRARY_STATUS_TABS, { value: "collections", label: "Collections" }];

export function LibraryScreen() {
  const { colors } = useTheme();
  const { data: library, isPending, isError, error, refetch, isRefetching, share, unshare } = useLibrary();
  const actions = useLibraryActions();
  const { show } = useToast();
  const murals = useMurals();

  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? "");
  useEffect(() => {
    setQuery(q ?? "");
  }, [q]);
  const [statusFilter, setStatusFilter] = useState<LibraryTab>(LIBRARY_STATUS_TABS[0].value);
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [groupQuery, setGroupQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const groupsView = useRef<GroupsViewHandle>(null);
  const onCollectionsTab = statusFilter === "collections";
  const typeFilterIndex = TYPE_FILTER_OPTIONS.findIndex((option) => option.value === typeFilter);
  const typeFilterOption = TYPE_FILTER_OPTIONS[typeFilterIndex];
  const nextTypeFilter = TYPE_FILTER_OPTIONS[(typeFilterIndex + 1) % TYPE_FILTER_OPTIONS.length];

  // Renaming stays a modal: it is one field, and a form sheet for it would be
  // more ceremony than the edit.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [reviewingDuplicates, setReviewingDuplicates] = useState(false);
  const [addingBook, setAddingBook] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [shareLayout, setShareLayout] = useState<LibraryShareLayout>("wall");
  const [shareImageReady, setShareImageReady] = useState(false);

  const books = library?.data.books ?? [];
  const style = useMemo(() => resolveLibraryStyle(library?.data.style), [library?.data.style]);
  const ordered = useMemo(() => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const possibleDuplicates = useMemo(() => {
    if (!library) return [];
    const { certain, likely } = findDuplicates(library.data);
    return [...certain, ...likely];
  }, [library]);
  // The status shown is a shelf (one of the three tabs), not a clearable
  // filter — only search and sort get reset here.
  function clearSearchAndFilters() {
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
    setConfirmingDelete(true);
  }

  function confirmDeleteSelected() {
    const keys = selectedKeys;
    setConfirmingDelete(false);
    void actions.deleteBooks(keys, () => {
      void murals.scrubBooks(keys).catch(() => show("The books were deleted, but some mural references couldn't be updated.", "error"));
      setSelectedKeys(new Set());
      setSelectionMode(false);
    });
  }

  function startRenamingLibrary() {
    setNameDraft(library?.data.name ?? "");
    setEditingName(true);
  }

  function startSharing() {
    setShareLayout(onCollectionsTab ? "wall" : "shelf");
    setShareImageReady(false);
    setSharing(true);
  }

  const actionGroups: ActionItem[][] = [
    [
      { label: "Rename library", icon: "edit", onPress: startRenamingLibrary },
      ...(books.length > 1 ? [{ label: "Reorder", icon: "reorder" as const, onPress: () => router.push("/reorder" as never) }] : []),
      ...(!onCollectionsTab && books.length > 0 ? [{ label: "Select", icon: "select" as const, onPress: () => setSelectionMode(true) }] : []),
    ],
    [
      { label: "Library style", icon: "style", onPress: () => router.push("/style" as never) },
      { label: "Import library", icon: "sync", onPress: () => router.push("/import" as never) },
    ],
    [{ label: "Share", icon: "share", onPress: startSharing }],
  ];

  const sortLabel = SORT_OPTIONS.find((option) => option.value === sortKey)?.label ?? sortKey;
  const sortItems: MenuItem[] = SORT_OPTIONS.map((option) => ({
    label: option.label,
    selected: option.value === sortKey,
    onPress: () => setSortKey(option.value),
  }));

  return (
    <Screen top={false}>
      <Stack.Screen
        options={selectionMode
          ? {
              headerShown: true,
              title: `${selectedKeys.size} selected`,
              headerTitle: () => (
                <Text display accessibilityRole="header" numberOfLines={1} {...dynamicType} style={[styles.selectionTitle, { color: colors.text }]}>
                  {`${selectedKeys.size} selected`}
                </Text>
              ),
              // Selection is a mode, not a place — its own back is Cancel, so
              // the stack's back chevron would be the wrong affordance here.
              headerBackVisible: false,
              headerLeft: () => (
                <IconButton
                  name="close"
                  accessibilityLabel="Cancel selection"
                  onPress={() => { setSelectionMode(false); setSelectedKeys(new Set()); }}
                />
              ),
              headerRight: () => (
                <IconButton
                  accessibilityLabel={`Delete ${selectedKeys.size} selected`}
                  name="delete"
                  disabled={selectedKeys.size === 0}
                  onPress={handleDeleteSelected}
                  tone="danger"
                />
              ),
            }
          : {
              headerShown: true,
              title: library?.data.name || "Library",
              headerLargeTitleEnabled: false,
              headerBackVisible: undefined,
              headerTitle: undefined,
              headerLeft: undefined,
              headerRight: () => (
                <ActionSheet title={library?.data.name || "Library"} groups={actionGroups}>
                  {(open) => <IconButton accessibilityLabel="Library actions" name="more" onPress={open} />}
                </ActionSheet>
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
          title="Start your library"
          body="Import your existing collection, or find a book by title or barcode."
          actionLabel="Import library"
          onAction={() => router.push("/import" as never)}
          secondaryActionLabel="Add a book"
          onSecondaryAction={() => setAddingBook(true)}
        />
      )}

      {!isPending && !isError && books.length > 0 && (
        <SearchDock
          value={onCollectionsTab ? groupQuery : query}
          onChangeText={onCollectionsTab ? setGroupQuery : setQuery}
          accessibilityLabel={onCollectionsTab ? "Search collections" : "Search title or author"}
          placeholder={onCollectionsTab ? "Search collections" : "Search title or author"}
          cycle={
            onCollectionsTab
              ? {
                  icon: typeFilterOption.icon,
                  active: typeFilter !== "all",
                  accessibilityLabel: `Showing ${typeFilterOption.label.toLowerCase()}`,
                  accessibilityHint: "Switches to the next type",
                  onPress: () => setTypeFilter(nextTypeFilter.value),
                }
              : {
                  icon: "filter",
                  active: sortKey !== "manual",
                  accessibilityLabel: `Sort books, currently ${sortLabel}`,
                  menu: { title: "Sort books", items: sortItems },
                }
          }
          fab={
            selectionMode ? undefined : onCollectionsTab ? (
              <Fab label="New" accessibilityLabel="New collection" onPress={() => groupsView.current?.startCreating()} />
            ) : (
              <Fab label="Add" accessibilityLabel="Add book" onPress={() => setAddingBook(true)} />
            )
          }
        >
          {(scrollProps) => (
            <SwipeableTabs
              accessibilityLabel="Library shelf"
              options={LIBRARY_TABS}
              value={statusFilter}
              onChange={setStatusFilter}
              renderPage={(status) => {
                if (status === "collections") return <GroupsView ref={groupsView} search={groupQuery} typeFilter={typeFilter} bottomInset={selectionMode ? searchDockClearance : searchDockFabClearance} {...scrollProps} />;
                const pageBooks = sortBooks(filterBooks(ordered, query, status), sortKey);
                return (
                  <LibraryGrid
                    data={pageBooks}
                    keyExtractor={(book, i) => String(book.ContentID ?? i)}
                    style={style}
                    topInset={spacing.lg}
                    bottomInset={selectionMode ? searchDockClearance : searchDockFabClearance}
                    {...scrollProps}
                    refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
                    ListHeaderComponent={
                      possibleDuplicates.length > 0 ? (
                        <View style={styles.shelfHead}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setReviewingDuplicates(true)}
                            style={({ pressed }) => [styles.sortPill, { borderColor: colors.border }, pressed ? { backgroundColor: colors.surfacePressed } : null]}
                          >
                            <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.text }]}>
                              {possibleDuplicates.length === 1 ? "1 possible duplicate · Review" : `${possibleDuplicates.length} possible duplicates · Review`}
                            </Text>
                          </Pressable>
                        </View>
                      ) : undefined
                    }
                    ListEmptyComponent={
                      query.trim() ? (
                        <EmptyState
                          title="No books match."
                          body="Every book is still here — the search below just doesn't match any of them."
                          actionLabel="Clear search and sort"
                          onAction={clearSearchAndFilters}
                        />
                      ) : (
                        <EmptyState title="Nothing on this shelf yet." />
                      )
                    }
                    renderItem={(book) => {
                      const seriesGroup = bookSeriesGroup.get(bookKey(book));
                      const cardStyle = effectiveCardStyle(style, seriesGroup?.style, book._style as PerCardStyle | undefined);
                      return (
                        <BookCard
                          book={book}
                          onPress={() => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never)}
                          style={cardStyle}
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
        </SearchDock>
      )}

      {addingBook ? <AddBookOptionsSheet onClose={() => setAddingBook(false)} /> : null}

      <Sheet visible={editingName} title="Rename library" onClose={() => setEditingName(false)}>
        <Input label="Library name" autoFocus value={nameDraft} maxLength={200} onChangeText={setNameDraft} onSubmitEditing={() => void handleRenameLibrary()} onBlur={() => void handleRenameLibrary()} />
      </Sheet>

      <Sheet visible={reviewingDuplicates && possibleDuplicates.length > 0} title="Possible duplicates" onClose={() => setReviewingDuplicates(false)}>
        {library ? <DuplicatesSheetBody groups={possibleDuplicates} library={library} /> : null}
      </Sheet>

      <ContentShareSheet
        visible={sharing}
        onClose={() => setSharing(false)}
        title={library?.data.name || "Library"}
        url={library?.shareUrl ?? null}
        onEnableLink={async () => (await share()).shareUrl ?? undefined}
        onDisableLink={async () => { await unshare(); }}
        imageReady={shareImageReady}
        linkActions={library?.shareUrl ? <ShareActions message={library.shareUrl} /> : null}
        previewControls={
          <View style={styles.shareOptions}>
            {LIBRARY_SHARE_LAYOUTS.filter((layout) => !(onCollectionsTab && layout.value === "shelf")).map((layout) => {
              const selected = layout.value === shareLayout;
              return (
                <Button
                  key={layout.value}
                  label={layout.label}
                  variant={selected ? "primary" : "secondary"}
                  accessibilityLabel={selected ? `${layout.label}, selected` : undefined}
                  onPress={() => {
                    if (selected) return;
                    setShareImageReady(false);
                    setShareLayout(layout.value);
                  }}
                />
              );
            })}
          </View>
        }
      >
        <LibraryShareImage
          key={shareLayout}
          layout={shareLayout}
          name={library?.data.name || "Library"}
          ordered={ordered}
          shelf={onCollectionsTab ? null : { label: LIBRARY_TABS.find((tab) => tab.value === statusFilter)!.label, query, books: shelfShareBooks(ordered, query, statusFilter, sortKey) }}
          style={style}
          seriesGroups={bookSeriesGroup}
          onReadyChange={setShareImageReady}
        />
      </ContentShareSheet>

      <ConfirmDialog
        visible={confirmingDelete}
        title={`Delete ${selectedKeys.size} book${selectedKeys.size === 1 ? "" : "s"}?`}
        body="This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDeleteSelected}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  selectionTitle: { fontSize: 17, fontVariant: ["lining-nums"], marginLeft: spacing.md },
  loading: { padding: spacing.lg, gap: spacing.md },
  loadingRow: { flexDirection: "row", gap: spacing.md },
  shelfHead: { paddingBottom: spacing.md },
  sortPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 32, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1 },
  strong: { fontWeight: "700" },
  shareOptions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
});
