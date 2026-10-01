import type { CoverCandidate, CoverSource, TitledCandidate } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";
import type { IsbndbGate } from "../isbndb/isbndbGate.js";

const strip = ({ source, url }: TitledCandidate): CoverCandidate => ({ source, url });

export function isbndbRecords(json: unknown): Array<Record<string, unknown>> {
  if (!json || typeof json !== "object") return [];
  const record = json as { book?: unknown; books?: unknown };
  const list: unknown[] = Array.isArray(record.books) ? record.books : record.book ? [record.book] : [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

export function createIsbndbGet(apiKey: string, throttle: Throttle, gate: IsbndbGate, urgent = false) {
  return (url: string) =>
    gate.run(() => throttle(() => gate.run(() => fetchJson("isbndb", url, { Authorization: apiKey })), { urgent }));
}

export function parseIsbndbBooks(json: unknown): TitledCandidate[] {
  return isbndbRecords(json).flatMap((book) => {
    const url = typeof book.image_original === "string" ? book.image_original : typeof book.image === "string" ? book.image : null;
    if (!url) return [];
    const authors = Array.isArray(book.authors) ? book.authors.filter((name): name is string => typeof name === "string") : [];
    return [{ source: "isbndb" as const, url, title: typeof book.title === "string" ? book.title : "", authors }];
  });
}

export function createIsbndbSource(apiKey: string, throttle: Throttle, gate: IsbndbGate): CoverSource {
  const get = createIsbndbGet(apiKey, throttle, gate);
  return {
    async byIsbn(isbn) {
      return parseIsbndbBooks(await get(`https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`)).map(strip);
    },
    async byTitle(title, _author, accept) {
      const url = `https://api2.isbndb.com/books/${encodeURIComponent(title)}?page=1&pageSize=20&column=title`;
      return parseIsbndbBooks(await get(url)).filter(accept).map(strip);
    }
  };
}
