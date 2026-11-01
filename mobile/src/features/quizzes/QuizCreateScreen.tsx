import { useEffect, useMemo, useRef, useState } from "react";
import { Stack, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { QUIZ_POOL, QUIZ_QUESTION_TYPES, bookKey, booksByWork, booksInGroup, eligibleTypes, normalizeImageId, normalizeIsbn, workIdOf, type QuizBookInput, type QuizDataInput, type QuizQuestionType } from "@scripta/shared";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useLibrary, useWorkBooks } from "../library";
import { Button, Input, Screen, Segmented, Toast, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { resolveCover } from "../library/api/covers";
import { createQuiz, type Quiz } from "./api";
import { quizTypeLabel } from "./quizTypeLabel";
import { useWorkCharacters } from "./useWorkCharacters";
import { useLocale, useT } from "../../i18n";

const SOURCES = [{ value: "shelf", label: "quizzes.sourceShelf" }, { value: "collection", label: "shell.collection" }, { value: "pool", label: "quizzes.sourceFamous" }] as const;
type Source = (typeof SOURCES)[number]["value"];

function toQuizBook(book: Record<string, unknown>, resolvedCover: string | null | undefined, untitled: string): QuizBookInput {
  return {
    workId: workIdOf(book),
    title: String(book.Title ?? untitled),
    author: String(book.Attribution ?? ""),
    coverUrl: typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : resolvedCover ?? null,
    quote: null,
    blurb: null,
  };
}

const LENGTHS = [4, 5, 10, 15, 20];

export function QuizCreateScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>("shelf");
  const [collectionId, setCollectionId] = useState("");
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [allowedTypes, setAllowedTypes] = useState<QuizQuestionType[]>([...QUIZ_QUESTION_TYPES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const library = useLibrary();
  const libraryBooks = useWorkBooks(library.data);
  const collections = (library.data?.data?.groups ?? []).filter((group) => group.type === "collection");
  const collection = collections.find((group) => group.id === collectionId);

  const shelfRawBooks = useMemo(
    () => [...booksByWork(source === "collection" ? (collection ? booksInGroup(collection, libraryBooks) : []) : source === "shelf" ? libraryBooks : []).values()],
    [source, collection, libraryBooks],
  );

  // Same resolve-as-you-go pass the web create page does: ordinary library
  // books carry no _coverUrl, so cover-question availability is only honest
  // once each book's cached cover resolved. A failed request is skipped,
  // not fatal — the pass keeps going and a retry re-runs only the gaps.
  const resolvedRef = useRef<Record<string, string | null>>({});
  const [resolvedCovers, setResolvedCovers] = useState<Record<string, string | null>>({});
  const [resolveFailed, setResolveFailed] = useState(false);
  const [resolveAttempt, setResolveAttempt] = useState(0);
  useEffect(() => {
    if (source === "pool") return;
    let cancelled = false;
    void (async () => {
      let failed = false;
      for (const raw of shelfRawBooks) {
        const key = bookKey(raw);
        if (resolvedRef.current[key] !== undefined) continue;
        if (typeof raw._coverUrl === "string" && raw._coverUrl) { resolvedRef.current[key] = raw._coverUrl; continue; }
        let url: string | null;
        try {
          url = await resolveCover({
            isbn: normalizeIsbn(raw.ISBN) || undefined,
            imageId: normalizeImageId(raw.ImageId) || undefined,
            title: String(raw.Title ?? "").trim() || undefined,
            author: raw.Attribution ? String(raw.Attribution) : undefined,
          }, { poll: false });
        } catch {
          // Leave the book unresolved so a retry re-attempts it, and let
          // the pass finish for the rest of the shelf.
          failed = true;
          if (cancelled) return;
          continue;
        }
        if (cancelled) return;
        resolvedRef.current[key] = url ?? null;
        setResolvedCovers({ ...resolvedRef.current });
      }
      if (!cancelled) setResolveFailed(failed);
    })();
    return () => { cancelled = true; };
  }, [shelfRawBooks, source, resolveAttempt]);

  const books: QuizBookInput[] = source === "pool"
    ? QUIZ_POOL.filter((book) => poolIds.includes(book.id)).map(({ id: _id, ...book }) => book)
    : shelfRawBooks.map((raw) => toQuizBook(raw, resolvedCovers[bookKey(raw)], t("library.untitled")));

  const { characters, failed: charactersFailed } = useWorkCharacters(books.flatMap((book) => (book.workId ? [book.workId] : [])));
  const offeredBooks = books.map((book) => {
    const found = book.workId ? characters[book.workId] : undefined;
    return found ? { ...book, characters: found } : book;
  });
  const availableTypes = QUIZ_QUESTION_TYPES.filter((type) => offeredBooks.some((book) => eligibleTypes(book).includes(type)));
  const effectiveTypes = allowedTypes.filter((type) => availableTypes.includes(type));
  const lengthOptions = LENGTHS.filter((count) => count <= books.length);
  const effectiveCount = lengthOptions.includes(questionCount) ? questionCount : (lengthOptions[lengthOptions.length - 1] ?? 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const data: QuizDataInput = {
        sourceLabel: source === "pool" ? t("quizzes.famousBooks") : source === "collection" ? collection?.name ?? t("shell.collection") : t("quizzes.myShelf"),
        questionCount: effectiveCount,
        allowedTypes: effectiveTypes.length > 0 ? effectiveTypes : availableTypes,
        books,
        questions: null,
      };
      const created = await createQuiz(name.trim() || t("quizzes.untitledQuiz"), data);
      queryClient.setQueryData<Quiz[]>(["quizzes"], (items = []) => [created, ...items]);
      router.replace(`/quiz/${created.id}` as never);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("quizzes.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <Screen top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: t("arena.createQuiz") }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.createStep", { step: step + 1 })}</Text>
    <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{step === 0 ? t("quizzes.chooseBooks") : t("quizzes.setUpQuestions")}</Text>
    {step === 0 ? <>
      <Input label={t("quizzes.quizName")} value={name} onChangeText={setName} placeholder={t("quizzes.untitledQuiz")} maxLength={200} />
      <Segmented accessibilityLabel={t("quizzes.questionSource")} options={SOURCES.map(({ value, label }) => ({ value, label: t(label) }))} value={source} onChange={setSource} />
      {source === "collection" ? <View style={styles.collections}>
        {collections.map((group) => (
          <Pressable key={group.id} accessibilityRole="radio" accessibilityState={{ selected: collectionId === group.id }} onPress={() => setCollectionId(group.id)} style={[styles.row, { borderColor: collectionId === group.id ? colors.accent : colors.border, backgroundColor: collectionId === group.id ? colors.accentSoft : colors.surface }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{group.name}</Text>
          </Pressable>
        ))}
        {collections.length === 0 ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.noCollections")}</Text> : null}
      </View> : null}
      {source === "pool" ? <FlatList
        data={QUIZ_POOL}
        keyExtractor={(book) => book.id}
        style={styles.list}
        ListEmptyComponent={<Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.noBooksFound")}</Text>}
        renderItem={({ item }) => {
          const checked = poolIds.includes(item.id);
          return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setPoolIds((value) => checked ? value.filter((entry) => entry !== item.id) : [...value, item.id])} style={[styles.row, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{item.title}</Text>
            <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : "+"}</Text>
          </Pressable>;
        }}
      /> : null}
      {source === "shelf" ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
        {library.isPending ? t("quizzes.loadingBooks") : library.isError ? t("quizzes.libraryLoadFailed") : t("quizzes.booksInLibrary", { count: shelfRawBooks.length })}
      </Text> : null}
      {resolveFailed && source !== "pool" ? <View style={styles.resolveRetry}>
        <Text {...dynamicType} style={[typography.caption, styles.grow, { color: colors.textDim }]}>{t("quizzes.coversUnchecked")}</Text>
        <Button label={t("shell.retry")} variant="secondary" onPress={() => { setResolveFailed(false); setResolveAttempt((value) => value + 1); }} />
      </View> : null}
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.booksSelected", { count: books.length })}</Text>
    </> : <ScrollView contentContainerStyle={styles.stepScroll} keyboardShouldPersistTaps="handled">
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.questions")}</Text>
      <View style={styles.lengths}>
        {lengthOptions.map((count) => (
          <Pressable key={count} accessibilityRole="radio" accessibilityState={{ selected: effectiveCount === count }} onPress={() => setQuestionCount(count)} style={[styles.length, { borderColor: effectiveCount === count ? colors.accent : colors.border, backgroundColor: effectiveCount === count ? colors.accentSoft : colors.surface }]}>
            <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{count}</Text>
          </Pressable>
        ))}
      </View>
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("quizzes.questionTypes")}</Text>
      {charactersFailed ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.charactersUnchecked")}</Text> : null}
      {QUIZ_QUESTION_TYPES.map((type) => {
        const offered = availableTypes.includes(type);
        const checked = offered && effectiveTypes.includes(type);
        return <Pressable key={type} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !offered }} disabled={!offered} onPress={() => setAllowedTypes((value) => value.includes(type) ? value.filter((entry) => entry !== type) : [...value, type])} style={[styles.row, offered ? null : styles.offered, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{quizTypeLabel(type, locale)}</Text>
          {!offered ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("quizzes.noBookHasData")}</Text> : <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : ""}</Text>}
        </Pressable>;
      })}
    </ScrollView>}
    <View style={styles.actions}>
      {step > 0 ? <Button label={t("shell.back")} variant="secondary" onPress={() => setStep((value) => value - 1)} /> : null}
      {step < 1 ? <Button label={t("tierlists.next")} disabled={books.length < 4 || (source === "collection" && !collection)} onPress={() => setStep(1)} /> : <Button label={t("arena.createQuiz")} loading={busy} disabled={effectiveTypes.length === 0 || effectiveCount === 0} onPress={() => void create()} />}
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  list: { flexGrow: 0, maxHeight: 380 },
  collections: { gap: spacing.xs },
  row: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  offered: { opacity: 0.5 },
  lengths: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  length: { minWidth: 56, minHeight: minimumTouchTarget, justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: radii.md, alignItems: "center" },
  stepScroll: { gap: spacing.md, paddingBottom: spacing.lg },
  resolveRetry: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  strong: { fontWeight: "700" },
});
