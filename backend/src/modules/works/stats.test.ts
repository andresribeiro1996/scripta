import assert from "node:assert/strict";
import { test } from "node:test";
import { createBookStatsService, type BookStatsDeps } from "./stats.js";

const none = { entered: 0, titles: 0, wins: 0, losses: 0, best: null };
function deps(overrides: Partial<BookStatsDeps> = {}): BookStatsDeps {
  return {
    getWorkPage: (id) => (id === "w" || id === "old" ? { aliasIds: ["w", "old"] } : undefined),
    communityRatings: () => [],
    tierPlacements: () => [],
    tournamentRecord: () => none,
    ...overrides
  };
}
const stats = (overrides: Partial<BookStatsDeps> = {}, id = "w") => createBookStatsService(deps(overrides)).getStats(id);

test("an unknown work has no stats; a merged-away id asks for the canonical aliases", () => {
  assert.equal(stats({}, "nope"), undefined);
  const seen: string[][] = [];
  stats({ communityRatings: (ids) => { seen.push(ids); return []; } }, "old");
  assert.deepEqual(seen, [["w", "old"]]);
});

test("community rating needs three ratings and reports average and distribution", () => {
  const two = [{ userId: "a", rating: 4 }, { userId: "b", rating: 5 }];
  assert.equal(stats({ communityRatings: () => two })!.community, null);
  assert.deepEqual(stats({ communityRatings: () => [...two, { userId: "c", rating: 1 }] })!.community, { average: 10 / 3, count: 3, distribution: [1, 0, 0, 1, 1] });
});

test("tiers need three placements, skip one-tier lists and weigh lists equally", () => {
  const busy = Array.from({ length: 10 }, () => ({ tierlistId: "busy", tierIndex: 0, tierCount: 5, ranksWorstFirst: false }));
  const quiet = [{ tierlistId: "quiet", tierIndex: 4, tierCount: 5, ranksWorstFirst: false }];
  const tiny = [{ tierlistId: "tiny", tierIndex: 0, tierCount: 1, ranksWorstFirst: false }, { tierlistId: "tiny", tierIndex: 0, tierCount: 1, ranksWorstFirst: false }];
  assert.equal(stats({ tierPlacements: () => [...quiet, ...tiny] })!.tiers, null);
  assert.deepEqual(stats({ tierPlacements: () => [...busy, ...quiet, ...tiny] })!.tiers, { score: 0.5, letter: "B", lists: 2, ballots: 11 });
});

test("tournaments are null when never entered and passed through otherwise", () => {
  assert.equal(stats()!.tournaments, null);
  const record = { entered: 2, titles: 1, wins: 3, losses: 1, best: { round: 2, duels: 1 } };
  assert.deepEqual(stats({ tournamentRecord: () => record })!.tournaments, record);
});

test("a worst-first list's top tier counts as the bottom", () => {
  const worst = Array.from({ length: 3 }, () => ({ tierlistId: "worst", tierIndex: 0, tierCount: 5, ranksWorstFirst: true }));
  assert.equal(stats({ tierPlacements: () => worst })!.tiers!.score, 1);
  const mixed = [...worst, ...Array.from({ length: 3 }, () => ({ tierlistId: "best", tierIndex: 0, tierCount: 5, ranksWorstFirst: false }))];
  assert.equal(stats({ tierPlacements: () => mixed })!.tiers!.score, 0.5);
});
