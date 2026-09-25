export type LibraryBook = Record<string, unknown>;
export type StatusFilter = "all" | "unread" | "reading" | "finished";
export type SortKey = "manual" | "title" | "author";

export const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
  { value: "unread", label: "To read" }
];

// The three shelves a library actually has, for the swipeable status tabs
// atop the mobile Library screen — unlike STATUS_FILTER_OPTIONS above,
// there's no "all" tab: a shelf is always exactly one of these three.
export const LIBRARY_STATUS_TABS = [
  { value: "finished", label: "Read" },
  { value: "reading", label: "Reading" },
  { value: "unread", label: "TBR" }
] as const;

export type LibraryStatusTab = (typeof LIBRARY_STATUS_TABS)[number]["value"];

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "manual", label: "My order" },
  { value: "title", label: "Title A–Z" },
  { value: "author", label: "Author A–Z" }
];

export function filterBooks(books: LibraryBook[], query: string, status: StatusFilter): LibraryBook[] {
  const q = query.trim().toLowerCase();
  return books.filter((b) => {
    if (status !== "all") {
      const rs = b.ReadStatus;
      if (status === "reading" && rs !== 1) return false;
      if (status === "finished" && rs !== 2) return false;
      if (status === "unread" && (rs === 1 || rs === 2)) return false;
    }
    if (!q) return true;
    return String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q);
  });
}

export function sortBooks(books: LibraryBook[], key: SortKey): LibraryBook[] {
  if (key === "manual") return books;
  const field = key === "title" ? "Title" : "Attribution";
  const sorted = [...books];
  sorted.sort((a, b) => {
    const av = String(a[field] ?? "");
    const bv = String(b[field] ?? "");
    if (!av || !bv) return av === bv ? 0 : av ? -1 : 1;
    return av.localeCompare(bv);
  });
  return sorted;
}

export function nextReadStatus(current: unknown): number {
  if (current === 1) return 2;
  if (current === 2) return 0;
  return 1;
}

export type ReadStatus = 0 | 1 | 2;

export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function setReadStatus(book: LibraryBook, status: ReadStatus, day: string): LibraryBook {
  const current = book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0;
  if (current === status) return book;
  if (status === 2) return { ...book, ReadStatus: 2, DateLastRead: day, ___PercentRead: 100 };
  return { ...book, ReadStatus: status };
}
