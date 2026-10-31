// Moved to packages/shared/src/library/libraryView.ts (Task 3A). See
// lib/merge.ts's own comment for why this is a thin re-export.
export type { LibraryBook, StatusFilter, SortKey, ReadStatus } from "@scripta/shared";
export { STATUS_FILTERS, SORT_KEYS, statusFilterOptions, sortOptions, filterBooks, sortBooks, setReadStatus, localDay } from "@scripta/shared";

export function bookHref(key: string, works: Record<string, string> | undefined) {
  const id = works?.[key];
  return id ? `/work/${id}` : `/book/${encodeURIComponent(key)}`;
}
