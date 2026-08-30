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
import type { GalleryImage } from "../../api/gallery";
import { OptionsMenu } from "../OptionsMenu";
import { blockFontFamilyCss, resolveBlockStyle, resolveBorderColor } from "../../lib/libraryStyle";
import { GRID_COLUMNS, type BlockLayout, type Mural, type MuralBlock } from "../../lib/murals";
import { BlockRenderer } from "./BlockRenderer";

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
  onUpdateBlock,
  statsOverride
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
  // Optional: only the tier list block type has live, in-place edits (its
  // own drag-and-drop ranking board — see BlockRenderer.tsx/
  // BookBlocks.tsx's TierListBlockView) that need to persist immediately
  // from right here on the canvas, bypassing the Configure modal
  // entirely. Every other block type's content only ever changes through
  // that modal's own Save, so this is threaded straight through to
  // BlockRenderer and ignored by every other case.
  onUpdateBlock?: (block: MuralBlock) => void;
  // Optional: the public share page (pages/SharedMuralPage.tsx) has no
  // live library to compute stats from — the mural owner's public GET
  // /murals/shared/:token response already carries precomputed numbers
  // (see backend/src/modules/library/publicResolver.ts), threaded straight
  // through to StatsBlockView, which prefers this over its own
  // computeStat(metric, books) when present. `undefined` everywhere else
  // (the authenticated editor never passes this) preserves the existing
  // live-computed behavior exactly.
  statsOverride?: Record<string, number>;
}) {
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

  return (
    <ResponsiveGridLayout
      layout={layout}
      cols={GRID_COLUMNS}
      rowHeight={ROW_HEIGHT}
      isDraggable={editMode}
      isResizable={editMode}
      compactType={null}
      preventCollision
      // The settings button rendered inside each block (below) sits above
      // the block's own drag surface — without excluding it, a click
      // meant for it starts a drag instead. RGL matches this against a
      // CSS selector, not a ref. `.mural-tierlist-editor` is the same
      // exclusion for the tier list's own live pool/tier drag-and-drop
      // (BookBlocks.tsx's TierListBlockView) — without it, RGL would
      // claim every mousedown inside that editor as the start of a whole-
      // BLOCK reposition (its default is "the entire grid item is a drag
      // handle"), and native HTML5 drag-and-drop on a book tile would
      // never get a chance to start. Excluding just that inner region —
      // not the block's title bar above it — keeps the block itself
      // repositionable by dragging from anywhere else in it.
      draggableCancel=".mural-block-controls, .mural-tierlist-editor"
      onDragStop={handleGestureEnd}
      onResizeStop={handleGestureEnd}
    >
      {mural.blocks.map((block) => {
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
            <BlockRenderer block={block} books={books} images={images} editMode={editMode} onUpdateBlock={onUpdateBlock} statsOverride={statsOverride} />
            {editMode && (
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
      })}
    </ResponsiveGridLayout>
  );
}
