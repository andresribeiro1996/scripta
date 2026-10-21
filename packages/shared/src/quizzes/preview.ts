import type { QuizData, QuizPreview } from "./types.js";

export function quizPreview(data: Pick<QuizData, "books" | "questions">): QuizPreview | undefined {
  const books = new Map(data.books.map((book) => [book.workId, book]));
  for (const question of data.questions ?? []) {
    const book = question.workId === null ? undefined : books.get(question.workId);
    if (!book) continue;
    const prompt = (question.type === "cover_title" ? book.coverUrl : question.type === "title_cover" ? book.title : question.type === "quote_title" ? book.quote : book.blurb)?.trim();
    if (!prompt) continue;
    return { type: question.type, prompt: question.type === "cover_title" ? prompt : prompt.slice(0, 180) };
  }
  return undefined;
}
