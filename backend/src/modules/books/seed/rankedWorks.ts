import { normalizeIsbn } from "@scripta/shared";

export type SeedLanguage = "eng" | "por";

export interface SeedEntry {
  isbn: string;
  title: string;
  author: string;
  lang: SeedLanguage;
  workKey: string;
  readers: number;
  subjects: string[];
}

export const PORTUGAL_ISBN_PREFIXES = ["978972", "978989"] as const;

const MAX_SUBJECTS = 10;
const FIELDS = "key,title,author_name,readinglog_count,subject,editions,editions.title,editions.isbn,editions.language";

export function rankedWorksUrl(lang: SeedLanguage, offset: number, limit: number, isbnPrefix?: string): string {
  const params = new URLSearchParams({ q: isbnPrefix ? `isbn:${isbnPrefix}*` : `language:${lang}`, lang, sort: "readinglog", offset: String(offset), limit: String(limit), fields: FIELDS });
  return `https://openlibrary.org/search.json?${params}`;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function pickIsbn(raw: string[], isbnPrefix?: string): string {
  const valid = raw.map(normalizeIsbn).filter((isbn) => isbn && (!isbnPrefix || isbn.startsWith(isbnPrefix)));
  return valid.find((isbn) => isbn.length === 13) ?? valid[0] ?? "";
}

export function parseRankedWorks(json: unknown, lang: SeedLanguage, isbnPrefix?: string): SeedEntry[] {
  const docs = json && typeof json === "object" ? (json as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) return [];
  return docs.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const work = item as Record<string, unknown>;
    const editions = work.editions && typeof work.editions === "object" ? (work.editions as { docs?: unknown }).docs : undefined;
    const edition = Array.isArray(editions) && editions[0] && typeof editions[0] === "object" ? (editions[0] as Record<string, unknown>) : null;
    if (edition && !isbnPrefix && !strings(edition.language).includes(lang)) return [];
    const isbn = edition ? pickIsbn(strings(edition.isbn), isbnPrefix) : "";
    const title = (typeof edition?.title === "string" && edition.title) || (typeof work.title === "string" ? work.title : "");
    const author = strings(work.author_name)[0] ?? "";
    if (!isbn || !title || typeof work.key !== "string") return [];
    return [{
      isbn,
      title,
      author,
      lang,
      workKey: work.key,
      readers: typeof work.readinglog_count === "number" ? work.readinglog_count : 0,
      subjects: strings(work.subject).slice(0, MAX_SUBJECTS)
    }];
  });
}
