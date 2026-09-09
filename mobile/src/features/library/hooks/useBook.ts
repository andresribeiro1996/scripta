// Resolves the book a `/book/[key]` route is about, plus the style it would
// inherit if it had no override of its own. The three book routes each need
// both, and the key arrives percent-encoded because a bookKey can contain
// characters that are not URL-safe.
import { useMemo } from "react";
import {
  bookKey,
  effectiveCardStyle,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  type LibraryStyleSettings,
} from "@scripta/shared";
import { useLibrary } from "./useLibrary";

export function useBook(rawKey: string | undefined): {
  book: Record<string, unknown> | null;
  /** The style this book falls back to: library-wide, overlaid by its series. */
  seedStyle: LibraryStyleSettings;
  /** False only while the library is still loading — distinguishes "not yet"
   *  from "no such book", which the routes report differently. */
  loading: boolean;
} {
  const { data: library, isPending } = useLibrary();
  const key = rawKey ? decodeURIComponent(rawKey) : undefined;

  return useMemo(() => {
    const books = library?.data.books ?? [];
    const groups = library?.data.groups ?? [];
    const book = key ? books.find((candidate) => bookKey(candidate) === key) ?? null : null;
    const libraryStyle = resolveLibraryStyle(library?.data.style);
    const seriesGroup = key ? seriesGroupByBookKey(books, groups).get(key) : undefined;
    return {
      book,
      seedStyle: effectiveCardStyle(libraryStyle, seriesGroup?.style),
      loading: isPending,
    };
  }, [isPending, key, library]);
}
