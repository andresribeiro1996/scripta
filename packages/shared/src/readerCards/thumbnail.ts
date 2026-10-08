import type { DialSegment } from "../library/readerCardFacts.js";
import type { Counter } from "./counters.js";
import type { ReaderCardBase } from "./render.js";

export const THUMBNAIL_MARKS = 24;

export function thumbnailSegments(segments: DialSegment[]): DialSegment[] {
  const total = segments.reduce((sum, segment) => sum + segment.books, 0);
  if (total <= THUMBNAIL_MARKS) return segments;
  return segments.map((segment) => {
    if (!segment.books) return segment;
    const books = Math.max(1, Math.round((segment.books * THUMBNAIL_MARKS) / total));
    return { ...segment, books, marked: Math.min(books, Math.round((segment.marked * books) / segment.books)) };
  });
}

export function counterThumbnail(input: ReaderCardBase, counter: Counter): ReaderCardBase {
  const { dial } = input.card;
  return { ...input, style: { ...input.style, counter }, card: dial ? { ...input.card, dial: { segments: thumbnailSegments(dial.segments) } } : input.card };
}
