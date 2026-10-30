import { useState } from "react";
import { FIELD_CLASS } from "./page/buttonClasses";
import { OptionSheet } from "./Sheet";
import { FilterIcon, SortIcon, ToolbarRow, toolbarIconClass } from "./Toolbar";
import { STATUS_FILTER_OPTIONS, SORT_OPTIONS, type SortKey, type StatusFilter } from "../lib/libraryView";

/** Search, filter, sort.
 *
 *  ONE row below `sm`. This was three stacked rows (library name, search,
 *  then two full-width selects), which on a 375px phone spent roughly a
 *  sixth of the viewport before a single cover appeared. The selects
 *  become icon buttons in this row, each opening a bottom sheet.
 *
 *  Sheets, not dropdowns, for both. These icons sit at the top of
 *  the screen and get used one-handed; a dropdown hanging off the
 *  top-right corner opens at the furthest point from a thumb. Anchoring
 *  the choices at the bottom puts them in reach, and using one
 *  presentation for all three icons means adjacent controls don't behave
 *  differently from each other. OptionsMenu's dropdown is still right
 *  where it's used on pointer-sized targets (mural blocks, series rows).
 *
 *  At `sm` and up the labelled native selects come back Desktop has the room, and
 *  "All statuses"/"My order" read better as words than as an icon whose
 *  current value you have to open a sheet to discover. The two layouts
 *  are separate markup rather than one adaptive row: they differ in
 *  control type, labelling and which elements exist at all, which is
 *  more than styling can bridge.
 *
 *  Sticky on phones — see ToolbarRow, which every list page shares. */
export function LibraryToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  sort,
  onSortChange
}: {
  query: string;
  onQueryChange: (q: string) => void;
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  sort: SortKey;
  onSortChange: (k: SortKey) => void;
}) {
  const [sheet, setSheet] = useState<"status" | "sort" | null>(null);

  // A filter/sort that is doing something is worth showing without
  // opening the sheet: the icon goes accent-colored when the control is
  // off its default, which is the only cue left once the labels are gone.
  const statusActive = status !== "all";
  const sortActive = sort !== "manual";

  return (
    <>
      <ToolbarRow>
        {/* Phone: one row — search, filter, sort, page actions. */}
        <div className="flex items-center gap-2 sm:hidden">
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            aria-label="Search your library"
            className={`${FIELD_CLASS} min-w-0 flex-1`}
          />
          <button
            onClick={() => setSheet("status")}
            aria-label={`Filter by status (${STATUS_FILTER_OPTIONS.find((o) => o.value === status)?.label})`}
            className={toolbarIconClass(statusActive)}
          >
            <FilterIcon />
          </button>
          <button
            onClick={() => setSheet("sort")}
            aria-label={`Sort books (${SORT_OPTIONS.find((o) => o.value === sort)?.label})`}
            className={toolbarIconClass(sortActive)}
          >
            <SortIcon />
          </button>
        </div>

        {/* Desktop: labelled selects, page keeps its own header. */}
        <div className="hidden gap-2 sm:flex sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            aria-label="Search your library"
            className={`${FIELD_CLASS} w-full sm:max-w-xs`}
          />
          <div className="flex gap-2 sm:ml-auto">
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
              aria-label="Filter by status"
              className={FIELD_CLASS}
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
              className={FIELD_CLASS}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </ToolbarRow>

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
    </>
  );
}
