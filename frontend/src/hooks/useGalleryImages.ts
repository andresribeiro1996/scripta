// Shared read/mutate access to the account's gallery image pool — used by
// GalleryPage.tsx (the pool itself) and CoverPickerModal.tsx (assigning
// one as a book's cover), same "one hook, several call sites" reasoning
// as useLibrary.ts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteGalleryImage, fetchGalleryImages, uploadGalleryImage, type GalleryImage } from "../api/gallery";

export function useGalleryImages() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });

  async function upload(file: File): Promise<GalleryImage> {
    const image = await uploadGalleryImage(file);
    // Optimistic-ish: the upload already succeeded server-side by the
    // time this runs, so just fold the real result into the cache rather
    // than re-fetching the whole list.
    queryClient.setQueryData<GalleryImage[]>(["gallery"], (prev) => [image, ...(prev ?? [])]);
    return image;
  }

  /** Removes the image from the server and the local cache. Does NOT
   *  scrub any book that had it assigned as a cover — that's each
   *  caller's own responsibility (GalleryPage.tsx / CoverPickerModal.tsx),
   *  since only they know which library document to update, same
   *  division of labor as lib/groups.ts's removeBooksFromAllGroups vs.
   *  each page's own handleDeleteSelected. */
  async function remove(id: string): Promise<void> {
    await deleteGalleryImage(id);
    queryClient.setQueryData<GalleryImage[]>(["gallery"], (prev) => (prev ?? []).filter((img) => img.id !== id));
  }

  return { images: query.data ?? [], isLoading: query.isLoading, error: query.error, upload, remove };
}
