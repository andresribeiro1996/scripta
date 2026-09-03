// Exercises lib/storygraph.ts's pure functions directly against a
// synthetic StoryGraph export — not a permanent test suite, just a
// one-off verification script. Run with:
//   npx tsx scripts/test-storygraph.mts

import { looksLikeStorygraphCsv, storygraphCsvToLibraryJson } from "../src/lib/storygraph";

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
  "Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count," +
  "Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?," +
  "Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?";

const rows = [
  // finished, real ISBN, star rating, a review with an embedded comma
  '"The Fifth Season","N.K. Jemisin",,"9780316229296",book,read,2023/01/02,2023/01/20,"2023/01/02-2023/01/20",1,' +
    '"dark, tense",fast,Plot,Yes,No,Yes,Yes,4.5,"loved it, would read again",,,,"owned",true',
  // currently reading, no rating, StoryGraph internal UID instead of an ISBN
  '"Some ARC","Jane Doe",,"storygraph-uid-abc123",ebook,currently-reading,2024/03/01,,,0,,,,,,,,,,,,"false"',
  // to-read, blank rating/review
  '"On The Shelf","John Roe",,"",book,to-read,2024/05/05,,,0,,,,,,,,,,,,,'
];

const csv = header + "\n" + rows.join("\n") + "\n";

console.log("1. looksLikeStorygraphCsv");
{
  check("recognizes a StoryGraph header", looksLikeStorygraphCsv(csv));
  check("doesn't misfire on a Goodreads-shaped header", !looksLikeStorygraphCsv("Book Id,Title,Author,Exclusive Shelf\n1,A,B,read\n"));
  check("doesn't misfire on plain text", !looksLikeStorygraphCsv("just some text\nwith lines\n"));
}

console.log("\n2. storygraphCsvToLibraryJson — field mapping");
{
  const data = storygraphCsvToLibraryJson(csv);
  check("book_count matches", data.book_count === 3 && data.books.length === 3);
  check("source label set", data.source === "storygraph-export (browser)");

  const b0 = data.books[0] as Record<string, unknown>;
  check("title/author carried over", b0.Title === "The Fifth Season" && b0.Attribution === "N.K. Jemisin");
  check("valid ISBN kept", b0.ISBN === "9780316229296");
  check("read -> ReadStatus 2, 100%", b0.ReadStatus === 2 && b0.___PercentRead === 100);
  check("fractional star rating carried over", b0.Rating === 4.5);
  check("DateLastRead/DateCreated mapped", b0.DateLastRead === "2023/01/20" && b0.DateCreated === "2023/01/02");
  check("ContentID uses the ISBN/UID column", b0.ContentID === "storygraph:9780316229296");
  const highlights0 = b0.highlights as Array<Record<string, unknown>>;
  check("non-empty review becomes one highlight", highlights0.length === 1 && highlights0[0].Text === "loved it, would read again");
  check("highlight is typed as a review", highlights0[0].Type === "review");

  const b1 = data.books[1] as Record<string, unknown>;
  check("non-ISBN UID doesn't leak into ISBN", b1.ISBN === "");
  check("UID still used for a stable ContentID", b1.ContentID === "storygraph:storygraph-uid-abc123");
  check("currently-reading -> ReadStatus 1, 0%", b1.ReadStatus === 1 && b1.___PercentRead === 0);
  check("no rating -> Rating null", b1.Rating === null);
  check("no review -> no highlights", (b1.highlights as unknown[]).length === 0);

  const b2 = data.books[2] as Record<string, unknown>;
  check("to-read -> ReadStatus 0", b2.ReadStatus === 0);
  check("blank ISBN/UID falls back to row index for ContentID", b2.ContentID === "storygraph:2");
}

console.log("\n3. storygraphCsvToLibraryJson — empty file rejected");
{
  let threw = false;
  try {
    storygraphCsvToLibraryJson(header + "\n");
  } catch {
    threw = true;
  }
  check("throws on a header-only CSV", threw);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
