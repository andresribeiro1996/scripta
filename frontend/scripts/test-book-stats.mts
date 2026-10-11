import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { bookStatsModel, type BookStats } from "@scripta/shared";
import { StatsSections, StatsStrip } from "../src/components/book/BookStats";

const full: BookStats = {
  community: { average: 3.8, count: 12, distribution: [1, 0, 2, 6, 3] },
  tiers: { score: 0.31, letter: "B", lists: 4, ballots: 23 },
  tournaments: { entered: 3, titles: 1, wins: 7, losses: 2, best: { round: 3, duels: 1 } }
};
const rating = { value: 4.12, count: 2310 };
const strip = (stats: BookStats | null, ol: typeof rating | null) =>
  renderToString(createElement(MemoryRouter, null, createElement(StatsStrip, { cells: bookStatsModel(stats, ol).strip, to: "/work/w/stats" })));
const sections = (stats: BookStats | null, ol: typeof rating | null) => renderToString(createElement(StatsSections, { model: bookStatsModel(stats, ol) }));

test("the strip links to the stats page and shows each cell", () => {
  const html = strip(full, rating);
  assert.ok(html.includes('href="/work/w/stats"'));
  for (const text of ["★ 4.1", "Open Library", "Loved it", "12 readers", "B tier", "4 lists", "1 title", "3 tournaments"]) assert.ok(html.includes(text), text);
});

test("while stats load or fail, the strip shows only Open Library", () => {
  const html = strip(null, rating);
  assert.ok(html.includes("★ 4.1"));
  assert.ok(!html.includes("readers"));
});

test("with nothing to show, the strip renders nothing", () => {
  assert.equal(strip(null, null), "");
  assert.equal(strip({ community: null, tiers: null, tournaments: null }, null), "");
});

test("the stats sections show feelings with bars, the tier letter and the tournament record", () => {
  const html = sections(full, rating);
  for (const text of ["Ratings", "★ 4.1 · 2.3K ratings on Open Library", "Loved it", "3.8 average · 12 ratings", "All-time", "Not for me", "Tier lists", "Average across 4 published tier lists · 23 votes", "Tournaments", "Won–lost", "7–2", "Winner"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes("width:50%"));
  assert.ok(html.includes("width:100%"));
});

test("empty sections say why", () => {
  const html = sections({ community: null, tiers: null, tournaments: null }, null);
  for (const text of ["Shown once 3 readers have rated it.", "Shown once 3 people have voted on it in tier lists.", "Not in any tournament yet."]) assert.ok(html.includes(text), text);
});
