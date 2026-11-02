import type { ReaderCardPage } from "./pages.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";

export function readerCardDataUri(input: ReaderCardInput, page: ReaderCardPage = "front"): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderReaderCard(input, page))}`;
}
