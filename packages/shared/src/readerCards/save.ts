import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch } from "./style.js";

export interface ReaderCardStyleCache { get(): ReaderCardStyle | undefined; set(style: ReaderCardStyle): void }

export async function saveReaderCardStyle(cache: ReaderCardStyleCache, patch: ReaderCardStylePatch, update: (patch: ReaderCardStylePatch) => Promise<ReaderCardStyle>): Promise<void> {
  const before = cache.get() ?? DEFAULT_READER_CARD_STYLE;
  const optimistic = normalizeReaderCardStyle({ ...before, ...patch });
  cache.set(optimistic);
  try {
    const saved = await update(patch);
    if (cache.get() === optimistic) cache.set(saved);
  } catch (error) {
    if (cache.get() === optimistic) cache.set(before);
    throw error;
  }
}
