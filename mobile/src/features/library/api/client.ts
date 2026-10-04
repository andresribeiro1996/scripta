import type { LibraryChange, LibraryChangeAnswer } from "@scripta/shared";
import type { BookRecommendationInput } from "@scripta/shared/community";
import { apiClient, ApiError } from "../../../core/api";
import { libraryChangeRequest } from "./changeRequest";
import { LibraryConflictError } from "./conflict";
import type { LibraryData, LibraryDocument } from "./types";

/** null means "no library saved yet" (backend 404s, not an error case
 *  here) — same convention as frontend's fetchLibrary. */
export async function fetchLibrary(signal?: AbortSignal): Promise<LibraryDocument | null> {
  try {
    return await apiClient.request<LibraryDocument>("/library", { auth: true, signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveLibrary(data: LibraryData, expectedUpdatedAt?: string, source?: "import", signal?: AbortSignal): Promise<LibraryDocument> {
  try {
    return await apiClient.request<LibraryDocument>("/library", {
      method: "PUT",
      auth: true,
      signal,
      body: expectedUpdatedAt === undefined ? { data, source } : { data, updatedAt: expectedUpdatedAt, source },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) throw new LibraryConflictError();
    throw err;
  }
}

export function sendLibraryChange(change: LibraryChange, signal: AbortSignal): Promise<LibraryChangeAnswer> {
  const { path, body, method } = libraryChangeRequest(change);
  return apiClient.request(path, { method, auth: true, signal, body });
}

export async function addBookToLibrary(rec: BookRecommendationInput): Promise<{ key: string; updated: boolean }> {
  return apiClient.request("/library/books", { method: "POST", body: rec, auth: true });
}

export async function shareLibrary(): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/share", { method: "POST", auth: true });
}

export async function unshareLibrary(): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/unshare", { method: "POST", auth: true });
}

export async function mergeLibraryBooks(keep: string, merge: string[], updatedAt: string, signal?: AbortSignal): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/books/merge", { method: "POST", auth: true, signal, body: { keep, merge, updatedAt } });
}
