import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { dailyChapterMonthShare, dailyChapterMonthStats, dailyChapterSummary, dailyChapterThemeRates, dailyThemeName } from "@scripta/shared";
import type { DailyChapterHistory } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, ErrorState, IconButton, Screen, Skeleton, dynamicType, spacing, typography, useTheme } from "../../ui";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { DailyChapterPeriodSection } from "./daily-chapter-period-section";
import { DailyChapterPlayFooter } from "./daily-chapter-play-footer";
import { DailyChapterPoster } from "./daily-chapter-poster";
import { DailyChapterTiles } from "./daily-chapter-tiles";
import { useDailyHistory, useDeviceIdentity } from "./use-daily-history";
import { useDailyPeriod } from "./use-daily-period";
import { useLocale, useT } from "../../i18n";

function YourChaptersBody({ data }: { data: DailyChapterHistory }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const period = useDailyPeriod(data);
  const [sharing, setSharing] = useState(false);
  const link = useQuery({ queryKey: ["public-url", "/daily"], queryFn: () => publicContentUrl("/daily"), enabled: sharing });
  const hasResults = data.results.length > 0;
  const summary = dailyChapterSummary(data, period.posterMonth);
  const monthSummary = { ...summary, ...dailyChapterMonthStats(data.results, period.posterMonth) };
  const rates = dailyChapterThemeRates(data.themes);
  const themeName = (id: string) => dailyThemeName(id, locale);
  const best = (label: string, value: string) => <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{label}</Text><Text {...dynamicType} style={[typography.body, { color: colors.text, fontWeight: "700" }]}>{value}</Text></View>;
  const themeBars = rates.length ? <View style={{ gap: spacing.sm }}>
    <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.byTheme")}</Text>
    {rates.map((rate, index) => <View key={rate.themeId} style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{themeName(rate.themeId)}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{rates.length >= 2 && index === 0 ? t("quizzes.rateStrongest", { percent: rate.percent }) : rates.length >= 2 && index === rates.length - 1 ? t("quizzes.rateTripsUp", { percent: rate.percent }) : `${rate.percent}%`}</Text></View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}><View style={{ height: 6, borderRadius: 3, width: `${rate.percent}%`, backgroundColor: colors.accent }} /></View>
    </View>)}
  </View> : null;
  return <View style={{ flex: 1 }}>
    <Stack.Screen options={{ headerRight: hasResults ? () => <IconButton name="share" accessibilityLabel={t("quizzes.shareMyChapters")} onPress={() => setSharing(true)} /> : undefined }} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>
      {hasResults ? <>
        <DailyChapterTiles summary={summary} />
        <View style={{ gap: spacing.sm }}>{best(t("quizzes.longestStreak"), t("quizzes.days", { count: data.longestStreak }))}{best(t("quizzes.mostPerfects"), String(data.longestPerfectRun))}{best(t("quizzes.questionsRight"), t("quizzes.correctOfAnswered", { correct: data.correct, answered: data.answered }))}</View>
      </> : null}
      <DailyChapterPeriodSection history={data} period={period} afterCalendar={themeBars} />
      {hasResults ? <>
        <Button label={t("quizzes.shareMyChapters")} onPress={() => setSharing(true)} />
        <ContentShareSheet visible={sharing} onClose={() => setSharing(false)} title={t("quizzes.myDailyChapter")} url={link.data ?? null} linkError={link.error ? link.error.message : null} onRetryLink={() => void link.refetch()} textMessage={link.data ? dailyChapterMonthShare(monthSummary, link.data, locale) : undefined}>
          <DailyChapterPoster summary={monthSummary} />
        </ContentShareSheet>
      </> : null}
    </ScrollView>
    <DailyChapterPlayFooter history={data} />
  </View>;
}

export function YourChaptersScreen() {
  const t = useT();
  const identity = useDeviceIdentity();
  const history = useDailyHistory();
  const data = history.data;
  const retry = () => { void identity.refetch(); void history.refetch(); };
  let body;
  if (identity.isError || history.isLoadingError) body = <ScrollView contentContainerStyle={{ padding: spacing.lg }}><ErrorState body={t("quizzes.loadChaptersFailed")} actionLabel={t("shell.retry")} onAction={retry} /></ScrollView>;
  else if (!data) body = <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}><Skeleton height={72} /><Skeleton height={120} /><Skeleton height={200} /></ScrollView>;
  else body = <YourChaptersBody data={data} />;
  return <Screen top={false} bottom><Stack.Screen options={{ title: t("quizzes.yourChapters"), headerShown: true }} />{body}</Screen>;
}
