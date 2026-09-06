import GridLayout from "react-grid-layout";
import { useRef, useState } from "react";
import type { GalleryImage } from "../../api/gallery";
import type { ResolvedTierlist } from "../../api/tierlists";
import { blockFontFamilyCss, resolveBlockStyle, resolveBorderColor } from "../../lib/libraryStyle";
import { muralBlockTitle, GRID_COLUMNS, screenPointToGrid, type BlockLayout, type Mural, type MuralBlock } from "../../lib/murals";
import { ActionSheet } from "../Sheet";
import { MobileBlockPreview } from "./MobileBlockPreview";
import { MuralBlockDetail } from "./MuralBlockDetail";

const CANVAS_WIDTH = 1200;
const ROW_HEIGHT = 28;
const MARGIN = 10;
const PADDING = 10;

export interface MobileMuralDraft {
  kind: "move" | "resize" | "add" | "duplicate";
  block: MuralBlock;
  valid: boolean;
}

function SizeStepper({
  label,
  value,
  decreaseDisabled,
  increaseDisabled,
  onDecrease,
  onIncrease
}: {
  label: string;
  value: number;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="rounded-xl bg-(--color-bg) p-2">
      <p className="mb-1.5 text-xs font-medium text-(--color-text-dim)">{label}</p>
      <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center overflow-hidden rounded-lg border border-(--color-border)">
        <button onClick={onDecrease} disabled={decreaseDisabled} aria-label={`Decrease ${label.toLowerCase()}`} className="h-10 text-xl text-(--color-text-dim) hover:bg-(--color-surface-hover) disabled:opacity-30">−</button>
        <span className="flex h-10 items-center justify-center border-x border-(--color-border) text-sm font-semibold tabular-nums">{value}</span>
        <button onClick={onIncrease} disabled={increaseDisabled} aria-label={`Increase ${label.toLowerCase()}`} className="h-10 text-xl text-(--color-text-dim) hover:bg-(--color-surface-hover) disabled:opacity-30">+</button>
      </div>
    </div>
  );
}

function BlockFrame({
  block,
  selected,
  draft,
  invalid,
  draggable,
  books,
  images,
  statsOverride,
  tierlistData,
  onActivate,
  buttonRef,
  scale
}: {
  block: MuralBlock;
  selected: boolean;
  draft: boolean;
  invalid: boolean;
  draggable: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  statsOverride?: Record<string, number>;
  tierlistData?: (tierlistId: string) => ResolvedTierlist | undefined;
  onActivate: () => void;
  buttonRef?: (element: HTMLDivElement | null) => void;
  scale: number;
}) {
  const style = resolveBlockStyle(block.style);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      ref={buttonRef}
      role="button"
      tabIndex={0}
      aria-label={`${selected ? "Selected: " : "Open "}${muralBlockTitle(block, books, block.type === "tierlist" ? tierlistData?.(block.tierlistId)?.name : undefined)}`}
      onPointerDown={(event) => {
        pointerStart.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        const start = pointerStart.current;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) onActivate();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
      className={`relative h-full w-full overflow-hidden ${draggable ? "touch-none cursor-grab active:cursor-grabbing" : ""} ${style.cardShadow ? "shadow-sm" : ""} ${selected ? `ring-[6px] ${invalid ? "ring-(--color-danger)" : "ring-(--color-accent)"}` : ""}`}
      style={{
        borderRadius: `${style.cardRadius}px`,
        opacity: (style.cardOpacity / 100) * (draft ? 0.8 : 1),
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
      <div className="pointer-events-none h-full origin-top-left" style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, transform: `scale(${1 / scale})`, fontSize: 14 }}>
        <MobileBlockPreview block={block} books={books} images={images} statsOverride={statsOverride} tierlistData={tierlistData} width={((CANVAS_WIDTH - PADDING * 2 + MARGIN) / GRID_COLUMNS * block.layout.w - MARGIN) * scale} height={(block.layout.h * (ROW_HEIGHT + MARGIN) - MARGIN) * scale} />
      </div>
    </div>
  );
}

