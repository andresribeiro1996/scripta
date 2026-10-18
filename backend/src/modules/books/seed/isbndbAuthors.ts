import type { DatabaseSync } from "node:sqlite";
import { canonicalIsbn } from "@scripta/shared";
import { SourcePausedError, SourceUnavailableError } from "../domain/errors.js";
import { fillMissingIdentity } from "../domain/findOrCreate.js";
import { normalizeWords } from "../domain/normalize.js";
import type { BookCatalog, BooksRepository } from "../domain/ports.js";
import { sameTitle } from "./importPublisherCovers.js";
import { cleanCredit } from "./publisherFeed.js";

export interface IsbndbAuthorPlan {
  selected: number;
  noRecord: number;
  noAuthor: number;
  titleMismatch: number;
  placeholder: number;
  commaName: number;
  mismatches: Array<{ id: string; title: string; isbndbTitle: string }>;
  next: string | null;
  isbndb: { max: number; asked: number; unavailable: number; notAsked: number; pausedUntil: string | null };
  fills: Array<{ id: string; isbn: string; title: string; author: string }>;
}

const TRANSLATOR_MARK = /\(\s*(trad|transl)/i;

const TARGETS_SQL = `SELECT id, title, isbn, translator FROM books WHERE author = '' AND title <> '' AND isbn IS NOT NULL AND isbn <> '' AND id > ? ORDER BY id`;

export async function planIsbndbAuthors(db: DatabaseSync, isbndb: Pick<BookCatalog, "search">, options: { max: number; after: string }): Promise<IsbndbAuthorPlan> {
  const targets = db.prepare(TARGETS_SQL).all(options.after) as unknown as Array<{ id: string; title: string; isbn: string; translator: string | null }>;
  const plan: IsbndbAuthorPlan = { selected: targets.length, noRecord: 0, noAuthor: 0, titleMismatch: 0, placeholder: 0, commaName: 0, mismatches: [], next: options.after || null, isbndb: { max: options.max, asked: 0, unavailable: 0, notAsked: 0, pausedUntil: null }, fills: [] };
  for (const book of targets) {
    const isbn = canonicalIsbn(book.isbn);
    if (plan.isbndb.asked >= options.max) break;
    if (!isbn) {
      plan.next = book.id;
      continue;
    }
    plan.isbndb.asked++;
    let hit;
    try {
      hit = (await isbndb.search({ isbn }))[0]?.result;
    } catch (error) {
      if (error instanceof SourcePausedError) plan.isbndb.pausedUntil = new Date(error.retryAt).toISOString();
      else if (error instanceof SourceUnavailableError) plan.isbndb.unavailable++;
      else throw error;
      plan.isbndb.asked--;
      break;
    }
    plan.next = book.id;
    if (!hit) plan.noRecord++;
    else if (hit.authors.length === 0) plan.noAuthor++;
    else if (!sameTitle(book.title, hit.title)) {
      plan.titleMismatch++;
      plan.mismatches.push({ id: book.id, title: book.title, isbndbTitle: hit.title });
    } else if (hit.authors.some((name) => name.includes(","))) plan.commaName++;
    else {
      const translators = new Set((book.translator ?? "").split(", ").map(normalizeWords).filter(Boolean));
      const names = hit.authors.filter((name) => !TRANSLATOR_MARK.test(name) && !translators.has(normalizeWords(cleanCredit(name) ?? "")));
      const author = cleanCredit(names.join(", "));
      if (author) plan.fills.push({ id: book.id, isbn, title: book.title, author });
      else plan.placeholder++;
    }
  }
  plan.isbndb.notAsked = targets.length - targets.findIndex((book) => book.id === plan.next) - 1;
  return plan;
}

export function applyIsbndbAuthors(repo: Pick<BooksRepository, "getBook" | "findBookByKey" | "addKey" | "fillIdentity">, plan: IsbndbAuthorPlan): number {
  let applied = 0;
  for (const fill of plan.fills) {
    const row = repo.getBook(fill.id);
    if (row && fillMissingIdentity(repo, row, row.title, fill.author)) applied++;
  }
  return applied;
}

export function isbndbAuthorReport(plan: IsbndbAuthorPlan, applied: number | null) {
  return { ...plan, wouldFill: plan.fills.length, applied };
}
