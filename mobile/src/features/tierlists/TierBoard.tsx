import { useEffect, useState, type ReactNode } from "react";
import { booksByWork, isCharacterBook, workIdOf, type TierDefinition, type TierlistData } from "@scripta/shared";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "../../ui/Text";
import { ActionSheet, Button, Dialog, IconButton, Input, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";

export type TierBook = Record<string, unknown>;

export function titleOf(book: TierBook) { return String(book.Title ?? book.title ?? "Untitled"); }
export function authorOf(book: TierBook) { return isCharacterBook(book) ? "" : String(book.Attribution ?? book.author ?? "Unknown author"); }
export function labelOf(book: TierBook) { return isCharacterBook(book) ? titleOf(book) : `${titleOf(book)} by ${authorOf(book)}`; }
export function workOf(book: TierBook): string | undefined {
  return workIdOf(book);
}

export function TierCover({ book, style, onLoadEnd }: { book: TierBook; style?: StyleProp<ViewStyle>; onLoadEnd?: () => void }) {
  const { colors } = useTheme();
  const [hasCover, setHasCover] = useState(false);
  const character = isCharacterBook(book);
  useEffect(() => { if (character) onLoadEnd?.(); }, [character]);
  if (character) return <View style={[styles.cover, style]}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.characterTile, { backgroundColor: colors.accentSoft }]}><Text numberOfLines={3} {...dynamicType} style={[styles.fallbackTitle, styles.center, { color: colors.accent }]}>{titleOf(book)}</Text></View>
  </View>;
  return <View style={[styles.cover, style]}>
    <CoverImage book={book} onHasCoverChange={setHasCover} onLoadEnd={onLoadEnd} />
    {!hasCover ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: colors.accentSoft }]}><Text numberOfLines={3} {...dynamicType} style={[styles.fallbackTitle, { color: colors.accent }]}>{titleOf(book)}</Text><Text numberOfLines={1} {...dynamicType} style={[styles.fallbackAuthor, { color: colors.textDim }]}>{authorOf(book)}</Text></View> : null}
  </View>;
}

export function TierRowScroll({ style, contentContainerStyle, children }: { style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={content > viewport + 1} onLayout={(event) => setViewport(event.nativeEvent.layout.width)} onContentSizeChange={(width) => setContent(width)} style={style} contentContainerStyle={contentContainerStyle}>{children}</ScrollView>;
}

function BookChip({ book, onReassign }: { book: TierBook; onReassign?: () => void }) {
  return (
    <Pressable disabled={!onReassign} accessibilityRole={onReassign ? "button" : undefined} accessibilityLabel={labelOf(book)} accessibilityHint={onReassign ? `Opens the tier ring to reassign this ${isCharacterBook(book) ? "character" : "book"}` : undefined} onPress={onReassign} onLongPress={onReassign} style={styles.chipWrap}>
      <TierCover book={book} />
    </Pressable>
  );
}

export function TierHead({ children }: { children: ReactNode }) {
  return <View style={styles.head}>{children}</View>;
}

export function TierBoard({ data, books, onChange, structureEditable, poolLabel = "Pool", onReassign, bottomClearance = 0 }: { data: TierlistData; books: TierBook[]; onChange: (data: TierlistData) => void; structureEditable: boolean; poolLabel?: string; onReassign?: (workId: string) => void; bottomClearance?: number }) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<TierDefinition | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("");
  const byWork = booksByWork(books);

  function idsFor(section: string) { return section === "pool" ? data.pool : data.tiers.find((tier) => tier.id === section)?.workIds ?? []; }
  function moveTier(index: number, direction: -1 | 1) {
    const tiers = [...data.tiers];
    [tiers[index], tiers[index + direction]] = [tiers[index + direction]!, tiers[index]!];
    onChange({ ...data, tiers });
  }
  function renderBooks(section: string) {
    const ids = idsFor(section).filter((id) => byWork.has(id));
    if (!ids.length) return <Text {...dynamicType} style={[typography.caption, styles.empty, { color: colors.textDim }]}>{section === "pool" ? `${books.some(isCharacterBook) ? "Characters" : "Books"} unavailable` : "–"}</Text>;
    return <TierRowScroll style={section === "pool" ? styles.poolBooks : styles.booksScroll} contentContainerStyle={styles.books}>{ids.map((id) => <BookChip key={id} book={byWork.get(id)!} onReassign={onReassign ? () => onReassign(id) : undefined} />)}</TierRowScroll>;
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
          <ActionSheet title={tier.label || "Untitled"} groups={[
            [{ label: "Edit tier", icon: "edit", onPress: () => { setEditing(tier); setLabel(tier.label); setColor(tier.color); } }],
            [
              ...(index > 0 ? [{ label: "Move up", icon: "expandVertical" as const, onPress: () => moveTier(index, -1) }] : []),
              ...(index < data.tiers.length - 1 ? [{ label: "Move down", icon: "expandVertical" as const, onPress: () => moveTier(index, 1) }] : []),
            ],
          ]}>
            {(open) => <IconButton accessibilityLabel={`Actions for ${tier.label || "Untitled"} tier`} name="more" onPress={open} />}
          </ActionSheet>
        </View> : null}
      </View>)}
      {data.pool.length ? <View style={styles.footer}>
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>{poolLabel} · {data.pool.length}</Text>
        {renderBooks("pool")}
      </View> : null}
    </ScrollView>
    <Dialog visible={editing !== null} title="Edit tier" onClose={() => setEditing(null)}>
      <View style={styles.dialog}><Input label="Label" value={label} onChangeText={setLabel} /><Input label="Color" value={color} onChangeText={setColor} autoCapitalize="none" /><Button label="Save tier" onPress={() => { if (!editing) return; onChange({ ...data, tiers: data.tiers.map((tier) => tier.id === editing.id ? { ...tier, label: label.trim() || "Untitled", color: /^#[0-9a-f]{6}$/i.test(color) ? color : tier.color } : tier) }); setEditing(null); }} /><Button label="Delete tier" variant="destructive" onPress={() => { if (!editing) return; onChange({ tiers: data.tiers.filter((tier) => tier.id !== editing.id), pool: [...data.pool, ...editing.workIds] }); setEditing(null); }} /></View>
    </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.sm, minHeight: typography.caption.lineHeight * 2 + spacing.sm },
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
  characterTile: { alignItems: "center", justifyContent: "center", padding: 5 },
  fallbackTitle: { fontFamily: "serif", fontSize: 11, lineHeight: 13, fontWeight: "700" },
  fallbackAuthor: { fontSize: 8, lineHeight: 10, fontWeight: "700" },
  center: { textAlign: "center" },
  strong: { fontWeight: "700" },
  empty: { height: "100%", paddingHorizontal: spacing.sm, textAlignVertical: "center" },
  footer: { gap: spacing.xs, paddingTop: spacing.sm },
  dialog: { gap: spacing.md },
});
