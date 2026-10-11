import assert from "node:assert/strict";
import { test } from "node:test";
import { bookStatsModel, tierBand, tierLetter, type BookStats } from "./bookStats.js";

const full: BookStats = {
  community: { average: 3.8, count: 12, distribution: [1, 0, 2, 6, 3] },
  tiers: { score: 0.31, letter: "B", lists: 4, ballots: 23 },
  tournaments: { entered: 3, titles: 1, wins: 7, losses: 2, best: { round: 3, duels: 1 } }
};
const openLibrary = { value: 4.12, count: 2310 };

test("tier letters split the range into five equal bands", () => {
  assert.deepEqual([0, 0.19, 0.2, 0.39, 0.4, 0.6, 0.8, 0.99, 1].map(tierLetter), ["S", "S", "A", "A", "B", "C", "D", "D", "D"]);
});

test("the ratings section has an Open Library line, a feeling and a summary", () => {
  const { ratings } = bookStatsModel(full, openLibrary);
  assert.equal(ratings.openLibrary, "★ 4.1 · 2.3K ratings on Open Library");
  assert.equal(ratings.community!.feeling, "Loved it");
  assert.equal(ratings.community!.summary, "3.8 average · 12 ratings");
  assert.equal(ratings.empty, null);
});

test("the average is rounded once, so the tile, summary and feeling agree", () => {
  const model = bookStatsModel({ community: { average: 3.45, count: 4, distribution: [0, 0, 2, 2, 0] }, tiers: null, tournaments: null }, null);
  assert.deepEqual(model.tiles, [{ key: "community", value: "3.5", caption: "Loved it" }]);
  assert.equal(model.ratings.community!.feeling, "Loved it");
  assert.equal(model.ratings.community!.summary, "3.5 average · 4 ratings");
});

test("the Open Library count is abbreviated without Intl", () => {
  const line = (count: number) => bookStatsModel(null, { value: 4, count }).ratings.openLibrary;
  assert.equal(line(999), "★ 4.0 · 999 ratings on Open Library");
  assert.equal(line(1000), "★ 4.0 · 1K ratings on Open Library");
  assert.equal(line(2310), "★ 4.0 · 2.3K ratings on Open Library");
  assert.equal(line(999_960), "★ 4.0 · 1M ratings on Open Library");
  assert.equal(line(1_250_000), "★ 4.0 · 1.3M ratings on Open Library");
});

test("every empty section explains itself", () => {
  const model = bookStatsModel({ community: null, tiers: null, tournaments: null }, null);
  assert.equal(model.ratings.openLibrary, null);
  assert.equal(model.ratings.community, null);
  assert.equal(model.ratings.empty, "Shown once 3 readers have rated it.");
  assert.equal(model.tiersEmpty, "Shown once 3 people have voted on it in tier lists.");
  assert.equal(model.tournamentsEmpty, "Not in any tournament yet.");
});

test("tier bands split the range into five equal parts", () => {
  assert.deepEqual([0, 0.19, 0.2, 0.4, 0.6, 0.8, 1].map(tierBand), ["Top tier", "Top tier", "Upper tiers", "Middle", "Lower tiers", "Bottom tier", "Bottom tier"]);
});

test("tiles: big value and caption for each stat that exists", () => {
  assert.deepEqual(bookStatsModel(full, openLibrary).tiles, [
    { key: "community", value: "3.8", caption: "Loved it" },
    { key: "tiers", value: "Upper", caption: "tiers · 4 lists" },
    { key: "tournaments", value: "🏆", caption: "Winner" }
  ]);
});

test("tile captions follow the band and the counts", () => {
  const tile = (score: number, lists: number) => bookStatsModel({ community: null, tiers: { score, letter: "S", lists, ballots: 3 }, tournaments: null }, null).tiles[0];
  assert.deepEqual(tile(0, 1), { key: "tiers", value: "Top", caption: "tier · 1 list" });
  assert.deepEqual(tile(0.5, 2), { key: "tiers", value: "Middle", caption: "2 lists" });
  assert.deepEqual(tile(0.9, 3), { key: "tiers", value: "Bottom", caption: "tier · 3 lists" });
  const run = (best: { round: number; duels: number } | null) => bookStatsModel({ community: null, tiers: null, tournaments: { entered: 1, titles: 0, wins: 0, losses: 0, best } }, null).tiles[0];
  assert.deepEqual(run({ round: 2, duels: 2 }), { key: "tournaments", value: "🏆", caption: "Semis" });
  assert.deepEqual(run(null), { key: "tournaments", value: "🏆", caption: "Entered" });
  assert.deepEqual(bookStatsModel(null, openLibrary).tiles, []);
});

test("feeling columns run from Not for me to All-time and mark the tallest", () => {
  const { columns } = bookStatsModel(full, openLibrary).ratings.community!;
  assert.deepEqual(columns.map((c) => [c.label, c.count, c.top]), [["Not for me", 1, false], ["Fine", 0, false], ["Good", 2, false], ["Loved it", 6, true], ["All-time", 3, false]]);
  assert.equal(columns[3]!.fraction, 1);
  const tied = bookStatsModel({ community: { average: 3, count: 4, distribution: [2, 0, 0, 2, 0] }, tiers: null, tournaments: null }, null).ratings.community!.columns;
  assert.deepEqual(tied.map((c) => c.top), [true, false, false, true, false]);
});

test("tier bar carries the band, a marker at the score and the summary", () => {
  assert.deepEqual(bookStatsModel(full, null).tierBar, { band: "Upper tiers", marker: 0.31, summary: "Across 4 published tier lists · 23 votes" });
  assert.equal(bookStatsModel({ community: null, tiers: null, tournaments: null }, null).tierBar, null);
});

test("tournament path walks the best run from round 1 to the final", () => {
  const run = (titles: number, best: { round: number; duels: number } | null, entered = 1, wins = 2, losses = 1) =>
    bookStatsModel({ community: null, tiers: null, tournaments: { entered, titles, wins, losses, best } }, null).tournamentRun;
  assert.deepEqual(run(0, { round: 2, duels: 2 })!.path, [{ label: "Quarters", reached: true }, { label: "Semis", reached: true }, { label: "Final", reached: false }]);
  assert.deepEqual(run(0, { round: 1, duels: 2 })!.path, [{ label: "Semis", reached: true }, { label: "Final", reached: false }]);
  const won = run(1, { round: 6, duels: 1 }, 2, 6, 1)!;
  assert.deepEqual(won.path.map((s) => s.label), ["Round 1", "Round 2", "Round 3", "Quarters", "Semis", "Final"]);
  assert.ok(won.path.every((s) => s.reached));
  assert.equal(won.champion, true);
  assert.equal(won.summary, "2 tournaments · 6 won, 1 lost · 1 title");
  assert.deepEqual(run(0, null, 1, 0, 0), { path: [], champion: false, summary: "1 tournament · 0 won, 0 lost · 0 titles" });
});
