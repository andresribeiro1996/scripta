import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { READER_CARD_STYLE_KEY, saveReaderCardStyleIn, type ReaderCardStylePatch } from "@scripta/shared";
import { fetchReaderCardStyle, updateReaderCardStyle } from "../api/readerCard";

export function useReaderCardStyle(enabled = true) {
  return useQuery({ queryKey: READER_CARD_STYLE_KEY, queryFn: fetchReaderCardStyle, enabled });
}

export function useSaveReaderCardStyle() {
  const client = useQueryClient();
  return useCallback((patch: ReaderCardStylePatch) => saveReaderCardStyleIn(client, patch, updateReaderCardStyle), [client]);
}
