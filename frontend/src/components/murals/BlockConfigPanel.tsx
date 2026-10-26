import { resolveHomeBlock, type Group } from "@scripta/shared";
// "Configure this block" modal, opened from a block's options menu
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
import { ALL_STAT_METRICS, BOOK_GENRES, STAT_METRIC_LABELS, blockLabel, type MuralBlock } from "../../lib/murals";
import { bookKey } from "../../lib/merge";
import { BookSearchList, GalleryImageGrid } from "./pickers";
import { Sheet } from "../Sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../page/buttonClasses";
import { useTierlists } from "../../hooks/useTierlists";
import { ChevronLeftIcon, ChevronRightIcon, CHECKBOX_CLASS } from "../Toolbar";

function bookHighlights(book: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!book || !Array.isArray(book.highlights)) return [];
  return book.highlights as Array<Record<string, unknown>>;
}

export function BlockConfigPanel({
  block,
  groups = [],
  books,
  images,
  onSave,
  onClose
}: {
  block: MuralBlock;
  groups?: Group[];
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  onSave: (block: MuralBlock) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MuralBlock>(block);
  // tierlist only: the saved tier lists to pick from. Everything else
  // about a tier list — structure, pool, ranking — is edited over in
  // the Games area (TierListEditorPage); this modal's whole tierlist job is
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
    <Sheet
      title={blockLabel(draft.type)}
      onClose={onClose}
      style={{ maxWidth: "32rem" }}
      footer={
        <>
          <button onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button onClick={handleSave} className={BUTTON_PRIMARY}>
            Save
          </button>
        </>
      }
    >
      <div className="p-2">
        {draft.type === "text" && (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="text-block-heading" className="mb-1 block text-sm font-semibold">Heading</label>
              <input
                id="text-block-heading"
                value={draft.heading ?? ""}
                onChange={(e) => setDraft({ ...draft, heading: e.target.value })}
                placeholder="e.g. My 2026 in books"
                className="min-h-11 w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="text-block-body" className="mb-1 block text-sm font-semibold">Text</label>
              <textarea
                id="text-block-body"
                value={draft.body ?? ""}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={4}
                placeholder="A note, a reflection, whatever you want to say here…"
                className="min-h-11 w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {draft.type === "profile" && (
          <div className="flex flex-col gap-4">
            <label className="text-sm"><span className="font-semibold">Biography</span><textarea value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} rows={4} className="mt-1 w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2" /></label>
            <fieldset><legend className="mb-2 text-sm font-semibold">What I like</legend><div className="flex flex-wrap gap-2">{BOOK_GENRES.map((genre) => { const checked = draft.favoriteGenres.includes(genre); return <label key={genre} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${checked ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border)"}`}><input type="checkbox" className="sr-only" checked={checked} onChange={() => setDraft({ ...draft, favoriteGenres: checked ? draft.favoriteGenres.filter((item) => item !== genre) : [...draft.favoriteGenres, genre] })} />{genre}</label>; })}</div></fieldset>
            <p className="text-xs text-(--color-text-dim)">My shelf theme is calculated automatically from your books.</p>
          </div>
        )}

        {draft.type === "stats" && (
          <div className="flex flex-col gap-1">
            <p className="mb-1 text-xs text-(--color-text-dim)">Pick which numbers to show — always computed live from your current library.</p>
            {ALL_STAT_METRICS.map((metric) => (
              <label key={metric} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-(--color-surface-hover)">
                <input
                  type="checkbox"
                  className={CHECKBOX_CLASS}
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

        {draft.type === "readerCard" && (
          <p className="text-sm text-(--color-text-dim)">
            Nothing to configure — the card is drawn from your finished books.
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
              <label htmlFor="image-block-caption" className="mb-1 block text-sm font-semibold">Caption (optional)</label>
              <input
                id="image-block-caption"
                value={draft.caption ?? ""}
                onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                className="min-h-11 w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
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
              <label htmlFor="spotlight-block-caption" className="mb-1 block text-sm font-semibold">Caption (optional)</label>
              <input
                id="spotlight-block-caption"
                value={draft.caption ?? ""}
                onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                className="min-h-11 w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {draft.type === "shelf" && <div className="space-y-2">
          <label className="block text-sm"><span className="font-semibold">Shelf source</span>
            <select className="ml-2 min-h-11 rounded border p-2" value={draft.collectionId ?? ""} onChange={(event) => {
              const collectionId = event.target.value || undefined;
              const resolved = resolveHomeBlock(draft, books, groups, "");
              setDraft({ ...draft, collectionId, bookKeys: collectionId ? [] : resolved.type === "shelf" ? resolved.bookKeys : [] });
            }}>
              <option value="">Pick books (keep current selection)</option>
              {draft.collectionId && !groups.some((group) => group.id === draft.collectionId) ? <option value={draft.collectionId}>Collection unavailable</option> : null}
              {groups.filter((group) => group.type === "collection").map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          {draft.collectionId ? <label className="block text-sm"><span className="font-semibold">Title (blank follows collection name)</span><input className="mt-1 min-h-11 w-full rounded border p-2" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label> : null}
        </div>}
        {draft.type === "quote" && <label className="block text-sm"><span className="font-semibold">Passage source</span> <select className="min-h-11 rounded border p-2" value={draft.mode ?? "pinned"} onChange={(event) => setDraft({ ...draft, mode: event.target.value === "rediscover" ? "rediscover" : undefined, bookKey: "", highlightId: "" })}><option value="pinned">Choose a passage</option><option value="rediscover">Rediscover a passage</option></select></label>}
        {draft.type === "shelf" && !draft.collectionId && (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="shelf-block-title" className="mb-1 block text-sm font-semibold">Title</label>
              <input
                id="shelf-block-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Top 5 Books This Year"
                className="min-h-11 w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
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
                        className="flex h-11 w-11 shrink-0 items-center justify-center text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-30"
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
                        className="flex h-11 w-11 shrink-0 items-center justify-center text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-30"
                        title="Move down"
                      >
                        ▼
                      </button>
                      <button
                        onClick={() => setDraft({ ...draft, bookKeys: draft.bookKeys.filter((k) => k !== key) })}
                        className="min-h-11 px-2 text-(--color-danger) transition-opacity hover:opacity-80"
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

        {draft.type === "quote" && draft.mode !== "rediscover" &&
          (browsingBookKey ? (
            <div className="flex flex-col gap-2">
              <button onClick={() => setBrowsingBookKey(null)} className="inline-flex min-h-11 items-center gap-1 self-start text-xs text-(--color-text-dim) hover:text-(--color-text)">
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
                    className="min-h-11 rounded-lg border border-(--color-border) px-3 py-2 text-left text-sm italic hover:bg-(--color-surface-hover)"
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
              <label htmlFor="quotes-block-title" className="mb-1 block text-sm font-semibold">Title</label>
              <input
                id="quotes-block-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. My favorite lines"
                className="min-h-11 w-full rounded-lg border border-(--color-border) bg-transparent px-3 py-2 text-sm"
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
                        className="min-h-11 shrink-0 px-2 text-(--color-danger) transition-opacity hover:opacity-80"
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
                <button onClick={() => setBrowsingBookKey(null)} className="inline-flex min-h-11 items-center gap-1 self-start text-xs text-(--color-text-dim) hover:text-(--color-text)">
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
                    className="min-h-11 rounded-lg border border-(--color-border) px-3 py-2 text-left text-sm italic hover:bg-(--color-surface-hover)"
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
                <label className="text-sm font-semibold">Which tier list</label>
                {tierlists === undefined ? (
                  <p className="text-xs text-(--color-text-dim)">Loading tier lists…</p>
                ) : tierlists.length === 0 ? (
                  <p className="text-xs text-(--color-text-dim)">No tier lists yet — create one in Games and it will show up here.</p>
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
                <p className="mt-1 text-xs text-(--color-text-dim)">Ranking and tiers are edited over in Games.</p>
                <Link
                  to="/dashboard/arena?tab=tierlists"
                  onClick={onClose}
                  className="inline-flex min-h-11 items-center gap-1 self-start text-xs font-medium text-(--color-accent) transition-opacity hover:opacity-80"
                >
                  Create in Games
                  <ChevronRightIcon size={13} />
                </Link>
              </div>
            );
          })()}
      </div>
    </Sheet>
  );
}
