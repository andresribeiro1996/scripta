import { STATUS_FILTER_OPTIONS, SORT_OPTIONS, type SortKey, type StatusFilter } from "../lib/libraryView";

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
  const selectClass = "rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 py-2.5 text-sm";
  return (
    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search title or author…"
        aria-label="Search your library"
        className={`${selectClass} w-full sm:max-w-xs`}
      />
      <div className="flex gap-2 sm:ml-auto">
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className={selectClass}
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
          className={selectClass}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
