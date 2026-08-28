// Exercises lib/libraryOrder.ts's pure functions directly against
// synthetic scenarios — not a permanent test suite, just a one-off
// verification script for the Library grid's clustering/ordering/drag-to-
// reorder feature. Run with:
//   npx tsx scripts/test-library-order.mts

import { assignBookOrder, orderLibraryBooks, reorderOnDrop, seriesGroupByBookKey } from "../src/lib/libraryOrder";
import type { Group } from "../src/lib/groups";

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

function group(partial: Partial<Group> & Pick<Group, "type" | "name" | "bookKeys">): Group {
  return { id: partial.name, createdAt: "t", updatedAt: "t", ...partial };
}

console.log("1. assignBookOrder — fills in only what's missing, in incoming order");
{
  const books = [
    { Title: "Has one already", _order: 5 },
    { Title: "New book A" },
    { Title: "New book B" }
  ];
  const result = assignBookOrder(books as any) as any[];
  check("existing _order untouched", result[0]._order === 5);
  check("new books appended after the max, in order", result[1]._order === 6 && result[2]._order === 7);
}

console.log("\n2. assignBookOrder — first import (nothing has an _order yet) numbers from 0");
{
  const books = [{ Title: "A" }, { Title: "B" }, { Title: "C" }];
  const result = assignBookOrder(books as any) as any[];
  check("sequential from 0", result.map((b) => b._order).join(",") === "0,1,2");
}

console.log("\n3. orderLibraryBooks — a series clusters together, ahead of standalone books");
{
  const books = [
    { Title: "Standalone Early", Attribution: "X", _order: 0 },
    { Title: "Series Book B", Attribution: "Y", Series: "S", SeriesNumber: 2, _order: 1 },
    { Title: "Standalone Late", Attribution: "Z", _order: 2 },
    { Title: "Series Book A", Attribution: "Y", Series: "S", SeriesNumber: 1, _order: 3 }
  ];
  const groups = [group({ type: "series", name: "S", bookKeys: ["ta:series book b|y", "ta:series book a|y"] })];
  const result = orderLibraryBooks(books as any, groups) as any[];
  check(
    "series cluster comes first (both series books ahead of both standalone ones), ordered by SeriesNumber within it",
    result.map((b) => b.Title).join(",") === "Series Book A,Series Book B,Standalone Early,Standalone Late",
    result.map((b: any) => b.Title).join(",")
  );
}

console.log("\n4. orderLibraryBooks — standalone books sorted by _order");
{
  const books = [
    { Title: "Third", Attribution: "A", _order: 2 },
    { Title: "First", Attribution: "A", _order: 0 },
    { Title: "Second", Attribution: "A", _order: 1 }
  ];
  const result = orderLibraryBooks(books as any, []) as any[];
  check("sorted by _order, not array position", result.map((b) => b.Title).join(",") === "First,Second,Third");
}

console.log("\n5. orderLibraryBooks — multiple series clusters ordered by earliest member's _order");
{
  const books = [
    { Title: "Late Series Book", Attribution: "A", _order: 5 },
    { Title: "Early Series Book", Attribution: "B", _order: 0 }
  ];
  const groups = [
    group({ type: "series", name: "Late Series", bookKeys: ["ta:late series book|a"] }),
    group({ type: "series", name: "Early Series", bookKeys: ["ta:early series book|b"] })
  ];
  const result = orderLibraryBooks(books as any, groups) as any[];
  check(
    "the cluster whose earliest member has the lower _order comes first",
    result.map((b) => b.Title).join(",") === "Early Series Book,Late Series Book"
  );
}

console.log("\n6. orderLibraryBooks — a book in two different series is placed once, in the earlier cluster");
{
  const books = [{ Title: "Shared Book", Attribution: "A", _order: 0 }];
  const groups = [
    group({ type: "series", name: "Series X", bookKeys: ["ta:shared book|a"] }),
    group({ type: "series", name: "Series Y", bookKeys: ["ta:shared book|a"] })
  ];
  const result = orderLibraryBooks(books as any, groups) as any[];
  check("appears exactly once", result.length === 1);
}

