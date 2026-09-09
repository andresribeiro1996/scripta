// Deletes a gallery image AND scrubs it out of everything that
// referenced it, in one call — same "delete the thing, scrub whatever
// pointed at it" shape as lib/groups.ts's book-delete scrubbing. Two
// separate things can reference a gallery image: a book's custom cover
// (lib/bookCovers.ts's scrubImageFromBooks, saved as part of the library
// document) and a mural's cover/`image` block (lib/murals.ts's
// scrubImageFromMurals, now persisted independently via useMurals()'s
// scrubImage — murals live on their own backend rows, not on this
// document) — both get scrubbed here in one call, so a caller
// (GalleryPage.tsx / CoverPickerModal.tsx) never has to remember which
// one applies.

import { fetchLibrary } from "../api/library";
import { scrubImageFromBooks } from "../lib/bookCovers";
import { useGalleryImages } from "./useGalleryImages";
import { useLibrary } from "./useLibrary";
import { useMurals } from "./useMurals";

export function useDeleteGalleryImage() {
  const { remove } = useGalleryImages();
  const { updateLibrary } = useLibrary();
  const { scrubImage } = useMurals();

  return async function deleteGalleryImageAndScrub(id: string): Promise<void> {
    const current = await fetchLibrary();
    await remove(id);

    // Independent of the library save below — see scrubImage's own
    // comment for why a mural referencing this image is PUT on its own
    // rather than riding along in the library save's payload.
    await scrubImage(id);

    if (!current) return;
    const scrubbedBooks = scrubImageFromBooks(current.data.books, id);
    if (scrubbedBooks === current.data.books) return; // nothing referenced it — nothing to save

    await updateLibrary((data) => ({ ...data, books: scrubImageFromBooks(data.books, id) }), current);
  };
}
