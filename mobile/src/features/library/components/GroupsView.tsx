// Lists Series and Collections together — they're the same underlying
// resource (@scripta/shared's Group / groups.ts), differing only in that
// series also get auto-seeded from book metadata (deriveSeriesGroups,
// called from lib/mergeAndSave.ts after every import/add). The type filter
// below narrows the list; it doesn't gate which resource is loaded.
//
// Rows only navigate — renaming, Style, Manage books, Select/Delete, and
// deleting the group itself all live on the detail screen
// (app/(app)/(library)/collection/[id].tsx), which is also the deep-link
// target for e.g. the Home mural's "Open collection" button.
//
// Rendered both as the Library screen's "Collections" tab and as the
// standalone /collections route. Both hosts own the native header search
// bar and a "+" button themselves (see LibraryScreen.tsx and
// app/(app)/(library)/collections.tsx) — `search` is a controlled prop and
// `startCreating` is exposed via ref so those headers can drive this list
// without it needing its own header.

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { makeGroup, orderedGroupBooks, type GroupType } from "@scripta/shared";
import { EmptyState, Input, Segmented } from "../../../ui/components";
import { Icon } from "../../../ui/icon";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { useLibrary } from "../hooks/useLibrary";
import { attemptUpdate } from "../lib/attemptUpdate";
import { CoverImage } from "./CoverImage";

type TypeFilter = GroupType | "all";

const TYPE_FILTER_OPTIONS: readonly { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "series", label: "Series" },
  { value: "collection", label: "Collections" },
];

const COPY: Record<TypeFilter, { noun: string; emptyTitle: string; emptyBody: string }> = {
  all: {
    noun: "collection",
    emptyTitle: "No collections yet.",
    emptyBody: "Series are picked up automatically from your books' Series field on import — or create your own collection with the + button above.",
  },
  series: {
    noun: "series",
    emptyTitle: "No series yet.",
    emptyBody: "Series are picked up automatically from your books' Series field on import — or add one with the + button above.",
  },
  collection: {
    noun: "collection",
    emptyTitle: "No collections yet.",
    emptyBody: "Use the + button above to start organizing your books your own way.",
  },
};

const GROUP_TYPE_LABEL: Record<GroupType, string> = { series: "Series", collection: "Collection" };

export type GroupsViewHandle = { startCreating: () => void };

export const GroupsView = forwardRef<GroupsViewHandle, { search: string }>(function GroupsView({ search }, ref) {
  const { data: library, updateLibrary } = useLibrary();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // "All" has no single creatable type; a manually-added group there is a
  // collection like any other — series are meant to come from import.
  const draftType: GroupType = typeFilter === "series" ? "series" : "collection";
  const copy = COPY[typeFilter];
  const { colors } = useTheme();

  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);

  useImperativeHandle(ref, () => ({ startCreating: () => setDrafting(true) }), []);

  const books = library?.data.books ?? [];
  const allGroups = useMemo(
    () => (library?.data.groups ?? []).filter((g) => typeFilter === "all" || g.type === typeFilter).sort((a, b) => a.name.localeCompare(b.name)),
    [library, typeFilter],
  );
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return allGroups;
    return allGroups.filter(
      (group) => group.name.toLowerCase().includes(needle) || orderedGroupBooks(group, books).some((b) => String(b.Title ?? "").toLowerCase().includes(needle)),
    );
  }, [allGroups, books, search]);

  async function handleCommitDraft() {
    const name = draftName.trim();
    setDrafting(false);
    setDraftName("");
    if (!name || creating) return;
    setCreating(true);
    const group = makeGroup(draftType, name);
    await attemptUpdate(
      () => updateLibrary((data) => ({ ...data, groups: [...(data.groups ?? []), group] })),
      () => Alert.alert("Couldn't save — check your connection."),
      () => router.push(`/collection/${group.id}` as never),
    );
    setCreating(false);
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Segmented accessibilityLabel="Filter by type" options={TYPE_FILTER_OPTIONS} value={typeFilter} onChange={setTypeFilter} />

      {drafting && (
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
      )}

      {!allGroups.length && !drafting && <EmptyState title={copy.emptyTitle} body={copy.emptyBody} />}
      {allGroups.length > 0 && groups.length === 0 && <Text style={[typography.body, { color: colors.textDim }]}>Nothing matches "{search.trim()}".</Text>}

      {groups.map((group) => {
        const members = orderedGroupBooks(group, books);
        return (
          <Pressable
            key={group.id}
            accessibilityLabel={`Open ${group.name}`}
            accessibilityRole="button"
            onPress={() => router.push(`/collection/${group.id}` as never)}
            style={({ pressed }) => [styles.row, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
          >
            <View style={[styles.thumb, { backgroundColor: colors.border }]}>{members[0] && <CoverImage book={members[0]} />}</View>
            <View style={styles.rowText}>
              <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]} numberOfLines={1}>
                {group.name}
              </Text>
              <Text style={[typography.caption, { color: colors.textDim }]}>
                {typeFilter === "all" ? `${GROUP_TYPE_LABEL[group.type]} · ` : ""}
                {members.length} book{members.length === 1 ? "" : "s"}
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.textDim} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge },
  draftRow: { borderWidth: 2, borderStyle: "dashed", borderRadius: 12, padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: 12, padding: spacing.sm },
  thumb: { width: 44, height: 66, borderRadius: 6, overflow: "hidden" },
  rowText: { flex: 1, gap: 2 },
});
