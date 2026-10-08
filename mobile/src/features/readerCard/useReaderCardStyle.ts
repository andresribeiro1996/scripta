import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { READER_CARD_STYLE_KEY, saveReaderCardStyleIn, type CoverOf, type OwnCardStyle, type ReaderCardStylePatch } from "@scripta/shared";
import { peekResolvedCover } from "../library/api/covers";
import { coverParamsFor } from "../library/components/CoverImage";
import { fetchReaderCardStyle, fetchReaderNumber, updateReaderCardStyle } from "./api";

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useReaderCardStyle(enabled = true) {
  return useQuery({ queryKey: READER_CARD_STYLE_KEY, queryFn: fetchReaderCardStyle, enabled });
}

export const READER_NUMBER_KEY = ["reader-card", "number"] as const;

export function useOwnCardStyle(enabled = true): OwnCardStyle | undefined {
  const { data: style } = useReaderCardStyle(enabled);
  const { data: readerNumber } = useQuery({ queryKey: READER_NUMBER_KEY, queryFn: fetchReaderNumber, enabled: enabled && style?.footer.left === "readerNumber", staleTime: Infinity });
  return useMemo(() => (style ? { style, coverOf, readerNumber: style.footer.left === "readerNumber" ? readerNumber : null } : undefined), [style, readerNumber]);
}

export function useSaveReaderCardStyle() {
  const client = useQueryClient();
  return useCallback((patch: ReaderCardStylePatch) => saveReaderCardStyleIn(client, patch, updateReaderCardStyle), [client]);
}
