import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PublicQuizQuestion } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { isPermanentError } from "../../core/apiClient";
import { Image } from "expo-image";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { ApiError } from "../../core/api";
import { API_URL } from "../../core/config";
import { Button, ErrorState, FormScroll, Input, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { coverUrlForApi } from "../library/lib/coverUrl";
import { fetchPlay, fetchPlayBoard, fetchPublicResults, submitPlay, type PlayBoard, type PlayResponse } from "./api";
import { buildSubmission, isComplete, nextIndex, playStage, playStorageKey } from "./quizPlay";

const uriFor = (url: string): string => coverUrlForApi(url, API_URL);

export function QuizPlayScreen({ code }: { code: string }) {
  const { colors } = useTheme();
  const { ready, user } = useAuth();
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined);
  const [ownPlay, setOwnPlay] = useState<PlayResponse | null>(null);
  const [ownPlayMissing, setOwnPlayMissing] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<PlayResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [playerName, setPlayerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"you" | "board">("you");
  const startRef = useRef(Date.now());
  const board = useQuery({ queryKey: ["quizzes", "board", code], queryFn: () => fetchPlayBoard(code), enabled: Boolean(code), retry: false });

  useEffect(() => { void AsyncStorage.getItem(playStorageKey(code)).then(setStoredId).catch(() => setStoredId(null)); }, [code]);
  // Same split as VoteTierlistScreen's ballot: a signed-in player's play is
  // account-keyed (also the only way the owner reaches theirs), an
  // anonymous one rides the device-stored id.
  useEffect(() => { if (ready && storedId !== undefined) loadOwnPlay(); }, [code, ready, storedId, user]);

  function loadOwnPlay() {
    if (!user && !storedId) { setOwnPlayMissing(true); return; }
    void fetchPlay(code, user ? null : storedId ?? null).then((found) => {
      setOwnPlay(found);
      setOwnPlayMissing(false);
      setRecoverError(null);
    }).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 404) {
        setOwnPlay(null);
        setOwnPlayMissing(true);
        setRecoverError(null);
        if (!user && storedId) { void AsyncStorage.removeItem(playStorageKey(code)); setStoredId(null); }
      } else {
        // Anything else (network, 5xx) must surface with a retry — staying
        // "unresolved" would pin the screen on the skeleton forever.
        setOwnPlayMissing(false);
        setRecoverError(reason instanceof Error ? reason.message : "Couldn't check your previous plays.");
      }
    });
  }

  const result = submitted ?? ownPlay;
  const stage = playStage({
    boardReady: board.isSuccess,
    boardMissing: board.isError,
    playOpen: board.data?.playOpen ?? false,
    resolved: !ready || storedId === undefined ? false : Boolean(result) || ownPlayMissing,
    alreadyPlayed: Boolean(result),
  });

  async function submit(questions: PublicQuizQuestion[]) {
    setBusy(true);
    setError(null);
    try {
      const body = { answers: buildSubmission(questions, answers), durationMs: Date.now() - startRef.current };
      const response = await submitPlay(code, playerName.trim() ? { ...body, playerName: playerName.trim() } : body);
      setSubmitted(response);
      try { await AsyncStorage.setItem(playStorageKey(code), response.playId); }
      catch { setError("Scored, but this device couldn't save your result link."); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't submit your answers.");
    } finally {
      setBusy(false);
    }
  }

  return <Screen bottom top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: board.data?.name ?? "Quiz" }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {stage === "loading" || board.isPending ? <Screen bottom style={styles.screen}><Skeleton height={180} /></Screen>
    : stage === "unavailable" ? <ErrorState title="No quiz at that link" body="Check the code and try again." actionLabel={isPermanentError(board.error) ? "Go to Atmyshelf" : "Retry"} onAction={isPermanentError(board.error) ? () => router.replace("/") : () => void board.refetch()} />
    : recoverError ? <ErrorState title="Couldn't check your previous plays" body={recoverError} actionLabel="Retry" onAction={() => { setRecoverError(null); loadOwnPlay(); }} />
    : stage === "leaderboard" ? <View style={styles.closed}>
      <Text {...dynamicType} style={[typography.body, styles.center, { color: colors.textDim }]}>This quiz is closed.</Text>
      <Leaderboard code={code} />
    </View>
    : stage === "played" && board.data ? <EndScreen code={code} board={board.data} result={result!} returning={submitted === null} tab={tab} setTab={setTab} />
    : board.data ? (() => {
      const questions = board.data.questions;
      const question = questions[index];
      const answered = Object.keys(answers).length;
      const complete = isComplete(questions, answers);
      const onLast = index === questions.length - 1;
      return <FormScroll contentContainerStyle={styles.page} scrollToEnd={onLast && complete}>
        <View style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { backgroundColor: colors.accent, width: `${Math.round((answered / questions.length) * 100)}%` }]} /></View>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Question {index + 1} of {questions.length}</Text>
        <Prompt question={question} />
        {question.type === "title_cover" ? (
          <View style={styles.grid}>
            {question.options.map((option, optionIndex) => (
              <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Option ${optionIndex + 1}`} disabled={busy} onPress={() => {
                setAnswers((value) => ({ ...value, [question.id]: optionIndex }));
                setIndex((value) => nextIndex(questions, value));
              }} style={[styles.tile, { borderColor: answers[question.id] === optionIndex ? colors.accent : colors.border, backgroundColor: colors.border }]}>
                <Image source={{ uri: uriFor(option) }} contentFit="contain" style={styles.tileImage} alt={`Option ${optionIndex + 1}`} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.options}>
            {question.options.map((option, optionIndex) => (
              <Pressable key={option} accessibilityRole="button" accessibilityLabel={option} disabled={busy} onPress={() => {
                setAnswers((value) => ({ ...value, [question.id]: optionIndex }));
                setIndex((value) => nextIndex(questions, value));
              }} style={[styles.option, { borderColor: answers[question.id] === optionIndex ? colors.accent : colors.border, backgroundColor: answers[question.id] === optionIndex ? colors.accentSoft : colors.surface }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{option}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {onLast && complete ? <View style={styles.complete}>
          <Input label="Name for the leaderboard (optional)" value={playerName} onChangeText={setPlayerName} placeholder="Guest" maxLength={40} />
          <Button label="See my score" loading={busy} onPress={() => void submit(questions)} />
        </View> : null}
      </FormScroll>;
    })() : null}
  </Screen>;
}

function Prompt({ question }: { question: PublicQuizQuestion }) {
  const { colors } = useTheme();
  if (question.type === "cover_title") {
    return <View style={[styles.promptTile, { backgroundColor: colors.border }]}><Image source={{ uri: uriFor(question.prompt) }} blurRadius={12} contentFit="cover" style={StyleSheet.absoluteFill} alt="Which book is this?" /></View>;
  }
  if (question.type === "title_cover") {
    return <Text {...dynamicType} style={[typography.heading, styles.promptText, { color: colors.text }]}>{question.prompt}</Text>;
  }
  return <Text {...dynamicType} display={false} style={[typography.title, styles.promptQuote, { color: colors.text }]}>“{question.prompt}”</Text>;
}

function EndScreen({ code, board, result, returning, tab, setTab }: {
  code: string;
  board: PlayBoard;
  result: PlayResponse;
  returning: boolean;
  tab: "you" | "board";
  setTab: (tab: "you" | "board") => void;
}) {
  const { colors } = useTheme();
  return <SwipeableTabs accessibilityLabel="Quiz results" options={[{ value: "you", label: "You" }, { value: "board", label: "Leaderboard" }]} value={tab} onChange={setTab} renderPage={(page) => page === "board" ? (
    <Leaderboard code={code} />
  ) : (
    <ScrollView contentContainerStyle={styles.section}>
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{returning ? "You already played this quiz." : "Your score"}</Text>
      <Text {...dynamicType} display={false} style={[typography.heading, styles.score, { color: colors.accent }]}>{result.score}/{board.questionCount}</Text>
      {board.questions.map((question, i) => (
        <View key={question.id} style={[styles.verdict, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{i + 1}</Text>
          <Text {...dynamicType} style={[typography.title, { color: result.correct[question.id] ? colors.success : colors.danger }]}>{result.correct[question.id] ? "✓" : "✗"}</Text>
        </View>
      ))}
    </ScrollView>
  )} />;
}

function Leaderboard({ code }: { code: string }) {
  const { colors } = useTheme();
  const leaderboard = useQuery({ queryKey: ["quizzes", "results", code], queryFn: () => fetchPublicResults(code), retry: false });
  if (leaderboard.isPending) return <View style={styles.section}><Skeleton height={180} /></View>;
  if (leaderboard.isError) return <ErrorState body="Couldn't load the leaderboard." actionLabel="Retry" onAction={() => void leaderboard.refetch()} />;
  if (leaderboard.data.plays.length === 0) return <View style={styles.section}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No plays yet.</Text></View>;
  return <ScrollView contentContainerStyle={styles.section}>
    {leaderboard.data.plays.map((play, i) => (
      <View key={`${play.playerName ?? "Guest"}-${i}`} style={[styles.leaderRow, { borderColor: colors.border }]}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{i + 1}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{play.playerName ?? "Guest"}</Text>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{play.score}/{leaderboard.data.questionCount}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{(play.durationMs / 1000).toFixed(1)}s</Text>
      </View>
    ))}
  </ScrollView>;
}

const styles = StyleSheet.create({
  closed: { flex: 1, gap: spacing.md },
  center: { textAlign: "center" },
  screen: { padding: spacing.lg, gap: spacing.md },
  page: { flexGrow: 1, gap: spacing.md },
  track: { height: 4, borderRadius: radii.full },
  fill: { height: 4, borderRadius: radii.full },
  promptTile: { alignSelf: "center", width: 180, height: 252, borderRadius: radii.lg, overflow: "hidden" },
  promptText: { textAlign: "center" },
  promptQuote: { textAlign: "center", fontStyle: "italic" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { flexGrow: 1, flexBasis: "46%", aspectRatio: 2 / 3, borderRadius: radii.lg, borderWidth: 2, overflow: "hidden" },
  tileImage: { flex: 1 },
  options: { gap: spacing.sm },
  option: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, justifyContent: "center" },
  complete: { gap: spacing.sm, paddingBottom: spacing.xl },
  section: { gap: spacing.sm, paddingTop: spacing.lg },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  verdict: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  score: { textAlign: "center", fontWeight: "700" },
  strong: { fontWeight: "700" },
  grow: { flex: 1 },
});
