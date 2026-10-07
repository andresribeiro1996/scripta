import { READER_PLATES, type CardState, type IdentityKey } from "../readerCards/index.js";
import type { PublicReaderCardStyle, ReaderCardChosen } from "../readerCards/style.js";
import { genresForBook, isFinishedBook, type BookGenre } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { bookKey } from "./merge.js";
import type { ReaderCardFacts } from "./readerCardFacts.js";

type Book = Record<string, unknown>;

export type GenreIdentity = "lamp" | "star" | "arch" | "corr";

export interface ReaderSignal { counted: number; of: number; label: string }
export interface ReaderLeader { label: string; count: number }
export interface ReaderIdentity {
  state: CardState;
  identity: IdentityKey | null;
  runnerUp: IdentityKey | null;
  streak: IdentityKey | null;
  signal: ReaderSignal | null;
  leaders: ReaderLeader[];
  coverage: string[];
  missing: string | null;
}
export type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage"> & Partial<Pick<ReaderIdentity, "streak">> & Partial<ReaderCardFacts> & { style?: PublicReaderCardStyle; chosen?: ReaderCardChosen };

interface Candidate { key: IdentityKey; strength: number; signal: ReaderSignal; leaders: ReaderLeader[]; gap: string }

const EPSILON = 1e-9;
const MIN_BOOKS = 5;

export const GENRE_SIGNALS: Array<{ key: GenreIdentity; genres: BookGenre[]; threshold: number; words: string }> = [
  { key: "lamp", genres: ["Mystery", "Crime", "Thriller", "Horror"], threshold: 0.35, words: "mystery, crime, thriller or horror" },
  { key: "star", genres: ["Fantasy", "Science Fiction"], threshold: 0.4, words: "fantasy or science fiction" },
  { key: "arch", genres: ["History", "Biography & Memoir", "Politics"], threshold: 0.35, words: "history, biography or politics" },
  { key: "corr", genres: ["Classics", "Literary Fiction", "Poetry"], threshold: 0.4, words: "classics, literary fiction or poetry" },
];

const pct = (value: number) => `${Math.floor(value * 100)}%`;
const pctUp = (value: number) => `${Math.ceil(value * 100)}%`;
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
const nameOf = (key: IdentityKey) => READER_PLATES.find((plate) => plate.key === key)!.name;
const normalizeAuthor = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function bump(counts: Map<string, number>, key: string, by = 1) {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

function top(counts: Map<string, number>, n = 3): ReaderLeader[] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([label, count]) => ({ label, count }));
}

function markCount(book: Book) {
  return (Array.isArray(book.highlights) ? book.highlights : []).filter((h) => {
    if (!h || typeof h !== "object") return false;
    const mark = h as Book;
    if (mark.Type !== "highlight" && mark.Type !== "review" && mark.Type !== "note") return false;
    return String(mark.Text ?? "").trim() !== "" || String(mark.Annotation ?? "").trim() !== "";
  }).length;
}

