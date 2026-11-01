import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import { Image } from "expo-image";
import { QUIZ_QUESTION_TYPES, eligibleTypes, playerLabel, quizOptionLabel, quizQuestionLabel, type QuizData } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { API_URL } from "../../core/config";
import { ActionSheet, type ActionItem, Button, Dialog, EditorHeading, ErrorState, FormScroll, HeaderActions, IconButton, Input, SaveStateButton, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme, useUnsavedChangesGuard } from "../../ui";
import { coverUrlForApi } from "../library/lib/coverUrl";
import { publicContentUrl } from "../sharing/links";
import { fetchQuizResults, publishQuiz, setPlayState, updateQuiz, type Quiz } from "./api";
import { useWorkCharacters } from "./useWorkCharacters";
import { quizTypeLabel } from "./quizTypeLabel";
import { useLocale, useT } from "../../i18n";

type EditorView = "setup" | "results";

const PUBLISHED_VIEWS = [{ value: "setup", label: "quizzes.questions" }, { value: "results", label: "quizzes.results" }] as const;

const uriFor = (url: string): string => coverUrlForApi(url, API_URL);

export function QuizEditorScreen({ quiz, onUpdated, initialView }: { quiz: Quiz; onUpdated: (quiz: Quiz) => void; initialView?: EditorView }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(quiz);
  const [data, setData] = useState<QuizData>(quiz.data);
  const dataRef = useRef(data);
  dataRef.current = data;
  const { characters, failed: charactersFailed } = useWorkCharacters(data.books.map((book) => book.workId));
  const [view, setView] = useState<EditorView>(initialView ?? "setup");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const results = useQuery({ queryKey: ["quizzes", "results", current.id], queryFn: () => fetchQuizResults(current.id), enabled: current.voteCode !== null, retry: false });

  // Keyed on the server's own version — a refetch hands back an
  // equal-but-new object and must not reset local edits (tierlist
  // editor's lesson, same fix).
  useEffect(() => { setCurrent(quiz); setData(quiz.data); }, [quiz.id, quiz.updatedAt]);

  async function run(action: () => Promise<Quiz>) {
    // The draft at send time. If the user kept typing while the request
    // was in flight, the server response must not throw those edits away.
    const submitted = dataRef.current;
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setCurrent(updated);
      if (dataRef.current === submitted) setData(updated.data);
      onUpdated(updated);
      await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("quizzes.saveFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    // Publishing freezes the document, so in-flight typing would be
    // stranded: the form is locked for the duration instead.
    setPublishing(true);
    setError(null);
    try {
      if (JSON.stringify(dataRef.current) !== JSON.stringify(current.data)) await updateQuiz(current.id, { data: dataRef.current });
      const { quiz: published } = await publishQuiz(current.id);
      setCurrent(published);
      setData(published.data);
      onUpdated(published);
      setConfirmingPublish(false);
      await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("quizzes.publishFailed"));
    } finally {
      setPublishing(false);
    }
  }

  async function shareChallengeLink() {
    setError(null);
    try {
      await Share.share({ message: await publicContentUrl(`/play/${current.voteCode}`) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("quizzes.publicLinkFailed"));
    }
  }

  const frozen = current.voteCode !== null;
  const dirty = !frozen && JSON.stringify(data) !== JSON.stringify(current.data);
  const discardDialog = useUnsavedChangesGuard(dirty);
  const lockEdits = publishing;
  const actionGroups: ActionItem[][] = frozen
    ? [
      [{ label: t("quizzes.shareChallengeLink"), icon: "share", onPress: () => void shareChallengeLink() }],
      [{ label: current.playOpen ? t("quizzes.closeForPlay") : t("quizzes.openForPlay"), icon: current.playOpen ? "lock" : "public", onPress: () => void run(() => setPlayState(current.id, !current.playOpen)) }],
    ]
    : [[{ label: t("quizzes.publish"), icon: "public", onPress: () => setConfirmingPublish(true) }]];

  return <Screen top={false}>
    {discardDialog}
    <Stack.Screen options={{
      headerShown: true,
      title: "",
      headerLargeTitleEnabled: false,
      headerRight: () => <HeaderActions>
        {!frozen ? <SaveStateButton busy={busy || publishing} unsaved={dirty} onPress={() => void run(() => updateQuiz(current.id, { data: dataRef.current }))} /> : null}
        <ActionSheet title={current.name} groups={actionGroups}>{(open) => <IconButton accessibilityLabel={t("quizzes.quizActions")} name="more" onPress={open} />}</ActionSheet>
      </HeaderActions>,
    }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {!frozen ? <FormScroll contentContainerStyle={styles.screen}>
      <EditorHeading name={current.name} />
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.bookCountStatus", { count: data.books.length, status: publishing ? t("quizzes.publishing") : busy ? t("shell.saving") : dirty ? t("tierlists.stateUnsaved") : t("shell.saved") })}</Text>
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.questions")}</Text>
      <View style={styles.lengths}>
        {[4, 5, 10, 15, 20].filter((count) => count <= data.books.length).map((count) => (
          <Pressable key={count} accessibilityRole="radio" accessibilityState={{ selected: data.questionCount === count, disabled: lockEdits }} disabled={lockEdits} onPress={() => setData((value) => ({ ...value, questionCount: count }))} style={[styles.length, { borderColor: data.questionCount === count ? colors.accent : colors.border, backgroundColor: data.questionCount === count ? colors.accentSoft : colors.surface }]}>
            <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{count}</Text>
          </Pressable>
        ))}
      </View>
      {QUIZ_QUESTION_TYPES.map((type) => {
        const offered = data.books.some((book) => eligibleTypes({ ...book, characters: characters[book.workId] ?? book.characters }).includes(type));
        const checked = offered && data.allowedTypes.includes(type);
        return <Pressable key={type} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !offered || lockEdits }} disabled={!offered || lockEdits} onPress={() => setData((value) => ({ ...value, allowedTypes: checked ? value.allowedTypes.filter((entry) => entry !== type) : [...value.allowedTypes, type] }))} style={[styles.row, offered ? null : styles.offered, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{quizTypeLabel(type, locale)}</Text>
          {!offered ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.noBookHasData")}</Text> : <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : ""}</Text>}
        </Pressable>;
      })}
      {charactersFailed ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.charactersUnchecked")}</Text> : null}
      {data.books.map((book) => <View key={book.workId} style={[styles.book, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{book.title}</Text>
        <Input label={t("quizzes.quoteOptional")} value={book.quote ?? ""} editable={!lockEdits} onChangeText={(quote) => setData((value) => ({ ...value, books: value.books.map((entry) => entry.workId === book.workId ? { ...entry, quote } : entry) }))} placeholder={t("quizzes.quotePlaceholder")} multiline />
        <Input label={t("quizzes.blurbOptional")} value={book.blurb ?? ""} editable={!lockEdits} onChangeText={(blurb) => setData((value) => ({ ...value, books: value.books.map((entry) => entry.workId === book.workId ? { ...entry, blurb } : entry) }))} multiline />
      </View>)}
      <Button label={t("quizzes.publishQuiz")} loading={publishing} disabled={data.books.length < 4 || busy} onPress={() => setConfirmingPublish(true)} />
      {data.books.length < 4 ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.needsFourBooks")}</Text> : null}
    </FormScroll> : frozen ? results.isPending ? <Skeleton height={180} /> : <View style={styles.grow}><View style={styles.frozenHeading}><EditorHeading name={current.name} /></View><SwipeableTabs accessibilityLabel={t("quizzes.editorView")} options={PUBLISHED_VIEWS.map(({ value, label }) => ({ value, label: t(label) }))} value={view} onChange={setView} renderPage={(page) => page === "results" ? results.isError ? <ErrorState body={t("quizzes.resultsLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void results.refetch()} /> : <ScrollView contentContainerStyle={styles.screen}>
      {(results.data?.plays ?? []).map((play, i) => <View key={`${play.playerName ?? "Guest"}-${i}`} style={[styles.leaderRow, { borderColor: colors.border }]}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{i + 1}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{playerLabel(play, locale).name}</Text>
        {playerLabel(play, locale).guest ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.guestLower")}</Text> : null}
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{play.score}/{results.data!.questionCount}</Text>
      </View>)}
      {(results.data?.stats ?? []).map((stat) => { const index = (current.data.questions ?? []).findIndex((item) => item.id === stat.questionId); const asked = current.data.questions?.[index]; return <View key={stat.questionId} style={styles.stat}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.statLine", { label: asked ? quizQuestionLabel(asked, index, current.data.books, locale) : stat.questionId, correct: stat.correctCount, total: stat.answerCount })}</Text>
        {stat.picks.map((pick) => <View key={pick.choiceIndex} style={styles.pick}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.pickLabel, { color: colors.textDim }]}>{asked ? quizOptionLabel(asked.type, asked.options[pick.choiceIndex], current.data.books, locale) : `#${pick.choiceIndex + 1}`}</Text>
          <View style={[styles.pickTrack, { backgroundColor: colors.border }]}><View style={[styles.pickFill, { backgroundColor: colors.accent, width: `${Math.round((pick.count / stat.answerCount) * 100)}%` }]} /></View>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{pick.count}</Text>
        </View>)}
      </View>; })}
    </ScrollView> : <ScrollView contentContainerStyle={styles.screen}>
      {(current.data.questions ?? []).map((question, index) => <View key={question.id} style={[styles.row, { borderColor: colors.border }]}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.numberedLabel", { number: index + 1, label: quizTypeLabel(question.type, locale) })}</Text>
        {question.type === "title_cover"
          ? <Image source={{ uri: uriFor(String(question.options[question.answerIndex])) }} contentFit="contain" style={styles.answerThumb} alt={t("quizzes.answerCover")} />
          : <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{String(question.options[question.answerIndex])}</Text>}
      </View>)}
    </ScrollView>} /></View> : null}
    <Dialog visible={confirmingPublish} title={t("quizzes.publishQuiz")} onClose={() => setConfirmingPublish(false)}>
      <View style={styles.dialog}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.publishWarning")}</Text>
        <Button label={t("quizzes.publish")} loading={publishing} onPress={() => void publish()} />
      </View>
    </Dialog>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  lengths: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  length: { minWidth: 56, minHeight: minimumTouchTarget, justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: radii.md, alignItems: "center" },
  row: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  offered: { opacity: 0.5 },
  grow: { flex: 1 },
  frozenHeading: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  book: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  section: { gap: spacing.sm },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  stat: { gap: spacing.xs },
  pick: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pickLabel: { width: 120 },
  pickTrack: { flex: 1, height: 4, borderRadius: radii.full },
  pickFill: { height: 4, borderRadius: radii.full },
  answerThumb: { width: 44, height: 66, borderRadius: radii.sm },
  dialog: { gap: spacing.md },
  strong: { fontWeight: "700" },
});
