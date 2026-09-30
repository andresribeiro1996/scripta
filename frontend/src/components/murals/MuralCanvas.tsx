import { MuralBlockDetail } from "./MuralBlockDetail";
import { blockTextColors, resolveBlockColor, resolveHomeBlock, type Group, type PublicReaderCard } from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useEffect, useState, type CSSProperties } from "react";
import type { GalleryImage } from "../../api/gallery";
import type { ResolvedTierlist } from "../../api/tierlists";
import { BLOCK_PAD_SCALE, blockFontFamilyCss, resolveBlockStyle, resolveBorderColor } from "../../lib/libraryStyle";
import { GRID_COLUMNS, muralThemeId, type BlockLayout, type Mural, type MuralBlock, type ReaderProfile, type ShelfTheme } from "../../lib/murals";
import { useMuralBookMetadata } from "../../hooks/useMuralBookMetadata";
import { muralThemeStyle } from "../../lib/theme";
import { OptionsMenu } from "../OptionsMenu";
import { BlockRenderer } from "./BlockRenderer";
import { MobileMuralCanvas, type MobileMuralDraft } from "./MobileMuralCanvas";

const ResponsiveGridLayout = GridLayout.WidthProvider(GridLayout);
const ROW_HEIGHT = 28;
const NO_GROUPS: Group[] = [];

export function MuralCanvas({
  mural: originalMural,
  groups = NO_GROUPS,
  onOpenBlock,
  editMode,
  books,
  images,
  profile,
  shelfThemeOverride,
  readerCardOverride,
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
  profile?: ReaderProfile;
  shelfThemeOverride?: ShelfTheme;
  readerCardOverride?: PublicReaderCard;
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
  const mural = { ...originalMural, theme: muralThemeId(originalMural.theme), blocks: originalMural.blocks.map((block) => resolveHomeBlock(block, books, groups, day)) };
  const originalBlock = (block: MuralBlock) => originalMural.blocks.find((item) => item.id === block.id) ?? block;
  const themeColors = themes[mural.theme].colors;
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
        profile={profile}
        groups={groups}
        shelfThemeOverride={shelfThemeOverride}
        readerCardOverride={readerCardOverride}
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
    <div style={muralThemeStyle(mural.theme)}>
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
        const overridden = style.backgroundColor || style.textColor ? blockTextColors(style, themeColors) : null;
        return (
          <div
            key={block.id}
            data-own-font=""
            className={`group relative overflow-hidden ${style.cardShadow ? "shadow-sm" : ""} ${style.cardHoverEffect ? "transition-transform hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg" : ""}`}
            style={{
              borderRadius: `${style.cardRadius}px`,
              opacity: style.cardOpacity / 100,
              backgroundColor: resolveBlockColor(style.backgroundColor, themeColors) ?? "var(--color-surface)",
              borderTopWidth: `${style.cardBorderSides.top ? style.cardBorderWidth : 0}px`,
              borderRightWidth: `${style.cardBorderSides.right ? style.cardBorderWidth : 0}px`,
              borderBottomWidth: `${style.cardBorderSides.bottom ? style.cardBorderWidth : 0}px`,
              borderLeftWidth: `${style.cardBorderSides.left ? style.cardBorderWidth : 0}px`,
              borderStyle: style.cardBorderWidth > 0 ? style.cardBorderStyle : "none",
              borderColor: resolveBorderColor(resolveBlockColor(style.cardBorderColor, themeColors), style.cardBorderOpacity),
              fontFamily: style.codeStyle ? blockFontFamilyCss("jetbrainsMono") : blockFontFamilyCss(style.fontFamily),
              fontSize: `${style.fontSize}px`,
              fontWeight: style.bold ? 700 : undefined,
              fontStyle: style.italic ? "italic" : undefined,
              color: resolveBlockColor(style.textColor, themeColors) ?? undefined,
              textAlign: style.textAlign,
              "--block-pad": BLOCK_PAD_SCALE[style.innerSpacing],
              ...(overridden ? { "--color-text-dim": overridden.dim, "--block-accent": overridden.accent } : {})
            } as CSSProperties}
          >
            {!editMode ? <button className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-[var(--block-accent,var(--color-accent))]" aria-label={`Open ${block.type} block`} onClick={() => onOpenBlock ? onOpenBlock(block) : setFocusedId(block.id)} /> : null}
            <BlockRenderer block={block} books={books} images={images} profile={profile} groups={groups} shelfThemeOverride={shelfThemeOverride} readerCardOverride={readerCardOverride} statsOverride={statsOverride} tierlistData={tierlistData} />
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
    </div>
    {focusedId && mural.blocks.some((block) => block.id === focusedId) ? <MuralBlockDetail theme={mural.theme} block={mural.blocks.find((block) => block.id === focusedId)!} books={books} images={images} profile={profile} groups={groups} shelfThemeOverride={shelfThemeOverride} readerCardOverride={readerCardOverride} statsOverride={statsOverride} tierlistData={tierlistData} onClose={() => setFocusedId(null)} /> : null}
    </>
  );
}
