import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { READER_CARD_STYLE_KEY, saveReaderCardStyleIn, type CoverOf, type ReaderCardStylePatch } from "@scripta/shared";
import { peekResolvedCover } from "../library/api/covers";
import { coverParamsFor } from "../library/components/CoverImage";
import { fetchReaderCardStyle, updateReaderCardStyle } from "./api";

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useReaderCardStyle(enabled = true) {
  return useQuery({ queryKey: READER_CARD_STYLE_KEY, queryFn: fetchReaderCardStyle, enabled });
}

export function useSaveReaderCardStyle() {
  const client = useQueryClient();
  return useCallback((patch: ReaderCardStylePatch) => saveReaderCardStyleIn(client, patch, updateReaderCardStyle), [client]);
}
