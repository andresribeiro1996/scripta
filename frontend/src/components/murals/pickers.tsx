// Small, stateless-ish presentational pickers shared across
// BlockConfigPanel.tsx's per-type editors — a searchable book list and a
// gallery image grid. Not modals themselves (BlockConfigPanel already IS
// the one modal for "configure this block" — nesting a second modal on
// top of it would just be z-index pain for no real benefit); these render
// inline inside its body.

import { useMemo, useState } from "react";
import type { GalleryImage } from "../../api/gallery";
import { useDeleteGalleryImage } from "../../hooks/useDeleteGalleryImage";
import { useConfirm } from "../ConfirmDialog";

/** Search-filtered, click-to-select list of books — used for Spotlight
 *  (single pick), Shelf ("add another book"), and as the first step of
 *  picking a quote (browse to a book, then its highlights). Filtering
 *  matches GroupsPage.tsx's BookPickerModal exactly (title/author,
 *  case-insensitive substring). */
export function BookSearchList({
  books,
  isSelected,
  onSelect,
  placeholder = "Search your library…"
}: {
  books: Array<Record<string, unknown>>;
  isSelected?: (book: Record<string, unknown>) => boolean;
  onSelect: (book: Record<string, unknown>) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return books;
    return books.filter((b) => String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q));
  }, [books, search]);

  return (
    <div className="rounded-lg border border-(--color-border)">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        className="w-full border-b border-(--color-border) bg-transparent px-3 py-2 text-sm"
      />
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 && <p className="p-3 text-sm text-(--color-text-dim)">No books match.</p>}
        {filtered.map((book, i) => (
          <button
            key={String(book.ContentID ?? i)}
            onClick={() => onSelect(book)}
            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-(--color-surface-hover) ${
              isSelected?.(book) ? "bg-(--color-accent-soft)" : ""
            }`}
          >
            <span className="min-w-0 truncate">
              {String(book.Title ?? "Untitled")}
              <span className="text-(--color-text-dim)"> — {String(book.Attribution ?? "Unknown author")}</span>
            </span>
            {isSelected?.(book) && <span className="shrink-0 text-(--color-accent)">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Click-to-select grid of gallery thumbnails — used by the Image block's
 *  editor. Same visual language as CoverPickerModal.tsx's grid, kept as
 *  its own small copy here rather than a shared extraction — the two
 *  pickers' surrounding chrome (upload dropzone, "remove" link, etc.)
 *  differ enough that sharing would mean threading through more props
 *  than the duplication actually costs.
 *
 *  Deleting a gallery image from HERE too (not just GalleryPage.tsx and
 *  CoverPickerModal.tsx) — this was the one remaining picker that showed
 *  the gallery but offered no way to prune it, forcing a detour to the
 *  Gallery page for something as simple as "that upload was a mistake,
 *  get rid of it" while you're already looking right at it. Uses the same
 *  scrub-aware useDeleteGalleryImage() the other two pickers do (not the
 *  plain useGalleryImages().remove()), so a book/mural cover or another
 *  block referencing the deleted image gets cleaned up too, not just this
 *  block's own reference. `onImageDeleted` lets the caller (BlockConfigPanel)
 *  clear its OWN local draft if the image it just deleted was the one this
 *  very block currently has selected — otherwise Save would re-persist a
 *  now-dangling imageId, undoing the scrub that just ran. */
export function GalleryImageGrid({
  images,
  selectedId,
  onSelect,
  onImageDeleted
}: {
  images: GalleryImage[];
  selectedId: string | null;
  onSelect: (image: GalleryImage) => void;
  onImageDeleted?: (imageId: string) => void;
}) {
  const deleteImage = useDeleteGalleryImage();
  const confirm = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!(await confirm({ title: "Delete this image from your gallery?", body: "This can't be undone." }))) return;
    setDeletingId(id);
    try {
      await deleteImage(id);
      onImageDeleted?.(id);
    } finally {
      setDeletingId(null);
    }
  }

  if (images.length === 0) {
    return <p className="text-sm text-(--color-text-dim)">No images in your gallery yet — upload one from the Gallery page first.</p>;
  }
  return (
    <div className="grid grid-cols-4 gap-2">
      {images.map((image) => (
        // A plain div, not a <button> — it hosts the delete button as a
        // real child, and a <button> can't validly contain another
        // interactive element. Same pattern CoverPickerModal.tsx's own
        // grid already uses.
        <div
          key={image.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(image)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(image);
            }
          }}
          className={`group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 bg-(--color-border) ${
            image.id === selectedId ? "border-(--color-accent)" : "border-transparent"
          }`}
        >
          <img src={image.url} alt="" className="h-full w-full object-cover" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(image.id);
            }}
            title="Delete from gallery"
            className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-xs font-bold text-white opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100"
          >
            {deletingId === image.id ? "…" : "×"}
          </button>
        </div>
      ))}
    </div>
  );
}
