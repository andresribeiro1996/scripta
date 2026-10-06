import { GRID_COLUMNS, isValidBlockLayout, moveMuralBlock, withMuralBlockLayout, type BlockLayout, type MuralBlock } from "@scripta/shared";

export const MURAL_ROW_HEIGHT = 36;

export function muralDragPosition(layout: BlockLayout, dx: number, dy: number, columnWidth: number): { x: number; y: number } {
  "worklet";
  return {
    x: Math.max(0, Math.min((GRID_COLUMNS - layout.w) * columnWidth, layout.x * columnWidth + dx)),
    y: Math.max(0, layout.y * MURAL_ROW_HEIGHT + dy),
  };
}

export function muralDragCell(value: number, previous: number): number {
  "worklet";
  return Math.abs(value - previous) <= 0.65 ? previous : Math.round(value);
}

export function muralCanvasHeight(blocks: MuralBlock[], rowHeight: number, minimum = 520): number {
  return Math.max(minimum, ...blocks.map((block) => (block.layout.y + block.layout.h) * rowHeight));
}

export function muralPreviewScale(width: number, canvasWidth: number): number {
  return width > 0 && canvasWidth > 0 ? width / canvasWidth : 0;
}

export function changeBlockLayout(blocks: MuralBlock[], blockId: string, patch: Partial<BlockLayout>): MuralBlock[] {
  const block = blocks.find((item) => item.id === blockId);
  if (!block) return blocks;
  const layout = { ...block.layout, ...patch };
  if (patch.w !== undefined || patch.h !== undefined) return moveMuralBlock(blocks, blockId, layout);
  if (!isValidBlockLayout(layout, blocks, blockId)) return blocks;
  return blocks.map((item) => item.id === blockId ? withMuralBlockLayout(item, layout) : item);
}

export type LayoutStepBlock = "minimum" | "edge" | "overlap";

export function layoutStepBlocked(blocks: MuralBlock[], blockId: string, patch: Partial<BlockLayout>): LayoutStepBlock | null {
  const block = blocks.find((item) => item.id === blockId);
  if (!block) return null;
  const layout = { ...block.layout, ...patch };
  if (layout.w < 1 || layout.h < 1) return "minimum";
  if (layout.x < 0 || layout.y < 0 || layout.x + layout.w > GRID_COLUMNS) return "edge";
  return isValidBlockLayout(layout, patch.w !== undefined || patch.h !== undefined ? [] : blocks, blockId) ? null : "overlap";
}