console.log("\n7. orderLibraryBooks — collections never cluster books; only series do");
{
  const books = [
    { Title: "Collected Book", Attribution: "A", _order: 3 },
    { Title: "Uncollected Early Book", Attribution: "B", _order: 0 }
  ];
  // A non-empty collection with two would-be members, but only one of the
  // two books actually exists here — the point is collections shouldn't
  // form a cluster block at all, regardless.
  const groups = [group({ type: "collection", name: "Favorites", bookKeys: ["ta:collected book|a"] })];
  const result = orderLibraryBooks(books as any, groups) as any[];
  check(
    "sorted purely by _order, as if the collection didn't exist",
    result.map((b) => b.Title).join(",") === "Uncollected Early Book,Collected Book",
    result.map((b: any) => b.Title).join(",")
  );
}

console.log("\n8. orderLibraryBooks — an empty series group (all members removed) contributes nothing");
{
  const books = [{ Title: "Solo", Attribution: "A", _order: 0 }];
  const groups = [group({ type: "series", name: "Stale", bookKeys: ["ta:no longer in library|nobody"] })];
  const result = orderLibraryBooks(books as any, groups) as any[];
  check("the standalone book still renders", result.length === 1 && result[0].Title === "Solo");
}

console.log("\n9. reorderOnDrop — dragging a standalone book onto another moves just that book, ahead of the target");
{
  const books = [
    { Title: "A", Attribution: "X", _order: 0 },
    { Title: "B", Attribution: "X", _order: 1 },
    { Title: "C", Attribution: "X", _order: 2 }
  ];
  // Drag C onto A — C should end up immediately before A.
  const result = reorderOnDrop(books as any, [], "ta:c|x", "ta:a|x") as any[];
  const displayed = orderLibraryBooks(result, []) as any[];
  check("new order is C, A, B", displayed.map((b) => b.Title).join(",") === "C,A,B", displayed.map((b: any) => b.Title).join(","));
}

console.log("\n10. reorderOnDrop — dragging a book that's in a series moves the WHOLE series");
{
  // reorderOnDrop fully renumbers _order from the new flat sequence (0..n-1)
  // rather than preserving old magnitudes, so this checks relative order
  // (Book1 < Book2 < Standalone), not exact values.
  const books = [
    { Title: "Series1 Book1", Attribution: "A", Series: "S1", SeriesNumber: 1, _order: 0 },
    { Title: "Series1 Book2", Attribution: "A", Series: "S1", SeriesNumber: 2, _order: 1 },
    { Title: "Standalone", Attribution: "B", _order: 2 }
  ];
  const groups = [group({ type: "series", name: "S1", bookKeys: ["ta:series1 book1|a", "ta:series1 book2|a"] })];
  // Drag the SECOND book of the series onto the standalone book — the
  // whole series (both books, still SeriesNumber-ordered) should move,
  // not just the one card that was actually dragged.
  const result = reorderOnDrop(books as any, groups, "ta:series1 book2|a", "ta:standalone|b") as any[];
  const byTitle = new Map(result.map((b: any) => [b.Title, b._order]));
  check(
    "both series books end up ahead of Standalone's _order (moved together as a unit)",
    byTitle.get("Series1 Book1")! < byTitle.get("Standalone")! && byTitle.get("Series1 Book2")! < byTitle.get("Standalone")!,
    JSON.stringify(Object.fromEntries(byTitle))
  );
  const displayed = orderLibraryBooks(result, groups) as any[];
  check(
    "still displays as: both series books (SeriesNumber order), then Standalone",
    displayed.map((b) => b.Title).join(",") === "Series1 Book1,Series1 Book2,Standalone",
    displayed.map((b: any) => b.Title).join(",")
  );
}

console.log("\n11. reorderOnDrop — dropping onto a card in the same unit is a no-op");
{
  const books = [
    { Title: "S Book1", Attribution: "A", Series: "S", SeriesNumber: 1, _order: 0 },
    { Title: "S Book2", Attribution: "A", Series: "S", SeriesNumber: 2, _order: 1 }
  ];
  const groups = [group({ type: "series", name: "S", bookKeys: ["ta:s book1|a", "ta:s book2|a"] })];
  const result = reorderOnDrop(books as any, groups, "ta:s book1|a", "ta:s book2|a");
  check("returns the exact same array reference (no-op)", result === (books as any));
}

