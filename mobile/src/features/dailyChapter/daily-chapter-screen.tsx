import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Link, Stack, useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, Share, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyChapterDraftKey, dailyThemeName, dailyChapterShare, dailyChapterSubmission, readDailyChapterDraft, type DailyChapterBoard, type DailyChapterResult } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Text } from "../../ui/Text";
import { Button, ErrorState, Screen, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { addBookToLibrary } from "../library/api/client";
import { publicContentUrl } from "../sharing/links";
import { dailyChapterApi } from "./api";
import { DailyChapterArt } from "./daily-chapter-art";
import { useDeviceIdentity } from "./use-daily-history";
import { useLocale, useT } from "../../i18n";

export function DailyChapterScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const { ready, user, unreachable, retry } = useAuth();
  const identity = useDeviceIdentity();
  const daily = useQuery({ queryKey: ["daily-chapter", "today"], queryFn: dailyChapterApi.today, refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ["daily-chapter", "history", user?.id ?? "guest", identity.data, daily.data?.date], queryFn: () => dailyChapterApi.history(identity.data!, Boolean(user)), enabled: ready && !unreachable && Boolean(identity.data && daily.data?.date) });
  const result = history.data?.results.find((item) => item.editionId === daily.data?.board?.id);
  return <Screen top={false} bottom><Stack.Screen options={{ title: t("quizzes.theDailyChapter"), headerShown: true }} /><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>
    <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.dailyIntro")}</Text>
    {unreachable ? <ErrorState body={t("quizzes.reconnect")} actionLabel={t("shell.retry")} onAction={() => void retry()} /> : identity.isError || daily.isError || history.isError ? <ErrorState body={t("quizzes.openFailed")} actionLabel={t("shell.retry")} onAction={() => { void identity.refetch(); void daily.refetch(); void history.refetch(); }} /> : !ready || daily.isPending || history.isPending ? <Skeleton height={200} /> : daily.data.board ? <DailyGame key={daily.data.board.id + ":" + (user?.id ?? identity.data)} board={daily.data.board} guestId={identity.data!} playerId={user?.id ?? identity.data!} recovered={result} /> : <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{t("quizzes.anotherOnItsWay")}</Text>}
    {history.data?.results.length && user ? <Pressable accessibilityRole="link" accessibilityLabel={t("quizzes.chaptersLinkLabel", { played: t("quizzes.playedCount", { count: history.data.results.length }), streak: t("quizzes.dayStreakCount", { count: history.data.streak }) })} onPress={() => router.push("/(public)/daily-chapters" as never)} style={{ minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.text, fontWeight: "700" }]}>{t("quizzes.chaptersLink", { played: t("quizzes.playedCount", { count: history.data.results.length }), streak: t("quizzes.dayStreakCount", { count: history.data.streak }) })}</Text></Pressable> : history.data?.results.length ? <View style={{ gap: spacing.md }}><Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.yourChapters")}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.completedSummary", { completed: t("quizzes.completedCount", { count: history.data.results.length }), streak: t("quizzes.dayStreakCount", { count: history.data.streak }) })}</Text>{history.data.themes.map((stats) => <View key={stats.themeId} style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.text, fontWeight: "700" }]}>{dailyThemeName(stats.themeId, locale)}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.themeStats", { completed: stats.completed, eligible: stats.eligible, since: history.data.startedOn ?? "", correct: stats.correct, answered: stats.answered, count: stats.perfect })}</Text>{stats.perfectStreak > 1 ? <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{t("quizzes.perfectRun", { count: stats.perfectStreak })}</Text> : null}</View>)}{history.data.results.map((item) => <Text key={item.editionId} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.date} · {item.title} · {item.score}/5</Text>)}</View> : null}
    {!user ? <View style={{ gap: spacing.sm }}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.staysOnDevice")}</Text><Link href={{ pathname: "/login", params: { returnTo: "/daily" } }} style={{ minHeight: 44, paddingVertical: spacing.md, color: colors.accent }}>{t("quizzes.keepMyChapters")}</Link></View> : null}
  </ScrollView></Screen>;
}

