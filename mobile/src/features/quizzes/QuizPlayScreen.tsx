import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { answerExpands, createPlayClock, leaderboardPosition, missesFirst, playDurationLabel, playerLabel, resultCovers, scoreRows, type PlayClock, type PublicQuizQuestion, type ScoreRow } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useSegments } from "expo-router";
import { isPermanentError } from "../../core/apiClient";
import { Image } from "expo-image";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { ApiError } from "../../core/api";
import { API_URL } from "../../core/config";
import { Button, ErrorState, FormScroll, Icon, Input, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme, useUnsavedChangesGuard } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { publicContentUrl } from "../sharing/links";
import { coverUrlForApi } from "../library/lib/coverUrl";
import { workPath } from "../works/workPath";
import { fetchPlay, fetchPlayBoard, fetchPublicResults, submitPlay, type PlayBoard, type PlayResponse } from "./api";
import { buildSubmission, isComplete, nextIndex, playStage, playStorageKey } from "./quizPlay";
import { useLocale, useT } from "../../i18n";

const uriFor = (url: string): string => coverUrlForApi(url, API_URL);

export function QuizPlayScreen({ code }: { code: string }) {
  const t = useT();
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
  const [tab, setTab] = useState<"answers" | "board">("answers");
  const clock = useRef(createPlayClock()).current;
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
        setRecoverError(reason instanceof Error ? reason.message : t("quizzes.recoverFailed"));
      }
    });
  }

  const result = submitted ?? ownPlay;
  const leaveDialog = useUnsavedChangesGuard(Object.keys(answers).length > 0 && !submitted, { title: t("quizzes.leaveTitle"), body: t("quizzes.leaveBody"), confirmLabel: t("quizzes.leave"), cancelLabel: t("quizzes.keepPlaying") });
  const stage = playStage({
    boardReady: board.isSuccess,
    boardMissing: board.isError,
    playOpen: board.data?.playOpen ?? false,
    resolved: !ready || storedId === undefined ? false : Boolean(result) || ownPlayMissing,
    alreadyPlayed: Boolean(result),
  });

  useEffect(() => { if (stage === "playing") clock.start(Date.now()); }, [stage, clock]);

  async function submit(questions: PublicQuizQuestion[]) {
    setBusy(true);
    setError(null);
    try {
      const body = { answers: buildSubmission(questions, answers), durationMs: clock.durationMs(Date.now()) };
      const response = await submitPlay(code, playerName.trim() ? { ...body, playerName: playerName.trim() } : body);
      setSubmitted(response);
      try { await AsyncStorage.setItem(playStorageKey(code), response.playId); }
      catch { setError(t("quizzes.resultLinkNotSaved")); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("quizzes.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <Screen bottom top={false} style={styles.screen}>
    {leaveDialog}
    <Stack.Screen options={{ headerShown: true, title: board.data?.name ?? t("quizzes.quizTitle") }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {stage === "loading" || board.isPending ? <Screen bottom style={styles.screen}><Skeleton height={180} /></Screen>
    : stage === "unavailable" ? <ErrorState title={t("quizzes.noQuizAtLink")} body={t("quizzes.checkCode")} actionLabel={isPermanentError(board.error) ? t("shell.notFoundAction") : t("shell.retry")} onAction={isPermanentError(board.error) ? () => router.replace("/") : () => void board.refetch()} />
    : recoverError ? <ErrorState title={t("quizzes.recoverFailedTitle")} body={recoverError} actionLabel={t("shell.retry")} onAction={() => { setRecoverError(null); loadOwnPlay(); }} />
    : stage === "leaderboard" ? <View style={styles.closed}>
      <Text {...dynamicType} style={[typography.body, styles.center, { color: colors.textDim }]}>{t("quizzes.quizClosed")}</Text>
      <Leaderboard code={code} playId={null} />
    </View>
    : stage === "played" && board.data ? <EndScreen code={code} board={board.data} result={result!} tab={tab} setTab={setTab} onError={setError} />
    : board.data ? (() => {
      const questions = board.data.questions;
      const question = questions[index];
      const answered = Object.keys(answers).length;
      const complete = isComplete(questions, answers);
      const onLast = index === questions.length - 1;
      return <FormScroll contentContainerStyle={styles.page} scrollToEnd={onLast && complete}>
        <View style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { backgroundColor: colors.accent, width: `${Math.round((answered / questions.length) * 100)}%` }]} /></View>
        <ElapsedCaption clock={clock} complete={complete} label={t("quizzes.questionOf", { number: index + 1, total: questions.length })} />
        <Prompt question={question} />
        {question.type === "title_cover" ? (
          <View style={styles.grid}>
            {question.options.map((option, optionIndex) => (
              <Pressable key={option} accessibilityRole="button" accessibilityLabel={t("quizzes.option", { number: optionIndex + 1 })} disabled={busy} onPress={() => {
                clock.answered(Date.now());
                setAnswers((value) => ({ ...value, [question.id]: optionIndex }));
                setIndex((value) => nextIndex(questions, value));
              }} style={[styles.tile, { borderColor: answers[question.id] === optionIndex ? colors.accent : colors.border, backgroundColor: colors.border }]}>
                <Image source={{ uri: uriFor(option) }} contentFit="contain" style={styles.tileImage} alt={t("quizzes.option", { number: optionIndex + 1 })} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.options}>
            {question.options.map((option, optionIndex) => (
              <Pressable key={option} accessibilityRole="button" accessibilityLabel={option} disabled={busy} onPress={() => {
                clock.answered(Date.now());
                setAnswers((value) => ({ ...value, [question.id]: optionIndex }));
                setIndex((value) => nextIndex(questions, value));
              }} style={[styles.option, { borderColor: answers[question.id] === optionIndex ? colors.accent : colors.border, backgroundColor: answers[question.id] === optionIndex ? colors.accentSoft : colors.surface }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{option}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {onLast && complete ? <View style={styles.complete}>
          {user?.username ? null : <Input label={t("quizzes.leaderboardName")} value={playerName} onChangeText={setPlayerName} placeholder={t("quizzes.guest")} maxLength={40} />}
          <Button label={t("quizzes.seeScore")} loading={busy} onPress={() => void submit(questions)} />
        </View> : null}
      </FormScroll>;
    })() : null}
  </Screen>;
}

function ElapsedCaption({ clock, complete, label }: { clock: PlayClock; complete: boolean; label: string }) {
  const { colors } = useTheme();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{label} · {Math.floor(clock.elapsed(Date.now(), complete) / 1000)}s</Text>;
}

function Prompt({ question }: { question: PublicQuizQuestion }) {
  const t = useT();
  const { colors } = useTheme();
  if (question.type === "cover_title") {
    return <View style={[styles.promptTile, { backgroundColor: colors.border }]}><Image source={{ uri: uriFor(question.prompt) }} blurRadius={12} contentFit="cover" style={StyleSheet.absoluteFill} alt={t("quizzes.whichBook")} /></View>;
  }
  if (question.type === "title_cover") {
    return <Text {...dynamicType} style={[typography.heading, styles.promptText, { color: colors.text }]}>{question.prompt}</Text>;
  }
  if (question.type === "characters_title") {
    return <View style={styles.promptCharacters}>
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.whoInBook")}</Text>
      <Text {...dynamicType} style={[typography.heading, styles.promptText, { color: colors.text }]}>{question.prompt}</Text>
    </View>;
  }
  return <Text {...dynamicType} display={false} style={[typography.title, styles.promptQuote, { color: colors.text }]}>“{question.prompt}”</Text>;
}

function EndScreen({ code, board, result, tab, setTab, onError }: {
  code: string;
  board: PlayBoard;
  result: PlayResponse;
  tab: "answers" | "board";
  setTab: (tab: "answers" | "board") => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = scoreRows(board.questions, result.correct, result.answers);
  const covers = resultCovers(board.questions, rows);
  const results = usePublicResults(code, result.playId);
  const position = results.data ? leaderboardPosition(results.data.plays) : null;

  async function challenge() {
    onError(null);
    try {
      const url = await publicContentUrl(`/play/${code}`);
      await Share.share({ message: t("quizzes.challengeMessage", { score: result.score, total: board.questionCount, name: board.name, url }) });
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : t("quizzes.publicLinkFailed"));
    }
  }

  return <View style={styles.end}>
    <View style={styles.hero}>
      <View style={styles.heroText}>
        <Text {...dynamicType} display={false} maxFontSizeMultiplier={1.2} accessibilityLabel={t("quizzes.scoreLabel", { score: result.score, total: board.questionCount })} style={[styles.score, { color: colors.text }]}>
          {result.score}<Text style={[styles.scoreOutOf, { color: colors.textDim }]}> / {board.questionCount}</Text>
        </Text>
        {position ? <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.text }]}>{t("quizzes.rankOf", position)}</Text> : null}
      </View>
      {covers.length > 0 ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fan}>
        {covers.map(({ url }, i) => (
          <View key={url} style={[styles.fanCover, { backgroundColor: colors.border, zIndex: i === 1 ? 1 : 0, transform: [{ rotate: `${(i - (covers.length - 1) / 2) * 10}deg` }, { translateY: i === 1 ? -8 : 0 }] }]}>
            <Image source={{ uri: uriFor(url) }} contentFit="contain" style={StyleSheet.absoluteFill} />
          </View>
        ))}
      </View> : null}
    </View>
    <SwipeableTabs accessibilityLabel={t("quizzes.quizResults")} options={[{ value: "answers", label: t("quizzes.yourAnswers") }, { value: "board", label: t("quizzes.leaderboard") }]} value={tab} onChange={setTab} renderPage={(page) => page === "board" ? (
      <Leaderboard code={code} playId={result.playId} />
    ) : (
      <ScrollView contentContainerStyle={styles.answers}>
        {missesFirst(rows).map((row) => <AnswerRow key={row.id} row={row} question={board.questions[row.number - 1]!} expanded={expanded === row.id} onToggle={() => setExpanded((current) => current === row.id ? null : row.id)} />)}
      </ScrollView>
    )} />
    <Button label={t("quizzes.challengeFriend")} onPress={() => void challenge()} />
  </View>;
}

function AnswerRow({ row, question, expanded, onToggle }: { row: ScoreRow; question: PublicQuizQuestion; expanded: boolean; onToggle: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const segments = useSegments();
  const title = row.answer?.title ?? (row.answer?.kind === "text" ? row.answer.value : t("quizzes.questionNumber", { number: row.number }));
  const cover = row.answer?.kind === "cover" ? row.answer.value : question.type === "cover_title" ? question.prompt : null;
  const expands = answerExpands(row);
  const prompt = row.prompt && (question.type === "quote_title" || question.type === "blurb_title") ? `“${row.prompt}”` : row.prompt;
  const picked = row.pick?.kind === "text" ? t("quizzes.youPicked", { value: row.pick.value }) : null;
  const verdict = row.correct ? t("quizzes.correct") : picked ?? t("quizzes.incorrect");
  const outcome = (row.correct ? t("quizzes.correct") : t("quizzes.incorrect")).toLowerCase();
  const label = [prompt, row.answer ? t("quizzes.answerLabelNumbered", { number: row.number, title, verdict: outcome }) : t("quizzes.answerLabel", { title, verdict: outcome }), picked].filter(Boolean).join(". ");
  const head = <>
    <View style={[styles.thumb, { backgroundColor: cover ? colors.border : colors.accentSoft }]}>
      {cover ? <Image source={{ uri: uriFor(cover) }} contentFit="contain" style={StyleSheet.absoluteFill} /> : <Icon name="book" size={18} color={colors.textDim} />}
    </View>
    <View style={styles.grow}>
      {prompt ? <Text {...dynamicType} numberOfLines={expands && !expanded ? 2 : undefined} style={[typography.caption, { color: colors.textDim }]}>{prompt}</Text> : null}
      <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{title}</Text>
      <Text {...dynamicType} style={[typography.caption, { color: row.correct ? colors.success : colors.danger }]}>{row.correct ? "✓" : "✗"} {verdict}</Text>
    </View>
    {expands ? <Icon name={expanded ? "chevronDown" : "chevronRight"} size={16} color={colors.textDim} /> : null}
  </>;
  return <View style={[styles.answerRow, { borderColor: colors.border }]}>
    {expands
      ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={label} onPress={onToggle} style={styles.answerHead}>{head}</Pressable>
      : <View accessible accessibilityLabel={label} style={styles.answerHead}>{head}</View>}
    {expands && expanded ? <View style={styles.answerExpanded}>
      {row.answer && row.pick?.kind === "cover" ? <View style={styles.answerBody}>
        <View style={styles.answerColumn}><AnswerValue value={row.answer} /></View>
        <View style={[styles.answerColumn, styles.pickColumn, { borderColor: colors.border }]}><AnswerValue value={row.pick} picked /></View>
      </View> : null}
      {row.answer ? null : <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.answerUnavailable")}</Text>}
      {row.workId ? <Pressable accessibilityRole="link" onPress={() => router.push(workPath(row.workId!, segments) as never)} style={styles.openBook}>
        <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.accent }]}>{t("quizzes.openBook")}</Text>
        <Icon name="chevronRight" size={16} color={colors.accent} />
      </Pressable> : null}
    </View> : null}
  </View>;
}

function AnswerValue({ value, picked = false }: { value: NonNullable<ScoreRow["answer"]>; picked?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const text = value.kind === "text" ? value.value : value.title;
  return <View style={styles.answerValue}>
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{picked ? t("quizzes.yourPick") : t("quizzes.correctAnswer")}</Text>
    {value.kind === "cover" ? <View style={[picked ? styles.pickCover : styles.answerCover, { backgroundColor: colors.border }]}>
      <Image source={{ uri: uriFor(value.value) }} contentFit="contain" style={StyleSheet.absoluteFill} alt={text ?? t("quizzes.cover")} />
    </View> : null}
    {text ? <Text {...dynamicType} style={[typography.body, picked ? { color: colors.textDim } : [styles.strong, { color: colors.text }]]}>{text}</Text> : null}
  </View>;
}

function usePublicResults(code: string, playId: string | null) {
  return useQuery({ queryKey: ["quizzes", "results", code, playId], queryFn: () => fetchPublicResults(code, playId), retry: false });
}

function Leaderboard({ code, playId }: { code: string; playId: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const leaderboard = usePublicResults(code, playId);
  const data = leaderboard.data;
  if (!data) return leaderboard.isError
    ? <ErrorState body={t("quizzes.leaderboardFailed")} actionLabel={t("shell.retry")} onAction={() => void leaderboard.refetch()} />
    : <View style={styles.section}><Skeleton height={180} /></View>;
  if (data.plays.length === 0) return <View style={styles.section}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.noPlays")}</Text></View>;
  return <ScrollView style={styles.board} contentContainerStyle={styles.boardContent} refreshControl={<RefreshControl refreshing={leaderboard.isRefetching} onRefresh={() => void leaderboard.refetch()} />}>
    {data.plays.map((play, i) => {
      const { name, guest } = playerLabel(play, locale);
      const time = playDurationLabel(play.durationMs, locale);
      const label = [play.isYou ? t("quizzes.you") : null, name, guest ? t("quizzes.guest") : null, t("quizzes.scoreLabel", { score: play.score, total: data.questionCount }), time].filter(Boolean).join(", ");
      return <View key={`${play.playerName ?? "Guest"}-${i}`} accessible accessibilityLabel={label} style={[styles.leaderRow, { borderColor: colors.border }, play.isYou && [styles.ownRow, { backgroundColor: colors.accentSoft }]]}>
        <Text {...dynamicType} style={[typography.body, styles.rank, i === 0 ? [styles.strong, { color: colors.accent }] : { color: colors.textDim }]}>{i + 1}</Text>
        <View style={[styles.avatarRing, { borderColor: play.isYou ? colors.accent : "transparent" }]}>
          <AuthorAvatar username={name} avatarUrl={play.avatarUrl} size={28} />
        </View>
        <View style={styles.grow}>
          <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{name}</Text>
          {guest ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.guest")}</Text> : null}
        </View>
        <View style={styles.leaderScore}>
          <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.strong, { color: colors.text }]}>{play.score}/{data.questionCount}</Text>
          <Text {...dynamicType} numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{time}</Text>
        </View>
      </View>;
    })}
    {data.plays.length === 1 && data.plays[0]!.isYou ? <Text {...dynamicType} style={[typography.caption, styles.justYou, { color: colors.textDim }]}>{t("quizzes.justYou")}</Text> : null}
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
  promptCharacters: { alignItems: "center", gap: spacing.xs },
  promptQuote: { textAlign: "center", fontStyle: "italic" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { flexGrow: 1, flexBasis: "46%", aspectRatio: 2 / 3, borderRadius: radii.lg, borderWidth: 2, overflow: "hidden" },
  tileImage: { flex: 1 },
  options: { gap: spacing.sm },
  option: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, justifyContent: "center" },
  complete: { gap: spacing.sm, paddingBottom: spacing.xl },
  section: { paddingTop: spacing.sm },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  board: { marginHorizontal: -spacing.sm },
  boardContent: { paddingTop: spacing.sm, paddingHorizontal: spacing.sm },
  ownRow: { borderRadius: radii.md, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm },
  avatarRing: { borderWidth: 1, borderRadius: radii.full },
  justYou: { paddingTop: spacing.md },
  rank: { minWidth: spacing.xl },
  leaderScore: { alignItems: "flex-end" },
  end: { flex: 1, gap: spacing.md },
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  heroText: { flex: 1 },
  score: { fontSize: 56, lineHeight: 64 },
  scoreOutOf: { fontSize: 24 },
  fan: { flexDirection: "row", paddingTop: spacing.sm },
  fanCover: { width: 44, height: 64, marginHorizontal: -spacing.xs, borderRadius: radii.sm, overflow: "hidden" },
  answers: { paddingTop: spacing.sm },
  answerRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  answerHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget, paddingVertical: spacing.sm },
  thumb: { width: 30, height: 44, borderRadius: radii.sm, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  answerExpanded: { gap: spacing.sm, paddingBottom: spacing.md },
  answerBody: { flexDirection: "row" },
  openBook: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: minimumTouchTarget },
  answerColumn: { flex: 1 },
  pickColumn: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: spacing.md },
  answerValue: { gap: spacing.xs },
  answerCover: { alignSelf: "flex-start", width: 64, height: 96, borderRadius: radii.sm, overflow: "hidden" },
  pickCover: { alignSelf: "flex-start", width: 40, height: 60, borderRadius: radii.sm, overflow: "hidden" },
  strong: { fontWeight: "700" },
  grow: { flex: 1 },
});
