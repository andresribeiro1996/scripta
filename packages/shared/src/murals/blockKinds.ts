import { rekeyKeys } from "../library/dedupe.js";
import { bookKey } from "../library/merge.js";
import { booksByWork } from "../library/works.js";
import type { TierlistData } from "../tierlists/types.js";
import type { BlockLayout, BlockType, Mural, MuralBlock } from "./murals.js";

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

type Book = Record<string, unknown>;
export type TierlistLookup = (tierlistId: string) => Pick<TierlistData, "tiers" | "pool"> | undefined;

function byKeys(keys: readonly string[], books: Book[]): Book[] {
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  return [...new Set(keys)].flatMap<Book>((key) => byKey.get(key) ?? []);
}

const noBooks = (): Book[] => [];

/** Resolves a shelf's bookKeys back to actual book objects, in order — a
 *  key with no matching book (deleted some other way, or a merge quirk)
 *  is silently dropped rather than crashing the block, same tolerant
 *  convention as lib/groups.ts's booksInGroup. */
export function resolveShelfBooks(block: Extract<MuralBlock, { type: "shelf" }>, books: Book[]): Book[] {
  return byKeys(block.bookKeys, books);
}

interface Kind<T extends BlockType> {
  label: string;
  size: { w: number; h: number };
  minHeight: number;
  configurable: boolean;
  content(): Content<T>;
  valid(block: Record<string, unknown>): boolean;
  references(block: Block<T>, refs: BlockReferences): void;
  rekey(block: Block<T>, from: ReadonlySet<string>, to: string): Block<T>;
  scrub(block: Block<T>, keys: ReadonlySet<string>): Block<T> | null;
  draws(block: Block<T>, books: Book[], tierlist?: TierlistLookup): Book[];
}

