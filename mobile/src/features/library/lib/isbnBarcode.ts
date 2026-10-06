import { looksLikeIsbnQuery, normalizeIsbn } from "@scripta/shared";

export function isbnFromBarcode(data: string): string {
  return looksLikeIsbnQuery(data) ? normalizeIsbn(data).toUpperCase() : "";
}
