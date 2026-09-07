// Mirrors frontend's pages/GroupsPage.tsx — backs both the Series and
// Collections in-tab views (LibraryScreen.tsx's `view` state; see this
// task's handoff notes for why these are in-tab views rather than
// separate Expo Router routes). Same underlying resource either way
// (@scripta/shared's Group / groups.ts), differing only in copy and in
// that series also get auto-seeded from book metadata (deriveSeriesGroups,
// called from lib/mergeAndSave.ts after every import/add).

import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  addBookToGroup,
  deleteGroup,
  makeGroup,
  orderedGroupBooks,
  removeBookFromGroup,
  removeBooksFromAllGroups,
  renameGroup,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  setGroupStyle,
  bookKey,
  effectiveCardStyle,
  clearBookCover,
  setBookCover,
  type Group,
  type GroupType,
  type LibraryData,
  type PerCardStyle,
} from "@scripta/shared";
import { Button, EmptyState, Input, Sheet } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import type { GalleryImage } from "../../gallery/api";
import { useLibrary } from "../hooks/useLibrary";
import { BookCard } from "./BookCard";
import { BookWrapGrid } from "./BookWrapGrid";
import { CoverPickerSheet } from "./CoverPickerSheet";
import { PerCardStyleSheet } from "./PerCardStyleSheet";

const COPY: Record<GroupType, { title: string; noun: string; emptyTitle: string; emptyBody: string }> = {
  series: {
    title: "Series",
    noun: "series",
    emptyTitle: "No series yet.",
    emptyBody: "Series are picked up automatically from your books' Series field on import — or add one below.",
  },
  collection: {
    title: "Collections",
    noun: "collection",
    emptyTitle: "No collections yet.",
    emptyBody: "Create one to start organizing your books your own way.",
  },
};

