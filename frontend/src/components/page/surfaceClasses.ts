export const PANEL = "rounded-xl border border-(--color-border) bg-(--color-surface)";
export const LIST_PANEL = `${PANEL} divide-y divide-(--color-border) overflow-hidden`;
export const LIST_ROW = "flex min-h-11 items-center gap-3 px-4 py-3";
export const LIST_ROW_LINK = `${LIST_ROW} hover:bg-(--color-surface-hover) focus-visible:-outline-offset-2!`;
export const SECTION_HEADING = "font-display text-2xl font-bold";
export const PANEL_HEADING = "font-text text-base font-bold";
export const PANEL_HEADER = "flex items-center justify-between gap-3 px-4.5 pt-3.5 pb-1";
export const CARD = "rounded-2xl border border-(--color-border) bg-(--color-surface)";
export const TAB_NAV = "flex gap-5 sm:gap-7 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]";
export const tabClass = (active: boolean) =>
  `inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap border-b-2 text-sm font-semibold focus-visible:-outline-offset-2! ${active ? "border-(--color-accent) text-(--color-text)" : "border-transparent text-(--color-text-dim) hover:text-(--color-text)"}`;
