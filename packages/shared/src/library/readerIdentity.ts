import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { plateName, type CardState, type IdentityKey } from "../readerCards/index.js";
import type { PublicReaderCardStyle, ReaderCardChosen } from "../readerCards/style.js";
import { genreLabel, genresForBook, isBookGenre, isFinishedBook, type BookGenre } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { bookKey } from "./merge.js";
import type { ReaderCardFacts } from "./readerCardFacts.js";

type Book = Record<string, unknown>;

export type GenreIdentity = "lamp" | "star" | "arch" | "corr";

export interface ReaderSignal { counted: number; of: number; label: string; key?: IdentityKey; largest?: BookGenre | GenreIdentity; largestPct?: number }
export interface CoverageFacts { known: number; n: number; imported: boolean }
export interface ReaderLeader { label: string; count: number }
export interface ReaderIdentity {
  state: CardState;
  identity: IdentityKey | null;
  runnerUp: IdentityKey | null;
  streak: IdentityKey | null;
  signal: ReaderSignal | null;
  leaders: ReaderLeader[];
  coverage: string[];
  coverageFacts: CoverageFacts;
  missing: string | null;
}
export type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage"> & Partial<Pick<ReaderIdentity, "streak" | "coverageFacts">> & Partial<ReaderCardFacts> & { style?: PublicReaderCardStyle; chosen?: ReaderCardChosen };

interface Candidate { key: IdentityKey; strength: number; signal: ReaderSignal; leaders: ReaderLeader[]; gap: string }

const EPSILON = 1e-9;
const MIN_BOOKS = 5;
const MIN_GENRE_BOOKS = 20;

export const GENRE_SIGNALS: Array<{ key: GenreIdentity; genres: BookGenre[]; threshold: number }> = [
  { key: "lamp", genres: ["Mystery", "Crime", "Thriller", "Horror"], threshold: 0.35 },
  { key: "star", genres: ["Fantasy", "Science Fiction"], threshold: 0.4 },
  { key: "arch", genres: ["History", "Biography & Memoir", "Politics"], threshold: 0.35 },
  { key: "corr", genres: ["Classics", "Literary Fiction", "Poetry"], threshold: 0.4 },
];

const SIGNAL_WORDS = { lamp: "shared.readerIdentity.wordsLamp", star: "shared.readerIdentity.wordsStar", arch: "shared.readerIdentity.wordsArch", corr: "shared.readerIdentity.wordsCorr" } as const;

const pct = (value: number) => `${Math.floor(value * 100)}%`;
const normalizeAuthor = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function largestLabel(largest: BookGenre | GenreIdentity, locale: Locale): string {
  return isBookGenre(largest) ? genreLabel(largest, locale) : sharedT(locale)(SIGNAL_WORDS[largest]);
}

function factSentence(signal: Omit<ReaderSignal, "label">, locale: Locale): string | null {
  const t = sharedT(locale);
  const { key, counted: count, of: n } = signal;
  if (key === "carto") return t("shared.readerIdentity.cartoSignal", { count, n });
  if (key === "anno") return t("shared.readerIdentity.annoSignal", { count, n });
  if (key === "loyal") return t("shared.readerIdentity.loyalSignal", { count, n });
  if (key === "way") return signal.largest && signal.largestPct !== undefined ? t("shared.readerIdentity.waySignal", { wide: count, largest: largestLabel(signal.largest, locale), pct: `${signal.largestPct}%` }) : null;
  if (key) return t("shared.readerIdentity.genreSignal", { count, m: n, words: t(SIGNAL_WORDS[key]) });
  return null;
}

export function signalSentence(signal: ReaderSignal, locale: Locale): string {
  return factSentence(signal, locale) ?? signal.label;
}

function coverageOf({ known, n, imported }: CoverageFacts, locale: Locale): string[] {
  const t = sharedT(locale);
  return imported ? [t("shared.readerIdentity.coverageGenres", { known, n }), t("shared.readerIdentity.coverageSeries")] : [t("shared.readerIdentity.coverageGenres", { known, n })];
}

export function coverageSentences(card: Pick<PublicReaderCard, "coverage" | "coverageFacts">, locale: Locale): string[] {
  return card.coverageFacts ? coverageOf(card.coverageFacts, locale) : card.coverage;
}

function bump(counts: Map<string, number>, key: string, by = 1) {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

function top(counts: Map<string, number>, n = 3, display: (label: string) => string = (label) => label): ReaderLeader[] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([label, count]) => ({ label: display(label), count }));
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

