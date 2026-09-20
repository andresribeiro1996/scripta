import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiscoverItem, FeedItem } from "@scripta/shared/community";
import {
  DISCOVER_FILTERS,
  contentDetail,
  contentKindLabel,
  contentTarget,
  feedHeading,
  feedTarget,
} from "./communityHome.js";

const tierlist = {
  kind: "tierlist",
  id: "t1",
  voteCode: "code12ab",
  name: "Top fantasy",
  poolSize: 12,
  ballotCount: 4,
  votingOpen: true,
  promotedAt: null,
  covers: [] as string[],
} as const;

const tournament = {
  kind: "tournament",
  id: "g1",
  name: "Autumn cup",
  bracketSize: 8,
  status: "active",
  bookCount: 8,
  covers: [] as string[],
} as const;

const actor = { userId: "u1", username: "andre", avatarUrl: null };

test("filter option table", () => {
  assert.deepEqual(DISCOVER_FILTERS.map((f) => f.value), ["all", "tierlist", "tournament"]);
});

test("content labels and detail lines", () => {
  assert.equal(contentKindLabel(tierlist), "Tier list");
  assert.equal(contentKindLabel(tournament), "Tournament");
  assert.equal(contentDetail(tierlist), "12 books · 4 ballots");
  assert.equal(contentDetail({ ...tierlist, votingOpen: false }), "12 books · 4 ballots · closed");
  assert.equal(contentDetail(tournament), "8-book bracket · active");
});

test("content targets route by kind", () => {
  assert.equal(contentTarget(tierlist), "/vote/code12ab");
  assert.equal(contentTarget(tournament), "/arena/g1");
  const feedItem: FeedItem = {
    id: "e1",
    actor,
    type: "tierlist_published",
    content: tierlist,
    createdAt: "2026-09-10T00:00:00.000Z",
  };
  assert.equal(feedTarget(feedItem), "/vote/code12ab");
  assert.equal(feedHeading(feedItem), "andre published a tier list");
  assert.equal(
    feedHeading({ ...feedItem, content: tournament, type: "tournament_published" }),
    "andre published a tournament"
  );
});
