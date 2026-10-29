import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { Link, Stack } from "expo-router";
import { Linking, Pressable, ScrollView, Share, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DAILY_CHAPTER_GUEST_STORAGE, DAILY_CHAPTER_THEMES, dailyChapterDraftKey, dailyChapterShare, dailyChapterSubmission, isDailyChapterGuestId, readDailyChapterDraft, type DailyChapterBoard, type DailyChapterResult } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Text } from "../../ui/Text";
import { Button, ErrorState, Screen, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { addBookToLibrary } from "../library/api/client";
import { publicContentUrl } from "../sharing/links";
import { dailyChapterApi } from "./api";
import { DailyChapterArt } from "./daily-chapter-art";

async function deviceIdentity() {
  const stored = await AsyncStorage.getItem(DAILY_CHAPTER_GUEST_STORAGE);
  if (isDailyChapterGuestId(stored)) return stored;
  const id = randomUUID();
  await AsyncStorage.setItem(DAILY_CHAPTER_GUEST_STORAGE, id);
  return id;
}

export function DailyChapterScreen() {
  const { colors } = useTheme();
  const { ready, user, unreachable, retry } = useAuth();
  const identity = useQuery({ queryKey: ["daily-chapter", "identity"], queryFn: deviceIdentity, staleTime: Infinity });
  const daily = useQuery({ queryKey: ["daily-chapter", "today"], queryFn: dailyChapterApi.today, refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ["daily-chapter", "history", user?.id ?? "guest", identity.data, daily.data?.date], queryFn: () => dailyChapterApi.history(identity.data!), enabled: ready && !unreachable && Boolean(identity.data && daily.data?.date) });
  const result = history.data?.results.find((item) => item.editionId === daily.data?.board?.id);
  return <Screen top={false} bottom><Stack.Screen options={{ title: "The Daily Chapter", headerShown: true }} /><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>
    <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>One theme. Five questions. A new chapter at 00:00 UTC. Everyone welcome.</Text>
    {unreachable ? <ErrorState body="Reconnect to load your account and daily history." actionLabel="Retry" onAction={() => void retry()} /> : identity.isError || daily.isError || history.isError ? <ErrorState body="Couldn't open your chapter or saved results." actionLabel="Retry" onAction={() => { void identity.refetch(); void daily.refetch(); void history.refetch(); }} /> : !ready || daily.isPending || history.isPending ? <Skeleton height={200} /> : daily.data.board ? <DailyGame key={daily.data.board.id + ":" + (user?.id ?? identity.data)} board={daily.data.board} guestId={identity.data!} playerId={user?.id ?? identity.data!} recovered={result} /> : <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>Another chapter is on its way. Check back soon.</Text>}
    {history.data?.results.length ? <View style={{ gap: spacing.md }}><Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>Your chapters</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{history.data.results.length} completed · {history.data.streak} day streak</Text>{history.data.themes.map((stats) => <View key={stats.themeId} style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md }}><Text {...dynamicType} style={[typography.body, { color: colors.text, fontWeight: "700" }]}>{DAILY_CHAPTER_THEMES.find((theme) => theme.id === stats.themeId)?.name}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{stats.completed}/{stats.eligible} editions since {history.data.startedOn} · {stats.correct}/{stats.answered} correct · {stats.perfect} perfect</Text>{stats.perfectStreak > 1 ? <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{stats.perfectStreak} perfect editions in a row</Text> : null}</View>)}{history.data.results.map((item) => <Text key={item.editionId} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.date} · {item.title} · {item.score}/5</Text>)}</View> : null}
    {!user ? <View style={{ gap: spacing.sm }}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Your results stay on this device. Sign in to keep them across devices.</Text><Link href={{ pathname: "/login", params: { returnTo: "/daily" } }} style={{ minHeight: 44, paddingVertical: spacing.md, color: colors.accent }}>Keep my chapters</Link></View> : null}
  </ScrollView></Screen>;
}

