// Shared read/mutate access to the account's one library document.

import { useQuery } from "@tanstack/react-query";
import type { LibrarySaveOptions } from "@scripta/shared";
import { shareLibrary, unshareLibrary, type LibraryData, type LibraryDocument } from "../api/library";
import { useLibrarySaver } from "./useLibrarySaver";

export function useLibrary() {
  const saver = useLibrarySaver();
  const query = useQuery({ queryKey: ["library"], queryFn: () => saver.fetch() });

  function updateLibrary(updater: (current: LibraryData) => LibraryData, options?: LibrarySaveOptions): Promise<LibraryDocument> {
    return saver.saveWhole(updater, options);
  }

  async function share(): Promise<LibraryDocument> {
    const updated = await shareLibrary();
    saver.receiveShare(updated);
    return updated;
  }

  async function unshare(): Promise<LibraryDocument> {
    const updated = await unshareLibrary();
    saver.receiveShare(updated);
    return updated;
  }

  return { ...query, updateLibrary, share, unshare };
}
