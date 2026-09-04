// "Configure this block" modal, opened from a block's gear icon
// (MuralCanvas.tsx) in edit mode. One modal handles every block type —
// its body switches on `draft.type` — rather than eight separate modals,
// since they all share the same "edit a local draft, Save commits it"
// shape (same reasoning PerCardStylePanel.tsx gives for series vs. book
// style: same UI shape, different scope).
//
// Draft-then-Save, not live-autosave: unlike PerCardStylePanel's
// continuous style tweaking, assembling a shelf or a quote collection is
// a multi-step process (search, pick, maybe pick again) that doesn't make
// sense to persist after every click — Cancel/Close should genuinely
// discard, not leave a half-built block saved.

import { useState } from "react";
import { Link } from "react-router-dom";
import type { GalleryImage } from "../../api/gallery";
import { ALL_STAT_METRICS, BLOCK_TYPE_LABELS, STAT_METRIC_LABELS, type MuralBlock } from "../../lib/murals";
import { bookKey } from "../../lib/merge";
import { BookSearchList, GalleryImageGrid } from "./pickers";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useTierlists } from "../../hooks/useTierlists";
import { ChevronLeftIcon, ChevronRightIcon } from "../Toolbar";

function bookHighlights(book: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!book || !Array.isArray(book.highlights)) return [];
  return book.highlights as Array<Record<string, unknown>>;
}

