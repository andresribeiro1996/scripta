import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mergeCertainDuplicates } from "@scripta/shared";
import { ApiError } from "../../../core/api";
import { fetchLibrary, mergeLibraryBooks } from "../api/client";
import type { LibraryDocument } from "../api/types";
import { LIBRARY_QUERY_KEY } from "./useLibrary";

export function useDuplicateMerge(library: LibraryDocument | null | undefined) {
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (!library || ran.current) return;
    ran.current = true;
    void mergeCertainDuplicates(library, mergeLibraryBooks, fetchLibrary, (error) => error instanceof ApiError && error.status === 409)
      .then((merged) => {
        if (merged !== library) queryClient.setQueryData(LIBRARY_QUERY_KEY, merged);
      })
      .catch((error: unknown) => {
        console.error(error);
        void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
      });
  }, [library, queryClient]);
}
