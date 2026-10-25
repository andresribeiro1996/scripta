import { BOOK_GENRES, canonicalIsbn, htmlToText, normalizeBookGenres, type BookGenre } from "@scripta/shared";
import { SourceUnavailableError } from "../../domain/errors.js";
import { createThrottle, postJson, type Throttle } from "../http/http.js";
import { realSleep, type Sleep } from "../typesafe/jevRequest.js";

export const HARDCOVER_ENDPOINT = "https://api.hardcover.app/v1/graphql";
export const HARDCOVER_PAGE_SIZE = 50;
export const GENRE_MIN_COUNT = 2;
export const GENRE_LIMIT = 2;

const SOURCE = "hardcover";
const REQUEST_GAP_MS = 1100;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_MS = 120_000;
const NO_RETRY_AFTER_WAIT_MS = 60_000;
const RATE_LIMIT_ATTEMPTS = 3;
const TRANSIENT_RETRIES = 3;
const TRANSIENT_WAIT_MS = 30_000;
const COMBINED_TAG = /science fiction (&|and) fantasy/i;

const EDITIONS_QUERY = `query Editions($i13: [String!]!, $i10: [String!]!) {
  editions(where: { _or: [{ isbn_13: { _in: $i13 } }, { isbn_10: { _in: $i10 } }] }) {
    isbn_13
    isbn_10
    book {
      id
      book_status_id
      canonical_id
      description
      cached_tags
      cached_featured_series
    }
  }
}`;

export type HardcoverSeries = { name: string; position: number | null; compilation: boolean };
export type HardcoverBook = {
  id: number;
  usable: boolean;
  description: string | null;
  genreTags: Array<{ tag: string; count: number }>;
  featured: HardcoverSeries | null;
  series: HardcoverSeries[];
};
export type HardcoverEdition = { isbn13: string | null; book: HardcoverBook };
export type HardcoverLookup = (isbn13s: string[]) => Promise<HardcoverEdition[]>;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isbn13To10(isbn13: string): string | null {
  if (!/^978\d{10}$/.test(isbn13)) return null;
  const body = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (10 - i) * Number(body[i]);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? "X" : String(check));
}

export function editionsQuery(isbn13s: string[]): { query: string; variables: { i13: string[]; i10: string[] } } {
  const i10 = isbn13s.map(isbn13To10).filter((isbn): isbn is string => isbn !== null);
  return { query: EDITIONS_QUERY, variables: { i13: isbn13s, i10 } };
}

function featuredOf(raw: unknown): HardcoverSeries | null {
  if (!isRow(raw) || !isRow(raw.series)) return null;
  const name = raw.series.name;
  if (typeof name !== "string" || name.trim() === "") return null;
  return { name, position: typeof raw.position === "number" ? raw.position : null, compilation: raw.collection === true };
}

function genreTagsOf(raw: unknown): Array<{ tag: string; count: number }> {
  if (!isRow(raw) || !Array.isArray(raw.Genre)) return [];
  const tags: Array<{ tag: string; count: number }> = [];
  for (const entry of raw.Genre) {
    if (isRow(entry) && typeof entry.tag === "string" && typeof entry.count === "number") tags.push({ tag: entry.tag, count: entry.count });
  }
  return tags;
}

export function parseEditions(data: unknown): HardcoverEdition[] {
  if (!isRow(data)) throw new SourceUnavailableError(SOURCE, "unexpected response");
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const first = data.errors[0];
    const message = isRow(first) && typeof first.message === "string" ? first.message : "unknown error";
    throw new SourceUnavailableError(SOURCE, `GraphQL: ${message}`);
  }
  const editions = isRow(data.data) ? data.data.editions : undefined;
  if (!Array.isArray(editions)) throw new SourceUnavailableError(SOURCE, "unexpected response");
  const parsed: HardcoverEdition[] = [];
  for (const edition of editions) {
    if (!isRow(edition)) throw new SourceUnavailableError(SOURCE, "unexpected response");
    if (edition.book === null) continue;
    const book = edition.book;
    if (!isRow(book) || typeof book.id !== "number") throw new SourceUnavailableError(SOURCE, "unexpected response");
    const isbn13 = (typeof edition.isbn_13 === "string" ? canonicalIsbn(edition.isbn_13) : "") || canonicalIsbn(edition.isbn_10) || null;
    parsed.push({
      isbn13,
      book: {
        id: book.id,
        usable: book.book_status_id === 1 && book.canonical_id == null,
        description: typeof book.description === "string" ? book.description : null,
        genreTags: genreTagsOf(book.cached_tags),
        featured: featuredOf(book.cached_featured_series),
        series: []
      }
    });
  }
  return parsed;
}

export function featuredSeriesOf(book: HardcoverBook): HardcoverSeries | null {
  if (book.featured) return book.featured;
  return book.series.length === 1 ? (book.series[0] ?? null) : null;
}

export function seriesPosition(position: number | null): string | null {
  return position === null ? null : String(position);
}

export function genresFromTags(tags: Array<{ tag: string; count: number }>): BookGenre[] {
  const chosen: BookGenre[] = [];
  const ranked = tags.filter(({ tag, count }) => !COMBINED_TAG.test(tag) && count >= GENRE_MIN_COUNT).sort((a, b) => b.count - a.count);
  for (const { tag } of ranked) {
    for (const genre of normalizeBookGenres([tag])) {
      if (chosen.length < GENRE_LIMIT && !chosen.includes(genre)) chosen.push(genre);
    }
  }
  return BOOK_GENRES.filter((genre) => chosen.includes(genre));
}

export function descriptionText(raw: string | null): string | null {
  if (raw === null) return null;
  return htmlToText(raw).trim() || null;
}

function isTransient(error: SourceUnavailableError): boolean {
  return error.status === undefined || error.status >= 500 || error.status === 408;
}

export function createHardcoverLookup(
  token: string,
  deps: { post?: typeof postJson; throttle?: Throttle; sleep?: Sleep; now?: () => number } = {}
): HardcoverLookup {
  const post = deps.post ?? postJson;
  const throttle = deps.throttle ?? createThrottle(REQUEST_GAP_MS);
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const headers = { Authorization: `Bearer ${token}` };

  return async (isbn13s) => {
    const body = editionsQuery(isbn13s);
    let rateLimited = 0;
    let retries = 0;
    let data: unknown;
    for (;;) {
      try {
        data = await throttle(() => post(SOURCE, HARDCOVER_ENDPOINT, body, headers, REQUEST_TIMEOUT_MS));
        break;
      } catch (error) {
        if (!(error instanceof SourceUnavailableError)) throw error;
        if (error.status === 429) {
          const wait = error.retryAt === undefined ? NO_RETRY_AFTER_WAIT_MS : Math.max(0, error.retryAt - now());
          if (wait > MAX_RETRY_WAIT_MS) {
            throw new SourceUnavailableError(SOURCE, "daily quota spent", { status: 429, retryAt: error.retryAt, quota: true });
          }
          rateLimited += 1;
          if (rateLimited >= RATE_LIMIT_ATTEMPTS) throw error;
          await sleep(wait);
          continue;
        }
        if (!isTransient(error) || retries >= TRANSIENT_RETRIES) throw error;
        retries += 1;
        await sleep(TRANSIENT_WAIT_MS);
      }
    }
    return parseEditions(data);
  };
}
