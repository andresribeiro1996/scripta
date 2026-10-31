import { useQuery } from "@tanstack/react-query";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { DAILY_CHAPTER_THEMES } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { EmptyState, ErrorState, Skeleton, dynamicType, spacing, typography, useTheme } from "../../ui";
import { dailyChapterApi } from "./api";
import { DailyChapterCalendar } from "./daily-chapter-calendar";
import { DailyChapterTiles } from "./daily-chapter-tiles";

export function DailyChapterProfileSection({ userId, own }: { userId: string; own: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const query = useQuery({ queryKey: ["daily-chapter", "player", userId], queryFn: () => dailyChapterApi.player(userId) });
  let body;
  if (query.isError) body = <ErrorState body="Couldn't load the Daily Chapter." actionLabel="Retry" onAction={() => void query.refetch()} />;
  else if (!query.data) body = <View style={{ gap: spacing.md }}><Skeleton height={72} /><Skeleton height={200} /></View>;
  else if (!query.data.summary) body = own
    ? <EmptyState title="No Daily Chapter yet" body="Play today's Daily Chapter to start your calendar." actionLabel="Play today's chapter" onAction={() => router.push("/daily" as never)} />
    : <EmptyState title="No Daily Chapter" body="No Daily Chapter results to show." />;
  else {
    const { summary } = query.data;
    const { bestTheme, days } = summary;
    const themeName = bestTheme ? DAILY_CHAPTER_THEMES.find((theme) => theme.id === bestTheme.themeId)?.name ?? bestTheme.themeId : "";
    body = <>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>The Daily Chapter</Text>
      <DailyChapterTiles summary={summary} />
      <DailyChapterCalendar days={days} numbers={false} />
      {bestTheme ? <View><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Best at {themeName} · {bestTheme.percent}%</Text></View> : null}
    </>;
  }
  return <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>{body}</ScrollView>;
}
