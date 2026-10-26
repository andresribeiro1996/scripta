import type { PlayResponse, PublicQuizQuestion, QuizBook, QuizQuestion, QuizQuestionType } from "./types.js";

type ScoreValue = { kind: "text" | "cover"; value: string };

export interface ScoreRow {
  id: string;
  number: number;
  correct: boolean;
  answer?: ScoreValue & { title?: string };
  pick?: ScoreValue;
}

export function quizQuestionLabel(question: QuizQuestion, index: number, books: QuizBook[]): string {
  const title = books.find((book) => book.workId === question.workId)?.title;
  return title ? `Q${index + 1} · ${title}` : `Q${index + 1}`;
}

export function quizOptionLabel(type: QuizQuestionType, option: string, books: Array<{ title: string; coverUrl?: string | null }>): string {
  if (type !== "title_cover") return option;
  return books.find((book) => book.coverUrl === option)?.title ?? "Unknown book";
}

export function scoreRows(questions: PublicQuizQuestion[], correct: Record<string, boolean>, answers: PlayResponse["answers"]): ScoreRow[] {
  return questions.map((question, index) => {
    const row: ScoreRow = { id: question.id, number: index + 1, correct: Boolean(correct[question.id]) };
    const given = answers?.[question.id];
    if (!given) return row;
    const kind = question.type === "title_cover" ? "cover" : "text";
    row.answer = { kind, value: question.options[given.answerIndex], ...(kind === "cover" ? { title: question.prompt } : {}) };
    if (!row.correct) row.pick = { kind, value: question.options[given.choiceIndex] };
    return row;
  });
}

export function playerLabel(play: { playerName: string | null; anonymous: boolean }): { name: string; guest: boolean } {
  return { name: play.playerName ?? "Guest", guest: play.anonymous };
}

export function quizClueHeading(type: QuizQuestionType): string {
  if (type === "characters_title") return "Which book has these characters?";
  if (type === "title_cover") return "Which cover belongs to this title?";
  return "Which book is this from?";
}
