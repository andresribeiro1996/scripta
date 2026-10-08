import { isEligiblePassage } from "../murals/home.js";
import { readerCardLabel, readerCardPlateLine } from "../readerCards/card.js";
import type { IdentityKey } from "../readerCards/plates.js";
import type { ReaderCardBase } from "../readerCards/render.js";
import { seedOf } from "../readerCards/seed.js";
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, publicStyle, type ReaderCardChosen, type ReaderCardStyle } from "../readerCards/style.js";
import { genresForBook } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { parseBookDate } from "./libraryView.js";
import { bookKey } from "./merge.js";
import { bookLabel, bookPassages } from "./passages.js";
import { GENRE_SIGNALS, publicReaderCard, readerIdentity, uniqueFinished, type GenreIdentity, type PublicReaderCard } from "./readerIdentity.js";

type Book = Record<string, unknown>;

export type DialGroup = GenreIdentity | "other" | "unknown";
export interface DialSegment { group: DialGroup; books: number; marked: number }
export interface ReaderCardFacts {
  dial: { segments: DialSegment[] };
  facts: { finished: number; highlights: number; series: number; since: number | null; edition: number; readerNumber?: number };
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

export type CoverOf = (book: Book) => string | null;
export interface OwnCardStyle { style: ReaderCardStyle; coverOf: CoverOf; readerNumber?: number | null }

export function ownChosen(books: Book[], style: ReaderCardStyle, coverOf: CoverOf): ReaderCardChosen {
  const chosen: ReaderCardChosen = {};
  const { signature, highlight } = style;
  const signed = signature ? books.find((item) => bookKey(item) === signature.bookKey) : undefined;
  if (signature && signed) chosen.signature = { ...bookLabel(signed), workId: null, coverUrl: coverOf(signed), note: signature.note };
  const marked = highlight ? books.find((item) => bookKey(item) === highlight.bookKey) : undefined;
  const passage = highlight && marked ? bookPassages(marked).find((item) => item.highlightId === highlight.highlightId) : undefined;
  if (passage) chosen.highlight = { text: passage.text, title: passage.title, author: passage.author };
  return chosen;
}

export function readerCardInputOf(books: Book[], groups: Group[], readerName: string, override?: PublicReaderCard, own?: OwnCardStyle): ReaderCardBase {
  const seed = seedOf(readerName);
  if (override) {
    return { card: override, style: publicStyle(normalizeReaderCardStyle(override.style)), view: "visitor", readerName, label: readerCardLabel(override), unwrittenLine: "yet to be written", seed };
  }
  const identity = readerIdentity(books, groups);
  const facts = readerCardFacts(books, groups, identity.identity);
  const card: PublicReaderCard = { ...publicReaderCard(identity), ...facts, ...(own?.readerNumber ? { facts: { ...facts.facts, readerNumber: own.readerNumber } } : {}), ...(own ? { chosen: ownChosen(books, own.style, own.coverOf) } : {}) };
  return { card, style: publicStyle(own?.style ?? DEFAULT_READER_CARD_STYLE), view: "owner", leaders: identity.leaders, missing: identity.missing, readerName, label: readerCardLabel(card), unwrittenLine: readerCardPlateLine(identity.missing), seed };
}

export function visitorView(input: ReaderCardBase): ReaderCardBase {
  return readerCardInputOf([], [], input.readerName, { ...input.card, style: input.style });
}
