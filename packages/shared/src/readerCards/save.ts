import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch } from "./style.js";

export interface ReaderCardStyleCache { get(): ReaderCardStyle | undefined; set(style: ReaderCardStyle): void; refresh?(): void }

export const READER_CARD_STYLE_KEY = ["reader-card", "style"] as const;

let generation = 0;
let tail: Promise<unknown> = Promise.resolve();

export async function saveReaderCardStyle(cache: ReaderCardStyleCache, patch: ReaderCardStylePatch, update: (patch: ReaderCardStylePatch) => Promise<ReaderCardStyle>): Promise<void> {
  const mine = ++generation;
  const before = cache.get() ?? DEFAULT_READER_CARD_STYLE;
  cache.set(normalizeReaderCardStyle({ ...before, ...patch }));
  const turn = tail.then(() => update(patch));
  tail = turn.catch(() => undefined);
  try {
    const saved = await turn;
    if (generation === mine) cache.set(saved);
  } catch (error) {
    if (generation === mine) {
      cache.set(before);
      cache.refresh?.();
    }
    throw error;
  }
}

export interface ReaderCardStyleQueries {
  cancelQueries(filters: { queryKey: typeof READER_CARD_STYLE_KEY }): unknown;
  getQueryData(queryKey: typeof READER_CARD_STYLE_KEY): ReaderCardStyle | undefined;
  setQueryData(queryKey: typeof READER_CARD_STYLE_KEY, data: ReaderCardStyle): unknown;
  invalidateQueries(filters: { queryKey: typeof READER_CARD_STYLE_KEY }): unknown;
}

export function saveReaderCardStyleIn(queries: ReaderCardStyleQueries, patch: ReaderCardStylePatch, update: (patch: ReaderCardStylePatch) => Promise<ReaderCardStyle>): Promise<void> {
  void queries.cancelQueries({ queryKey: READER_CARD_STYLE_KEY });
  return saveReaderCardStyle(
    { get: () => queries.getQueryData(READER_CARD_STYLE_KEY), set: (style) => void queries.setQueryData(READER_CARD_STYLE_KEY, style), refresh: () => void queries.invalidateQueries({ queryKey: READER_CARD_STYLE_KEY }) },
    patch,
    update,
  );
}
