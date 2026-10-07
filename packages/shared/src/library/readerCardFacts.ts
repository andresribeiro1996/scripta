import { isEligiblePassage } from "../murals/home.js";
import type { IdentityKey } from "../readerCards/plates.js";
import { genresForBook } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { parseBookDate } from "./libraryView.js";
import { bookKey } from "./merge.js";
import { GENRE_SIGNALS, publicReaderCard, readerIdentity, uniqueFinished, type GenreIdentity, type PublicReaderCard } from "./readerIdentity.js";

type Book = Record<string, unknown>;

export type DialGroup = GenreIdentity | "other" | "unknown";
export interface DialSegment { group: DialGroup; books: number; marked: number }
export interface ReaderCardFacts {
  dial: { segments: DialSegment[] };
  facts: { finished: number; highlights: number; series: number; since: number | null; edition: number };
}

export function readerCardFacts(books: Book[], groups: Group[], identity: IdentityKey | null, now: Date = new Date()): ReaderCardFacts {
  const finished = uniqueFinished(books);
  const lead = GENRE_SIGNALS.find((signal) => signal.key === identity);
  const order = lead ? [lead, ...GENRE_SIGNALS.filter((signal) => signal !== lead)] : GENRE_SIGNALS;
  const tally = new Map<DialGroup, DialSegment>();
  let highlights = 0;
  let since: number | null = null;
  for (const book of finished) {
    const passages = Array.isArray(book.highlights) ? book.highlights.filter(isEligiblePassage).length : 0;
    highlights += passages;
    const genres = genresForBook(book);
    const group: DialGroup = order.find((signal) => genres.some((genre) => signal.genres.includes(genre)))?.key ?? (genres.length > 0 ? "other" : "unknown");
    const segment = tally.get(group) ?? { group, books: 0, marked: 0 };
    segment.books += 1;
    if (passages > 0) segment.marked += 1;
    tally.set(group, segment);
    const year = parseBookDate(book.DateLastRead)?.getFullYear();
    if (year !== undefined && (since === null || year < since)) since = year;
  }
  const keys = new Set(finished.map(bookKey));
  const series = groups.filter((group) => group.type === "series" && group.bookKeys.some((key) => keys.has(key))).length;
  const segmentOrder: DialGroup[] = [...order.map((signal) => signal.key), "other", "unknown"];
  return {
    dial: { segments: segmentOrder.flatMap((group) => tally.get(group) ?? []) },
    facts: { finished: finished.length, highlights, series, since, edition: now.getFullYear() },
  };
}

export function publicReaderCardOf(books: Book[], groups: Group[], now: Date = new Date()): PublicReaderCard {
  const identity = readerIdentity(books, groups);
  return { ...publicReaderCard(identity), ...readerCardFacts(books, groups, identity.identity, now) };
}
