// Shared read/mutate access to the account's one library document, for
// every page that needs it (Series, Collections, Settings-adjacent bits —
// LibraryPage itself has extra needs like import parsing and a debounced
// cover-persist flush, so it keeps its own copy of the read/write calls
// rather than routing through this).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchLibrary,
  LibraryConflictError,
  saveLibrary,
  type LibraryData,
  type LibraryDocument
} from "../api/library";

export function useLibrary() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["library"], queryFn: fetchLibrary });

  /** Reads the freshest cached document (not a stale closure over
   *  `query.data`), applies `updater`, and saves the result.
   *
   *  The save quotes the version it was based on, so the server refuses
   *  it if another device saved in between — this used to be an
   *  unconditional overwrite, and whichever device saved second silently
   *  destroyed the other's changes with nothing shown to anyone.
   *
   *  A refusal is recovered from rather than surfaced: because `updater`
   *  is a pure `(current) => next`, re-running it against the document
   *  the server just handed back IS the merge. So a conflict costs a
   *  retry, not the user's edit. Only one retry — a second conflict means
   *  something is writing continuously, and looping would just keep
   *  losing to it. */
  async function updateLibrary(updater: (current: LibraryData) => LibraryData): Promise<LibraryDocument> {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    const base: LibraryData = current?.data ?? { books: [] };

    try {
      const saved = await saveLibrary(updater(base), current?.version);
      queryClient.setQueryData(["library"], saved);
      return saved;
    } catch (err) {
      if (!(err instanceof LibraryConflictError)) throw err;

      // Re-apply onto whatever the server actually has now. If the 409
      // didn't carry the current document (an older server, or a proxy
      // that stripped the body), fall back to re-reading it.
      const fresh = err.current ?? (await fetchLibrary());
      const freshData: LibraryData = fresh?.data ?? { books: [] };

      const saved = await saveLibrary(updater(freshData), fresh?.version);
      queryClient.setQueryData(["library"], saved);
      return saved;
    }
  }

  return { ...query, updateLibrary };
}
