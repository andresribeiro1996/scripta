import { CoverImage } from "./BookCard";
import { BookSummary } from "./BookSummary";
import { statusLabel } from "../lib/covers";
import { nextReadStatus } from "../lib/libraryView";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";

export function BookDetailSheet({
  book,
  onOpenStyle,
  onOpenCoverPicker,
  onSetStatus,
  onClose
}: {
  book: Record<string, unknown>;
  onOpenStyle: (book: Record<string, unknown>) => void;
  onOpenCoverPicker: (book: Record<string, unknown>) => void;
  onSetStatus: (book: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);

  const highlights = Array.isArray(book.highlights)
    ? (book.highlights as Array<Record<string, unknown>>).filter((h) => String(h.Text ?? "").trim() !== "")
    : [];
  const percent = typeof book.___PercentRead === "number" ? Math.round(book.___PercentRead) : null;
  const actionClass =
    "rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-medium hover:bg-(--color-surface-hover)";

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-(--color-border) bg-(--color-surface) shadow-lg sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-detail-title"
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-0">
          <h3 id="book-detail-title" className="text-sm font-semibold text-(--color-text-dim)">
            Book details
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[180px_1fr]">
          <div className="relative mx-auto aspect-[2/3] w-32 overflow-hidden rounded-lg bg-(--color-border) sm:w-full">
            <CoverImage book={book} />
          </div>

          <div className="min-w-0">
            <h2 className="text-xl font-bold">{String(book.Title ?? "Untitled")}</h2>
            <p className="mt-1 text-(--color-text-dim)">{String(book.Attribution ?? "Unknown author")}</p>
            <p className="mt-2 text-sm font-medium text-(--color-accent)">
              {statusLabel(book.ReadStatus)}
              {percent !== null && percent > 0 ? ` · ${percent}% read` : ""}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => onOpenStyle(book)} className={actionClass}>
                Style
              </button>
              <button onClick={() => onOpenCoverPicker(book)} className={actionClass}>
                Cover
              </button>
              <button onClick={() => onSetStatus(book)} className={actionClass}>
                Mark as {statusLabel(nextReadStatus(book.ReadStatus))}
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5"><BookSummary book={book} /></div>
        <div className="border-t border-(--color-border) p-5">
          <h3 className="mb-3 text-sm font-semibold">
            Highlights{highlights.length > 0 ? ` (${highlights.length})` : ""}
          </h3>
          {highlights.length === 0 && <p className="text-sm text-(--color-text-dim)">No highlights yet.</p>}
          <div className="flex flex-col gap-3">
            {highlights.map((h, i) => (
              <div key={String(h.BookmarkID ?? i)} className="border-l-2 border-(--color-border) pl-3">
                <p className="text-sm italic">{String(h.Text)}</p>
                {String(h.Annotation ?? "").trim() !== "" && (
                  <p className="mt-1 text-xs text-(--color-text-dim)">{String(h.Annotation)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
