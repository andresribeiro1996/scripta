// Shared read/mutate access to the account's one library document.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchLibrary, saveLibrary, shareLibrary, unshareLibrary, type LibraryData, type LibraryDocument } from "../api/library";
import { saveLibraryUpdate } from "../lib/saveLibraryUpdate";

export function useLibrary() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["library"], queryFn: fetchLibrary });

  async function updateLibrary(updater: (current: LibraryData) => LibraryData, base?: LibraryDocument): Promise<LibraryDocument> {
    const current = base ?? queryClient.getQueryData<LibraryDocument | null>(["library"]);
    const saved = await saveLibraryUpdate(current, updater, fetchLibrary, saveLibrary);
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
