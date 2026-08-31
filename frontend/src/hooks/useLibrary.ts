// Shared read/mutate access to the account's library, for every page that
// needs it.
//
// TWO WRITE PATHS, and the choice between them is about what the operation
// actually touches:
//
//   updateLibrary   — the whole document. For genuinely cross-cutting work:
//                     an import that merges everything, or deleting books
//                     that must also be scrubbed out of every group and
//                     mural in the same write.
//   saveGroup / saveMural / saveBook / delete*  — one entity per request.
//                     For everything else, which is most things: renaming a
//                     group, restyling a book, editing a mural's blocks.
//
// Both quote the version they were based on, so a save from another device
// can't be silently overwritten, and both recover from a conflict by
// re-applying onto whatever the server actually has rather than surfacing
// an error.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteBook as deleteBookRequest,
  deleteGroup as deleteGroupRequest,
  deleteMural as deleteMuralRequest,
  fetchLibrary,
  LibraryConflictError,
  saveBook as saveBookRequest,
  saveGroup as saveGroupRequest,
  saveLibrary,
  saveMural as saveMuralRequest,
  type LibraryData,
  type LibraryDocument
} from "../api/library";
import type { Group } from "../lib/groups";
import type { Mural } from "../lib/murals";

export function useLibrary() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["library"], queryFn: fetchLibrary });

  function cached(): LibraryDocument | undefined {
    return queryClient.getQueryData<LibraryDocument>(["library"]);
  }

  /** Reads the freshest cached document (not a stale closure over
   *  `query.data`), applies `updater`, and saves the whole result.
   *
   *  A conflict is recovered from rather than surfaced: because `updater`
   *  is a pure `(current) => next`, re-running it against the document the
   *  server just handed back IS the merge. So a conflict costs a retry,
   *  not the user's edit. Only one retry — a second conflict means
   *  something is writing continuously, and looping would keep losing. */
  async function updateLibrary(updater: (current: LibraryData) => LibraryData): Promise<LibraryDocument> {
    const current = cached();
    const base: LibraryData = current?.data ?? { books: [] };

    try {
      const saved = await saveLibrary(updater(base), current?.version);
      queryClient.setQueryData(["library"], saved);
      return saved;
    } catch (err) {
      if (!(err instanceof LibraryConflictError)) throw err;

      const fresh = err.current ?? (await fetchLibrary());
      const freshData: LibraryData = fresh?.data ?? { books: [] };

      const saved = await saveLibrary(updater(freshData), fresh?.version);
      queryClient.setQueryData(["library"], saved);
      return saved;
    }
  }

  /** The shared shape of every per-entity write: apply a pure transform to
   *  the current document, send only the entity that changed, and mirror
   *  the result into the cache so the UI updates without a re-read.
   *
   *  `select` pulls the affected entity out of the transformed document.
   *  It also receives the document as it was BEFORE the transform, so a
   *  creation can identify the entity that was just added rather than
   *  guessing at it by position. Returning undefined means "nothing to
   *  send" — e.g. renaming a group that has since been deleted elsewhere —
   *  which is a no-op rather than an error. */
  async function writeEntity<T>(
    transform: (current: LibraryData) => LibraryData,
    select: (next: LibraryData, previous: LibraryData) => T | undefined,
    send: (entity: T, expectedVersion: number | undefined) => Promise<{ version: number }>
  ): Promise<void> {
    async function attempt(base: LibraryDocument | undefined): Promise<{ conflicted: boolean }> {
      const data = base?.data ?? { books: [] };
      const next = transform(data);
      const entity = select(next, data);
      if (entity === undefined) return { conflicted: false };

      try {
        const { version } = await send(entity, base?.version);
        // The transform already produced the whole next document, so the
        // cache can be updated from it directly — the server only needed
        // the one entity, but the client already knows the rest is
        // unchanged.
        queryClient.setQueryData<LibraryDocument>(["library"], (previous) =>
          previous ? { ...previous, data: next, version } : previous
        );
        return { conflicted: false };
      } catch (err) {
        if (err instanceof LibraryConflictError) return { conflicted: true };
        throw err;
      }
    }

    const { conflicted } = await attempt(cached());
    if (!conflicted) return;

    // Same recovery as updateLibrary: re-apply onto what the server
    // actually has. One retry only.
    const fresh = await fetchLibrary();
    if (fresh) queryClient.setQueryData(["library"], fresh);
    await attempt(fresh ?? undefined);
  }

  /** Applies `transform` to the library, then sends only the group with
   *  `id`. Call sites keep the same pure-function style they used with
   *  updateLibrary. */
  async function saveGroup(id: string, transform: (groups: Group[]) => Group[]): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, groups: transform(data.groups ?? []) }),
      (next) => (next.groups ?? []).find((group) => group.id === id),
      (group, expectedVersion) => saveGroupRequest(group, expectedVersion)
    );
  }

  /** Sends the group that `transform` added, whichever it is — used by
   *  creation, where the caller doesn't know the generated id up front. */
  async function addGroup(transform: (groups: Group[]) => Group[]): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, groups: transform(data.groups ?? []) }),
      (next, previous) => {
        const before = new Set((previous.groups ?? []).map((group) => group.id));
        return (next.groups ?? []).find((group) => !before.has(group.id));
      },
      (group, expectedVersion) => saveGroupRequest(group, expectedVersion)
    );
  }

  async function removeGroup(id: string): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, groups: (data.groups ?? []).filter((group) => group.id !== id) }),
      () => id,
      (groupId, expectedVersion) => deleteGroupRequest(groupId, expectedVersion)
    );
  }

  async function saveMural(id: string, transform: (murals: Mural[]) => Mural[]): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, murals: transform(data.murals ?? []) }),
      (next) => (next.murals ?? []).find((mural) => mural.id === id),
      (mural, expectedVersion) => saveMuralRequest(mural, expectedVersion)
    );
  }

  /** The mural counterpart of addGroup. */
  async function addMural(transform: (murals: Mural[]) => Mural[]): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, murals: transform(data.murals ?? []) }),
      (next, previous) => {
        const before = new Set((previous.murals ?? []).map((mural) => mural.id));
        return (next.murals ?? []).find((mural) => !before.has(mural.id));
      },
      (mural, expectedVersion) => saveMuralRequest(mural, expectedVersion)
    );
  }

  async function removeMural(id: string): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, murals: (data.murals ?? []).filter((mural) => mural.id !== id) }),
      () => id,
      (muralId, expectedVersion) => deleteMuralRequest(muralId, expectedVersion)
    );
  }

  /** `matches` identifies the one book being changed. Passed in rather
   *  than derived, because the caller already knows which book it is and
   *  bookKey() is the frontend's own function — recomputing it here would
   *  duplicate that knowledge. */
  async function saveBook(
    matches: (book: Record<string, unknown>) => boolean,
    transform: (books: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
  ): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, books: transform(data.books) }),
      (next) => next.books.find(matches),
      (book, expectedVersion) => saveBookRequest(book, expectedVersion)
    );
  }

  async function removeBook(bookKey: string, matches: (book: Record<string, unknown>) => boolean): Promise<void> {
    await writeEntity(
      (data) => ({ ...data, books: data.books.filter((book) => !matches(book)) }),
      () => bookKey,
      (key, expectedVersion) => deleteBookRequest(key, expectedVersion)
    );
  }

  return {
    ...query,
    updateLibrary,
    addGroup,
    saveGroup,
    removeGroup,
    addMural,
    saveMural,
    removeMural,
    saveBook,
    removeBook
  };
}
