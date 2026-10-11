import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { bookStatsModel, type BookStats } from "@scripta/shared";
import { StatsSections, StatsTiles } from "../src/components/book/BookStats";

const full: BookStats = {
  community: { average: 3.8, count: 12, distribution: [1, 0, 2, 6, 3] },
  tiers: { score: 0.31, letter: "B", lists: 4, ballots: 23 },
  tournaments: { entered: 3, titles: 1, wins: 7, losses: 2, best: { round: 3, duels: 1 } }
};
const rating = { value: 4.12, count: 2310 };
const tiles = (stats: BookStats | null, ol: typeof rating | null) =>
  renderToString(createElement(MemoryRouter, null, createElement(StatsTiles, { tiles: bookStatsModel(stats, ol).tiles, to: "/work/w/stats" })));
const sections = (stats: BookStats | null, ol: typeof rating | null) => renderToString(createElement(StatsSections, { model: bookStatsModel(stats, ol) }));

test("tiles link to the stats page with a big value and caption each", () => {
  const html = tiles(full, rating);
  assert.ok(html.includes('href="/work/w/stats"'));
  assert.ok(html.includes("Book stats: "));
  for (const text of ["4.1", "★ Open Library", "3.8", "Loved it", "Upper", "tiers · 4 lists", "🏆", "Winner"]) assert.ok(html.includes(text), text);
});

test("no tiles, nothing rendered; loading shows only Open Library", () => {
  assert.equal(tiles(null, null), "");
  const html = tiles(null, rating);
  assert.ok(html.includes("★ Open Library"));
  assert.ok(!html.includes("Loved it"));
});

test("sections: feeling columns, tier bar, bracket path", () => {
  const html = sections(full, rating);
  for (const text of ["Ratings", "Loved it", "3.8 average · 12 ratings", "Not for me", "All-time", "Tier lists", "Upper tiers", "Top", "Bottom", "Across 4 published tier lists · 23 votes", "Tournaments", "Final", "3 tournaments · 7 won, 2 lost · 1 title"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes("left:31%"));
  assert.ok(html.includes("height:100%"));
});

test("empty sections say why", () => {
  const html = sections({ community: null, tiers: null, tournaments: null }, null);
  for (const text of ["Shown once 3 readers have rated it.", "Shown once 3 people have voted on it in tier lists.", "Not in any tournament yet."]) assert.ok(html.includes(text), text);
});
