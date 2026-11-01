import { View } from "react-native";
import type { DailyChapterPlayerSummary } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { decimalText } from "@scripta/shared/i18n";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useLocale, useT } from "../../i18n";

export function DailyChapterTiles({ summary }: { summary: Pick<DailyChapterPlayerSummary, "streak" | "average" | "perfect"> }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const tile = (value: string, label: string) => <View style={{ flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface }}>
    <Text {...dynamicType} style={[typography.heading, { alignSelf: "stretch", textAlign: "center", color: colors.text, fontWeight: "700" }]}>{value}</Text>
    <Text {...dynamicType} style={[typography.caption, { alignSelf: "stretch", textAlign: "center", color: colors.textDim }]}>{label}</Text>
  </View>;
  return <View style={{ flexDirection: "row", gap: spacing.sm }}>{tile(String(summary.streak), t("quizzes.statStreak", { count: summary.streak }))}{tile(decimalText(summary.average, locale), t("quizzes.statAverage"))}{tile(String(summary.perfect), t("quizzes.statPerfect", { count: summary.perfect }))}</View>;
}
