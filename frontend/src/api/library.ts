import type { Group } from "../lib/groups";
import type { LibraryStyleSettings } from "../lib/libraryStyle";
import { ApiError, apiFetch } from "./client";

export interface LibraryData {
  source?: string;
  schema_version?: number;
  book_count?: number;
  books: Array<Record<string, unknown>>;
  /** User-given name for this library (e.g. "Andre's Library") — never
   *  set by an importer, only by the user via LibraryPage. Absent until
   *  they name it for the first time; falls back to "Library" in the UI. */
  name?: string;
  /** Series and collections — see lib/groups.ts. Optional: absent until
   *  the first group (auto-seeded series or user-created collection) is
   *  saved. */
  groups?: Group[];
  /** Card size/spacing/background preferences — see lib/libraryStyle.ts.
   *  Absent until the user visits /dashboard/style and changes something;
   *  resolveLibraryStyle() fills in defaults wherever this is read. */
  style?: LibraryStyleSettings;
  [key: string]: unknown;
}

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

export async function saveLibrary(data: LibraryData): Promise<LibraryDocument> {
  return (await apiFetch("/library", { method: "PUT", body: JSON.stringify({ data }) })) as LibraryDocument;
}

export async function shareLibrary(): Promise<LibraryDocument> {
  return (await apiFetch("/library/share", { method: "POST" })) as LibraryDocument;
}

export async function unshareLibrary(): Promise<LibraryDocument> {
  return (await apiFetch("/library/unshare", { method: "POST" })) as LibraryDocument;
}
