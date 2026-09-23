import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FEED_SETTINGS,
  activityDay,
  activityRow,
  categoryFor,
  normalizeFeedSettings
} from "../../packages/shared/dist/community/index.js";
import type { ActivityItem } from "../../packages/shared/dist/community/index.js";

test("categoryFor maps every activity type", () => {
  assert.equal(categoryFor("tierlist_published"), "publications");
  assert.equal(categoryFor("tournament_published"), "publications");
  assert.equal(categoryFor("mural_published"), "publications");
  assert.equal(categoryFor("book_added"), "reading");
  assert.equal(categoryFor("book_finished"), "reading");
  assert.equal(categoryFor("voted_on"), "votes");
  assert.equal(categoryFor("following"), "follows");
});

test("normalizeFeedSettings accepts only full boolean objects", () => {
  assert.deepEqual(normalizeFeedSettings({ publications: true, reading: false, votes: true, follows: true }), {
    publications: true, reading: false, votes: true, follows: true
  });
  assert.equal(normalizeFeedSettings({ publications: true }), null);
  assert.equal(normalizeFeedSettings({ publications: "yes", reading: false, votes: true, follows: true }), null);
  assert.equal(normalizeFeedSettings(null), null);
  assert.equal(normalizeFeedSettings(undefined), null);
});

test("defaults keep reading private", () => {
  assert.equal(DEFAULT_FEED_SETTINGS.reading, false);
  assert.equal(DEFAULT_FEED_SETTINGS.publications, true);
});

test("activityRow gives each event a label, tone, title and link", () => {
  const row = (type: ActivityItem["type"], payload: Record<string, unknown>) => activityRow({ id: "1", type, payload, createdAt: "x" });
  assert.deepEqual(row("book_added", { title: "Dune", author: "Frank Herbert", status: 1, coverUrl: "dune.jpg" }), {
    kind: "reading", label: "Added to library", tone: "dim", title: "Dune", meta: "Frank Herbert · Reading", covers: ["dune.jpg"], href: null, username: null
  });
  assert.deepEqual(row("book_finished", { title: "Dune", author: "", coverUrl: null }), {
    kind: "reading", label: "Finished reading", tone: "success", title: "Dune", meta: "", covers: [], href: null, username: null
  });
  assert.deepEqual(row("tierlist_published", { name: "Best of 2025", href: "/vote/abc", detail: "5 books · 2 ballots", covers: ["a", "b", "c", "d", 7] }), {
    kind: "publication", label: "Published a tier list", tone: "accent", title: "Best of 2025", meta: "5 books · 2 ballots", covers: ["a", "b", "c"], href: "/vote/abc", username: null
  });
  assert.equal(row("tournament_published", { name: "Cup" }).label, "Started a tournament");
  assert.equal(row("voted_on", { game: "tierlist", name: "Cosy reads" }).label, "Ranked a tier list");
  assert.equal(row("voted_on", { game: "tournament", name: "March Madness", href: "/arena/g1" }).href, "/arena/g1");
  assert.deepEqual(row("following", { username: "mia" }), {
    kind: "follow", label: "Followed", tone: "dim", title: "@mia", meta: "", covers: [], href: null, username: "mia"
  });
  assert.equal(row("mural_published", { muralId: "m1" }).kind, "mural");
});

test("activityDay names recent days and dates older ones", () => {
  const now = new Date(2026, 8, 22, 15);
  assert.equal(activityDay(new Date(2026, 8, 22, 1).toISOString(), now), "Today");
  assert.equal(activityDay(new Date(2026, 8, 21, 23).toISOString(), now), "Yesterday");
  assert.equal(activityDay(new Date(2026, 8, 18).toISOString(), now), new Date(2026, 8, 18).toLocaleDateString(undefined, { weekday: "long" }));
  assert.equal(activityDay(new Date(2026, 7, 1).toISOString(), now), new Date(2026, 7, 1).toLocaleDateString(undefined, { month: "long", day: "numeric" }));
  assert.match(activityDay(new Date(2025, 0, 5).toISOString(), now), /2025/);
  assert.equal(activityDay("nope", now), "");
});
