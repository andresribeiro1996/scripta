import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, genreLookupOrder, settleWithConcurrency, withCatalogGenres, GENRE_LOOKUP_BATCH, GENRE_LOOKUP_CONCURRENCY, GENRES_FROM_CATALOG, type LibraryData } from "@scripta/shared";
import type { LibraryDocument } from "../api/library";
import { bookMetadataOptions } from "../lib/bookMetadata";

export function useGenreEnrichment(
  books: Array<Record<string, unknown>>,
  catalogGenres: Record<string, string[]> | undefined,
  updateLibrary: (updater: (current: LibraryData) => LibraryData) => Promise<LibraryDocument>,
) {
  const client = useQueryClient();
  const save = useRef(updateLibrary);
  const stopped = useRef(false);
  const fromCatalog = useMemo(() => withCatalogGenres({ books }, catalogGenres ?? {}).books !== books, [books, catalogGenres]);
  const candidates = useMemo(() => genreLookupOrder(books).slice(0, GENRE_LOOKUP_BATCH), [books]);
  const signature = candidates.map(bookKey).join("|");

  useEffect(() => { save.current = updateLibrary; }, [updateLibrary]);

  useEffect(() => {
    if (!fromCatalog || stopped.current) return;
    let cancelled = false;
    save.current((current) => withCatalogGenres(current, catalogGenres ?? {})).catch((reason: unknown) => {
      if (!cancelled) {
        stopped.current = true;
        console.error(reason);
      }
    });
    return () => { cancelled = true; };
  }, [catalogGenres, fromCatalog]);

  useEffect(() => {
    if (fromCatalog || !signature || stopped.current) return;
    let cancelled = false;
    void settleWithConcurrency(candidates, GENRE_LOOKUP_CONCURRENCY, async (book) => ({ key: bookKey(book), metadata: await client.fetchQuery(bookMetadataOptions(book)) })).then(async (results) => {
      if (cancelled) return;
      const updates = new Map(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.key, result.value.metadata?.genres ?? []] as const] : []));
      if (!updates.size) return;
      try {
        await save.current((current) => ({ ...current, books: current.books.map((book) => updates.has(bookKey(book)) ? { ...book, _genres: updates.get(bookKey(book)), _genresFrom: GENRES_FROM_CATALOG } : book) }));
      } catch (reason) {
        if (!cancelled) {
          stopped.current = true;
          console.error(reason);
        }
      }
    });
    return () => { cancelled = true; };
  }, [candidates, client, fromCatalog, signature]);
}
