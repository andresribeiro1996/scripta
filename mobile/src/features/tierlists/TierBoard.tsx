import { useState } from "react";
import { bookKey, createTier, type TierDefinition, type TierlistData } from "@scripta/shared";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Dialog, Input, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { moveBook, reorderBook } from "./tierBoardData";

export type TierBook = Record<string, unknown>;

function titleOf(book: TierBook) { return String(book.Title ?? book.title ?? "Untitled"); }
function authorOf(book: TierBook) { return String(book.Attribution ?? book.author ?? "Unknown author"); }
function coverOf(book: TierBook) { const value = book._coverUrl ?? book.coverUrl; return typeof value === "string" ? value : null; }
export function keyOf(book: TierBook) {
  if ("Title" in book || "ISBN" in book) return bookKey(book);
  return bookKey({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId });
}

function BookChip({ book, onDrag, onMoveUp, onMoveDown, onEarlier, onLater }: { book: TierBook; onDrag: (direction: -1 | 1) => void; onMoveUp?: () => void; onMoveDown?: () => void; onEarlier?: () => void; onLater?: () => void }) {
  const { colors } = useTheme();
  const y = useSharedValue(0);
  const dragging = useSharedValue(1);
  const gesture = Gesture.Pan().activateAfterLongPress(220).onBegin(() => { dragging.value = 0.75; }).onUpdate((event) => { y.value = event.translationY; }).onEnd((event) => { if (Math.abs(event.translationY) > 36) runOnJS(onDrag)(event.translationY < 0 ? -1 : 1); }).onFinalize(() => { y.value = withSpring(0); dragging.value = withSpring(1); });
  const animated = useAnimatedStyle(() => ({ opacity: dragging.value, transform: [{ translateY: y.value }] }));
  const cover = coverOf(book);
  return (
    <View style={styles.chipWrap}>
      <GestureDetector gesture={gesture}>
        <Animated.View accessibilityLabel={`${titleOf(book)} by ${authorOf(book)}. Long press and drag vertically to move.`} style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }, animated]}>
          {cover ? <Image source={cover} style={styles.cover} contentFit="cover" /> : <View style={[styles.cover, styles.fallback, { backgroundColor: colors.accentSoft }]}><Text {...dynamicType} style={{ color: colors.accent }}>{titleOf(book).charAt(0)}</Text></View>}
          <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.center, { color: colors.text }]}>{titleOf(book)}</Text>
        </Animated.View>
      </GestureDetector>
      <View style={styles.miniControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${titleOf(book)} to previous section`} disabled={!onMoveUp} onPress={onMoveUp} style={styles.mini}><Text style={{ color: onMoveUp ? colors.text : colors.textDim }}>↑</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${titleOf(book)} earlier`} disabled={!onEarlier} onPress={onEarlier} style={styles.mini}><Text style={{ color: onEarlier ? colors.text : colors.textDim }}>←</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${titleOf(book)} later`} disabled={!onLater} onPress={onLater} style={styles.mini}><Text style={{ color: onLater ? colors.text : colors.textDim }}>→</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${titleOf(book)} to next section`} disabled={!onMoveDown} onPress={onMoveDown} style={styles.mini}><Text style={{ color: onMoveDown ? colors.text : colors.textDim }}>↓</Text></Pressable>
      </View>
    </View>
  );
}

