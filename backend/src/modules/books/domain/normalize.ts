import { normalizeIsbn } from "@scripta/shared";

const MAX_SEARCH_TOKENS = 8;

export interface BookLookup {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}

export interface BookIdentity {
  key: string;
  isbn: string | null;
  title: string;
  author: string;
}

export function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeTitle(value: string): string {
  const withoutBrackets = value.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  return normalizeWords(withoutBrackets.split(":")[0] ?? "");
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

export function lookupIdentity(lookup: BookLookup): BookIdentity | null {
  const isbn = normalizeIsbn(lookup.isbn ?? "") || null;
  const title = (lookup.title ?? "").trim();
  const author = (lookup.author ?? "").trim();
  if (isbn) return { key: `isbn:${isbn}`, isbn, title, author };
  const normalized = normalizeTitle(title);
  return normalized ? { key: `ta:${normalized}|${normalizeWords(author)}`, isbn: null, title, author } : null;
}
