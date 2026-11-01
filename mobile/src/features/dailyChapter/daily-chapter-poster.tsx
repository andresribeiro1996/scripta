import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { dailyThemeName, recapMonthName, type DailyChapterPlayerSummary } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { cardFontFamily, radii, spacing, typography } from "../../ui";
import { DailyChapterCalendar, POSTER_COLORS } from "./daily-chapter-calendar";
import { decimalText } from "@scripta/shared/i18n";
import { useLocale, useT } from "../../i18n";

const SERIF = cardFontFamily("serif");

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}>
    <Text style={[styles.value, { fontFamily: SERIF }]}>{value}</Text>
    <Text style={styles.label}>{label}</Text>
  </View>;
}

export function DailyChapterPoster({ summary }: { summary: DailyChapterPlayerSummary }) {
  const t = useT();
  const locale = useLocale();
  const gradientId = useId();
  const best = summary.bestTheme;
  const themeName = best ? dailyThemeName(best.themeId, locale) : "";
  return <View style={styles.poster}>
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs><LinearGradient id={gradientId} x1="0.3" y1="0" x2="0.7" y2="1">
        <Stop offset="0" stopColor={POSTER_COLORS.top} />
        <Stop offset="1" stopColor={POSTER_COLORS.bottom} />
      </LinearGradient></Defs>
      <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
    <Text style={styles.eyebrow}>{t("quizzes.theDailyChapter")}</Text>
    <Text style={[styles.month, { fontFamily: SERIF }]}>{t("quizzes.posterMonth", { month: recapMonthName(summary.month, locale) })}</Text>
    <DailyChapterCalendar days={summary.days} tone="poster" numbers={false} />
    <View style={styles.stats}>
      <Stat value={String(summary.streak)} label={t("quizzes.posterStreak")} />
      <Stat value={decimalText(summary.average, locale)} label={t("quizzes.statAverage")} />
      {best ? <Stat value={`${best.percent}%`} label={t("quizzes.posterBestAt", { theme: themeName })} /> : null}
    </View>
    <Text style={styles.footer}>{t("quizzes.posterFooter")}</Text>
  </View>;
}

const styles = StyleSheet.create({
  poster: { overflow: "hidden", borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md, backgroundColor: POSTER_COLORS.top },
  eyebrow: { ...typography.caption, color: POSTER_COLORS.text, opacity: 0.75, letterSpacing: 1.5, textTransform: "uppercase", alignSelf: "stretch" },
  month: { ...typography.heading, color: POSTER_COLORS.text, alignSelf: "stretch" },
  stats: { flexDirection: "row", gap: spacing.md, paddingTop: spacing.sm },
  stat: { flex: 1 },
  value: { ...typography.heading, color: POSTER_COLORS.text, fontWeight: "700", alignSelf: "stretch" },
  label: { ...typography.caption, color: POSTER_COLORS.text, opacity: 0.8, alignSelf: "stretch" },
  footer: { ...typography.caption, color: POSTER_COLORS.text, opacity: 0.7, alignSelf: "stretch" },
});
