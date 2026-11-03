import { Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "../../ui/Text";
import { EmptyState, Screen, Skeleton, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { ApiError } from "../../core/api";
import { dailyChapterApi } from "./api";
import { DailyChapterSquares } from "./daily-chapter-squares";
import { useDailyHistory, useDeviceIdentity } from "./use-daily-history";
import { useT } from "../../i18n";

export function DailyChapterDayScreen({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const identity = useDeviceIdentity();
  const history = useDailyHistory();
  const result = history.data?.results.find((item) => item.editionId === id);
  const review = useQuery({
    queryKey: ["daily-chapter", "review", id],
    queryFn: async () => {
      try {
        return await dailyChapterApi.review(id);
      } catch (reason) {
        if (reason instanceof ApiError && (reason.status === 403 || reason.status === 404)) return null;
        throw reason;
      }
    },
    enabled: Boolean(history.data && !result),
  });
  const shown = result ?? review.data;
  const people = useQuery({ queryKey: ["daily-chapter", "people", id], queryFn: () => dailyChapterApi.people(id), enabled: Boolean(shown) });
  const title = shown ? `${shown.date} · ${shown.title}` : t("quizzes.dailyChapter");
  let body;
  if (identity.isError || history.isLoadingError || (!result && review.isLoadingError)) body = <EmptyState title={t("quizzes.dayLoadFailed")} actionLabel={t("shell.retry")} onAction={() => { void identity.refetch(); void history.refetch(); if (!result && review.isLoadingError) void review.refetch(); }} />;
  else if (!history.data || (!result && review.isPending)) body = <View style={{ gap: spacing.md }}><Skeleton height={48} /><Skeleton height={120} /><Skeleton height={120} /></View>;
  else if (!shown) body = <EmptyState title={t("quizzes.didntPlay")} />;
  else {
    const others = people.data?.people.filter((person) => !person.you) ?? [];
    let followed;
    if (people.isError) followed = <Pressable accessibilityRole="button" accessibilityLabel={t("quizzes.retryPeopleLabel")} onPress={() => void people.refetch()} style={{ minHeight: minimumTouchTarget, justifyContent: "center" }}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{t("quizzes.peopleLoadFailed")}</Text></Pressable>;
    else if (!people.data) followed = <Skeleton height={44} />;
    else if (!others.length) followed = <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.nobodyPlayed")}</Text>;
    else followed = people.data.people.map((person) => <View key={person.userId} accessibilityLabel={t("quizzes.outOfFive", { label: person.you ? t("quizzes.you") : person.username, score: person.score })} style={{ minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
      <AuthorAvatar username={person.username} avatarUrl={person.avatarUrl} />
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, { flex: 1, minWidth: 0, color: colors.text }]}>{person.you ? t("quizzes.youLower") : person.username}</Text>
      <DailyChapterSquares marks={person.marks} />
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.textDim, fontWeight: "700" }]}>{person.score}/5</Text>
    </View>);
    body = <>
      {result ? <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Text {...dynamicType} style={[typography.heading, { color: colors.text, fontWeight: "700" }]}>{result.score}/5</Text>
        <DailyChapterSquares marks={result.answers.map((answer) => answer.choiceIndex === answer.answerIndex)} size={14} />
      </View> : <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.didntPlay")}</Text>}
      {result ? <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.yourAnswers")}</Text>
        {result.answers.map((answer) => {
          const right = answer.choiceIndex === answer.answerIndex;
          return <View key={answer.questionId} style={{ gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface }}>
            <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{answer.prompt}</Text>
            {right
              ? <Text {...dynamicType} style={[typography.body, { color: colors.success, fontWeight: "700" }]}>✓ {answer.options[answer.choiceIndex]}</Text>
              : <>
                <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{t("quizzes.wrongAnswer", { pick: answer.options[answer.choiceIndex]!, answer: answer.options[answer.answerIndex]! }).split("**").map((part, index) => index === 1 ? <Text key={index} {...dynamicType} style={[typography.body, { color: colors.danger, fontWeight: "700" }]}>{part}</Text> : index === 3 ? <Text key={index} {...dynamicType} style={[typography.body, { fontWeight: "700", color: colors.text }]}>{part}</Text> : part)}</Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{answer.explanation}</Text>
              </>}
          </View>;
        })}
      </View> : <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.questionsAndAnswers")}</Text>
        {review.data?.questions.map((question) => <View key={question.questionId} style={{ gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface }}>
          <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{question.prompt}</Text>
          <Text {...dynamicType} style={[typography.body, { color: colors.success, fontWeight: "700" }]}>✓ {question.options[question.answerIndex]}</Text>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{question.explanation}</Text>
        </View>)}
      </View>}
      <View>
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text, marginBottom: spacing.sm }]}>{t("quizzes.peopleYouFollow")}</Text>
        {followed}
      </View>
    </>;
  }
  return <Screen top={false} bottom><Stack.Screen options={{ title, headerShown: true }} /><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>{body}</ScrollView></Screen>;
}
