import { Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "../../ui/Text";
import { EmptyState, Screen, Skeleton, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { dailyChapterApi } from "./api";
import { DailyChapterSquares } from "./daily-chapter-squares";
import { useDailyHistory, useDeviceIdentity } from "./use-daily-history";

export function DailyChapterDayScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const identity = useDeviceIdentity();
  const history = useDailyHistory();
  const result = history.data?.results.find((item) => item.editionId === id);
  const people = useQuery({ queryKey: ["daily-chapter", "people", id], queryFn: () => dailyChapterApi.people(id), enabled: Boolean(result) });
  const title = result ? `${result.date} · ${result.title}` : "Daily Chapter";
  let body;
  if (identity.isError || history.isError) body = <EmptyState title="Couldn't load this chapter" actionLabel="Retry" onAction={() => { void identity.refetch(); void history.refetch(); }} />;
  else if (!history.data) body = <View style={{ gap: spacing.md }}><Skeleton height={48} /><Skeleton height={120} /><Skeleton height={120} /></View>;
  else if (!result) body = <EmptyState title="You didn't play this chapter." />;
  else {
    const others = people.data?.people.filter((person) => !person.you) ?? [];
    let followed;
    if (people.isError) followed = <Pressable accessibilityRole="button" accessibilityLabel="Retry loading people you follow" onPress={() => void people.refetch()} style={{ minHeight: minimumTouchTarget, justifyContent: "center" }}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>Couldn't load people you follow. Retry</Text></Pressable>;
    else if (!people.data) followed = <Skeleton height={44} />;
    else if (!others.length) followed = <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Nobody you follow has played this chapter.</Text>;
    else followed = people.data.people.map((person) => <View key={person.userId} accessibilityLabel={`${person.you ? "You" : person.username}, ${person.score} out of 5`} style={{ minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
      <AuthorAvatar username={person.username} avatarUrl={person.avatarUrl} />
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, { flex: 1, minWidth: 0, color: colors.text }]}>{person.you ? "you" : person.username}</Text>
      <DailyChapterSquares marks={person.marks} />
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.textDim, fontWeight: "700" }]}>{person.score}/5</Text>
    </View>);
    body = <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Text {...dynamicType} style={[typography.heading, { color: colors.text, fontWeight: "700" }]}>{result.score}/5</Text>
        <DailyChapterSquares marks={result.answers.map((answer) => answer.choiceIndex === answer.answerIndex)} size={14} />
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>Your answers</Text>
        {result.answers.map((answer) => {
          const right = answer.choiceIndex === answer.answerIndex;
          return <View key={answer.questionId} style={{ gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface }}>
            <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{answer.prompt}</Text>
            {right
              ? <Text {...dynamicType} style={[typography.body, { color: colors.success, fontWeight: "700" }]}>✓ {answer.options[answer.choiceIndex]}</Text>
              : <>
                <Text {...dynamicType} style={[typography.body, { color: colors.text }]}><Text {...dynamicType} style={[typography.body, { color: colors.danger, fontWeight: "700" }]}>✗ You said {answer.options[answer.choiceIndex]}</Text> · it's <Text {...dynamicType} style={[typography.body, { fontWeight: "700", color: colors.text }]}>{answer.options[answer.answerIndex]}</Text></Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{answer.explanation}</Text>
              </>}
          </View>;
        })}
      </View>
      <View>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text, marginBottom: spacing.sm }]}>People you follow</Text>
        {followed}
      </View>
    </>;
  }
  return <Screen top={false} bottom><Stack.Screen options={{ title, headerShown: true }} /><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>{body}</ScrollView></Screen>;
}
