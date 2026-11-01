import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { Text } from "../../ui/Text";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { dailyChapterApi } from "./api";
import { DailyChapterArt } from "./daily-chapter-art";
import { useT } from "../../i18n";

export function DailyChapterCard() {
  const t = useT();
  const { colors } = useTheme();
  const daily = useQuery({ queryKey: ["daily-chapter", "today"], queryFn: dailyChapterApi.today, refetchInterval: 60_000 });
  const board = daily.data?.board;
  if (!board) return null;
  return <Pressable accessibilityRole="link" accessibilityLabel={t("quizzes.dailyCardLabel", { title: board.title })} onPress={() => router.push("/daily")} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}><DailyChapterArt motif={board.theme.motif} /><View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.theDailyChapter")}</Text><Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{board.title}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.dailyCardMeta")}</Text><Text {...dynamicType} style={[typography.body, { color: colors.accent, fontWeight: "700" }]}>{t("quizzes.dailyCardOpen")}</Text></View></Pressable>;
}