export function GroupsView({ type }: { type: GroupType }) {
  const { data: library, updateLibrary } = useLibrary();
  const copy = COPY[type];
  const { colors } = useTheme();

  const [search, setSearch] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null);
  const [styleGroupId, setStyleGroupId] = useState<string | null>(null);
  const [styleBookKey, setStyleBookKey] = useState<string | null>(null);
  const [coverBookKey, setCoverBookKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const books = library?.data.books ?? [];
  const allGroups = useMemo(
    () => (library?.data.groups ?? []).filter((g) => g.type === type).sort((a, b) => a.name.localeCompare(b.name)),
    [library, type],
  );
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return allGroups;
    return allGroups.filter(
      (group) => group.name.toLowerCase().includes(needle) || orderedGroupBooks(group, books).some((b) => String(b.Title ?? "").toLowerCase().includes(needle)),
    );
  }, [allGroups, books, search]);
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const style = resolveLibraryStyle(library?.data.style);

  async function runUpdate(mutate: (data: LibraryData) => LibraryData) {
    try {
      await updateLibrary(mutate);
    } catch {
      Alert.alert("Couldn't save — check your connection.");
    }
  }

  async function handleCommitDraft() {
    const name = draftName.trim();
    setDrafting(false);
    setDraftName("");
    if (!name || creating) return;
    setCreating(true);
    try {
      await updateLibrary((data) => ({ ...data, groups: [...(data.groups ?? []), makeGroup(type, name)] }));
    } catch {
      Alert.alert("Couldn't save — check your connection.");
    } finally {
      setCreating(false);
    }
  }

  function handleRename(id: string) {
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    void runUpdate((data) => ({ ...data, groups: renameGroup(data.groups ?? [], id, name) }));
  }

  function handleDelete(group: Group) {
    Alert.alert(`Delete "${group.name}"?`, "The books stay in your library — this only removes the grouping.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void runUpdate((data) => ({ ...data, groups: deleteGroup(data.groups ?? [], group.id) })) },
    ]);
  }

  function handleToggleBook(groupId: string, book: Record<string, unknown>, inGroup: boolean) {
    void runUpdate((data) => ({
      ...data,
      groups: inGroup ? removeBookFromGroup(data.groups ?? [], groupId, book) : addBookToGroup(data.groups ?? [], groupId, book),
    }));
  }

  function handleSaveGroupStyle(groupId: string, groupStyle: PerCardStyle | undefined) {
    void runUpdate((data) => ({ ...data, groups: setGroupStyle(data.groups ?? [], groupId, groupStyle) }));
  }

  function handleSaveBookStyle(book: Record<string, unknown>, bookStyle: PerCardStyle | undefined) {
    const key = bookKey(book);
    void runUpdate((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? { ...b, _style: bookStyle } : b)) }));
  }

  function handleSaveBookCover(book: Record<string, unknown>, image: GalleryImage) {
    const key = bookKey(book);
    void runUpdate((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? setBookCover(b, image.id, image.url) : b)) }));
  }

  function handleRemoveBookCover(book: Record<string, unknown>) {
    const key = bookKey(book);
    void runUpdate((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? clearBookCover(b) : b)) }));
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
    Alert.alert(`Delete ${keys.size} book${keys.size === 1 ? "" : "s"}?`, "This removes them from your library entirely, not just this group.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void runUpdate((data) => ({
            ...data,
            books: data.books.filter((b) => !keys.has(bookKey(b))),
            groups: removeBooksFromAllGroups(data.groups ?? [], keys),
          })).then(() => {
            setSelectedKeys(new Set());
            setSelectionMode(false);
          });
        },
      },
    ]);
  }

  const pickerGroup = groups.find((g) => g.id === pickerGroupId) ?? null;
  const styleGroup = groups.find((g) => g.id === styleGroupId) ?? null;
  const styleBook = styleBookKey ? books.find((b) => bookKey(b) === styleBookKey) ?? null : null;
  const coverBook = coverBookKey ? books.find((b) => bookKey(b) === coverBookKey) ?? null : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={[typography.heading, { color: colors.text }]}>{copy.title}</Text>
        {books.length > 0 &&
          (selectionMode ? (
            <View style={styles.headerActions}>
              <Text style={[typography.body, { color: colors.textDim }]}>{selectedKeys.size} selected</Text>
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
          ) : (
            <Button label="Select…" variant="secondary" onPress={() => setSelectionMode(true)} />
          ))}
      </View>

      {books.length > 0 && <Input label="Search" placeholder={`Search ${copy.title.toLowerCase()}`} value={search} onChangeText={setSearch} />}

      {!allGroups.length && <EmptyState title={copy.emptyTitle} body={copy.emptyBody} />}
      {allGroups.length > 0 && groups.length === 0 && <Text style={[typography.body, { color: colors.textDim }]}>Nothing matches "{search.trim()}".</Text>}

      {drafting ? (
        <View style={[styles.draftRow, { borderColor: colors.accent }]}>
          <Input
            autoFocus
            label={`Name this ${copy.noun}`}
            value={draftName}
            onChangeText={setDraftName}
            onBlur={() => void handleCommitDraft()}
            onSubmitEditing={() => void handleCommitDraft()}
          />
        </View>
      ) : (
        <Button label={creating ? "Adding…" : `New ${copy.noun}`} variant="secondary" loading={creating} onPress={() => setDrafting(true)} />
      )}

      {groups.map((group) => {
        const members = orderedGroupBooks(group, books);
        return (
          <View key={group.id} style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.sectionHeader}>
              {editingId === group.id ? (
                <Input
                  autoFocus
                  label="Name"
                  value={editingName}
                  onChangeText={setEditingName}
                  onBlur={() => handleRename(group.id)}
                  onSubmitEditing={() => handleRename(group.id)}
                />
              ) : (
                <Pressable
                  onPress={() => {
                    setEditingId(group.id);
                    setEditingName(group.name);
                  }}
                >
                  <Text style={[typography.title, { color: colors.text, fontWeight: "700" }]}>
                    {group.name} {group.style ? "· custom style" : ""}
                  </Text>
                </Pressable>
              )}
              <Text style={[typography.caption, { color: colors.textDim }]}>
                {members.length} book{members.length === 1 ? "" : "s"}
              </Text>
            </View>
            <View style={styles.sectionActions}>
              {type === "series" && <Button label="Style" variant="secondary" onPress={() => setStyleGroupId(group.id)} />}
              <Button label="Manage books" variant="secondary" onPress={() => setPickerGroupId(group.id)} />
              <Button label="Delete" variant="destructive" onPress={() => handleDelete(group)} />
            </View>

            {members.length === 0 ? (
              <Text style={[typography.body, { color: colors.textDim }]}>No books here yet — use "Manage books" to add some.</Text>
            ) : (
              <BookWrapGrid
                books={members}
                style={style}
                renderBook={(book) => (
                  <BookCard
                    book={book}
                    onPress={() => {}}
                    style={effectiveCardStyle(style, bookSeriesGroup.get(bookKey(book))?.style, book._style as PerCardStyle | undefined)}
                    onOpenStyle={selectionMode ? undefined : () => setStyleBookKey(bookKey(book))}
                    onOpenCoverPicker={selectionMode ? undefined : () => setCoverBookKey(bookKey(book))}
                    showActions
                    selectable={selectionMode}
                    selected={selectedKeys.has(bookKey(book))}
                    onToggleSelect={handleToggleSelect}
                  />
                )}
              />
            )}
          </View>
        );
      })}

      {pickerGroup && (
        <BookPickerSheet
          key={pickerGroup.id}
          group={pickerGroup}
          allBooks={books}
          onToggle={(book, inGroup) => handleToggleBook(pickerGroup.id, book, inGroup)}
          onClose={() => setPickerGroupId(null)}
        />
      )}

      {/* Keyed on the target id — PerCardStyleSheet seeds its draft from
          props only on mount (see its own top comment), so switching
          which series/book is being styled without a remount would leave
          the sheet showing the PREVIOUS target's draft. */}
      <PerCardStyleSheet
        key={styleGroupId ?? "none"}
        visible={styleGroup !== null}
        name={styleGroup?.name ?? ""}
        priorityText="the library-wide"
        currentOverride={styleGroup?.style}
        seedStyle={style}
        onSave={(groupStyle) => styleGroup && handleSaveGroupStyle(styleGroup.id, groupStyle)}
        onClose={() => setStyleGroupId(null)}
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
    </ScrollView>
  );
}

