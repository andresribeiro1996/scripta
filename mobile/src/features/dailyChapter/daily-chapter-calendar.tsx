import { Pressable, View } from "react-native";
import type { DailyChapterDay } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export const POSTER_COLORS = { top: "#3b2414", bottom: "#7a3f0c", text: "#fbefe0", outline: "rgba(251,239,224,0.3)", scores: ["rgba(255,255,255,0.12)", "#f0c99e", "#f0c99e", "#e7a868", "#d98535", "#fff3e2"] } as const;

export function DailyChapterCalendar({ days, onDayPress, tone = "screen", numbers = true }: { days: DailyChapterDay[]; onDayPress?: (date: string) => void; tone?: "screen" | "poster"; numbers?: boolean }) {
  const { colors } = useTheme();
  const poster = tone === "poster";
  const first = days[0];
  const blanks = first ? (new Date(first.date + "T00:00:00Z").getUTCDay() + 6) % 7 : 0;
  return <View accessibilityRole="grid">
    <View style={{ flexDirection: "row" }}>{WEEKDAYS.map((weekday, index) => <View key={index} style={{ width: `${100 / 7}%`, alignItems: "center" }}><Text {...dynamicType} style={[typography.caption, { alignSelf: "stretch", textAlign: "center", color: poster ? POSTER_COLORS.text : colors.textDim, opacity: poster ? 0.7 : 1 }]}>{weekday}</Text></View>)}</View>
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {Array.from({ length: blanks }, (_, index) => <View key={"blank" + index} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />)}
      {days.map((day) => {
        const played = day.score !== null;
        const label = numbers ? String(Number(day.date.slice(8))) : "";
        const cell = <View style={{ flex: 1, margin: spacing.xs / 2, borderRadius: radii.sm, borderWidth: day.published && !played ? 1 : 0, borderColor: poster ? POSTER_COLORS.outline : colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {played ? <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: poster ? POSTER_COLORS.scores[day.score!] : colors.accent, opacity: poster ? 1 : 0.25 + 0.15 * day.score! }} /> : null}
          <Text {...dynamicType} style={[typography.caption, { color: poster ? POSTER_COLORS.top : played && day.score! >= 3 ? colors.onAccent : day.published ? colors.text : colors.textDim }]}>{label}</Text>
        </View>;
        return played && onDayPress
          ? <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`${day.date}, ${day.score} out of 5`} onPress={() => onDayPress(day.date)} style={{ width: `${100 / 7}%`, aspectRatio: 1 }}>{cell}</Pressable>
          : <View key={day.date} accessibilityLabel={played ? `${day.date}, ${day.score} out of 5` : undefined} style={{ width: `${100 / 7}%`, aspectRatio: 1 }}>{cell}</View>;
      })}
    </View>
  </View>;
}
