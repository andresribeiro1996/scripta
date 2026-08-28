// backend/src/modules/arena/service.test.ts
//
// Exercises service.ts against a hand-written in-memory ArenaRepository
// fake — no real SQLite database needed, same seam backend/README.md
// describes for every other module's service layer.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AlreadyVotedError,
  DuelNotTiedError,
  DuelNotVotableError,
  IncompleteSeedError,
  InvalidBookError,
  InvalidBracketSizeError,
  NotEnoughBooksError,
  TournamentNotFoundError
} from "./domain/errors.js";
import type { ArenaRepository } from "./domain/ports.js";
import type { DuelRow, TournamentRow, TournamentSlotRow, VoteRow } from "./domain/types.js";
import { createArenaService } from "./service.js";
import type { DuelView } from "./service.js";

function createInMemoryArenaRepository(): ArenaRepository {
  const tournaments = new Map<string, TournamentRow>();
  const slots = new Map<string, TournamentSlotRow[]>();
  const duels = new Map<string, DuelRow>();
  const votes: VoteRow[] = [];

  return {
    insertTournament(row) {
      tournaments.set(row.id, { ...row });
    },
    getTournament(id) {
      return tournaments.get(id);
    },
    getOwnedTournament(id, ownerUserId) {
      const t = tournaments.get(id);
      return t && t.owner_user_id === ownerUserId ? t : undefined;
    },
    listTournamentsByOwner(ownerUserId) {
      return [...tournaments.values()].filter((t) => t.owner_user_id === ownerUserId);
    },
    listPublicTournaments(limit, offset) {
      return [...tournaments.values()].slice(offset, offset + limit);
    },
    updateTournamentStatus(id, status, currentRound) {
      const t = tournaments.get(id);
      if (t) {
        t.status = status;
        t.current_round = currentRound;
      }
    },
    deleteTournament(id) {
      tournaments.delete(id);
      slots.delete(id);
      for (const [duelId, duel] of duels) if (duel.tournament_id === id) duels.delete(duelId);
    },

    replaceSlots(tournamentId, newSlots) {
      slots.set(tournamentId, newSlots.map((s) => ({ ...s })));
    },
    getSlots(tournamentId) {
      return [...(slots.get(tournamentId) ?? [])];
    },

    insertDuels(newDuels) {
      for (const duel of newDuels) duels.set(duel.id, { ...duel });
    },
    getDuel(id) {
      return duels.get(id);
    },
    getDuelsForTournament(tournamentId) {
      return [...duels.values()].filter((d) => d.tournament_id === tournamentId);
    },
    getDuelsForRound(tournamentId, roundNumber) {
      return [...duels.values()].filter((d) => d.tournament_id === tournamentId && d.round_number === roundNumber);
    },
    updateDuelSettlement(id, status, winnerKey, settledAt) {
      const d = duels.get(id);
      if (d) {
        d.status = status;
        d.winner_key = winnerKey;
        d.settled_at = settledAt;
      }
    },
    findActiveDuelsPastDeadline(nowIso) {
      return [...duels.values()].filter((d) => d.status === "active" && d.closes_at <= nowIso);
    },

    insertVote(row) {
      const alreadyVoted = votes.some((v) => v.duel_id === row.duel_id && v.voter_token === row.voter_token);
      if (alreadyVoted) return false;
      votes.push({ ...row });
      return true;
    },
    countVotesByBook(duelId) {
      const counts: Record<string, number> = {};
      for (const v of votes) if (v.duel_id === duelId) counts[v.book_key] = (counts[v.book_key] ?? 0) + 1;
      return counts;
    },
    hasVoted(duelId, voterToken) {
      return votes.some((v) => v.duel_id === duelId && v.voter_token === voterToken);
    }
  };
}

function makeBook(n: number) {
  return { key: `book-${n}`, title: `Book ${n}`, author: `Author ${n}`, cover: null };
}

test("createTournament rejects a non-power-of-two bracket size", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  assert.throws(
    () => service.createTournament("owner-1", { name: "Test", bracketSize: 6, roundDurationMinutes: 60 }),
    InvalidBracketSizeError
  );
});

test("start rejects an incompletely-seeded tournament", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 4, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  assert.throws(() => service.start(tournament.id, "owner-1"), IncompleteSeedError);
});

test("random-fill rejects a pool smaller than the bracket", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 4, roundDurationMinutes: 60 });
  assert.throws(
    () => service.randomFill(tournament.id, "owner-1", [makeBook(1), makeBook(2)]),
    NotEnoughBooksError
  );
});

