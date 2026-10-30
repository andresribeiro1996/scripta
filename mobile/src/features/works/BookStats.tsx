import { Pressable, StyleSheet, View } from "react-native";
import type { BookStatsModel } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Icon, dynamicType, radii, spacing, typography, useTheme } from "../../ui";

export function StatsTiles({ tiles, onPress }: { tiles: BookStatsModel["tiles"]; onPress: () => void }) {
  const { colors } = useTheme();
  if (tiles.length === 0) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Book stats: ${tiles.map((tile) => `${tile.value} ${tile.caption}`).join("; ")}`} hitSlop={{ top: 14, bottom: 14 }} onPress={onPress} style={styles.tiles}>
      {tiles.map((tile, index) => (
        <View key={tile.key} style={styles.tile}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{`${tile.value} ${tile.caption}${index < tiles.length - 1 ? " ·" : ""}`}</Text>
          {index === tiles.length - 1 ? <Icon name="chevronRight" size={12} color={colors.textDim} /> : null}
        </View>
      ))}
    </Pressable>
  );
}

export function StatsSections({ model }: { model: BookStatsModel }) {
  const { colors } = useTheme();
  const { ratings, tierBar, tiersEmpty, tournamentRun, tournamentsEmpty } = model;
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
            <View accessible accessibilityRole="image" accessibilityLabel={`Ratings by feeling: ${ratings.community.columns.map((column) => `${column.label} ${column.count}`).join(", ")}`} style={styles.columns}>
              {ratings.community.columns.map((column) => (
                <View key={column.label} style={[styles.column, { height: `${Math.round(column.fraction * 100)}%`, backgroundColor: column.top ? colors.accent : colors.textDim, opacity: column.top ? 1 : 0.75 }]} />
              ))}
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.columnLabels}>
              {ratings.community.columns.map((column) => (
                <Text key={column.label} numberOfLines={2} {...dynamicType} style={[typography.caption, styles.columnLabel, { color: colors.textDim }]}>{column.label}</Text>
              ))}
            </View>
          </>
        ) : null}
        {ratings.empty ? dim(ratings.empty) : null}
      </View>
      <View style={styles.section}>
        {heading("Tier lists")}
        {tierBar ? (
          <>
            <Text {...dynamicType} style={[typography.heading, { color: colors.text }]}>{tierBar.band}</Text>
            <View style={[styles.track, { backgroundColor: colors.border }]}>
              <View style={[styles.dot, { left: `${Math.round(tierBar.marker * 100)}%`, backgroundColor: colors.accent }]} />
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.trackLabels}>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Top</Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Bottom</Text>
            </View>
            {dim(tierBar.summary)}
          </>
        ) : dim(tiersEmpty ?? "")}
      </View>
      <View style={styles.section}>
        {heading("Tournaments")}
        {tournamentRun ? (
          <>
            {tournamentRun.path.length > 0 ? (
              <View style={styles.path}>
                {tournamentRun.path.map((step) => (
                  <View key={step.label} style={styles.step}>
                    <View accessible accessibilityLabel={`${step.label}, ${step.reached ? "reached" : "not reached"}`} style={[styles.pill, { borderColor: step.reached ? colors.accent : colors.border }]}>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, step.reached ? styles.strong : null, { color: step.reached ? colors.accent : colors.textDim }]}>{step.label}</Text>
                    </View>
                    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name="chevronRight" size={12} color={colors.textDim} /></View>
                  </View>
                ))}
                <View accessible accessibilityLabel={tournamentRun.champion ? "Won a title" : "No title"} style={[styles.pill, { borderColor: tournamentRun.champion ? colors.accent : colors.border, opacity: tournamentRun.champion ? 1 : 0.5 }]}>
                  <Text numberOfLines={1} {...dynamicType} style={typography.caption}>🏆</Text>
                </View>
              </View>
            ) : null}
            {dim(tournamentRun.summary)}
          </>
        ) : dim(tournamentsEmpty ?? "")}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: spacing.xs },
  tile: { flexShrink: 1, flexDirection: "row", alignItems: "center" },
  strong: { fontWeight: "700" },
  sections: { gap: spacing.xxl },
  section: { gap: spacing.sm },
  columns: { flexDirection: "row", alignItems: "flex-end", height: 96, gap: spacing.sm },
  column: { flex: 1, minHeight: 2, borderTopLeftRadius: radii.sm, borderTopRightRadius: radii.sm },
  columnLabels: { flexDirection: "row", gap: spacing.sm },
  columnLabel: { flex: 1, textAlign: "center" },
  track: { height: 8, borderRadius: radii.full, marginTop: spacing.sm },
  dot: { position: "absolute", top: -4, width: 16, height: 16, borderRadius: 8, marginLeft: -8 },
  trackLabels: { flexDirection: "row", justifyContent: "space-between" },
  path: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pill: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
});
