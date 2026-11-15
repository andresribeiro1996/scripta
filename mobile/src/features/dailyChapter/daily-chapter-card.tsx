import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { dailyChapterApi } from "./api";
import { DailyChapterArt } from "./daily-chapter-art";
import { dailyCardAction } from "./dailyCardModel";
import { useChapterHistory } from "./use-daily-history";
import { useT } from "../../i18n";

export function DailyChapterCard() {
  const t = useT();
  const { colors } = useTheme();
  const daily = useQuery({ queryKey: ["daily-chapter", "today"], queryFn: dailyChapterApi.today, refetchInterval: 60_000 });
  const history = useChapterHistory(daily.data?.date);
  const { fontScale } = useWindowDimensions();
  const board = daily.data?.board;
  if (!board) return null;
  const action = dailyCardAction(board.id, history.data);
  const stacked = fontScale > 1.3;
  const label = action.kind === "play" ? t("quizzes.dailyCardPlay") : t("quizzes.dailyCardResults", { score: action.score });
  const accessibilityLabel = action.kind === "play" ? t("quizzes.dailyCardLabel", { title: board.title }) : t("quizzes.dailyCardResultsLabel", { score: action.score, title: board.title });
  return <View style={{ backgroundColor: colors.accentSoft, borderRadius: radii.xl, padding: spacing.lg, marginHorizontal: spacing.md, marginTop: spacing.lg, gap: spacing.sm }}>
    <View style={{ flexDirection: stacked ? "column-reverse" : "row", alignItems: "flex-start", gap: spacing.sm }}>
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: spacing.sm }}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.theDailyChapter")}</Text>
        <Text display {...dynamicType} style={[typography.heading, { color: colors.text }]}>{board.title}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.dailyCardMeta")}</Text>
      </View>
      <DailyChapterArt motif={board.theme.motif} />
    </View>
    <Button label={label} accessibilityLabel={accessibilityLabel} variant="primary" onPress={() => router.push("/daily")} />
  </View>;
}
