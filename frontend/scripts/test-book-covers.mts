// Exercises lib/bookCovers.ts — assigning a gallery image as a book's
// cover, clearing it back to auto-resolution, and the scrub step that
// runs alongside actually deleting a gallery image.
// Run with:
//   npx tsx scripts/test-book-covers.mts

import { clearBookCover, scrubImageFromBooks, setBookCover } from "../src/lib/bookCovers";

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

console.log("1. setBookCover — sets both _coverImageId and _coverUrl, leaves everything else alone");
{
  const book = { Title: "Some Book", ContentID: "c1" };
  const result = setBookCover(book, "img-1", "https://example.com/gallery/img-1/file");
  check("_coverImageId set", result._coverImageId === "img-1");
  check("_coverUrl set", result._coverUrl === "https://example.com/gallery/img-1/file");
  check("Title untouched", result.Title === "Some Book");
  check("original book object untouched (no mutation)", !("_coverImageId" in book));
}

console.log("\n2. clearBookCover — removes both fields, leaves everything else");
{
  const book = { Title: "Some Book", _coverImageId: "img-1", _coverUrl: "https://example.com/x", _style: { foo: 1 } };
  const result = clearBookCover(book);
  check("_coverImageId gone", !("_coverImageId" in result));
  check("_coverUrl gone", !("_coverUrl" in result));
  check("Title untouched", result.Title === "Some Book");
  check("unrelated _style untouched", (result._style as { foo: number }).foo === 1);
}

console.log("\n3. clearBookCover — a no-op-shaped result on a book with no custom cover to begin with");
{
  const book = { Title: "Plain Book", _coverUrl: "https://covers.openlibrary.org/b/isbn/123-M.jpg" };
  const result = clearBookCover(book);
  // No _coverImageId to begin with, so this path is indistinguishable
  // from "had one and it got cleared" — but an auto-resolved _coverUrl
  // with no _coverImageId should NOT survive clearBookCover either,
  // since the function's job is "strip whatever's in these two fields."
  check("_coverUrl removed even though _coverImageId was never set", !("_coverUrl" in result));
}

console.log("\n4. scrubImageFromBooks — clears the cover only on books that referenced the deleted image");
{
  const books = [
    { ContentID: "a", Title: "A", _coverImageId: "img-1", _coverUrl: "https://x/img-1/file" },
    { ContentID: "b", Title: "B", _coverImageId: "img-2", _coverUrl: "https://x/img-2/file" },
    { ContentID: "c", Title: "C" } // no custom cover at all
  ];
  const result = scrubImageFromBooks(books, "img-1");
  check("book A (referenced img-1) had its cover cleared", !("_coverImageId" in result[0]) && !("_coverUrl" in result[0]));
  check("book B (referenced img-2, untouched) kept its cover", result[1]._coverImageId === "img-2" && result[1]._coverUrl === "https://x/img-2/file");
  check("book B is the SAME object reference (no-op for untouched books)", result[1] === books[1]);
  check("book C (no custom cover) passed through unchanged, same reference", result[2] === books[2]);
}

console.log("\n5. scrubImageFromBooks — a true no-op (same array reference back) when no book references the deleted image");
{
  const books = [{ ContentID: "a", Title: "A", _coverImageId: "img-9", _coverUrl: "https://x/img-9/file" }];
  const result = scrubImageFromBooks(books, "img-does-not-exist");
  check("book untouched", result[0] === books[0]);
  check("returns the same books array reference (cheap no-op check for callers)", result === books);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
