# Native Mobile Quizzes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the cover quiz natively in the Expo app at full parity — public play, create wizard, owner editor with results — mirroring the existing tier-list screens pattern-for-pattern.

**Architecture:** One new feature module `mobile/src/features/quizzes/` (api wrapper + pure play logic + three screens), four thin expo-router route files, an intentFilter for `/play/` deep links, and a third tab in `ArenaHomeScreen` via the existing `arenaHome.ts` helpers. No backend changes; `@scripta/shared/quizzes` is consumed as-is.

**Tech Stack:** Expo Router (typed routes), react-query, `apiClient` from `core/api`, AsyncStorage for anonymous play ids, `node:test` via tsx for pure logic, reanimated only where a template already used it (none needed here).

**Spec:** `docs/superpowers/specs/2026-09-27-quiz-mobile-design.md`

## Global Constraints

- Rebuild shared before mobile checks: `npm run build --workspace @scripta/shared` (mobile reads `dist/`).
- No `eas build`/`eas submit`/`eas update`/`expo prebuild --clean`; no new native dependencies (nothing here needs one — blur uses expo-image's `blurRadius`).
- Typed routes: dynamic hrefs are cast `as never`, matching every existing call site.
- Screen components get NO tests; decision logic lives in sibling `*.ts` modules (mobile convention — `npm test` globs `src/**/*.test.ts` automatically).
- Colors/spacing/radii come from `useTheme()`/`ui` tokens only; mirror the referenced template screens' structure.
- Do not touch `eas`/native config beyond the one app.json intentFilter.
- Verify commands: `npm run typecheck --workspace mobile`, `npm test --workspace mobile`, `cd mobile && npx expo-doctor`.

## File Structure

```
mobile/src/features/quizzes/
  api.ts                 typed wrappers over every /quizzes route
  quizPlay.ts            pure play logic (storage key, submission, stage)
  quizPlay.test.ts       (Task 1)
  QuizPlayScreen.tsx     public play + end screen (Task 2)
  QuizCreateScreen.tsx   two-step create wizard (Task 3)
  QuizEditorScreen.tsx   owner editor: setup, questions, results (Task 4)
mobile/src/app/
  play/[code].tsx                              (Task 2)
  (app)/(arena)/quiz/new.tsx                   (Task 3)
  (app)/(arena)/quiz/[id].tsx                  (Task 4)
mobile/src/features/arena/
  arenaHome.ts (+ arenaHome.test.ts)           (Task 5)
  ArenaHomeScreen.tsx                          (Task 5)
mobile/app.json                                (Task 2)
mobile/README.md                               (Task 6)
```

---

### Task 1: `features/quizzes` API module + pure play logic

**Files:**
- Create: `mobile/src/features/quizzes/api.ts`
- Create: `mobile/src/features/quizzes/quizPlay.ts`
- Create: `mobile/src/features/quizzes/quizPlay.test.ts`

**Interfaces:**
- Consumes: `apiClient` from `core/api`; shared `PublicQuizQuestion`, `QuizData`, `QuestionStat`, `ResultPlay`.
- Produces: `Quiz`, `PlayBoard`, `PlayResponse`, `PublicResultPlay`, `SubmissionBody` types and the eleven fetch/mutate functions; `playStorageKey`, `buildSubmission`, `isComplete`, `playStage` + `PlayStage` — consumed by Tasks 2–4.

- [ ] **Step 1: Write `api.ts`**

```ts
import type { PublicQuizQuestion, QuestionStat, QuizData, ResultPlay } from "@scripta/shared";
import { apiClient } from "../../core/api";

export interface Quiz {
  id: string;
  name: string;
  data: QuizData;
  voteCode: string | null;
  playOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlayBoard {
  name: string;
  sourceLabel: string;
  questionCount: number;
  playOpen: boolean;
  playCount: number;
  questions: PublicQuizQuestion[];
}

export interface PlayResponse {
  playId: string;
  score: number;
  correct: Record<string, boolean>;
}

/** Leaderboard rows are public: the backend strips playId (it's an
 *  anonymous player's only recovery handle). */
export type PublicResultPlay = Omit<ResultPlay, "playId">;

export interface SubmissionBody {
  answers: Array<{ questionId: string; choiceIndex: number }>;
  durationMs: number;
  playerName?: string;
}

export async function fetchQuizzes() {
  return (await apiClient.request<{ quizzes: Quiz[] }>("/quizzes", { auth: true })).quizzes;
}

export function fetchQuiz(id: string) {
  return apiClient.request<Quiz>(`/quizzes/${id}`, { auth: true });
}

export function createQuiz(name: string, data: QuizData) {
  return apiClient.request<Quiz>("/quizzes", { method: "POST", body: { name, data }, auth: true });
}

export function updateQuiz(id: string, patch: { name?: string; data?: QuizData }) {
  return apiClient.request<Quiz>(`/quizzes/${id}`, { method: "PUT", body: patch, auth: true });
}

export function deleteQuiz(id: string) {
  return apiClient.request(`/quizzes/${id}`, { method: "DELETE", auth: true });
}

export function publishQuiz(id: string) {
  return apiClient.request<{ quiz: Quiz; voteCode: string }>(`/quizzes/${id}/publish`, { method: "POST", body: {}, auth: true });
}

export async function setPlayState(id: string, open: boolean) {
  return (await apiClient.request<{ quiz: Quiz }>(`/quizzes/${id}/voting`, { method: "PUT", body: { open }, auth: true })).quiz;
}

export function fetchQuizResults(id: string) {
  return apiClient.request<{ plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number }>(`/quizzes/${id}/results`, { auth: true });
}

export function fetchPlayBoard(code: string) {
  return apiClient.request<{ board: PlayBoard }>(`/quizzes/voting/${encodeURIComponent(code)}`);
}

export function submitPlay(code: string, body: SubmissionBody, authenticated: boolean) {
  return apiClient.request<PlayResponse>(`/quizzes/voting/${encodeURIComponent(code)}/play`, { method: "POST", body, auth: authenticated });
}

export function fetchPlay(code: string, playId: string | null, authenticated: boolean) {
  const suffix = playId ? `/${encodeURIComponent(playId)}` : "";
  return apiClient.request<PlayResponse>(`/quizzes/voting/${encodeURIComponent(code)}/play${suffix}`, { auth: authenticated });
}

export function fetchPublicResults(code: string) {
  return apiClient.request<{ plays: PublicResultPlay[]; questionCount: number }>(`/quizzes/voting/${encodeURIComponent(code)}/results`);
}
```

- [ ] **Step 2: Write the failing `quizPlay.test.ts`**

```ts
/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicQuizQuestion } from "@scripta/shared";
import { buildSubmission, isComplete, nextIndex, playStage, playStorageKey } from "./quizPlay.js";

const question = (id: string): PublicQuizQuestion => ({ id, type: "cover_title", prompt: "https://covers.test/x.jpg", options: ["A", "B", "C", "D"] });
const questions = [question("q0"), question("q1"), question("q2")];

test("the storage key namespaces the play id per quiz code", () => {
  assert.equal(playStorageKey("abc123"), "quiz-play:abc123");
});

test("buildSubmission answers in question order and defaults gaps to option 0", () => {
  assert.deepEqual(buildSubmission(questions, { q1: 2 }), [
    { questionId: "q0", choiceIndex: 0 },
    { questionId: "q1", choiceIndex: 2 },
    { questionId: "q2", choiceIndex: 0 },
  ]);
});

test("isComplete requires an answer for every question", () => {
  assert.equal(isComplete(questions, { q0: 0, q1: 1, q2: 3 }), true);
  assert.equal(isComplete(questions, { q0: 0, q2: 3 }), false);
});

test("nextIndex advances but clamps to the last question", () => {
  assert.equal(nextIndex(questions, 0), 1);
  assert.equal(nextIndex(questions, 2), 2);
});

test("playStage walks loading → closed → playing → played", () => {
  const base = { boardReady: false, boardMissing: false, playOpen: true, resolved: false, alreadyPlayed: false };
  assert.equal(playStage(base), "loading");
  assert.equal(playStage({ ...base, boardReady: true, resolved: true }), "playing");
  assert.equal(playStage({ ...base, boardReady: true, resolved: true, alreadyPlayed: true }), "played");
  assert.equal(playStage({ ...base, boardReady: true, playOpen: false, resolved: true }), "closed");
  assert.equal(playStage({ ...base, boardMissing: true }), "unavailable");
});
```

- [ ] **Step 3: Run to verify it fails**

Run (from `mobile/`): `npm test 2>&1 | tail -5`
Expected: FAIL — `./quizPlay.js` not found.

- [ ] **Step 4: Write `quizPlay.ts`**

```ts
import type { PublicQuizQuestion, SubmittedAnswer } from "@scripta/shared";

export const playStorageKey = (code: string): string => `quiz-play:${code}`;

/** The player's submitted payload: one answer per question, in question
 *  order, defaulting any gap to option 0 (the screen only enables submit
 *  once every question is answered; the default keeps a partial state from
 *  ever producing a malformed body). */
export function buildSubmission(questions: PublicQuizQuestion[], answers: Record<string, number>): Array<SubmittedAnswer> {
  return questions.map((question) => ({ questionId: question.id, choiceIndex: answers[question.id] ?? 0 }));
}

export function isComplete(questions: PublicQuizQuestion[], answers: Record<string, number>): boolean {
  return questions.every((question) => answers[question.id] !== undefined);
}

/** Advance after a pick but clamp to the last question, where the submit
 *  block takes over the footer. */
export function nextIndex(questions: PublicQuizQuestion[], index: number): number {
  return Math.min(index + 1, questions.length - 1);
}

export type PlayStage = "loading" | "unavailable" | "closed" | "played" | "playing";

/** The single decision point the play screen renders from, kept pure. */
export function playStage(input: {
  boardReady: boolean;
  boardMissing: boolean;
  playOpen: boolean;
  resolved: boolean;
  alreadyPlayed: boolean;
}): PlayStage {
  if (input.boardMissing) return "unavailable";
  if (!input.boardReady) return "loading";
  if (!input.playOpen) return "closed";
  if (!input.resolved) return "loading";
  return input.alreadyPlayed ? "played" : "playing";
}
```

- [ ] **Step 5: Run the tests**

Run (from `mobile/`): `npm test 2>&1 | tail -5`
Expected: PASS (all suites, including the 5 new tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile`

```bash
git add mobile/src/features/quizzes
git commit -m "mobile: quizzes api module and pure play logic"
```

### Task 2: `QuizPlayScreen` + public route + deep link

**Files:**
- Create: `mobile/src/features/quizzes/QuizPlayScreen.tsx`
- Create: `mobile/src/app/play/[code].tsx`
- Modify: `mobile/app.json` (one intentFilter entry)

**Interfaces:**
- Consumes: Task 1's api + `quizPlay` helpers; `useAuth` from `core/auth`; ui `Screen/Stack.Screen/Button/ErrorState/Input/Skeleton/SwipeableTabs/Toast`; `expo-image` `Image` (direct URLs — options and prompts always carry resolved URLs, so no resolution chain here; `blurRadius` gives the native blur for cover prompts).
- Produces: nothing downstream.

- [ ] **Step 1: Write `QuizPlayScreen.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PublicQuizQuestion } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Image } from "expo-image";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../core/auth";
import { ApiError } from "../../core/api";
import { Button, ErrorState, Input, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { fetchPlay, fetchPlayBoard, fetchPublicResults, submitPlay, type PlayBoard, type PlayResponse } from "./api";
import { buildSubmission, isComplete, nextIndex, playStage, playStorageKey } from "./quizPlay";

export function QuizPlayScreen({ code }: { code: string }) {
  const { colors } = useTheme();
  const { ready, user } = useAuth();
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined);
  const [ownPlay, setOwnPlay] = useState<PlayResponse | null>(null);
  const [ownPlayMissing, setOwnPlayMissing] = useState(false);
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
  useEffect(() => {
    if (!ready || storedId === undefined) return;
    if (!user && !storedId) { setOwnPlayMissing(true); return; }
    const request = user ? fetchPlay(code, null, true) : fetchPlay(code, storedId!, false);
    void request.then((found) => { setOwnPlay(found); setOwnPlayMissing(false); }).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 404) {
        setOwnPlay(null);
        setOwnPlayMissing(true);
        if (!user && storedId) { void AsyncStorage.removeItem(playStorageKey(code)); setStoredId(null); }
      } else setOwnPlayMissing(false);
    });
  }, [code, ready, storedId, user]);

  const result = submitted ?? ownPlay;
  const stage = playStage({
    boardReady: board.isSuccess,
    boardMissing: board.isError,
    playOpen: board.data?.board.playOpen ?? false,
    resolved: !ready || storedId === undefined ? false : Boolean(result) || ownPlayMissing,
    alreadyPlayed: Boolean(result),
  });

  async function submit(questions: PublicQuizQuestion[]) {
    setBusy(true);
    setError(null);
    try {
      const body = { answers: buildSubmission(questions, answers), durationMs: Date.now() - startRef.current };
      const response = await submitPlay(code, playerName.trim() ? { ...body, playerName: playerName.trim() } : body, Boolean(user));
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
    <Stack.Screen options={{ headerShown: true, title: board.data?.board.name ?? "Quiz" }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {stage === "loading" || board.isPending ? <Screen bottom style={styles.screen}><Skeleton height={180} /></Screen>
    : stage === "unavailable" ? <ErrorState title="No quiz at that link" body="Check the code and try again." actionLabel="Retry" onAction={() => void board.refetch()} />
    : stage === "closed" ? <ErrorState title="This quiz isn't open for play" body="Its owner closed it for now." />
    : stage === "played" && board.data ? <EndScreen code={code} board={board.data.board} result={result!} returning={submitted === null} tab={tab} setTab={setTab} />
    : board.data ? (() => {
      const questions = board.data.board.questions;
      const question = questions[index];
      const answered = Object.keys(answers).length;
      const complete = isComplete(questions, answers);
      const onLast = index === questions.length - 1;
      return <View style={styles.page}>
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
                <Image source={{ uri: option }} contentFit="contain" style={styles.tileImage} alt={`Option ${optionIndex + 1}`} />
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
      </View>;
    })() : null}
  </Screen>;
}

function Prompt({ question }: { question: PublicQuizQuestion }) {
  const { colors } = useTheme();
  if (question.type === "cover_title") {
    return <View style={[styles.promptTile, { backgroundColor: colors.border }]}><Image source={{ uri: question.prompt }} blurRadius={12} contentFit="cover" style={StyleSheet.absoluteFill} alt="Which book is this?" /></View>;
  }
  if (question.type === "title_cover") {
    return <Text {...dynamicType} style={[typography.heading, styles.promptText, { color: colors.text }]}>{question.prompt}</Text>;
  }
  return <Text {...dynamicType} style={[typography.title, styles.promptQuote, { color: colors.text }]}>“{question.prompt}”</Text>;
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
  const leaderboard = useQuery({ queryKey: ["quizzes", "results", code], queryFn: () => fetchPublicResults(code), retry: false });
  return <SwipeableTabs accessibilityLabel="Quiz results" options={[{ value: "you", label: "You" }, { value: "board", label: "Leaderboard" }]} value={tab} onChange={setTab} renderPage={(page) => page === "board" ? (
    leaderboard.isPending ? <Skeleton height={180} /> : leaderboard.isError ? <ErrorState body="Couldn't load the leaderboard." actionLabel="Retry" onAction={() => void leaderboard.refetch()} /> : <View style={styles.section}>
      {leaderboard.data.plays.map((play, i) => (
        <View key={`${play.playerName ?? "Guest"}-${i}`} style={[styles.leaderRow, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{i + 1}</Text>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{play.playerName ?? "Guest"}</Text>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{play.score}/{leaderboard.data!.questionCount}</Text>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{(play.durationMs / 1000).toFixed(1)}s</Text>
        </View>
      ))}
    </View>
  ) : (
    <View style={styles.section}>
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{returning ? "You already played this quiz." : "Your score"}</Text>
      <Text {...dynamicType} style={[typography.heading, styles.score, { color: colors.accent }]}>{result.score}/{board.questionCount}</Text>
      {board.questions.map((question, i) => (
        <View key={question.id} style={[styles.verdict, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{i + 1}</Text>
          <Text {...dynamicType} style={[typography.title, { color: result.correct[question.id] ? colors.success : colors.danger }]}>{result.correct[question.id] ? "✓" : "✗"}</Text>
        </View>
      ))}
    </View>
  )} />;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  page: { flex: 1, gap: spacing.md },
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
  section: { gap: spacing.sm },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  verdict: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  score: { textAlign: "center", fontWeight: "700" },
  strong: { fontWeight: "700" },
  grow: { flex: 1 },
});
```

- [ ] **Step 2: Write the route wrapper `mobile/src/app/play/[code].tsx`**

```tsx
import { useLocalSearchParams } from "expo-router";
import { QuizPlayScreen } from "../../features/quizzes/QuizPlayScreen";

export default function PlayQuizRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <QuizPlayScreen code={code} />;
}
```

- [ ] **Step 3: Add the deep-link path prefix in `mobile/app.json`**

In `expo.android.intentFilters`, append a sibling of the `/vote/` entry:

```json
{
  "scheme": "https",
  "host": "atmyshelf.com",
  "pathPrefix": "/play/"
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile 2>&1 | tail -3 && cd mobile && npx expo-doctor`
Expected: all pass; expo-doctor reports no config problems for the intentFilter change.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/quizzes mobile/src/app/play mobile/app.json
git commit -m "mobile: native quiz play screen with /play/ deep link"
```
### Task 3: `QuizCreateScreen` + route

**Files:**
- Create: `mobile/src/features/quizzes/QuizCreateScreen.tsx`
- Create: `mobile/src/app/(app)/(arena)/quiz/new.tsx`

**Interfaces:**
- Consumes: Task 1's `createQuiz`; shared `QUIZ_POOL`, `QUIZ_QUESTION_TYPES`, `bookKey`, `booksInGroup`, `eligibleTypes`; `resolveCover`/`normalizeIsbn`/`normalizeImageId` from `features/library`; ui `Segmented`.
- Produces: the created quiz is prepended into the `["quizzes"]` query cache (Task 5's tab list reads it).

- [ ] **Step 1: Write `QuizCreateScreen.tsx`**

Two steps mirroring `TierlistCreateScreen`'s wizard skeleton (Step caption + title, `Input` name, FlatList pickers, footer Back/Next/Create). Source selection is a `Segmented`; shelf/collection books get covers resolved progressively so type availability is honest (the web review fix).

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Stack, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QUIZ_POOL, QUIZ_QUESTION_TYPES, bookKey, booksInGroup, eligibleTypes, type QuizBook, type QuizData, type QuizQuestionType } from "@scripta/shared";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiClient } from "../../core/api";
import { Button, Input, Screen, Segmented, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { resolveCover } from "../library/api/covers";
import { normalizeImageId, normalizeIsbn } from "../../lib/covers";
import { createQuiz, type Quiz } from "./api";

interface LibraryResponse { data: { books?: Array<Record<string, unknown>>; groups?: Array<{ id: string; type: string; name: string; bookKeys?: string[] }> } | null }

const SOURCES = [{ value: "shelf", label: "Shelf" }, { value: "collection", label: "Collection" }, { value: "pool", label: "Famous books" }] as const;
type Source = (typeof SOURCES)[number]["value"];

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Blurred cover → title",
  title_cover: "Title → cover",
  quote_title: "Quote → title",
  blurb_title: "Blurb → title",
};

function toQuizBook(book: Record<string, unknown>, resolvedCover: string | null | undefined): QuizBook {
  return {
    key: bookKey(book),
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
  const [poolKeys, setPoolKeys] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [allowedTypes, setAllowedTypes] = useState<QuizQuestionType[]>([...QUIZ_QUESTION_TYPES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const library = useQuery({ queryKey: ["library"], queryFn: () => apiClient.request<LibraryResponse>("/library", { auth: true }), retry: false });
  const libraryBooks = library.data?.data?.books ?? [];
  const collections = (library.data?.data?.groups ?? []).filter((group) => group.type === "collection");
  const collection = collections.find((group) => group.id === collectionId);

  const shelfRawBooks = useMemo(
    () => (source === "collection" ? (collection ? booksInGroup(collection, libraryBooks) : []) : source === "shelf" ? libraryBooks : []),
    [source, collection, libraryBooks],
  );

  // Same resolve-as-you-go pass the web create page does: ordinary library
  // books carry no _coverUrl, so cover-question availability is only honest
  // once each book's cached cover resolved.
  const resolvedRef = useRef<Record<string, string | null>>({});
  const [resolvedCovers, setResolvedCovers] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (source === "pool") return;
    let cancelled = false;
    void (async () => {
      for (const raw of shelfRawBooks) {
        const key = bookKey(raw);
        if (resolvedRef.current[key] !== undefined) continue;
        if (typeof raw._coverUrl === "string" && raw._coverUrl) { resolvedRef.current[key] = raw._coverUrl; continue; }
        const url = await resolveCover({
          isbn: normalizeIsbn(raw.ISBN) || undefined,
          imageId: normalizeImageId(raw.ImageId) || undefined,
          title: String(raw.Title ?? "").trim() || undefined,
          author: raw.Attribution ? String(raw.Attribution) : undefined,
        });
        if (cancelled) return;
        resolvedRef.current[key] = url ?? null;
        setResolvedCovers({ ...resolvedRef.current });
      }
    })();
    return () => { cancelled = true; };
  }, [shelfRawBooks, source]);

  const books: QuizBook[] = source === "pool"
    ? QUIZ_POOL.filter((book) => poolKeys.includes(book.key))
    : shelfRawBooks.map((raw) => toQuizBook(raw, resolvedCovers[bookKey(raw)]));

  const availableTypes = QUIZ_QUESTION_TYPES.filter((type) => books.some((book) => eligibleTypes(book).includes(type)));
  const effectiveTypes = allowedTypes.filter((type) => availableTypes.includes(type));
  const lengthOptions = LENGTHS.filter((count) => count <= books.length);
  const effectiveCount = lengthOptions.includes(questionCount) ? questionCount : (lengthOptions[lengthOptions.length - 1] ?? 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const data: QuizData = {
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
        keyExtractor={(book) => book.key}
        style={styles.list}
        ListEmptyComponent={<Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No books found.</Text>}
        renderItem={({ item }) => {
          const checked = poolKeys.includes(item.key);
          return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setPoolKeys((value) => checked ? value.filter((entry) => entry !== item.key) : [...value, item.key])} style={[styles.row, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{item.title}</Text>
            <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : "+"}</Text>
          </Pressable>;
        }}
      /> : null}
      {source === "shelf" ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
        {library.isPending ? "Loading books…" : library.isError ? "Your library couldn't be loaded." : `${libraryBooks.length} books on your shelf.`}
      </Text> : null}
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
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  strong: { fontWeight: "700" },
});
```

`normalizeIsbn`/`normalizeImageId` come from `@scripta/shared` (already re-exported there) — import them from that package, not a local lib path; adjust the import line if the mobile tree re-exports them elsewhere.

- [ ] **Step 2: Write the route wrapper `mobile/src/app/(app)/(arena)/quiz/new.tsx`**

```tsx
import { QuizCreateScreen } from "@/features/quizzes/QuizCreateScreen";

export default function NewQuizRoute() {
  return <QuizCreateScreen />;
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile 2>&1 | tail -3`

```bash
git add mobile/src/features/quizzes "mobile/src/app/(app)/(arena)/quiz"
git commit -m "mobile: quiz create wizard"
```
### Task 4: `QuizEditorScreen` + route

**Files:**
- Create: `mobile/src/features/quizzes/QuizEditorScreen.tsx`
- Create: `mobile/src/app/(app)/(arena)/quiz/[id].tsx`

**Interfaces:**
- Consumes: Task 1 api (`updateQuiz`, `publishQuiz`, `setPlayState`, `deleteQuiz`, `fetchQuizResults`); shared `eligibleTypes`; ui `Menu/Dialog/Sheet/SwipeableTabs/IconButton`; `expo-linking` `Linking.createURL` + `Share.share` (the tierlist editor's share idiom).
- Produces: `onUpdated` callback contract used by the route wrapper.

Structure mirrors `TierlistEditorScreen`: local `current`/`data` states reset on `[tierlist.id, tierlist.updatedAt]`, explicit Save header `IconButton` with a dirty-compare status line, `Menu` actions differing by draft/published, publish through a save-first Dialog, results as a tab.

- [ ] **Step 1: Write `QuizEditorScreen.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import * as Linking from "expo-linking";
import { eligibleTypes, type QuizData, type QuizQuestionType } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Button, Dialog, ErrorState, IconButton, Input, Menu, type MenuItem, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { fetchQuizResults, publishQuiz, setPlayState, updateQuiz, type Quiz } from "./api";

type EditorView = "setup" | "results";

const PUBLISHED_VIEWS = [{ value: "setup", label: "Questions" }, { value: "results", label: "Results" }] as const;

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Blurred cover → title",
  title_cover: "Title → cover",
  quote_title: "Quote → title",
  blurb_title: "Blurb → title",
};

export function QuizEditorScreen({ quiz, onUpdated }: { quiz: Quiz; onUpdated: (quiz: Quiz) => void }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(quiz);
  const [data, setData] = useState<QuizData>(quiz.data);
  const [view, setView] = useState<EditorView>("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const results = useQuery({ queryKey: ["quizzes", "results", current.id], queryFn: () => fetchQuizResults(current.id), enabled: current.voteCode !== null, retry: false });

  // Keyed on the server's own version — a refetch hands back an
  // equal-but-new object and must not reset local edits (tierlist
  // editor's lesson, same fix).
  useEffect(() => { setCurrent(quiz); setData(quiz.data); }, [quiz.id, quiz.updatedAt]);

  async function run(action: () => Promise<Quiz>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setCurrent(updated);
      setData(updated.data);
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
    setBusy(true);
    setError(null);
    try {
      if (JSON.stringify(data) !== JSON.stringify(current.data)) await updateQuiz(current.id, { data });
      const { quiz: published } = await publishQuiz(current.id);
      setCurrent(published);
      setData(published.data);
      onUpdated(published);
      setConfirmingPublish(false);
      await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't publish.");
    } finally {
      setBusy(false);
    }
  }

  const frozen = current.voteCode !== null;
  const dirty = !frozen && JSON.stringify(data) !== JSON.stringify(current.data);
  const actionItems: MenuItem[] = frozen
    ? [
      { label: "Share challenge link", onPress: () => void Share.share({ message: Linking.createURL(`/play/${current.voteCode}`) }) },
      { label: current.playOpen ? "Close for play" : "Open for play", onPress: () => void run(() => setPlayState(current.id, !current.playOpen)) },
    ]
    : [{ label: "Publish…", onPress: () => setConfirmingPublish(true) }];

  return <Screen top={false} style={styles.screen}>
    <Stack.Screen options={{
      headerShown: true,
      title: current.name,
      headerRight: () => <View style={styles.headerActions}>
        <Menu title={current.name} items={actionItems}><IconButton framed accessibilityLabel="Quiz actions" name="more" /></Menu>
      </View>,
    }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {!frozen ? <>
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{data.books.length} books · {busy ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</Text>
      <Button label="Save changes" disabled={!dirty} loading={busy} onPress={() => void run(() => updateQuiz(current.id, { data }))} />
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Questions</Text>
      <View style={styles.lengths}>
        {[4, 5, 10, 15, 20].filter((count) => count <= data.books.length).map((count) => (
          <Pressable key={count} accessibilityRole="radio" accessibilityState={{ selected: data.questionCount === count }} onPress={() => setData((value) => ({ ...value, questionCount: count }))} style={[styles.length, { borderColor: data.questionCount === count ? colors.accent : colors.border, backgroundColor: data.questionCount === count ? colors.accentSoft : colors.surface }]}>
            <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{count}</Text>
          </Pressable>
        ))}
      </View>
      {QUIZ_QUESTION_TYPES.map((type) => {
        const offered = data.books.some((book) => eligibleTypes(book).includes(type));
        const checked = offered && data.allowedTypes.includes(type);
        return <Pressable key={type} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !offered }} disabled={!offered} onPress={() => setData((value) => ({ ...value, allowedTypes: checked ? value.allowedTypes.filter((entry) => entry !== type) : [...value.allowedTypes, type] }))} style={[styles.row, offered ? null : styles.offered, { borderColor: colors.border }]}>
          <Text {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{TYPE_LABELS[type]}</Text>
          {!offered ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>no book has this data</Text> : <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : ""}</Text>}
        </Pressable>;
      })}
      {data.books.map((book) => <View key={book.key} style={[styles.book, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{book.title}</Text>
        <Input label="Quote (optional)" value={book.quote ?? ""} onChangeText={(quote) => setData((value) => ({ ...value, books: value.books.map((entry) => entry.key === book.key ? { ...entry, quote } : entry)) }))} placeholder="Paste a line from this book…" multiline />
        <Input label="Blurb (optional)" value={book.blurb ?? ""} onChangeText={(blurb) => setData((value) => ({ ...value, books: value.books.map((entry) => entry.key === book.key ? { ...entry, blurb } : entry)) }))} multiline />
      </View>)}
      <Button label="Publish quiz" loading={busy} disabled={data.books.length < 4} onPress={() => setConfirmingPublish(true)} />
      {data.books.length < 4 ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>A quiz needs at least 4 books.</Text> : null}
    </> : frozen ? results.isPending ? <Skeleton height={180} /> : <SwipeableTabs accessibilityLabel="Quiz editor view" options={PUBLISHED_VIEWS} value={view} onChange={setView} renderPage={(page) => page === "results" ? results.isError ? <ErrorState body="Couldn't load results." actionLabel="Retry" onAction={() => void results.refetch()} /> : <View style={styles.section}>
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
    </View> : <View style={styles.section}>
      {(current.data.questions ?? []).map((question, index) => <View key={question.id} style={[styles.row, { borderColor: colors.border }]}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{index + 1}. {TYPE_LABELS[question.type]}</Text>
        {question.type === "title_cover"
          ? <Image source={{ uri: String(question.options[question.answerIndex]) }} contentFit="contain" style={styles.answerThumb} alt="Answer cover" />
          : <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.grow, { color: colors.text }]}>{String(question.options[question.answerIndex])}</Text>}
      </View>)}
    </View>} /> : null}
    <Dialog visible={confirmingPublish} title="Publish quiz" onClose={() => setConfirmingPublish(false)}>
      <View style={styles.dialog}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Publishing mints the challenge link and locks the books, quotes, and questions. This can't be undone.</Text>
        <Button label="Publish" loading={busy} onPress={() => void publish()} />
      </View>
    </Dialog>
  </Screen>;
}

```

- [ ] **Step 2: Write the route wrapper `mobile/src/app/(app)/(arena)/quiz/[id].tsx`**

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { ErrorState, Skeleton } from "@/ui";
import { fetchQuizzes, type Quiz } from "@/features/quizzes/api";
import { QuizEditorScreen } from "@/features/quizzes/QuizEditorScreen";

export default function QuizEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["quizzes"], queryFn: fetchQuizzes, retry: false });
  const quiz = query.data?.find((item) => item.id === id);
  if (query.isPending) return <View style={{ flex: 1, padding: 24 }}><Skeleton height={180} /></View>;
  if (query.isError || !quiz) return <ErrorState title="Quiz unavailable" actionLabel="Back" onAction={() => router.back()} />;
  return <QuizEditorScreen quiz={quiz} onUpdated={(updated) => client.setQueryData<Quiz[]>(["quizzes"], (items = []) => items.map((item) => item.id === updated.id ? updated : item))} />;
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile 2>&1 | tail -3`

```bash
git add mobile/src/features/quizzes "mobile/src/app/(app)/(arena)/quiz"
git commit -m "mobile: quiz editor — quotes, publish, share link, results"
```
### Task 5: Games-list integration (`arenaHome.ts` + `ArenaHomeScreen`)

**Files:**
- Modify: `mobile/src/features/arena/arenaHome.ts`
- Modify: `mobile/src/features/arena/arenaHome.test.ts`
- Modify: `mobile/src/features/arena/ArenaHomeScreen.tsx`

**Interfaces:**
- Consumes: Task 1's `Quiz`/`fetchQuizzes`/`deleteQuiz`; Task 3/4's routes `/quiz/new`, `/quiz/:id`.
- Produces: `ArenaTab` gains `"quizzes"`; `OwnedItem` gains a `quiz` variant — consumed only within these files and their tests.

- [ ] **Step 1: Extend `arenaHome.ts`**

1. Import the `Quiz` type; append to `ARENA_TABS`:

```ts
{ value: "quizzes", label: "Quizzes" },
```

2. Extend `OwnedItem`:

```ts
| { id: string; name: string; detail: string; kind: "quiz"; source: Quiz }
```

3. In `ownedItems`, add the quizzes branch before the tierlists fall-through (the function currently assumes two tabs):

```ts
if (tab === "quizzes") {
  return quizzes.map((source) => {
    const status = source.voteCode === null ? "draft" : source.playOpen ? "open" : "closed";
    return {
      id: source.id,
      name: source.name,
      detail: `${source.data.books.length} ${source.data.books.length === 1 ? "book" : "books"} · ${status}`,
      kind: "quiz",
      source,
    };
  });
}
```

Signature becomes `ownedItems(tab, tournaments, tierlists, quizzes: Quiz[] = [])` — the optional fourth parameter keeps every existing three-argument call (and test) valid. Make the tierlists branch an explicit `if (tab === "tierlists")` case so quizzes cannot fall into it.

4. `homeSections`: quizzes have no voted section — the first line's default already returns the flat owned list when `voted.length === 0`; pass `[]` from the caller for the quizzes tab, and make the `voted` pick explicit: `tab === "tournaments" ? votedTournaments : tab === "tierlists" ? votedTierlists : []`.

5. `emptyCopy` gains:

```ts
if (tab === "quizzes") return { title: "No quizzes yet", body: "Create one and turn your books into trivia." };
```

- [ ] **Step 2: Update `arenaHome.test.ts`**

- The tabs round-trip test's `assert.deepEqual(ARENA_TABS.map((tab) => tab.value), ["tournaments", "tierlists"])` becomes `["tournaments", "tierlists", "quizzes"]`; `tabAtIndex(9)` now clamps to `"quizzes"`; add `assert.equal(tabIndex("quizzes"), 2)`.
- Add a `quiz` fixture (`over: Partial<Quiz> = {}` with `data: { sourceLabel: "", questionCount: 10, allowedTypes: [], books: [{ key: "k", title: "T", author: "A", coverUrl: null, quote: null, blurb: null }], questions: null }`, `voteCode: null`, `playOpen: false`, timestamps, id/name) and tests:

```ts
test("owned quiz items summarise book count and stage", () => {
  assert.equal(ownedItems("quizzes", [], [], [quiz()])[0]?.detail, "1 book · draft");
  assert.equal(ownedItems("quizzes", [], [], [quiz({ voteCode: "abc", playOpen: true })])[0]?.detail, "1 book · open");
  assert.equal(ownedItems("quizzes", [], [], [quiz({ voteCode: "abc", playOpen: false })])[0]?.detail, "1 book · closed");
});

test("the quizzes tab has no voted section and its own empty copy", () => {
  assert.deepEqual(homeSections("quizzes", ownedItems("quizzes", [], [], [quiz()]), [], []).length, 1);
  assert.equal(emptyCopy("quizzes", false).title, "No quizzes yet");
});
```

- [ ] **Step 3: Wire `ArenaHomeScreen.tsx`**

1. Import `deleteQuiz, fetchQuizzes, type Quiz` from `../quizzes/api`.
2. `Doomed` gains `| { kind: "quiz"; id: string; name: string }`.
3. New query: `const quizzes = useQuery({ queryKey: ["quizzes"], queryFn: fetchQuizzes, retry: false });`
4. `remove()` gains the quiz branch: `await deleteQuiz(deleting.id); queryClient.setQueryData<Quiz[]>(["quizzes"], (items = []) => items.filter((item) => item.id !== deleting.id));`
5. `open()` gains: `if (item.kind === "quiz") return router.push(`/quiz/${item.id}` as never);`
6. `SwipeableTabs` renderPage: `ownedItems(pageTab, tournaments.data ?? [], tierlists.data ?? [], quizzes.data ?? [])`; `query` pick: `pageTab === "tournaments" ? tournaments : pageTab === "tierlists" ? tierlists : quizzes`; `voted` pick: `pageTab === "tournaments" ? votedTournaments : pageTab === "tierlists" ? votedTierlists : { data: [], isRefetching: false, isError: false, refetch: () => {} } as never` — or hoist a `const noVoted = { data: [], isRefetching: false, isError: false, refetch: async () => {} }` constant typed loosely to satisfy `ArenaList`'s props; `homeSections(..., quizzes tab passes [])`.
7. `Fab`: `onPress` gains the quizzes branch → `router.push("/quiz/new" as never)`; `accessibilityLabel` gains `tab === "quizzes" ? "New quiz" : …`.
8. `ArenaList` header search label: `Search ${tab === "tournaments" ? "tournaments" : tab === "tierlists" ? "tier lists" : "quizzes"}`.
9. Card body: extend the owned-item render with a `QuizBody` (name title + detail caption — same shape as `TierlistBody` without the distribution):

```tsx
function QuizBody({ item }: { item: Extract<OwnedItem, { kind: "quiz" }> }) {
  const { colors } = useTheme();
  return <View style={styles.grow}>
    <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{item.name}</Text>
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.detail}</Text>
  </View>;
}
```

and the render branch: `{item.item.kind === "tournament" ? <TournamentBody … /> : item.item.kind === "quiz" ? <QuizBody item={item.item} /> : <TierlistBody item={item.item} />}`.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile 2>&1 | tail -3`
Expected: PASS including the updated/added arenaHome tests.

```bash
git add mobile/src/features/arena
git commit -m "mobile: quizzes tab in the games list"
```

---

### Task 6: README route table + full verification sweep

**Files:**
- Modify: `mobile/README.md` (the "Route adaptations" list, ~line 139)

- [ ] **Step 1: Add `/play/:code` to the route-adaptations list** beside the existing `/vote/:code` entry.

- [ ] **Step 2: Full sweep**

Run, in order:

```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace mobile && npm test --workspace mobile
cd mobile && npx expo-doctor
```

Expected: all PASS; expo-doctor clean.

- [ ] **Step 3: Commit**

```bash
git add mobile/README.md
git commit -m "mobile: document the /play deep link"
```

---

## Execution notes

- Tasks 1→2 are strictly ordered; 3 and 4 both consume Task 1, and Task 3's post-create `router.replace` targets Task 4's route, so land 3 before 4 and only device-verify navigation after both. Task 5 depends on Task 1 (api types) and rewrites `arenaHome.test.ts` assertions that the new tab intentionally breaks — apply its test changes exactly.
- Device walkthrough (deep link, play, create, publish, leaderboard) is the owner's — lease rules in `docs/dev-workflow.md`; `npx uri-scheme open "exp://127.0.0.1:8081/play/<code>"` exercises the deep link on a running dev server.
- Deliberately absent: quiz discovery in the mobile community feed (deferred globally), AASA server update for `/play/` (owner action).

