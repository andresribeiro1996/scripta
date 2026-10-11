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

test("the feeling columns are one image with every count, and only the top column is accent", () => {
  const html = sections(full, rating);
  assert.ok(html.includes('role="img"'));
  assert.ok(html.includes('aria-label="Ratings by feeling: Not for me 1, Fine 0, Good 2, Loved it 6, All-time 3"'));
  assert.equal(html.match(/flex-1 rounded-t bg-\(--color-accent\)/g)?.length, 1);
  assert.equal(html.match(/flex-1 rounded-t bg-\(--color-text-dim\)\/75/g)?.length, 4);
});

test("the tournament path says which steps were reached and whether a title was won", () => {
  const lost = sections({ ...full, tournaments: { entered: 2, titles: 0, wins: 3, losses: 2, best: { round: 2, duels: 2 } } }, rating);
  assert.ok(lost.includes("(reached)"));
  assert.ok(lost.includes("(not reached)"));
  assert.ok(lost.includes("No title"));
  assert.ok(!lost.includes("Won a title"));
  assert.ok(sections(full, rating).includes("Won a title"));
});

test("a tournament record without a best finish shows the summary and no steps", () => {
  const html = sections({ ...full, tournaments: { entered: 1, titles: 0, wins: 0, losses: 0, best: null } }, rating);
  assert.ok(html.includes("1 tournament"));
  assert.ok(!html.includes("<ol"));
  assert.ok(!html.includes("(reached)"));
});
