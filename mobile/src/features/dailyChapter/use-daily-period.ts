import { useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyChapterDays, dailyChapterHasEarlierMonth, dailyChapterHasEarlierWeek, dailyChapterHasLaterMonth, dailyChapterMonthDates, dailyChapterPosterMonth, dailyChapterRangeLabel, dailyChapterRows, dailyChapterShiftMonth, dailyChapterWeekDates, recapMonthName } from "@scripta/shared";
import type { DailyChapterHistory } from "@scripta/shared";
import { useLocale, useT } from "../../i18n";

export type DailyChapterView = "week" | "month";

const VIEW_KEY = "daily-chapter:view";
const VIEW_QUERY = ["daily-chapter", "view"] as const;

export function useDailyPeriod(history: DailyChapterHistory) {
  const t = useT();
  const locale = useLocale();
  const client = useQueryClient();
  const stored = useQuery({ queryKey: VIEW_QUERY, queryFn: () => AsyncStorage.getItem(VIEW_KEY), staleTime: Infinity });
  const [weeksBack, setWeeksBack] = useState(0);
  const [month, setMonth] = useState(history.today.slice(0, 7));
  const view: DailyChapterView = stored.data === "month" ? "month" : "week";
  const setView = (next: DailyChapterView) => {
    client.setQueryData(VIEW_QUERY, next);
    AsyncStorage.setItem(VIEW_KEY, next).catch((err: unknown) => { console.warn("Couldn't save the calendar view on this device.", err); });
  };
  const dates = view === "week" ? dailyChapterWeekDates(history.today, weeksBack) : dailyChapterMonthDates(month);
  const days = dailyChapterDays(history, dates);
  return {
    view,
    setView,
    dates,
    days,
    rows: dailyChapterRows(history, days),
    title: view === "week" ? dailyChapterRangeLabel(dates[0]!, dates[6]!, locale) : t("quizzes.monthYear", { month: recapMonthName(month, locale), year: month.slice(0, 4) }),
    hasEarlier: view === "week" ? dailyChapterHasEarlierWeek(history, weeksBack) : dailyChapterHasEarlierMonth(history, month),
    hasLater: view === "week" ? weeksBack > 0 : dailyChapterHasLaterMonth(history, month),
    earlier: () => (view === "week" ? setWeeksBack(weeksBack + 1) : setMonth(dailyChapterShiftMonth(month, -1))),
    later: () => (view === "week" ? setWeeksBack(weeksBack - 1) : setMonth(dailyChapterShiftMonth(month, 1))),
    posterMonth: view === "month" ? month : dailyChapterPosterMonth(history.today, weeksBack),
  };
}
