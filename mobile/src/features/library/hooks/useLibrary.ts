import { createContext, useContext } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { createLibrarySaver, type LibrarySaver } from "@scripta/shared";
import { fetchLibrary, saveLibrary, sendLibraryChange, shareLibrary, unshareLibrary } from "../api/client";
import type { LibraryData, LibraryDocument } from "../api/types";

export const LIBRARY_QUERY_KEY = ["library"] as const;

export const LibrarySaverContext = createContext<LibrarySaver | null>(null);

export function createAccountLibrarySaver(queryClient: QueryClient): LibrarySaver {
  return createLibrarySaver({
    send: sendLibraryChange,
    put: saveLibrary,
    fetch: fetchLibrary,
    write: (view) => queryClient.setQueryData(LIBRARY_QUERY_KEY, view),
  });
}

export function useLibrarySaver(): LibrarySaver {
  const saver = useContext(LibrarySaverContext);
  if (!saver) throw new Error("useLibrarySaver needs a LibrarySaverContext provider.");
  return saver;
}

export function useLibrary() {
  const saver = useLibrarySaver();
  const query = useQuery({ queryKey: LIBRARY_QUERY_KEY, queryFn: () => saver.fetch() });

  function updateLibrary(updater: (current: LibraryData) => LibraryData, source?: "import"): Promise<LibraryDocument> {
    return saver.saveWhole(updater, { source });
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

  return { ...query, updateLibrary, share, unshare, submit: saver.submit, saver };
}
