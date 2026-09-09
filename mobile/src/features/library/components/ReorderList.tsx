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
// (series clustered together, ahead of standalone books). Moving a book
// that's in a series moves the WHOLE series as a unit — see
// libraryOrder.ts's own reorderOnDrop comment; this sheet doesn't
// re-implement that, it just calls reorderOnDrop with the adjacent
// item's key as the drop target, same as a drag-and-drop would.

import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { bookKey } from "@scripta/shared";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";

export function ReorderList({
  orderedBooks,
  onMove,
  onClose,
}: {
  /** Same display order LibraryScreen's grid renders (before search/
   *  filter/sort narrows it further — reordering only makes sense
   *  against the library's OWN order, not a filtered view of it). */
  orderedBooks: Array<Record<string, unknown>>;
  onMove: (draggedKey: string, targetKey: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  return (
    <>
      <FlatList
        data={orderedBooks}
        keyExtractor={(book, i) => String(book.ContentID ?? i)}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        renderItem={({ item, index }) => {
          const key = bookKey(item);
          const canMoveUp = index > 0;
          const canMoveDown = index < orderedBooks.length - 1;
          return (
            <View style={[styles.row, { borderColor: colors.border }]}>
              <Text style={[typography.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {String(item.Title ?? "Untitled")}
              </Text>
              <Pressable
                accessibilityLabel={`Move "${String(item.Title ?? "book")}" up`}
                accessibilityRole="button"
                disabled={!canMoveUp}
                onPress={() => canMoveUp && onMove(key, bookKey(orderedBooks[index - 1]))}
                style={[styles.button, { borderColor: colors.border, opacity: canMoveUp ? 1 : 0.35 }]}
              >
                <Text style={{ color: colors.text }}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Move "${String(item.Title ?? "book")}" down`}
                accessibilityRole="button"
                disabled={!canMoveDown}
                onPress={() => canMoveDown && onMove(key, bookKey(orderedBooks[index + 1]))}
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
  button: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
});
