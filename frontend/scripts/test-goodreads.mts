// Characterization test for lib/goodreads.ts — written before it moved
// into packages/shared/src/library/goodreads.ts (Task 3A), since it had
// no test at all before this. Same one-off verification script style as
// scripts/test-storygraph.mts, its sibling. Run with:
//   npx tsx scripts/test-goodreads.mts

import { goodreadsCsvToLibraryJson, looksLikeGoodreadsCsv } from "../src/lib/goodreads";

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

const header =
  "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher," +
  "Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves," +
  "Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies";

const rows = [
  // finished, real ISBN13 (Goodreads-wrapped), a rating, a review with an embedded comma
  '555,"Neuromancer","William Gibson","Gibson, William",,="0441569560",="9780441569595",5,4.29,' +
    '"Ace Books",Paperback,271,1984,1984,2023/06/01,2023/01/02,,,"read","loved it, would read again",,,1,1',
  // currently reading, no rating, no review
  '556,"Some ARC","Jane Doe","Doe, Jane",,="",="",0,3.50,,Paperback,300,2024,2024,,2024/03/01,,,' +
    '"currently-reading",,,,0,0',
  // to-read, blank everything optional
  '557,"On The Shelf","John Roe","Roe, John",,="",="",0,3.90,,,,,,2024/05/05,,,"to-read",,,,0,0'
];

const csv = header + "\n" + rows.join("\n") + "\n";

console.log("1. looksLikeGoodreadsCsv");
{
  check("recognizes a Goodreads header", looksLikeGoodreadsCsv(csv));
  check("doesn't misfire on a StoryGraph-shaped header", !looksLikeGoodreadsCsv("Title,Authors,Read Status,ISBN/UID\nA,B,read,123\n"));
  check("doesn't misfire on plain text", !looksLikeGoodreadsCsv("just some text\nwith lines\n"));
}

console.log("\n2. goodreadsCsvToLibraryJson — field mapping");
{
  const data = goodreadsCsvToLibraryJson(csv);
  check("book_count matches", data.book_count === 3 && data.books.length === 3);
  check("source label set", data.source === "goodreads-export (browser)");

  const b0 = data.books[0] as Record<string, unknown>;
  check("title/author carried over", b0.Title === "Neuromancer" && b0.Attribution === "William Gibson");
  check("ISBN13 preferred over the wrapped ISBN10, wrapper stripped", b0.ISBN === "9780441569595");
  check("read -> ReadStatus 2, 100%", b0.ReadStatus === 2 && b0.___PercentRead === 100);
  check("rating carried over", b0.Rating === 5);
  check("DateLastRead/DateCreated mapped", b0.DateLastRead === "2023/06/01" && b0.DateCreated === "2023/01/02");
  check("ContentID uses the Goodreads Book Id", b0.ContentID === "goodreads:555");
  const highlights0 = b0.highlights as Array<Record<string, unknown>>;
  check("non-empty review becomes one highlight", highlights0.length === 1 && highlights0[0].Text === "loved it, would read again");
  check("highlight is typed as a review", highlights0[0].Type === "review");
  check("highlight BookmarkID is namespaced off the ContentID", highlights0[0].BookmarkID === "goodreads-review:goodreads:555");

  const b1 = data.books[1] as Record<string, unknown>;
  check("both ISBN fields blank (wrapped ==\"\") -> empty ISBN", b1.ISBN === "");
  check("currently-reading -> ReadStatus 1, 0%", b1.ReadStatus === 1 && b1.___PercentRead === 0);
  check("rating 0 -> Rating null", b1.Rating === null);
  check("no review -> no highlights", (b1.highlights as unknown[]).length === 0);

  const b2 = data.books[2] as Record<string, unknown>;
  check("to-read (or any custom shelf) -> ReadStatus 0", b2.ReadStatus === 0);
}

console.log("\n3. goodreadsCsvToLibraryJson — a book with no Book Id falls back to its row index for ContentID");
{
  const rowsNoId = "Book Id,Title,Author,Exclusive Shelf\n,No Id Book,Some Author,to-read\n";
  const data = goodreadsCsvToLibraryJson(rowsNoId);
  check("blank Book Id falls back to row index 0", (data.books[0] as Record<string, unknown>).ContentID === "goodreads:0");
}

console.log("\n4. goodreadsCsvToLibraryJson — empty file rejected");
{
  let threw = false;
  try {
    goodreadsCsvToLibraryJson(header + "\n");
  } catch {
    threw = true;
  }
  check("throws on a header-only CSV", threw);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
