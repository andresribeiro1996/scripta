import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { createLibrarySaver, type LibrarySaver } from "@scripta/shared";
import { fetchLibrary, saveLibrary, sendLibraryChange } from "../api/library";

export const LibrarySaverContext = createContext<LibrarySaver | null>(null);

export function createWebLibrarySaver(queryClient: QueryClient): LibrarySaver {
  return createLibrarySaver({
    send: sendLibraryChange,
    put: saveLibrary,
    fetch: fetchLibrary,
    write: (view) => queryClient.setQueryData(["library"], view)
  });
}

export function useLibrarySaver(): LibrarySaver {
  const saver = useContext(LibrarySaverContext);
  if (!saver) throw new Error("useLibrarySaver needs a LibrarySaverContext provider.");
  return saver;
}