export function TierBoard({ data, books, onChange, structureEditable, onAddBooks, poolLabel = "Pool" }: { data: TierlistData; books: TierBook[]; onChange: (data: TierlistData) => void; structureEditable: boolean; onAddBooks?: () => void; poolLabel?: string }) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<TierDefinition | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("");
  const sections = [...data.tiers.map((tier) => tier.id), "pool"];
  const byKey = new Map(books.map((book) => [keyOf(book), book]));

  function keysFor(section: string) { return section === "pool" ? data.pool : data.tiers.find((tier) => tier.id === section)?.bookKeys ?? []; }
  function moveSection(key: string, direction: -1 | 1) { onChange(moveBook(data, key, direction)); }
  function reorder(key: string, direction: -1 | 1) { onChange(reorderBook(data, key, direction)); }
  function renderBooks(section: string) {
    const keys = keysFor(section).filter((key) => byKey.has(key));
    const index = sections.indexOf(section);
    return <FlatList horizontal data={keys} keyExtractor={(key) => key} contentContainerStyle={styles.books} ListEmptyComponent={<Text {...dynamicType} style={[typography.caption, styles.empty, { color: colors.textDim }]}>No books here.</Text>} renderItem={({ item, index: bookIndex }) => <BookChip book={byKey.get(item)!} onDrag={(direction) => moveSection(item, direction)} onMoveUp={index > 0 ? () => moveSection(item, -1) : undefined} onMoveDown={index < sections.length - 1 ? () => moveSection(item, 1) : undefined} onEarlier={bookIndex > 0 ? () => reorder(item, -1) : undefined} onLater={bookIndex < keys.length - 1 ? () => reorder(item, 1) : undefined} />} />;
  }

  return (
    <>
    <FlatList
      style={styles.grow}
      data={data.tiers}
      keyExtractor={(tier) => tier.id}
      contentContainerStyle={styles.board}
      renderItem={({ item: tier, index }) => <View style={[styles.tier, { borderColor: colors.border }]}>
        <View style={[styles.tierLabel, { backgroundColor: tier.color }]}><Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: "#fff" }]}>{tier.label || "Untitled"}</Text></View>
        <View style={styles.grow}>{renderBooks(tier.id)}</View>
        {structureEditable ? <View style={styles.tierActions}><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${tier.label} tier`} onPress={() => { setEditing(tier); setLabel(tier.label); setColor(tier.color); }}><Text style={{ color: colors.accent }}>Edit</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Move ${tier.label} tier up`} disabled={index === 0} onPress={() => { const tiers = [...data.tiers]; [tiers[index - 1], tiers[index]] = [tiers[index], tiers[index - 1]]; onChange({ ...data, tiers }); }}><Text style={{ color: colors.textDim }}>↑</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Move ${tier.label} tier down`} disabled={index === data.tiers.length - 1} onPress={() => { const tiers = [...data.tiers]; [tiers[index], tiers[index + 1]] = [tiers[index + 1], tiers[index]]; onChange({ ...data, tiers }); }}><Text style={{ color: colors.textDim }}>↓</Text></Pressable></View> : null}
      </View>}
      ListFooterComponent={<View style={styles.footer}>
        {structureEditable ? <View style={styles.row}><Button label="Add tier" variant="secondary" onPress={() => onChange({ ...data, tiers: [...data.tiers, createTier("New tier", "#8a8580")] })} />{onAddBooks ? <Button label="Add books" variant="secondary" onPress={onAddBooks} /> : null}</View> : null}
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>{poolLabel} · {data.pool.length}</Text>
        {renderBooks("pool")}
      </View>}
    />
    <Dialog visible={editing !== null} title="Edit tier" onClose={() => setEditing(null)}>
      <View style={styles.dialog}><Input label="Label" value={label} onChangeText={setLabel} /><Input label="Color" value={color} onChangeText={setColor} autoCapitalize="none" /><Button label="Save tier" onPress={() => { if (!editing) return; onChange({ ...data, tiers: data.tiers.map((tier) => tier.id === editing.id ? { ...tier, label: label.trim() || "Untitled", color: /^#[0-9a-f]{6}$/i.test(color) ? color : tier.color } : tier) }); setEditing(null); }} /><Button label="Delete tier" variant="destructive" onPress={() => { if (!editing) return; onChange({ tiers: data.tiers.filter((tier) => tier.id !== editing.id), pool: [...data.pool, ...editing.bookKeys] }); setEditing(null); }} /></View>
    </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  board: { gap: spacing.sm, paddingBottom: spacing.huge },
  tier: { minHeight: 130, borderWidth: 1, borderRadius: radii.md, flexDirection: "row", overflow: "hidden" },
  tierLabel: { width: 56, alignItems: "center", justifyContent: "center", padding: spacing.xs },
  tierActions: { width: 42, alignItems: "center", justifyContent: "space-around", paddingVertical: spacing.sm },
  grow: { flex: 1 },
  books: { minHeight: 128, alignItems: "flex-start", gap: spacing.sm, padding: spacing.sm },
  chipWrap: { width: 86, alignItems: "center", gap: spacing.xs },
  chip: { width: 82, height: 108, borderWidth: 1, borderRadius: radii.md, padding: spacing.xs, alignItems: "center", gap: spacing.xs },
  cover: { width: 42, height: 62, borderRadius: radii.sm },
  fallback: { alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  strong: { fontWeight: "700" },
  miniControls: { flexDirection: "row" },
  mini: { width: 21, height: 28, alignItems: "center", justifyContent: "center" },
  empty: { padding: spacing.lg },
  footer: { gap: spacing.sm, paddingTop: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  dialog: { gap: spacing.md },
});
