import { chipClass, FIELD_CLASS } from "./page/buttonClasses";
import { SearchIcon, ToolbarRow } from "./Toolbar";
import { STATUS_FILTER_OPTIONS, SORT_OPTIONS, type SortKey, type StatusFilter } from "../lib/libraryView";

export function LibraryToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  counts,
  sort,
  onSortChange
}: {
  query: string;
  onQueryChange: (q: string) => void;
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  counts: Record<StatusFilter, number>;
  sort: SortKey;
  onSortChange: (k: SortKey) => void;
}) {
  return (
    <ToolbarRow>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative min-w-0 flex-1 sm:w-85 sm:flex-none">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--color-text-dim)">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            aria-label="Search your library"
            className={`${FIELD_CLASS} w-full pl-10`}
          />
        </div>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="Sort books"
          className={`${FIELD_CLASS} sm:order-last sm:ml-auto`}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Status" className="-mx-4 -my-1 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:my-0 sm:w-auto sm:overflow-visible sm:p-0">
          {STATUS_FILTER_OPTIONS.map((o) => (
            <button key={o.value} type="button" aria-pressed={status === o.value} onClick={() => onStatusChange(o.value)} className={chipClass(status === o.value)}>
              {o.value === "all" ? "All" : o.label}
              <span className="font-normal opacity-70">{counts[o.value]}</span>
            </button>
          ))}
        </div>
      </div>
    </ToolbarRow>
  );
}
