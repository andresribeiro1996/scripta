import { useEffect, useMemo, useRef, useState } from "react";
import { bookKey, needsGenreMetadata, type LibraryData } from "@scripta/shared";
import { fetchBookMetadata } from "../api/bookMetadata";

export function useGenreEnrichment(
  books: Array<Record<string, unknown>>,
  enabled: boolean,
  updateLibrary: (updater: (current: LibraryData) => LibraryData) => Promise<unknown>,
) {
  const save = useRef(updateLibrary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => enabled ? books.filter(needsGenreMetadata).slice(0, 4) : [], [books, enabled]);
  const signature = candidates.map(bookKey).join("|");

  useEffect(() => { save.current = updateLibrary; }, [updateLibrary]);

  useEffect(() => {
    if (!signature) return;
    const controller = new AbortController();
    setLoading(true);
    void Promise.allSettled(candidates.map(async (book) => ({ key: bookKey(book), metadata: await fetchBookMetadata(book, controller.signal) }))).then(async (results) => {
      if (controller.signal.aborted) return;
      const updates = new Map(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.key, result.value.metadata?.genres ?? []] as const] : []));
      if (updates.size) await save.current((current) => ({ ...current, books: current.books.map((book) => updates.has(bookKey(book)) ? { ...book, _genres: updates.get(bookKey(book)) } : book) }));
      setError(results.some((result) => result.status === "rejected") ? "Some book genres couldn't be loaded." : null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Book genres couldn't be saved.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [candidates, signature]);

  return { loading, error };
}
