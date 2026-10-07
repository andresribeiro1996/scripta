import assert from "node:assert/strict";
import { test } from "node:test";
import { bookCsvToLibraryJson, decodeLibraryImport, LIBRARY_CSV_TEMPLATE } from "./bookCsv.js";
import { mergeLibraryData } from "./merge.js";
import { goodreadsCsvToLibraryJson } from "./goodreads.js";
import { storygraphCsvToLibraryJson } from "./storygraph.js";

test("Calibre catalog preserves metadata and exported five-star ratings without inventing reading status", () => {
  const data = bookCsvToLibraryJson('\uFEFFid,title,authors,isbn,rating,series,series_index,publisher,languages,tags,timestamp\r\n"1","A Wizard of Earthsea","Ursula K. Le Guin","9780547773742","4.5","Earthsea","1","Houghton Mifflin","[\'eng\']","Fantasy","2024-03-01T12:30:00+00:00"\r\n')!;
  assert.equal(data.source, "calibre-export");
  const book = data.books[0]!;
  assert.equal(book.Title, "A Wizard of Earthsea");
  assert.equal(book.ISBN, "9780547773742");
  assert.equal(book.Rating, 4.5);
  assert.equal(book.Series, "Earthsea");
  assert.equal(book.SeriesNumber, 1);
  assert.equal(book.Publisher, "Houghton Mifflin");
  assert.equal(book.Language, "eng");
  assert.equal(book.DateCreated, "2024-03-01T12:30:00+00:00");
  assert.deepEqual(book._genres, ["Fantasy"]);
  assert.equal(Object.hasOwn(book, "ReadStatus"), false);
});

test("spreadsheet template handles quoted commas, escaped quotes, line breaks, ISBNs and reading fields", () => {
  const data = bookCsvToLibraryJson(LIBRARY_CSV_TEMPLATE + '"Book, ""One""\nPart Two",Jane Doe,978-0-394-72968-5,read,4.5,2024-02-29,2024-01-01,Series,2.5,Publisher,en,Fantasy\r\n')!;
  assert.equal(data.source, "spreadsheet-export");
  assert.equal(data.book_count, 1);
  assert.equal(data.books[0]!.Title, 'Book, "One"\nPart Two');
  assert.equal(data.books[0]!.ISBN, "9780394729685");
  assert.equal(data.books[0]!.ReadStatus, 2);
  assert.equal(data.books[0]!.___PercentRead, 100);
  assert.equal(data.books[0]!.DateLastRead, "2024-02-29");
});

test("blank fields and repeated imports preserve status, progress, ratings, ISBN, covers and highlights", () => {
  const existing = { books: [{ Title: "Stoner", Attribution: "John Williams", ISBN: "9780394729685", ReadStatus: 1, ___PercentRead: 42, Rating: 5, Series: "My series", DateLastRead: "2024-01-01", _coverUrl: "https://example.com/cover.jpg", highlights: [{ BookmarkID: "note-1", Text: "Note" }] }] };
  const csv = "Title,Author,ISBN,Status,Rating,Series,Date Read\nStoner,John Williams,,,,,\n";
  const incoming = bookCsvToLibraryJson(csv)!;
  const merged = mergeLibraryData(existing, incoming);
  assert.equal(merged.books.length, 1);
  assert.equal(merged.books[0]!.ReadStatus, 1);
  assert.equal(merged.books[0]!.___PercentRead, 42);
  assert.equal(merged.books[0]!.Rating, 5);
  assert.equal(merged.books[0]!.ISBN, "9780394729685");
  assert.equal(merged.books[0]!.Series, "My series");
  assert.equal(merged.books[0]!.DateLastRead, "2024-01-01");
  assert.deepEqual(merged.books[0]!.highlights, existing.books[0]!.highlights);
  assert.equal(merged.books[0]!._coverUrl, existing.books[0]!._coverUrl);
  assert.deepEqual(mergeLibraryData(merged, incoming).books, merged.books);
});

