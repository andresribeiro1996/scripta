import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, needsGenreMetadata, type LibraryData } from "@scripta/shared";
import type { LibraryDocument } from "../api/library";
import { bookMetadataOptions } from "../lib/bookMetadata";

export function useGenreEnrichment(
  books: Array<Record<string, unknown>>,
  enabled: boolean,
  updateLibrary: (updater: (current: LibraryData) => LibraryData, base?: LibraryDocument) => Promise<LibraryDocument>,
) {
  const client = useQueryClient();
  const save = useRef(updateLibrary);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => enabled ? books.filter(needsGenreMetadata).slice(0, 4) : [], [books, enabled]);
  const signature = candidates.map(bookKey).join("|");

  useEffect(() => { save.current = updateLibrary; }, [updateLibrary]);

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    void Promise.allSettled(candidates.map(async (book) => ({ key: bookKey(book), metadata: await client.fetchQuery(bookMetadataOptions(book)) }))).then(async (results) => {
      if (cancelled) return;
      const updates = new Map(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.key, result.value.metadata?.genres ?? []] as const] : []));
      if (updates.size) await save.current((current) => ({ ...current, books: current.books.map((book) => updates.has(bookKey(book)) ? { ...book, _genres: updates.get(bookKey(book)) } : book) }));
      setError(results.some((result) => result.status === "rejected") ? "Some book genres couldn't be loaded." : null);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Book genres couldn't be saved.");
    });
    return () => { cancelled = true; };
  }, [candidates, client, signature]);

  return { error };
}
