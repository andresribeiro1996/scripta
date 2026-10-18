import { isValidIsbn } from "../../domain/normalize.js";
import type { CoverCandidate, CoverSource, TitledCandidate } from "../../domain/ports.js";
import type { Spend } from "../../typesafe.js";
import { fetchJson, type Throttle } from "../http/http.js";
import type { IsbndbGate } from "../isbndb/isbndbGate.js";

const MAX_TITLE_QUERY = 150;

function titleQuery(title: string): string {
  if (title.length <= MAX_TITLE_QUERY) return title;
  const head = title.slice(0, MAX_TITLE_QUERY + 1);
  const space = head.lastIndexOf(" ");
  return space > 0 ? head.slice(0, space) : head.slice(0, MAX_TITLE_QUERY);
}

const strip = ({ source, url }: TitledCandidate): CoverCandidate => ({ source, url });

export function isbndbRecords(json: unknown): Array<Record<string, unknown>> {
  if (!json || typeof json !== "object") return [];
  const record = json as { book?: unknown; books?: unknown };
  const list: unknown[] = Array.isArray(record.books) ? record.books : record.book ? [record.book] : [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

export function createIsbndbGet(apiKey: string, throttle: Throttle, gate: IsbndbGate, urgent = false, spend?: Spend) {
  return (url: string) =>
    gate.run(() => throttle(() => gate.run(() => {
      spend?.();
      return fetchJson("isbndb", url, { Authorization: apiKey });
    }), { urgent }));
}

export function parseIsbndbBooks(json: unknown): TitledCandidate[] {
  return isbndbRecords(json).flatMap((book) => {
    const url = typeof book.image_original === "string" ? book.image_original : typeof book.image === "string" ? book.image : null;
    if (!url) return [];
    const authors = Array.isArray(book.authors) ? book.authors.filter((name): name is string => typeof name === "string") : [];
    return [{ source: "isbndb" as const, url, title: typeof book.title === "string" ? book.title : "", authors }];
  });
}

export function createIsbndbSource(apiKey: string, throttle: Throttle, gate: IsbndbGate, spend?: Spend): CoverSource {
  const get = createIsbndbGet(apiKey, throttle, gate, false, spend);
  return {
    async byIsbn(isbn) {
      if (!isValidIsbn(isbn)) return [];
      return parseIsbndbBooks(await get(`https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`)).map(strip);
    },
    async byTitle(title, _author, accept) {
      const url = `https://api2.isbndb.com/books/${encodeURIComponent(titleQuery(title))}?page=1&pageSize=20&column=title`;
      return parseIsbndbBooks(await get(url)).filter(accept).map(strip);
    }
  };
}
