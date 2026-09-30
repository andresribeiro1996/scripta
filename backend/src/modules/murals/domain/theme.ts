import { THEME_IDS, type ThemeId } from "@scripta/shared/themes";
import type { MuralRow } from "./types.js";

export function muralRowTheme(row: MuralRow): ThemeId {
  return THEME_IDS.find((id) => id === row.theme) ?? "light";
}
