import type { LibraryData, LibraryDocument } from "../api/library";

export async function saveLibraryUpdate(
  current: LibraryDocument | null | undefined,
  updater: (data: LibraryData) => LibraryData,
  fetchLibrary: () => Promise<LibraryDocument | null>,
  saveLibrary: (data: LibraryData, updatedAt?: string) => Promise<LibraryDocument>,
): Promise<LibraryDocument> {
  const persist = (document: LibraryDocument | null | undefined) => {
    const base = document?.data ?? { books: [] };
    const updated = updater(base);
    return document && updated === base ? Promise.resolve(document) : saveLibrary(updated, document?.updatedAt);
  };
  try {
    return await persist(current);
  } catch (error) {
    if (!error || typeof error !== "object" || !("status" in error) || error.status !== 409) throw error;
    return persist(await fetchLibrary());
  }
}
