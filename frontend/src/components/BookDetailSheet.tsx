import { readingPercent, type FinishRating } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchIsAdmin, rejectSharedCover, uploadSharedCover } from "../api/books";
import { forgetResolvedCover, rememberResolvedCover } from "../api/covers";
import { coverParamsFor, CoverImage } from "./BookCard";
import { BookSummary } from "./BookSummary";
import { useConfirm } from "./ConfirmDialog";
import { FeelingChips } from "./FeelingChips";
import { statusLabel } from "../lib/covers";
import type { ReadStatus } from "../lib/libraryView";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";

export function BookDetailSheet({
  book,
  workId,
  onOpenStyle,
  onOpenCoverPicker,
  onSetStatus,
  onSetRating,
  onDeleteNote,
  onClose
}: {
  book: Record<string, unknown>;
  workId?: string;
  onOpenStyle: (book: Record<string, unknown>) => void;
  onOpenCoverPicker: (book: Record<string, unknown>) => void;
  onSetStatus: (book: Record<string, unknown>, status: ReadStatus) => void;
  onSetRating: (book: Record<string, unknown>, rating: FinishRating) => void;
  onDeleteNote: (book: Record<string, unknown>, bookmarkId: string) => void;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);
  const confirm = useConfirm();
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const [coverVersion, setCoverVersion] = useState(0);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverFile = useRef<HTMLInputElement>(null);

  async function handleDeleteNote(bookmarkId: string) {
    if (await confirm({ title: "Delete this note?", body: "This can't be undone.", confirmLabel: "Delete" })) {
      onDeleteNote(book, bookmarkId);
    }
  }

  async function rejectCover() {
    if (!(await confirm({ title: "Reject this cover?", body: "Every account stops seeing it, and the next best cover is looked up.", confirmLabel: "Reject" }))) return;
    const params = coverParamsFor(book);
    try {
      await rejectSharedCover(params);
      forgetResolvedCover(params);
      setCoverError(null);
      setCoverVersion((v) => v + 1);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Couldn't reject the cover.");
    }
  }

  async function replaceCover(file: File) {
    const params = coverParamsFor(book);
    try {
      rememberResolvedCover(params, await uploadSharedCover(params, file));
      setCoverError(null);
      setCoverVersion((v) => v + 1);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Couldn't upload the cover.");
    }
  }

  const highlights = Array.isArray(book.highlights)
    ? (book.highlights as Array<Record<string, unknown>>).filter((h) => String(h.Text ?? "").trim() !== "")
    : [];
  const percent = readingPercent(book);
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
            <CoverImage key={coverVersion} book={book} size="full" />
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
              {workId && (
                <Link to={`/work/${workId}`} className={actionClass}>
                  About this book
                </Link>
              )}
              {isAdmin && (
                <>
                  <button onClick={() => void rejectCover()} className={actionClass}>
                    Wrong cover
                  </button>
                  <button onClick={() => coverFile.current?.click()} className={actionClass}>
                    Replace cover
                  </button>
                  <input
                    ref={coverFile}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void replaceCover(file);
                    }}
                  />
                </>
              )}
            </div>

            {coverError && (
              <p role="alert" className="mt-2 text-sm text-(--color-danger)">
                {coverError}
              </p>
            )}

            <div
              role="group"
              aria-label="Reading status"
              className="mt-3 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)"
            >
              {([0, 1, 2] as const).map((status, i) => {
                const checked = (book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0) === status;
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => { if (!checked) onSetStatus(book, status); }}
                    className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 text-sm font-semibold ${
                      i > 0 ? "border-l border-(--color-border)" : ""
                    } ${checked ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
                  >
                    {statusLabel(status)}
                  </button>
                );
              })}
            </div>

            {book.ReadStatus === 2 && (
              <div className="mt-4">
                <p className="text-sm font-semibold">How it landed</p>
                <div className="mt-2">
                  <FeelingChips
                    value={typeof book.Rating === "number" ? book.Rating : null}
                    onChange={(rating) => onSetRating(book, rating)}
                    label="How it landed"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 pb-5"><BookSummary book={book} /></div>
        <div className="border-t border-(--color-border) p-5">
          <h3 className="mb-3 text-sm font-semibold">
            Highlights{highlights.length > 0 ? ` (${highlights.length})` : ""}
          </h3>
          {highlights.length === 0 && <p className="text-sm text-(--color-text-dim)">No highlights yet.</p>}
          <div className="flex flex-col gap-3">
            {highlights.map((h, i) => {
              const bookmarkId = String(h.BookmarkID ?? "");
              const isNote = bookmarkId.startsWith("note:");
              return (
                <div key={bookmarkId || i} className="border-l-2 border-(--color-border) pl-3">
                  <p className="text-sm italic">{String(h.Text)}</p>
                  {String(h.Annotation ?? "").trim() !== "" && (
                    <p className="mt-1 text-xs text-(--color-text-dim)">{String(h.Annotation)}</p>
                  )}
                  {isNote && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteNote(bookmarkId)}
                      className="mt-1 text-xs font-semibold text-(--color-danger) hover:opacity-80"
                    >
                      Delete
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
