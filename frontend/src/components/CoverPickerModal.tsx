import { useRef, useState } from "react";
import type { GalleryImage } from "../api/gallery";
import { useDeleteGalleryImage } from "../hooks/useDeleteGalleryImage";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useConfirm } from "./ConfirmDialog";

/** "Cover" button's modal (BookCard.tsx, everywhere a card renders;
 *  MuralsListPage.tsx's mural cards too) — assign one of the account's
 *  uploaded gallery images (see hooks/useGalleryImages.ts) as this
 *  specific thing's cover, upload a new one on the spot, or clear it
 *  back off. Picking or clearing closes the modal — this is a one-shot
 *  action, not a live-editing panel like PerCardStylePanel.tsx, so
 *  there's nothing to keep it open for. Same fixed-overlay modal shell as
 *  GroupsPage.tsx's BookPickerModal / PerCardStylePanel.tsx.
 *
 *  Deliberately generic (a `title`/`currentImageId` pair, not a whole
 *  `book`-shaped object) — a mural has no Title/`_coverImageId` fields of
 *  its own, and reusing this for it (rather than duplicating the whole
 *  modal) meant the "what am I a cover FOR" question had to stop being
 *  book-specific. Each caller supplies its own `removeCoverLabel` too,
 *  since what "removing it" actually means differs: a book falls back to
 *  auto-resolution (Kobo CDN/Open Library), a mural just goes back to a
 *  plain card — there's no auto-detected mural cover to fall back to. */
export function CoverPickerModal({
  title,
  currentImageId,
  removeCoverLabel = "Remove custom cover",
  onSelect,
  onRemoveCover,
  onClose
}: {
  title: string;
  currentImageId: string | null;
  removeCoverLabel?: string;
  onSelect: (image: GalleryImage) => void;
  onRemoveCover: () => void;
  onClose: () => void;
}) {
  const { images, isLoading, upload } = useGalleryImages();
  const deleteImage = useDeleteGalleryImage();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const image = await upload(file);
      // Uploading here is a convenience for "the cover I want isn't in my
      // gallery yet" — assigning it immediately, rather than making the
      // user upload and then click it again, is the whole point.
      onSelect(image);
      onClose();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteImage(id: string) {
    if (
      !(await confirm({
        title: "Delete this image from your gallery?",
        body: "Any book using it as a cover will fall back to its normal cover."
      }))
    ) {
      return;
    }
    setDeletingId(id);
    try {
      await deleteImage(id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) p-4">
          <div>
            <h3 className="text-sm font-semibold">Cover for "{title}"</h3>
            <p className="text-xs text-(--color-text-dim)">Pick one of your uploaded images, or upload a new one.</p>
          </div>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <div
          className={`m-4 mb-0 flex items-center justify-between gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-sm transition-colors ${
            dragOver ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border)"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleUpload(file);
          }}
        >
          <span className="text-(--color-text-dim)">Drag an image here, or</span>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-60"
          >
            {uploading ? "Uploading…" : "Upload new image…"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = "";
            }}
          />
        </div>
        {uploadError && <p className="mx-4 mt-2 text-xs text-(--color-danger)">{uploadError}</p>}

        {currentImageId && (
          <div className="mx-4 mt-3">
            <button
              onClick={() => {
                onRemoveCover();
                onClose();
              }}
              className="text-xs text-(--color-danger) transition-opacity hover:opacity-80"
            >
              {removeCoverLabel}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && <p className="text-sm text-(--color-text-dim)">Loading your gallery…</p>}
          {!isLoading && images.length === 0 && (
            <p className="text-sm text-(--color-text-dim)">No images in your gallery yet — upload one above.</p>
          )}
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {images.map((image) => (
                // A plain div, not a <button> — it hosts the delete
                // button as a real child, and a <button> can't validly
                // contain another interactive element.
                <div
                  key={image.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    onSelect(image);
                    onClose();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(image);
                      onClose();
                    }
                  }}
                  className={`group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 bg-(--color-border) ${
                    image.id === currentImageId ? "border-(--color-accent)" : "border-transparent"
                  }`}
                >
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteImage(image.id);
                    }}
                    title="Delete from gallery"
                    className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-xs font-bold text-white opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100"
                  >
                    {deletingId === image.id ? "…" : "×"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
