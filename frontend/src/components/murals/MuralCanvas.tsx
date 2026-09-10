import { MuralBlockDetail } from "./MuralBlockDetail";
import { resolveHomeBlock, type Group } from "@scripta/shared";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useEffect, useState } from "react";
import type { GalleryImage } from "../../api/gallery";
import type { ResolvedTierlist } from "../../api/tierlists";
import { blockFontFamilyCss, resolveBlockStyle, resolveBorderColor } from "../../lib/libraryStyle";
import { GRID_COLUMNS, type BlockLayout, type Mural, type MuralBlock } from "../../lib/murals";
import { useMuralBookMetadata } from "../../hooks/useMuralBookMetadata";
import { OptionsMenu } from "../OptionsMenu";
import { BlockRenderer } from "./BlockRenderer";
import { MobileMuralCanvas, type MobileMuralDraft } from "./MobileMuralCanvas";

const ResponsiveGridLayout = GridLayout.WidthProvider(GridLayout);
const ROW_HEIGHT = 28;

export function MuralCanvas({
  mural: originalMural,
  groups = [],
  onOpenBlock,
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
  revertNonce = 0,
  selectedBlockId,
  mobileDraft,
  busy,
  onSelectBlock,
  onStartResize,
  onMobileDraftChange,
  onApplyMobileDraft,
  onCancelMobileDraft
}: {
  mural: Mural;
  groups?: Group[];
  onOpenBlock?: (block: MuralBlock) => void;
  editMode: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  onLayoutChange?: (blockId: string, layout: BlockLayout) => void;
  onConfigureBlock?: (block: MuralBlock) => void;
  onStyleBlock?: (block: MuralBlock) => void;
  onDuplicateBlock?: (blockId: string) => void;
  onDeleteBlock?: (blockId: string) => void;
  statsOverride?: Record<string, number>;
  tierlistData?: (tierlistId: string) => ResolvedTierlist | undefined;
  revertNonce?: number;
  selectedBlockId?: string | null;
  mobileDraft?: MobileMuralDraft | null;
  busy?: boolean;
  onSelectBlock?: (blockId: string | null) => void;
  onStartResize?: (block: MuralBlock) => void;
  onMobileDraftChange?: (layout: BlockLayout) => void;
  onApplyMobileDraft?: () => void;
  onCancelMobileDraft?: () => void;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const mural = { ...originalMural, blocks: originalMural.blocks.map((block) => resolveHomeBlock(block, books, groups, day)) };
  const originalBlock = (block: MuralBlock) => originalMural.blocks.find((item) => item.id === block.id) ?? block;
  useMuralBookMetadata(mural.blocks, books, tierlistData);
  const [compactMode, setCompactMode] = useState(
    () => typeof window !== "undefined" && (window.innerWidth < 768 || Boolean(window.matchMedia?.("(pointer: coarse)").matches))
  );

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const measure = () => setCompactMode(window.innerWidth < 768 || coarse.matches);
    window.addEventListener("resize", measure);
    coarse.addEventListener("change", measure);
    return () => {
      window.removeEventListener("resize", measure);
      coarse.removeEventListener("change", measure);
    };
  }, []);

  if (compactMode) {
    return (
      <MobileMuralCanvas
        mural={mural}
        editMode={editMode}
        books={books}
        images={images}
        selectedBlockId={selectedBlockId}
        draft={mobileDraft}
        busy={busy}
        onSelectBlock={onSelectBlock}
        onOpenBlock={onOpenBlock}
        onConfigureBlock={(block) => onConfigureBlock?.(originalBlock(block))}
        onStyleBlock={(block) => onStyleBlock?.(originalBlock(block))}
        onDuplicateBlock={onDuplicateBlock}
        onDeleteBlock={onDeleteBlock}
        onStartResize={onStartResize}
        onLayoutChange={onLayoutChange}
        onDraftChange={onMobileDraftChange}
        onApplyDraft={onApplyMobileDraft}
        onCancelDraft={onCancelMobileDraft}
        statsOverride={statsOverride}
        tierlistData={tierlistData}
        revertNonce={revertNonce}
      />
    );
  }

  const layout = mural.blocks.map((block) => ({ i: block.id, ...block.layout }));
  function handleGestureEnd(_layout: unknown, _oldItem: unknown, item: { i: string; x: number; y: number; w: number; h: number }) {
    onLayoutChange?.(item.i, { x: item.x, y: item.y, w: item.w, h: item.h });
  }

  return (
    <>
    <ResponsiveGridLayout
      key={revertNonce}
      layout={layout}
      cols={GRID_COLUMNS}
      rowHeight={ROW_HEIGHT}
      isDraggable={editMode}
      isResizable={editMode}
      compactType={null}
      preventCollision
      draggableCancel=".mural-block-controls"
      onDragStop={handleGestureEnd}
      onResizeStop={handleGestureEnd}
    >
      {mural.blocks.map((block) => {
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
              fontFamily: style.codeStyle ? blockFontFamilyCss("jetbrainsMono") : blockFontFamilyCss(style.fontFamily),
              fontSize: `${style.fontSize}px`,
              fontWeight: style.bold ? 700 : undefined,
              fontStyle: style.italic ? "italic" : undefined,
              color: style.textColor ?? undefined
            }}
          >
            {!editMode ? <button className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-(--color-accent)" aria-label={`Open ${block.type} block`} onClick={() => onOpenBlock ? onOpenBlock(block) : setFocusedId(block.id)} /> : null}
            <BlockRenderer block={block} books={books} images={images} statsOverride={statsOverride} tierlistData={tierlistData} />
            {editMode && (
              <div className="mural-block-controls absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <OptionsMenu
                  title="Block settings"
                  items={[
                    { label: "Style", onClick: () => onStyleBlock?.(originalBlock(block)) },
                    { label: "Configure", onClick: () => onConfigureBlock?.(originalBlock(block)) },
                    { label: "Duplicate", onClick: () => onDuplicateBlock?.(block.id) },
                    { label: "Delete", onClick: () => onDeleteBlock?.(block.id), danger: true }
                  ]}
                />
              </div>
            )}
          </div>
        );
      })}
    </ResponsiveGridLayout>
    {focusedId && mural.blocks.some((block) => block.id === focusedId) ? <MuralBlockDetail block={mural.blocks.find((block) => block.id === focusedId)!} books={books} images={images} statsOverride={statsOverride} tierlistData={tierlistData} onClose={() => setFocusedId(null)} /> : null}
    </>
  );
}