function DailyGame({ board, guestId, playerId, recovered }: { board: DailyChapterBoard; guestId: string; playerId: string; recovered?: DailyChapterResult }) {
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
    AsyncStorage.getItem(key).then((value) => { if (!live) return; const draft = readDailyChapterDraft(value, questions); setAnswers(draft); const missing = questions.findIndex((q) => draft[q.id] === undefined); setIndex(missing < 0 ? 4 : missing); setLoaded(true); }).catch(() => { if (live) { setError("Couldn't restore this device's draft. You can still play here."); setLoaded(true); } });
    return () => { live = false; };
  }, [key, questions]);
  function choose(questionId: string, choice: number) {
    const next = { ...answers, [questionId]: choice };
    setAnswers(next);
    void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => setError("Your answers are on this screen, but this device couldn't save progress."));
  }
  async function submit() {
    const body = dailyChapterSubmission(questions, answers);
    if (!body) return;
    setBusy(true); setError("");
    try { setSubmitted(await dailyChapterApi.play(board.id, guestId, body)); void client.invalidateQueries({ queryKey: ["daily-chapter", "history"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't score your chapter. Try again."); void client.invalidateQueries({ queryKey: ["daily-chapter", "today"] }); }
    finally { setBusy(false); }
  }
  async function saveBook(book: DailyChapterResult["answers"][number]["book"]) {
    setBusy(true); setError("");
    try { await addBookToLibrary({ title: book.title, author: book.author, readStatus: 0, preserveExisting: true }); setSaved((items) => [...items, book.id]); void client.invalidateQueries({ queryKey: ["library"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save the book."); }
    finally { setBusy(false); }
  }
  async function share() {
    if (!result) return;
    try { await Share.share({ message: dailyChapterShare(result, await publicContentUrl("/daily")) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't share the result."); }
  }
  const question = questions[index]!;
  return <View style={{ gap: spacing.lg }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}><DailyChapterArt motif={board.theme.motif} /><View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{board.theme.name} · {board.date}</Text><Text accessibilityRole="header" {...dynamicType} style={[typography.heading, { color: colors.text }]}>{board.title}</Text></View></View>
    <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{board.intro}</Text>
    {error ? <Text selectable accessibilityRole="alert" {...dynamicType} style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}
    {result ? <>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.heading, { color: colors.accent }]}>{result.score}/5 · Chapter complete</Text><Button label="Share your score" onPress={() => void share()} /><Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>The books behind today's chapter</Text>
      {result.answers.map((answer, i) => <View key={answer.questionId} style={{ gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, borderColor: colors.border, padding: spacing.lg, backgroundColor: colors.surface }}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{i + 1}. {answer.choiceIndex === answer.answerIndex ? "Correct" : "Your pick: " + answer.options[answer.choiceIndex]}</Text><Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{answer.book.title}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{answer.book.author}</Text><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{answer.explanation}</Text><Button variant="secondary" label="Read the source" onPress={() => void Linking.openURL(answer.sourceUrl).catch((reason) => setError(reason instanceof Error ? reason.message : "Couldn't open the source."))} />{user ? <Button variant="secondary" label={saved.includes(answer.book.id) ? "Saved" : "Want to read"} disabled={busy || saved.includes(answer.book.id)} onPress={() => void saveBook(answer.book)} /> : null}</View>)}<Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Another little chapter tomorrow.</Text>
    </> : <>
      <Text accessibilityLiveRegion="polite" {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Question {index + 1} of 5 · {question.type === "quote_title" ? "Name the book from its words" : "Name the book from this clue"}</Text><Text selectable {...dynamicType} style={[typography.title, { color: colors.text }]}>{question.prompt}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>{question.options.map((option, choice) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: answers[question.id] === choice, disabled: busy || !loaded }} disabled={busy || !loaded} onPress={() => choose(question.id, choice)} style={{ minHeight: 52, padding: spacing.lg, borderRadius: radii.md, borderWidth: 1, borderColor: answers[question.id] === choice ? colors.accent : colors.border, backgroundColor: answers[question.id] === choice ? colors.accentSoft : colors.surface }}><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{answers[question.id] === choice ? "● " : "○ "}{option}</Text></Pressable>)}</View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}><Button label="Back" variant="secondary" disabled={index === 0 || busy} onPress={() => setIndex(index - 1)} />{index < 4 ? <Button label="Next" disabled={answers[question.id] === undefined} onPress={() => setIndex(index + 1)} /> : <Button label="Finish chapter" loading={busy} disabled={!dailyChapterSubmission(questions, answers)} onPress={() => void submit()} />}</View><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Answers and explanations appear after all five questions. There is no timer.</Text>
    </>}
  </View>;
}
