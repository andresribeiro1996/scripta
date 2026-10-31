import assert from "node:assert/strict";
import { formatDate, parseRankingPreview } from "./helpers.js";
import { test } from "node:test";
import { DEFAULT_TIER_PRESET } from "../tierlists/tierlist.js";

process.env.TZ = "America/Sao_Paulo";

test("ranking previews keep real book placements and discard malformed or empty tiers", () => {
  const tier = { label: "S", color: "#c9482f", books: [{ title: "Dune", coverUrl: null }] };
  assert.deepEqual(parseRankingPreview([tier, { ...tier, color: "invalid" }, { ...tier, books: [] }]), [tier]);
  assert.deepEqual(parseRankingPreview(null), []);
  assert.equal(parseRankingPreview(Array(10).fill({ ...tier, books: Array(5).fill(tier.books[0]) })).length, 3);
  assert.equal(parseRankingPreview([{ ...tier, books: Array(5).fill(tier.books[0]) }])[0]?.books.length, 2);
});

test("a reading start uses a familiar wire event with an additive flag", () => {
  assert.equal(activityRow({ id: "start", type: "book_added", payload: { title: "Dune", status: 1, started: true }, createdAt: "2026-10-14T10:00:00Z" })?.label, "Started reading");
});
import { TIER_LADDER, activityRow, contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedAction, followFailureMessage, gameActionLabel, isKnownContent, personCaption, suggestionReason } from "./helpers.js";
import type { FeedItem, PersonResult, PublishedContent, QuizSummary, SuggestedReader } from "./types.js";

test("suggestionReason counts the shared books, singular or plural", () => {
  assert.equal(suggestionReason({ sharedCount: 6 }), "You share 6 books");
  assert.equal(suggestionReason({ sharedCount: 1 }), "You share 1 book");
});

test("suggestionReason says Recently active when no books are shared", () => {
  assert.equal(suggestionReason({ sharedCount: 0 }), "Recently active");
});

const person = (overrides: Partial<PersonResult> = {}): PersonResult => ({ user: { username: "reader", avatarUrl: null, userId: "u1" }, followerCount: 0, private: false, ...overrides });
const suggestion = (sharedCount: number): SuggestedReader => ({ ...person(), sharedCount, sharedBooks: [] });

test("personCaption gives a suggestion that shares books its reason", () => {
  assert.equal(personCaption(suggestion(3)), "You share 3 books");
});

test("personCaption gives a suggestion that shares none Recently active", () => {
  assert.equal(personCaption(suggestion(0)), "Recently active");
});

test("personCaption says Private for a private person, whatever their followers", () => {
  assert.equal(personCaption(person({ private: true, followerCount: 4 })), "Private");
});

test("personCaption counts one follower in the singular", () => {
  assert.equal(personCaption(person({ followerCount: 1 })), "1 follower");
});

test("personCaption counts zero followers in the plural", () => {
  assert.equal(personCaption(person({ followerCount: 0 })), "0 followers");
});

test("personCaption counts two followers in the plural", () => {
  assert.equal(personCaption(person({ followerCount: 2 })), "2 followers");
});

class StatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

test("followFailureMessage shows the server's message on a 409 and the generic one otherwise", () => {
  const limit = "You can follow up to 1,000 readers.";
  assert.equal(followFailureMessage(new StatusError(409, limit), "generic"), limit);
  assert.equal(followFailureMessage(new StatusError(409, ""), "generic"), "generic");
  assert.equal(followFailureMessage(new StatusError(500, "Request failed (500)"), "generic"), "generic");
  assert.equal(followFailureMessage(new Error("Network request failed"), "generic"), "generic");
  assert.equal(followFailureMessage({ status: 409, message: limit }, "generic"), "generic");
});

test("activity rows for book events carry the work id when the event has one", () => {
  const at = "2026-10-06T00:00:00Z";
  assert.equal(activityRow({ id: "e", type: "book_finished", payload: { title: "Dune", author: "FH", workId: "w1", status: 2 }, createdAt: at })?.workId, "w1");
  assert.equal(activityRow({ id: "e", type: "book_added", payload: { title: "Dune" }, createdAt: at })?.workId, null);
  assert.equal(activityRow({ id: "e", type: "following", payload: { username: "ana", workId: "w1" }, createdAt: at })?.workId, null);
});

const quiz = (overrides: Partial<QuizSummary> = {}): QuizSummary => ({ kind: "quiz", id: "q1", voteCode: "qcode", name: "Dune trivia", questionCount: 8, playCount: 3, playOpen: true, covers: [], ...overrides });

test("a quiz reads as a quiz in every content helper", () => {
  assert.equal(contentKindLabel(quiz()), "Quiz");
  assert.equal(contentDetail(quiz()), "8 questions · 3 plays");
  assert.equal(contentDetail(quiz({ playOpen: false })), "8 questions · 3 plays · closed");
  assert.deepEqual(contentStats(quiz()), [{ value: 8, label: "questions" }, { value: 3, label: "plays" }]);
  assert.equal(contentTarget(quiz()), "/play/qcode");
  const item: FeedItem = { id: "e", actor: { userId: "u1", username: "ana", avatarUrl: null }, type: "quiz_published", content: quiz(), createdAt: "2026-10-07T00:00:00Z" };
  assert.equal(feedAction(item), "published a quiz");
});

