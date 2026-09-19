import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FEED_SETTINGS,
  activityText,
  categoryFor,
  normalizeFeedSettings
} from "../../packages/shared/dist/community/index.js";

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

test("activityText renders each event kind", () => {
  assert.deepEqual(
    activityText({ id: "1", type: "book_added", payload: { title: "Dune", status: 0 }, createdAt: "x" }),
    { verb: "Added", target: "Dune — Not read", href: null }
  );
  assert.deepEqual(
    activityText({ id: "2", type: "tierlist_published", payload: { name: "Best of 2025", href: "/vote/abc" }, createdAt: "x" }),
    { verb: "Published a tierlist", target: "Best of 2025", href: "/vote/abc" }
  );
  assert.deepEqual(
    activityText({ id: "3", type: "voted_on", payload: { game: "tournament", name: "March Madness" }, createdAt: "x" }),
    { verb: "Voted in", target: "March Madness", href: null }
  );
  assert.deepEqual(
    activityText({ id: "4", type: "voted_on", payload: { game: "tierlist", name: "Cosy reads" }, createdAt: "x" }),
    { verb: "Ranked books on", target: "Cosy reads", href: null }
  );
  assert.deepEqual(
    activityText({ id: "5", type: "following", payload: { username: "mia" }, createdAt: "x" }),
    { verb: "Followed", target: "@mia", href: null }
  );
  assert.deepEqual(
    activityText({ id: "6", type: "mural_published", payload: { muralId: "m1" }, createdAt: "x" }),
    { verb: "Published", target: "a mural", href: null }
  );
});
