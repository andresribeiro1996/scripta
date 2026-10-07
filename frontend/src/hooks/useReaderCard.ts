import { useMemo } from "react";
import { readerCardFacts, readerIdentity, type Group, type PublicReaderCard } from "@scripta/shared";

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], override?: PublicReaderCard) {
  const own = useMemo(() => (override ? null : readerIdentity(books, groups)), [books, groups, override]);
  const card = useMemo<PublicReaderCard>(() => override ?? { ...own!, ...readerCardFacts(books, groups, own!.identity) }, [override, own, books, groups]);
  return { card, own };
}
