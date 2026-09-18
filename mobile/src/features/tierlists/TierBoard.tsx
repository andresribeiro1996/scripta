import { useState } from "react";
import { bookKey, type TierDefinition, type TierlistData } from "@scripta/shared";
import { Image } from "expo-image";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Dialog, IconButton, Input, Menu, type MenuItem, dynamicType, radii, spacing, typography, useTheme } from "../../ui";

export type TierBook = Record<string, unknown>;

export function titleOf(book: TierBook) { return String(book.Title ?? book.title ?? "Untitled"); }
export function authorOf(book: TierBook) { return String(book.Attribution ?? book.author ?? "Unknown author"); }
export function coverOf(book: TierBook) { const value = book._coverUrl ?? book.coverUrl; return typeof value === "string" ? value : null; }
export function keyOf(book: TierBook) {
  if ("Title" in book || "ISBN" in book) return bookKey(book);
  return bookKey({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId });
}

function BookChip({ book, onReassign }: { book: TierBook; onReassign?: () => void }) {
  const { colors } = useTheme();
  const cover = coverOf(book);
  return (
    <Pressable disabled={!onReassign} accessibilityRole={onReassign ? "button" : undefined} accessibilityLabel={`${titleOf(book)} by ${authorOf(book)}`} accessibilityHint={onReassign ? "Opens the tier ring to reassign this book" : undefined} onPress={onReassign} onLongPress={onReassign} style={styles.chipWrap}>
      {cover ? <Image source={cover} style={styles.cover} contentFit="cover" /> : <View style={[styles.cover, styles.fallback, { backgroundColor: colors.accentSoft }]}><Text numberOfLines={3} {...dynamicType} style={[styles.fallbackTitle, { color: colors.accent }]}>{titleOf(book)}</Text><Text numberOfLines={1} {...dynamicType} style={[styles.fallbackAuthor, { color: colors.textDim }]}>{authorOf(book)}</Text></View>}
    </Pressable>
  );
}

export function TierBoard({ data, books, onChange, structureEditable, poolLabel = "Pool", onReassign }: { data: TierlistData; books: TierBook[]; onChange: (data: TierlistData) => void; structureEditable: boolean; poolLabel?: string; onReassign?: (bookKey: string) => void }) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<TierDefinition | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("");
  const byKey = new Map(books.map((book) => [keyOf(book), book]));

  function keysFor(section: string) { return section === "pool" ? data.pool : data.tiers.find((tier) => tier.id === section)?.bookKeys ?? []; }
  function moveTier(index: number, direction: -1 | 1) {
    const tiers = [...data.tiers];
    [tiers[index], tiers[index + direction]] = [tiers[index + direction]!, tiers[index]!];
    onChange({ ...data, tiers });
  }
  function renderBooks(section: string) {
    const keys = keysFor(section).filter((key) => byKey.has(key));
    if (!keys.length) return <Text {...dynamicType} style={[typography.caption, styles.empty, { color: colors.textDim }]}>{section === "pool" ? "Books unavailable" : "–"}</Text>;
    return <View style={styles.books}>{keys.map((key) => <BookChip key={key} book={byKey.get(key)!} onReassign={onReassign ? () => onReassign(key) : undefined} />)}</View>;
  }

  return (
    <>
    <FlatList
      style={styles.grow}
      data={data.tiers}
      keyExtractor={(tier) => tier.id}
      contentContainerStyle={styles.board}
      renderItem={({ item: tier, index }) => <View style={[styles.tier, !tier.bookKeys.some((key) => byKey.has(key)) && styles.emptyTier, { backgroundColor: colors.surface }, index === 0 && styles.topCorners, index === data.tiers.length - 1 && styles.bottomCorners]}>
        <View style={[styles.tierLabel, { backgroundColor: tier.color }]}><Text numberOfLines={3} {...dynamicType} style={[typography.caption, styles.strong, styles.center, { color: "#fff" }]}>{tier.label || "Untitled"}</Text></View>
        <View style={styles.grow}>{renderBooks(tier.id)}</View>
        {structureEditable ? <View style={styles.tierActions}>
          <Menu title={tier.label || "Untitled"} items={[
            { label: "Edit tier", onPress: () => { setEditing(tier); setLabel(tier.label); setColor(tier.color); } },
            ...(index > 0 ? [{ label: "Move up", onPress: () => moveTier(index, -1) }] : []),
            ...(index < data.tiers.length - 1 ? [{ label: "Move down", onPress: () => moveTier(index, 1) }] : []),
          ]}>
            <IconButton accessibilityLabel={`Actions for ${tier.label || "Untitled"} tier`} name="more" />
          </Menu>
        </View> : null}
      </View>}
      ListFooterComponent={data.pool.length ? <View style={styles.footer}>
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>{poolLabel} · {data.pool.length}</Text>
        {renderBooks("pool")}
      </View> : null}
    />
    <Dialog visible={editing !== null} title="Edit tier" onClose={() => setEditing(null)}>
      <View style={styles.dialog}><Input label="Label" value={label} onChangeText={setLabel} /><Input label="Color" value={color} onChangeText={setColor} autoCapitalize="none" /><Button label="Save tier" onPress={() => { if (!editing) return; onChange({ ...data, tiers: data.tiers.map((tier) => tier.id === editing.id ? { ...tier, label: label.trim() || "Untitled", color: /^#[0-9a-f]{6}$/i.test(color) ? color : tier.color } : tier) }); setEditing(null); }} /><Button label="Delete tier" variant="destructive" onPress={() => { if (!editing) return; onChange({ tiers: data.tiers.filter((tier) => tier.id !== editing.id), pool: [...data.pool, ...editing.bookKeys] }); setEditing(null); }} /></View>
    </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  board: { paddingBottom: spacing.huge },
  tier: { minHeight: 74, flexDirection: "row", overflow: "hidden" },
  emptyTier: { minHeight: 46 },
  topCorners: { borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md },
  bottomCorners: { borderBottomLeftRadius: radii.md, borderBottomRightRadius: radii.md },
  tierLabel: { width: 42, alignItems: "center", justifyContent: "center", padding: 2 },
  tierActions: { width: 44, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1 },
  books: { minHeight: 84, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 2, padding: 2 },
  chipWrap: { width: 58, height: 82 },
  cover: { width: 58, height: 82, borderRadius: 2 },
  fallback: { justifyContent: "space-between", padding: 5 },
  fallbackTitle: { fontFamily: "serif", fontSize: 11, lineHeight: 13, fontWeight: "700" },
  fallbackAuthor: { fontSize: 8, lineHeight: 10, fontWeight: "700" },
  center: { textAlign: "center" },
  strong: { fontWeight: "700" },
  empty: { padding: spacing.sm },
  footer: { gap: spacing.xs, paddingTop: spacing.sm },
  dialog: { gap: spacing.md },
});