const KINDS: { [T in BlockType]: Kind<T> } = {
  spotlight: { label: "Book spotlight", size: { w: 3, h: 4 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "" }),
    valid: (b) => typeof b.bookKey === "string",
    references: (b, refs) => { if (nonEmpty(b.bookKey)) refs.bookKeys.add(b.bookKey); },
    rekey: (b, from, to) => (from.has(b.bookKey) ? { ...b, bookKey: to } : b),
    scrub: (b, keys) => (keys.has(b.bookKey) ? null : b),
    draws: (b, books) => byKeys([b.bookKey], books) },
  shelf: { label: "Shelf", size: { w: 8, h: 4 }, minHeight: 4, configurable: true, content: () => ({ title: "", bookKeys: [] }),
    valid: (b) => Array.isArray(b.bookKeys),
    references: (b, refs) => { if (nonEmpty(b.collectionId)) refs.collectionIds.add(b.collectionId); else addStrings(refs.bookKeys, b.bookKeys); },
    rekey: (b, from, to) => ({ ...b, bookKeys: rekeyKeys(b.bookKeys, from, to) }),
    scrub: (b, keys) => {
      if (b.collectionId) return b;
      const bookKeys = b.bookKeys.filter((key) => !keys.has(key));
      if (bookKeys.length === b.bookKeys.length) return b;
      return bookKeys.length ? { ...b, bookKeys } : null;
    },
    draws: (b, books) => resolveShelfBooks(b, books) },
  quote: { label: "Quote spotlight", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "", highlightId: "" }),
    valid: (b) => typeof b.bookKey === "string",
    references: (b, refs) => { if (b.mode !== "rediscover") addQuote(refs, b); },
    rekey: (b, from, to) => (from.has(b.bookKey) ? { ...b, bookKey: to } : b),
    scrub: (b, keys) => (b.mode !== "rediscover" && keys.has(b.bookKey) ? null : b),
    draws: (b, books) => byKeys([b.bookKey], books) },
  quoteCollection: { label: "Quote collection", size: { w: 6, h: 4 }, minHeight: 0, configurable: true, content: () => ({ title: "", quotes: [] }),
    valid: (b) => Array.isArray(b.quotes),
    references: (b, refs) => { for (const quote of b.quotes) addQuote(refs, quote); },
    rekey: (b, from, to) => ({ ...b, quotes: rekeyQuotes(b.quotes, from, to) as typeof b.quotes }),
    scrub: (b, keys) => {
      const quotes = b.quotes.filter((quote) => !keys.has(quote.bookKey));
      if (quotes.length === b.quotes.length) return b;
      return quotes.length ? { ...b, quotes } : null;
    },
    draws: (b, books) => byKeys(b.quotes.map((quote) => quote.bookKey), books) },
  image: { label: "Image", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ imageId: "" }),
    valid: (b) => typeof b.imageId === "string",
    references: (b, refs) => { if (nonEmpty(b.imageId)) refs.imageIds.add(b.imageId); },
    rekey: same, scrub: same, draws: noBooks },
  text: { label: "Text", size: { w: 4, h: 2 }, minHeight: 0, configurable: true, content: () => ({ heading: "", body: "" }),
    valid: always, references: nothing, rekey: same, scrub: same, draws: noBooks },
  profile: { label: "Reader profile", size: { w: 6, h: 5 }, minHeight: 0, configurable: true, content: () => ({ bio: "", favoriteGenres: [] }),
    valid: always, references: (_b, refs) => { refs.needsShelfTheme = true; }, rekey: same, scrub: same, draws: noBooks },
  currentlyReading: { label: "Currently reading", size: { w: 4, h: 6 }, minHeight: 6, configurable: false, content: () => ({}),
    valid: always, references: (_b, refs) => { refs.needsCurrentlyReading = true; }, rekey: same, scrub: same,
    draws: (_b, books) => books.filter((book) => book.ReadStatus === 1) },
  stats: { label: "Stats", size: { w: 6, h: 2 }, minHeight: 0, configurable: true, content: () => ({ metrics: ["totalBooks", "booksFinished", "totalHighlights"] }),
    valid: (b) => Array.isArray(b.metrics),
    references: (b, refs) => addStrings(refs.statsMetrics, b.metrics),
    rekey: same, scrub: same, draws: noBooks },
  empty: { label: "Empty block", size: { w: 3, h: 2 }, minHeight: 0, configurable: false, content: () => ({}),
    valid: always, references: nothing, rekey: same, scrub: same, draws: noBooks },
  tierlist: { label: "Tier list", size: { w: 10, h: 8 }, minHeight: 8, configurable: true, content: () => ({ tierlistId: "" }),
    valid: always, references: nothing, rekey: same, scrub: same,
    draws: (b, books, tierlist) => {
      const data = tierlist?.(b.tierlistId);
      if (!data) return [];
      const byWork = booksByWork(books);
      return [...new Set([...data.tiers.flatMap((tier) => tier.workIds), ...data.pool])].flatMap<Book>((id) => byWork.get(id) ?? []);
    } },
  readerCard: { label: "Reader card", size: { w: 4, h: 6 }, minHeight: 0, configurable: false, content: () => ({}),
    valid: always, references: (_b, refs) => { refs.needsReaderCard = true; }, rekey: same, scrub: same, draws: noBooks }
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

export function blockBooks(block: MuralBlock, books: Book[], tierlist?: TierlistLookup): Book[] {
  return kindOf(block).draws(block, books, tierlist);
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

/** Scrubs one or more deleted books' keys out of every mural that
 *  referenced them, across every affected block type — called alongside
 *  actually deleting the book(s) (see LibraryPage.tsx/GroupsPage.tsx's
 *  handleDeleteSelected, same call site lib/groups.ts's
 *  removeBooksFromAllGroups is used from). A block that has nothing left
 *  to show once its reference is gone (spotlight/quote pointing straight
 *  at the deleted book, or a shelf/quoteCollection left with zero
 *  members) is removed entirely rather than left empty — same reasoning
 *  as lib/bookCovers.ts falling back to auto-resolution rather than
 *  leaving a dangling cover URL. Returns the SAME `murals` array
 *  reference when nothing was actually affected, matching
 *  removeBooksFromAllGroups/scrubImageFromBooks's no-op convention. */
export function scrubBooksFromMurals(murals: Mural[], keys: Iterable<string>): Mural[] {
  const keySet = keys instanceof Set ? keys : new Set(keys);
  if (keySet.size === 0) return murals;
  let changed = false;
  const result = murals.map((m) => {
    const blocks = m.blocks.flatMap((b) => {
      const next = kindOf(b).scrub(b, keySet);
      return next ? [next] : [];
    });
    if (blocks.length === m.blocks.length && blocks.every((b, i) => b === m.blocks[i])) return m;
    changed = true;
    return { ...m, blocks, updatedAt: new Date().toISOString() };
  });
  return changed ? result : murals;
}
