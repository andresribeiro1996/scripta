import { useMemo } from "react";
import { withWorkIds } from "@scripta/shared";
import type { LibraryDocument } from "../api/types";

export function useWorkBooks(library: LibraryDocument | null | undefined): Array<Record<string, unknown>> {
  const books = library?.data.books;
  const works = library?.works;
  return useMemo(() => withWorkIds(books ?? [], works), [books, works]);
}
