import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import { dailyChapterDayLabel, dailyThemeName } from "@scripta/shared";
import type { DailyChapterCalendarDay, DailyChapterHistory } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Icon, Segmented, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { useLocale, useT } from "../../i18n";
import { dailyDayPath } from "../works/workPath";
import { WEEKDAYS, scoreTint } from "./daily-chapter-calendar";
import { DailyChapterSquares } from "./daily-chapter-squares";
import type { useDailyPeriod } from "./use-daily-period";

const COLUMN = `${100 / 7}%` as const;

function weekdayKey(date: string) {
  return WEEKDAYS[(new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7]!;
}

export function DailyChapterPeriodSection({ history, period, afterCalendar }: { history: DailyChapterHistory; period: ReturnType<typeof useDailyPeriod>; afterCalendar?: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const week = period.view === "week";
  const open = (day: Pick<DailyChapterCalendarDay, "status" | "editionId">) => router.push((day.status === "today" ? "/daily" : dailyDayPath(day.editionId!, segments)) as never);
  const arrow = (label: string, glyph: string, enabled: boolean, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onPress} style={{ minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", opacity: enabled ? 1 : 0.3 }}><Text {...dynamicType} style={[typography.heading, { color: colors.text }]}>{glyph}</Text></Pressable>;

  const cell = (day: DailyChapterCalendarDay) => {
    const played = day.status === "played";
    const today = day.status === "today";
    const missed = day.status === "missed";
    const dayLabel = dailyChapterDayLabel(day.date, locale);
    const face = <View style={{ aspectRatio: 1, margin: spacing.xs / 2, borderRadius: radii.sm, borderWidth: today ? 2 : missed ? 1 : 0, borderColor: today ? colors.accent : colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {played ? <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.accent, opacity: scoreTint(day.score!) }} /> : null}
      <Text {...dynamicType} style={[typography.caption, { color: today ? colors.accent : played && day.score! >= 3 ? colors.onAccent : day.status === "none" ? colors.textDim : colors.text, fontWeight: today ? "700" : "400" }]}>{String(Number(day.date.slice(8)))}</Text>
    </View>;
    const caption = week ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { alignSelf: "stretch", textAlign: "center", color: colors.textDim }]}>{played ? `${day.score}/5` : missed ? t("quizzes.dayMissed") : today ? t("quizzes.dayPlay") : " "}</Text> : null;
    const heading = week ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { alignSelf: "stretch", textAlign: "center", color: colors.textDim }]}>{t(weekdayKey(day.date))}</Text> : null;
    const body = <>{heading}{face}{caption}</>;
    if (day.status === "none") return <View key={day.date} style={{ width: COLUMN }}>{body}</View>;
    const label = played ? t("quizzes.outOfFive", { label: dayLabel, score: day.score! }) : missed ? t("quizzes.dayMissedLabel", { date: dayLabel }) : t("quizzes.dayPlayLabel", { date: dayLabel });
    return <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={label} onPress={() => open(day)} style={{ width: COLUMN }}>{body}</Pressable>;
  };

  const blanks = week ? 0 : (new Date(period.dates[0]! + "T00:00:00Z").getUTCDay() + 6) % 7;

  return <View style={{ gap: spacing.xl }}>
    <View style={{ gap: spacing.sm }}>
      <Segmented accessibilityLabel={t("quizzes.calendarView")} options={[{ value: "week", label: t("quizzes.viewWeek") }, { value: "month", label: t("quizzes.viewMonth") }]} value={period.view} onChange={period.setView} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {arrow(t(week ? "quizzes.previousWeek" : "quizzes.previousMonth"), "‹", period.hasEarlier, period.earlier)}
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{period.title}</Text>
        {arrow(t(week ? "quizzes.nextWeek" : "quizzes.nextMonth"), "›", period.hasLater, period.later)}
      </View>
      <View accessibilityRole="grid">
        {week ? null : <View style={{ flexDirection: "row" }}>{WEEKDAYS.map((weekday) => <View key={weekday} style={{ width: COLUMN, alignItems: "center" }}><Text {...dynamicType} style={[typography.caption, { alignSelf: "stretch", textAlign: "center", color: colors.textDim }]}>{t(weekday)}</Text></View>)}</View>}
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {Array.from({ length: blanks }, (_, index) => <View key={"blank" + index} style={{ width: COLUMN, aspectRatio: 1 }} />)}
          {period.days.map(cell)}
        </View>
      </View>
    </View>
    {afterCalendar}
    <View>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text, marginBottom: spacing.sm }]}>{t("quizzes.pastChapters")}</Text>
      {period.rows.length ? period.rows.map((row) => {
        const date = dailyChapterDayLabel(row.date, locale);
        return <Pressable key={row.editionId} accessibilityRole="button" accessibilityLabel={row.score === null ? t("quizzes.pastChapterMissedLabel", { date, title: row.title }) : t("quizzes.pastChapterLabel", { date, title: row.title, score: row.score })} onPress={() => open({ status: row.score === null ? "missed" : "played", editionId: row.editionId })} style={{ minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{row.title}</Text>
            <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{date} · {dailyThemeName(row.themeId, locale)}</Text>
          </View>
          {row.marks ? <><DailyChapterSquares marks={row.marks} /><Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text, fontWeight: "700" }]}>{row.score}/5</Text></> : <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.dayMissed")}</Text>}
          <Icon name="chevronRight" size={16} color={colors.textDim} />
        </Pressable>;
      }) : <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.noChaptersInPeriod")}</Text>}
    </View>
  </View>;
}
