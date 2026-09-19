// A single series or collection: rename, Style (series only), Manage books,
// Select + delete member books, and delete the group itself — all the
// per-group actions that used to live inline on GroupsView's card before it
// became a plain list of rows (see that file's top comment). Reached by
// tapping a row there, or by deep link (e.g. the Home mural's "Open
// collection" button).

import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Stack } from "expo-router";
import {
  addBookToGroup,
  bookKey,
  clearBookCover,
  deleteGroup,
  effectiveCardStyle,
  orderedGroupBooks,
  removeBookFromGroup,
  removeBooksFromAllGroups,
  renameGroup,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  setBookCover,
  setGroupStyle,
  type Group,
  type LibraryData,
  type PerCardStyle,
} from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Sheet, Skeleton, type MenuItem } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import type { GalleryImage } from "../../gallery/api";
import { useMurals } from "../../murals/useMurals";
import { useLibrary } from "../hooks/useLibrary";
import { attemptUpdate } from "../lib/attemptUpdate";
import { BookCard } from "./BookCard";
import { BookWrapGrid } from "./BookWrapGrid";
import { CoverPickerSheet } from "./CoverPicker";
import { PerCardStyleSheet } from "./PerCardStyleForm";

export function GroupDetail({ groupId }: { groupId: string }) {
  const { data: library, isPending, updateLibrary } = useLibrary();
  const murals = useMurals();
  const { colors } = useTheme();

  const group = library?.data.groups?.find((g) => g.id === groupId) ?? null;
  const books = library?.data.books ?? [];
  const members = group ? orderedGroupBooks(group, books) : [];
  const bookSeriesGroup = seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []);
  const style = resolveLibraryStyle(library?.data.style);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [styleBookKey, setStyleBookKey] = useState<string | null>(null);
  const [coverBookKey, setCoverBookKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  async function runUpdate(mutate: (data: LibraryData) => LibraryData, onSuccess?: () => void) {
    return attemptUpdate(() => updateLibrary(mutate), () => Alert.alert("Couldn't save — check your connection."), onSuccess);
  }

  function handleCommitRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!group || !name || name === group.name) return;
    void runUpdate((data) => ({ ...data, groups: renameGroup(data.groups ?? [], group.id, name) }));
  }

  function handleDeleteGroup() {
    if (!group) return;
    Alert.alert(`Delete "${group.name}"?`, "The books stay in your library — this only removes the grouping.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void runUpdate((data) => ({ ...data, groups: deleteGroup(data.groups ?? [], group.id) }), () => router.back()),
      },
    ]);
  }

  function handleToggleBook(book: Record<string, unknown>, inGroup: boolean) {
    if (!group) return;
    void runUpdate((data) => ({
      ...data,
      groups: inGroup ? removeBookFromGroup(data.groups ?? [], group.id, book) : addBookToGroup(data.groups ?? [], group.id, book),
    }));
  }

  function handleSaveGroupStyle(groupStyle: PerCardStyle | undefined) {
    if (!group) return;
    void runUpdate((data) => ({ ...data, groups: setGroupStyle(data.groups ?? [], group.id, groupStyle) }));
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
          void runUpdate(
            (data) => ({
              ...data,
              books: data.books.filter((b) => !keys.has(bookKey(b))),
              groups: removeBooksFromAllGroups(data.groups ?? [], keys),
            }),
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

  const styleBook = styleBookKey ? books.find((b) => bookKey(b) === styleBookKey) ?? null : null;
  const coverBook = coverBookKey ? books.find((b) => bookKey(b) === coverBookKey) ?? null : null;

  const menuItems: MenuItem[] = group
    ? [
        ...(group.type === "series" ? [{ label: "Style…", onPress: () => setStyleOpen(true) }] : []),
        { label: "Manage books…", onPress: () => setPickerOpen(true) },
        ...(members.length > 0
          ? [
              {
                label: "Select…",
                onPress: () => {
                  setSelectionMode(true);
                  setSelectedKeys(new Set());
                },
              },
            ]
          : []),
        { label: "Delete", destructive: true, onPress: handleDeleteGroup },
      ]
    : [];

  return (
    <Screen top={false}>
      {/* formSheet presentation hides the native header entirely on
          Android (the grabber is the only chrome it draws), so every
          action here has to live in the body — headerRight would be
          unreachable on that platform. Title stays for whatever chrome
          iOS does draw; it's otherwise inert. */}
      <Stack.Screen options={{ title: group?.name ?? "Collection" }} />

      {isPending ? (
        <Skeleton height={180} />
      ) : !group ? (
        <ErrorState title="Collection not found" body="It may have been deleted." actionLabel="Close" onAction={() => router.back()} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {selectionMode ? (
            <View style={styles.topRow}>
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
            <View style={styles.topRow}>
              {editingName ? (
                <Input autoFocus label="Name" value={nameDraft} onChangeText={setNameDraft} onBlur={handleCommitRename} onSubmitEditing={handleCommitRename} />
              ) : (
                <Pressable
                  accessibilityLabel={`Rename ${group.name}`}
                  accessibilityRole="button"
                  onPress={() => {
                    setNameDraft(group.name);
                    setEditingName(true);
                  }}
                  style={styles.nameFlex}
                >
                  <Text style={[typography.title, { color: colors.text, fontWeight: "700" }]}>
                    {group.name} {group.style ? "· custom style" : ""}
                  </Text>
                </Pressable>
              )}
              <Menu items={menuItems}>
                <IconButton accessibilityLabel="Collection actions" name="more" />
              </Menu>
            </View>
          )}
          <Text style={[typography.caption, { color: colors.textDim }]}>
            {members.length} book{members.length === 1 ? "" : "s"}
            {selectionMode ? ` · ${selectedKeys.size} selected` : ""}
          </Text>

          {members.length === 0 ? (
            <EmptyState title="No books here yet." body='Use "Manage books" to add some.' />
          ) : (
            <BookWrapGrid
              books={members}
              style={style}
              renderBook={(book) => (
                <BookCard
                  book={book}
                  onPress={selectionMode ? () => {} : () => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never)}
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
        </ScrollView>
      )}

      {group && pickerOpen && <BookPickerSheet group={group} allBooks={books} onToggle={handleToggleBook} onClose={() => setPickerOpen(false)} />}

      <PerCardStyleSheet
        visible={styleOpen}
        name={group?.name ?? ""}
        priorityText="the library-wide"
        currentOverride={group?.style}
        seedStyle={style}
        onSave={handleSaveGroupStyle}
        onClose={() => setStyleOpen(false)}
      />

      {/* Keyed on the target id — PerCardStyleSheet seeds its draft from
          props only on mount (see its own top comment), so switching which
          book is being styled without a remount would leave the sheet
          showing the PREVIOUS book's draft. */}
      <PerCardStyleSheet
        key={`book-${styleBookKey ?? "none"}`}
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
    </Screen>
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
  const memberKeys = new Set(group.bookKeys);
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? allBooks.filter((b) => String(b.Title ?? "").toLowerCase().includes(needle) || String(b.Attribution ?? "").toLowerCase().includes(needle))
    : allBooks;

  return (
    <Sheet visible title={`Books in "${group.name}"`} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.xl }}>
        <Input label="Search your library" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
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
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameFlex: { flex: 1 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: 8 },
});
