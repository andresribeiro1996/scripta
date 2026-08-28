// Deletes a gallery image AND scrubs it out of everything that
// referenced it, in one call — same "delete the thing, scrub whatever
// pointed at it" shape as lib/groups.ts's book-delete scrubbing. Two
// separate things can reference a gallery image: a book's custom cover
// (lib/bookCovers.ts's scrubImageFromBooks) and a mural's `image` block
// (lib/murals.ts's scrubImageFromMurals) — both get scrubbed here in one
// pass, so a caller (GalleryPage.tsx / CoverPickerModal.tsx) never has to
// remember which one applies.

import { useQueryClient } from "@tanstack/react-query";
import { saveLibrary, type LibraryDocument } from "../api/library";
import { scrubImageFromBooks } from "../lib/bookCovers";
import { scrubImageFromMurals } from "../lib/murals";
import { useGalleryImages } from "./useGalleryImages";

export function useDeleteGalleryImage() {
  const queryClient = useQueryClient();
  const { remove } = useGalleryImages();

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

    const saved = await saveLibrary({ ...current.data, books: scrubbedBooks, murals: scrubbedMurals });
    queryClient.setQueryData(["library"], saved);
  };
}
