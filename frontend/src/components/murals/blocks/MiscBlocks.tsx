import type { GalleryImage } from "../../../api/gallery";
import { computeStat } from "../../../lib/muralStats";
import { STAT_METRIC_LABELS, type MuralBlock } from "../../../lib/murals";
import { EmptyBlockState } from "./BookBlocks";

/** A heading and/or freeform note — connective tissue between the other
 *  blocks ("2026 was a big reading year because..."). Either field can be
 *  empty; both empty is just an unconfigured block.
 *
 *  Both heading and body have no explicit color, so both inherit the
 *  block's (possibly customized) `textColor` — this block IS the user's
 *  own words, unlike a caption/label elsewhere, so there's no "keep it
 *  muted regardless" reason to override it here. Sizes are `em` (see
 *  BookBlocks.tsx's MiniBookTile comment for why). */
export function TextBlockView({ block }: { block: Extract<MuralBlock, { type: "text" }> }) {
  if (!block.heading && !block.body) {
    return <EmptyBlockState message="Add a heading or some text." />;
  }
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto p-3.5">
      {block.heading && <h3 className="text-[1.3em] font-bold">{block.heading}</h3>}
      {block.body && <p className="text-[1em] whitespace-pre-wrap">{block.body}</p>}
    </div>
  );
}

/** A plain image from the gallery pool — decorative, or a photo, breaking
 *  up the wall visually. `images` is the caller's already-fetched gallery
 *  list (MuralEditorPage.tsx, via useGalleryImages()) — looked up by id
 *  rather than re-fetching per block. */
export function ImageBlockView({ block, images }: { block: Extract<MuralBlock, { type: "image" }>; images: GalleryImage[] }) {
  const image = images.find((img) => img.id === block.imageId);
  if (!image) {
    return <EmptyBlockState message="Pick an image from your gallery." />;
  }
  return (
    <div className="relative h-full w-full overflow-hidden bg-(--color-border)">
      <img src={image.url} alt="" className="h-full w-full object-cover" />
      {block.caption && (
        // Deliberately always white, not `textColor` — this sits on top
        // of a photo, not the block's own background, so it needs to
        // stay legible regardless of what the block's text color is set
        // to.
        <div className="absolute right-0 bottom-0 left-0 bg-[rgba(10,8,6,0.6)] px-2.5 py-1.5 text-[0.85em] text-white">{block.caption}</div>
      )}
    </div>
  );
}

/** Small auto-computed numbers, laid out as a strip — see
 *  lib/muralStats.ts for what each metric actually counts. No picker: the
 *  only configurable thing is WHICH metrics show (StatsBlockEditor.tsx),
 *  never their values. */
export function StatsBlockView({ block, books }: { block: Extract<MuralBlock, { type: "stats" }>; books: Array<Record<string, unknown>> }) {
  if (block.metrics.length === 0) {
    return <EmptyBlockState message="Pick which numbers to show." />;
  }
  return (
    <div className="flex h-full items-center justify-around gap-2 overflow-x-auto p-2.5">
      {block.metrics.map((metric) => (
        <div key={metric} className="shrink-0 text-center">
          {/* Deliberately always accent-colored, not `textColor` — same
              "this is a badge, not body content" reasoning as
              BookCard.tsx's highlight-count badge. */}
          <div className="text-[1.6em] font-bold text-(--color-accent)">{computeStat(metric, books)}</div>
          <div className="text-[0.75em] text-(--color-text-dim)">{STAT_METRIC_LABELS[metric]}</div>
        </div>
      ))}
    </div>
  );
}
