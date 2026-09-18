import type { BookRecommendationInput } from "@scripta/shared/community";

export function toRecommendation(
  book: { title: string; author: string; isbn?: string | null; coverUrl?: string | null },
  readStatus: 0 | 1 | 2
): BookRecommendationInput {
  return { title: book.title, author: book.author, isbn: book.isbn ?? null, coverUrl: book.coverUrl ?? null, readStatus };
}
