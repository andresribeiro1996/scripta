import { useState } from "react";
import { bookKey, type TierDefinition, type TierlistData } from "@scripta/shared";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Button, Dialog, IconButton, Input, Menu, type MenuItem, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";

export type TierBook = Record<string, unknown>;

export function titleOf(book: TierBook) { return String(book.Title ?? book.title ?? "Untitled"); }
export function authorOf(book: TierBook) { return String(book.Attribution ?? book.author ?? "Unknown author"); }
export function keyOf(book: TierBook) {
  if ("Title" in book || "ISBN" in book) return bookKey(book);
  return bookKey({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId });
}

export function TierCover({ book, style }: { book: TierBook; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const [hasCover, setHasCover] = useState(false);
  return <View style={[styles.cover, style]}>
    <CoverImage book={book} onHasCoverChange={setHasCover} />
    {!hasCover ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: colors.accentSoft }]}><Text numberOfLines={3} {...dynamicType} style={[styles.fallbackTitle, { color: colors.accent }]}>{titleOf(book)}</Text><Text numberOfLines={1} {...dynamicType} style={[styles.fallbackAuthor, { color: colors.textDim }]}>{authorOf(book)}</Text></View> : null}
  </View>;
}

function BookChip({ book, onReassign }: { book: TierBook; onReassign?: () => void }) {
  return (
    <Pressable disabled={!onReassign} accessibilityRole={onReassign ? "button" : undefined} accessibilityLabel={`${titleOf(book)} by ${authorOf(book)}`} accessibilityHint={onReassign ? "Opens the tier ring to reassign this book" : undefined} onPress={onReassign} onLongPress={onReassign} style={styles.chipWrap}>
      <TierCover book={book} />
    </Pressable>
  );
}

export function TierBoard({ data, books, onChange, structureEditable, poolLabel = "Pool", onReassign, bottomClearance = 0 }: { data: TierlistData; books: TierBook[]; onChange: (data: TierlistData) => void; structureEditable: boolean; poolLabel?: string; onReassign?: (bookKey: string) => void; bottomClearance?: number }) {
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
    return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={section === "pool" ? styles.poolBooks : styles.booksScroll} contentContainerStyle={styles.books}>{keys.map((key) => <BookChip key={key} book={byKey.get(key)!} onReassign={onReassign ? () => onReassign(key) : undefined} />)}</ScrollView>;
  }

  return (
    <>
    <ScrollView
      style={[styles.grow, { marginTop: spacing.md }]}
      contentContainerStyle={[styles.board, { paddingBottom: bottomClearance }]}
    >
      {data.tiers.map((tier, index) => <View key={tier.id} style={[styles.tier, { backgroundColor: colors.surface }, index === 0 && styles.topCorners, index === data.tiers.length - 1 && styles.bottomCorners]}>
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
      </View>)}
      {data.pool.length ? <View style={styles.footer}>
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>{poolLabel} · {data.pool.length}</Text>
        {renderBooks("pool")}
      </View> : null}
    </ScrollView>
    <Dialog visible={editing !== null} title="Edit tier" onClose={() => setEditing(null)}>
      <View style={styles.dialog}><Input label="Label" value={label} onChangeText={setLabel} /><Input label="Color" value={color} onChangeText={setColor} autoCapitalize="none" /><Button label="Save tier" onPress={() => { if (!editing) return; onChange({ ...data, tiers: data.tiers.map((tier) => tier.id === editing.id ? { ...tier, label: label.trim() || "Untitled", color: /^#[0-9a-f]{6}$/i.test(color) ? color : tier.color } : tier) }); setEditing(null); }} /><Button label="Delete tier" variant="destructive" onPress={() => { if (!editing) return; onChange({ tiers: data.tiers.filter((tier) => tier.id !== editing.id), pool: [...data.pool, ...editing.bookKeys] }); setEditing(null); }} /></View>
    </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  board: { flexGrow: 1 },
  tier: { height: 84, flexDirection: "row", overflow: "hidden" },
  topCorners: { borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md },
  bottomCorners: { borderBottomLeftRadius: radii.md, borderBottomRightRadius: radii.md },
  tierLabel: { width: 42, alignItems: "center", justifyContent: "center", padding: 2 },
  tierActions: { width: 44, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1 },
  booksScroll: { flex: 1 },
  poolBooks: { height: 84 },
  books: { flexGrow: 1, alignItems: "stretch", gap: 2 },
  chipWrap: { width: 56, height: 84 },
  cover: { width: "100%", height: "100%", borderRadius: 2, overflow: "hidden" },
  fallback: { justifyContent: "space-between", padding: 5 },
  fallbackTitle: { fontFamily: "serif", fontSize: 11, lineHeight: 13, fontWeight: "700" },
  fallbackAuthor: { fontSize: 8, lineHeight: 10, fontWeight: "700" },
  center: { textAlign: "center" },
  strong: { fontWeight: "700" },
  empty: { height: "100%", paddingHorizontal: spacing.sm, textAlignVertical: "center" },
  footer: { gap: spacing.xs, paddingTop: spacing.sm },
  dialog: { gap: spacing.md },
});
