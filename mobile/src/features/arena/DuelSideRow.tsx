import { StyleSheet, Text, View } from "react-native";
import { sharePercent, type Duel, type DuelSide } from "@scripta/shared";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";

export function DuelSideRow({ side, duel }: { side: DuelSide; duel: Duel }) {
  const { colors } = useTheme();
  const percent = sharePercent(side.votes, duel);
  return (
    <View accessibilityLabel={`${side.title} by ${side.author}`} style={[styles.side, { borderColor: duel.winnerKey === side.key ? colors.success : colors.border }]}>
      <BookCover cover={side.cover} title={side.title} width={46} height={66} />
      <View style={styles.grow}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{side.title}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.author}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.votes} votes{percent === null ? "" : ` · ${percent}%`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  side: { minHeight: 84, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm, flexDirection: "row", gap: spacing.md, alignItems: "center" },
});
