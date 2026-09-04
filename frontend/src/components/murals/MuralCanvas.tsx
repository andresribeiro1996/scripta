// The actual wall — wraps react-grid-layout, which does the real work
// (drag, resize, keeping blocks from overlapping) so this doesn't have to
// hand-roll pointer-event math. Two deliberate config choices away from
// RGL's defaults:
//   - compactType={null}: RGL's default auto-compacts every block upward,
//     closing gaps — the opposite of what a freeform "arrange it your own
//     way" mural wants. null means a block stays exactly where it's put.
//   - preventCollision={true}: dragging one block never silently shoves
//     another out of the way; an illegal drop (overlapping something)
//     just doesn't happen, so the layout never changes underneath you.
//
// Import type GridLayout from "react-grid-layout" only (not a named
// `{ WidthProvider }` import) — its .d.ts is `export = ReactGridLayout`
// (a class merged with a namespace), same shape sharp's types take in the
// backend's gallery module; accessing WidthProvider off the default
// import is what actually works here.
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useState } from "react";
import type { GalleryImage } from "../../api/gallery";
import type { ResolvedTierlist } from "../../api/tierlists";
import { OptionsMenu } from "../OptionsMenu";
import { blockFontFamilyCss, resolveBlockStyle, resolveBorderColor } from "../../lib/libraryStyle";
import { GRID_COLUMNS, type BlockLayout, type Mural, type MuralBlock } from "../../lib/murals";
import { BlockRenderer } from "./BlockRenderer";
import { GripIcon } from "../Toolbar";

const ResponsiveGridLayout = GridLayout.WidthProvider(GridLayout);
const ROW_HEIGHT = 28;


