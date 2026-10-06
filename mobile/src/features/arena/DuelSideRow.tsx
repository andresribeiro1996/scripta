import { router, useSegments } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { duelWinner, sharePercent, type Duel, type DuelSide } from "@scripta/shared";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { workPath } from "../works/workScreenModel";
import { BookCover } from "./BookCover";

export function DuelSideRow({ side, duel, onClose }: { side: DuelSide; duel: Duel; onClose: () => void }) {
  const { colors } = useTheme();
  const percent = sharePercent(side.votes, duel);
  const segments = useSegments();
  return (
    <View accessibilityLabel={`${side.title} by ${side.author}`} style={[styles.side, { borderColor: duelWinner(duel) === side ? colors.success : colors.border }]}>
      <BookCover cover={side.cover} title={side.title} width={46} height={66} />
      <View style={styles.grow}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{side.title}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.author}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.votes} votes{percent === null ? "" : ` · ${percent}%`}</Text>
        {side.workId ? <Button label="About this book" accessibilityLabel={`About ${side.title}`} variant="secondary" onPress={() => { onClose(); router.push(workPath(side.workId!, segments) as never); }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  side: { minHeight: 84, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm, flexDirection: "row", gap: spacing.md, alignItems: "center" },
});
