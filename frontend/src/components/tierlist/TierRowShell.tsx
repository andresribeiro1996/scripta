import type { ReactNode } from "react";
import type { TierDefinition } from "../../api/tierlists";

/** One rung of the tier list — a fixed-width colored label on the left
 *  (the tier's own color, white bold text; no auto-contrast calculation,
 *  same deliberate choice TierListEditorPage's own tier rows make) and
 *  its books on the right, WRAPPING onto additional lines rather than
 *  scrolling — deliberately the opposite of ShelfBlockView's horizontal
 *  scroll. A shelf is a hand-curated, ordered sequence where order and
 *  "which ones are visible first" matter, so scrolling (never reflowing
 *  the row's own height) is right for it; a tier is closer to a bucket
 *  you keep piling books into, where the whole point is seeing every
 *  book on that rung at a glance, not scrubbing through it — so a rung
 *  with more books than fit on one line simply grows taller
 *  (`flex-wrap`) instead of hiding the overflow behind a scrollbar.
 *  Rendered even when empty — a tier list's whole point is showing every
 *  configured rung, blank ones included, not hiding the ones nobody's
 *  filled in yet.
 *
 *  The label itself needs its OWN `overflow-hidden` (not just the row's) —
 *  a label is free-typed text, so a long single "word" with no spaces to
 *  wrap on (no whitespace for the browser's normal line-breaking) would
 *  otherwise render past the edge of its fixed `w-[3em]` box and visibly
 *  bleed into the books next to it, since a flex child's own overflow is
 *  visible by default regardless of its parent's. `break-words` (so it
 *  wraps mid-word once nothing else will fit) plus `line-clamp-3` (so a
 *  genuinely long label clips with an ellipsis rather than pushing the
 *  row's height around on its own) keep it fully contained either way.
 *  `items-stretch` on the row then stretches the color label to match, so
 *  it stays full-height regardless of how many lines a rung's covers wrap
 *  onto.
 *
 *  This chrome is shared by the mural block's read-only row and the
 *  editor's own row, extracted because they had drifted into two
 *  independent copies of the same markup. Only the chrome is shared, not
 *  the row itself: the two need different *contents* (static tiles vs
 *  draggable ones, and an extra colour control in the chip), and bending
 *  one component to cover both would mean a pile of optional render props.
 *  `children` is the tile area; `colorControl` is an optional node the
 *  editor drops into the chip.
 *
 *  Lives here rather than in BookBlocks.tsx to keep the dependency graph
 *  one-directional: BookBlocks.tsx owns MiniBookTile, so a shared file
 *  that imported from it while it imported the row back would be a
 *  cycle. This file depends on nothing but the tier type. */
export function TierRowShell({
  tier,
  colorControl,
  children
}: {
  tier: TierDefinition;
  colorControl?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-2 overflow-hidden rounded-lg border border-(--color-border)">
      <div
        className="flex w-[3em] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden p-1 text-center text-[0.9em] leading-tight font-bold break-words text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]"
        style={{ backgroundColor: tier.color }}
      >
        <span className="line-clamp-3">{tier.label || "—"}</span>
        {colorControl}
      </div>
      {children}
    </div>
  );
}

/** The tile area's own two states, shared for the same reason as the
 *  shell above — an empty tier reads identically in the block and in the
 *  editor, only the wording differs. */
export function TierRowEmpty({ message }: { message: string }) {
  return <div className="flex min-h-[4em] flex-1 items-center px-2 text-[0.75em] text-(--color-text-dim)">{message}</div>;
}

export function TierRowTiles({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-wrap content-start gap-1.5 p-1.5">{children}</div>;
}
