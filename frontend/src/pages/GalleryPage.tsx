import { useMemo, useRef, useState } from "react";
import { useDeleteGalleryImage } from "../hooks/useDeleteGalleryImage";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useLibrary } from "../hooks/useLibrary";
import { useConfirm } from "../components/ConfirmDialog";
import { PageContainer } from "../components/PageContainer";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** /dashboard/gallery — the account's pool of uploaded images, primarily
 *  meant to be assigned as book covers (see CoverPickerModal.tsx, opened
 *  from BookCard.tsx's "Cover" button on LibraryPage.tsx/GroupsPage.tsx),
 *  but managed here as its own resource: upload, browse, delete. Deleting
 *  here goes through the same useDeleteGalleryImage() hook the picker
 *  modal uses, so a book currently using a deleted image is scrubbed back
 *  to its normal auto-detected cover the same way either place. */
export function GalleryPage() {
  const { images, isLoading, upload } = useGalleryImages();
  const deleteImage = useDeleteGalleryImage();
  const { data: library } = useLibrary();
  const confirm = useConfirm();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // How many books currently use each image as their cover — shown so
  // deleting a still-in-use image is an informed choice, not a surprise.
  const usageByImageId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of library?.data.books ?? []) {
      const id = typeof book._coverImageId === "string" ? book._coverImageId : null;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [library]);

  async function handleUpload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      await upload(file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    const usedBy = usageByImageId.get(id) ?? 0;
    const warning =
      usedBy > 0
        ? `Currently the cover for ${usedBy} book${usedBy === 1 ? "" : "s"} — deleting it will revert ${usedBy === 1 ? "that book" : "those books"} to its normal auto-detected cover. This can't be undone.`
        : "This can't be undone.";
    if (!(await confirm({ title: "Delete this image from your gallery?", body: warning }))) return;
    setDeletingId(id);
    try {
      await deleteImage(id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <PageContainer>
      <header className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold">Gallery</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Upload image…"}
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
      </header>

      {uploadError && (
        <div className="mb-5 rounded-lg bg-(--color-danger-soft) px-3 py-2 text-sm text-(--color-danger)">{uploadError}</div>
      )}

      <div
        className={`mb-6 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-sm transition-colors ${
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
        <span className="text-(--color-text-dim)">Drag an image here to upload it — JPEG, PNG, or WebP, up to 20 MB.</span>
      </div>

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading your gallery…</p>}

      {!isLoading && images.length === 0 && (
        <p className="text-sm text-(--color-text-dim)">No images yet — upload one above, or straight from a book's "Cover" button.</p>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {images.map((image) => {
            const usedBy = usageByImageId.get(image.id) ?? 0;
            return (
              <div key={image.id} className="group relative overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface)">
                <div className="aspect-square bg-(--color-border)">
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="p-2 text-xs text-(--color-text-dim)">
                  <div>
                    {image.width}×{image.height} · {formatBytes(image.byteSize)}
                  </div>
                  {usedBy > 0 && (
                    <div className="mt-0.5 text-(--color-accent)">
                      Cover for {usedBy} book{usedBy === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void handleDelete(image.id)}
                  disabled={deletingId === image.id}
                  title="Delete from gallery"
                  className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-sm font-bold text-white opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 disabled:opacity-100"
                >
                  {deletingId === image.id ? "…" : "×"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
