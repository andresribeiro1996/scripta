import { bookKey } from "../library/merge.js";
import { normalizeImageId, normalizeIsbn } from "../library/covers.js";
import type { SeedBook } from "./types.js";

export interface SeedCoverLookup {
  isbn?: string;
  imageId?: string;
  title?: string;
  author?: string;
}

export function seedCoverLookup(book: Record<string, unknown>): SeedCoverLookup | null {
  const isbn = normalizeIsbn(book.ISBN);
  const imageId = normalizeImageId(book.ImageId);
  const title = String(book.Title ?? "").trim();
  if (!isbn && !imageId && !title) return null;
  return {
    isbn: isbn || undefined,
    imageId: imageId || undefined,
    title: title || undefined,
    author: book.Attribution ? String(book.Attribution) : undefined
  };
}

export function toSeedBook(book: Record<string, unknown>, cover: string | null): SeedBook {
  return {
    key: bookKey(book),
    title: String(book.Title ?? "Untitled"),
    author: String(book.Attribution ?? "Unknown author"),
    cover
  };
}
