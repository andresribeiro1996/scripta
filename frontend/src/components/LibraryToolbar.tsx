import { STATUS_FILTER_OPTIONS, SORT_OPTIONS, type SortKey, type StatusFilter } from "../lib/libraryView";

/** Search + status filter + sort, above the book grid.
 *
 *  Sticky below `sm`. On a phone this block, the page header above it and
 *  the browser's own URL bar together pushed the first row of covers most
 *  of the way down the viewport, and scrolling past them put the filters
 *  out of reach — so finding a book meant scrolling back to the top to
 *  change a filter, then back down again. Sticking it costs no additional
 *  vertical space (it's already there) and keeps search reachable from
 *  anywhere in a long library. It needs its OWN opaque background and a
 *  small negative top inset to cover PageContainer's padding, or cards
 *  scroll visibly through the gap behind it.
 *
 *  Not sticky at `sm` and up: on a desktop the whole toolbar is usually
 *  on screen already, and a pinned bar there just spends vertical space
 *  that isn't scarce. */
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
  // min-h-11 ≈ 44px, the smallest comfortably tappable target — the old
  // py-2.5 left these around 38px, which is under every platform's own
  // guidance and noticeably fiddly on the two side-by-side selects.
  const controlClass =
    "min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 py-2.5 text-sm";
  return (
    <div className="sticky top-0 z-30 -mx-4 -mt-5 mb-4 bg-(--color-bg) px-4 pt-5 pb-2 sm:static sm:mx-0 sm:mt-0 sm:mb-5 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search title or author…"
          aria-label="Search your library"
          className={`${controlClass} w-full sm:max-w-xs`}
        />
        {/* Equal-width halves rather than intrinsically-sized selects:
            at 360px the two were visibly lopsided, and a 50/50 split
            reads as one control pair and gives both a full-size tap
            target. They keep their natural widths from `sm` up. */}
        <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className={`${controlClass} w-full sm:w-auto`}
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
            className={`${controlClass} w-full sm:w-auto`}
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
  );
}
