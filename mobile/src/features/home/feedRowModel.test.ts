import assert from "node:assert/strict";
import { test } from "node:test";
import { digestTarget, type DigestItem, type ParticipationItem } from "@scripta/shared";
import { digestRoute } from "./feedRowModel.js";

const actor = { userId: "u1", username: "alice", avatarUrl: null };

const tierlist = {
  kind: "tierlist" as const,
  id: "t1",
  voteCode: "abc",
  name: "Fantasy doorstoppers",
  poolSize: 24,
  ballotCount: 7,
  votingOpen: true,
  promotedAt: null,
  covers: ["a.png", "b.png"]
};

const quiz = { kind: "quiz" as const, id: "q1", voteCode: "qc", name: "Dune trivia", questionCount: 5, playCount: 2, playOpen: true, covers: ["q.png"] };

test("a row opens the native route for what it is about: the owner's game, a profile, or the shared target", () => {
  const createdAt = "2026-09-30T00:00:00.000Z";
  const game = (kind: ParticipationItem["game"]["kind"]): DigestItem => ({ kind: "participation", id: `${kind}:g1`, game: { kind, id: "g1", name: "G", covers: [] }, actors: [], count: 1, createdAt });
  assert.equal(digestRoute(game("tierlist")), "/tierlist/g1");
  assert.equal(digestRoute(game("quiz")), "/quiz/g1?view=results");
  assert.equal(digestRoute(game("tournament")), "/arena/g1");
  assert.equal(digestRoute({ kind: "follow", id: "f1", actor, createdAt, viewerFollows: false }), "/u/alice");
  assert.equal(digestRoute({ kind: "reading", id: "e3", actor, book: { title: "Hyperion", author: "Dan Simmons", coverUrl: null }, finished: true, createdAt }), "/u/alice");
  const publication: DigestItem = { kind: "publication", id: "e1", actor, type: "tierlist_published", content: tierlist, createdAt };
  assert.equal(digestRoute(publication), digestTarget(publication));
  assert.equal(digestRoute({ kind: "publication", id: "e5", actor, type: "quiz_published", content: quiz, createdAt }), "/play/qc");
  assert.equal(digestRoute({ kind: "vote", id: "e6", actor, content: quiz, createdAt }), "/play/qc");
});

test("a reading item with a work opens the work screen, without one the reader", () => {
  const createdAt = "2026-09-30T00:00:00.000Z";
  const reading: DigestItem = { kind: "reading", id: "e3", actor, book: { title: "Hyperion", author: "Dan Simmons", coverUrl: null }, finished: true, createdAt };
  const withWork: DigestItem = { ...reading, book: { ...reading.book, workId: "w1" } };
  assert.equal(digestRoute(withWork), "/work/w1");
  assert.equal(digestRoute(reading), "/u/alice");
});
