import type { GalleryImage } from "../../api/gallery";
import type { ResolvedTierlist } from "../../api/tierlists";
import type { MuralBlock } from "../../lib/murals";
import { CurrentlyReadingBlockView, ShelfBlockView, SpotlightBlockView, TierListBlockView } from "./blocks/BookBlocks";
import { ImageBlockView, StatsBlockView, TextBlockView } from "./blocks/MiscBlocks";
import { QuoteBlockView, QuoteCollectionBlockView } from "./blocks/QuoteBlocks";

/** Dispatches a block to its view-mode renderer by `type` — the one place
 *  that knows every block type exists, so adding a new type later means
 *  adding a case here (plus its view component and, if it needs
 *  curation, an entry in BlockConfigPanel.tsx).
 *
 *  Every block renders identically in Edit/View mode — edit mode just
 *  adds MuralCanvas.tsx's own drag affordances AROUND the block. The two
 *  data-threading props exist for the two block types whose content
 *  isn't entirely on the block itself: `statsOverride` (public share
 *  pages carry precomputed numbers instead of a live library) and
 *  `tierlistData` (the tierlist block is a reference; whoever renders
 *  the canvas resolves it — useTierlists' cache when authenticated, the
 *  shared-mural response's server-side resolution when public). */
export function BlockRenderer({
  block,
  books,
  images,
  statsOverride,
  tierlistData
}: {
  block: MuralBlock;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  /** See MuralCanvas.tsx's own comment — threaded straight through to
   *  StatsBlockView, ignored by every other case. */
  statsOverride?: Record<string, number>;
  /** Resolves a tierlist block's `tierlistId` into its document —
   *  undefined (or an undefined result) renders TierListBlockView's
   *  "unavailable" state. See this file's own top comment. */
  tierlistData?: (tierlistId: string) => ResolvedTierlist | undefined;
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
      return <StatsBlockView block={block} books={books} statsOverride={statsOverride} />;
    case "tierlist":
      return <TierListBlockView tierlist={tierlistData?.(block.tierlistId)} books={books} />;
    case "empty":
      // Genuinely nothing to render — the block wrapper itself
      // (MuralCanvas.tsx) already carries the whole BlockStyle
      // (background/border/radius/shadow/etc.), so an "empty" block's
      // entire purpose is fulfilled by that wrapper existing at all.
      return null;
  }
}
