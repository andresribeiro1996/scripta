import {
  filterBooks,
  parseBookDate,
  sortBooks,
  type LibraryBook,
  type LibraryStatusTab,
  type SortKey
} from "@scripta/shared";

export type LibraryShareLayout = "wall" | "summary" | "reading" | "shelf";

export const LIBRARY_SHARE_LAYOUTS: ReadonlyArray<{ value: LibraryShareLayout; labelKey: "library.layoutWall" | "library.layoutSummary" | "library.layoutReading" | "library.layoutShelf" }> = [
  { value: "wall", labelKey: "library.layoutWall" },
  { value: "summary", labelKey: "library.layoutSummary" },
  { value: "reading", labelKey: "library.layoutReading" },
  { value: "shelf", labelKey: "library.layoutShelf" }
];

export function newestFinished(books: LibraryBook[], limit: number): LibraryBook[] {
  const dated = filterBooks(books, "", "finished").map((book) => ({
    book,
    time: parseBookDate(book.DateLastRead)?.getTime() ?? null
  }));
  dated.sort((a, b) => {
    if (a.time === null || b.time === null) return a.time === b.time ? 0 : a.time === null ? 1 : -1;
    return b.time - a.time;
  });
  return dated.slice(0, limit).map((entry) => entry.book);
}

export function summaryCoverBooks(ordered: LibraryBook[]): LibraryBook[] {
  const finished = newestFinished(ordered, 4);
  return finished.length > 0 ? finished : ordered.slice(0, 4);
}

export function readingNow(ordered: LibraryBook[]): LibraryBook[] {
  return filterBooks(ordered, "", "reading");
}

export function shelfShareBooks(
  ordered: LibraryBook[],
  query: string,
  status: LibraryStatusTab,
  sortKey: SortKey
): LibraryBook[] {
  return sortBooks(filterBooks(ordered, query, status), sortKey);
}

export function wallColumns(count: number): number {
  return Math.max(8, Math.ceil(Math.sqrt(count / 8)));
}
