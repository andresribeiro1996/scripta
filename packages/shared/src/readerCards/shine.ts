import { withOpacity } from "../themes/decor.js";
import type { Finish } from "./style.js";

export type ShineKind = "foil" | "holo" | "gilt";

export const SHINE_STOPS: Record<ShineKind, ReadonlyArray<readonly [offset: number, colour: string, opacity: number]>> = {
  foil: [[0.4, "#ffffff", 0], [0.5, "#ffffff", 0.5], [0.6, "#ffffff", 0]],
  holo: [[0.3, "#7f6bd6", 0], [0.4, "#4fb3c9", 0.22], [0.5, "#83d18a", 0.28], [0.6, "#e7c766", 0.22], [0.7, "#e07fb0", 0]],
  gilt: [[0.42, "#fff3c4", 0], [0.5, "#fff3c4", 0.4], [0.58, "#fff3c4", 0]],
};

export function readerCardShine(finish: Finish | undefined): ShineKind | null {
  return finish === "foil" || finish === "holo" || finish === "gilt" ? finish : null;
}

export function shineGradientCss(kind: ShineKind): string {
  return `linear-gradient(110deg, ${SHINE_STOPS[kind].map(([offset, colour, opacity]) => `${withOpacity(colour, opacity)} ${Math.round(offset * 100)}%`).join(", ")})`;
}
