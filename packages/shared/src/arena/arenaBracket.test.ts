import assert from "node:assert/strict";
import { test } from "node:test";
import { duelWinner, roundLabel } from "./arenaBracket.js";
import type { Duel } from "./types.js";

const duel = (over: Partial<Duel> = {}): Duel => ({
  id: "d1",
  roundNumber: 1,
  duelIndex: 0,
  bookA: { workId: "a", title: "A", author: "Author A", cover: null, votes: 0 },
  bookB: { workId: "b", title: "B", author: "Author B", cover: null, votes: 0 },
  winnerWorkId: null,
  status: "settled",
  opensAt: "2026-01-01T00:00:00.000Z",
  closesAt: "2026-01-01T01:00:00.000Z",
  hasVoted: false,
  ...over,
});

test("duelWinner finds the settled winner by work id", () => {
  assert.equal(duelWinner(duel({ winnerWorkId: "b" }))?.title, "B");
  assert.equal(duelWinner(duel({ winnerWorkId: "a" }))?.title, "A");
});

test("duelWinner is null until the duel settles", () => {
  assert.equal(duelWinner(duel({ status: "active", winnerWorkId: "b" })), null);
  assert.equal(duelWinner(duel({ status: "tied_pending_tiebreak", winnerWorkId: "b" })), null);
});

test("duelWinner never matches a null side to a null winner", () => {
  const orphan = { workId: null, title: "O", author: "", cover: null, votes: 0 };
  assert.equal(duelWinner(duel({ winnerWorkId: null, bookA: orphan, bookB: orphan })), null);
});

test("duelWinner gives a shared winning work to side A only", () => {
  const twin = { workId: "a", title: "Twin", author: "", cover: null, votes: 0 };
  assert.equal(duelWinner(duel({ winnerWorkId: "a", bookB: twin }))?.title, "A");
});

test("roundLabel names rounds from the back of the draw", () => {
  assert.equal(roundLabel(1, 3), "Final");
  assert.equal(roundLabel(2, 2), "Semis");
  assert.equal(roundLabel(4, 1), "Quarters");
  assert.equal(roundLabel(8, 1), "Round 1");
});
