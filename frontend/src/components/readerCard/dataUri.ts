import { renderReaderCard, type ReaderCardInput, type ReaderCardPage } from "@scripta/shared";

export function readerCardDataUri(input: ReaderCardInput, page: ReaderCardPage = "front"): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderReaderCard(input, page))}`;
}
