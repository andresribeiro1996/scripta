// Deletes a gallery image AND scrubs it out of everything that
// referenced it, in one call — same "delete the thing, scrub whatever
// pointed at it" shape as lib/groups.ts's book-delete scrubbing. Two
// separate things can reference a gallery image: a book's custom cover
// (lib/bookCovers.ts's scrubImageFromBooks) and a mural's `image` block
// (lib/murals.ts's scrubImageFromMurals) — both get scrubbed here in one
// pass, so a caller (GalleryPage.tsx / CoverPickerModal.tsx) never has to
// remember which one applies.

import { useQueryClient } from "@tanstack/react-query";
import { type LibraryDocument } from "../api/library";
import { scrubImageFromBooks } from "../lib/bookCovers";
import { scrubImageFromMurals } from "../lib/murals";
import { useGalleryImages } from "./useGalleryImages";
import { useLibrary } from "./useLibrary";

export function useDeleteGalleryImage() {
  const queryClient = useQueryClient();
  const { remove } = useGalleryImages();
  // Through updateLibrary rather than a raw saveLibrary so the scrub
  // can't overwrite a save made on another device — see hooks/useLibrary.ts.
  const { updateLibrary } = useLibrary();

  return async function deleteGalleryImageAndScrub(id: string): Promise<void> {
    await remove(id);

    // Read the freshest cached library rather than a prop/closure — same
    // reasoning as every other page's delete handler.
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const murals = current.data.murals ?? [];
    const scrubbedBooks = scrubImageFromBooks(current.data.books, id);
    const scrubbedMurals = scrubImageFromMurals(murals, id);
    if (scrubbedBooks === current.data.books && scrubbedMurals === murals) return; // nothing referenced it — nothing to save

    await updateLibrary((data) => ({
      ...data,
      books: scrubImageFromBooks(data.books, id),
      murals: scrubImageFromMurals(data.murals ?? [], id)
    }));
  };
}
