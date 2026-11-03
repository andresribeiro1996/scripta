import type { Locale } from "../i18n/locale.js";
import { decimalText } from "../i18n/numbers.js";
import { sharedT } from "../i18n/sharedT.js";
import type { PlayResponse, PublicQuizQuestion, QuizBook, QuizQuestion, QuizQuestionType } from "./types.js";

type ScoreValue = { kind: "text" | "cover"; value: string };

export interface ScoreRow {
  id: string;
  number: number;
  correct: boolean;
  answer?: ScoreValue & { title?: string };
  pick?: ScoreValue;
  prompt?: string;
  workId?: string;
}

export function quizQuestionLabel(question: QuizQuestion, index: number, books: QuizBook[], locale: Locale): string {
  const t = sharedT(locale);
  const title = books.find((book) => book.workId === question.workId)?.title;
  return title ? t("shared.labels.questionWithBook", { number: index + 1, title }) : t("shared.labels.questionNumber", { number: index + 1 });
}

export function quizOptionLabel(type: QuizQuestionType, option: string, books: Array<{ title: string; coverUrl?: string | null }>, locale: Locale): string {
  if (type !== "title_cover") return option;
  return books.find((book) => book.coverUrl === option)?.title ?? sharedT(locale)("shared.labels.unknownBook");
}

const TEXT_CLUE_TYPES = new Set<QuizQuestionType>(["quote_title", "blurb_title", "characters_title"]);

export function scoreRows(questions: PublicQuizQuestion[], correct: Record<string, boolean>, answers: PlayResponse["answers"]): ScoreRow[] {
  return questions.map((question, index) => {
    const row: ScoreRow = { id: question.id, number: index + 1, correct: Boolean(correct[question.id]) };
    if (TEXT_CLUE_TYPES.has(question.type) && question.prompt) row.prompt = question.prompt;
    const given = answers?.[question.id];
    if (!given) return row;
    if (given.workId) row.workId = given.workId;
    const kind = question.type === "title_cover" ? "cover" : "text";
    row.answer = { kind, value: question.options[given.answerIndex], ...(kind === "cover" ? { title: question.prompt } : {}) };
    if (!row.correct) row.pick = { kind, value: question.options[given.choiceIndex] };
    return row;
  });
}

export function resultCovers(questions: PublicQuizQuestion[], rows: ScoreRow[]): Array<{ url: string; title: string }> {
  const covers = new Map<string, string>();
  rows.forEach((row, index) => {
    const question = questions[index]!;
    if (row.answer?.kind === "cover") covers.set(row.answer.value, row.answer.title ?? "");
    else if (question.type === "cover_title") covers.set(question.prompt, row.answer?.value ?? "");
  });
  return [...covers].slice(0, 3).map(([url, title]) => ({ url, title }));
}

export function playerLabel(play: { playerName: string | null; anonymous: boolean }, locale: Locale): { name: string; guest: boolean } {
  return { name: play.playerName ?? sharedT(locale)("shared.labels.guest"), guest: play.anonymous && play.playerName !== null };
}

export function quizClueHeading(type: QuizQuestionType, locale: Locale): string {
  const t = sharedT(locale);
  if (type === "characters_title") return t("shared.labels.clueCharacters");
  if (type === "title_cover") return t("shared.labels.clueCover");
  return t("shared.labels.clueBook");
}

export function missesFirst(rows: ScoreRow[]): ScoreRow[] {
  return [...rows.filter((row) => !row.correct), ...rows.filter((row) => row.correct)];
}

export function answerExpands(row: ScoreRow): boolean {
  return !row.answer || Boolean(row.workId) || row.pick?.kind === "cover";
}

const QUOTED_PROMPT_TYPES = new Set<QuizQuestionType>(["quote_title", "blurb_title"]);

export function scoreRowPrompt(row: ScoreRow, type: QuizQuestionType): string | null {
  if (!row.prompt) return null;
  return QUOTED_PROMPT_TYPES.has(type) ? `“${row.prompt}”` : row.prompt;
}

export function isLoneViewer(plays: Array<{ isYou: boolean }>): boolean {
  return plays.length === 1 && plays[0]!.isYou;
}

export function leaderboardPosition(plays: Array<{ isYou: boolean }>): { rank: number; total: number } | null {
  const index = plays.findIndex((play) => play.isYou);
  return index === -1 || plays.length < 2 ? null : { rank: index + 1, total: plays.length };
}

export function playDurationLabel(ms: number, locale: Locale): string {
  if (ms < 59_950) return sharedT(locale)("shared.labels.seconds", { value: decimalText(ms / 1000, locale, 1) });
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
