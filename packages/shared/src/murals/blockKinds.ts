import type { BlockLayout, BlockType, MuralBlock } from "./murals.js";

type Content<T extends BlockType> = Omit<Extract<MuralBlock, { type: T }>, "id" | "type" | "layout" | "style" | "expandedFrom">;

interface Kind<T extends BlockType> {
  label: string;
  size: { w: number; h: number };
  minHeight: number;
  configurable: boolean;
  content(): Content<T>;
}

const KINDS: { [T in BlockType]: Kind<T> } = {
  spotlight: { label: "Book spotlight", size: { w: 3, h: 4 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "" }) },
  shelf: { label: "Shelf", size: { w: 8, h: 4 }, minHeight: 4, configurable: true, content: () => ({ title: "", bookKeys: [] }) },
  quote: { label: "Quote spotlight", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "", highlightId: "" }) },
  quoteCollection: { label: "Quote collection", size: { w: 6, h: 4 }, minHeight: 0, configurable: true, content: () => ({ title: "", quotes: [] }) },
  image: { label: "Image", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ imageId: "" }) },
  text: { label: "Text", size: { w: 4, h: 2 }, minHeight: 0, configurable: true, content: () => ({ heading: "", body: "" }) },
  profile: { label: "Reader profile", size: { w: 6, h: 5 }, minHeight: 0, configurable: true, content: () => ({ bio: "", favoriteGenres: [] }) },
  currentlyReading: { label: "Currently reading", size: { w: 4, h: 6 }, minHeight: 6, configurable: false, content: () => ({}) },
  stats: { label: "Stats", size: { w: 6, h: 2 }, minHeight: 0, configurable: true, content: () => ({ metrics: ["totalBooks", "booksFinished", "totalHighlights"] }) },
  empty: { label: "Empty block", size: { w: 3, h: 2 }, minHeight: 0, configurable: false, content: () => ({}) },
  tierlist: { label: "Tier list", size: { w: 10, h: 8 }, minHeight: 8, configurable: true, content: () => ({ tierlistId: "" }) },
  readerCard: { label: "Reader card", size: { w: 4, h: 6 }, minHeight: 0, configurable: false, content: () => ({}) }
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
