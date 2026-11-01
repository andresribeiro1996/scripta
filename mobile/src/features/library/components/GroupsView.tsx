// Lists Series and Collections together — they're the same underlying
// resource (@scripta/shared's Group / groups.ts), differing only in that
// series also get auto-seeded from book metadata. The type filter below
// narrows the list; it doesn't gate which resource is loaded.
//
// Rows only navigate — renaming, Style, Manage books, Select/Delete, and
// deleting the group itself all live on the detail screen
// (app/(app)/(library)/collection/[id].tsx), which is also the deep-link
// target for e.g. the Home mural's "Open collection" button.
//
// Rendered both as the Library screen's "Collections" tab and as the
// standalone /collections route. Both hosts own the search text, the type
// filter and a "New" control (see LibraryScreen.tsx and
// app/(app)/(library)/collections.tsx) — `search` and `typeFilter` are
// controlled props and `startCreating` is exposed via ref so those controls
// can drive this list without it needing its own chrome.

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import { router } from "expo-router";
import { bookKey, makeGroup, orderedGroupBooks, saveFailureMessage, type GroupType } from "@scripta/shared";
import { EmptyState, Input } from "../../../ui/components";
import { Icon, type IconName } from "../../../ui/icon";
import type { SearchDockScrollProps } from "../../../ui/SearchDock";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import { useToast } from "../../../ui/ToastHost";
import { useLibrary } from "../hooks/useLibrary";
import { attemptUpdate } from "../lib/attemptUpdate";
import { CoverImage } from "./CoverImage";
import { getLocale, useT, type MessageKey } from "../../../i18n";

export type TypeFilter = GroupType | "all";

export const TYPE_FILTER_OPTIONS: readonly { value: TypeFilter; labelKey: MessageKey; icon: IconName }[] = [
  { value: "all", labelKey: "library.typeAll", icon: "filter" },
  { value: "series", labelKey: "library.typeSeries", icon: "library" },
  { value: "collection", labelKey: "library.collections", icon: "folder" },
];

const COPY: Record<TypeFilter, { nameKey: MessageKey; emptyTitleKey: MessageKey; emptyBodyKey: MessageKey }> = {
  all: { nameKey: "library.nameThisCollection", emptyTitleKey: "library.noCollectionsYet", emptyBodyKey: "library.emptyAllBody" },
  series: { nameKey: "library.nameThisSeries", emptyTitleKey: "library.noSeriesYet", emptyBodyKey: "library.emptySeriesBody" },
  collection: { nameKey: "library.nameThisCollection", emptyTitleKey: "library.noCollectionsYet", emptyBodyKey: "library.emptyCollectionBody" },
};

const GROUP_TYPE_LABEL: Record<GroupType, MessageKey> = { series: "library.groupTypeSeries", collection: "shell.collection" };

export type GroupsViewHandle = { startCreating: () => void };

type GroupsViewProps = Partial<SearchDockScrollProps> & {
  search: string;
  typeFilter: TypeFilter;
  bottomInset: number;
};

export const GroupsView = forwardRef<GroupsViewHandle, GroupsViewProps>(function GroupsView({ search, typeFilter, bottomInset, ...scrollProps }, ref) {
  const t = useT();
  const { data: library, updateLibrary } = useLibrary();
  // "All" has no single creatable type; a manually-added group there is a
  // collection like any other — series are meant to come from import.
  const draftType: GroupType = typeFilter === "series" ? "series" : "collection";
  const copy = COPY[typeFilter];
  const { colors } = useTheme();
  const { show } = useToast();

  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("");
  const draftOpen = useRef(false);

  useImperativeHandle(ref, () => ({ startCreating: () => { draftOpen.current = true; setDrafting(true); } }), []);

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
    if (!draftOpen.current) return;
    draftOpen.current = false;
    const name = draftName.trim();
    setDrafting(false);
    setDraftName("");
    if (!name) return;
    const group = makeGroup(draftType, name);
    await attemptUpdate(
      () => updateLibrary((data) => ({ ...data, groups: [...(data.groups ?? []), group] })),
      (error) => show(saveFailureMessage(error, t("library.saveFailedConnection"), getLocale()), "error"),
      () => router.push(`/collection/${group.id}` as never),
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]} {...scrollProps} keyboardDismissMode="none">
      {drafting && (
        <View style={[styles.draftRow, { borderColor: colors.accent }]}>
          <Input
            autoFocus
            label={t(copy.nameKey)}
            value={draftName}
            maxLength={200}
            onChangeText={setDraftName}
            onBlur={() => void handleCommitDraft()}
            onSubmitEditing={() => void handleCommitDraft()}
          />
        </View>
      )}

      {!allGroups.length && !drafting && <EmptyState title={t(copy.emptyTitleKey)} body={t(copy.emptyBodyKey)} />}
      {allGroups.length > 0 && groups.length === 0 && <Text style={[typography.body, { color: colors.textDim }]}>{t("library.nothingMatches", { query: search.trim() })}</Text>}

      {groups.map((group) => {
        const members = orderedGroupBooks(group, books);
        const preview = members.slice(0, 5);
        return (
          <Pressable
            key={group.id}
            accessibilityLabel={t("library.openGroup", { name: group.name, type: t(GROUP_TYPE_LABEL[group.type]).toLowerCase(), count: members.length })}
            accessibilityRole="button"
            onPress={() => router.push(`/collection/${group.id}` as never)}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={styles.heading}>
              <Text style={[styles.name, typography.title, { color: colors.text, fontWeight: "700" }]} numberOfLines={2}>
                {group.name}
              </Text>
              <View style={styles.meta}>
                <Text style={[typography.caption, { color: colors.textDim }]}>
                  {t("library.bookCount", { count: members.length })}
                </Text>
                <Icon name="chevronRight" size={14} color={colors.textDim} />
              </View>
            </View>
            <View style={[styles.shelf, { borderBottomColor: colors.border }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {preview.length ? preview.map((book, index) => (
                <View key={bookKey(book)} style={[styles.cover, index % 2 ? styles.shortCover : null, { backgroundColor: colors.border }]}>
                  <CoverImage book={book} />
                </View>
              )) : <View style={[styles.emptyCover, { backgroundColor: colors.surface }]}><Icon name={group.type === "series" ? "library" : "folder"} size={28} color={colors.textDim} /></View>}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xxl },
  draftRow: { borderWidth: 2, borderStyle: "dashed", borderRadius: 12, padding: spacing.md },
  row: { gap: spacing.md },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { flex: 1 },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  shelf: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, minHeight: 88, paddingHorizontal: spacing.xs, paddingBottom: spacing.md, borderBottomWidth: 3 },
  cover: { width: "17%", maxWidth: 64, aspectRatio: 2 / 3, borderRadius: radii.sm, overflow: "hidden" },
  shortCover: { aspectRatio: 0.72 },
  emptyCover: { width: 48, height: 72, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
});
