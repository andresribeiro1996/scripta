import { isCharacterBook, workIdOf } from "@scripta/shared";
import type { Locale } from "@scripta/shared/i18n";
import { translatorFor } from "../../i18n";

export type TierBook = Record<string, unknown>;

export function titleOf(book: TierBook, locale: Locale) { return String(book.Title ?? book.title ?? translatorFor(locale)("library.untitled")); }
export function authorOf(book: TierBook, locale: Locale) { return isCharacterBook(book) ? "" : String(book.Attribution ?? book.author ?? translatorFor(locale)("tierlists.unknownAuthor")); }
export function labelOf(book: TierBook, locale: Locale) { return isCharacterBook(book) ? titleOf(book, locale) : translatorFor(locale)("arena.titleByAuthor", { title: titleOf(book, locale), author: authorOf(book, locale) }); }
export function workOf(book: TierBook): string | undefined {
  return workIdOf(book);
}