test("content counts of one read in the singular", () => {
  assert.equal(contentDetail(quiz({ questionCount: 1, playCount: 1 })), "1 question · 1 play");
  assert.equal(contentDetail({ kind: "tierlist", id: "t1", voteCode: "abc", name: "Fantasy", poolSize: 1, ballotCount: 1, votingOpen: true, promotedAt: null, covers: [] }), "1 book · 1 ballot");
});

test("a quiz is Played, Open or Closed", () => {
  assert.deepEqual(contentStatus(quiz({ viewerVoted: true })), { label: "Played", tone: "info" });
  assert.deepEqual(contentStatus(quiz()), { label: "Open", tone: "accent" });
  assert.deepEqual(contentStatus(quiz({ playOpen: false })), { label: "Closed", tone: "neutral" });
  assert.deepEqual(contentStatus(quiz({ playOpen: false, viewerVoted: true })), { label: "Closed", tone: "neutral" });
});

test("activity rows name quiz events and skip a type this build does not know", () => {
  const at = "2026-10-07T00:00:00Z";
  assert.equal(activityRow({ id: "e", type: "quiz_published", payload: { name: "Dune trivia" }, createdAt: at })?.label, "Published a quiz");
  assert.equal(activityRow({ id: "e", type: "voted_on", payload: { game: "quiz", name: "Dune trivia" }, createdAt: at })?.label, "Played a quiz");
  assert.equal(activityRow({ id: "e", type: "voted_on", payload: { game: "tierlist", name: "x" }, createdAt: at })?.label, "Ranked a tier list");
  assert.equal(activityRow({ id: "e", type: "voted_on", payload: { game: "tournament", name: "x" }, createdAt: at })?.label, "Voted in a tournament");
  assert.equal(activityRow({ id: "e", type: "hologram" as never, payload: {}, createdAt: at }), null);
});

test("isKnownContent accepts the kinds this build renders and rejects others", () => {
  assert.equal(isKnownContent(quiz()), true);
  assert.equal(isKnownContent({ kind: "tournament" } as PublishedContent), true);
  assert.equal(isKnownContent({ kind: "tierlist" } as PublishedContent), true);
  assert.equal(isKnownContent({ kind: "hologram" } as never), false);
  assert.equal(isKnownContent(undefined as never), false);
});

const actionTierlist = { kind: "tierlist", id: "t1", voteCode: "code12ab", name: "Top fantasy", poolSize: 12, ballotCount: 4, votingOpen: true, promotedAt: null, covers: [] as string[] } as const;
const actionTournament = { kind: "tournament", id: "g1", name: "Autumn cup", bracketSize: 8, status: "active", bookCount: 8, covers: [] as string[] } as const;

test("ticket actions reflect closed games and prior participation", () => {
  assert.equal(gameActionLabel({ ...actionTierlist, votingOpen: true }), "Rank books");
  assert.equal(gameActionLabel({ ...actionTierlist, viewerVoted: true }), "Edit ranking");
  assert.equal(gameActionLabel({ ...actionTierlist, votingOpen: false }), "View rankings");
  assert.equal(gameActionLabel({ ...actionTierlist, promotedAt: "2026-01-01" }), "View rankings");
  assert.equal(gameActionLabel({ ...actionTournament, status: "completed" }), "View results");
  assert.equal(gameActionLabel({ ...actionTournament, status: "active" }), "Vote in tournament");
  assert.equal(gameActionLabel(quiz()), "Play quiz");
  assert.equal(gameActionLabel(quiz({ viewerVoted: true })), "View quiz");
  assert.equal(gameActionLabel(quiz({ playOpen: false })), "View quiz");
});

test("the tier ladder is the default preset colours", () => {
  assert.deepEqual(TIER_LADDER, DEFAULT_TIER_PRESET.map((tier) => tier.color));
});

test("a character tier list names characters and a book one is unchanged", () => {
  const base = { kind: "tierlist" as const, id: "t", voteCode: "c", name: "N", poolSize: 12, ballotCount: 3, votingOpen: true, promotedAt: null, covers: [] };
  assert.equal(contentDetail({ ...base, subject: { kind: "characters", label: "Harry Potter" } }), "12 characters · 3 ballots");
  assert.equal(contentDetail(base), "12 books · 3 ballots");
  assert.equal(gameActionLabel({ ...base, subject: { kind: "characters", label: "Harry Potter" } }), "Rank characters");
  assert.equal(gameActionLabel(base), "Rank books");
  assert.deepEqual(contentStats({ ...base, subject: { kind: "characters", label: "H" } })[0], { value: 12, label: "characters" });
});

test("a character tournament says character bracket", () => {
  const base = { kind: "tournament" as const, id: "t", name: "N", bracketSize: 8, status: "active" as const, bookCount: 8, covers: [] };
  assert.equal(contentDetail({ ...base, subject: { kind: "characters", label: "H" } }), "8-character bracket · active");
  assert.equal(contentDetail(base), "8-book bracket · active");
});

test("one absolute date format: day, short month, year, and a date-only value never shifts a day", () => {
  assert.equal(formatDate("2026-10-31"), "31 Oct 2026");
  assert.equal(formatDate("2026-10-31T15:00:00.000Z"), "31 Oct 2026");
  assert.equal(formatDate("2026-01-05"), "5 Jan 2026");
  assert.equal(formatDate("not a date"), "");
});
