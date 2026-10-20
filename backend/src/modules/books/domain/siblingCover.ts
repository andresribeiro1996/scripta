import type { BooksRepository } from "./ports.js";
import type { BookRow } from "./types.js";

export function siblingCoverImageId(repo: Pick<BooksRepository, "workCoverImageIds">, book: Pick<BookRow, "isbn" | "cover_image_id" | "work_id">): string | null {
  if (book.isbn || book.cover_image_id || !book.work_id) return null;
  return repo.workCoverImageIds([book.work_id]).get(book.work_id) ?? null;
}
