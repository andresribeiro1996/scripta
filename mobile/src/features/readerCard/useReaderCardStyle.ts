import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saveReaderCardStyle, type CoverOf, type ReaderCardStyle, type ReaderCardStylePatch } from "@scripta/shared";
import { peekResolvedCover } from "../library/api/covers";
import { coverParamsFor } from "../library/components/CoverImage";
import { fetchReaderCardStyle, updateReaderCardStyle } from "./api";

export const READER_CARD_STYLE_KEY = ["reader-card", "style"] as const;

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useReaderCardStyle(enabled = true) {
  return useQuery({ queryKey: READER_CARD_STYLE_KEY, queryFn: fetchReaderCardStyle, enabled });
}

export function useSaveReaderCardStyle() {
  const client = useQueryClient();
  return useCallback(async (patch: ReaderCardStylePatch) => {
    void client.cancelQueries({ queryKey: READER_CARD_STYLE_KEY });
    await saveReaderCardStyle(
      { get: () => client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY), set: (style) => client.setQueryData(READER_CARD_STYLE_KEY, style), refresh: () => void client.invalidateQueries({ queryKey: READER_CARD_STYLE_KEY }) },
      patch,
      updateReaderCardStyle,
    );
  }, [client]);
}
