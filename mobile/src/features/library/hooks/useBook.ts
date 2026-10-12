// Resolves the book a `/book/[key]` route is about, plus the style it would
// inherit if it had no override of its own. The three book routes each need
// both.
import { useMemo } from "react";
import {
  bookKey,
  effectiveCardStyle,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  type LibraryStyleSettings,
} from "@scripta/shared";
import { useLibrary } from "./useLibrary";

export function useBook(key: string | undefined): {
  book: Record<string, unknown> | null;
  /** The style this book falls back to: library-wide, overlaid by its series. */
  seedStyle: LibraryStyleSettings;
  inheritedFrom: string;
  /** False only while the library is still loading — distinguishes "not yet"
   *  from "no such book", which the routes report differently. */
  loading: boolean;
  workId: string | null;
} {
  const { data: library, isPending } = useLibrary();

  return useMemo(() => {
    const books = library?.data.books ?? [];
    const groups = library?.data.groups ?? [];
    const book = key ? books.find((candidate) => bookKey(candidate) === key) ?? null : null;
    const libraryStyle = resolveLibraryStyle(library?.data.style);
    const seriesGroup = key ? seriesGroupByBookKey(books, groups).get(key) : undefined;
    return {
      book,
      seedStyle: effectiveCardStyle(libraryStyle, seriesGroup?.style),
      inheritedFrom: seriesGroup?.style ? `series “${seriesGroup.name}”` : library?.data.name ? `library “${library.data.name}”` : "your library",
      loading: isPending,
      workId: (key && library?.works?.[key]) || null,
    };
  }, [isPending, key, library]);
}