export function uniqueFinished(books: Book[]): Book[] {
  const seen = new Set<string>();
  return books.filter(isFinishedBook).filter((book) => {
    const key = bookKey(book);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readerIdentity(books: Book[], groups: Group[]): ReaderIdentity {
  const finished = uniqueFinished(books);
  const n = finished.length;
  const genresOf = new Map(finished.map((book) => [book, genresForBook(book)] as const));
  const known = finished.filter((book) => genresOf.get(book)!.length > 0);
  const coverage = [`genres known for ${known.length} of ${n} finished books`];
  if (finished.some((book) => /^(goodreads|storygraph):/.test(String(book.ContentID ?? "")))) coverage.push("series unknown for Goodreads and StoryGraph imports");
  const unwritten = (missing: string): ReaderIdentity => ({ state: "unwritten", identity: null, runnerUp: null, streak: null, signal: null, leaders: [], coverage, missing });
  if (n < MIN_BOOKS) return unwritten(`Finish ${plural(MIN_BOOKS - n, "more book")}`);

  const candidates: Candidate[] = [];

  const keys = new Set(finished.map(bookKey));
  const inSeries = new Set<string>();
  const seriesCounts = new Map<string, number>();
  for (const group of groups) {
    if (group.type !== "series") continue;
    for (const key of group.bookKeys) if (keys.has(key)) { inSeries.add(key); bump(seriesCounts, group.name); }
  }
  candidates.push({
    key: "carto",
    strength: Math.min(inSeries.size / n / 0.3, inSeries.size / 3),
    signal: { counted: inSeries.size, of: n, label: `${inSeries.size} of ${n} finished books are in a series` },
    leaders: top(seriesCounts),
    gap: `${pct(inSeries.size / n)} of finished books are in a series; 30% settles it`,
  });

  const marked = finished.filter((book) => markCount(book) > 0);
  const marks = finished.reduce((sum, book) => sum + markCount(book), 0);
  candidates.push({
    key: "anno",
    strength: Math.min(marked.length / n / 0.3, marks / 20),
    signal: { counted: marked.length, of: n, label: `${marked.length} of ${n} finished books have highlights or notes` },
    leaders: top(new Map(marked.map((book) => [String(book.Title ?? "Untitled"), markCount(book)] as const))),
    gap: `${pct(marked.length / n)} of finished books have highlights or notes, with ${plural(marks, "mark")}; 30% and 20 marks settle it`,
  });

  const authorCounts = new Map<string, number>();
  const authorDisplay = new Map<string, string>();
  for (const book of finished) {
    const raw = String(book.Attribution ?? "").trim();
    if (!raw) continue;
    const norm = normalizeAuthor(raw);
    if (!authorDisplay.has(norm)) authorDisplay.set(norm, raw);
    bump(authorCounts, norm);
  }
  const loyalAuthors = top(authorCounts)
    .filter((author) => author.count >= 2)
    .map((author) => ({ label: authorDisplay.get(author.label)!, count: author.count }));
  const byLoyal = loyalAuthors.reduce((sum, author) => sum + author.count, 0);
  candidates.push({
    key: "loyal",
    strength: Math.min(byLoyal / n / 0.4, byLoyal / 3),
    signal: { counted: byLoyal, of: n, label: `${byLoyal} of ${n} finished books are by authors you keep returning to` },
    leaders: loyalAuthors,
    gap: `${pct(byLoyal / n)} of finished books are by authors you keep returning to; 40% settles it`,
  });

  if (known.length * 2 >= n) {
    const m = known.length;
    const groupShares: number[] = [];
    for (const signal of GENRE_SIGNALS) {
      const matching = known.filter((book) => genresOf.get(book)!.some((genre) => signal.genres.includes(genre)));
      groupShares.push(matching.length / m);
      const genreCounts = new Map<string, number>();
      for (const book of matching) for (const genre of genresOf.get(book)!) if (signal.genres.includes(genre)) bump(genreCounts, genre);
      candidates.push({
        key: signal.key,
        strength: matching.length / m / signal.threshold,
        signal: { counted: matching.length, of: m, label: `${matching.length} of ${m} finished books with known genres are ${signal.words}` },
        leaders: top(genreCounts),
        gap: `${pct(matching.length / m)} of finished books with known genres are ${signal.words}; ${pct(signal.threshold)} settles it`,
      });
    }
    const all = new Map<string, number>();
    for (const book of known) for (const genre of genresOf.get(book)!) bump(all, genre);
    const genreShares = [...all].map(([genre, count]) => ({ label: genre, share: count / m }));
    const groupSharesNamed = GENRE_SIGNALS.map((signal, i) => ({ label: signal.words, share: groupShares[i]! }));
    const wide = genreShares.filter((entry) => entry.share > 0.05).length;
    const largest = [...genreShares, ...groupSharesNamed].reduce((a, b) => (b.share > a.share ? b : a));
    candidates.push({
      key: "way",
      strength: Math.min(wide / 6, 0.25 / largest.share),
      signal: { counted: wide, of: all.size, label: `${wide} genres above 5% of books with known genres; the largest, ${largest.label}, is ${pctUp(largest.share)}` },
      leaders: top(all),
      gap: `${plural(wide, "genre")} above 5% of books with known genres; the largest, ${largest.label}, at ${pctUp(largest.share)}; 6 genres with none over 25% settle it`,
    });
  }

  const [best, second] = [...candidates].sort((a, b) => b.strength - a.strength);
  if (!best || best.strength < 0.75 - EPSILON) {
    return unwritten(known.length * 2 < n ? `Genres known for ${known.length} of ${n} books` : "No reading pattern stands out yet");
  }
  const clears = (candidate: Candidate | undefined) => Boolean(candidate && candidate.strength >= 1 - EPSILON);
  const tie = clears(best) && clears(second) && second!.strength >= best.strength * 0.95 - EPSILON;
  const streak = second && second.strength >= 0.75 - EPSILON ? second.key : null;
  const shared = { identity: best.key, signal: best.signal, leaders: best.leaders, coverage, streak };
  if (clears(best) && !tie) return { state: "settled", runnerUp: null, missing: null, ...shared };
  return {
    state: "leaning",
    runnerUp: tie ? second!.key : null,
    missing: tie ? `Close between the ${nameOf(best.key)} and the ${nameOf(second!.key)}` : best.gap,
    ...shared,
  };
}

export function publicReaderCard({ state, identity, runnerUp, streak, signal, coverage }: ReaderIdentity): PublicReaderCard {
  return { state, identity, runnerUp, streak, signal, coverage };
}
