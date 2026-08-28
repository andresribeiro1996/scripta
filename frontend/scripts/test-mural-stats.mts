// Exercises lib/muralStats.ts's computeStat() — the `stats` mural
// block's live-computed numbers.
// Run with:
//   npx tsx scripts/test-mural-stats.mts

import { computeStat } from "../src/lib/muralStats";

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

const NOW = new Date("2026-08-25T12:00:00Z");

const books = [
  { Title: "Finished this year", ReadStatus: 2, DateLastRead: "2026-03-01T00:00:00Z", highlights: [{ BookmarkID: "1" }, { BookmarkID: "2" }] },
  { Title: "Finished last year", ReadStatus: 2, DateLastRead: "2025-11-01T00:00:00Z", highlights: [] },
  { Title: "In progress", ReadStatus: 1, highlights: [{ BookmarkID: "3" }] },
  { Title: "Unread", ReadStatus: 0, highlights: [] },
  { Title: "Finished, no date on it", ReadStatus: 2, highlights: [] } // missing DateLastRead — shouldn't crash or count as "this year"
];

console.log("computeStat — each metric");
check("totalBooks counts everything", computeStat("totalBooks", books, NOW) === 5);
check("booksFinished counts ReadStatus === 2 regardless of date", computeStat("booksFinished", books, NOW) === 3);
check("booksFinishedThisYear only counts the one matching NOW's year, ignores the undated finished book", computeStat("booksFinishedThisYear", books, NOW) === 1);
check("booksInProgress counts ReadStatus === 1", computeStat("booksInProgress", books, NOW) === 1);
check("totalHighlights sums highlights across every book", computeStat("totalHighlights", books, NOW) === 3);

console.log("\ncomputeStat — empty library doesn't crash, everything is 0");
for (const metric of ["totalBooks", "booksFinished", "booksFinishedThisYear", "booksInProgress", "totalHighlights"] as const) {
  check(`${metric} === 0 for an empty library`, computeStat(metric, [], NOW) === 0);
}

console.log("\ncomputeStat — a book with a garbage DateLastRead doesn't crash or count as 'this year'");
{
  const garbage = [{ Title: "Bad date", ReadStatus: 2, DateLastRead: "not-a-real-date" }];
  check("garbage date doesn't count as finished this year", computeStat("booksFinishedThisYear", garbage, NOW) === 0);
  check("still counts as finished overall", computeStat("booksFinished", garbage, NOW) === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
