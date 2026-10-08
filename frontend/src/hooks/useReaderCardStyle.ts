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
    let written: ReaderCardStyle | undefined;
    const get = () => {
      const stored = client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY);
      return written && JSON.stringify(stored) === JSON.stringify(written) ? written : stored;
    };
    const set = (style: ReaderCardStyle) => {
      written = style;
      client.setQueryData(READER_CARD_STYLE_KEY, style);
    };
    await saveReaderCardStyle({ get, set }, patch, updateReaderCardStyle);
  }, [client]);
}
