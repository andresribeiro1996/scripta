import { useEffect, useMemo, useRef, useState } from "react";
import { Stack, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { QUIZ_POOL, QUIZ_QUESTION_TYPES, bookKey, booksByWork, booksInGroup, eligibleTypes, normalizeImageId, normalizeIsbn, workIdOf, type QuizBookInput, type QuizDataInput, type QuizQuestionType } from "@scripta/shared";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useLibrary, useWorkBooks } from "../library";
import { Button, Input, Screen, Segmented, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { resolveCover } from "../library/api/covers";
import { createQuiz, type Quiz } from "./api";

const SOURCES = [{ value: "shelf", label: "Shelf" }, { value: "collection", label: "Collection" }, { value: "pool", label: "Famous" }] as const;
type Source = (typeof SOURCES)[number]["value"];

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Blurred cover → title",
  title_cover: "Title → cover",
  quote_title: "Quote → title",
  blurb_title: "Blurb → title",
};

function toQuizBook(book: Record<string, unknown>, resolvedCover: string | null | undefined): QuizBookInput {
  return {
    workId: workIdOf(book),
    title: String(book.Title ?? "Untitled"),
    author: String(book.Attribution ?? ""),
    coverUrl: typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : resolvedCover ?? null,
    quote: null,
    blurb: null,
  };
}

const LENGTHS = [4, 5, 10, 15, 20];

export function QuizCreateScreen() {
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
    : shelfRawBooks.map((raw) => toQuizBook(raw, resolvedCovers[bookKey(raw)]));

  const availableTypes = QUIZ_QUESTION_TYPES.filter((type) => books.some((book) => eligibleTypes(book).includes(type)));
  const effectiveTypes = allowedTypes.filter((type) => availableTypes.includes(type));
  const lengthOptions = LENGTHS.filter((count) => count <= books.length);
  const effectiveCount = lengthOptions.includes(questionCount) ? questionCount : (lengthOptions[lengthOptions.length - 1] ?? 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const data: QuizDataInput = {
        sourceLabel: source === "pool" ? "Famous books" : source === "collection" ? collection?.name ?? "Collection" : "My shelf",
        questionCount: effectiveCount,
        allowedTypes: effectiveTypes.length > 0 ? effectiveTypes : availableTypes,
        books,
        questions: null,
      };
      const created = await createQuiz(name.trim() || "Untitled quiz", data);
      queryClient.setQueryData<Quiz[]>(["quizzes"], (items = []) => [created, ...items]);
      router.replace(`/quiz/${created.id}` as never);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create the quiz.");
    } finally {
      setBusy(false);
    }
  }

  return <Screen top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: "Create quiz" }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Step {step + 1} of 2</Text>
    <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{["Choose books", "Set up questions"][step]}</Text>
    {step === 0 ? <>
      <Input label="Quiz name" value={name} onChangeText={setName} placeholder="Untitled quiz" maxLength={200} />
      <Segmented accessibilityLabel="Question source" options={SOURCES} value={source} onChange={setSource} />
      {source === "collection" ? <View style={styles.collections}>
        {collections.map((group) => (
          <Pressable key={group.id} accessibilityRole="radio" accessibilityState={{ selected: collectionId === group.id }} onPress={() => setCollectionId(group.id)} style={[styles.row, { borderColor: collectionId === group.id ? colors.accent : colors.border, backgroundColor: collectionId === group.id ? colors.accentSoft : colors.surface }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{group.name}</Text>
          </Pressable>
        ))}
        {collections.length === 0 ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No collections yet.</Text> : null}
      </View> : null}
      {source === "pool" ? <FlatList
        data={QUIZ_POOL}
        keyExtractor={(book) => book.id}
        style={styles.list}
        ListEmptyComponent={<Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No books found.</Text>}
        renderItem={({ item }) => {
          const checked = poolIds.includes(item.id);
          return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setPoolIds((value) => checked ? value.filter((entry) => entry !== item.id) : [...value, item.id])} style={[styles.row, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{item.title}</Text>
            <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : "+"}</Text>
          </Pressable>;
        }}
      /> : null}
      {source === "shelf" ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
        {library.isPending ? "Loading books…" : library.isError ? "Your library couldn't be loaded." : `${shelfRawBooks.length} books on your shelf.`}
      </Text> : null}
      {resolveFailed && source !== "pool" ? <View style={styles.resolveRetry}>
        <Text {...dynamicType} style={[typography.caption, styles.grow, { color: colors.textDim }]}>Some covers couldn't be checked, so cover questions may be unavailable.</Text>
        <Button label="Retry" variant="secondary" onPress={() => { setResolveFailed(false); setResolveAttempt((value) => value + 1); }} />
      </View> : null}
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{books.length} {books.length === 1 ? "book" : "books"} selected</Text>
    </> : <ScrollView contentContainerStyle={styles.stepScroll} keyboardShouldPersistTaps="handled">
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Questions</Text>
      <View style={styles.lengths}>
        {lengthOptions.map((count) => (
          <Pressable key={count} accessibilityRole="radio" accessibilityState={{ selected: effectiveCount === count }} onPress={() => setQuestionCount(count)} style={[styles.length, { borderColor: effectiveCount === count ? colors.accent : colors.border, backgroundColor: effectiveCount === count ? colors.accentSoft : colors.surface }]}>
            <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{count}</Text>
          </Pressable>
        ))}
      </View>
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Question types</Text>
      {QUIZ_QUESTION_TYPES.map((type) => {
        const offered = availableTypes.includes(type);
        const checked = offered && effectiveTypes.includes(type);
        return <Pressable key={type} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !offered }} disabled={!offered} onPress={() => setAllowedTypes((value) => value.includes(type) ? value.filter((entry) => entry !== type) : [...value, type])} style={[styles.row, offered ? null : styles.offered, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{TYPE_LABELS[type]}</Text>
          {!offered ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>no book has this data</Text> : <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : ""}</Text>}
        </Pressable>;
      })}
    </ScrollView>}
    <View style={styles.actions}>
      {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep((value) => value - 1)} /> : null}
      {step < 1 ? <Button label="Next" disabled={books.length < 4 || (source === "collection" && !collection)} onPress={() => setStep(1)} /> : <Button label="Create quiz" loading={busy} disabled={effectiveTypes.length === 0 || effectiveCount === 0} onPress={() => void create()} />}
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
  length: { minWidth: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: radii.md, alignItems: "center" },
  stepScroll: { gap: spacing.md, paddingBottom: spacing.lg },
  resolveRetry: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  strong: { fontWeight: "700" },
});
