import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { Button, Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { dailyChapterApi } from "./api";
import { DailyChapterArt } from "./daily-chapter-art";
import { dailyCardAction, dailyPlayVariant } from "./dailyCardModel";
import { useChapterHistory } from "./use-daily-history";
import { useT } from "../../i18n";

export function DailyChapterCard({ emptyLibrary = false }: { emptyLibrary?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const daily = useQuery({ queryKey: ["daily-chapter", "today"], queryFn: dailyChapterApi.today, refetchInterval: 60_000 });
  const history = useChapterHistory(daily.data?.date);
  const { fontScale } = useWindowDimensions();
  const board = daily.data?.board;
  if (!board) return null;
  const action = dailyCardAction(board.id, history.data);
  if (action.kind === "results") {
    return <Pressable accessibilityRole="link" accessibilityLabel={t("quizzes.dailyCardResultsLabel", { score: action.score, title: board.title })} onPress={() => router.push("/daily")} style={[styles.row, { backgroundColor: colors.surface }]}>
      <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><View style={styles.tileArt}><DailyChapterArt motif={board.theme.motif} /></View></View>
      <View style={styles.text}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.caption, { color: colors.accent }]}>{t("quizzes.dailyCardResults", { score: action.score })}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{board.title}</Text>
      </View>
      <Icon name="chevronRight" size={16} color={colors.textDim} />
    </Pressable>;
  }
  const stacked = fontScale > 1.3;
  return <View style={{ backgroundColor: colors.accentSoft, borderRadius: radii.xl, padding: spacing.lg, marginHorizontal: spacing.md, marginTop: spacing.lg, gap: spacing.sm }}>
    <View style={{ flexDirection: stacked ? "column-reverse" : "row", alignItems: "flex-start", gap: spacing.sm }}>
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: spacing.sm }}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.theDailyChapter")}</Text>
        <Text display {...dynamicType} style={[typography.heading, { color: colors.text }]}>{board.title}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.dailyCardMeta")}</Text>
      </View>
      <DailyChapterArt motif={board.theme.motif} />
    </View>
    <Button label={t("quizzes.dailyCardPlay")} accessibilityLabel={t("quizzes.dailyCardLabel", { title: board.title })} variant={dailyPlayVariant(emptyLibrary)} onPress={() => router.push("/daily")} />
  </View>;
}

const styles = StyleSheet.create({
  row: { minHeight: minimumTouchTarget, marginHorizontal: spacing.md, marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  tile: { width: 40, height: 48, borderRadius: radii.sm, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  tileArt: { transform: [{ scale: 0.36 }] },
  text: { flex: 1, minWidth: 0 },
  strong: { fontWeight: "700" }
});