function BookPickerSheet({
  group,
  allBooks,
  onToggle,
  onClose,
}: {
  group: Group;
  allBooks: Array<Record<string, unknown>>;
  onToggle: (book: Record<string, unknown>, inGroup: boolean) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState("");
  const memberKeys = useMemo(() => new Set(group.bookKeys), [group]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allBooks;
    return allBooks.filter((b) => String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q));
  }, [allBooks, search]);

  return (
    <Sheet visible title={`Books in "${group.name}"`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.xl }}>
        <Input label="Search your library" value={search} onChangeText={setSearch} />
        {filtered.length === 0 && <Text style={[typography.body, { color: colors.textDim }]}>No books match.</Text>}
        {filtered.map((book, i) => {
          const key = bookKey(book);
          const inGroup = memberKeys.has(key);
          return (
            <Pressable
              accessibilityLabel={`${inGroup ? "Remove" : "Add"} ${String(book.Title ?? "book")}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: inGroup }}
              key={String(book.ContentID ?? i)}
              onPress={() => onToggle(book, inGroup)}
              style={[styles.pickerRow, { backgroundColor: inGroup ? colors.accentSoft : "transparent" }]}
            >
              <Text style={[typography.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {String(book.Title ?? "Untitled")} — <Text style={{ color: colors.textDim }}>{String(book.Attribution ?? "Unknown author")}</Text>
              </Text>
              <Text style={{ color: colors.accent, fontWeight: "700" }}>{inGroup ? "✓" : ""}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  draftRow: { borderWidth: 2, borderStyle: "dashed", borderRadius: 12, padding: spacing.md },
  section: { borderWidth: 1, borderRadius: 12, padding: spacing.lg, gap: spacing.md },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  sectionActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: 8 },
});
