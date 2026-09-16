// Exercises the community list helpers in @scripta/shared/community — the
// same copy the mobile app re-exports. Run with: npx tsx scripts/test-community-helpers.mts

import type { FeedItem, PublishedContent } from "../../packages/shared/dist/community/index.js";
import { contentDetail, contentKindLabel, contentTarget, feedHeading, feedTarget } from "../../packages/shared/dist/community/index.js";

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

const tierlist: PublishedContent = {
  kind: "tierlist",
  id: "t1",
  voteCode: "code12ab",
  name: "Top fantasy",
  poolSize: 12,
  ballotCount: 4,
  votingOpen: true
};
const tournament: PublishedContent = {
  kind: "tournament",
  id: "g1",
  name: "Autumn cup",
  bracketSize: 8,
  status: "active",
  bookCount: 8
};
const feedItem: FeedItem = {
  id: "e1",
  actor: { userId: "u1", username: "andre", avatarUrl: null },
  type: "tierlist_published",
  content: tierlist,
  createdAt: "2026-09-10T00:00:00.000Z"
};

check("tier list kind label", contentKindLabel(tierlist) === "Tier list");
check("tournament kind label", contentKindLabel(tournament) === "Tournament");
check("tier list detail", contentDetail(tierlist) === "12 books · 4 ballots");
check("closed tier list detail", contentDetail({ ...tierlist, votingOpen: false }) === "12 books · 4 ballots · closed");
check("tournament detail", contentDetail(tournament) === "8-book bracket · active");
check("tier list target", contentTarget(tierlist) === "/vote/code12ab");
check("tournament target", contentTarget(tournament) === "/arena/g1");
check("feed target follows content", feedTarget(feedItem) === "/vote/code12ab");
check("feed heading", feedHeading(feedItem) === "andre published a tier list");
check(
  "tournament feed heading",
  feedHeading({ ...feedItem, content: tournament, type: "tournament_published" }) === "andre published a tournament"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
