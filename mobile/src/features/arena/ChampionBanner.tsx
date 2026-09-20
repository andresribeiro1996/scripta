// The payoff screen. Once every match is played the Match pane has nothing
// to vote on, so it hands the space to the book that won — at a size the
// bracket's 32pt row thumbnails can't give it.

import { StyleSheet, Text, View } from "react-native";
import type { DuelSide } from "@scripta/shared";
import { Icon, dynamicType, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";

const COVER_WIDTH = 140;
const COVER_HEIGHT = 210;

export function ChampionBanner({ champion }: { champion: DuelSide }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={`Winner: ${champion.title} by ${champion.author}`} style={styles.wrap}>
      <BookCover cover={champion.cover} title={champion.title} width={COVER_WIDTH} height={COVER_HEIGHT} />
      <View style={styles.label}>
        <Icon name="champion" size={16} color={colors.accent} />
        <Text {...dynamicType} style={[typography.caption, styles.labelText, { color: colors.accent }]}>Winner</Text>
      </View>
      <Text {...dynamicType} numberOfLines={3} style={[typography.heading, styles.title, { color: colors.text }]}>{champion.title}</Text>
      <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.center, { color: colors.textDim }]}>{champion.author}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.sm },
  label: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  labelText: { fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  title: { fontWeight: "700", textAlign: "center" },
  center: { textAlign: "center" },
});
