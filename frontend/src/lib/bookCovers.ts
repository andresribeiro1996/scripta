// Assigning a gallery image (see api/gallery.ts) as a book's cover — pure
// logic only, same reasoning as lib/groups.ts: the library document is an
// opaque blob as far as the backend's `library` module is concerned, so
// "which gallery image is this book's cover" lives entirely as fields on
// the book object, no backend change needed beyond the gallery module
// itself.
//
// Reuses BookCard's EXISTING cover-resolution priority rather than adding
// a new one: `_coverUrl` is already the first thing CoverImage tries (see
// components/BookCard.tsx's CoverImage, and lib/merge.ts's "keep
// whichever version has a cover" rule) — assigning a gallery image just
// sets that same field. `_coverImageId` is the one genuinely new field:
// bookkeeping so a later "delete this gallery image" (scrubImageFromBooks)
// knows which books' `_coverUrl` it's actually responsible for. Auto-
// resolved covers no longer touch `_coverUrl` at all (see lib/covers.ts's
// own top comment) — resolution's own persistence is a global cache
// server-side now (backend/src/modules/covers), so `_coverUrl` unset
// means exactly one thing today: "no custom cover assigned," nothing
// ambiguous about whether ordinary auto-resolution happened to write it.

export function setBookCover(book: Record<string, unknown>, imageId: string, url: string): Record<string, unknown> {
  return { ...book, _coverImageId: imageId, _coverUrl: url };
}

/** Reverts to the normal auto-resolve chain (the backend's own cache-aware
 *  GET /covers/resolve, see api/covers.ts) by clearing both fields —
 *  CoverImage falls straight back to that once `_coverUrl` is gone. */
export function clearBookCover(book: Record<string, unknown>): Record<string, unknown> {
  const { _coverImageId: _droppedImageId, _coverUrl: _droppedUrl, ...rest } = book;
  return rest;
}

/** Call this alongside actually deleting a gallery image (see
 *  hooks/useDeleteGalleryImage.ts) so a book that had it assigned doesn't
 *  keep pointing at a now-404ing URL forever — it falls back to
 *  auto-resolution instead, same outcome as clearBookCover, just applied
 *  to every affected book at once. Returns the SAME `books` array
 *  reference when no book referenced this image — same
 *  no-op-when-untouched convention as lib/groups.ts's
 *  removeBooksFromAllGroups, so a caller can cheaply check "was anything
 *  actually affected" with `result === books` before bothering to save. */
export function scrubImageFromBooks(books: Array<Record<string, unknown>>, imageId: string): Array<Record<string, unknown>> {
  if (!books.some((b) => b._coverImageId === imageId)) return books;
  return books.map((b) => (b._coverImageId === imageId ? clearBookCover(b) : b));
}