test("CSV rejects invalid rows instead of silently importing partial data", () => {
  const invalid = [
    "Title,Author\n",
    "Title,Author,title\nA,B,C\n",
    "Title,Author\nA,B,C\n",
    "Title,Author\nA\n",
    "Title,Author\n,B\n",
    'Title,Author\n"A,B\n',
    'Title,Author\n"A"oops,B\n',
    'Title,Author\nA"quoted",B\n',
    "Title,Author,ISBN\nA,B,9.78E12\n",
    "Title,Author,Status\nA,B,unknown\n",
    "Title,Author,Status\nA,B,toString\n",
    "Title,Author,Rating\nA,B,5 stars\n",
    "Title,Author,Rating\nA,B,6\n",
    "Title,Author,Series Number\nA,B,-1\n",
    "Title,Author,Date Read\nA,B,2024-02-30\n",
    "Title,Author,Date Added\nA,B,01/02/2024\n",
    "Title,Authors,id,timestamp\nA,B,1,invalid\n"
  ];
  for (const csv of invalid) assert.throws(() => bookCsvToLibraryJson(csv), /CSV|csv/);
  assert.equal(bookCsvToLibraryJson("Unrelated,Fields\nA,B\n"), null);
});

test("CSV ids survive row reordering and do not rely on Calibre ids from different libraries", () => {
  const first = bookCsvToLibraryJson("Title,Authors,id\nA,B,1\nC,D,2\n")!;
  const second = bookCsvToLibraryJson("Title,Authors,id\nC,D,1\nA,B,2\n")!;
  assert.equal(first.books[0]!.ContentID, second.books[1]!.ContentID);
  assert.equal(first.books[1]!.ContentID, second.books[0]!.ContentID);
  assert.equal(bookCsvToLibraryJson('Title,Author,ISBN\nA,B,="0394729684"\n')!.books[0]!.ISBN, "0394729684");
});

test("shared CSV validation preserves Goodreads ISBN wrappers and quoted headers with a BOM", () => {
  const goodreads = goodreadsCsvToLibraryJson('\uFEFF"Book Id","Title","Author","Exclusive Shelf","ISBN","My Review"\n1,Stoner,John Williams,read,="0394729684","Excellent, ""really"""\n');
  assert.equal(goodreads.books[0]!.ISBN, "0394729684");
  assert.equal(goodreads.books[0]!.Title, "Stoner");
  const storygraph = storygraphCsvToLibraryJson('\uFEFF"Title",Authors,Read Status,ISBN/UID\nStoner,John Williams,read,9780394729685\n');
  assert.equal(storygraph.books[0]!.Title, "Stoner");
  assert.equal(storygraph.books[0]!.ReadStatus, 2);
});

test("LibraryThing TSV preserves bracketed ISBNs, dates, ratings and reviews without importing private comments", () => {
  const header = ["Book_Id", "Title", "Primary_Author", "ISBN", "ISBNs", "Rating", "Date_Started", "Date_Read", "Entry_Date", "Review", "Tags", "Collections", "Private_Comment"];
  const row = ["42", 'Book with "quotes", and commas', "Jane Doe", "[0394729684]", "0394729684, 9780394729685", "4.5", "[2024-01-01]", "[2024-02-29]", "[2023-12-01]", 'A "great" book, really', "Fantasy", "Your library", "Private note"];
  const csv = header.join("\t") + "\r\n" + row.join("\t") + "\r\n";
  const data = bookCsvToLibraryJson(csv)!;
  assert.equal(data.source, "librarything-export");
  const book = data.books[0]!;
  assert.equal(book.ContentID, "librarything:42");
  assert.equal(book.Title, row[1]);
  assert.equal(book.ISBN, "0394729684");
  assert.equal(book.ReadStatus, 2);
  assert.equal(book.Rating, 4.5);
  assert.equal(book.DateStarted, "2024-01-01");
  assert.equal(book.DateLastRead, "2024-02-29");
  assert.equal(book.DateCreated, "2023-12-01");
  assert.equal((book.highlights as Array<Record<string, unknown>>)[0]!.Text, row[9]);
  assert.equal(JSON.stringify(data).includes("Private note"), false);
  assert.deepEqual(mergeLibraryData(data, data).books, data.books.map((value) => ({ ...value, _coverUrl: null })));
});

