import { useMemo } from "react";
import { readerCardInputOf, type CoverOf, type Group, type PublicReaderCard } from "@scripta/shared";
import { peekResolvedCover } from "../api/covers";
import { coverParamsFor } from "../components/BookCard";
import { useReaderCardStyle } from "./useReaderCardStyle";

export const NO_GROUPS: Group[] = [];

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], readerName: string, override?: PublicReaderCard) {
  const { data: style } = useReaderCardStyle(!override);
  return useMemo(() => readerCardInputOf(books, groups, readerName, override, override || !style ? undefined : { style, coverOf }), [books, groups, readerName, override, style]);
}
