// Accessible, non-gesture reorder controls — this task's brief asks for
// "accessible non-gesture controls plus drag if practical"; a full drag
// gesture (Gesture Handler/Reanimated, already installed) over the
// virtualized grid is real future work this task didn't reach (see this
// task's handoff notes for the gap) — VoiceOver/TalkBack can already
// operate this list's Up/Down buttons today, which a drag gesture alone
// never gives you for free.
//
// Renders as a plain vertical list (not the grid) — reordering by
// scanning up/down through a list of titles is a more legible mental
// model than picking out cover art in a grid, and it's the same list
// shape @scripta/shared's own `orderLibraryBooks` already produces
// (series clustered together, ahead of standalone books). Arrows move a
// series past the next series, or a standalone book past the next
// standalone book — see libraryOrder.ts's moveUnit.

import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import { bookKey, unitMoves, type Group } from "@scripta/shared";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";

export function ReorderList({
  orderedBooks,
  groups,
  onMove,
  onClose,
}: {
  /** Same display order LibraryScreen's grid renders (before search/
   *  filter/sort narrows it further — reordering only makes sense
   *  against the library's OWN order, not a filtered view of it). */
  orderedBooks: Array<Record<string, unknown>>;
  groups: Group[];
  onMove: (key: string, direction: "up" | "down") => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const moves = useMemo(() => unitMoves(orderedBooks, groups), [orderedBooks, groups]);

  return (
    <>
      <FlatList
        data={orderedBooks}
        keyExtractor={(book, i) => String(book.ContentID ?? i)}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        renderItem={({ item }) => {
          const key = bookKey(item);
          const move = moves.get(key);
          const canMoveUp = move?.up ?? false;
          const canMoveDown = move?.down ?? false;
          return (
            <View style={[styles.row, { borderColor: colors.border }]}>
              <View style={styles.title}>
                <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
                  {String(item.Title ?? "Untitled")}
                </Text>
                {move?.inSeries ? (
                  <Text style={[typography.caption, { color: colors.textDim }]}>Series stay at the top and move together.</Text>
                ) : null}
              </View>
              <Pressable
                accessibilityLabel={`Move "${String(item.Title ?? "book")}" up`}
                accessibilityRole="button"
                disabled={!canMoveUp}
                onPress={() => canMoveUp && onMove(key, "up")}
                style={[styles.button, { borderColor: colors.border, opacity: canMoveUp ? 1 : 0.35 }]}
              >
                <Text style={{ color: colors.text }}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Move "${String(item.Title ?? "book")}" down`}
                accessibilityRole="button"
                disabled={!canMoveDown}
                onPress={() => canMoveDown && onMove(key, "down")}
                style={[styles.button, { borderColor: colors.border, opacity: canMoveDown ? 1 : 0.35 }]}
              >
                <Text style={{ color: colors.text }}>↓</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: minimumTouchTarget, borderBottomWidth: 1, paddingVertical: spacing.sm },
  title: { flex: 1 },
  button: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
});
