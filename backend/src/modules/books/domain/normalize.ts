import { canonicalIsbn, cleanCatalogText, firstAuthor, normalizeIsbn, normalizeTitle, normalizeWords, titleNumbers } from "@scripta/shared";
import type { BooksRepository } from "./ports.js";
import type { BookRow } from "./types.js";

export { normalizeTitle, normalizeWords } from "@scripta/shared";

const MAX_SEARCH_TOKENS = 8;
export const PORTUGAL_ISBN13_PREFIXES = ["978972", "978989"];
export const PORTUGAL_ISBN10_PREFIXES = ["972", "989"];
export const BRAZIL_ISBN13_PREFIXES = ["97885", "97865"];
export const BRAZIL_ISBN10_PREFIXES = ["85", "65"];
const PORTUGUESE_ISBN13_PREFIXES = [...BRAZIL_ISBN13_PREFIXES, ...PORTUGAL_ISBN13_PREFIXES];
const PORTUGUESE_ISBN10_PREFIXES = [...BRAZIL_ISBN10_PREFIXES, ...PORTUGAL_ISBN10_PREFIXES];

const MARC_LANGUAGES = new Map([
  ["eng", "en"],
  ["por", "pt"],
  ["spa", "es"],
  ["fre", "fr"],
  ["ger", "de"],
  ["ita", "it"],
  ["dut", "nl"],
  ["cat", "ca"],
  ["glg", "gl"],
  ["jpn", "ja"],
  ["chi", "zh"],
  ["rus", "ru"]
]);

export const SEARCH_LIMIT = 12;
export const WORK_SEARCH_LIMIT = 20;
export const WORK_SCAN_LIMIT = 100;
export const MIN_PREFIX_LENGTH = 3;

export function normalizeWorkKey(raw: string | null | undefined): string | null {
  const key = raw?.replace(/^\/works\//, "") ?? "";
  return /^OL\d+W$/.test(key) ? key : null;
}

export interface BookLookup {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}

export interface BookIdentity {
  key: string;
  aliasKeys: string[];
  titleKey: string | null;
  isbn: string | null;
  title: string;
  author: string;
}

export function titleMatches(wanted: string, candidate: string): boolean {
  const normalized = normalizeTitle(wanted);
  return normalized !== "" && normalized === normalizeTitle(candidate);
}

export function checksumOk(digits: string): boolean {
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

export function isbn10Ok(digits: string): boolean {
  const sum = [...digits].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
  return sum % 11 === 0;
}

export function isValidIsbn(raw: string): boolean {
  const compact = raw.replace(/[-\s]/g, "").toUpperCase();
  if (/^\d{13}$/.test(compact)) return checksumOk(compact);
  return /^\d{9}[\dX]$/.test(compact) && isbn10Ok(compact);
}

function hasIsbnPrefix(isbn: string | null, prefixes13: string[], prefixes10: string[]): boolean {
  const normalized = normalizeIsbn(isbn ?? "");
  const prefixes = normalized.length === 13 ? prefixes13 : prefixes10;
  return normalized !== "" && prefixes.some((prefix) => normalized.startsWith(prefix));
}

export function isPortugueseIsbn(isbn: string | null): boolean {
  return hasIsbnPrefix(isbn, PORTUGUESE_ISBN13_PREFIXES, PORTUGUESE_ISBN10_PREFIXES);
}

export function isPortugalIsbn(isbn: string | null): boolean {
  return hasIsbnPrefix(isbn, PORTUGAL_ISBN13_PREFIXES, PORTUGAL_ISBN10_PREFIXES);
}

export function editionLanguage(marcCodes: string[], isbn: string | null): string | null {
  const tag = marcCodes.map((code) => MARC_LANGUAGES.get(code.replace(/^\/languages\//, ""))).find(Boolean) ?? null;
  if (tag !== "pt") return tag;
  if (isPortugalIsbn(isbn)) return "pt-PT";
  return hasIsbnPrefix(isbn, BRAZIL_ISBN13_PREFIXES, BRAZIL_ISBN10_PREFIXES) ? "pt-BR" : "pt";
}

export function authorMatches(wantedAttribution: string, candidateAuthors: string[]): boolean {
  const candidateWords = new Set(candidateAuthors.flatMap((name) => normalizeWords(name).split(" ").filter(Boolean)));
  return wantedAttribution.split(",").some((name) => {
    const last = normalizeWords(name).split(" ").filter(Boolean).at(-1);
    return last !== undefined && candidateWords.has(last);
  });
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|inc|llc|ltd)\.?$/i;

export function givenNameFirst(name: string): string {
  const parts = name.split(",");
  if (parts.length !== 2) return name;
  const surname = parts[0]!.trim();
  const given = parts[1]!.trim();
  return surname && !/\s/.test(surname) && given && !NAME_SUFFIX.test(given) ? `${given} ${surname}` : name;
}

export function searchTokens(query: string): string[] {
  return normalizeWords(query).split(" ").filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
}

export function catalogTitleKey(title: string, author: string): string | null {
  const main = normalizeTitle(title);
  return main ? `ta:${main}|${firstAuthor(author)}|${titleNumbers(title)}` : null;
}

export function workTitleKey(title: string, author: string): string {
  return firstAuthor(author) ? catalogTitleKey(title, author) ?? "" : "";
}

export function lookupIdentity(lookup: BookLookup): BookIdentity | null {
  const raw = normalizeIsbn(lookup.isbn ?? "").toUpperCase();
  const isbn = canonicalIsbn(raw) || null;
  const title = cleanCatalogText(lookup.title ?? "").trim();
  const author = cleanCatalogText(lookup.author ?? "").trim();
  const titleKey = catalogTitleKey(title, author);
  if (isbn) return { key: `isbn:${isbn}`, aliasKeys: raw.length === 10 ? [`isbn:${raw}`] : [], titleKey, isbn, title, author };
  return titleKey ? { key: titleKey, aliasKeys: [], titleKey, isbn: null, title, author } : null;
}

export function findByIdentity(repo: Pick<BooksRepository, "findBookByKey">, identity: BookIdentity): BookRow | undefined {
  for (const key of [identity.key, ...identity.aliasKeys]) {
    const found = repo.findBookByKey(key);
    if (found) return found;
  }
  return identity.titleKey && identity.titleKey !== identity.key ? repo.findBookByKey(identity.titleKey) : undefined;
}
