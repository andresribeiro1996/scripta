import { router, useSegments } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { duelWinner, sharePercent, type Duel, type DuelSide } from "@scripta/shared";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { workPath } from "../works/workPath";
import { BookCover } from "./BookCover";
import { useT } from "../../i18n";

export function DuelSideRow({ side, duel, character = false, onClose }: { side: DuelSide; duel: Duel; character?: boolean; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const percent = sharePercent(side.votes, duel);
  const segments = useSegments();
  return (
    <View accessibilityLabel={character ? side.title : t("arena.titleByAuthor", { title: side.title, author: side.author })} style={[styles.side, { borderColor: duelWinner(duel) === side ? colors.success : colors.border }]}>
      <BookCover cover={side.cover} title={side.title} width={46} height={66} />
      <View style={styles.grow}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{side.title}</Text>
        {character ? null : <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.author}</Text>}
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{percent === null ? t("arena.votesLine", { count: side.votes }) : t("arena.votesLinePercent", { count: side.votes, percent })}</Text>
        {side.workId && !character ? <Button label={t("arena.aboutBook")} accessibilityLabel={t("arena.aboutTitle", { title: side.title })} variant="secondary" onPress={() => { onClose(); router.push(workPath(side.workId!, segments) as never); }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  side: { minHeight: 84, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm, flexDirection: "row", gap: spacing.md, alignItems: "center" },
});
