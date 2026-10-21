import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizShelfFacts } from "../quizzes/service.js";
import type { TierlistShelfFacts } from "../tierlists/service.js";
import type { TournamentShelfFacts } from "../arena/service.js";
import { rankTopShelf, topShelfMonthStart, type ShelfInput } from "./topShelf.js";

process.env.TZ = "America/Sao_Paulo";

const quiz = (over: Partial<QuizShelfFacts> & { id: string }): QuizShelfFacts => ({ ownerUserId: "u1", createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince: 0, workIds: [], ...over });
const tierlist = (over: Partial<TierlistShelfFacts> & { id: string }): TierlistShelfFacts => ({ ownerUserId: "u1", promoted: false, createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince: 0, workIds: [], placements: [], ...over });
const tournament = (over: Partial<TournamentShelfFacts> & { id: string }): TournamentShelfFacts => ({ ownerUserId: "u1", createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince: 0, workIds: [], champion: null, ...over });
const input = (over: Partial<ShelfInput> = {}): ShelfInput => ({ tierlists: [], tournaments: [], quizzes: [], engagement: new Map(), visibleOwners: new Set(["u1"]), canonical: new Map(), genres: new Map(), ...over });
const all = { since: null, genre: null };
const ids = (r: Array<{ workId: string }> | undefined) => (r ?? []).map((x) => x.workId);

test("topShelfMonthStart is the first of the month in Lisbon", () => {
  assert.equal(topShelfMonthStart(new Date("2026-10-21T10:00:00Z")), "2026-09-30T23:00:00.000Z");
  assert.equal(topShelfMonthStart(new Date("2026-11-15T12:00:00Z")), "2026-11-01T00:00:00.000Z");
  assert.equal(topShelfMonthStart(new Date("2026-09-30T23:30:00Z")), "2026-09-30T23:00:00.000Z");
});

test("ignores games under the vote bar", () => {
  const r = rankTopShelf(input({ quizzes: [quiz({ id: "a", voters: 4, workIds: ["w1"] }), quiz({ id: "b", voters: 5, workIds: ["w2"] })] }), all);
  assert.deepEqual(ids(r.boards.quizzed), ["w2"]);
});

test("ignores games whose owner is hidden but keeps promoted lists", () => {
  const r = rankTopShelf(input({
    visibleOwners: new Set(),
    quizzes: [quiz({ id: "a", workIds: ["w1"] })],
    tierlists: [tierlist({ id: "t", promoted: true, workIds: ["w2"] }), tierlist({ id: "u", workIds: ["w3"] })],
  }), all);
  assert.deepEqual(ids(r.boards.quizzed), []);
  assert.deepEqual(ids(r.boards.tiered), ["w2"]);
});

test("counts a work once per game after canonicalizing", () => {
  const r = rankTopShelf(input({ canonical: new Map([["w1b", "w1"]]), quizzes: [quiz({ id: "a", workIds: ["w1", "w1b"] })] }), all);
  assert.deepEqual(r.boards.quizzed, [{ workId: "w1", value: 1 }]);
});

test("scores a title 3 and an appearance 1", () => {
  const r = rankTopShelf(input({
    tournaments: [tournament({ id: "a", workIds: ["w1", "w2"], champion: { workId: "w1", settledAt: "2026-10-06T00:00:00.000Z" } })],
    quizzes: [quiz({ id: "q", workIds: ["w1", "w2"] })],
  }), all);
  assert.deepEqual(r.boards.champions, [{ workId: "w1", value: 5 }, { workId: "w2", value: 2 }]);
  assert.deepEqual(r.boards.crowned, [{ workId: "w1", value: 1 }]);
});

test("breaks ties by titles, latest appearance, work id", () => {
  const q = (id: string, day: string, workIds: string[]) => quiz({ id, createdAt: `2026-10-${day}T00:00:00.000Z`, workIds });
  const r = rankTopShelf(input({
    quizzes: [q("q1", "01", ["wz", "wa", "wb"]), q("q2", "02", ["wz", "wc", "wd"]), q("q3", "03", ["wz"]), q("q4", "04", ["wz"])],
    tournaments: [tournament({ id: "t", workIds: ["we"], champion: { workId: "we", settledAt: "2026-09-01T00:00:00.000Z" } })],
  }), all);
  assert.deepEqual(ids(r.boards.champions), ["we", "wz", "wc", "wd", "wa", "wb"]);
});

test("highest tier needs three lists and ranks lower scores first", () => {
  const place = (workId: string, tierIndex: number) => ({ workId, tierIndex, tierCount: 5, ranksWorstFirst: false, castAt: "2026-10-06T00:00:00.000Z" });
  const lists = ["a", "b", "c"].map((id) => tierlist({ id, workIds: ["w1", "w2", "w3"], placements: [place("w1", 0), place("w2", 3), place("w3", 1)] }));
  const r = rankTopShelf(input({ tierlists: [...lists, tierlist({ id: "d", placements: [place("w4", 0)] })] }), all);
  assert.deepEqual(r.boards.highestTier, [{ workId: "w1", value: 0 }, { workId: "w3", value: 0.25 }, { workId: "w2", value: 0.75 }]);
  const some = rankTopShelf(input({ tierlists: lists.slice(0, 2) }), all);
  assert.deepEqual(some.boards.highestTier, []);
});

