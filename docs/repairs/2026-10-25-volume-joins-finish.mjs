const { openBooksDb } = await import(`${process.cwd()}/dist/modules/books/adapters/sqlite/connection.js`);
const { createSqliteBooksRepository } = await import(`${process.cwd()}/dist/modules/books/adapters/sqlite/sqliteBooksRepository.js`);

const DETACH = ["9789896417338", "9789896410353", "9789897849831"];
const MERGE = [
  ["e2ae6929-3d32-4112-8b23-2e82b93d60bf", "a5bf1a13-9e86-4769-b642-8a24f00add97"],
  ["469f87b2-8fcb-4906-b51c-f05f470f30ad", "5aff62cf-9cb6-46f2-a0a5-96692d09847b"]
];

const repo = createSqliteBooksRepository(openBooksDb());
const at = new Date().toISOString();
const editions = DETACH.map((isbn) => {
  const book = repo.findBookByKey(`isbn:${isbn}`);
  if (!book) throw new Error(`no edition ${isbn}`);
  return book;
});
const detached = editions.map((book) => ({ isbn: book.isbn, work: repo.detachEdition(book.id, at) }));
const merged = MERGE.map(([from, into]) => ({ from, into: repo.mergeWorks(from, into, at) }));
console.log(JSON.stringify({ detached, merged }, null, 2));
