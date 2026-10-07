import assert from "node:assert/strict";
import { test } from "node:test";
import { activityRow, contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedAction, followFailureMessage, isKnownContent, personCaption, suggestionReason } from "./helpers.js";
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
