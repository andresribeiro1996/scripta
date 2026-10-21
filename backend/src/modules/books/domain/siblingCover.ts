import type { BooksRepository } from "./ports.js";
import type { BookRow } from "./types.js";

export function siblingCoverImageIds(repo: Pick<BooksRepository, "workCoverImageIds" | "getImage" | "listRejectedUrls">, books: Array<Pick<BookRow, "id" | "isbn" | "work_id">>): Map<string, string> {
  const borrowers = books.filter((book) => !book.isbn && book.work_id);
  const lent = new Map<string, string>();
  if (borrowers.length === 0) return lent;
  const covers = repo.workCoverImageIds(borrowers.map((book) => book.work_id!));
  for (const book of borrowers) {
    const imageId = covers.get(book.work_id!);
    if (!imageId) continue;
    const sourceUrl = repo.getImage(imageId)?.source_url;
    if (sourceUrl && repo.listRejectedUrls(book.id).has(sourceUrl)) continue;
    lent.set(book.id, imageId);
  }
  return lent;
}
