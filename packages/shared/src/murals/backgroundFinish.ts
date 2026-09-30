import type { BlockStyle } from "../library/libraryStyle.js";
import type { ThemeColors } from "../themes/palettes.js";
import { effectiveBlockColors, normalizeHexColor, type BlockThemeColorKey } from "./blockTextColors.js";

export const FINISH_TILE_SIZE = 32;

const SPECKS: Array<[number, number, number]> = [
  [3, 5, 0.5], [9, 2, 0.4], [14, 8, 0.6], [22, 4, 0.4], [28, 10, 0.5], [6, 13, 0.4], [18, 15, 0.5],
  [26, 19, 0.6], [2, 22, 0.5], [11, 20, 0.4], [16, 27, 0.6], [24, 28, 0.4], [30, 25, 0.5], [7, 30, 0.4]
];
const FIBRES = ["M4 11 l3 1", "M20 10 l-3 2", "M12 24 l3 -1", "M27 15 l2 3"];

function threads(step: number, vertical: boolean): string {
  const lines: string[] = [];
  for (let at = step / 2; at < FINISH_TILE_SIZE; at += step) lines.push(vertical ? `M${at} 0V${FINISH_TILE_SIZE}` : `M0 ${at}H${FINISH_TILE_SIZE}`);
  return lines.join("");
}

export function finishTileMarkup(finish: "paper" | "linen", ink: string): string {
  if (finish === "paper") {
    const specks = SPECKS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");
    return `<g fill="${ink}" fill-opacity="0.1">${specks}</g><path d="${FIBRES.join("")}" fill="none" stroke="${ink}" stroke-opacity="0.08" stroke-width="0.4"/>`;
  }
  return `<path d="${threads(4, false)}" fill="none" stroke="${ink}" stroke-opacity="0.07" stroke-width="0.7"/><path d="${threads(4, true)}" fill="none" stroke="${ink}" stroke-opacity="0.06" stroke-width="0.7"/>`;
}

export function finishPatternSvg(finish: "paper" | "linen", ink: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FINISH_TILE_SIZE}" height="${FINISH_TILE_SIZE}" viewBox="0 0 ${FINISH_TILE_SIZE} ${FINISH_TILE_SIZE}">${finishTileMarkup(finish, ink)}</svg>`;
}

export function blockFinish(
  style: Pick<BlockStyle, "backgroundColor" | "textColor" | "backgroundFinish">,
  palette: Pick<ThemeColors, BlockThemeColorKey>
): { finish: "paper" | "linen"; ink: string } | null {
  if (style.backgroundFinish === "none" || style.backgroundColor === "transparent") return null;
  const ink = normalizeHexColor(effectiveBlockColors(style, palette).text);
  return ink ? { finish: style.backgroundFinish, ink } : null;
}
