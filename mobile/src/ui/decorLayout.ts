import type { DecorPiece } from "@scripta/shared/themes";

export type PieceStyle = { position: "absolute"; width?: number; height: number; top?: number; right?: number; bottom?: number; left?: number };
export type LayerStyle = { position: "absolute"; left: 0; right: 0; top: number; bottom: number };

export function pieceStyle(piece: DecorPiece): PieceStyle {
  const size = { position: "absolute" as const, width: typeof piece.width === "number" ? piece.width : undefined, height: piece.height };
  switch (piece.anchor) {
    case "top-left":
      return { ...size, top: 0, left: 0 };
    case "top-right":
      return { ...size, top: 0, right: 0 };
    case "bottom-left":
      return { ...size, bottom: 0, left: 0 };
    case "bottom-right":
      return { ...size, bottom: 0, right: 0 };
    case "top":
      return { position: "absolute", height: piece.height, top: 0, left: 0, right: 0 };
    case "bottom":
      return { position: "absolute", height: piece.height, bottom: 0, left: 0, right: 0 };
  }
}

export function decorLayerStyle(top: boolean, bottom: boolean, insets: { top: number; bottom: number }): LayerStyle {
  return { position: "absolute", left: 0, right: 0, top: top ? insets.top : 0, bottom: bottom ? insets.bottom : 0 };
}
