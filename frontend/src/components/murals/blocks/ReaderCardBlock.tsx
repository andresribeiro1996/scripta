import type { Group, PublicReaderCard } from "@scripta/shared";
import { useReaderCard } from "../../../hooks/useReaderCard";
import { ReaderCardImage } from "../../readerCard/ReaderCardImage";

export function ReaderCardBlockView({ books, groups, readerCardOverride, readerName }: { books: Array<Record<string, unknown>>; groups: Group[]; readerCardOverride?: PublicReaderCard; readerName: string }) {
  const input = useReaderCard(books, groups, readerName, readerCardOverride);
  return <ReaderCardImage input={input} className="mx-auto h-full max-w-full" />;
}
