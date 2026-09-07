import { isValidBlockLayout, type BlockLayout, type MuralBlock } from "@scripta/shared";

export function muralCanvasHeight(blocks: MuralBlock[], rowHeight: number, minimum = 520): number {
  return Math.max(minimum, ...blocks.map((block) => (block.layout.y + block.layout.h) * rowHeight));
}

export function changeBlockLayout(blocks: MuralBlock[], blockId: string, patch: Partial<BlockLayout>): MuralBlock[] {
  const block = blocks.find((item) => item.id === blockId);
  if (!block) return blocks;
  const layout = { ...block.layout, ...patch };
  if (!isValidBlockLayout(layout, blocks, blockId)) return blocks;
  return blocks.map((item) => item.id === blockId ? { ...item, layout } as MuralBlock : item);
}
