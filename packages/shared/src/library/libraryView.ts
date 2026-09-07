export type LibraryBook = Record<string, unknown>;
export type StatusFilter = "all" | "unread" | "reading" | "finished";
export type SortKey = "manual" | "title" | "author";

export const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
  { value: "unread", label: "Not read" }
];

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