export function readerIdentity(books: Book[], groups: Group[], locale: Locale): ReaderIdentity {
  const t = sharedT(locale);
  const nameOf = (key: IdentityKey) => plateName(key, locale);
  const finished = uniqueFinished(books);
  const n = finished.length;
  const genresOf = new Map(finished.map((book) => [book, genresForBook(book)] as const));
  const known = finished.filter((book) => genresOf.get(book)!.length > 0);
  const coverageFacts = { known: known.length, n, imported: finished.some((book) => /^(goodreads|storygraph):/.test(String(book.ContentID ?? ""))) };
  const coverage = coverageOf(coverageFacts, locale);
  const signalOf = (facts: Omit<ReaderSignal, "label">): ReaderSignal => ({ ...facts, label: factSentence(facts, locale)! });
  const unwritten = (missing: string): ReaderIdentity => ({ state: "unwritten", identity: null, runnerUp: null, streak: null, signal: null, leaders: [], coverage, coverageFacts, missing });
  if (n < MIN_BOOKS) return unwritten(t("shared.readerIdentity.finishMore", { count: MIN_BOOKS - n }));

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
    signal: signalOf({ counted: inSeries.size, of: n, key: "carto" }),
    leaders: top(seriesCounts),
    gap: t("shared.readerIdentity.cartoGap", { pct: pct(inSeries.size / n) }),
  });

  const marked = finished.filter((book) => markCount(book) > 0);
  const marks = finished.reduce((sum, book) => sum + markCount(book), 0);
  candidates.push({
    key: "anno",
    strength: Math.min(marked.length / n / 0.3, marks / 20),
    signal: signalOf({ counted: marked.length, of: n, key: "anno" }),
    leaders: top(new Map(marked.map((book) => [String(book.Title ?? t("shared.arenaSeed.untitled")), markCount(book)] as const))),
    gap: t("shared.readerIdentity.annoGap", { pct: pct(marked.length / n), marks: t("shared.readerIdentity.marks", { count: marks }) }),
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
    signal: signalOf({ counted: byLoyal, of: n, key: "loyal" }),
    leaders: loyalAuthors,
    gap: t("shared.readerIdentity.loyalGap", { pct: pct(byLoyal / n) }),
  });

  const genresKnown = known.length * 2 >= n || known.length >= MIN_GENRE_BOOKS;
  if (genresKnown) {
    const m = known.length;
    const groupShares: number[] = [];
    for (const signal of GENRE_SIGNALS) {
      const words = t(SIGNAL_WORDS[signal.key]);
      const matching = known.filter((book) => genresOf.get(book)!.some((genre) => signal.genres.includes(genre)));
      groupShares.push(matching.length / m);
      const genreCounts = new Map<string, number>();
      for (const book of matching) for (const genre of genresOf.get(book)!) if (signal.genres.includes(genre)) bump(genreCounts, genre);
      candidates.push({
        key: signal.key,
        strength: matching.length / m / signal.threshold,
        signal: signalOf({ counted: matching.length, of: m, key: signal.key }),
        leaders: top(genreCounts, 3, (genre) => genreLabel(genre as BookGenre, locale)),
        gap: t("shared.readerIdentity.genreGap", { pct: pct(matching.length / m), words, threshold: pct(signal.threshold) }),
      });
    }
    const all = new Map<string, number>();
    for (const book of known) for (const genre of genresOf.get(book)!) bump(all, genre);
    const genreShares = [...all].map(([genre, count]) => ({ key: genre as BookGenre | GenreIdentity, share: count / m }));
    const groupSharesNamed = GENRE_SIGNALS.map((signal, i) => ({ key: signal.key as BookGenre | GenreIdentity, share: groupShares[i]! }));
    const wide = genreShares.filter((entry) => entry.share > 0.05).length;
    const largest = [...genreShares, ...groupSharesNamed].reduce((a, b) => (b.share > a.share ? b : a));
    const largestPct = Math.ceil(largest.share * 100);
    candidates.push({
      key: "way",
      strength: Math.min(wide / 6, 0.25 / largest.share),
      signal: signalOf({ counted: wide, of: all.size, key: "way", largest: largest.key, largestPct }),
      leaders: top(all, 3, (genre) => genreLabel(genre as BookGenre, locale)),
      gap: t("shared.readerIdentity.wayGap", { genres: t("shared.readerIdentity.genres", { count: wide }), largest: largestLabel(largest.key, locale), pct: `${largestPct}%` }),
    });
  }

  const [best, second] = [...candidates].sort((a, b) => b.strength - a.strength);
  if (!best || best.strength < 0.75 - EPSILON) {
    return unwritten(genresKnown ? t("shared.readerIdentity.noPattern") : t("shared.readerIdentity.genresKnown", { known: known.length, n }));
  }
  const clears = (candidate: Candidate | undefined) => Boolean(candidate && candidate.strength >= 1 - EPSILON);
  const tie = clears(best) && clears(second) && second!.strength >= best.strength * 0.95 - EPSILON;
  const streak = second && second.strength >= 0.75 - EPSILON ? second.key : null;
  const shared = { identity: best.key, signal: best.signal, leaders: best.leaders, coverage, coverageFacts, streak };
  if (clears(best) && !tie) return { state: "settled", runnerUp: null, missing: null, ...shared };
  return {
    state: "leaning",
    runnerUp: tie ? second!.key : null,
    missing: tie ? t("shared.readerIdentity.close", { a: nameOf(best.key), b: nameOf(second!.key) }) : best.gap,
    ...shared,
  };
}

export function publicReaderCard({ state, identity, runnerUp, streak, signal, coverage, coverageFacts }: ReaderIdentity): PublicReaderCard {
  return { state, identity, runnerUp, streak, signal, coverage, coverageFacts };
}
