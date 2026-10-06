import { DEFAULT_LIBRARY_STYLE, PHONE_GRID_BREAKPOINT, type LibraryStyleSettings } from "@scripta/shared";

export function libraryGridColumns(width: number, contentWidth: number, style: LibraryStyleSettings): number {
  const availableColumns = Math.floor((contentWidth + style.cardGap) / (44 + style.cardGap));
  const columns = width < PHONE_GRID_BREAKPOINT
    ? Math.floor(4 * DEFAULT_LIBRARY_STYLE.cardMinWidth / style.cardMinWidth)
    : Math.floor((contentWidth + style.cardGap) / (style.cardMinWidth + style.cardGap));
  return Math.max(2, Math.min(columns, availableColumns));
}
