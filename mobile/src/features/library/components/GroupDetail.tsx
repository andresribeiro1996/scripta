// A single series or collection: rename, Style (series only), Manage books,
// Select + delete member books, and delete the group itself — all the
// per-group actions that used to live inline on GroupsView's card before it
// became a plain list of rows (see that file's top comment). Reached by
// tapping a row there, or by deep link (e.g. the Home mural's "Open
// collection" button).

import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import { router, Stack } from "expo-router";
import {
  bookKey,
  deleteBooks,
  deleteGroup,
  effectiveCardStyle,
  orderedGroupBooks,
  renameGroup,
  resolveLibraryStyle,
  saveFailureMessage,
  seriesGroupByBookKey,
  setGroupStyle,
  type Group,
  type LibraryData,
  type PerCardStyle,
} from "@scripta/shared";
import { ActionSheet, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, Screen, Sheet, Skeleton, Toast, type ActionItem } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { useMurals } from "../../murals/useMurals";
import { useLibrary } from "../hooks/useLibrary";
import { BookPickerList } from "./BookPickerList";
import { assertSaved, attemptUpdate } from "../lib/attemptUpdate";
import { BookCard } from "./BookCard";
import { BookWrapGrid } from "./BookWrapGrid";
import { PerCardStyleSheet } from "./PerCardStyleForm";
import { getLocale } from "../../../i18n";

export function GroupDetail({ groupId }: { groupId: string }) {
  const { data: library, isPending, updateLibrary, submit } = useLibrary();
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<"group" | "books" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function runUpdate(mutate: (data: LibraryData) => LibraryData, onSuccess?: () => void) {
    setNotice(null);
    return attemptUpdate(() => updateLibrary(mutate), (error) => setNotice(saveFailureMessage(error, "Couldn't save — check your connection.", getLocale())), onSuccess);
  }

  function handleCommitRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!group || !name || name === group.name) return;
    void runUpdate((data) => ({ ...data, groups: renameGroup(data.groups ?? [], group.id, name) }));
  }

  function confirmDeleteGroup() {
    if (!group) return;
    setConfirming(null);
    void runUpdate((data) => ({ ...data, groups: deleteGroup(data.groups ?? [], group.id) }), () => router.back());
  }

  function handleToggleBook(book: Record<string, unknown>, inGroup: boolean) {
    if (!group) return;
    setPickerError(null);
    void attemptUpdate(
      async () => assertSaved(await submit({ kind: "membership", groupId: group.id, bookKey: bookKey(book), member: !inGroup })),
      (error) => setPickerError(saveFailureMessage(error, "Couldn't save — check your connection.", getLocale())),
    );
  }

  function handleSaveGroupStyle(groupStyle: PerCardStyle | undefined) {
    if (!group) return;
    setStyleError(null);
    void attemptUpdate(
      () => updateLibrary((data) => ({ ...data, groups: setGroupStyle(data.groups ?? [], group.id, groupStyle) })),
      (error) => setStyleError(saveFailureMessage(error, "Couldn't save the style change.", getLocale())),
    );
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
    setConfirming("books");
  }

  function confirmDeleteSelected() {
    const keys = selectedKeys;
    setConfirming(null);
    void runUpdate(
      (data) => deleteBooks(data, keys),
      () => {
        void murals.scrubBooks(keys).catch(() => setNotice("The books were deleted, but some mural references couldn't be updated."));
        setSelectedKeys(new Set());
        setSelectionMode(false);
      },
    );
  }

  const menuGroups: ActionItem[][] = group
    ? [
        [
          ...(group.type === "series" ? [{ label: "Style", icon: "style" as const, onPress: () => setStyleOpen(true) }] : []),
          { label: "Manage books", icon: "book", onPress: () => setPickerOpen(true) },
          ...(members.length > 0
            ? [
                {
                  label: "Select",
                  icon: "select" as const,
                  onPress: () => {
                    setSelectionMode(true);
                    setSelectedKeys(new Set());
                  },
                },
              ]
            : []),
        ],
        [{ label: "Delete", icon: "delete", destructive: true, onPress: () => setConfirming("group") }],
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

      {notice ? <Toast visible message={notice} tone="error" /> : null}

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
                <Input autoFocus label="Name" value={nameDraft} maxLength={200} onChangeText={setNameDraft} onBlur={handleCommitRename} onSubmitEditing={handleCommitRename} />
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
              <ActionSheet title={group?.name ?? "Collection"} groups={menuGroups}>
                {(open) => <IconButton accessibilityLabel="Collection actions" name="more" onPress={open} />}
              </ActionSheet>
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
                  selectable={selectionMode}
                  selected={selectedKeys.has(bookKey(book))}
                  onToggleSelect={handleToggleSelect}
                />
              )}
            />
          )}
        </ScrollView>
      )}

      {group && pickerOpen && <BookPickerSheet group={group} allBooks={books} error={pickerError} onToggle={handleToggleBook} onClose={() => setPickerOpen(false)} />}

      <PerCardStyleSheet
        key={`${groupId}-${styleOpen}`}
        visible={styleOpen}
        name={group?.name ?? ""}
        inheritedFrom={library?.data.name ? `library “${library.data.name}”` : "your library"}
        currentOverride={group?.style}
        seedStyle={style}
        previewBook={members[0]}
        error={styleError}
        onSave={handleSaveGroupStyle}
        onClose={() => {
          setStyleOpen(false);
          setStyleError(null);
        }}
      />

      <ConfirmDialog
        visible={confirming !== null}
        title={confirming === "group" ? `Delete "${group?.name ?? ""}"?` : `Delete ${selectedKeys.size} book${selectedKeys.size === 1 ? "" : "s"}?`}
        body={confirming === "group" ? "The books stay in your library — this only removes the grouping." : "This removes them from your library entirely, not just this group."}
        confirmLabel="Delete"
        destructive
        onConfirm={confirming === "group" ? confirmDeleteGroup : confirmDeleteSelected}
        onCancel={() => setConfirming(null)}
      />
    </Screen>
  );
}

function BookPickerSheet({
  group,
  allBooks,
  error,
  onToggle,
  onClose,
}: {
  group: Group;
  allBooks: Array<Record<string, unknown>>;
  error: string | null;
  onToggle: (book: Record<string, unknown>, inGroup: boolean) => void;
  onClose: () => void;
}) {
  const memberKeys = new Set(group.bookKeys);

  return (
    <Sheet visible title={`Books in "${group.name}"`} onClose={onClose}>
      {error ? <Toast visible message={error} tone="error" /> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.xl }}>
        <BookPickerList books={allBooks} isSelected={(book) => memberKeys.has(bookKey(book))} onSelect={(book) => onToggle(book, memberKeys.has(bookKey(book)))} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameFlex: { flex: 1 },
});
