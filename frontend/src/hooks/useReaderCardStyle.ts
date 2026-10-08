import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saveReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch } from "@scripta/shared";
import { fetchReaderCardStyle, updateReaderCardStyle } from "../api/readerCard";

export const READER_CARD_STYLE_KEY = ["reader-card", "style"] as const;

export function useReaderCardStyle(enabled = true) {
  return useQuery({ queryKey: READER_CARD_STYLE_KEY, queryFn: fetchReaderCardStyle, enabled });
}

export function useSaveReaderCardStyle() {
  const client = useQueryClient();
  return useCallback(async (patch: ReaderCardStylePatch) => {
    await client.cancelQueries({ queryKey: READER_CARD_STYLE_KEY });
    try {
      await saveReaderCardStyle({ get: () => client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY), set: (style) => client.setQueryData(READER_CARD_STYLE_KEY, style) }, patch, updateReaderCardStyle);
    } catch (error) {
      void client.invalidateQueries({ queryKey: READER_CARD_STYLE_KEY });
      throw error;
    }
  }, [client]);
}