export function MobileMuralCanvas({
  mural,
  editMode,
  books,
  images,
  selectedBlockId,
  draft,
  busy,
  onSelectBlock,
  onConfigureBlock,
  onStyleBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onStartResize,
  onLayoutChange,
  onDraftChange,
  onApplyDraft,
  onCancelDraft,
  statsOverride,
  tierlistData,
  revertNonce = 0
}: {
  mural: Mural;
  editMode: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  selectedBlockId?: string | null;
  draft?: MobileMuralDraft | null;
  busy?: boolean;
  onSelectBlock?: (blockId: string | null) => void;
  onConfigureBlock?: (block: MuralBlock) => void;
  onStyleBlock?: (block: MuralBlock) => void;
  onDuplicateBlock?: (blockId: string) => void;
  onDeleteBlock?: (blockId: string) => void;
  onStartResize?: (block: MuralBlock) => void;
  onLayoutChange?: (blockId: string, layout: BlockLayout) => void;
  onDraftChange?: (layout: BlockLayout) => void;
  onApplyDraft?: () => void;
  onCancelDraft?: () => void;
  statsOverride?: Record<string, number>;
  tierlistData?: (tierlistId: string) => ResolvedTierlist | undefined;
  revertNonce?: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const selected = mural.blocks.find((block) => block.id === selectedBlockId);
  const displayBlocks = draft
    ? draft.kind === "move" || draft.kind === "resize"
      ? mural.blocks.map((block) => (block.id === draft.block.id ? draft.block : block))
      : mural.blocks.some((block) => block.id === draft.block.id) ? mural.blocks : [...mural.blocks, draft.block]
    : mural.blocks;
  const maxBottom = Math.max(0, ...displayBlocks.map((block) => block.layout.y + block.layout.h));
  const logicalHeight = Math.max(20, maxBottom * (ROW_HEIGHT + MARGIN) + PADDING);
  const scale = viewportWidth > 0 ? viewportWidth / CANVAS_WIDTH : 1;
  const focused = displayBlocks.find((block) => block.id === focusedBlockId);

  function setViewport(element: HTMLDivElement | null) {
    viewportRef.current = element;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }

  function changeDraft(patch: Partial<BlockLayout>) {
    if (!draft) return;
    const next = { ...draft.block.layout, ...patch };
    next.x = Math.max(0, Math.min(GRID_COLUMNS - next.w, next.x));
    next.y = Math.max(0, next.y);
    onDraftChange?.(next);
  }

  function activate(block: MuralBlock) {
    if (draft) return;
    if (editMode) onSelectBlock?.(block.id);
    else setFocusedBlockId(block.id);
  }

  const canDrag = editMode && draft?.kind !== "resize";
  const layout = displayBlocks.map((block) => ({
    ...block.layout,
    i: block.id,
    static: !canDrag || Boolean(draft && block.id !== draft.block.id)
  }));
  const originalMoveBlock = draft?.kind === "move" ? mural.blocks.find((block) => block.id === draft.block.id) : undefined;
  if (originalMoveBlock) layout.push({ ...originalMoveBlock.layout, i: "__origin", static: true });

  const controlsPadding = draft?.kind === "resize" ? "pb-60" : draft ? "pb-36" : editMode && selected ? "pb-24" : "";

  return (
    <div className={`relative bg-(--color-bg) ${controlsPadding}`}>
      <div
        ref={setViewport}
        className="mural-overview-stage relative w-full overflow-hidden bg-(--color-bg)"
        style={{ height: logicalHeight * scale, minHeight: editMode ? "52dvh" : undefined }}
      >
        {viewportWidth > 0 && (
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: CANVAS_WIDTH, transform: `scale(${scale})` }}
            onPointerDownCapture={(event) => {
              pointerStart.current = { x: event.clientX, y: event.clientY };
            }}
            onClickCapture={(event) => {
              if (!draft || draft.kind === "resize") return;
              const start = pointerStart.current;
              if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const point = screenPointToGrid((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
              changeDraft({ x: point.x, y: point.y });
            }}
          >
            <GridLayout
              key={revertNonce}
              width={CANVAS_WIDTH}
              cols={GRID_COLUMNS}
              rowHeight={ROW_HEIGHT}
              margin={[MARGIN, MARGIN]}
              containerPadding={[PADDING, PADDING]}
              layout={layout}
              isDraggable={canDrag}
              isResizable={false}
              transformScale={scale}
              compactType={null}
              preventCollision
              onDragStart={(_layout, _oldItem, item) => onSelectBlock?.(item.i)}
              onDragStop={(_layout, _oldItem, item) => {
                const next = { x: item.x, y: item.y, w: item.w, h: item.h };
                if (draft && item.i === draft.block.id) {
                  onDraftChange?.(next);
                  return;
                }
                const current = mural.blocks.find((block) => block.id === item.i);
                if (current && JSON.stringify(current.layout) !== JSON.stringify(next)) onLayoutChange?.(item.i, next);
              }}
            >
              {displayBlocks.map((block) => (
                <div key={block.id} data-grid={block.layout}>
                  <BlockFrame
                    block={block}
                    selected={editMode && block.id === selectedBlockId}
                    draggable={canDrag && (!draft || block.id === draft.block.id)}
                    scale={scale}
                    draft={block.id === draft?.block.id}
                    invalid={block.id === draft?.block.id && !draft.valid}
                    books={books}
                    images={images}
                    statsOverride={statsOverride}
                    tierlistData={tierlistData}
                    onActivate={() => activate(block)}
                    buttonRef={(element) => {
                      if (element) blockRefs.current.set(block.id, element);
                      else blockRefs.current.delete(block.id);
                    }}
                  />
                </div>
              ))}
              {originalMoveBlock && (
                <div
                  key="__origin"
                  data-grid={originalMoveBlock.layout}
                  className="border-4 border-dashed border-(--color-border) bg-transparent"
                />
              )}
            </GridLayout>
          </div>
        )}
      </div>

      {editMode && selected && !draft && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] z-40 mx-auto grid max-w-xl grid-cols-3 gap-1 rounded-2xl border border-(--color-border) bg-(--color-surface)/95 p-1.5 shadow-xl backdrop-blur">
          <button onClick={() => setFocusedBlockId(selected.id)} className="min-h-11 rounded-xl px-3 text-sm font-semibold hover:bg-(--color-surface-hover)">Open</button>
          <button onClick={() => onStartResize?.(selected)} className="min-h-11 rounded-xl px-3 text-sm font-semibold hover:bg-(--color-surface-hover)">Resize</button>
          <button onClick={() => setMoreOpen(true)} className="min-h-11 rounded-xl px-3 text-sm font-semibold hover:bg-(--color-surface-hover)">More</button>
        </div>
      )}

      {draft && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] z-40 mx-auto max-w-xl rounded-2xl border border-(--color-border) bg-(--color-surface)/95 p-3 shadow-xl backdrop-blur">
          {draft.kind === "resize" ? (
            <>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-sm font-semibold">Resize block</p>
                <span className="text-xs text-(--color-text-dim) tabular-nums">{draft.block.layout.w} × {draft.block.layout.h}</span>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <SizeStepper
                  label="Width"
                  value={draft.block.layout.w}
                  decreaseDisabled={draft.block.layout.w <= 1}
                  increaseDisabled={draft.block.layout.x + draft.block.layout.w >= GRID_COLUMNS}
                  onDecrease={() => changeDraft({ w: draft.block.layout.w - 1 })}
                  onIncrease={() => changeDraft({ w: draft.block.layout.w + 1 })}
                />
                <SizeStepper
                  label="Height"
                  value={draft.block.layout.h}
                  decreaseDisabled={draft.block.layout.h <= 1}
                  onDecrease={() => changeDraft({ h: draft.block.layout.h - 1 })}
                  onIncrease={() => changeDraft({ h: draft.block.layout.h + 1 })}
                />
              </div>
            </>
          ) : (
            <div className="mb-3 px-1">
              <p className="text-sm font-semibold">Place block</p>
              <p className="mt-0.5 text-xs text-(--color-text-dim)">Drag it anywhere in the mural.</p>
            </div>
          )}
          {!draft.valid && <p role="alert" className="mb-3 px-1 text-sm text-(--color-danger)">Choose a free position inside the mural.</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onCancelDraft} disabled={busy} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-(--color-text-dim) hover:bg-(--color-surface-hover) disabled:opacity-40">
              {draft.kind === "add" || draft.kind === "duplicate" ? "Discard" : "Cancel"}
            </button>
            <button onClick={onApplyDraft} disabled={busy || !draft.valid} className="min-h-11 rounded-xl bg-(--color-accent) px-3 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? "Saving…" : draft.kind === "add" || draft.kind === "duplicate" ? "Place" : "Save size"}
            </button>
          </div>
        </div>
      )}

      {moreOpen && selected && (
        <ActionSheet
          title="Block actions"
          onClose={() => setMoreOpen(false)}
          items={[
            ...(selected.type === "currentlyReading" || selected.type === "empty" ? [] : [{ label: "Configure", onClick: () => onConfigureBlock?.(selected) }]),
            { label: "Style", onClick: () => onStyleBlock?.(selected) },
            { label: "Duplicate", onClick: () => onDuplicateBlock?.(selected.id) },
            { label: "Delete", onClick: () => onDeleteBlock?.(selected.id), danger: true }
          ]}
        />
      )}

      {focused && (
        <MuralBlockDetail
          block={focused}
          books={books}
          images={images}
          statsOverride={statsOverride}
          tierlistData={tierlistData}
          onClose={() => {
            const id = focused.id;
            setFocusedBlockId(null);
            window.setTimeout(() => blockRefs.current.get(id)?.focus({ preventScroll: true }), 0);
          }}
        />
      )}
    </div>
  );
}
