import type { LibraryData } from "@scripta/shared";
import type { BookRecommendationInput } from "@scripta/shared/community";
import { ApiError, apiFetch } from "./client";

// LibraryData moved to packages/shared/src/library/types.ts (Task 3A) —
// merge.ts, csv/goodreads/storygraph and groups/libraryStyle all
// reference it, and backend needs the same shape for Task 4B's import
// pipeline. Re-exported under the same name so every existing
// `from "../api/library"` import keeps working unchanged.
export type { LibraryData } from "@scripta/shared";

export interface LibraryDocument {
  data: LibraryData;
  updatedAt: string;
  /** Public share link state — null until shared. Idempotent share (a
   *  document that's already shared keeps its existing token) / plain
   *  unshare, same shape as a mural's own shareToken/shareUrl
   *  (lib/murals.ts's Mural). */
  shareToken: string | null;
  shareUrl: string | null;
}

/** null means "no library saved yet" (backend 404s, not an error case here) */
export async function fetchLibrary(): Promise<LibraryDocument | null> {
  try {
    return (await apiFetch("/library")) as LibraryDocument;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveLibrary(data: LibraryData, updatedAt?: string, source?: "import"): Promise<LibraryDocument> {
  return (await apiFetch("/library", { method: "PUT", body: JSON.stringify({ data, updatedAt, source }) })) as LibraryDocument;
}

/** Same-shelf upsert behind POST /library/books — adding a book you
 *  already have updates it in place instead of duplicating it, which is
 *  why the response reports which of the two happened. */
export async function addBookToLibrary(rec: BookRecommendationInput): Promise<{ key: string; updated: boolean }> {
  return (await apiFetch("/library/books", { method: "POST", body: JSON.stringify(rec) })) as { key: string; updated: boolean };
}

export async function shareLibrary(): Promise<LibraryDocument> {
  return (await apiFetch("/library/share", { method: "POST" })) as LibraryDocument;
}

export async function unshareLibrary(): Promise<LibraryDocument> {
  return (await apiFetch("/library/unshare", { method: "POST" })) as LibraryDocument;
}
