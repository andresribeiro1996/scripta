import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import { Image } from "expo-image";
import { QUIZ_QUESTION_TYPES, eligibleTypes, type QuizData, type QuizQuestionType } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { API_URL } from "../../core/config";
import { Button, Dialog, ErrorState, FormScroll, IconButton, Input, Menu, type MenuItem, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { coverUrlForApi } from "../library/lib/coverUrl";
import { publicContentUrl } from "../sharing/links";
import { fetchQuizResults, publishQuiz, setPlayState, updateQuiz, type Quiz } from "./api";

type EditorView = "setup" | "results";

const PUBLISHED_VIEWS = [{ value: "setup", label: "Questions" }, { value: "results", label: "Results" }] as const;

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Blurred cover → title",
  title_cover: "Title → cover",
  quote_title: "Quote → title",
  blurb_title: "Blurb → title",
};

const uriFor = (url: string): string => coverUrlForApi(url, API_URL);

export function QuizEditorScreen({ quiz, onUpdated }: { quiz: Quiz; onUpdated: (quiz: Quiz) => void }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(quiz);
  const [data, setData] = useState<QuizData>(quiz.data);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [view, setView] = useState<EditorView>("setup");
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
      setError(reason instanceof Error ? reason.message : "Couldn't save changes.");
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
      setError(reason instanceof Error ? reason.message : "Couldn't publish.");
    } finally {
      setPublishing(false);
    }
  }

  async function shareChallengeLink() {
    setError(null);
    try {
      await Share.share({ message: await publicContentUrl(`/play/${current.voteCode}`) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create a public link.");
    }
  }

  const frozen = current.voteCode !== null;
  const dirty = !frozen && JSON.stringify(data) !== JSON.stringify(current.data);
  const lockEdits = publishing;
  const actionItems: MenuItem[] = frozen
    ? [
      { label: "Share challenge link", onPress: () => void shareChallengeLink() },
      { label: current.playOpen ? "Close for play" : "Open for play", onPress: () => void run(() => setPlayState(current.id, !current.playOpen)) },
    ]
    : [{ label: "Publish…", onPress: () => setConfirmingPublish(true) }];

  return <Screen top={false}>
    <Stack.Screen options={{
      headerShown: true,
      title: current.name,
      headerRight: () => <Menu title={current.name} items={actionItems}><IconButton framed accessibilityLabel="Quiz actions" name="more" /></Menu>,
    }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {!frozen ? <FormScroll contentContainerStyle={styles.screen}>
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{data.books.length} books · {publishing ? "Publishing…" : busy ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</Text>
      <Button label="Save changes" disabled={!dirty || publishing} loading={busy} onPress={() => void run(() => updateQuiz(current.id, { data: dataRef.current }))} />
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Questions</Text>
      <View style={styles.lengths}>
        {[4, 5, 10, 15, 20].filter((count) => count <= data.books.length).map((count) => (
          <Pressable key={count} accessibilityRole="radio" accessibilityState={{ selected: data.questionCount === count, disabled: lockEdits }} disabled={lockEdits} onPress={() => setData((value) => ({ ...value, questionCount: count }))} style={[styles.length, { borderColor: data.questionCount === count ? colors.accent : colors.border, backgroundColor: data.questionCount === count ? colors.accentSoft : colors.surface }]}>
            <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{count}</Text>
          </Pressable>
        ))}
      </View>
      {QUIZ_QUESTION_TYPES.map((type) => {
        const offered = data.books.some((book) => eligibleTypes(book).includes(type));
        const checked = offered && data.allowedTypes.includes(type);
        return <Pressable key={type} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !offered || lockEdits }} disabled={!offered || lockEdits} onPress={() => setData((value) => ({ ...value, allowedTypes: checked ? value.allowedTypes.filter((entry) => entry !== type) : [...value.allowedTypes, type] }))} style={[styles.row, offered ? null : styles.offered, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{TYPE_LABELS[type]}</Text>
          {!offered ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>no book has this data</Text> : <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : ""}</Text>}
        </Pressable>;
      })}
      {data.books.map((book) => <View key={book.key} style={[styles.book, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{book.title}</Text>
        <Input label="Quote (optional)" value={book.quote ?? ""} editable={!lockEdits} onChangeText={(quote) => setData((value) => ({ ...value, books: value.books.map((entry) => entry.key === book.key ? { ...entry, quote } : entry) }))} placeholder="Paste a line from this book…" multiline />
        <Input label="Blurb (optional)" value={book.blurb ?? ""} editable={!lockEdits} onChangeText={(blurb) => setData((value) => ({ ...value, books: value.books.map((entry) => entry.key === book.key ? { ...entry, blurb } : entry) }))} multiline />
      </View>)}
      <Button label="Publish quiz" loading={publishing} disabled={data.books.length < 4 || busy} onPress={() => setConfirmingPublish(true)} />
      {data.books.length < 4 ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>A quiz needs at least 4 books.</Text> : null}
    </FormScroll> : frozen ? results.isPending ? <Skeleton height={180} /> : <SwipeableTabs accessibilityLabel="Quiz editor view" options={PUBLISHED_VIEWS} value={view} onChange={setView} renderPage={(page) => page === "results" ? results.isError ? <ErrorState body="Couldn't load results." actionLabel="Retry" onAction={() => void results.refetch()} /> : <ScrollView contentContainerStyle={styles.screen}>
      {(results.data?.plays ?? []).map((play, i) => <View key={`${play.playerName ?? "Guest"}-${i}`} style={[styles.leaderRow, { borderColor: colors.border }]}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{i + 1}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{play.playerName ?? "Guest"}</Text>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{play.score}/{results.data!.questionCount}</Text>
      </View>)}
      {(results.data?.stats ?? []).map((stat) => <View key={stat.questionId} style={styles.stat}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{stat.questionId} · {stat.correctCount}/{stat.answerCount} correct</Text>
        {stat.picks.map((pick) => <View key={pick.choiceIndex} style={styles.pick}>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>#{pick.choiceIndex + 1}</Text>
          <View style={[styles.pickTrack, { backgroundColor: colors.border }]}><View style={[styles.pickFill, { backgroundColor: colors.accent, width: `${Math.round((pick.count / stat.answerCount) * 100)}%` }]} /></View>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{pick.count}</Text>
        </View>)}
      </View>)}
    </ScrollView> : <ScrollView contentContainerStyle={styles.screen}>
      {(current.data.questions ?? []).map((question, index) => <View key={question.id} style={[styles.row, { borderColor: colors.border }]}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{index + 1}. {TYPE_LABELS[question.type]}</Text>
        {question.type === "title_cover"
          ? <Image source={{ uri: uriFor(String(question.options[question.answerIndex])) }} contentFit="contain" style={styles.answerThumb} alt="Answer cover" />
          : <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{String(question.options[question.answerIndex])}</Text>}
      </View>)}
    </ScrollView>} /> : null}
    <Dialog visible={confirmingPublish} title="Publish quiz" onClose={() => setConfirmingPublish(false)}>
      <View style={styles.dialog}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Publishing mints the challenge link and locks the books, quotes, and questions. This can't be undone.</Text>
        <Button label="Publish" loading={publishing} onPress={() => void publish()} />
      </View>
    </Dialog>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  lengths: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  length: { minWidth: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: radii.md, alignItems: "center" },
  row: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  offered: { opacity: 0.5 },
  grow: { flex: 1 },
  book: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  section: { gap: spacing.sm },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  stat: { gap: spacing.xs },
  pick: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pickTrack: { flex: 1, height: 4, borderRadius: radii.full },
  pickFill: { height: 4, borderRadius: radii.full },
  answerThumb: { width: 44, height: 66, borderRadius: radii.sm },
  dialog: { gap: spacing.md },
  strong: { fontWeight: "700" },
});
