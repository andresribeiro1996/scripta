import { libraryChangeRequest, type LibraryDocument, type LibraryChange, type LibraryChangeAnswer, type LibraryData } from "@scripta/shared";
import type { BookRecommendationInput } from "@scripta/shared/community";
import { ApiError, apiFetch } from "./client";

// LibraryData moved to packages/shared/src/library/types.ts (Task 3A) —
// merge.ts, csv/goodreads/storygraph and groups/libraryStyle all
// reference it, and backend needs the same shape for Task 4B's import
// pipeline. Re-exported under the same name so every existing
// `from "../api/library"` import keeps working unchanged.
export type { LibraryData } from "@scripta/shared";

export type { LibraryDocument } from "@scripta/shared";

export const LIBRARY_REFRESH_PATH = "/library?fresh=1";

async function getLibrary(path: string, signal?: AbortSignal): Promise<LibraryDocument | null> {
  try {
    return (await apiFetch(path, { signal })) as LibraryDocument;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function fetchLibrary(signal?: AbortSignal): Promise<LibraryDocument | null> {
  try {
    return await getLibrary(LIBRARY_REFRESH_PATH, signal);
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    return getLibrary("/library", signal);
  }
}

export async function saveLibrary(data: LibraryData, updatedAt: string | undefined, source: "import" | undefined, signal?: AbortSignal): Promise<LibraryDocument> {
  return (await apiFetch("/library", { method: "PUT", body: JSON.stringify({ data, updatedAt, source }), signal })) as LibraryDocument;
}

export async function sendLibraryChange(change: LibraryChange, signal: AbortSignal): Promise<LibraryChangeAnswer> {
  const { method, path, body } = libraryChangeRequest(change);
  return (await apiFetch(path, { method, body: JSON.stringify(body), signal })) as LibraryChangeAnswer;
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

export async function mergeLibraryBooks(keep: string, merge: string[], updatedAt: string, signal?: AbortSignal): Promise<LibraryDocument> {
  return (await apiFetch("/library/books/merge", { method: "POST", body: JSON.stringify({ keep, merge, updatedAt }), signal })) as LibraryDocument;
}
