import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateShelfTheme, goodreadsCsvToLibraryJson, normalizeBookGenres, storygraphCsvToLibraryJson } from "@scripta/shared";

test("genres normalize noisy metadata and shelf themes count books once", () => {
  assert.deepEqual(normalizeBookGenres(["Fantasy fiction", "Fantasy", "History", "Science fiction"]), ["Fantasy", "Science Fiction", "History"]);
  assert.deepEqual(calculateShelfTheme([
    { _genres: ["Fantasy", "History", "Fantasy"] },
    { _genres: ["Fantasy", "Romance"] },
    {},
  ]), { genres: ["Fantasy", "Romance", "History"], matchedBooks: 2, totalBooks: 3 });
});

test("Goodreads shelves and StoryGraph tags preserve recognized genres", () => {
  const goodreads = goodreadsCsvToLibraryJson('Book Id,Title,Author,Bookshelves,Exclusive Shelf\n1,Dune,Frank Herbert,"science-fiction, classics",read\n');
  assert.deepEqual(goodreads.books[0]._genres, ["Science Fiction", "Classics"]);
  const storygraph = storygraphCsvToLibraryJson('Title,Authors,Read Status,ISBN/UID,Tags\nDune,Frank Herbert,read,9780441172719,"science-fiction, fantasy"\n');
  assert.deepEqual(storygraph.books[0]._genres, ["Fantasy", "Science Fiction"]);
});
