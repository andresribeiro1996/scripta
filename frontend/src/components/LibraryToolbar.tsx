import { chipClass, FIELD_CLASS } from "./page/buttonClasses";
import { SCROLL_FADE } from "./page/surfaceClasses";
import { SearchField, ToolbarRow } from "./Toolbar";
import { sortOptions, statusFilterOptions, type SortKey, type StatusFilter } from "../lib/libraryView";
import { useLocale } from "../i18n";

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
  const locale = useLocale();
  return (
    <ToolbarRow>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SearchField value={query} onChange={onQueryChange} placeholder="Search" label="Search your library" className="flex-1 sm:flex-none" />
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="Sort books"
          className={`${FIELD_CLASS} sm:order-last sm:ml-auto`}
        >
          {sortOptions(locale).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Status" className={`-mx-4 -my-1 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 py-1 ${SCROLL_FADE} sm:mx-0 sm:my-0 sm:w-auto sm:overflow-visible sm:p-0`}>
          {statusFilterOptions(locale).map((o) => (
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
