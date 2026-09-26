import { newId, type MuralBlock } from "./murals.js";

type Shelf = Extract<MuralBlock, { type: "shelf" }>;
type Landing = "finished" | "favourites";

function shelfWithRole(blocks: MuralBlock[], role: Landing) {
  return blocks.find((block): block is Shelf => block.type === "shelf" && block.role === role);
}

function toFront(shelf: Shelf, key: string): Shelf {
  return { ...shelf, bookKeys: [key, ...shelf.bookKeys.filter((item) => item !== key)] };
}

export function shelfAfterFinish(blocks: MuralBlock[], key: string, rating: number | null): { blocks: MuralBlock[]; landed: Landing[] } {
  const finished = shelfWithRole(blocks, "finished");
  if (!finished) return { blocks, landed: [] };
  const next: MuralBlock[] = blocks.map((block) => (block === finished ? toFront(finished, key) : block));
  const landed: Landing[] = ["finished"];
  if (rating !== null && rating >= 4 && !shelfWithRole(blocks, "favourites")) {
    const y = Math.max(...blocks.map((block) => block.layout.y + block.layout.h));
    next.push({ id: newId(), type: "shelf", title: "Favourites", role: "favourites", bookKeys: [key], layout: { x: 0, y, w: 12, h: 5 }, ...(finished.style ? { style: finished.style } : {}) });
    landed.push("favourites");
  }
  return { blocks: next, landed };
}

export function favouriteOpponent(blocks: MuralBlock[], key: string): string | null {
  return shelfWithRole(blocks, "favourites")?.bookKeys.find((item) => item !== key) ?? null;
}

export function promoteFavourite(blocks: MuralBlock[], key: string): MuralBlock[] {
  const favourites = shelfWithRole(blocks, "favourites");
  return favourites ? blocks.map((block) => (block === favourites ? toFront(favourites, key) : block)) : blocks;
}
