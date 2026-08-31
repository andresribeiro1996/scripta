import type { Group } from "../lib/groups";
import type { LibraryStyleSettings } from "../lib/libraryStyle";
import type { BlockLayout, Mural } from "../lib/murals";
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
  /** Configurable freeform dashboards — see lib/murals.ts. Optional:
   *  absent until the first mural is created. */
  murals?: Mural[];
  [key: string]: unknown;
}

export interface LibraryDocument {
  data: LibraryData;
  updatedAt: string;
  /** Bumped by the server on every write. Quote it back on a save and the
   *  server refuses the write if someone else (usually this same person
   *  on another device) saved in between — see hooks/useLibrary.ts, which
   *  turns that refusal into a re-apply rather than an error. */
  version: number;
}

/** Thrown when a save was refused because the library moved on
 *  underneath it. Carries the server's current document so the caller can
 *  re-apply its change on top without a second round trip. */
export class LibraryConflictError extends ApiError {
  currentVersion: number;
  current: LibraryDocument | null;

  constructor(currentVersion: number, current: LibraryDocument | null) {
    super(409, "This library was changed elsewhere.");
    this.currentVersion = currentVersion;
    this.current = current;
  }
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

export async function saveLibrary(data: LibraryData, expectedVersion?: number): Promise<LibraryDocument> {
  try {
    return (await apiFetch("/library", {
      method: "PUT",
      body: JSON.stringify({ data, expectedVersion })
    })) as LibraryDocument;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as { currentVersion?: number; current?: LibraryDocument | null } | undefined;
      throw new LibraryConflictError(body?.currentVersion ?? 0, body?.current ?? null);
    }
    throw err;
  }
}

// --- per-entity writes ---------------------------------------------------
//
// Each of these replaces a whole-library PUT for an operation that only
// touches one entity. saveLibrary above stays for genuinely cross-cutting
// work: an import that merges everything, or a multi-book delete that must
// also scrub those books out of every group and mural in the same write.
//
// All of them return the resulting version so the caller can keep the
// cached document in step without a re-read.

/** The book's key is derived server-side from the record, not sent — it is
 *  what groups and mural blocks reference, so a key that disagreed with the
 *  record's own fields would orphan them. */
export async function saveBook(
  book: Record<string, unknown>,
  expectedVersion?: number
): Promise<{ version: number; bookKey: string }> {
  return (await apiFetch("/library/books", {
    method: "PUT",
    body: JSON.stringify({ book, expectedVersion })
  })) as { version: number; bookKey: string };
}

/** The key travels in the body, not the path: it contains ':' and '|', and
 *  for a title like "AC/DC" a literal '/'. */
export async function deleteBook(bookKey: string, expectedVersion?: number): Promise<{ version: number }> {
  return (await apiFetch("/library/books", {
    method: "DELETE",
    body: JSON.stringify({ bookKey, expectedVersion })
  })) as { version: number };
}

export async function saveGroup(group: Group, expectedVersion?: number): Promise<{ version: number }> {
  return (await apiFetch(`/library/groups/${encodeURIComponent(group.id)}`, {
    method: "PUT",
    body: JSON.stringify({ group, expectedVersion })
  })) as { version: number };
}

export async function deleteGroup(groupId: string, expectedVersion?: number): Promise<{ version: number }> {
  return (await apiFetch(`/library/groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion })
  })) as { version: number };
}

export async function saveMural(mural: Mural, expectedVersion?: number): Promise<{ version: number }> {
  return (await apiFetch(`/library/murals/${encodeURIComponent(mural.id)}`, {
    method: "PUT",
    body: JSON.stringify({ mural, expectedVersion })
  })) as { version: number };
}

export async function deleteMural(muralId: string, expectedVersion?: number): Promise<{ version: number }> {
  return (await apiFetch(`/library/murals/${encodeURIComponent(muralId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion })
  })) as { version: number };
}

/** Moves one block on one mural, instead of re-sending the whole library.
 *  Dragging a block used to rewrite every book, group and mural the
 *  account had, once per drop. */
export async function saveMuralBlockLayout(
  muralId: string,
  blockId: string,
  layout: BlockLayout,
  expectedVersion?: number
): Promise<{ version: number }> {
  return (await apiFetch(`/library/murals/${encodeURIComponent(muralId)}/blocks/${encodeURIComponent(blockId)}/layout`, {
    method: "PUT",
    body: JSON.stringify({ layout, expectedVersion })
  })) as { version: number };
}