console.log("\n12. reorderOnDrop — dropping a card onto itself is a no-op");
{
  const books = [{ Title: "A", Attribution: "X", _order: 0 }];
  const result = reorderOnDrop(books as any, [], "ta:a|x", "ta:a|x");
  check("returns the exact same array reference (no-op)", result === (books as any));
}

console.log("\n13. reorderOnDrop — collection membership has zero effect on what moves");
{
  const books = [
    { Title: "A", Attribution: "X", _order: 0 },
    { Title: "B", Attribution: "X", _order: 1 },
    { Title: "C", Attribution: "X", _order: 2 }
  ];
  // A and C are in the same collection. If collections formed a movable
  // unit the way series do, dragging A onto C would be a same-unit
  // no-op (both already "belong together"). They shouldn't — A should
  // move on its own, landing right before C, same as any standalone drag.
  const groups = [group({ type: "collection", name: "Favorites", bookKeys: ["ta:a|x", "ta:c|x"] })];
  const result = reorderOnDrop(books as any, groups, "ta:a|x", "ta:c|x") as any[];
  const displayed = orderLibraryBooks(result, groups) as any[];
  check("new order is B, A, C — only A moved, not treated as a same-unit no-op", displayed.map((b) => b.Title).join(",") === "B,A,C", displayed.map((b: any) => b.Title).join(","));
}

console.log("\n14. reorderOnDrop — dropping one series onto a card in a different series places it entirely before that series");
{
  const books = [
    { Title: "S1 Book", Attribution: "A", Series: "S1", SeriesNumber: 1, _order: 0 },
    { Title: "S2 Book1", Attribution: "B", Series: "S2", SeriesNumber: 1, _order: 1 },
    { Title: "S2 Book2", Attribution: "B", Series: "S2", SeriesNumber: 2, _order: 2 }
  ];
  const groups = [
    group({ type: "series", name: "S1", bookKeys: ["ta:s1 book|a"] }),
    group({ type: "series", name: "S2", bookKeys: ["ta:s2 book1|b", "ta:s2 book2|b"] })
  ];
  // Drag S1's only book onto S2's second book.
  const result = reorderOnDrop(books as any, groups, "ta:s1 book|a", "ta:s2 book2|b") as any[];
  const displayed = orderLibraryBooks(result, groups) as any[];
  check(
    "S1 ends up entirely ahead of all of S2, S2 stays intact and SeriesNumber-ordered",
    displayed.map((b) => b.Title).join(",") === "S1 Book,S2 Book1,S2 Book2",
    displayed.map((b: any) => b.Title).join(",")
  );
}

console.log("\n15. seriesGroupByBookKey — used for per-series style priority (lib/libraryStyle.ts's effectiveCardStyle)");
{
  const books = [
    { Title: "S1 Book", Attribution: "A", Series: "S1", SeriesNumber: 1, _order: 0 },
    { Title: "Standalone", Attribution: "B", _order: 1 }
  ];
  const s1 = group({ type: "series", name: "S1", bookKeys: ["ta:s1 book|a"] });
  const collection = group({ type: "collection", name: "Favorites", bookKeys: ["ta:standalone|b"] });
  const map = seriesGroupByBookKey(books as any, [s1, collection]);
  check("a book in a series maps to that series' group", map.get("ta:s1 book|a") === s1);
  check("a book only in a collection has no entry (collections don't affect style priority)", !map.has("ta:standalone|b"));
  check("map size matches only the series-clustered books", map.size === 1);
}

console.log("\n16. seriesGroupByBookKey — agrees with orderLibraryBooks() on which series a shared book belongs to");
{
  // Same "book in two series" scenario as test 6 — the style-priority
  // lookup has to resolve to the SAME series the book is actually
  // displayed under, or a card could visually sit in one series' block
  // while rendering with a different series' style.
  const books = [{ Title: "Shared Book", Attribution: "A", _order: 0 }];
  const groups = [
    group({ type: "series", name: "Series X", bookKeys: ["ta:shared book|a"] }),
    group({ type: "series", name: "Series Y", bookKeys: ["ta:shared book|a"] })
  ];
  const displayed = orderLibraryBooks(books as any, groups) as any[];
  const map = seriesGroupByBookKey(books as any, groups);
  check(
    "the group in the style map is the same one the book actually displays under",
    map.get("ta:shared book|a")?.name === "Series X" && displayed.length === 1
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
