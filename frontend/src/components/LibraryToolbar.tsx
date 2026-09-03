import { useState } from "react";
import { ActionSheet, OptionSheet } from "./Sheet";
import type { OptionsMenuItem } from "./OptionsMenu";
import { STATUS_FILTER_OPTIONS, SORT_OPTIONS, type SortKey, type StatusFilter } from "../lib/libraryView";

/** Hub and spokes — the page's actions. Same drawn SVG OptionsMenu
 *  uses, and for the same reason: the "⚙" character sits off-centre in
 *  its own cell in most fonts, so a correctly centred button still looks
 *  wrong. A 24×24 viewBox centred on (12,12) is centred by
 *  construction. */
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
    </svg>
  );
}

/** Funnel — status filter. */
function FilterIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v5.5l-4 2V13Z" />
    </svg>
  );
}

/** Two opposed arrows — sort order. */
function SortIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16m0 0-3.5-3.5M7 20l3.5-3.5M17 20V4m0 0-3.5 3.5M17 4l3.5 3.5" />
    </svg>
  );
}

/** Search, filter, sort — and on a phone, the page's actions too.
 *
 *  ONE row below `sm`. This was three stacked rows (library name, search,
 *  then two full-width selects), which on a 375px phone spent roughly a
 *  sixth of the viewport before a single cover appeared. The selects and
 *  the page's actions all become icon buttons in this row, each opening
 *  a bottom sheet — the library name moves into the actions sheet (as
 *  "Rename library…"), since a truncated name plus a search field plus
 *  three icons cannot share 375px without the search field becoming
 *  useless.
 *
 *  Sheets, not dropdowns, for all three. These icons sit at the top of
 *  the screen and get used one-handed; a dropdown hanging off the
 *  top-right corner opens at the furthest point from a thumb. Anchoring
 *  the choices at the bottom puts them in reach, and using one
 *  presentation for all three icons means adjacent controls don't behave
 *  differently from each other. OptionsMenu's dropdown is still right
 *  where it's used on pointer-sized targets (mural blocks, series rows).
 *
 *  At `sm` and up the labelled native selects come back and `actions` is
 *  not rendered here at all — the page shows its own header with the
 *  library name and full-text buttons. Desktop has the room, and
 *  "All statuses"/"My order" read better as words than as an icon whose
 *  current value you have to open a sheet to discover. The two layouts
 *  are separate markup rather than one adaptive row: they differ in
 *  control type, labelling and which elements exist at all, which is
 *  more than styling can bridge.
 *
 *  Sticky below `sm`. Scrolling a long library used to put search out of
 *  reach entirely, so finding a book meant scrolling back to the top to
 *  type, then back down. Pinning costs no extra vertical space — the row
 *  is already there — and it needs its own opaque background plus a
 *  negative inset to cover PageContainer's padding, or cards scroll
 *  visibly through the gap behind it. Not sticky at `sm`+, where the
 *  toolbar is usually on screen anyway and a pinned bar would just spend
 *  space that isn't scarce. */
export function LibraryToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  actions
}: {
  query: string;
  onQueryChange: (q: string) => void;
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  sort: SortKey;
  onSortChange: (k: SortKey) => void;
  /** The page's own actions, shown as a gear in this row on phones only.
   *  Items, not rendered markup: the toolbar opens them in a sheet
   *  matching the filter and sort controls beside them, so it needs the
   *  list rather than someone else's dropdown. */
  actions?: OptionsMenuItem[];
}) {
  const [sheet, setSheet] = useState<"status" | "sort" | "actions" | null>(null);

  const controlClass = "min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 py-2.5 text-sm";
  // h-11/w-11 ≈ 44px, the smallest comfortably tappable target. An icon
  // button has no text to widen it, so unlike the old selects it needs
  // the size set explicitly or it collapses to the glyph.
  const iconButtonClass =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)";
  // A filter/sort that is doing something is worth showing without
  // opening the sheet: the icon goes accent-colored when the control is
  // off its default, which is the only cue left once the labels are gone.
  const statusActive = status !== "all";
  const sortActive = sort !== "manual";

  return (
    <>
      <div className="sticky top-0 z-30 -mx-4 -mt-5 mb-4 bg-(--color-bg) px-4 pt-5 pb-2 sm:static sm:mx-0 sm:mt-0 sm:mb-5 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0">
        {/* Phone: one row — search, filter, sort, page actions. */}
        <div className="flex items-center gap-2 sm:hidden">
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            aria-label="Search your library"
            className={`${controlClass} min-w-0 flex-1`}
          />
          <button
            onClick={() => setSheet("status")}
            aria-label={`Filter by status (${STATUS_FILTER_OPTIONS.find((o) => o.value === status)?.label})`}
            className={`${iconButtonClass} ${statusActive ? "text-(--color-accent)" : "text-(--color-text-dim)"}`}
          >
            <FilterIcon />
          </button>
          <button
            onClick={() => setSheet("sort")}
            aria-label={`Sort books (${SORT_OPTIONS.find((o) => o.value === sort)?.label})`}
            className={`${iconButtonClass} ${sortActive ? "text-(--color-accent)" : "text-(--color-text-dim)"}`}
          >
            <SortIcon />
          </button>
          {actions && actions.length > 0 && (
            <button
              onClick={() => setSheet("actions")}
              aria-label="Library actions"
              className={`${iconButtonClass} text-(--color-text-dim)`}
            >
              <GearIcon />
            </button>
          )}
        </div>

        {/* Desktop: labelled selects, page keeps its own header. */}
        <div className="hidden gap-2 sm:flex sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            aria-label="Search your library"
            className={`${controlClass} w-full sm:max-w-xs`}
          />
          <div className="flex gap-2 sm:ml-auto">
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
              aria-label="Filter by status"
              className={controlClass}
            >
              {STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
              aria-label="Sort books"
              className={controlClass}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {sheet === "status" && (
        <OptionSheet
          title="Filter by status"
          options={STATUS_FILTER_OPTIONS}
          value={status}
          onSelect={onStatusChange}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "sort" && (
        <OptionSheet title="Sort books" options={SORT_OPTIONS} value={sort} onSelect={onSortChange} onClose={() => setSheet(null)} />
      )}
      {sheet === "actions" && actions && <ActionSheet title="Library" items={actions} onClose={() => setSheet(null)} />}
    </>
  );
}
