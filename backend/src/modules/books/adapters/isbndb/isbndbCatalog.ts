import { normalizeBookGenres, normalizeIsbn, type BookSearchResult } from "@scripta/shared";
import type { BookCatalog } from "../../domain/ports.js";
import type { Throttle } from "../http/http.js";
import { createIsbndbGet, isbndbRecords } from "../sources/isbndb.js";
import type { IsbndbGate } from "./isbndbGate.js";

const API = "https://api2.isbndb.com";
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

function plainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<\s*(?:br|\/p)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]!)
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return text || null;
}

function yearOf(value: unknown): number | null {
  const year = typeof value === "string" ? /^\d{4}/.exec(value)?.[0] : undefined;
  return year ? Number(year) : null;
}

function isbnOf(record: Record<string, unknown>): string | null {
  return normalizeIsbn(record.isbn13) || normalizeIsbn(record.isbn) || null;
}

function toResult(record: Record<string, unknown>): BookSearchResult | null {
  const title = plainText(record.title);
  if (!title) return null;
  return {
    title,
    authors: Array.isArray(record.authors) ? record.authors.filter((name): name is string => typeof name === "string" && name.trim() !== "") : [],
    year: yearOf(record.date_published),
    isbn: isbnOf(record),
    publisher: plainText(record.publisher),
    coverUrl: null,
    genres: normalizeBookGenres(record.subjects)
  };
}

export function createIsbndbCatalog(apiKey: string, throttle: Throttle, gate: IsbndbGate): BookCatalog {
  const get = createIsbndbGet(apiKey, throttle, gate, true);
  return {
    async fetchDetails({ isbn }) {
      if (!isbn) return null;
      const [record] = isbndbRecords(await get(`${API}/book/${encodeURIComponent(isbn)}`));
      if (!record) return null;
      const summary = plainText(record.synopsis) ?? plainText(record.overview);
      const genres = normalizeBookGenres(record.subjects);
      const pages = typeof record.pages === "number" && Number.isInteger(record.pages) && record.pages > 0 ? record.pages : null;
      const year = yearOf(record.date_published);
      const publisher = plainText(record.publisher);
      if (!summary && genres.length === 0 && pages === null && year === null && !publisher) return null;
      return {
        metadata: { summary, rating: null, ratingCount: 0, sourceUrl: `https://isbndb.com/book/${isbnOf(record) ?? isbn}`, genres, pages, publisher, year, translator: null },
        sources: ["isbndb"],
        summarySource: summary ? "isbndb" : null
      };
    },

    async search(query) {
      const url = "isbn" in query
        ? `${API}/book/${encodeURIComponent(query.isbn)}`
        : `${API}/books/${encodeURIComponent(query.text)}?page=1&pageSize=20`;
      return isbndbRecords(await get(url)).flatMap((record) => {
        const result = toResult(record);
        return result ? [{ result, olCoverId: null, source: "isbndb" as const }] : [];
      });
    }
  };
}
