/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { bracketShape, type Duel } from "@scripta/shared";
import { arenaViewTabs, bracketSlots, matchEmptyCopy, matchNote, roundHeadline, tournamentChampion, votableDuels } from "./arenaView.js";

const duel = (over: Partial<Duel> = {}): Duel => ({
  id: "d1",
  roundNumber: 1,
  duelIndex: 0,
  bookA: { key: "a", title: "A", author: "Author A", cover: null, votes: 0 },
  bookB: { key: "b", title: "B", author: "Author B", cover: null, votes: 0 },
  winnerKey: null,
  status: "active",
  opensAt: "2026-01-01T00:00:00.000Z",
  closesAt: "2026-01-01T01:00:00.000Z",
  hasVoted: false,
  ...over,
});

test("both tabs stay put at every status — a finished tournament shows its winner on Match", () => {
  assert.deepEqual(arenaViewTabs("seeding").map((option) => option.value), ["bracket", "match"]);
  assert.deepEqual(arenaViewTabs("active").map((option) => option.value), ["bracket", "match"]);
  assert.deepEqual(arenaViewTabs("completed").map((option) => option.value), ["bracket", "match"]);
});

test("the match deck only queues duels still open to this voter", () => {
  const open = duel({ id: "open" });
  const voted = duel({ id: "voted", hasVoted: true });
  const settled = duel({ id: "settled", status: "settled", winnerKey: "a" });
  const tied = duel({ id: "tied", status: "tied_pending_tiebreak" });

  assert.deepEqual(votableDuels([voted, open, settled, tied]).map((item) => item.id), ["open"]);
  // The deck votes on the head of the queue, so bracket order has to survive
  // the filter — round 1 match 1 comes up before round 1 match 2.
  const second = duel({ id: "second", duelIndex: 1 });
  assert.deepEqual(votableDuels([open, second]).map((item) => item.id), ["open", "second"]);
});

test("bracket slots keep a stable key for rounds nobody has reached yet", () => {
  const first = duel({ id: "r1m1", roundNumber: 1, duelIndex: 0 });
  const second = duel({ id: "r1m2", roundNumber: 1, duelIndex: 1 });
  const slots = bracketSlots(4, [first, second]);

  assert.deepEqual(slots.map((slot) => slot.key), ["0:0", "0:1", "1:0"]);
  assert.deepEqual(slots.map((slot) => slot.duel?.id ?? null), ["r1m1", "r1m2", null]);

  // Once the final is drawn it lands in the slot that was already keyed 1:0,
  // so the list updates that row instead of remounting the bracket.
  const final = duel({ id: "final", roundNumber: 2, duelIndex: 0 });
  const filled = bracketSlots(4, [first, second, final]);
  assert.deepEqual(filled.map((slot) => slot.key), ["0:0", "0:1", "1:0"]);
  assert.equal(filled[2]?.duel?.id, "final");
});

test("there's no champion until the final itself is decided", () => {
  const semiA = duel({ id: "s1", roundNumber: 1, duelIndex: 0, winnerKey: "a", status: "settled" });
  const semiB = duel({ id: "s2", roundNumber: 1, duelIndex: 1, winnerKey: "b", status: "settled" });
  // Both semis done but the final still open: a decided earlier round is
  // not a tournament winner.
  const openFinal = duel({ id: "f", roundNumber: 2, duelIndex: 0 });
  assert.equal(tournamentChampion(4, [semiA, semiB, openFinal]), null);
  assert.equal(tournamentChampion(4, [semiA, semiB]), null);

  const wonFinal = duel({ id: "f", roundNumber: 2, duelIndex: 0, winnerKey: "b", status: "settled" });
  assert.equal(tournamentChampion(4, [semiA, semiB, wonFinal])?.title, "B");
});

test("the match pane explains an empty deck by what the tournament is doing", () => {
  assert.equal(matchEmptyCopy("seeding", false).title, "Not started yet");
  assert.equal(matchEmptyCopy("completed", true).title, "No matches");
  assert.equal(matchEmptyCopy("active", false).title, "No matches yet");
  // Active, matches drawn, nothing left to vote on: this voter is done until
  // the round closes — not the same as a tournament with no matches at all.
  assert.equal(matchEmptyCopy("active", true).title, "All caught up");
});

test("the round headline places the round, its progress and its deadline", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const settled = (i: number) => duel({ id: `s${i}`, roundNumber: 1, duelIndex: i, status: "settled", winnerKey: "a" });
  const open = duel({ id: "open", roundNumber: 1, duelIndex: 2, closesAt: "2026-09-26T18:00:00.000Z" });
  const byRound = bracketShape(8, [settled(0), settled(1), open]);

  const head = roundHeadline(byRound, 0, now);
  // Four matches deep in an 8-book draw is the quarter-final, whatever its
  // index says — the name comes from the back of the bracket.
  assert.equal(head.title, "Quarters · Round 1 of 3");
  assert.equal(head.status, "2 of 4 settled · Closes Sat 26 Sep");
});

test("a deadline inside the last day counts down instead of naming a date", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const open = duel({ id: "open", roundNumber: 1, duelIndex: 0, closesAt: "2026-09-21T17:30:00.000Z" });
  const byRound = bracketShape(2, [open]);

  assert.equal(roundHeadline(byRound, 0, now).status, "0 of 1 settled · 5h 30m left");
});

test("a named round keeps its name alongside its position", () => {
  const final = duel({ id: "f", roundNumber: 2, duelIndex: 0 });
  const byRound = bracketShape(4, [duel({ id: "a", roundNumber: 1, duelIndex: 0 }), duel({ id: "b", roundNumber: 1, duelIndex: 1 }), final]);
  assert.equal(roundHeadline(byRound, 1, Date.parse("2026-01-01T00:00:00.000Z")).title, "Final · Round 2 of 2");
});

test("a settled match with nothing in it says so, and claims nothing about who settled it", () => {
  assert.equal(matchNote(duel({ status: "settled", winnerKey: "a" })), "Settled · no votes");
  assert.equal(matchNote(duel({ status: "settled", winnerKey: "a", bookA: { key: "a", title: "A", author: "Author A", cover: null, votes: 3 } })), "Settled");
  assert.equal(matchNote(duel({ status: "tied_pending_tiebreak" })), "Tiebreak needed");
  assert.equal(matchNote(duel()), null);
});