export function MuralCanvas({
  mural,
  editMode,
  books,
  images,
  onLayoutChange,
  onConfigureBlock,
  onStyleBlock,
  onDuplicateBlock,
  onDeleteBlock,
  statsOverride,
  tierlistData,
  revertNonce = 0
}: {
  mural: Mural;
  editMode: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  // All five of these are only ever invoked from inside the `editMode &&`
  // controls block below, or (onLayoutChange) from a drag/resize gesture
  // that `isDraggable`/`isResizable` (both gated on `editMode`) make
  // possible in the first place — so they're all optional here purely for
  // the read-only public share pages (pages/SharedMuralPage.tsx), which
  // always render with `editMode={false}` and have nothing to persist to.
  onLayoutChange?: (blockId: string, layout: BlockLayout) => void;
  onConfigureBlock?: (block: MuralBlock) => void;
  onStyleBlock?: (block: MuralBlock) => void;
  onDuplicateBlock?: (blockId: string) => void;
  onDeleteBlock?: (blockId: string) => void;
  // Optional: the public share page (pages/SharedMuralPage.tsx) has no
  // live library to compute stats from — the mural owner's public GET
  // /murals/shared/:token response already carries precomputed numbers
  // (see backend/src/modules/library/publicResolver.ts), threaded straight
  // through to StatsBlockView, which prefers this over its own
  // computeStat(metric, books) when present. `undefined` everywhere else
  // (the authenticated editor never passes this) preserves the existing
  // live-computed behavior exactly.
  statsOverride?: Record<string, number>;
  // Optional: resolves a tierlist block's reference into its document —
  // useTierlists' cache on the authenticated editor, the shared response's
  // server-side map on the public page. Threaded straight through to
  // BlockRenderer → TierListBlockView; see those files' own comments.
  tierlistData?: (tierlistId: string) => ResolvedTierlist | undefined;
  // Incremented by the editor when a save fails, purely to remount the
  // grid. react-grid-layout treats `layout` as controlled but only
  // rebases its internal copy when the prop DIFFERS from the last one it
  // saw (getDerivedStateFromProps) — after a failed save the prop is
  // rebuilt from an unchanged mural, so it's deep-equal and RGL happily
  // keeps showing the position you dropped the block at. A new key is
  // the one thing that makes it read the saved layout again.
  revertNonce?: number;
}) {
  const [touchMode] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches)
  );
  const layout = mural.blocks.map((b) => ({ i: b.id, x: b.layout.x, y: b.layout.y, w: b.layout.w, h: b.layout.h }));

  // Persist on DROP/RESIZE-END only, not onLayoutChange — RGL fires
  // onLayoutChange continuously while a drag is in progress (every
  // intermediate position), and `layout` above is a CONTROLLED prop
  // sourced straight from the saved mural; echoing every intermediate
  // frame back through a save round trip would mean dozens of PUTs per
  // drag and a real risk of two in-flight saves clobbering each other.
  // RGL's own drag/resize placeholder rendering doesn't need the
  // controlled prop to keep up in real time — only the FINAL position,
  // once the gesture ends, needs to make it back to the saved document.
  function handleGestureEnd(_layout: unknown, _oldItem: unknown, newItem: { i: string; x: number; y: number; w: number; h: number }) {
    onLayoutChange?.(newItem.i, { x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h });
  }

  const gridProps = {
    layout,
    cols: GRID_COLUMNS,
    rowHeight: ROW_HEIGHT,
    isDraggable: editMode,
    isResizable: editMode,
    compactType: null,
    preventCollision: true,
    // The settings button rendered inside each block (below) sits above
    // the block's own drag surface — without excluding it, a click
    // meant for it starts a drag instead. RGL matches this against a
    // CSS selector, not a ref. `.mural-block-body` (touch only) makes
    // block CONTENT a pan surface instead of a drag surface, so only
    // the grip bar repositions the block — see the touch branch below.
    draggableCancel: touchMode
      ? ".mural-block-controls, .mural-block-body"
      : ".mural-block-controls",
    onDragStop: handleGestureEnd,
    onResizeStop: handleGestureEnd
  };

  const blockNodes = mural.blocks.map((block) => {
    // Same inline-style shape as BookCard.tsx's own border/opacity/
    // radius handling (down to reusing resolveBorderColor) — a mural
    // block's style has no priority chain, so this is just "resolve
    // the block's own override over the defaults," one level, not
    // three.
    const style = resolveBlockStyle(block.style);
    return (
      <div
        key={block.id}
        className={`group relative overflow-hidden ${style.cardShadow ? "shadow-sm" : ""} ${style.cardHoverEffect ? "transition-transform hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg" : ""}`}
        style={{
          borderRadius: `${style.cardRadius}px`,
          opacity: style.cardOpacity / 100,
          backgroundColor: style.backgroundColor ?? "var(--color-surface)",
          borderTopWidth: `${style.cardBorderSides.top ? style.cardBorderWidth : 0}px`,
          borderRightWidth: `${style.cardBorderSides.right ? style.cardBorderWidth : 0}px`,
          borderBottomWidth: `${style.cardBorderSides.bottom ? style.cardBorderWidth : 0}px`,
          borderLeftWidth: `${style.cardBorderSides.left ? style.cardBorderWidth : 0}px`,
          borderStyle: style.cardBorderWidth > 0 ? style.cardBorderStyle : "none",
          borderColor: resolveBorderColor(style.cardBorderColor, style.cardBorderOpacity),
          // Sets the base for every text element inside the block —
          // see components/murals/blocks/*.tsx, which size themselves
          // in `em` specifically so they respond to this. font-family,
          // font-weight, font-style, and color all cascade to
          // children on their own via plain CSS inheritance; fontSize
          // needs the em-sizing on the receiving end too, since
          // Tailwind's text-* utilities are rem-based (root-relative,
          // not parent-relative) and wouldn't move at all otherwise.
          // Inheritance means an element with its OWN explicit
          // font-weight class (most block headings use font-semibold/
          // font-bold already, by design, for visual hierarchy) won't
          // additionally react to the `bold` toggle — it's already
          // bold-ish; the toggle's visible effect is mainly on body/
          // caption text that has no weight class of its own.
          // codeStyle FORCES monospace regardless of `fontFamily` —
          // same "always monospace no matter the surrounding font"
          // rule markdown's inline `code` mark follows.
          fontFamily: style.codeStyle ? blockFontFamilyCss("jetbrainsMono") : blockFontFamilyCss(style.fontFamily),
          fontSize: `${style.fontSize}px`,
          fontWeight: style.bold ? 700 : undefined,
          fontStyle: style.italic ? "italic" : undefined,
          color: style.textColor ?? undefined
        }}
      >
        {touchMode && editMode && (
          <div className="mural-grip absolute inset-x-0 top-0 z-10 flex items-center justify-between px-1.5 py-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-white select-none">
              <GripIcon size={14} />
            </span>
            <span className="mural-block-controls">
              <OptionsMenu
                title="Block settings"
                items={[
                  { label: "Style", onClick: () => onStyleBlock?.(block) },
                  { label: "Configure", onClick: () => onConfigureBlock?.(block) },
                  { label: "Duplicate", onClick: () => onDuplicateBlock?.(block.id) },
                  { label: "Delete", onClick: () => onDeleteBlock?.(block.id), danger: true }
                ]}
              />
            </span>
          </div>
        )}
        {touchMode && editMode ? (
          // pt-8 clears the grip bar above. It is absolutely positioned
          // across the top of the block, so without this it sits ON the
          // content — hiding the first line of a text or heading block,
          // which is exactly the part you need to see to know which
          // block you are dragging. Padding shrinks the content box
          // rather than growing the block (border-box), so the layout is
          // unchanged.
          <div className="mural-block-body h-full pt-8">
            <BlockRenderer block={block} books={books} images={images} statsOverride={statsOverride} tierlistData={tierlistData} />
          </div>
        ) : (
          <BlockRenderer block={block} books={books} images={images} statsOverride={statsOverride} tierlistData={tierlistData} />
        )}
        {editMode && !touchMode && (
          <div className="mural-block-controls absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <OptionsMenu
              title="Block settings"
              items={[
                { label: "Style", onClick: () => onStyleBlock?.(block) },
                { label: "Configure", onClick: () => onConfigureBlock?.(block) },
                { label: "Duplicate", onClick: () => onDuplicateBlock?.(block.id) },
                // No confirmation on this one, unlike every other
                // delete in the app — composing a mural means
                // adding/removing blocks constantly, and re-adding
                // one is cheap, unlike deleting a book/image/mural
                // itself.
                { label: "Delete", onClick: () => onDeleteBlock?.(block.id), danger: true }
              ]}
            />
          </div>
        )}
      </div>
    );
  });

  return (
    <ResponsiveGridLayout key={revertNonce} {...gridProps}>
      {blockNodes}
    </ResponsiveGridLayout>
  );
}
