import assert from "node:assert/strict";
import { test } from "node:test";
import { digestHeading, digestTarget, withKnownDigestItems, type DashboardFeedPage, type DigestItem } from "@scripta/shared/dashboard";
import { readFileSync } from "node:fs";

test("digest headings and targets by kind", () => {
  const pub: DigestItem = {
    kind: "publication", id: "e1", type: "tierlist_published", createdAt: "2026-09-10T00:00:00.000Z",
    actor: { userId: "u1", username: "andre", avatarUrl: null },
    content: { kind: "tierlist", id: "t1", voteCode: "code12ab", name: "Top fantasy", poolSize: 12, ballotCount: 4, votingOpen: true, promotedAt: null }
  };
  const follow: DigestItem = { kind: "follow", id: "u2", createdAt: "2026-09-11T00:00:00.000Z", actor: { userId: "u2", username: "sam", avatarUrl: null } };
  assert.equal(digestHeading(pub), "andre published a tier list");
  assert.equal(digestTarget(pub), "/vote/code12ab");
  assert.equal(digestHeading(follow), "sam started following you");
  assert.equal(digestTarget(follow), "/community/u/sam");
});

test("a quiz digest item reads as a quiz and an unknown content kind is dropped", () => {
  const actor = { userId: "u1", username: "andre", avatarUrl: null };
  const pub: DigestItem = {
    kind: "publication", id: "e1", type: "quiz_published", createdAt: "2026-10-07T00:00:00.000Z", actor,
    content: { kind: "quiz", id: "q1", voteCode: "qcode", name: "Dune trivia", questionCount: 8, playCount: 3, playOpen: true, covers: [] }
  };
  const unknown = { ...pub, id: "e2", content: { kind: "hologram", id: "h1", name: "x" } } as unknown as DigestItem;
  assert.equal(digestHeading(pub), "andre published a quiz");
  assert.equal(digestTarget(pub), "/play/qcode");
  const page: DashboardFeedPage = { items: [pub, unknown], nextCursor: null, seenAt: null, personalNewCount: 0, followingNewCount: 0 };
  assert.deepEqual(withKnownDigestItems(page).items, [pub]);
});

const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");

test("Home: two columns from lg, awards card, games from homeGames, reading strip and suggestions", () => {
  const home = read("pages/HomePage");
  assert.match(home, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
  for (const part of ["<AwardsCard", "<DiscoverTicket", "<ReadingStrip", "<SuggestedReaders"]) assert.match(home, new RegExp(part), part);
  assert.match(home, /homeGames\(/);
  assert.match(home, /Browse all/);
  assert.doesNotMatch(home, /useDashboard\(/);
  assert.doesNotMatch(home, /Rediscover|Up next|Currently reading/);
});

test("the reading strip: five linked, named covers, progress when known, an empty state, a link to the Reading filter", () => {
  const strip = read("components/home/ReadingStrip");
  assert.match(strip, /<BookCover/);
  assert.match(strip, /readingPercent\(/);
  assert.match(strip, /\.slice\(0, 5\)/);
  assert.match(strip, /<Link(?:=>|[^>])*aria-label=/);
  assert.match(strip, /Nothing in progress/);
  assert.match(strip, /\/dashboard\/library\?status=reading/);
});

test("Discover and Home share one ticket", () => {
  assert.match(read("pages/DiscoverPage"), /<DiscoverTicket/);
  assert.doesNotMatch(read("pages/DiscoverPage"), /function DiscoverRow/);
});

test("the awards card uses the shared model, links a work, and can be dismissed", () => {
  const card = read("components/home/AwardsCard");
  assert.match(card, /awardCardModel\(/);
  assert.match(card, /firstUndismissed\(/);
  assert.match(card, /aria-label="Dismiss"/);
});

test("suggestions: at most three, the shared reason, Follow as a secondary button, See all to People", () => {
  const s = read("components/home/SuggestedReaders");
  assert.match(s, /\.slice\(0, 3\)/);
  assert.match(s, /suggestionReason\(/);
  assert.match(s, /BUTTON_SECONDARY[\s\S]*?Follow|Follow[\s\S]*?BUTTON_SECONDARY/);
  assert.match(s, /\/community\/people/);
});

test("the awards card looks nothing up by title: only the cover URL, and the title only for the fallback", () => {
  const card = read("components/home/AwardsCard");
  assert.match(card, /<BookCover book=\{\{ _coverUrl: model\.coverUrl \}\} title=\{model\.subtitle\}/);
  assert.doesNotMatch(card, /Title: model\.subtitle/);
});

test("suggestions: a failed load shows Retry, Follow names the reader, and following refreshes the circle", () => {
  const s = read("components/home/SuggestedReaders");
  assert.match(s, /Couldn't load suggestions\./);
  assert.match(s, /refetch/);
  assert.match(s, /Retry/);
  assert.match(s, /<button(?:=>|[^>])*aria-label=\{`Follow \$\{reader\.user\.username\}`\}/);
  assert.match(s, /queryKey: \["community", "dashboard", "circle"\]/);
});

test("the reading strip's empty-state link is a 44px target", () => {
  const strip = read("components/home/ReadingStrip");
  assert.match(strip, /<Link to="\/dashboard\/library"(?:=>|[^>])*min-h-11(?:=>|[^>])*>Pick something from your library/);
});
