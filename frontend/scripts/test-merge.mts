// Exercises lib/merge.ts's pure functions directly against synthetic
// scenarios — not a permanent test suite, just a one-off verification
// script for the merge-on-import feature. Run with:
//   npx tsx scripts/test-merge.mts

import { bookKey, mergeBookLists, mergeLibraryData } from "../src/lib/merge";

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

console.log("1. bookKey — ISBN takes priority over title+author");
check(
  "same ISBN, different everything else → same key",
  bookKey({ ISBN: "978-0-593-13520-4", Title: "A", Attribution: "X" }) ===
    bookKey({ ISBN: "9780593135204", Title: "B", Attribution: "Y" })
);
check(
  "no ISBN on either side → falls back to normalized title+author",
  bookKey({ Title: "  The Great Gatsby ", Attribution: "F. Scott Fitzgerald" }) ===
    bookKey({ Title: "the great gatsby", Attribution: "f. scott fitzgerald" })
);
check(
  "different books (no ISBN) → different keys",
  bookKey({ Title: "Book One", Attribution: "Author A" }) !== bookKey({ Title: "Book Two", Attribution: "Author A" })
);

console.log("\n2. Cross-source merge by ISBN (Kobo + Goodreads, same book)");
{
  const existing = [
    {
      ContentID: "kobo-content-id-1",
      Title: "Neuromancer",
      Attribution: "William Gibson",
      ISBN: "9780441569595",
      ReadStatus: 1,
      ___PercentRead: 42,
      _coverUrl: "https://cdn.kobo.com/some-real-cover.jpg",
      highlights: [{ BookmarkID: "kobo-bm-1", Text: "a real Kobo highlight" }]
    }
  ];
  const incoming = [
    {
      ContentID: "goodreads:555",
      Title: "Neuromancer",
      Attribution: "William Gibson",
      ISBN: "9780441569595",
      ReadStatus: 2, // Goodreads says "read"
      ___PercentRead: 100,
      _coverUrl: null, // importers never set this — always null/absent fresh off an import
      highlights: [{ BookmarkID: "goodreads-review:goodreads:555", Text: "loved it", Type: "review" }]
    }
  ];
  const merged = mergeBookLists(existing, incoming);
  check("exactly one book results (matched, not duplicated)", merged.length === 1);
  const book = merged[0] as any;
  check("newest (Goodreads) status wins", book.ReadStatus === 2 && book.___PercentRead === 100);
  check("Kobo's ContentID is gone (incoming's fields win)", book.ContentID === "goodreads:555");
  check("cover kept from the side that had one (existing/Kobo)", book._coverUrl === "https://cdn.kobo.com/some-real-cover.jpg");
  check("highlights UNION — both survive (different BookmarkID schemes)", book.highlights.length === 2);
}

console.log("\n3. Cover-keep rule, reversed direction (incoming has the cover this time)");
{
  const existing = [{ Title: "Book X", Attribution: "Author Y", ISBN: "1111111111", _coverUrl: null, highlights: [] }];
  const incoming = [{ Title: "Book X", Attribution: "Author Y", ISBN: "1111111111", _coverUrl: "https://example.com/cover.jpg", highlights: [] }];
  const merged = mergeBookLists(existing, incoming) as any[];
  check("cover taken from incoming when existing has none", merged[0]._coverUrl === "https://example.com/cover.jpg");
}

console.log("\n4. Re-importing the SAME source doesn't duplicate highlights");
{
  const sameHighlight = { BookmarkID: "stable-id-1", Text: "same highlight both times" };
  const existing = [{ Title: "Re-import Book", Attribution: "Same Author", highlights: [sameHighlight] }];
  const incoming = [{ Title: "Re-import Book", Attribution: "Same Author", highlights: [{ ...sameHighlight }] }];
  const merged = mergeBookLists(existing, incoming) as any[];
  check("no duplicate highlight (matched by BookmarkID)", merged[0].highlights.length === 1);
}

console.log("\n5. Non-overlapping books from both sides are preserved");
{
  const existing = [{ Title: "Only In Existing", Attribution: "A", highlights: [] }];
  const incoming = [{ Title: "Only In Incoming", Attribution: "B", highlights: [] }];
  const merged = mergeBookLists(existing, incoming) as any[];
  check("both books present", merged.length === 2);
  check("existing book kept first (order preserved)", merged[0].Title === "Only In Existing");
  check("new book appended", merged[1].Title === "Only In Incoming");
}

console.log("\n6. mergeLibraryData recomputes book_count and takes newest envelope metadata");
{
  const existing = { source: "kobo-export", schema_version: 1, book_count: 1, books: [{ Title: "A", Attribution: "X", highlights: [] }] };
  const incoming = { source: "goodreads-export (browser)", schema_version: 1, book_count: 1, books: [{ Title: "B", Attribution: "Y", highlights: [] }] };
  const result = mergeLibraryData(existing as any, incoming as any);
  check("book_count reflects the actual merged length", result.book_count === 2);
  check("newest source label wins", result.source === "goodreads-export (browser)");
}

console.log("\n7. Fields an importer never sets (library name, groups) survive a re-import");
{
  // Regression test: an early version of mergeLibraryData spread ONLY
  // `incoming` for top-level metadata, which silently dropped anything
  // that only ever lived on `existing` — the user's library name and
  // their series/collections (lib/groups.ts) chief among them, since no
  // importer output ever sets either. A second import used to wipe them.
  const existing = {
    name: "Andre's Library",
    groups: [{ id: "g1", type: "collection", name: "Favorites", bookKeys: [], createdAt: "t", updatedAt: "t" }],
    books: [{ Title: "A", Attribution: "X", highlights: [] }]
  };
  const incoming = { source: "goodreads-export (browser)", books: [{ Title: "B", Attribution: "Y", highlights: [] }] };
  const result = mergeLibraryData(existing as any, incoming as any);
  check("library name survives a re-import", result.name === "Andre's Library");
  check("groups survive a re-import", Array.isArray(result.groups) && result.groups.length === 1);
  check("incoming's own fields still present (newest wins isn't broken)", result.source === "goodreads-export (browser)");
}

console.log("\n8. A book's own app-managed fields (_order) survive being merged, not just the library's");
{
  // Same class of bug as test 7, one level down: mergeBookPair used to
  // spread ONLY `incomingBook` as its base, so a matched book's `_order`
  // (lib/libraryOrder.ts's manual position — never set by an importer)
  // would vanish the moment that book got merged a second time.
  const existing = { Title: "Dune", Attribution: "Frank Herbert", _order: 3, highlights: [] };
  const incoming = { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 2, highlights: [] };
  const merged = mergeBookLists([existing], [incoming]) as any[];
  check("_order survives being matched and merged", merged[0]._order === 3);
  check("incoming's own fields still win (newest wins isn't broken)", merged[0].ReadStatus === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
