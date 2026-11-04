import { View } from "react-native";
import { useRouter } from "expo-router";
import { dailyChapterCanPlayToday } from "@scripta/shared";
import type { DailyChapterHistory } from "@scripta/shared";
import { Button, spacing, useTheme } from "../../ui";
import { useT } from "../../i18n";

export function DailyChapterPlayFooter({ history }: { history: DailyChapterHistory }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  if (!dailyChapterCanPlayToday(history)) return null;
  return <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
    <Button label={t("quizzes.playToday")} onPress={() => router.push("/daily" as never)} />
  </View>;
}
