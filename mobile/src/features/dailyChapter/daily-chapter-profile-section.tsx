import { useQuery } from "@tanstack/react-query";
import { ScrollView, View } from "react-native";
import { dailyChapterSummary, dailyThemeName } from "@scripta/shared";
import type { DailyChapterHistory } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { EmptyState, ErrorState, Skeleton, dynamicType, spacing, typography, useTheme } from "../../ui";
import { dailyChapterApi } from "./api";
import { DailyChapterCalendar } from "./daily-chapter-calendar";
import { DailyChapterPeriodSection } from "./daily-chapter-period-section";
import { DailyChapterPlayFooter } from "./daily-chapter-play-footer";
import { DailyChapterTiles } from "./daily-chapter-tiles";
import { useDailyHistory, useDeviceIdentity } from "./use-daily-history";
import { useDailyPeriod } from "./use-daily-period";
import { useLocale, useT } from "../../i18n";

function OwnDailyChapterBody({ history }: { history: DailyChapterHistory }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const period = useDailyPeriod(history);
  const summary = dailyChapterSummary(history, history.today.slice(0, 7));
  const { bestTheme } = summary;
  const bestAt = bestTheme ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.bestAt", { theme: dailyThemeName(bestTheme.themeId, locale), percent: bestTheme.percent })}</Text> : undefined;
  return <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>
      {history.results.length ? <DailyChapterTiles summary={summary} /> : null}
      <DailyChapterPeriodSection history={history} period={period} afterCalendar={bestAt} />
    </ScrollView>
    <DailyChapterPlayFooter history={history} />
  </View>;
}

function OwnDailyChapterSection() {
  const t = useT();
  const identity = useDeviceIdentity();
  const history = useDailyHistory();
  if (identity.isError || history.isLoadingError) return <ScrollView contentContainerStyle={{ padding: spacing.lg }}><ErrorState body={t("quizzes.loadChaptersFailed")} actionLabel={t("shell.retry")} onAction={() => { void identity.refetch(); void history.refetch(); }} /></ScrollView>;
  if (!history.data) return <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}><Skeleton height={72} /><Skeleton height={120} /><Skeleton height={200} /></ScrollView>;
  return <OwnDailyChapterBody history={history.data} />;
}

export function DailyChapterProfileSection({ userId, own }: { userId: string; own: boolean }) {
  return own ? <OwnDailyChapterSection /> : <PlayerDailyChapterSection userId={userId} />;
}

function PlayerDailyChapterSection({ userId }: { userId: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const query = useQuery({ queryKey: ["daily-chapter", "player", userId], queryFn: () => dailyChapterApi.player(userId) });
  let body;
  if (query.isError) body = <ErrorState body={t("quizzes.profileLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void query.refetch()} />;
  else if (!query.data) body = <View style={{ gap: spacing.md }}><Skeleton height={72} /><Skeleton height={200} /></View>;
  else if (!query.data.summary) body = <EmptyState title={t("quizzes.noDailyPublicTitle")} body={t("quizzes.noDailyPublicBody")} />;
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
