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
        renderItem={({ item, index }) => {
          const key = bookKey(item);
          const move = moves.get(key);
          const canMoveUp = move?.up ?? false;
          const canMoveDown = move?.down ?? false;
          const previous = index > 0 ? moves.get(bookKey(orderedBooks[index - 1])) : undefined;
          const firstInSeries = move?.inSeries && (index === 0 || moves.get(bookKey(orderedBooks[index - 1])) !== move);
          return (
            <View style={[styles.row, { borderColor: colors.border }]}>
              <View style={styles.title}>
                <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
                  {String(item.Title ?? "Untitled")}
                </Text>
                {firstInSeries ? (
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
