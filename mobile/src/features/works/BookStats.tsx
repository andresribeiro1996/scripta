import { Pressable, StyleSheet, View } from "react-native";
import type { BookStatsModel } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";

export function StatsStrip({ cells, onPress }: { cells: BookStatsModel["strip"]; onPress: () => void }) {
  const { colors } = useTheme();
  if (cells.length === 0) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Book stats: ${cells.map((cell) => `${cell.value}, ${cell.label}`).join("; ")}`} onPress={onPress} style={[styles.strip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {cells.map((cell) => (
        <View key={cell.key} style={styles.cell}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{cell.value}</Text>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{cell.label}</Text>
        </View>
      ))}
    </Pressable>
  );
}

export function StatsSections({ model }: { model: BookStatsModel }) {
  const { colors } = useTheme();
  const { ratings, tiers, tiersEmpty, tournaments, tournamentsEmpty } = model;
  const heading = (title: string) => <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{title}</Text>;
  const dim = (text: string) => <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{text}</Text>;
  return (
    <View style={styles.sections}>
      <View style={styles.section}>
        {heading("Ratings")}
        {ratings.openLibrary ? dim(ratings.openLibrary) : null}
        {ratings.community ? (
          <>
            <Text {...dynamicType} style={[typography.heading, { color: colors.text }]}>{ratings.community.feeling}</Text>
            {dim(ratings.community.summary)}
            {ratings.community.bars.map((bar) => (
              <View key={bar.label} style={styles.barRow}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.barLabel, { color: colors.text }]}>{bar.label}</Text>
                <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                  <View style={{ width: `${Math.round(bar.fraction * 100)}%`, backgroundColor: colors.accent }} />
                </View>
                <Text {...dynamicType} style={[typography.caption, styles.barCount, { color: colors.textDim }]}>{bar.count}</Text>
              </View>
            ))}
          </>
        ) : null}
        {ratings.empty ? dim(ratings.empty) : null}
      </View>
      <View style={styles.section}>
        {heading("Tier lists")}
        {tiers ? (
          <View style={styles.tierRow}>
            <Text {...dynamicType} style={[typography.heading, styles.strong, { color: colors.text }]}>{tiers.letter}</Text>
            <View style={styles.flex}>{dim(tiers.summary)}</View>
          </View>
        ) : dim(tiersEmpty ?? "")}
      </View>
      <View style={styles.section}>
        {heading("Tournaments")}
        {tournaments ? (
          <View style={styles.grid}>
            {tournaments.map((cell) => (
              <View key={cell.label} style={[styles.gridCell, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{cell.label}</Text>
                <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{cell.value}</Text>
              </View>
            ))}
          </View>
        ) : dim(tournamentsEmpty ?? "")}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, marginTop: spacing.sm },
  cell: { flexGrow: 1, flexBasis: "45%", minWidth: 0, paddingRight: spacing.sm },
  strong: { fontWeight: "700" },
  sections: { gap: spacing.xxl },
  section: { gap: spacing.sm },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
  barLabel: { width: 84 },
  barTrack: { flex: 1, height: 8, flexDirection: "row", borderRadius: radii.full, overflow: "hidden" },
  barCount: { width: 32, textAlign: "right" },
  tierRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  flex: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  gridCell: { width: "48%", borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
});
