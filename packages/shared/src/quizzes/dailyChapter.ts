import type { PublicQuizQuestion, SubmittedAnswer } from "./types.js";
import { recapMonthName } from "../topShelf/api.js";
import { DAILY_CHAPTER_THEMES, type DailyChapterTheme } from "./dailyThemes.js";

export interface DailyChapterBook {
  id: string;
  title: string;
  author: string;
  language: string;
  themeIds: string[];
}

export interface DailyChapterQuestion {
  id: string;
  bookId: string;
  type: "quote_title" | "blurb_title";
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  sourceUrl: string;
  sourceEdition: string;
  rights: { basis: "original" | "public-domain" | "permission"; evidence: string };
  approvedAt: string | null;
  approvedBy: string | null;
}

export type DailyChapterQuestionInput = Omit<DailyChapterQuestion, "approvedAt" | "approvedBy"> & { approved: boolean };

export const DAILY_CHAPTER_QUOTE_RIGHTS: DailyChapterQuestion["rights"] = {
  basis: "permission",
  evidence: "Quotation reuse rights are assumed cleared for Atmyshelf app/web quizzes, as instructed by the project owner."
};

export interface DailyChapterEdition {
  id: string;
  date: string;
  themeId: string;
  title: string;
  intro: string;
  questionIds: string[];
  publishedAt: string | null;
}

export type DailyChapterEditionInput = Omit<DailyChapterEdition, "publishedAt">;

export interface DailyChapterBoard {
  id: string;
  date: string;
  closesAt: string;
  title: string;
  intro: string;
  theme: DailyChapterTheme;
  questions: PublicQuizQuestion[];
}

export interface DailyChapterAnswer {
  questionId: string;
  prompt: string;
  choiceIndex: number;
  answerIndex: number;
  options: string[];
  explanation: string;
  sourceUrl: string;
  book: DailyChapterBook;
}

export interface DailyChapterResult {
  editionId: string;
  date: string;
  title: string;
  themeId: string;
  score: number;
  completedAt: string;
  answers: DailyChapterAnswer[];
}

export interface DailyChapterThemeStats {
  themeId: string;
  eligible: number;
  completed: number;
  correct: number;
  answered: number;
  perfect: number;
  perfectStreak: number;
}

export interface DailyChapterHistory {
  results: DailyChapterResult[];
  startedOn: string | null;
  streak: number;
  longestStreak: number;
  longestPerfectRun: number;
  correct: number;
  answered: number;
  editionDates: string[];
  themes: DailyChapterThemeStats[];
  today: string;
}

export interface DailyChapterDay {
  date: string;
  published: boolean;
  score: number | null;
}

export interface DailyChapterPlayerSummary {
  streak: number;
  average: number;
  perfect: number;
  bestTheme: { themeId: string; percent: number } | null;
  month: string;
  days: DailyChapterDay[];
}

export interface DailyChapterPerson {
  userId: string;
  username: string;
  avatarUrl: string | null;
  score: number;
  marks: boolean[];
  you: boolean;
}

export interface DailyChapterMonthFacts {
  players: number;
  hardest: { title: string; date: string; average: number } | null;
  mostMissed: { title: string; missedPercent: number } | null;
  perfect: Array<{ userId: string; perfect: number }>;
}

export interface DailyChapterCoverage {
  targetBooks: number;
  coveredBooks: number;
  approvedQuotes: number;
  readyQuestions: number;
  availableQuotes: number;
  themes: Array<{ themeId: string; targetBooks: number; coveredBooks: number; approvedQuotes: number; readyQuestions: number; availableQuotes: number }>;
}

export interface DailyChapterEditorial {
  books: DailyChapterBook[];
  questions: DailyChapterQuestion[];
  editions: DailyChapterEdition[];
  coverage: DailyChapterCoverage;
  usedQuestionIds: string[];
}

export function dailyChapterCoverage(books: DailyChapterBook[], questions: DailyChapterQuestion[], usedQuestionIds: string[] = []): DailyChapterCoverage {
  const used = new Set(usedQuestionIds);
  const count = (targets: DailyChapterBook[]) => {
    const ids = new Set(targets.map((book) => book.id));
    const approved = questions.filter((q) => q.approvedAt && ids.has(q.bookId));
    const quotes = approved.filter((q) => q.type === "quote_title");
    return { targetBooks: targets.length, coveredBooks: new Set(quotes.map((q) => q.bookId)).size, approvedQuotes: quotes.length, availableQuotes: quotes.filter((q) => !used.has(q.id)).length, readyQuestions: approved.filter((q) => !used.has(q.id)).length };
  };
  return { ...count(books), themes: DAILY_CHAPTER_THEMES.map((theme) => ({ themeId: theme.id, ...count(books.filter((book) => book.themeIds.includes(theme.id))) })) };
}