export function BlockConfigPanel({
  block,
  books,
  images,
  onSave,
  onClose
}: {
  block: MuralBlock;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  onSave: (block: MuralBlock) => void;
  onClose: () => void;
}) {
  useScrollLock();
  const [draft, setDraft] = useState<MuralBlock>(block);
  // tierlist only: the saved tier lists to pick from. Everything else
  // about a tier list — structure, pool, ranking — is edited over in
  // Arena (TierListEditorPage); this modal's whole tierlist job is
  // choosing WHICH one the block displays.
  const { data: tierlists } = useTierlists();
  // Only meaningful for quote/quoteCollection's two-step "pick a book,
  // then pick one of its highlights" flow — null means "show the book
  // search," set means "show that highlights."
  const [browsingBookKey, setBrowsingBookKey] = useState<string | null>(null);

  function handleSave() {
    onSave(draft);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) p-4">
          <h3 className="text-sm font-semibold">{BLOCK_TYPE_LABELS[draft.type]}</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          {draft.type === "text" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-dim)">Heading</label>
                <input
                  value={draft.heading ?? ""}
                  onChange={(e) => setDraft({ ...draft, heading: e.target.value })}
                  placeholder="e.g. My 2026 in books"
                  className="w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-dim)">Text</label>
                <textarea
                  value={draft.body ?? ""}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={4}
                  placeholder="A note, a reflection, whatever you want to say here…"
                  className="w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {draft.type === "stats" && (
            <div className="flex flex-col gap-1">
              <p className="mb-1 text-xs text-(--color-text-dim)">Pick which numbers to show — always computed live from your current library.</p>
              {ALL_STAT_METRICS.map((metric) => (
                <label key={metric} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-(--color-surface-hover)">
                  <input
                    type="checkbox"
                    checked={draft.metrics.includes(metric)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        metrics: e.target.checked ? [...draft.metrics, metric] : draft.metrics.filter((m) => m !== metric)
                      })
                    }
                  />
                  {STAT_METRIC_LABELS[metric]}
                </label>
              ))}
            </div>
          )}

          {draft.type === "currentlyReading" && (
            <p className="text-sm text-(--color-text-dim)">
              Nothing to configure — this always shows whatever's currently marked "Reading" in your library.
            </p>
          )}

          {draft.type === "empty" && (
            <p className="text-sm text-(--color-text-dim)">
              Nothing to configure — this is just a styled block, no content of its own. Use its own 🎨 Style option to set a
              background color, border, corner radius, and so on.
            </p>
          )}

          {draft.type === "image" && (
            <div className="flex flex-col gap-3">
              <GalleryImageGrid
                images={images}
                selectedId={draft.imageId || null}
                onSelect={(image) => setDraft({ ...draft, imageId: image.id })}
                onImageDeleted={(id) => {
                  // Only meaningful if the image just deleted was the one
                  // THIS block currently has selected — otherwise Save
                  // would re-persist a now-dangling imageId, undoing the
                  // scrub useDeleteGalleryImage() (inside GalleryImageGrid)
                  // just ran server-side.
                  if (draft.type === "image" && draft.imageId === id) setDraft({ ...draft, imageId: "" });
                }}
              />
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-dim)">Caption (optional)</label>
                <input
                  value={draft.caption ?? ""}
                  onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                  className="w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {draft.type === "spotlight" && (
            <div className="flex flex-col gap-3">
              {draft.bookKey && (
                <p className="rounded-lg bg-(--color-accent-soft) px-3 py-2 text-sm text-(--color-accent)">
                  Currently: {books.find((b) => bookKey(b) === draft.bookKey)?.Title as string | undefined}
                </p>
              )}
              <BookSearchList books={books} isSelected={(b) => bookKey(b) === draft.bookKey} onSelect={(b) => setDraft({ ...draft, bookKey: bookKey(b) })} />
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-dim)">Caption (optional)</label>
                <input
                  value={draft.caption ?? ""}
                  onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                  className="w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {draft.type === "shelf" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-dim)">Title</label>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Top 5 Books This Year"
                  className="w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
                />
              </div>

              {draft.bookKeys.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-(--color-text-dim)">On this shelf, in order:</p>
                  {draft.bookKeys.map((key, i) => {
                    const book = books.find((b) => bookKey(b) === key);
                    return (
                      <div key={key} className="flex items-center gap-2 rounded-lg border border-(--color-border) px-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{String(book?.Title ?? key)}</span>
                        <button
                          disabled={i === 0}
                          onClick={() => {
                            const keys = [...draft.bookKeys];
                            [keys[i - 1], keys[i]] = [keys[i], keys[i - 1]];
                            setDraft({ ...draft, bookKeys: keys });
                          }}
                          className="text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-30"
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          disabled={i === draft.bookKeys.length - 1}
                          onClick={() => {
                            const keys = [...draft.bookKeys];
                            [keys[i], keys[i + 1]] = [keys[i + 1], keys[i]];
                            setDraft({ ...draft, bookKeys: keys });
                          }}
                          className="text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-30"
                          title="Move down"
                        >
                          ▼
                        </button>
                        <button
                          onClick={() => setDraft({ ...draft, bookKeys: draft.bookKeys.filter((k) => k !== key) })}
                          className="text-(--color-danger) transition-opacity hover:opacity-80"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-medium text-(--color-text-dim)">Add a book:</p>
                <BookSearchList books={books.filter((b) => !draft.bookKeys.includes(bookKey(b)))} onSelect={(b) => setDraft({ ...draft, bookKeys: [...draft.bookKeys, bookKey(b)] })} />
              </div>
            </div>
          )}

          {draft.type === "quote" &&
            (browsingBookKey ? (
              <div className="flex flex-col gap-2">
                <button onClick={() => setBrowsingBookKey(null)} className="inline-flex items-center gap-1 self-start text-xs text-(--color-text-dim) hover:text-(--color-text)">
                  <ChevronLeftIcon size={13} />
                  Back to books
                </button>
                {bookHighlights(books.find((b) => bookKey(b) === browsingBookKey)).length === 0 ? (
                  <p className="text-sm text-(--color-text-dim)">This book has no saved highlights.</p>
                ) : (
                  bookHighlights(books.find((b) => bookKey(b) === browsingBookKey)).map((h, i) => (
                    <button
                      key={String(h.BookmarkID ?? i)}
                      onClick={() => {
                        setDraft({ ...draft, bookKey: browsingBookKey, highlightId: String(h.BookmarkID) });
                        setBrowsingBookKey(null);
                      }}
                      className="rounded-lg border border-(--color-border) px-3 py-2 text-left text-sm italic hover:bg-(--color-surface-hover)"
                    >
                      "{String(h.Text ?? "")}"
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {draft.bookKey && draft.highlightId && (
                  <p className="rounded-lg bg-(--color-accent-soft) px-3 py-2 text-sm text-(--color-accent)">
                    Currently: "{String(bookHighlights(books.find((b) => bookKey(b) === draft.bookKey)).find((h) => String(h.BookmarkID) === draft.highlightId)?.Text ?? "")}"
                  </p>
                )}
                <p className="text-xs text-(--color-text-dim)">Pick a book to browse its highlights:</p>
                <BookSearchList books={books.filter((b) => bookHighlights(b).length > 0)} onSelect={(b) => setBrowsingBookKey(bookKey(b))} />
              </div>
            ))}

          {draft.type === "quoteCollection" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-(--color-text-dim)">Title</label>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. My favorite lines"
                  className="w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
                />
              </div>

              {draft.quotes.length > 0 && (
                <div className="flex flex-col gap-1">
                  {draft.quotes.map((q, i) => {
                    const book = books.find((b) => bookKey(b) === q.bookKey);
                    const highlight = bookHighlights(book).find((h) => String(h.BookmarkID) === q.highlightId);
                    return (
                      <div key={`${q.bookKey}:${q.highlightId}`} className="flex items-start gap-2 rounded-lg border border-(--color-border) px-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate italic">"{String(highlight?.Text ?? "")}"</span>
                        <button
                          onClick={() => setDraft({ ...draft, quotes: draft.quotes.filter((_, j) => j !== i) })}
                          className="shrink-0 text-(--color-danger) transition-opacity hover:opacity-80"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {browsingBookKey ? (
                <div className="flex flex-col gap-2">
                  <button onClick={() => setBrowsingBookKey(null)} className="inline-flex items-center gap-1 self-start text-xs text-(--color-text-dim) hover:text-(--color-text)">
                    <ChevronLeftIcon size={13} />
                    Back to books
                  </button>
                  {bookHighlights(books.find((b) => bookKey(b) === browsingBookKey)).map((h, i) => (
                    <button
                      key={String(h.BookmarkID ?? i)}
                      onClick={() => {
                        const ref = { bookKey: browsingBookKey, highlightId: String(h.BookmarkID) };
                        const already = draft.quotes.some((q) => q.bookKey === ref.bookKey && q.highlightId === ref.highlightId);
                        if (!already) setDraft({ ...draft, quotes: [...draft.quotes, ref] });
                        setBrowsingBookKey(null);
                      }}
                      className="rounded-lg border border-(--color-border) px-3 py-2 text-left text-sm italic hover:bg-(--color-surface-hover)"
                    >
                      "{String(h.Text ?? "")}"
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <p className="mb-1 text-xs font-medium text-(--color-text-dim)">Add a quote:</p>
                  <BookSearchList books={books.filter((b) => bookHighlights(b).length > 0)} onSelect={(b) => setBrowsingBookKey(bookKey(b))} />
                </div>
              )}
            </div>
          )}

          {draft.type === "tierlist" &&
            (() => {
              // Re-narrows `draft` inside this closure — the outer
              // `draft.type === "tierlist"` check above narrows the JSX
              // condition itself, not `draft` as captured by this nested
              // arrow function, so this second check is what actually
              // gives TypeScript (and every reference below) the real
              // tierlist shape.
              const block = draft;
              if (block.type !== "tierlist") return null;

              return (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-(--color-text-dim)">Which tier list</label>
                  {tierlists === undefined ? (
                    <p className="text-xs text-(--color-text-dim)">Loading tier lists…</p>
                  ) : tierlists.length === 0 ? (
                    <p className="text-xs text-(--color-text-dim)">No tier lists yet — create one in Arena and it will show up here.</p>
                  ) : (
                    tierlists.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setDraft({ ...block, tierlistId: t.id })}
                        aria-pressed={block.tierlistId === t.id}
                        className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm ${
                          block.tierlistId === t.id
                            ? "bg-(--color-accent-soft) font-semibold text-(--color-accent)"
                            : "hover:bg-(--color-surface-hover)"
                        }`}
                      >
                        {t.name}
                        {block.tierlistId === t.id && (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                    ))
                  )}
                  <p className="mt-1 text-xs text-(--color-text-dim)">Ranking and tiers are edited over in Arena.</p>
                  <Link
                    to="/dashboard/arena?tab=tierlists"
                    onClick={onClose}
                    className="inline-flex items-center gap-1 self-start text-xs font-medium text-(--color-accent) transition-opacity hover:opacity-80"
                  >
                    Create in Arena
                    <ChevronRightIcon size={13} />
                  </Link>
                </div>
              );
            })()}
        </div>

        <div className="flex justify-end gap-2 border-t border-(--color-border) p-4">
          <button onClick={onClose} className="rounded-lg border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-hover)">
            Cancel
          </button>
          <button onClick={handleSave} className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
