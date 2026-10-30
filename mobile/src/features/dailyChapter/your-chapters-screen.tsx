import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { DAILY_CHAPTER_THEMES, dailyChapterMonthShare, dailyChapterSummary, dailyChapterThemeRates, recapMonthName } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, EmptyState, ErrorState, Icon, IconButton, Screen, Skeleton, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { DailyChapterCalendar } from "./daily-chapter-calendar";
import { DailyChapterPoster } from "./daily-chapter-poster";
import { DailyChapterSquares } from "./daily-chapter-squares";
import { useDailyHistory, useDeviceIdentity } from "./use-daily-history";

function shiftMonth(month: string, by: number) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

export function YourChaptersScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const identity = useDeviceIdentity();
  const history = useDailyHistory();
  const current = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(current);
  const data = history.data;
  const [sharing, setSharing] = useState(false);
  const link = useQuery({ queryKey: ["public-url", "/daily"], queryFn: () => publicContentUrl("/daily"), enabled: sharing });
  const open = (editionId: string) => router.push(`/daily-chapters/${editionId}` as never);
  const retry = () => { void identity.refetch(); void history.refetch(); };
  let body;
  if (identity.isError || history.isError) body = <ErrorState body="Couldn't load your chapters." actionLabel="Retry" onAction={retry} />;
  else if (!data) body = <View style={{ gap: spacing.md }}><Skeleton height={72} /><Skeleton height={120} /><Skeleton height={200} /></View>;
  else if (!data.results.length) body = <EmptyState title="No chapters yet" body="Finish today's chapter and it will show up here." />;
  else {
    const first = data.results[data.results.length - 1]!.date.slice(0, 7);
    const summary = dailyChapterSummary(data, month);
    const rates = dailyChapterThemeRates(data.themes);
    const themeName = (id: string) => DAILY_CHAPTER_THEMES.find((theme) => theme.id === id)?.name ?? id;
    const byDate = new Map(data.results.map((result) => [result.date, result.editionId]));
    const arrow = (label: string, glyph: string, target: string, enabled: boolean) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={() => setMonth(target)} style={{ minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", opacity: enabled ? 1 : 0.3 }}><Text {...dynamicType} style={[typography.heading, { color: colors.text }]}>{glyph}</Text></Pressable>;
    const tile = (value: string, label: string) => <View style={{ flex: 1, alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface }}><Text {...dynamicType} style={[typography.heading, { color: colors.text, fontWeight: "700" }]}>{value}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{label}</Text></View>;
    const best = (label: string, value: string) => <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{label}</Text><Text {...dynamicType} style={[typography.body, { color: colors.text, fontWeight: "700" }]}>{value}</Text></View>;
    body = <>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>{tile(String(summary.streak), "day streak")}{tile(String(summary.average), "avg / 5")}{tile(String(summary.perfect), "perfect")}</View>
      <View style={{ gap: spacing.sm }}>{best("Longest streak", `${data.longestStreak} ${data.longestStreak === 1 ? "day" : "days"}`)}{best("Most perfects in a row", String(data.longestPerfectRun))}{best("Questions right", `${data.correct} of ${data.answered}`)}</View>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>{arrow("Previous month", "‹", shiftMonth(month, -1), month > first)}<Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{recapMonthName(month)} {month.slice(0, 4)}</Text>{arrow("Next month", "›", shiftMonth(month, 1), month < current)}</View>
        <DailyChapterCalendar days={summary.days} onDayPress={(date) => { const id = byDate.get(date); if (id) open(id); }} />
      </View>
      {rates.length ? <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>By theme</Text>
        {rates.map((rate, index) => <View key={rate.themeId} style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{themeName(rate.themeId)}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{rate.percent}%{rates.length >= 2 && index === 0 ? " · strongest" : rates.length >= 2 && index === rates.length - 1 ? " · trips you up" : ""}</Text></View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}><View style={{ height: 6, borderRadius: 3, width: `${rate.percent}%`, backgroundColor: colors.accent }} /></View>
        </View>)}
      </View> : null}
      <View>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text, marginBottom: spacing.sm }]}>Past chapters</Text>
        {data.results.map((result) => <Pressable key={result.editionId} accessibilityRole="button" accessibilityLabel={`${result.date}, ${result.title}, ${result.score} out of 5`} onPress={() => open(result.editionId)} style={{ minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, { flex: 1, minWidth: 0, color: colors.text }]}>{result.date} · {result.title}</Text>
          <DailyChapterSquares marks={result.answers.map((answer) => answer.choiceIndex === answer.answerIndex)} />
          <Icon name="chevronRight" size={16} color={colors.textDim} />
        </Pressable>)}
      </View>
      <Button label="Share my chapters" onPress={() => setSharing(true)} />
      <ContentShareSheet visible={sharing} onClose={() => setSharing(false)} title="My Daily Chapter" url={link.data ?? null} linkError={link.error ? link.error.message : null} onRetryLink={() => void link.refetch()} textMessage={link.data ? dailyChapterMonthShare(summary, link.data) : undefined}>
        <DailyChapterPoster summary={summary} />
      </ContentShareSheet>
    </>;
  }
  return <Screen top={false} bottom><Stack.Screen options={{ title: "Your chapters", headerShown: true, headerRight: data?.results.length ? () => <IconButton name="share" accessibilityLabel="Share my chapters" onPress={() => setSharing(true)} /> : undefined }} /><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>{body}</ScrollView></Screen>;
}
