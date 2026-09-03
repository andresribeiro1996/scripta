import type { ReactNode } from "react";

/** The shared bits of every list page's toolbar (Library, Series,
 *  Collections, Murals, Gallery), so the five don't drift into five
 *  slightly different bars.
 *
 *  Extracted when the Library's one-row phone treatment was applied to
 *  the rest: before that it was one page's private layout and there was
 *  nothing to share it with. Only the genuinely common parts live here —
 *  the sticky row and the two control sizes. What each page puts IN the
 *  row differs enough (a search field, a create field, a plain button)
 *  that a single configurable component would take more props than the
 *  markup it replaced. */

/** Sticky on phones, static from `sm` up.
 *
 *  Scrolling a long list used to put its controls out of reach entirely,
 *  so finding something meant scrolling back to the top to type, then
 *  back down. Pinning costs no extra vertical space — the row is already
 *  there. It needs its own opaque background and a negative inset to
 *  cover PageContainer's padding, or content scrolls visibly through the
 *  gap behind it. Not sticky at `sm`+, where the toolbar is usually on
 *  screen anyway and a pinned bar would just spend space that isn't
 *  scarce. */
export function ToolbarRow({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-30 -mx-4 -mt-5 mb-4 bg-(--color-bg) px-4 pt-5 pb-2 sm:static sm:mx-0 sm:mt-0 sm:mb-5 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0">
      {children}
    </div>
  );
}

/** Text inputs and selects sitting in a ToolbarRow. min-h-11 ≈ 44px, the
 *  smallest comfortably tappable target. */
export const TOOLBAR_CONTROL_CLASS =
  "min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 py-2.5 text-sm";

/** Icon buttons in a ToolbarRow. Unlike a labelled control, an icon
 *  button has no text to widen it, so the 44px target has to be set
 *  explicitly or it collapses to the glyph. */
export const TOOLBAR_ICON_BUTTON_CLASS =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)";

// Icons are drawn SVGs on a 24×24 viewBox centred on (12,12), never
// Unicode glyphs — a character like "⚙" sits off-centre in its own cell
// in most fonts, so even a correctly centred button looks wrong. Same
// reasoning OptionsMenu.tsx's own gear already follows.

/** Hub and spokes — a page's actions. */
export function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
    </svg>
  );
}

/** Funnel — a filter. */
export function FilterIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v5.5l-4 2V13Z" />
    </svg>
  );
}

/** Two opposed arrows — sort order. */
export function SortIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16m0 0-3.5-3.5M7 20l3.5-3.5M17 20V4m0 0-3.5 3.5M17 4l3.5 3.5" />
    </svg>
  );
}

/** Folder — which folder is being shown. */
export function FolderIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5Z" />
    </svg>
  );
}

/** Plus — create. */
export function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
