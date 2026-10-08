import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { readerCardInputOf, type CoverOf, type Group, type OwnCardStyle, type PublicReaderCard } from "@scripta/shared";
import { fetchReaderNumber } from "../api/readerCard";
import { peekResolvedCover } from "../api/covers";
import { coverParamsFor } from "../components/BookCard";
import { useReaderCardStyle } from "./useReaderCardStyle";

export const NO_GROUPS: Group[] = [];
export const READER_NUMBER_KEY = ["reader-card", "number"] as const;

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useOwnCardStyle(enabled = true): OwnCardStyle | undefined {
  const { data: style } = useReaderCardStyle(enabled);
  const { data: readerNumber } = useQuery({ queryKey: READER_NUMBER_KEY, queryFn: fetchReaderNumber, enabled: enabled && style?.footer.left === "readerNumber", staleTime: Infinity });
  return useMemo(() => (style ? { style, coverOf, readerNumber: style.footer.left === "readerNumber" ? readerNumber : null } : undefined), [style, readerNumber]);
}

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], readerName: string, override?: PublicReaderCard) {
  const own = useOwnCardStyle(!override);
  return useMemo(() => readerCardInputOf(books, groups, readerName, override, override ? undefined : own), [books, groups, readerName, override, own]);
}