test("highest tier counts only placements cast in the period", () => {
  const place = (castAt: string) => ({ workId: "w1", tierIndex: 0, tierCount: 5, ranksWorstFirst: false, castAt });
  const lists = ["a", "b", "c"].map((id) => tierlist({ id, placements: [place("2026-09-01T00:00:00.000Z")] }));
  const r = rankTopShelf(input({ tierlists: lists }), { since: "2026-10-01T00:00:00.000Z", genre: null });
  assert.deepEqual(r.boards.highestTier, []);
});

test("rising star uses first appearance in any visible game", () => {
  const since = "2026-10-01T00:00:00.000Z";
  const r = rankTopShelf(input({
    quizzes: [
      quiz({ id: "old", createdAt: "2026-08-01T00:00:00.000Z", voters: 0, workIds: ["w1"] }),
      quiz({ id: "new", workIds: ["w1", "w2"] }),
    ],
    tierlists: [tierlist({ id: "t", workIds: ["w2", "w3"] })],
  }), { since, genre: null });
  assert.deepEqual(r.boards.risingStar, [{ workId: "w2", value: 2 }, { workId: "w3", value: 1 }]);
  assert.equal(rankTopShelf(input(), all).boards.risingStar, undefined);
});

test("rising star drops works with no qualifying appearance", () => {
  const r = rankTopShelf(input({ quizzes: [quiz({ id: "a", voters: 1, workIds: ["w1"] })] }), { since: "2026-10-01T00:00:00.000Z", genre: null });
  assert.deepEqual(r.boards.risingStar, []);
});

test("uses the publish event time, falling back to createdAt", () => {
  const since = "2026-10-01T00:00:00.000Z";
  const r = rankTopShelf(input({
    quizzes: [quiz({ id: "a", createdAt: "2026-09-01T00:00:00.000Z", workIds: ["w1"] }), quiz({ id: "b", createdAt: "2026-09-01T00:00:00.000Z", workIds: ["w2"] }), quiz({ id: "c", createdAt: "2026-09-01T00:00:00.000Z", workIds: ["w3"] })],
    engagement: new Map([
      ["quiz:a", { publishedAt: "2026-10-02T00:00:00.000Z", likes: 0, comments: 0 }],
      ["quiz:b", { publishedAt: "2026-09-02T00:00:00.000Z", likes: 0, comments: 0 }],
    ]),
  }), { since, genre: null });
  assert.deepEqual(ids(r.boards.quizzed), ["w1"]);
});

test("genre filters book boards and empties genreChampions", () => {
  const genres = new Map([["w1", { genres: ["Fantasy"] }], ["w2", { genres: ["Horror"] }]]);
  const base = input({ genres, quizzes: [quiz({ id: "a", workIds: ["w1", "w2", "w3"] })] });
  const open = rankTopShelf(base, all);
  assert.deepEqual(open.genreChampions.map((g) => [g.genre, g.entry.workId]), [["Fantasy", "w1"], ["Horror", "w2"]]);
  const picked = rankTopShelf(base, { since: null, genre: "Fantasy" });
  assert.deepEqual(ids(picked.boards.quizzed), ["w1"]);
  assert.deepEqual(ids(picked.boards.champions), ["w1"]);
  assert.deepEqual(picked.genreChampions, []);
});

test("genres lists every genre even when one is selected", () => {
  const genres = new Map([["w1", { genres: ["Fantasy"] }], ["w2", { genres: ["Horror"] }], ["w3", { genres: ["Horror"] }]]);
  const base = input({ genres, quizzes: [quiz({ id: "a", workIds: ["w1", "w2", "w3"] }), quiz({ id: "b", workIds: ["w2"] })] });
  assert.deepEqual(rankTopShelf(base, { since: null, genre: "Fantasy" }).genres, ["Horror", "Fantasy"]);
});

test("hottest games sum likes votes and comments in the period and ignore the vote bar", () => {
  const r = rankTopShelf(input({
    visibleOwners: new Set(["u1"]),
    quizzes: [quiz({ id: "q", voters: 1, votesSince: 3 }), quiz({ id: "idle" })],
    tierlists: [tierlist({ id: "t", votesSince: 1 }), tierlist({ id: "hidden", ownerUserId: "x", votesSince: 9 })],
    tournaments: [tournament({ id: "n", votesSince: 0 })],
    engagement: new Map([
      ["quiz:q", { publishedAt: "2026-10-01T00:00:00.000Z", likes: 2, comments: 1 }],
      ["tournament:n", { publishedAt: "2026-10-01T00:00:00.000Z", likes: 1, comments: 0 }],
    ]),
  }), { since: "2026-10-01T00:00:00.000Z", genre: null });
  assert.deepEqual(r.games.map((g) => [g.ref.kind, g.ref.id, g.likes, g.votes, g.comments]), [["quiz", "q", 2, 3, 1], ["tierlist", "t", 0, 1, 0], ["tournament", "n", 1, 0, 0]]);
});
