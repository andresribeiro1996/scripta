import type { ReactNode } from "react";
import type { TierDefinition } from "../../api/tierlists";

/** The chrome every tier row shares: the outer frame, the coloured label
 *  chip, and the "nothing here yet" state. Extracted because the mural
 *  block's read-only row (BookBlocks.tsx's TierRow) and the editor's own
 *  row (TierListEditorPage.tsx's TierEditorRow) had drifted into two
 *  independent copies of the same markup — same `w-[3em]` chip, same
 *  wrapping tile area, same `min-h-[4em]` empty state — which is why the
 *  editor stopped looking like the block it is supposed to preview.
 *
 *  Only the chrome is shared, not the row itself: the two need different
 *  *contents* (static tiles vs draggable ones, and an extra colour
 *  control in the chip), and bending one component to cover both would
 *  mean a pile of optional render props. `children` is the tile area;
 *  `colorControl` is an optional node the editor drops into the chip.
 *
 *  The label chip itself needs its OWN `overflow-hidden` (not just the row's) —
 *  a label is free-typed text, so a long single "word" with no spaces to
 *  wrap on (no whitespace for the browser's normal line-breaking) would
 *  otherwise render past the edge of its fixed `w-[3em]` box and visibly
 *  bleed into the tiles next to it, since a flex child's own overflow is
 *  visible by default regardless of its parent's. `break-words` (so it
 *  wraps mid-word once nothing else will fit) plus `line-clamp-3` (so a
 *  genuinely long label clips with an ellipsis rather than pushing the
 *  row's height around on its own) keep it fully contained either way.
 *  `items-stretch` on the row then stretches this label to match the tiles'
 *  height, so it stays full-height regardless of how many lines the tiles
 *  wrap onto.
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
