import { firstAuthor, normalizeIsbn, normalizeTitle, normalizeWords, titleNumbers } from "@scripta/shared";
import type { BooksRepository } from "./ports.js";
import type { BookRow } from "./types.js";

export { normalizeTitle, normalizeWords } from "@scripta/shared";

const MAX_SEARCH_TOKENS = 8;

export const SEARCH_LIMIT = 12;

export interface BookLookup {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}

export interface BookIdentity {
  key: string;
  titleKey: string | null;
  isbn: string | null;
  title: string;
  author: string;
}

export function titleMatches(wanted: string, candidate: string): boolean {
  const normalized = normalizeTitle(wanted);
  return normalized !== "" && normalized === normalizeTitle(candidate);
}

export function authorMatches(wantedAttribution: string, candidateAuthors: string[]): boolean {
  const candidateWords = new Set(candidateAuthors.flatMap((name) => normalizeWords(name).split(" ").filter(Boolean)));
  return wantedAttribution.split(",").some((name) => {
    const last = normalizeWords(name).split(" ").filter(Boolean).at(-1);
    return last !== undefined && candidateWords.has(last);
  });
}

export function searchTokens(query: string): string[] {
  return normalizeWords(query).split(" ").filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
}

export function catalogTitleKey(title: string, author: string): string | null {
  const main = normalizeTitle(title);
  return main ? `ta:${main}|${firstAuthor(author)}|${titleNumbers(title)}` : null;
}

export function lookupIdentity(lookup: BookLookup): BookIdentity | null {
  const isbn = normalizeIsbn(lookup.isbn ?? "") || null;
  const title = (lookup.title ?? "").trim();
  const author = (lookup.author ?? "").trim();
  const titleKey = catalogTitleKey(title, author);
  if (isbn) return { key: `isbn:${isbn}`, titleKey, isbn, title, author };
  return titleKey ? { key: titleKey, titleKey, isbn: null, title, author } : null;
}

export function findByIdentity(repo: Pick<BooksRepository, "findBookByKey">, identity: BookIdentity): BookRow | undefined {
  return repo.findBookByKey(identity.key) ?? (identity.titleKey && identity.titleKey !== identity.key ? repo.findBookByKey(identity.titleKey) : undefined);
}
