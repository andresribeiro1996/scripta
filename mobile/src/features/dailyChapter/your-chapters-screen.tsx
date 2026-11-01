import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { dailyChapterMonthShare, dailyChapterMonthStats, dailyChapterSummary, dailyChapterThemeRates, dailyThemeName, recapMonthName } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, EmptyState, ErrorState, Icon, IconButton, Screen, Skeleton, dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { stackPrefix } from "../works/workPath";
import { DailyChapterCalendar } from "./daily-chapter-calendar";
import { DailyChapterPoster } from "./daily-chapter-poster";
import { DailyChapterSquares } from "./daily-chapter-squares";
import { DailyChapterTiles } from "./daily-chapter-tiles";
import { useDailyHistory, useDeviceIdentity } from "./use-daily-history";
import { useLocale, useT } from "../../i18n";

function shiftMonth(month: string, by: number) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

export function YourChaptersScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const identity = useDeviceIdentity();
  const history = useDailyHistory();
  const current = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(current);
  const data = history.data;
  const [sharing, setSharing] = useState(false);
  const link = useQuery({ queryKey: ["public-url", "/daily"], queryFn: () => publicContentUrl("/daily"), enabled: sharing });
  const open = (editionId: string) => router.push(`${stackPrefix(segments)}/daily-chapters/${editionId}` as never);
  const retry = () => { void identity.refetch(); void history.refetch(); };
  let body;
  if (identity.isError || history.isError) body = <ErrorState body={t("quizzes.loadChaptersFailed")} actionLabel={t("shell.retry")} onAction={retry} />;
  else if (!data) body = <View style={{ gap: spacing.md }}><Skeleton height={72} /><Skeleton height={120} /><Skeleton height={200} /></View>;
  else if (!data.results.length) body = <EmptyState title={t("quizzes.noChapters")} body={t("quizzes.noChaptersBody")} />;
  else {
    const first = data.results[data.results.length - 1]!.date.slice(0, 7);
    const summary = dailyChapterSummary(data, month);
    const monthSummary = { ...summary, ...dailyChapterMonthStats(data.results, month) };
    const rates = dailyChapterThemeRates(data.themes);
    const themeName = (id: string) => dailyThemeName(id, locale);
    const byDate = new Map(data.results.map((result) => [result.date, result.editionId]));
    const arrow = (label: string, glyph: string, target: string, enabled: boolean) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={() => setMonth(target)} style={{ minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", opacity: enabled ? 1 : 0.3 }}><Text {...dynamicType} style={[typography.heading, { color: colors.text }]}>{glyph}</Text></Pressable>;
    const best = (label: string, value: string) => <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{label}</Text><Text {...dynamicType} style={[typography.body, { color: colors.text, fontWeight: "700" }]}>{value}</Text></View>;
    body = <>
      <DailyChapterTiles summary={summary} />
      <View style={{ gap: spacing.sm }}>{best(t("quizzes.longestStreak"), t("quizzes.days", { count: data.longestStreak }))}{best(t("quizzes.mostPerfects"), String(data.longestPerfectRun))}{best(t("quizzes.questionsRight"), t("quizzes.correctOfAnswered", { correct: data.correct, answered: data.answered }))}</View>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>{arrow(t("quizzes.previousMonth"), "‹", shiftMonth(month, -1), month > first)}<Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.monthYear", { month: recapMonthName(month, locale), year: month.slice(0, 4) })}</Text>{arrow(t("quizzes.nextMonth"), "›", shiftMonth(month, 1), month < current)}</View>
        <DailyChapterCalendar days={summary.days} onDayPress={(date) => { const id = byDate.get(date); if (id) open(id); }} />
      </View>
      {rates.length ? <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.byTheme")}</Text>
        {rates.map((rate, index) => <View key={rate.themeId} style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{themeName(rate.themeId)}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{rates.length >= 2 && index === 0 ? t("quizzes.rateStrongest", { percent: rate.percent }) : rates.length >= 2 && index === rates.length - 1 ? t("quizzes.rateTripsUp", { percent: rate.percent }) : `${rate.percent}%`}</Text></View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}><View style={{ height: 6, borderRadius: 3, width: `${rate.percent}%`, backgroundColor: colors.accent }} /></View>
        </View>)}
      </View> : null}
      <View>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text, marginBottom: spacing.sm }]}>{t("quizzes.pastChapters")}</Text>
        {data.results.map((result) => <Pressable key={result.editionId} accessibilityRole="button" accessibilityLabel={t("quizzes.pastChapterLabel", { date: result.date, title: result.title, score: result.score })} onPress={() => open(result.editionId)} style={{ minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, { flex: 1, minWidth: 0, color: colors.text }]}>{result.date} · {result.title}</Text>
          <DailyChapterSquares marks={result.answers.map((answer) => answer.choiceIndex === answer.answerIndex)} />
          <Icon name="chevronRight" size={16} color={colors.textDim} />
        </Pressable>)}
      </View>
      <Button label={t("quizzes.shareMyChapters")} onPress={() => setSharing(true)} />
      <ContentShareSheet visible={sharing} onClose={() => setSharing(false)} title={t("quizzes.myDailyChapter")} url={link.data ?? null} linkError={link.error ? link.error.message : null} onRetryLink={() => void link.refetch()} textMessage={link.data ? dailyChapterMonthShare(monthSummary, link.data, locale) : undefined}>
        <DailyChapterPoster summary={monthSummary} />
      </ContentShareSheet>
    </>;
  }
  return <Screen top={false} bottom><Stack.Screen options={{ title: t("quizzes.yourChapters"), headerShown: true, headerRight: data?.results.length ? () => <IconButton name="share" accessibilityLabel={t("quizzes.shareMyChapters")} onPress={() => setSharing(true)} /> : undefined }} /><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>{body}</ScrollView></Screen>;
}
