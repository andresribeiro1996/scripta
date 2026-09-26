export const FINISH_FEELINGS = [
  { rating: 1, label: "Not for me" },
  { rating: 2, label: "Fine" },
  { rating: 3, label: "Good" },
  { rating: 4, label: "Loved it" },
  { rating: 5, label: "All-time" }
] as const;

export type FinishRating = (typeof FINISH_FEELINGS)[number]["rating"];

type Book = Record<string, unknown>;

export function setRating(book: Book, rating: FinishRating): Book {
  return book.Rating === rating ? book : { ...book, Rating: rating };
}

export function addReaderNote(book: Book, text: string, day: string, id: string): Book {
  const note = { BookmarkID: `note:${id}`, VolumeID: book.ContentID ?? null, Text: text, Annotation: "", Type: "review", DateCreated: day, DateModified: null, ChapterProgress: null };
  return { ...book, highlights: [...(Array.isArray(book.highlights) ? book.highlights : []), note] };
}

const READ_FIELDS = ["ReadStatus", "DateLastRead", "___PercentRead"] as const;

export type ReadSnapshot = Partial<Record<(typeof READ_FIELDS)[number], unknown>>;

export function readSnapshot(book: Book): ReadSnapshot {
  return Object.fromEntries(READ_FIELDS.filter((field) => book[field] !== undefined).map((field) => [field, book[field]]));
}

export function restoreReadState(book: Book, before: ReadSnapshot): Book {
  const next = { ...book };
  for (const field of READ_FIELDS) {
    if (before[field] === undefined) delete next[field];
    else next[field] = before[field];
  }
  return next;
}

export function formatFinishDay(day: string, locale?: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}
