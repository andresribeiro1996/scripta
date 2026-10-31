import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { canonicalIsbn, normalizeWords } from "./bookMatch.js";
import { looksLikeIsbnQuery } from "./bookSearch.js";

export type LibraryBook = Record<string, unknown>;
export type StatusFilter = "all" | "unread" | "reading" | "finished";
export type SortKey = "manual" | "title" | "author";

export const STATUS_FILTERS: StatusFilter[] = ["all", "reading", "finished", "unread"];
export const SORT_KEYS: SortKey[] = ["manual", "title", "author"];

export function statusFilterOptions(locale: Locale): Array<{ value: StatusFilter; label: string }> {
  const t = sharedT(locale);
  return [
    { value: "all", label: t("shared.libraryView.allStatuses") },
    { value: "reading", label: t("shared.helpers.readReading") },
    { value: "finished", label: t("shared.helpers.readFinished") },
    { value: "unread", label: t("shared.helpers.readToRead") }
  ];
}

export type LibraryStatusTab = "finished" | "reading" | "unread";

export function libraryStatusTabs(locale: Locale): Array<{ value: LibraryStatusTab; label: string }> {
  const t = sharedT(locale);
  return [
    { value: "finished", label: t("shared.helpers.readFinished") },
    { value: "reading", label: t("shared.helpers.readReading") },
    { value: "unread", label: t("shared.helpers.readToRead") }
  ];
}

export function sortOptions(locale: Locale): Array<{ value: SortKey; label: string }> {
  const t = sharedT(locale);
  return [
    { value: "manual", label: t("shared.libraryView.sortManual") },
    { value: "title", label: t("shared.libraryView.sortTitle") },
    { value: "author", label: t("shared.libraryView.sortAuthor") }
  ];
}

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

export function statusCounts(books: LibraryBook[]): Record<StatusFilter, number> {
  const counts = {} as Record<StatusFilter, number>;
  for (const value of STATUS_FILTERS) counts[value] = filterBooks(books, "", value).length;
  return counts;
}

export function matchesSearch(book: LibraryBook, query: string): boolean {
  const trimmed = query.trim();
  if (looksLikeIsbnQuery(trimmed)) return canonicalIsbn(trimmed) === canonicalIsbn(book.ISBN);
  const words = normalizeWords(trimmed).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const candidates = normalizeWords(`${String(book.Title ?? "")} ${String(book.Attribution ?? "")}`).split(" ").filter(Boolean);
  return words.every((word) => candidates.some((candidate) => candidate.startsWith(word)));
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

export type ReadStatus = 0 | 1 | 2;

export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseBookDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const dateOnly = DATE_ONLY.exec(raw);
  const parsed = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function setReadStatus(book: LibraryBook, status: ReadStatus, day: string): LibraryBook {
  const current = book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0;
  if (current === status) return book;
  if (status === 2) return { ...book, ReadStatus: 2, DateLastRead: day, ___PercentRead: 100 };
  return { ...book, ReadStatus: status };
}

export function readingPercent(book: LibraryBook): number | null {
  const raw = book.___PercentRead;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(100, Math.max(0, Math.round(raw)));
}
