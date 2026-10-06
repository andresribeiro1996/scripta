import { rekeyKeys } from "../library/dedupe.js";
import type { BlockLayout, BlockType, MuralBlock } from "./murals.js";

type Content<T extends BlockType> = Omit<Extract<MuralBlock, { type: T }>, "id" | "type" | "layout" | "style" | "expandedFrom">;

export interface BlockReferences {
  bookKeys: Set<string>;
  collectionIds: Set<string>;
  highlightRefs: Array<{ bookKey: string; highlightId: string }>;
  imageIds: Set<string>;
  needsCurrentlyReading: boolean;
  statsMetrics: Set<string>;
  needsShelfTheme: boolean;
  needsReaderCard: boolean;
}

type Block<T extends BlockType> = Extract<MuralBlock, { type: T }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function addStrings(target: Set<string>, values: readonly unknown[]) {
  for (const value of values) if (nonEmpty(value)) target.add(value);
}

function addQuote(refs: BlockReferences, quote: unknown) {
  if (!isRecord(quote) || !nonEmpty(quote.bookKey)) return;
  refs.bookKeys.add(quote.bookKey);
  if (nonEmpty(quote.highlightId)) refs.highlightRefs.push({ bookKey: quote.bookKey, highlightId: quote.highlightId });
}

function rekeyQuotes(quotes: readonly unknown[], from: ReadonlySet<string>, to: string): unknown[] {
  const seen = new Set<string>();
  return quotes.flatMap((quote) => {
    if (!isRecord(quote)) return [quote];
    const next = typeof quote.bookKey === "string" && from.has(quote.bookKey) ? { ...quote, bookKey: to } : quote;
    const id = `${String(next.bookKey)}\u0000${String(next.highlightId)}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [next];
  });
}

const always = () => true;
const nothing = () => {};
const same = <B>(block: B) => block;

interface Kind<T extends BlockType> {
  label: string;
  size: { w: number; h: number };
  minHeight: number;
  configurable: boolean;
  content(): Content<T>;
  valid(block: Record<string, unknown>): boolean;
  references(block: Block<T>, refs: BlockReferences): void;
  rekey(block: Block<T>, from: ReadonlySet<string>, to: string): Block<T>;
}

const KINDS: { [T in BlockType]: Kind<T> } = {
  spotlight: { label: "Book spotlight", size: { w: 3, h: 4 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "" }),
    valid: (b) => typeof b.bookKey === "string",
    references: (b, refs) => { if (nonEmpty(b.bookKey)) refs.bookKeys.add(b.bookKey); },
    rekey: (b, from, to) => (from.has(b.bookKey) ? { ...b, bookKey: to } : b) },
  shelf: { label: "Shelf", size: { w: 8, h: 4 }, minHeight: 4, configurable: true, content: () => ({ title: "", bookKeys: [] }),
    valid: (b) => Array.isArray(b.bookKeys),
    references: (b, refs) => { if (nonEmpty(b.collectionId)) refs.collectionIds.add(b.collectionId); else addStrings(refs.bookKeys, b.bookKeys); },
    rekey: (b, from, to) => ({ ...b, bookKeys: rekeyKeys(b.bookKeys, from, to) }) },
  quote: { label: "Quote spotlight", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "", highlightId: "" }),
    valid: (b) => typeof b.bookKey === "string",
    references: (b, refs) => { if (b.mode !== "rediscover") addQuote(refs, b); },
    rekey: (b, from, to) => (from.has(b.bookKey) ? { ...b, bookKey: to } : b) },
  quoteCollection: { label: "Quote collection", size: { w: 6, h: 4 }, minHeight: 0, configurable: true, content: () => ({ title: "", quotes: [] }),
    valid: (b) => Array.isArray(b.quotes),
    references: (b, refs) => { for (const quote of b.quotes) addQuote(refs, quote); },
    rekey: (b, from, to) => ({ ...b, quotes: rekeyQuotes(b.quotes, from, to) as typeof b.quotes }) },
  image: { label: "Image", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ imageId: "" }),
    valid: (b) => typeof b.imageId === "string",
    references: (b, refs) => { if (nonEmpty(b.imageId)) refs.imageIds.add(b.imageId); },
    rekey: same },
  text: { label: "Text", size: { w: 4, h: 2 }, minHeight: 0, configurable: true, content: () => ({ heading: "", body: "" }),
    valid: always, references: nothing, rekey: same },
  profile: { label: "Reader profile", size: { w: 6, h: 5 }, minHeight: 0, configurable: true, content: () => ({ bio: "", favoriteGenres: [] }),
    valid: always, references: (_b, refs) => { refs.needsShelfTheme = true; }, rekey: same },
  currentlyReading: { label: "Currently reading", size: { w: 4, h: 6 }, minHeight: 6, configurable: false, content: () => ({}),
    valid: always, references: (_b, refs) => { refs.needsCurrentlyReading = true; }, rekey: same },
  stats: { label: "Stats", size: { w: 6, h: 2 }, minHeight: 0, configurable: true, content: () => ({ metrics: ["totalBooks", "booksFinished", "totalHighlights"] }),
    valid: (b) => Array.isArray(b.metrics),
    references: (b, refs) => addStrings(refs.statsMetrics, b.metrics),
    rekey: same },
  empty: { label: "Empty block", size: { w: 3, h: 2 }, minHeight: 0, configurable: false, content: () => ({}),
    valid: always, references: nothing, rekey: same },
  tierlist: { label: "Tier list", size: { w: 10, h: 8 }, minHeight: 8, configurable: true, content: () => ({ tierlistId: "" }),
    valid: always, references: nothing, rekey: same },
  readerCard: { label: "Reader card", size: { w: 4, h: 6 }, minHeight: 0, configurable: false, content: () => ({}),
    valid: always, references: (_b, refs) => { refs.needsReaderCard = true; }, rekey: same }
};

export const BLOCK_TYPES = Object.keys(KINDS) as BlockType[];

export function blockLabel(type: BlockType): string {
  return KINDS[type].label;
}

export function blockSize(type: BlockType): { w: number; h: number } {
  return KINDS[type].size;
}

export function minBlockHeight(type: BlockType): number {
  return KINDS[type].minHeight;
}

export function isConfigurable(type: BlockType): boolean {
  return KINDS[type].configurable;
}

export function newBlock(id: string, type: BlockType, layout: BlockLayout): MuralBlock {
  return { id, type, layout, ...KINDS[type].content() } as MuralBlock;
}

function kindOf(block: MuralBlock): Kind<BlockType> {
  return KINDS[block.type] as Kind<BlockType>;
}

function known(value: unknown): MuralBlock | undefined {
  if (!isRecord(value) || !BLOCK_TYPES.includes(value.type as BlockType)) return undefined;
  return KINDS[value.type as BlockType].valid(value) ? (value as unknown as MuralBlock) : undefined;
}

export function blockReferences(blocks: unknown): BlockReferences {
  const refs: BlockReferences = {
    bookKeys: new Set(),
    collectionIds: new Set(),
    highlightRefs: [],
    imageIds: new Set(),
    needsCurrentlyReading: false,
    statsMetrics: new Set(),
    needsShelfTheme: false,
    needsReaderCard: false
  };
  if (!Array.isArray(blocks)) return refs;
  for (const value of blocks) {
    const block = known(value);
    if (block) kindOf(block).references(block, refs);
  }
  return refs;
}

export function rekeyBlocks(blocks: unknown, from: ReadonlySet<string>, to: string): unknown {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((value) => {
    const block = known(value);
    return block ? kindOf(block).rekey(block, from, to) : value;
  });
}
