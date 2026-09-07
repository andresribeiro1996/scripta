// Mirrors frontend/src/api/library.ts's fetchLibrary/saveLibrary/
// shareLibrary/unshareLibrary, on top of this app's own apiClient
// (auth:true — refresh is handled inside, see core/apiClient.ts).
//
import { apiClient, ApiError } from "../../../core/api";
import type { LibraryData, LibraryDocument } from "./types";

export class LibraryConflictError extends Error {
  constructor() {
    super("The library changed elsewhere since this was loaded.");
  }
}

/** null means "no library saved yet" (backend 404s, not an error case
 *  here) — same convention as frontend's fetchLibrary. */
export async function fetchLibrary(): Promise<LibraryDocument | null> {
  try {
    return await apiClient.request<LibraryDocument>("/library", { auth: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveLibrary(data: LibraryData, expectedUpdatedAt?: string): Promise<LibraryDocument> {
  try {
    return await apiClient.request<LibraryDocument>("/library", {
      method: "PUT",
      auth: true,
      body: expectedUpdatedAt === undefined ? { data } : { data, updatedAt: expectedUpdatedAt },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) throw new LibraryConflictError();
    throw err;
  }
}

export async function shareLibrary(): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/share", { method: "POST", auth: true });
}

export async function unshareLibrary(): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/unshare", { method: "POST", auth: true });
}
