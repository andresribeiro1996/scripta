import { useQuery } from "@tanstack/react-query";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { dailyThemeName } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { EmptyState, ErrorState, Skeleton, dynamicType, spacing, typography, useTheme } from "../../ui";
import { dailyChapterApi } from "./api";
import { DailyChapterCalendar } from "./daily-chapter-calendar";
import { DailyChapterTiles } from "./daily-chapter-tiles";
import { useLocale, useT } from "../../i18n";

export function DailyChapterProfileSection({ userId, own }: { userId: string; own: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const query = useQuery({ queryKey: ["daily-chapter", "player", userId], queryFn: () => dailyChapterApi.player(userId) });
  let body;
  if (query.isError) body = <ErrorState body={t("quizzes.profileLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void query.refetch()} />;
  else if (!query.data) body = <View style={{ gap: spacing.md }}><Skeleton height={72} /><Skeleton height={200} /></View>;
  else if (!query.data.summary) body = own
    ? <EmptyState title={t("quizzes.noDailyTitle")} body={t("quizzes.noDailyOwnBody")} actionLabel={t("quizzes.playToday")} onAction={() => router.push("/daily" as never)} />
    : <EmptyState title={t("quizzes.noDailyPublicTitle")} body={t("quizzes.noDailyPublicBody")} />;
  else {
    const { summary } = query.data;
    const { bestTheme, days } = summary;
    const themeName = bestTheme ? dailyThemeName(bestTheme.themeId, locale) : "";
    body = <>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.theDailyChapter")}</Text>
      <DailyChapterTiles summary={summary} />
      <DailyChapterCalendar days={days} numbers={false} />
      {bestTheme ? <View><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.bestAt", { theme: themeName, percent: bestTheme.percent })}</Text></View> : null}
    </>;
  }
  return <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>{body}</ScrollView>;
}
