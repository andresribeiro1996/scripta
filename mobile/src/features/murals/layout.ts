import { GRID_COLUMNS, isValidBlockLayout, type BlockLayout, type MuralBlock } from "@scripta/shared";

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
  if (!isValidBlockLayout(layout, blocks, blockId)) return blocks;
  return blocks.map((item) => item.id === blockId ? { ...item, layout } as MuralBlock : item);
}

export type LayoutStepBlock = "minimum" | "edge" | "overlap";

export function layoutStepBlocked(blocks: MuralBlock[], blockId: string, patch: Partial<BlockLayout>): LayoutStepBlock | null {
  const block = blocks.find((item) => item.id === blockId);
  if (!block) return null;
  const layout = { ...block.layout, ...patch };
  if (layout.w < 1 || layout.h < 1) return "minimum";
  if (layout.x < 0 || layout.y < 0 || layout.x + layout.w > GRID_COLUMNS) return "edge";
  return isValidBlockLayout(layout, blocks, blockId) ? null : "overlap";
}
