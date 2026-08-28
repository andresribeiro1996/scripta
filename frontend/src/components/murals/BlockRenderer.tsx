import type { GalleryImage } from "../../api/gallery";
import type { MuralBlock } from "../../lib/murals";
import { CurrentlyReadingBlockView, ShelfBlockView, SpotlightBlockView, TierListBlockView } from "./blocks/BookBlocks";
import { ImageBlockView, StatsBlockView, TextBlockView } from "./blocks/MiscBlocks";
import { QuoteBlockView, QuoteCollectionBlockView } from "./blocks/QuoteBlocks";

/** Dispatches a block to its view-mode renderer by `type` — the one place
 *  that knows every block type exists, so adding a new type later means
 *  adding one case here (plus its view component and, if it needs
 *  curation, an entry in BlockConfigPanel.tsx).
 *
 *  `editMode`/`onUpdateBlock` are here ONLY for `tierlist` — every other
 *  block type's own content is identical in Edit/View mode (edit mode
 *  just adds MuralCanvas.tsx's own drag handles/⚙ button AROUND the
 *  block, per this file's established convention). Tier list is the one
 *  exception: in edit mode it renders a live, draggable ranking board
 *  (an unranked "pool" panel plus draggable tiles, see
 *  TierListBlockView's own comment) rather than the plain read-only
 *  board every other mode/type gets, so it needs to know whether it's
 *  being edited and how to persist a drag/drop right away — both optional
 *  props, ignored entirely by every other case below. */
export function BlockRenderer({
  block,
  books,
  images,
  editMode,
  onUpdateBlock
}: {
  block: MuralBlock;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  editMode?: boolean;
  onUpdateBlock?: (block: MuralBlock) => void;
}) {
  switch (block.type) {
    case "spotlight":
      return <SpotlightBlockView block={block} books={books} />;
    case "shelf":
      return <ShelfBlockView block={block} books={books} />;
    case "quote":
      return <QuoteBlockView block={block} books={books} />;
    case "quoteCollection":
      return <QuoteCollectionBlockView block={block} books={books} />;
    case "image":
      return <ImageBlockView block={block} images={images} />;
    case "text":
      return <TextBlockView block={block} />;
    case "currentlyReading":
      return <CurrentlyReadingBlockView books={books} />;
    case "stats":
      return <StatsBlockView block={block} books={books} />;
    case "tierlist":
      return <TierListBlockView block={block} books={books} editMode={editMode} onUpdateBlock={onUpdateBlock} />;
    case "empty":
      // Genuinely nothing to render — the block wrapper itself
      // (MuralCanvas.tsx) already carries the whole BlockStyle
      // (background/border/radius/shadow/etc.), so an "empty" block's
      // entire purpose is fulfilled by that wrapper existing at all.
      return null;
  }
}
