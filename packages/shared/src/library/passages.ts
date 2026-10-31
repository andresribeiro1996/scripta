import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { isEligiblePassage } from "../murals/home.js";
import { bookKey } from "./merge.js";

type Book = Record<string, unknown>;

export interface Passage { bookKey: string; highlightId: string; text: string; title: string; author: string }

export const PASSAGE_MATCH_LIMIT = 50;

export function bookLabel(book: Book, locale: Locale): { title: string; author: string } {
  const t = sharedT(locale);
  return { title: String(book.Title ?? "").trim() || t("shared.arenaSeed.untitled"), author: String(book.Attribution ?? "").trim() || t("shared.arenaSeed.unknownAuthor") };
}

export function bookPassages(book: Book, locale: Locale): Passage[] {
  const highlights = Array.isArray(book.highlights) ? book.highlights : [];
  const key = bookKey(book);
  const { title, author } = bookLabel(book, locale);
  return highlights.filter(isEligiblePassage).map((highlight) => ({ bookKey: key, highlightId: String(highlight.BookmarkID), text: String(highlight.Text).trim(), title, author }));
}

export function searchPassages(books: Book[], query: string, locale: Locale): Passage[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: Passage[] = [];
  for (const book of books) {
    for (const passage of bookPassages(book, locale)) {
      if (!passage.text.toLowerCase().includes(needle)) continue;
      matches.push(passage);
      if (matches.length === PASSAGE_MATCH_LIMIT) return matches;
    }
  }
  return matches;
}
