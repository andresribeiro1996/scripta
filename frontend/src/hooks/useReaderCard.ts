import { useMemo } from "react";
import { readerIdentity, type Group, type PublicReaderCard } from "@scripta/shared";

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], override?: PublicReaderCard) {
  const own = useMemo(() => (override ? null : readerIdentity(books, groups)), [books, groups, override]);
  return { card: (override ?? own)!, own };
}
