// Exercises lib/arenaBracket.ts — mainly a guard against a real bug the
// bracket view shipped with: it derived its layout from the duels that
// existed, but the backend generates duels ONE ROUND AT A TIME (the
// arena service's `start` inserts round 1, `advanceRound` inserts the
// next as each settles). So during round 1 of a 16-book tournament the
// "bracket" was a single row of 8, and it only looked like a bracket
// once the tournament was nearly over — the shape being the only reason
// to draw a bracket rather than a list. Run with:
//   npx tsx scripts/test-arena-bracket.mts

import type { Duel } from "../src/api/arena.ts";
import { bracketShape, needsVote, sharePercent } from "../src/lib/arenaBracket.ts";

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

function duel(roundNumber: number, duelIndex: number, over: Partial<Duel> = {}): Duel {
  return {
    id: `${roundNumber}-${duelIndex}`,
    roundNumber,
    duelIndex,
    bookA: { key: "a", title: "A", author: "AA", cover: null, votes: 0 },
    bookB: { key: "b", title: "B", author: "BB", cover: null, votes: 0 },
    winnerKey: null,
    status: "active",
    opensAt: "2026-01-01T00:00:00.000Z",
    closesAt: "2026-01-02T00:00:00.000Z",
    hasVoted: false,
    ...over
  };
}

/** Every duel the backend would have created through `throughRound`. */
function duelsThrough(bracketSize: number, throughRound: number): Duel[] {
  const out: Duel[] = [];
  for (let r = 1; r <= throughRound; r++) {
    for (let i = 0; i < bracketSize / 2 ** r; i++) out.push(duel(r, i));
  }
  return out;
}

const shapeOf = (rows: ReturnType<typeof bracketShape>) => rows.map((r) => r.length);
const filledOf = (rows: ReturnType<typeof bracketShape>) => rows.map((r) => r.filter(Boolean).length);

console.log("1. The shape is complete from the first round, not just at the end");
{
  for (let through = 1; through <= 4; through++) {
    const shape = shapeOf(bracketShape(16, duelsThrough(16, through)));
    check(
      `16 books, ${through} round(s) generated: still 8/4/2/1`,
      JSON.stringify(shape) === JSON.stringify([8, 4, 2, 1]),
      JSON.stringify(shape)
    );
  }
  check(
    "a started tournament with no duels at all still has its full shape",
    JSON.stringify(shapeOf(bracketShape(16, []))) === JSON.stringify([8, 4, 2, 1])
  );
}

console.log("\n2. Ungenerated positions are null, and fill in as rounds are played");
{
  const expected = [
    [8, 0, 0, 0],
    [8, 4, 0, 0],
    [8, 4, 2, 0],
    [8, 4, 2, 1]
  ];
  for (let through = 1; through <= 4; through++) {
    const filled = filledOf(bracketShape(16, duelsThrough(16, through)));
    check(
      `after round ${through}: ${expected[through - 1]!.join("/")} real matches`,
      JSON.stringify(filled) === JSON.stringify(expected[through - 1]),
      JSON.stringify(filled)
    );
  }
}

console.log("\n3. Positions map to their own duel, not merely to a count");
{
  const rows = bracketShape(8, [duel(1, 2), duel(2, 0)]);
  check("round 1 slot 2 holds its duel", rows[0]![2]?.id === "1-2");
  check("round 1 slot 0 is empty", rows[0]![0] === null);
  check("round 2 slot 0 holds its duel", rows[1]![0]?.id === "2-0");
  check("round 2 slot 1 is empty", rows[1]![1] === null);
  check("the final is present but empty", rows[2]!.length === 1 && rows[2]![0] === null);
}

console.log("\n4. Every bracket size the service allows");
{
  check("2 books is a final and nothing else", JSON.stringify(shapeOf(bracketShape(2, []))) === JSON.stringify([1]));
  check("4 books", JSON.stringify(shapeOf(bracketShape(4, []))) === JSON.stringify([2, 1]));
  check("8 books", JSON.stringify(shapeOf(bracketShape(8, []))) === JSON.stringify([4, 2, 1]));
  check("32 books", JSON.stringify(shapeOf(bracketShape(32, []))) === JSON.stringify([16, 8, 4, 2, 1]));
  check("64 books", JSON.stringify(shapeOf(bracketShape(64, []))) === JSON.stringify([32, 16, 8, 4, 2, 1]));
  // Each round must halve cleanly down to exactly one final, or the
  // two-sided layout can't mirror and the connectors have nothing to
  // meet on.
  for (const size of [2, 4, 8, 16, 32, 64]) {
    const rows = bracketShape(size, []);
    check(
      `${size} books: rounds halve down to a single final`,
      rows.at(-1)!.length === 1 && rows.every((r, i) => i === 0 || r.length === rows[i - 1]!.length / 2)
    );
  }
}

console.log("\n5. A bracket size that can't halve falls back instead of rendering nonsense");
{
  // The service rejects these at creation (InvalidBracketSizeError), so
  // this is unreachable through the app — but hand-edited data must not
  // produce a skeleton whose rounds never reach a final.
  const rows = bracketShape(6, [duel(1, 0), duel(1, 1)]);
  check("bracketSize 6 falls back to the duels that exist", JSON.stringify(shapeOf(rows)) === JSON.stringify([2]), JSON.stringify(shapeOf(rows)));
  check("and keeps them in duelIndex order", rows[0]![0]?.id === "1-0" && rows[0]![1]?.id === "1-1");
}

console.log("\n6. needsVote marks only live matches this viewer hasn't voted in");
{
  check("active and unvoted", needsVote(duel(1, 0)));
  check("active but already voted", !needsVote(duel(1, 0, { hasVoted: true })));
  check("settled", !needsVote(duel(1, 0, { status: "settled", winnerKey: "a" })));
  check("awaiting a tiebreak is the owner's job, not a vote", !needsVote(duel(1, 0, { status: "tied_pending_tiebreak" })));
}

console.log("\n7. sharePercent is null before any vote, never 0%");
{
  const untouched = duel(1, 0);
  check("no votes at all -> null, not 0", sharePercent(untouched.bookA.votes, untouched) === null);

  const split = duel(1, 0, {
    bookA: { key: "a", title: "A", author: "AA", cover: null, votes: 3 },
    bookB: { key: "b", title: "B", author: "BB", cover: null, votes: 1 }
  });
  check("3 of 4 -> 75", sharePercent(split.bookA.votes, split) === 75);
  check("1 of 4 -> 25", sharePercent(split.bookB.votes, split) === 25);

  // A real 0 — the side genuinely got none — must still read as 0%,
  // which is the case null is carefully NOT conflated with.
  const shutout = duel(1, 0, {
    bookA: { key: "a", title: "A", author: "AA", cover: null, votes: 5 },
    bookB: { key: "b", title: "B", author: "BB", cover: null, votes: 0 }
  });
  check("a side that genuinely got none -> 0, not null", sharePercent(shutout.bookB.votes, shutout) === 0);
  check("shares of a decided match still total 100", sharePercent(shutout.bookA.votes, shutout) === 100);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