export function dailyChapterStats(results: DailyChapterResult[], releases: Array<{ id: string; date: string; themeId: string }>, today: string): DailyChapterHistory {
  const ordered = [...results].sort((a, b) => b.date.localeCompare(a.date));
  const startedOn = ordered.at(-1)?.date ?? null;
  const played = new Map(ordered.map((result) => [result.editionId, result]));
  const eligible = releases.filter((edition) => startedOn && edition.date >= startedOn && edition.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0, longestStreak = 0, longestPerfectRun = 0, run = 0, perfectRun = 0, open = true;
  for (const edition of eligible) {
    const result = played.get(edition.id);
    if (!result) {
      if (edition.date === today) continue;
      run = 0;
      perfectRun = 0;
      open = false;
      continue;
    }
    run++;
    if (open) streak = run;
    longestStreak = Math.max(longestStreak, run);
    perfectRun = result.score === 5 ? perfectRun + 1 : 0;
    longestPerfectRun = Math.max(longestPerfectRun, perfectRun);
  }
  const themes = DAILY_CHAPTER_THEMES.flatMap((theme) => {
    const editions = eligible.filter((edition) => edition.themeId === theme.id);
    if (!editions.length) return [];
    const completed = editions.flatMap((edition) => { const result = played.get(edition.id); return result ? [result] : []; });
    let perfectStreak = 0;
    for (const edition of editions) {
      const result = played.get(edition.id);
      if (!result && edition.date === today) continue;
      if (!result || result.score !== 5) break;
      perfectStreak++;
    }
    return [{ themeId: theme.id, eligible: editions.length, completed: completed.length, correct: completed.reduce((sum, result) => sum + result.score, 0), answered: completed.length * 5, perfect: completed.filter((result) => result.score === 5).length, perfectStreak }];
  });
  return {
    results: ordered,
    startedOn,
    streak,
    longestStreak,
    longestPerfectRun,
    correct: ordered.reduce((sum, result) => sum + result.score, 0),
    answered: ordered.length * 5,
    editionDates: releases.filter((edition) => edition.date <= today).map((edition) => edition.date).sort((a, b) => b.localeCompare(a)),
    themes,
    today
  };
}

export function dailyChapterMonth(history: Pick<DailyChapterHistory, "results" | "editionDates" | "startedOn" | "today">, month: string): DailyChapterDay[] {
  const scores = new Map(history.results.map((result) => [result.date, result.score]));
  const { startedOn, today } = history;
  const published = new Set(history.editionDates.filter((date) => startedOn !== null && date >= startedOn && (date !== today || scores.has(date))));
  const length = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return Array.from({ length }, (_, index) => {
    const date = month + "-" + String(index + 1).padStart(2, "0");
    return { date, published: published.has(date), score: scores.get(date) ?? null };
  });
}

export function dailyChapterThemeRates(themes: Array<Pick<DailyChapterThemeStats, "themeId" | "correct" | "answered">>): Array<{ themeId: string; percent: number }> {
  return themes
    .filter((theme) => theme.answered > 0)
    .map((theme) => ({ themeId: theme.themeId, percent: Math.round(theme.correct / theme.answered * 100) }))
    .sort((a, b) => b.percent - a.percent || a.themeId.localeCompare(b.themeId));
}

const averageScore = (results: DailyChapterResult[]) => results.length ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length * 10) / 10 : 0;

export function dailyChapterMonthStats(results: DailyChapterResult[], month: string): Pick<DailyChapterPlayerSummary, "average" | "bestTheme"> {
  const played = results.filter((result) => result.date.startsWith(month));
  const themes = new Map<string, { themeId: string; correct: number; answered: number }>();
  for (const result of played) {
    const theme = themes.get(result.themeId) ?? { themeId: result.themeId, correct: 0, answered: 0 };
    theme.correct += result.score;
    theme.answered += 5;
    themes.set(result.themeId, theme);
  }
  return { average: averageScore(played), bestTheme: dailyChapterThemeRates([...themes.values()])[0] ?? null };
}

export function dailyChapterSummary(history: DailyChapterHistory, month: string): DailyChapterPlayerSummary {
  return {
    streak: history.streak,
    average: averageScore(history.results),
    perfect: history.results.filter((result) => result.score === 5).length,
    bestTheme: dailyChapterThemeRates(history.themes)[0] ?? null,
    month,
    days: dailyChapterMonth(history, month)
  };
}

export function dailyChapterMonthShare(summary: DailyChapterPlayerSummary, url: string): string {
  const published = summary.days.filter((day) => day.published);
  const squares = published.map((day) => day.score === null ? "⬜" : day.score === 5 ? "🟩" : day.score >= 3 ? "🟨" : "🟥").join("");
  return "The Daily Chapter · " + recapMonthName(summary.month) + " " + summary.month.slice(0, 4) + "\n" + squares + "\n" + summary.streak + "-day streak · " + summary.average + " avg\n" + url;
}

export function dailyChapterShare(result: DailyChapterResult, url: string): string {
  return "The Daily Chapter · " + result.date + "\n" + result.title + "\n" + result.answers.map((answer) => answer.choiceIndex === answer.answerIndex ? "🟩" : "⬜").join("") + " " + result.score + "/5\n" + url;
}

export function dailyChapterSubmission(questions: PublicQuizQuestion[], answers: Record<string, number>): SubmittedAnswer[] | null {
  const submitted = questions.map((question) => ({ questionId: question.id, choiceIndex: answers[question.id] }));
  return submitted.every((answer, index) => Number.isInteger(answer.choiceIndex) && answer.choiceIndex >= 0 && answer.choiceIndex < questions[index]!.options.length) ? submitted as SubmittedAnswer[] : null;
}

export function readDailyChapterDraft(value: string | null, questions: PublicQuizQuestion[]): Record<string, number> {
  if (!value) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch (error) { if (error instanceof SyntaxError) return {}; throw error; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const entries = parsed as Record<string, unknown>;
  return Object.fromEntries(questions.flatMap((q) => { const choice = entries[q.id]; return typeof choice === "number" && Number.isInteger(choice) && choice >= 0 && choice < q.options.length ? [[q.id, choice]] : []; }));
}

export const DAILY_CHAPTER_GUEST_STORAGE = "daily-chapter:guest";
export const dailyChapterDraftKey = (editionId: string, playerId: string) => "daily-chapter:draft:" + playerId + ":" + editionId;
export const isDailyChapterGuestId = (value: string | null): value is string => value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
