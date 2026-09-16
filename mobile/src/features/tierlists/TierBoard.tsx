import { useState } from "react";
import { bookKey, type TierDefinition, type TierlistData } from "@scripta/shared";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { commitHaptic, liftHaptic } from "../../ui/haptics";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Button, Dialog, IconButton, Input, Menu, type MenuItem, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { moveBook, moveBookTo, reorderBook } from "./tierBoardData";

export type TierBook = Record<string, unknown>;

export function titleOf(book: TierBook) { return String(book.Title ?? book.title ?? "Untitled"); }
export function authorOf(book: TierBook) { return String(book.Attribution ?? book.author ?? "Unknown author"); }
export function coverOf(book: TierBook) { const value = book._coverUrl ?? book.coverUrl; return typeof value === "string" ? value : null; }
export function keyOf(book: TierBook) {
  if ("Title" in book || "ISBN" in book) return bookKey(book);
  return bookKey({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId });
}

function BookChip({ book, onDrag, menuItems }: { book: TierBook; onDrag: (direction: -1 | 1) => void; menuItems: MenuItem[] }) {
  const { colors } = useTheme();
  const y = useSharedValue(0);
  const dragging = useSharedValue(1);
  // onStart, not onBegin: onBegin fires on finger-down, so the chip used to dim
  // 220ms before the long press had actually armed the drag. Both the dim and
  // the lift haptic now land on the frame the gesture really activates.
  const gesture = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => { dragging.value = 0.75; scheduleOnRN(liftHaptic); })
    .onUpdate((event) => { y.value = event.translationY; })
    .onEnd((event) => {
      if (Math.abs(event.translationY) > 36) {
        scheduleOnRN(onDrag, event.translationY < 0 ? -1 : 1);
        scheduleOnRN(commitHaptic);
      }
    })
    .onFinalize(() => { y.value = withSpring(0); dragging.value = withSpring(1); });
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
      <Menu title={titleOf(book)} items={menuItems}>
        <IconButton name="more" accessibilityLabel={`Move ${titleOf(book)}`} />
      </Menu>
    </View>
  );
}

export function TierBoard({ data, books, onChange, structureEditable, poolLabel = "Pool" }: { data: TierlistData; books: TierBook[]; onChange: (data: TierlistData) => void; structureEditable: boolean; poolLabel?: string }) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<TierDefinition | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("");
  const sections = [...data.tiers.map((tier) => tier.id), "pool"];
  const byKey = new Map(books.map((book) => [keyOf(book), book]));

  function keysFor(section: string) { return section === "pool" ? data.pool : data.tiers.find((tier) => tier.id === section)?.bookKeys ?? []; }
  function sectionLabel(section: string) { return section === "pool" ? poolLabel : data.tiers.find((tier) => tier.id === section)?.label || "Untitled"; }
  function moveSection(key: string, direction: -1 | 1) { onChange(moveBook(data, key, direction)); }
  function moveTier(index: number, direction: -1 | 1) {
    const tiers = [...data.tiers];
    [tiers[index], tiers[index + direction]] = [tiers[index + direction]!, tiers[index]!];
    onChange({ ...data, tiers });
  }
  function moveTo(key: string, target: string) { onChange(moveBookTo(data, key, target)); }
  function reorder(key: string, direction: -1 | 1) { onChange(reorderBook(data, key, direction)); }
  function renderBooks(section: string) {
    const keys = keysFor(section).filter((key) => byKey.has(key));
    return <FlatList horizontal data={keys} keyExtractor={(key) => key} contentContainerStyle={styles.books} ListEmptyComponent={<Text {...dynamicType} style={[typography.caption, styles.empty, { color: colors.textDim }]}>No books here.</Text>} renderItem={({ item, index: bookIndex }) => {
      const menuItems: MenuItem[] = [
        ...sections.filter((candidate) => candidate !== section).map((candidate) => ({ label: `Move to ${sectionLabel(candidate)}`, onPress: () => moveTo(item, candidate) })),
        ...(bookIndex > 0 ? [{ label: "Move earlier", onPress: () => reorder(item, -1) }] : []),
        ...(bookIndex < keys.length - 1 ? [{ label: "Move later", onPress: () => reorder(item, 1) }] : []),
      ];
      return <BookChip book={byKey.get(item)!} onDrag={(direction) => moveSection(item, direction)} menuItems={menuItems} />;
    }} />;
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
      ListFooterComponent={<View style={styles.footer}>
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
  tier: { minHeight: 96, borderWidth: 1, borderRadius: radii.md, flexDirection: "row", overflow: "hidden" },
  tierLabel: { width: 48, alignItems: "center", justifyContent: "center", padding: spacing.xs },
  tierActions: { alignItems: "center", justifyContent: "center" },
  grow: { flex: 1 },
  books: { minHeight: 92, alignItems: "flex-start", gap: spacing.sm, padding: spacing.sm },
  chipWrap: { width: 86, alignItems: "center", gap: spacing.xs },
  chip: { width: 82, height: 108, borderWidth: 1, borderRadius: radii.md, padding: spacing.xs, alignItems: "center", gap: spacing.xs },
  cover: { width: 42, height: 62, borderRadius: radii.sm },
  fallback: { alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  strong: { fontWeight: "700" },
  empty: { padding: spacing.md },
  footer: { gap: spacing.sm, paddingTop: spacing.md },
  dialog: { gap: spacing.md },
});
