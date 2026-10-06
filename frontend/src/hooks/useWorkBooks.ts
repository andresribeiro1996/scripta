import { useMemo } from "react";
import { withWorkIds } from "@scripta/shared";
import type { LibraryDocument } from "../api/library";

export function useWorkBooks(library: LibraryDocument | null | undefined): Array<Record<string, unknown>> {
  return useMemo(() => withWorkIds(library?.data.books ?? [], library?.works), [library?.data.books, library?.works]);
}
