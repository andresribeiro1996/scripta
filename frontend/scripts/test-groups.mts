// Exercises lib/groups.ts's removeBooksFromAllGroups() — the scrub step
// that runs alongside actually deleting one or more books (see the
// select-mode bulk-delete flow's handleDeleteSelected in
// LibraryPage.tsx/GroupsPage.tsx), so a deleted book doesn't linger as a
// dangling key in any series/collection.
// Run with:
//   npx tsx scripts/test-groups.mts

import { removeBooksFromAllGroups } from "../src/lib/groups";
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

console.log("1. removeBooksFromAllGroups — scrubs a single key out of every group that had it");
{
  const groups = [
    group({ type: "series", name: "S1", bookKeys: ["ta:deleted|a", "ta:kept|a"] }),
    group({ type: "collection", name: "C1", bookKeys: ["ta:deleted|a"] }),
    group({ type: "collection", name: "C2", bookKeys: ["ta:unrelated|b"] })
  ];
  const result = removeBooksFromAllGroups(groups, ["ta:deleted|a"]);
  check("removed from S1, kept books.length still 1 (the other member survives)", result[0].bookKeys.length === 1 && result[0].bookKeys[0] === "ta:kept|a");
  check("removed from C1, now empty", result[1].bookKeys.length === 0);
  check("C2 untouched (never had the key)", result[2].bookKeys.length === 1 && result[2].bookKeys[0] === "ta:unrelated|b");
}

console.log("\n2. removeBooksFromAllGroups — a no-op when nothing has any of the keys");
{
  const groups = [group({ type: "collection", name: "C1", bookKeys: ["ta:someone-else|a"] })];
  const result = removeBooksFromAllGroups(groups, ["ta:not-in-any-group|z"]);
  check("bookKeys unchanged", result[0].bookKeys.length === 1 && result[0].bookKeys[0] === "ta:someone-else|a");
}

console.log("\n3. removeBooksFromAllGroups — true batch: multiple keys removed from multiple groups in one call");
{
  const groups = [
    group({ type: "series", name: "S1", bookKeys: ["ta:a|1", "ta:b|1", "ta:c|1"] }),
    group({ type: "collection", name: "C1", bookKeys: ["ta:b|1", "ta:d|1"] }),
    group({ type: "collection", name: "C2", bookKeys: ["ta:d|1"] })
  ];
  const result = removeBooksFromAllGroups(groups, new Set(["ta:a|1", "ta:b|1"]));
  check("S1 keeps only the one book not in the deleted set", result[0].bookKeys.length === 1 && result[0].bookKeys[0] === "ta:c|1");
  check("C1 keeps only the untouched book", result[1].bookKeys.length === 1 && result[1].bookKeys[0] === "ta:d|1");
  check("C2 (no overlap with the deleted set) untouched", result[2].bookKeys.length === 1 && result[2].bookKeys[0] === "ta:d|1");
}

console.log("\n4. removeBooksFromAllGroups — empty key set is a true no-op (same array reference back)");
{
  const groups = [group({ type: "collection", name: "C1", bookKeys: ["ta:a|1"] })];
  const result = removeBooksFromAllGroups(groups, []);
  check("returns the same groups array unchanged", result === groups);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
