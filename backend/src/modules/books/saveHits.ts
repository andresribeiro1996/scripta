import { fillMissingIdentity, findExisting, keysOf } from "./domain/findOrCreate.js";
import { lookupIdentity } from "./domain/normalize.js";
import { mergeDuplicateWorks } from "./duplicateWorks.js";
import type { BooksRepository, CatalogSearchHit } from "./domain/ports.js";
import type { SeriesEntry } from "./domain/series.js";
import type { BookRow } from "./domain/types.js";

const SAVE_GROUP_LIMIT = 50;

export function storeSeries(repo: BooksRepository, bookId: string, found: { editionSeries?: SeriesEntry[]; subjectSeries?: SeriesEntry[] }, at: string): void {
  const editions = found.editionSeries ?? [];
  const subjects = found.subjectSeries ?? [];
  if (editions.length === 0 && subjects.length === 0) return;
  repo.transaction(() => {
    for (const entry of editions) repo.addBookCollection(bookId, entry, "ol-edition", at);
    const workId = subjects.length > 0 ? repo.getBook(bookId)?.work_id : null;
    if (workId) repo.addWorkSeries(workId, subjects, "ol-subject", at);
  });
}

export function saveCatalogHits(
  deps: { repo: BooksRepository; sharesArena: (fromWorkId: string, intoWorkId: string) => boolean },
  hits: CatalogSearchHit[],
  at: string
): Array<BookRow | null> {
  const saved = hits.map(({ result, olCoverId, workKey, subjectSeries, source }) => {
    const author = result.authors.join(", ");
    const identity = lookupIdentity({ isbn: result.isbn, title: result.title, author });
    if (!identity) return null;
    const years = source === "openlibrary" ? { year: null, firstPublishedYear: result.year } : { year: result.year };
    const book = findExisting(deps.repo, identity) ?? deps.repo.createBook(
      { title: identity.title, author: identity.author, isbn: identity.isbn, ...years, publisher: result.publisher, olCoverId, workKey, genres: result.genres, sources: [source] },
      keysOf(deps.repo, identity),
      at
    );
    fillMissingIdentity(deps.repo, book, identity.title, identity.author);
    deps.repo.setWorkKey(book.id, workKey);
    deps.repo.makeSearchable(book.id);
    storeSeries(deps.repo, book.id, { subjectSeries }, at);
    return deps.repo.getBook(book.id) ?? book;
  });
  const titleKeys = [...new Set(saved.flatMap((book) => (book?.title_key ? [book.title_key] : [])))];
  if (titleKeys.length > 0) {
    mergeDuplicateWorks({ repo: deps.repo, sharesArena: deps.sharesArena, now: () => Date.parse(at) }, titleKeys);
    deps.repo.groupTitleKeys(titleKeys, SAVE_GROUP_LIMIT, at, deps.sharesArena);
  }
  return saved;
}
