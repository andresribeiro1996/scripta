import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch } from "./style.js";

export interface ReaderCardStyleCache { get(): ReaderCardStyle | undefined; set(style: ReaderCardStyle): void; refresh?(): void }

let generation = 0;

export async function saveReaderCardStyle(cache: ReaderCardStyleCache, patch: ReaderCardStylePatch, update: (patch: ReaderCardStylePatch) => Promise<ReaderCardStyle>): Promise<void> {
  const mine = ++generation;
  const before = cache.get() ?? DEFAULT_READER_CARD_STYLE;
  cache.set(normalizeReaderCardStyle({ ...before, ...patch }));
  try {
    const saved = await update(patch);
    if (generation === mine) cache.set(saved);
  } catch (error) {
    if (generation === mine) {
      cache.set(before);
      cache.refresh?.();
    }
    throw error;
  }
}
