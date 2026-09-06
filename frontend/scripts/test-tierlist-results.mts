import { aggregate, toPlacements, type HistogramCell } from "../src/lib/tierlistResults";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

const TIERS = ["s", "a", "b"];
const POOL = ["b1", "b2", "b3"];

function cells(...entries: Array<[string, string, number]>): HistogramCell[] {
  return entries.map(([bookKey, tierId, votes]) => ({ bookKey, tierId, votes }));
}

console.log("\n1. Average");
{
  // 2 votes at S (0), 2 at B (2) → mean 1.0 → A
  const results = aggregate(cells(["b1", "s", 2], ["b1", "b", 2]), TIERS, POOL, "average");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  check("mean of 0,0,2,2 lands on the middle tier", b1.tierId === "a");
  check("score is the raw mean", b1.score === 1);
  check("votes counts every ballot that ranked it", b1.votes === 4);
  check("nobody is in the winning tier, so spread is 1", b1.spread === 1);
}

console.log("\n2. Average ties break toward the higher tier");
{
  // 1 vote at S (0), 1 at A (1) → mean 0.5 → tie between S and A → S
  const results = aggregate(cells(["b1", "s", 1], ["b1", "a", 1]), TIERS, POOL, "average");
  check("0.5 rounds to S, not A", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n3. Plurality");
{
  const results = aggregate(cells(["b1", "s", 2], ["b1", "a", 3]), TIERS, POOL, "plurality");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  check("the most-voted tier wins even against a better mean", b1.tierId === "a");
  check("spread is the share outside the winning tier", Math.abs(b1.spread - 2 / 5) < 1e-9);
}

console.log("\n4. Plurality ties break toward the higher tier");
{
  const results = aggregate(cells(["b1", "s", 2], ["b1", "b", 2]), TIERS, POOL, "plurality");
  check("an even split picks S", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n5. Median");
{
  // votes: s,s,s,b,b → 5 votes, 3rd is S
  const results = aggregate(cells(["b1", "s", 3], ["b1", "b", 2]), TIERS, POOL, "median");
  check("odd count takes the middle vote", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n6. Median ties break toward the higher tier");
{
  // votes: s,s,b,b → 4 votes, take the 2nd → S
  const results = aggregate(cells(["b1", "s", 2], ["b1", "b", 2]), TIERS, POOL, "median");
  check("an even split picks the higher tier", results.find((r) => r.bookKey === "b1")!.tierId === "s");
}

console.log("\n7. Single vote and no votes");
{
  const results = aggregate(cells(["b1", "a", 1]), TIERS, POOL, "average");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  const b2 = results.find((r) => r.bookKey === "b2")!;
  check("one vote is unanimous", b1.votes === 1 && b1.spread === 0 && b1.tierId === "a");
  check("an unranked book still appears", b2 !== undefined);
  check("an unranked book has no tier", b2.tierId === null && b2.score === null);
  check("an unranked book has zero votes", b2.votes === 0);
  check("every pool book is returned", results.length === 3);
}

console.log("\n8. Unknown tiers are ignored rather than crashing");
{
  const results = aggregate(cells(["b1", "ghost", 5], ["b1", "s", 1]), TIERS, POOL, "average");
  const b1 = results.find((r) => r.bookKey === "b1")!;
  check("a cell naming a deleted tier is dropped", b1.votes === 1 && b1.tierId === "s");
}

console.log("\n9. Ballot conversion");
{
  const placements = toPlacements({ tiers: [{ id: "s", bookKeys: ["b1", "b2"] }, { id: "a", bookKeys: [] }] });
  check("each placed book becomes one placement", placements.length === 2);
  check("placements carry their tier", placements[0]!.tierId === "s");
  check("an empty tier contributes nothing", placements.every((p) => p.tierId === "s"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
