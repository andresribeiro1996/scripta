import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizShelfFacts } from "../quizzes/service.js";
import type { TierlistShelfFacts } from "../tierlists/service.js";
import type { TournamentShelfFacts } from "../arena/service.js";
import type { ShelfInput } from "./topShelf.js";
import { freezeRecap, recapHasCards } from "./topShelfRecap.js";

process.env.TZ = "America/Sao_Paulo";

const quiz = (over: Partial<QuizShelfFacts> & { id: string }): QuizShelfFacts => ({ ownerUserId: "u1", open: true, createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince: 0, workIds: [], ...over });
const tierlist = (over: Partial<TierlistShelfFacts> & { id: string }): TierlistShelfFacts => ({ ownerUserId: "u1", open: true, promoted: false, createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince: 0, workIds: [], placements: [], ...over });
const tournament = (over: Partial<TournamentShelfFacts> & { id: string }): TournamentShelfFacts => ({ ownerUserId: "u1", open: true, createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince: 0, workIds: [], champion: null, ...over });
const input = (over: Partial<ShelfInput> = {}): ShelfInput => ({ tierlists: [], tournaments: [], quizzes: [], engagement: new Map(), visibleOwners: new Set(["u1"]), canonical: new Map(), genres: new Map(), ...over });
const range = { since: "2026-09-30T23:00:00.000Z", until: "2026-11-01T00:00:00.000Z" };

test("freezeRecap ignores activity after until", () => {
  const data = freezeRecap(input({
    quizzes: [quiz({ id: "late", createdAt: "2026-11-02T00:00:00.000Z", workIds: ["w1"] })],
    tournaments: [tournament({ id: "t", workIds: ["w2"], champion: { workId: "w2", settledAt: "2026-11-03T00:00:00.000Z" } })],
  }), range);
  assert.equal(data.books.some((b) => b.workId === "w1" || (b.board === "crowned")), false);
  assert.deepEqual(data.summary, { gamesPublished: 1, votesCast: 0, booksInPlay: 1 });
});

test("freezeRecap orders cards and keeps each board's leader", () => {
  const data = freezeRecap(input({
    quizzes: [quiz({ id: "q1", workIds: ["w1", "w2"] }), quiz({ id: "q2", workIds: ["w1"] })],
    tournaments: [tournament({ id: "t", workIds: ["w2"], champion: { workId: "w2", settledAt: "2026-10-10T00:00:00.000Z" } })],
  }), range);
  assert.deepEqual(data.books.map((b) => [b.board, b.workId]), [["champions", "w2"], ["crowned", "w2"], ["quizzed", "w1"], ["risingStar", "w2"]]);
});

test("candidates are every visible game with the work, busiest first", () => {
  const data = freezeRecap(input({
    canonical: new Map([["w1b", "w1"]]),
    quizzes: [quiz({ id: "a", workIds: ["w1"], votesSince: 1, open: false }), quiz({ id: "c", workIds: ["w1b"], votesSince: 1 })],
    tierlists: [tierlist({ id: "b", workIds: ["w1"], votesSince: 3 }), tierlist({ id: "hidden", ownerUserId: "x", workIds: ["w1"], votesSince: 9 })],
  }), range);
  const leader = data.books.find((b) => b.board === "champions");
  assert.deepEqual(leader?.candidates, [{ kind: "tierlist", id: "b" }, { kind: "quiz", id: "a" }, { kind: "quiz", id: "c" }]);
  assert.deepEqual(data.hottest, { ref: { kind: "tierlist", id: "b" }, likes: 0, votes: 3, comments: 0 });
});

test("summary counts games published, votes cast and books in play", () => {
  const data = freezeRecap(input({
    canonical: new Map([["w1b", "w1"]]),
    quizzes: [quiz({ id: "a", workIds: ["w1", "w2"], votesSince: 2 }), quiz({ id: "old", createdAt: "2026-09-01T00:00:00.000Z", workIds: ["w9"], votesSince: 3 })],
    tierlists: [tierlist({ id: "b", workIds: ["w1b", "w3"], votesSince: 1 })],
  }), range);
  assert.deepEqual(data.summary, { gamesPublished: 2, votesCast: 6, booksInPlay: 3 });
});

test("recapHasCards is false with only a summary", () => {
  const data = freezeRecap(input({ quizzes: [quiz({ id: "a", voters: 1, workIds: ["w1"] })] }), range);
  assert.equal(data.summary.gamesPublished, 1);
  assert.equal(recapHasCards(data), false);
  assert.equal(recapHasCards({ ...data, hottest: { ref: { kind: "quiz", id: "a" }, likes: 1, votes: 0, comments: 0 } }), true);
});