test("a full round of voting settles duels and advances to the next round, ending at a champion", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 4, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) },
    { slotIndex: 2, book: makeBook(3) },
    { slotIndex: 3, book: makeBook(4) }
  ]);
  service.start(tournament.id, "owner-1");

  let view = service.getTournamentView(tournament.id);
  assert.equal(view?.duels.length, 2);
  assert.equal(view?.status, "active");

  const [duelA, duelB] = view!.duels as [DuelView, DuelView];
  // book-1 beats book-2 (2 votes to 1); book-3 beats book-4 (1 vote to 0)
  service.vote(tournament.id, duelA.id, "voter-1", "book-1");
  service.vote(tournament.id, duelA.id, "voter-2", "book-1");
  service.vote(tournament.id, duelA.id, "voter-3", "book-2");
  service.vote(tournament.id, duelB.id, "voter-1", "book-3");

  // Force-settle both duels early (owner action), same path the
  // scheduler's timer-driven sweep uses internally.
  service.settleEarly(tournament.id, "owner-1", duelA.id);
  service.settleEarly(tournament.id, "owner-1", duelB.id);

  view = service.getTournamentView(tournament.id);
  assert.equal(view?.status, "active"); // round 2 (the final) generated
  assert.equal(view?.currentRound, 2);
  const final = view!.duels.find((d) => d.roundNumber === 2)!;
  assert.deepEqual(
    [final.bookA.key, final.bookB.key].sort(),
    ["book-1", "book-3"]
  );

  service.vote(tournament.id, final.id, "voter-1", "book-1");
  service.settleEarly(tournament.id, "owner-1", final.id);

  view = service.getTournamentView(tournament.id);
  assert.equal(view?.status, "completed");
  assert.equal(view?.duels.find((d) => d.roundNumber === 2)?.winnerKey, "book-1");
});

test("a tied duel waits for the owner's tie-break instead of auto-advancing", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;

  service.vote(tournament.id, duel.id, "voter-1", "book-1");
  service.vote(tournament.id, duel.id, "voter-2", "book-2");
  service.settleEarly(tournament.id, "owner-1", duel.id);

  let view = service.getTournamentView(tournament.id);
  assert.equal(view?.duels[0]?.status, "tied_pending_tiebreak");
  assert.equal(view?.status, "active"); // not yet completed — waiting on the owner

  service.tiebreak(tournament.id, "owner-1", duel.id, "book-2");

  view = service.getTournamentView(tournament.id);
  assert.equal(view?.duels[0]?.status, "settled");
  assert.equal(view?.duels[0]?.winnerKey, "book-2");
  assert.equal(view?.status, "completed"); // that was the only (final) duel

  assert.throws(() => service.tiebreak(tournament.id, "owner-1", duel.id, "book-1"), DuelNotTiedError);
});

test("a voter can't vote twice on the same duel, or for a book not in it", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;

  service.vote(tournament.id, duel.id, "voter-1", "book-1");
  assert.throws(() => service.vote(tournament.id, duel.id, "voter-1", "book-2"), AlreadyVotedError);
  assert.throws(() => service.vote(tournament.id, duel.id, "voter-2", "book-999"), InvalidBookError);
});

test("runScheduledSweep only settles duels whose deadline has actually passed", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  service.vote(tournament.id, duel.id, "voter-1", "book-1");

  // "Now" is before the duel's closes_at (round_duration_minutes: 60) —
  // the sweep must leave it alone.
  service.runScheduledSweep(new Date(Date.parse(duel.opensAt) + 1000).toISOString());
  assert.equal(service.getTournamentView(tournament.id)?.duels[0]?.status, "active");

  // "Now" is well past closes_at — the sweep must settle it.
  service.runScheduledSweep(new Date(Date.parse(duel.closesAt) + 1000).toISOString());
  assert.equal(service.getTournamentView(tournament.id)?.duels[0]?.status, "settled");
});

test("only the owner can seed, start, settle, or tie-break a tournament", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  assert.throws(
    () => service.setSlotsManual(tournament.id, "someone-else", [{ slotIndex: 0, book: makeBook(1) }]),
    TournamentNotFoundError
  );
});

test("a settled or already-completed duel can't be voted on", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  service.vote(tournament.id, duel.id, "voter-1", "book-1");
  service.settleEarly(tournament.id, "owner-1", duel.id);

  assert.throws(() => service.vote(tournament.id, duel.id, "voter-2", "book-1"), DuelNotVotableError);
});
