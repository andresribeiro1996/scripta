// Mirrors frontend/src/hooks/useLibrary.ts's shape and query-key
// semantics EXACTLY (["library"], same updateLibrary/share/unshare
// contract) per this task's brief — anything reading this app's
// ["library"] cache (a future screen, a devtools inspector, a shared
// query invalidation from another feature) sees the same key the PWA
// does.
//
// updateLibrary is also where Task 5A's conditional-PUT requirement
// actually lives end to end: it always reads the FRESHEST cached
// document (never a stale closure — same reasoning frontend's own
// LibraryPage.tsx handlers give for doing this), sends its `updatedAt`
// on every save (api/client.ts), and on a 409 (LibraryConflictError)
// re-fetches and replays the same `updater` against the fresh document
// exactly once rather than clobbering it — see api/client.ts's own top
// comment for what today's backend actually does with that field.

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchLibrary, LibraryConflictError, saveLibrary, shareLibrary, unshareLibrary } from "../api/client";
import type { LibraryData, LibraryDocument } from "../api/types";

export const LIBRARY_QUERY_KEY = ["library"] as const;

export function useLibrary() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: LIBRARY_QUERY_KEY, queryFn: fetchLibrary });

  async function updateLibrary(updater: (current: LibraryData) => LibraryData): Promise<LibraryDocument> {
    const current = queryClient.getQueryData<LibraryDocument | null>(LIBRARY_QUERY_KEY);
    const base: LibraryData = current?.data ?? { books: [] };
    try {
      const saved = await saveLibrary(updater(base), current?.updatedAt);
      queryClient.setQueryData(LIBRARY_QUERY_KEY, saved);
      return saved;
    } catch (err) {
      if (!(err instanceof LibraryConflictError)) throw err;
      const fresh = await fetchLibrary();
      const freshBase: LibraryData = fresh?.data ?? { books: [] };
      const saved = await saveLibrary(updater(freshBase), fresh?.updatedAt);
      queryClient.setQueryData(LIBRARY_QUERY_KEY, saved);
      return saved;
    }
  }

  async function share(): Promise<LibraryDocument> {
    const updated = await shareLibrary();
    queryClient.setQueryData(LIBRARY_QUERY_KEY, updated);
    return updated;
  }

  async function unshare(): Promise<LibraryDocument> {
    const updated = await unshareLibrary();
    queryClient.setQueryData(LIBRARY_QUERY_KEY, updated);
    return updated;
  }

  return { ...query, updateLibrary, share, unshare };
}
