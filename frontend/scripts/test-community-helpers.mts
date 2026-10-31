// Exercises the community list helpers in @scripta/shared/community — the
// same copy the mobile app re-exports. Run with: npx tsx scripts/test-community-helpers.mts

import { readFileSync } from "node:fs";
import type { FeedItem, PublishedContent } from "../../packages/shared/dist/community/index.js";
import { contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget, isKnownContent } from "../../packages/shared/dist/community/index.js";

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
  promotedAt: null,
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

const quiz: PublishedContent = {
  kind: "quiz",
  id: "q1",
  voteCode: "qcode",
  name: "Dune trivia",
  questionCount: 8,
  playCount: 3,
  playOpen: true,
  covers: []
};

check("tier list kind label", contentKindLabel(tierlist, "en") === "Tier list");
check("tournament kind label", contentKindLabel(tournament, "en") === "Tournament");
check("tier list detail", contentDetail(tierlist, "en") === "12 books · 4 ballots");
check("closed tier list detail", contentDetail({ ...tierlist, votingOpen: false }, "en") === "12 books · 4 ballots · closed");
check("tournament detail", contentDetail(tournament, "en") === "8-book bracket · active");
check("tier list target", contentTarget(tierlist) === "/vote/code12ab");
check("tournament target", contentTarget(tournament) === "/arena/g1");
check("feed target follows content", feedTarget(feedItem) === "/vote/code12ab");
check("feed heading", feedHeading(feedItem, "en") === "andre published a tier list");
check(
  "tournament feed heading",
  feedHeading({ ...feedItem, content: tournament, type: "tournament_published" }, "en") === "andre published a tournament"
);

check("quiz kind label", contentKindLabel(quiz, "en") === "Quiz");
check("quiz detail", contentDetail(quiz, "en") === "8 questions · 3 plays");
check("quiz target", contentTarget(quiz) === "/play/qcode");
check("quiz status", contentStatus(quiz, "en").label === "Open");
check("quiz stats", contentStats(quiz, "en").length === 2);
check("quiz feed heading", feedHeading({ ...feedItem, content: quiz, type: "quiz_published" }, "en") === "andre published a quiz");
check("quiz is known content", isKnownContent(quiz));
check("unknown content kind is not known", !isKnownContent({ kind: "hologram" } as never));

const page = (name: string) => readFileSync(new URL(`../src/pages/${name}.tsx`, import.meta.url), "utf8");
const discover = page("DiscoverPage");
const people = page("PeoplePage");

check("Discover filters with chip buttons", /chipClass\(/.test(discover) && /aria-pressed=/.test(discover));
check("Discover chips sit in a labelled group", /role="group"\s+aria-label=/.test(discover));
check("Discover search uses the shared field and drops the local input class", /<SearchField/.test(discover) && !/const searchInput/.test(discover));
check("Discover search and chips live in the shared toolbar row", /<ToolbarRow>/.test(discover) && /<SearchField/.test(discover));
check("Discover drops the segmented control", !/segmented/.test(discover));
check("People search drops the local input class", !/const searchInput/.test(people));
check("People shows person cards in a grid panel", /PANEL/.test(people) && /repeat\(auto-fill,minmax\(280px,1fr\)\)/.test(people));
check("People lists use the list panel", /LIST_PANEL/.test(people));
check("People Follow is secondary, never primary", /BUTTON_SECONDARY/.test(people) && !/BUTTON_PRIMARY/.test(people));
check(
  "People Follow name starts with the visible label and holds no pressed state",
  /const label = person\.viewerFollows \? "Following" : "Follow"/.test(people) && /aria-label=\{`\$\{label\} \$\{person\.user\.username\}`\}/.test(people) && !/aria-pressed/.test(people)
);
check("People search uses the shared field", /<SearchField/.test(people));
check("SearchField carries the field class", /FIELD_CLASS\} w-full pl-10/.test(readFileSync(new URL("../src/components/Toolbar.tsx", import.meta.url), "utf8")));
check("People follow refreshes the home circle", /await invalidateAfterFollow\(queryClient\)/.test(people));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
