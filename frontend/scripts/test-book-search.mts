// Exercises lib/bookSearch.ts's pure functions directly against
// synthetic inputs — same one-off verification script style as
// scripts/test-merge.mts. No network: searchBooks itself (the only
// impure function there) stays out, its parsing half is covered via
// mapOpenLibraryDoc. Run with:
//   npx tsx scripts/test-book-search.mts

import { buildManualBook, looksLikeIsbnQuery, mapOpenLibraryDoc } from "../src/lib/bookSearch";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("1. looksLikeIsbnQuery");
check("13-digit 978 ISBN → true", looksLikeIsbnQuery("9780441569595"));
check("13-digit with dashes/spaces → true", looksLikeIsbnQuery("978-0-441-56959-5") && looksLikeIsbnQuery("978 0 4415 69595"));
check("13-digit non-book prefix (not 978/979) → false", !looksLikeIsbnQuery("6901234567890"));
check("truncated 13-digit → false", !looksLikeIsbnQuery("978044156959"));
check("ISBN-10 with X check digit → true", looksLikeIsbnQuery("044156956X"));
check("free text → false", !looksLikeIsbnQuery("neuromancer gibson"));
check("empty → false", !looksLikeIsbnQuery("   "));

console.log("\n2. mapOpenLibraryDoc");
{
  const result = mapOpenLibraryDoc({
    title: " Neuromancer ",
    author_name: ["William Gibson", "Someone Else"],
    first_publish_year: 1984,
    isbn: ["0441569560", "9780441569595", "junk"],
    publisher: ["Ace Books", "Later Editions Inc"],
    cover_i: 8225261
  });
  check(
    "full doc maps: title trimmed, authors kept, year, isbn13 preferred over isbn10, first publisher, cover URL built",
    result !== null &&
      result.title === "Neuromancer" &&
      result.authors.length === 2 &&
      result.year === 1984 &&
      result.isbn === "9780441569595" &&
      result.publisher === "Ace Books" &&
      result.coverUrl === "https://covers.openlibrary.org/b/id/8225261-M.jpg"
  );
  check("no title → null", mapOpenLibraryDoc({ author_name: ["X"] }) === null);
  const minimal = mapOpenLibraryDoc({ title: "Thin Book", isbn: ["0441569560"] });
  check(
    "minimal doc: falls back to isbn10, nulls for the rest",
    minimal !== null && minimal.isbn === "0441569560" && minimal.year === null && minimal.coverUrl === null && minimal.authors.length === 0
  );
  const nonBook = mapOpenLibraryDoc({ title: "Cereal Box", isbn: ["6901234567890"] });
  check("isbn not matching 978/979 or ISBN-10 shape → null isbn", nonBook !== null && nonBook.isbn === null);
}

console.log("\n3. buildManualBook");
{
  const read = buildManualBook(
    { title: "Neuromancer", author: "William Gibson", isbn: "9780441569595", publisher: "Ace Books", readStatus: 2, rating: 5, dateRead: "2024-05-01" },
    "test-id-1"
  );
  check(
    "finished book: manual: ContentID, 100% read, date + rating kept, same field set as the importers",
    read.ContentID === "manual:test-id-1" &&
      read.ReadStatus === 2 &&
      read.___PercentRead === 100 &&
      read.DateLastRead === "2024-05-01" &&
      read.Rating === 5 &&
      read.ISBN === "9780441569595" &&
      read.Publisher === "Ace Books" &&
      read.Series === null &&
      read.WordCount === -1 &&
      Array.isArray(read.highlights) &&
      read.highlights.length === 0 &&
      "DateCreated" in read &&
      "TimeSpentReading" in read &&
      "MimeType" in read &&
      "ImageId" in read &&
      "Language" in read &&
      "SeriesNumber" in read
  );
  const wantToRead = buildManualBook(
    { title: "Dune", author: "Frank Herbert", isbn: "", publisher: null, readStatus: 0, rating: null, dateRead: "2024-05-01" },
    "test-id-2"
  );
  check(
    "not-finished book: 0% read, date dropped even if the form still had one, null rating",
    wantToRead.ReadStatus === 0 && wantToRead.___PercentRead === 0 && wantToRead.DateLastRead === null && wantToRead.Rating === null
  );
  const reading = buildManualBook(
    { title: "X", author: "Y", isbn: "", publisher: null, readStatus: 1, rating: 3, dateRead: null },
    "test-id-3"
  );
  check("currently-reading book: 0% read, date null, rating kept", reading.___PercentRead === 0 && reading.DateLastRead === null && reading.Rating === 3);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
