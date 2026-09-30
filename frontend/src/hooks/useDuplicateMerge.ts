import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mergeCertainDuplicates } from "@scripta/shared";
import { ApiError } from "../api/client";
import { fetchLibrary, mergeLibraryBooks, type LibraryDocument } from "../api/library";

export function useDuplicateMerge(library: LibraryDocument | null | undefined) {
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (!library || ran.current) return;
    ran.current = true;
    void mergeCertainDuplicates(library, mergeLibraryBooks, fetchLibrary, (error) => error instanceof ApiError && error.status === 409)
      .then((merged) => {
        if (merged !== library) queryClient.setQueryData(["library"], merged);
      })
      .catch((error: unknown) => {
        console.error(error);
        void queryClient.invalidateQueries({ queryKey: ["library"] });
      });
  }, [library, queryClient]);
}
