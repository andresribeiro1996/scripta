/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Duel } from "@scripta/shared";
import { arenaViewTabs, bracketSlots, matchEmptyCopy, votableDuels, waitingLabel } from "./arenaView.js";

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

test("a finished tournament drops the Match tab — there's nothing left to vote on", () => {
  assert.deepEqual(arenaViewTabs("seeding").map((option) => option.value), ["match", "books", "bracket"]);
  assert.deepEqual(arenaViewTabs("active").map((option) => option.value), ["match", "books", "bracket"]);
  assert.deepEqual(arenaViewTabs("completed").map((option) => option.value), ["books", "bracket"]);
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

test("the waiting label counts matches, not books", () => {
  assert.equal(waitingLabel(1), "1 match waiting on your vote");
  assert.equal(waitingLabel(4), "4 matches waiting on your vote");
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

test("the match pane explains an empty deck by what the tournament is doing", () => {
  assert.equal(matchEmptyCopy("seeding", false).title, "Not started yet");
  assert.equal(matchEmptyCopy("completed", true).title, "Tournament over");
  assert.equal(matchEmptyCopy("active", false).title, "No matches yet");
  // Active, matches drawn, nothing left to vote on: this voter is done until
  // the round closes — not the same as a tournament with no matches at all.
  assert.equal(matchEmptyCopy("active", true).title, "All caught up");
});