test("LibraryThing collection statuses stay explicit and anonymous books import", () => {
  const header = "Book Id\tTitle\tPrimary Author\tCollections\tISBNs\tDate Started\n";
  const data = bookCsvToLibraryJson(header + [
    ["1", "Reading", "Author", "Your library, Currently reading", "", ""],
    ["2", "Wishlist", "Author", "Wishlist", "", ""],
    ["3", "Owned", "", "Your library", "", ""],
    ["4", "Read", "Author", "Read but unowned", "", ""],
    ["5", "Started", "Author", "Your library", "9780394729685, 0394729684", "[2024-01-01]"]
  ].map((row) => row.join("\t")).join("\n"))!;
  assert.deepEqual(data.books.map((book) => book.ReadStatus), [1, 0, undefined, 2, 1]);
  assert.equal(data.books[2]!.Attribution, "");
  assert.equal(data.books[4]!.ISBN, "9780394729685");
  assert.throws(() => bookCsvToLibraryJson(header + "1\tBook\tAuthor\tYour library\t\t[2024-02-30]\n"), /dates/);
});

test("LibraryThing legacy text decodes without corrupting accents, while other invalid UTF-8 is rejected", () => {
  const tsv = "Book Id\tTitle\tPrimary Author\n1\tCafé\tAndré\n";
  assert.equal(decodeLibraryImport(Buffer.from(tsv, "latin1")), tsv);
  assert.equal(decodeLibraryImport(Buffer.from(tsv, "utf8")), tsv);
  const mixed = Buffer.concat([Buffer.from("Book Id\tTitle\tPrimary Author\n1\tCafé\t"), Buffer.from("André\n", "latin1")]);
  assert.equal(decodeLibraryImport(mixed), tsv);
  assert.equal(decodeLibraryImport(Buffer.concat([Buffer.from([239, 187, 191]), mixed])), tsv);
  assert.throws(() => decodeLibraryImport(Buffer.from("Title,Author\nCafé,André\n", "latin1")), /decode/);
});

test("BookWyrm CSV maps reading dates, ISBNs, ratings, reviews and custom shelf activity", () => {
  const header = "title,author_text,remote_id,isbn_10,isbn_13,start_date,finish_date,stopped_date,rating,review_content,review_published,shelf,shelf_date\n";
  const data = bookCsvToLibraryJson(header + [
    '我穿我自己,琅俨,https://example.com/book/1,,,,,,,,,to-read,2024-08-10',
    'Stoner,John Williams,https://example.com/book/2,0394729684,9780394729685,2024-01-01,2024-02-29,,4.5,"Good, ""really""",2024-03-01,custom-1,2024-08-10',
    'Stopped,Jane Doe,https://example.com/book/3,,,2024-01-01,,2024-02-01,,,,custom-1,2024-08-10'
  ].join("\n"))!;
  assert.equal(data.source, "bookwyrm-export");
  assert.equal(data.books[0]!.Title, "我穿我自己");
  assert.equal(data.books[0]!.ReadStatus, 0);
  const book = data.books[1]!;
  assert.equal(book.ContentID, "bookwyrm:https://example.com/book/2");
  assert.equal(book.ISBN, "9780394729685");
  assert.equal(book.ReadStatus, 2);
  assert.equal(book.DateStarted, "2024-01-01");
  assert.equal(book.DateLastRead, "2024-02-29");
  assert.equal(book.Rating, 4.5);
  assert.equal((book.highlights as Array<Record<string, unknown>>)[0]!.Text, 'Good, "really"');
  assert.equal((book.highlights as Array<Record<string, unknown>>)[0]!.DateCreated, "2024-03-01");
  assert.equal(Object.hasOwn(data.books[2]!, "ReadStatus"), false);
  assert.equal(data.books[2]!.DateStopped, "2024-02-01");
});
