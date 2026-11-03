import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DailyChapterBoard, DailyChapterHistory, PlayResponse, PublicQuizQuestion } from "@scripta/shared";

registerHooks({ load: (url, context, next) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context)) });

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });
Object.defineProperty(globalThis, "window", { value: { location: { origin: "https://atmyshelf.test" } }, configurable: true });

const { setLocalePreference, t } = await import("../src/i18n/index.ts");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { QuizPrompt } = await import("../src/components/quiz/QuizPrompt.tsx");
const { QuizResults } = await import("../src/components/quiz/QuizResults.tsx");
const { QuizStatusBadge } = await import("../src/components/quizzes/QuizStatusBadge.tsx");
const { DailyChapterPage } = await import("../src/pages/DailyChapterPage.tsx");
const { QUIZ_TYPE_LABEL_KEYS } = await import("../src/lib/quizTypeLabels.ts");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};

const rendered = (element: () => ReactNode, prepare: (client: QueryClient) => void = () => undefined) => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  try {
    prepare(client);
    return renderToString(createElement(QueryClientProvider, { client }, createElement(AuthProvider, null, createElement(MemoryRouter, null, element()))));
  } finally {
    client.clear();
  }
};

const questions: PublicQuizQuestion[] = [
  { id: "quote", type: "quote_title", prompt: "A quote", options: ["Circe", "Piranesi"] },
  { id: "repeat", type: "cover_title", prompt: "/piranesi.jpg", options: ["Piranesi", "Circe"] },
];
const result: PlayResponse = {
  playId: "play",
  score: 1,
  correct: { quote: true, repeat: false },
  answers: { quote: { answerIndex: 0, choiceIndex: 0, workId: "w1" }, repeat: { answerIndex: 0, choiceIndex: 1, workId: "w2" } },
};

const results = () => rendered(
  () => createElement(QuizResults, { code: "challenge", name: "Book quiz", questions, result }),
  (client) => client.setQueryData(["quizPublicResults", "challenge", "play"], { plays: [{ playerName: null, anonymous: true, avatarUrl: null, isYou: false, score: 2, durationMs: 16800 }], questionCount: 2 }),
);

test("quiz results, leaderboard and decimal duration render in Portuguese", () => {
  const html = inPortuguese(results).replaceAll("<!-- -->", "");
  assert.match(html, /aria-label="1 de 2 certas"/);
  assert.match(html, /As suas respostas/);
  assert.match(html, /Resposta certa/);
  assert.match(html, /Desafiar um amigo/);
  assert.match(html, /Convidado/);
  assert.match(html, /Tempo: <\/span>16,8 s/);
  assert.doesNotMatch(html, /16\.8/);
  assert.match(results().replaceAll("<!-- -->", ""), /Time: <\/span>16\.8s/);
});

test("quiz prompt, status badge and type labels render in Portuguese", () => {
  const prompt = inPortuguese(() => renderToString(createElement(QuizPrompt, { question: { id: "q", type: "characters_title", prompt: "A · B", options: ["a", "b"] } })));
  assert.match(prompt, /Quem está neste livro\?/);
  assert.match(inPortuguese(() => renderToStaticMarkup(createElement(QuizStatusBadge, { status: "closed" }))), /Encerrado/);
  assert.equal(inPortuguese(() => t(QUIZ_TYPE_LABEL_KEYS.quote_title)), "Adivinhar o livro a partir de uma citação");
  assert.equal(t(QUIZ_TYPE_LABEL_KEYS.quote_title), "Guess the book from a quote");
});

const guestId = "11111111-2222-4333-8444-555555555555";
const board: DailyChapterBoard = {
  id: "e1",
  date: "2026-10-21",
  closesAt: "2026-10-22T00:00:00.000Z",
  title: "Old gods",
  intro: "Intro",
  theme: { id: "retold-myths", name: "Retold myths", family: "Genres", motif: "window", tone: "sage" } as DailyChapterBoard["theme"],
  questions: Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, type: "quote_title", prompt: `Quote ${i}`, options: ["a", "b"] })) as PublicQuizQuestion[],
};
const history: DailyChapterHistory = {
  results: [{ editionId: "e0", date: "2026-10-20", title: "Past", themeId: "retold-myths", score: 4, completedAt: "2026-10-20T10:00:00.000Z", answers: [] }],
  startedOn: "2026-10-20",
  streak: 3,
  longestStreak: 3,
  longestPerfectRun: 0,
  correct: 4,
  answered: 5,
  editionDates: [],
  themes: [{ themeId: "retold-myths", eligible: 6, completed: 1, correct: 4, answered: 5, perfect: 0, perfectStreak: 2 }],
  today: "2026-10-21",
};

const daily = (perfect = 0) => {
  localStorage.setItem("daily-chapter:guest", guestId);
  return rendered(() => createElement(DailyChapterPage), (client) => {
    client.setQueryData(["daily-chapter", "today"], { date: "2026-10-21", board });
    client.setQueryData(["daily-chapter", "history", "guest", guestId, "2026-10-21"], { ...history, themes: [{ ...history.themes[0]!, perfect }] });
  });
};

test("the Daily Chapter page translates its chrome, theme names and stats line", () => {
  const html = inPortuguese(daily).replaceAll("<!-- -->", "");
  assert.match(html, /O Capítulo do Dia/);
  assert.match(html, /Mitos recontados · 21 out 2026/);
  assert.match(html, /Pergunta 1 de 5 · Diga o livro a partir das suas palavras/);
  assert.match(html, /1\/6 edições desde 20 out 2026 · 4\/5 certas · perfeitas: 0/);
  assert.match(inPortuguese(() => daily(1)).replaceAll("<!-- -->", ""), /4\/5 certas · perfeitas: 1/);
  assert.match(html, /Concluídos: 1 · sequência de 3 dias/);
  assert.match(html, /2 edições perfeitas seguidas/);
  assert.match(html, /Crie uma conta/);
  const english = daily().replaceAll("<!-- -->", "");
  assert.match(english, /Retold myths · 21 Oct 2026/);
  assert.match(english, /1\/6 editions since 20 Oct 2026 · 4\/5 correct · 0 perfect/);
});
