import { GENRES_FROM_CATALOG, genresForBook, normalizeBookGenres } from "./bookGenres.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

export function withCatalogGenres(data: LibraryData, catalog: Record<string, string[]>): LibraryData {
  let changed = false;
  const books = data.books.map((book) => {
    const genres = normalizeBookGenres(catalog[bookKey(book)]);
    if (genres.length === 0) return book;
    const own = genresForBook(book);
    if (own.length > 0 && (book._genresFrom !== GENRES_FROM_CATALOG || own.join("|") === genres.join("|"))) return book;
    changed = true;
    return { ...book, _genres: genres, _genresFrom: GENRES_FROM_CATALOG };
  });
  return changed ? { ...data, books } : data;
}
