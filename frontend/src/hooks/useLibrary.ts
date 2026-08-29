// Shared read/mutate access to the account's one library document, for
// every page that needs it (Series, Collections, Settings-adjacent bits —
// LibraryPage itself has extra needs like import parsing and a debounced
// cover-persist flush, so it keeps its own copy of the read/write calls
// rather than routing through this).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchLibrary, saveLibrary, shareLibrary, unshareLibrary, type LibraryData, type LibraryDocument } from "../api/library";

export function useLibrary() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["library"], queryFn: fetchLibrary });

  /** Reads the freshest cached document (not a stale closure over
   *  `query.data`), applies `updater`, and saves the result. */
  async function updateLibrary(updater: (current: LibraryData) => LibraryData): Promise<LibraryDocument> {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    const base: LibraryData = current?.data ?? { books: [] };
    const saved = await saveLibrary(updater(base));
    queryClient.setQueryData(["library"], saved);
    return saved;
  }

  async function share(): Promise<LibraryDocument> {
    const updated = await shareLibrary();
    queryClient.setQueryData(["library"], updated);
    return updated;
  }

  async function unshare(): Promise<LibraryDocument> {
    const updated = await unshareLibrary();
    queryClient.setQueryData(["library"], updated);
    return updated;
  }

  return { ...query, updateLibrary, share, unshare };
}
