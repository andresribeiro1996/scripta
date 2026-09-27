import { useEffect, useMemo, useRef } from "react";
import { bookKey, genreLookupOrder, GENRE_LOOKUP_BATCH, type LibraryData } from "@scripta/shared";
import { fetchBookMetadata } from "../api/bookMetadata";

const CONCURRENCY = 4;

async function withConcurrency<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await run(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function useGenreEnrichment(
  books: Array<Record<string, unknown>>,
  updateLibrary: (updater: (current: LibraryData) => LibraryData) => Promise<unknown>,
) {
  const save = useRef(updateLibrary);
  const stopped = useRef(false);
  const candidates = useMemo(() => genreLookupOrder(books).slice(0, GENRE_LOOKUP_BATCH), [books]);
  const signature = candidates.map(bookKey).join("|");

  useEffect(() => { save.current = updateLibrary; }, [updateLibrary]);

  useEffect(() => {
    if (!signature || stopped.current) return;
    const controller = new AbortController();
    void withConcurrency(candidates, CONCURRENCY, async (book) => ({ key: bookKey(book), metadata: await fetchBookMetadata(book, controller.signal) })).then(async (results) => {
      if (controller.signal.aborted) return;
      const updates = new Map(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.key, result.value.metadata?.genres ?? []] as const] : []));
      if (!updates.size) return;
      try {
        await save.current((current) => ({ ...current, books: current.books.map((book) => updates.has(bookKey(book)) ? { ...book, _genres: updates.get(bookKey(book)) } : book) }));
      } catch (reason) {
        if (!controller.signal.aborted) {
          stopped.current = true;
          console.error(reason);
        }
      }
    });
    return () => controller.abort();
  }, [candidates, signature]);
}