function DailyGame({ board, guestId, playerId, recovered }: { board: DailyChapterBoard; guestId: string; playerId: string; recovered?: DailyChapterResult }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const { user } = useAuth();
  const client = useQueryClient();
  const questions = useRef(board.questions).current;
  const key = dailyChapterDraftKey(board.id, playerId);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [submitted, setSubmitted] = useState<DailyChapterResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const result = submitted ?? recovered;
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key).then((value) => { if (!live) return; const draft = readDailyChapterDraft(value, questions); setAnswers(draft); const missing = questions.findIndex((q) => draft[q.id] === undefined); setIndex(missing < 0 ? 4 : missing); setLoaded(true); }).catch(() => { if (live) { setError(t("quizzes.draftRestoreFailed")); setLoaded(true); } });
    return () => { live = false; };
  }, [key, questions]);
  function choose(questionId: string, choice: number) {
    const next = { ...answers, [questionId]: choice };
    setAnswers(next);
    void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => setError(t("quizzes.progressNotSaved")));
  }
  async function submit() {
    const body = dailyChapterSubmission(questions, answers);
    if (!body) return;
    setBusy(true); setError("");
    try { setSubmitted(await dailyChapterApi.play(board.id, guestId, body, Boolean(user))); void client.invalidateQueries({ queryKey: ["daily-chapter", "history"] }); void client.invalidateQueries({ queryKey: ["daily-chapter", "player"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("quizzes.scoreFailed")); void client.invalidateQueries({ queryKey: ["daily-chapter", "today"] }); }
    finally { setBusy(false); }
  }
  async function saveBook(book: DailyChapterResult["answers"][number]["book"]) {
    setBusy(true); setError("");
    try { await addBookToLibrary({ title: book.title, author: book.author, readStatus: 0, preserveExisting: true }); setSaved((items) => [...items, book.id]); void client.invalidateQueries({ queryKey: ["library"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("quizzes.saveBookFailed")); }
    finally { setBusy(false); }
  }
  async function share() {
    if (!result) return;
    try { await Share.share({ message: dailyChapterShare(result, await publicContentUrl("/daily"), locale) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("quizzes.shareFailed")); }
  }
  const question = questions[index]!;
  return <View style={{ gap: spacing.lg }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}><DailyChapterArt motif={board.theme.motif} /><View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.themeDate", { theme: dailyThemeName(board.theme.id, locale), date: board.date })}</Text><Text accessibilityRole="header" {...dynamicType} style={[typography.heading, { color: colors.text }]}>{board.title}</Text></View></View>
    <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{board.intro}</Text>
    {error ? <Text selectable accessibilityRole="alert" {...dynamicType} style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}
    {result ? <>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.heading, { color: colors.accent }]}>{t("quizzes.chapterComplete", { score: result.score })}</Text><Button label={t("quizzes.shareScore")} onPress={() => void share()} /><Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("quizzes.booksBehind")}</Text>
      {result.answers.map((answer, i) => <View key={answer.questionId} style={{ gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, borderColor: colors.border, padding: spacing.lg, backgroundColor: colors.surface }}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{answer.choiceIndex === answer.answerIndex ? t("quizzes.resultCorrect", { number: i + 1 }) : t("quizzes.resultPick", { number: i + 1, option: answer.options[answer.choiceIndex]! })}</Text><Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{answer.book.title}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{answer.book.author}</Text><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{answer.explanation}</Text><Button variant="secondary" label={t("quizzes.readSource")} onPress={() => void Linking.openURL(answer.sourceUrl).catch((reason) => setError(reason instanceof Error ? reason.message : t("quizzes.openSourceFailed")))} />{user ? <Button variant="secondary" label={saved.includes(answer.book.id) ? t("shell.saved") : t("book.wantToRead")} disabled={busy || saved.includes(answer.book.id)} onPress={() => void saveBook(answer.book)} /> : null}</View>)}<Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.anotherTomorrow")}</Text>
    </> : <>
      <Text accessibilityLiveRegion="polite" {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t(question.type === "quote_title" ? "quizzes.dailyQuestionQuote" : "quizzes.dailyQuestionClue", { number: index + 1 })}</Text><Text selectable {...dynamicType} style={[typography.title, { color: colors.text }]}>{question.prompt}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>{question.options.map((option, choice) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: answers[question.id] === choice, disabled: busy || !loaded }} disabled={busy || !loaded} onPress={() => choose(question.id, choice)} style={{ minHeight: 52, padding: spacing.lg, borderRadius: radii.md, borderWidth: 1, borderColor: answers[question.id] === choice ? colors.accent : colors.border, backgroundColor: answers[question.id] === choice ? colors.accentSoft : colors.surface }}><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{answers[question.id] === choice ? "● " : "○ "}{option}</Text></Pressable>)}</View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Button label={t("shell.back")} variant="secondary" disabled={index === 0 || busy} onPress={() => setIndex(index - 1)} />{index < 4 ? <Button label={t("tierlists.next")} disabled={answers[question.id] === undefined} onPress={() => setIndex(index + 1)} /> : <Button label={t("quizzes.finishChapter")} loading={busy} disabled={!dailyChapterSubmission(questions, answers)} onPress={() => void submit()} />}</View><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.answersAfter")}</Text>
    </>}
  </View>;
}
