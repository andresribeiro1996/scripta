import type { PublicQuizQuestion, SubmittedAnswer } from "./types.js";
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
  themes: DailyChapterThemeStats[];
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
  const completedDates = new Set(ordered.map((result) => result.date));
  let cursor = new Date(today + "T00:00:00.000Z");
  if (!completedDates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (completedDates.has(cursor.toISOString().slice(0, 10))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
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
  return { results: ordered, startedOn, streak, themes };
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
