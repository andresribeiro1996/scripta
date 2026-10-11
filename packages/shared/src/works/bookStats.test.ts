import assert from "node:assert/strict";
import { test } from "node:test";
import { bookStatsModel, tierLetter, type BookStats } from "./bookStats.js";

const full: BookStats = {
  community: { average: 3.8, count: 12, distribution: [1, 0, 2, 6, 3] },
  tiers: { score: 0.31, letter: "B", lists: 4, ballots: 23 },
  tournaments: { entered: 3, titles: 1, wins: 7, losses: 2, best: { round: 3, duels: 1 } }
};
const openLibrary = { value: 4.12, count: 2310 };

test("tier letters split the range into five equal bands", () => {
  assert.deepEqual([0, 0.19, 0.2, 0.39, 0.4, 0.6, 0.8, 0.99, 1].map(tierLetter), ["S", "S", "A", "A", "B", "C", "D", "D", "D"]);
});

test("the strip shows every stat that exists, in a fixed order", () => {
  assert.deepEqual(bookStatsModel(full, openLibrary).strip, [
    { key: "openLibrary", value: "★ 4.1", label: "Open Library" },
    { key: "community", value: "Loved it", label: "12 readers" },
    { key: "tiers", value: "B tier", label: "4 lists" },
    { key: "tournaments", value: "1 title", label: "3 tournaments" }
  ]);
});

test("while stats load, or with none, only Open Library shows", () => {
  assert.deepEqual(bookStatsModel(null, openLibrary).strip.map((cell) => cell.key), ["openLibrary"]);
  assert.deepEqual(bookStatsModel({ community: null, tiers: null, tournaments: null }, null).strip, []);
});

test("without a title the tournament cell names the best round, singular counts read singular", () => {
  const stats: BookStats = { community: { average: 1.4, count: 3, distribution: [2, 1, 0, 0, 0] }, tiers: { score: 0, letter: "S", lists: 1, ballots: 3 }, tournaments: { entered: 1, titles: 0, wins: 1, losses: 1, best: { round: 2, duels: 2 } } };
  assert.deepEqual(bookStatsModel(stats, null).strip, [
    { key: "community", value: "Not for me", label: "3 readers" },
    { key: "tiers", value: "S tier", label: "1 list" },
    { key: "tournaments", value: "Semis", label: "1 tournament" }
  ]);
});

test("the ratings section has an Open Library line, a feeling, a summary and bars from All-time down", () => {
  const { ratings } = bookStatsModel(full, openLibrary);
  assert.equal(ratings.openLibrary, "★ 4.1 · 2.3K ratings on Open Library");
  assert.equal(ratings.community!.feeling, "Loved it");
  assert.equal(ratings.community!.summary, "3.8 average · 12 ratings");
  assert.deepEqual(ratings.community!.bars.map((bar) => [bar.label, bar.count, bar.fraction]), [["All-time", 3, 0.5], ["Loved it", 6, 1], ["Good", 2, 2 / 6], ["Fine", 0, 0], ["Not for me", 1, 1 / 6]]);
  assert.equal(ratings.empty, null);
});

test("tiers and tournaments sections", () => {
  const model = bookStatsModel(full, openLibrary);
  assert.deepEqual(model.tiers, { letter: "B", summary: "Average across 4 published tier lists · 23 votes" });
  assert.deepEqual(model.tournaments, [
    { label: "Entered", value: "3" },
    { label: "Titles", value: "1" },
    { label: "Won–lost", value: "7–2" },
    { label: "Best finish", value: "Winner" }
  ]);
});

test("an unplayed tournament has no best finish yet", () => {
  const model = bookStatsModel({ community: null, tiers: null, tournaments: { entered: 1, titles: 0, wins: 0, losses: 0, best: null } }, null);
  assert.deepEqual(model.tournaments!.at(-1), { label: "Best finish", value: "Not played yet" });
});

test("every empty section explains itself", () => {
  const model = bookStatsModel({ community: null, tiers: null, tournaments: null }, null);
  assert.equal(model.ratings.openLibrary, null);
  assert.equal(model.ratings.community, null);
  assert.equal(model.ratings.empty, "Shown once 3 readers have rated it.");
  assert.equal(model.tiersEmpty, "Shown once 3 people have voted on it in tier lists.");
  assert.equal(model.tournamentsEmpty, "Not in any tournament yet.");
});
