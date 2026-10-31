import { View } from "react-native";
import type { DailyChapterPlayerSummary } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";

export function DailyChapterTiles({ summary }: { summary: Pick<DailyChapterPlayerSummary, "streak" | "average" | "perfect"> }) {
  const { colors } = useTheme();
  const tile = (value: string, label: string) => <View style={{ flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface }}>
    <Text {...dynamicType} style={[typography.heading, { alignSelf: "stretch", textAlign: "center", color: colors.text, fontWeight: "700" }]}>{value}</Text>
    <Text {...dynamicType} style={[typography.caption, { alignSelf: "stretch", textAlign: "center", color: colors.textDim }]}>{label}</Text>
  </View>;
  return <View style={{ flexDirection: "row", gap: spacing.sm }}>{tile(String(summary.streak), "day streak")}{tile(String(summary.average), "avg / 5")}{tile(String(summary.perfect), "perfect")}</View>;
}
