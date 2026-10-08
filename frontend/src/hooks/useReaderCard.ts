import { useMemo } from "react";
import { readerCardInputOf, type Group, type PublicReaderCard } from "@scripta/shared";

export const NO_GROUPS: Group[] = [];

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], readerName: string, override?: PublicReaderCard) {
  return useMemo(() => readerCardInputOf(books, groups, readerName, override), [books, groups, readerName, override]);
}
