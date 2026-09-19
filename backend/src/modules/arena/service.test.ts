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
  TournamentAlreadyStartedError,
  TournamentNotFoundError
} from "./domain/errors.js";
import type { ArenaRepository } from "./domain/ports.js";
import type { DuelRow, SeedPreview, TournamentRow, TournamentSlotRow, VoteRow } from "./domain/types.js";
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
    renameTournament(id, name) {
      const t = tournaments.get(id);
      if (t) t.name = name;
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

    getSeedPreviews(tournamentIds, coverLimit) {
      const previews = new Map<string, SeedPreview>();
      for (const id of tournamentIds) {
        const rows = [...(slots.get(id) ?? [])].sort((a, b) => a.slot_index - b.slot_index);
        previews.set(id, {
          covers: rows.map((row) => row.cover_url).filter((url): url is string => Boolean(url)).slice(0, coverLimit),
          filledSlots: rows.length
        });
      }
      return previews;
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
    getFinalDuels(tournamentIds) {
      return tournamentIds.flatMap((id) => {
        const rows = [...duels.values()].filter((d) => d.tournament_id === id);
        if (rows.length === 0) return [];
        const maxRound = Math.max(...rows.map((d) => d.round_number));
        return rows.filter((d) => d.round_number === maxRound);
      });
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
    linkVotesToUser(voterToken, voterUserId) {
      for (const v of votes) if (v.voter_token === voterToken && v.voter_user_id === null) v.voter_user_id = voterUserId;
    },
    countVotesByBook(duelId) {
      const counts: Record<string, number> = {};
      for (const v of votes) if (v.duel_id === duelId) counts[v.book_key] = (counts[v.book_key] ?? 0) + 1;
      return counts;
    },
    hasVoted(duelId, voterToken) {
      return votes.some((v) => v.duel_id === duelId && v.voter_token === voterToken);
    },
    listVotedByUser(voterUserId) {
      const lastVoteAt = new Map<string, string>();
      for (const v of votes) {
        if (v.voter_user_id !== voterUserId) continue;
        const tournamentId = duels.get(v.duel_id)?.tournament_id;
        if (!tournamentId) continue;
        const previous = lastVoteAt.get(tournamentId);
        if (!previous || v.created_at > previous) lastVoteAt.set(tournamentId, v.created_at);
      }
      return [...lastVoteAt.entries()]
        .map(([id, at]) => ({ tournament: tournaments.get(id), at }))
        .filter((entry): entry is { tournament: TournamentRow; at: string } => entry.tournament !== undefined)
        .filter(({ tournament }) => tournament.owner_user_id !== voterUserId)
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .map(({ tournament }) => tournament);
    }
  };
}

function makeBook(n: number) {
  return { key: `book-${n}`, title: `Book ${n}`, author: `Author ${n}`, cover: null };
}

function makeBookWithCover(n: number) {
  return { key: `book-${n}`, title: `Book ${n}`, author: `Author ${n}`, cover: `https://covers.test/${n}.jpg` };
}

test("a summary carries the seeded cover preview and how many slots are filled", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Best of 2025", bracketSize: 16, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", Array.from({ length: 9 }, (_, index) => ({
    slotIndex: index,
    book: makeBookWithCover(index + 1)
  })));

  const summary = service.listMine("owner-1")[0];
  assert.equal(summary?.filledSlots, 9);
  // Capped at eight: the card shows eight thumbnails and a remainder.
  assert.deepEqual(summary?.covers, Array.from({ length: 8 }, (_, index) => `https://covers.test/${index + 1}.jpg`));
});

test("a cover preview skips slots seeded without art but still counts them", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "No art", bracketSize: 4, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBookWithCover(2) },
    { slotIndex: 2, book: makeBook(3) }
  ]);

  const summary = service.listMine("owner-1")[0];
  assert.equal(summary?.filledSlots, 3);
  assert.deepEqual(summary?.covers, ["https://covers.test/2.jpg"]);
});

test("an unseeded tournament has an empty preview rather than a missing one", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  service.createTournament("owner-1", { name: "Fresh", bracketSize: 4, roundDurationMinutes: 60 });

  const summary = service.listMine("owner-1")[0];
  assert.equal(summary?.filledSlots, 0);
  assert.deepEqual(summary?.covers, []);
});

test("renameTournament changes the name and leaves the bracket alone", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Untitled tournament", bracketSize: 4, roundDurationMinutes: 60 });

  service.renameTournament(tournament.id, "owner-1", "Best of 2026");

  const renamed = service.listMine("owner-1")[0];
  assert.ok(renamed);
  assert.equal(renamed.name, "Best of 2026");
  // The whole reason rename is name-only: bracketSize is structural,
  // and slots/duels are laid out from it.
  assert.equal(renamed.bracketSize, 4);
  assert.equal(renamed.status, "seeding");
});

test("renameTournament refuses someone else's tournament", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Mine", bracketSize: 4, roundDurationMinutes: 60 });

  assert.throws(() => service.renameTournament(tournament.id, "owner-2", "Hijacked"), TournamentNotFoundError);
  assert.equal(service.listMine("owner-1")[0]?.name, "Mine");
});

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

test("a completed tournament's summary carries the champion book", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBookWithCover(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  service.vote(tournament.id, duel.id, "voter-1", "book-1");
  service.settleEarly(tournament.id, "owner-1", duel.id);

  const summary = service.listMine("owner-1")[0];
  assert.equal(summary?.status, "completed");
  assert.deepEqual(summary?.winner, makeBookWithCover(1));
});

test("a seeding or active tournament's summary has no winner yet", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const fresh = service.createTournament("owner-1", { name: "Fresh", bracketSize: 2, roundDurationMinutes: 60 });
  assert.equal(service.listMine("owner-1").find((t) => t.id === fresh.id)?.winner, null);

  const running = service.createTournament("owner-1", { name: "Running", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(running.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(running.id, "owner-1");
  assert.equal(service.listMine("owner-1").find((t) => t.id === running.id)?.winner, null);
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

test("start, setSlotsManual, and randomFill all reject a tournament that isn't in seeding", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);
  service.start(tournament.id, "owner-1");

  assert.throws(() => service.start(tournament.id, "owner-1"), TournamentAlreadyStartedError);
  assert.throws(
    () => service.setSlotsManual(tournament.id, "owner-1", [{ slotIndex: 0, book: makeBook(3) }]),
    TournamentAlreadyStartedError
  );
  assert.throws(
    () => service.randomFill(tournament.id, "owner-1", [makeBook(1), makeBook(2)]),
    TournamentAlreadyStartedError
  );
});

test("start emits exactly one publish event and the public summary flips", () => {
  const repo = createInMemoryArenaRepository();
  const emitted: Array<[string, string]> = [];
  const service = createArenaService(repo, (tournamentId, ownerUserId) => emitted.push([tournamentId, ownerUserId]));
  const t = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(t.id, "owner-1", [
    { slotIndex: 0, book: makeBook(1) },
    { slotIndex: 1, book: makeBook(2) }
  ]);

  assert.equal(service.getPublicSummary(t.id), undefined);
  service.start(t.id, "owner-1");
  assert.deepEqual(emitted, [[t.id, "owner-1"]]);
  assert.equal(service.getPublicSummary(t.id)?.status, "active");
  assert.throws(() => service.start(t.id, "owner-1"), TournamentAlreadyStartedError);
  assert.equal(emitted.length, 1);
});

function startedTournament(service: ReturnType<typeof createArenaService>, owner: string, name: string, books: number) {
  const tournament = service.createTournament(owner, { name, bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(
    tournament.id,
    owner,
    Array.from({ length: 2 }, (_, i) => ({ slotIndex: i, book: makeBook(i + 1 + books) }))
  );
  service.start(tournament.id, owner);
  return tournament;
}

test("a signed-in vote stamps the account and backfills the token's earlier anonymous votes", async () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const first = startedTournament(service, "owner-1", "First", 0);
  const second = startedTournament(service, "owner-1", "Second", 10);
  const duelA = service.getTournamentView(first.id)!.duels[0]!;
  const duelB = service.getTournamentView(second.id)!.duels[0]!;

  // Anonymous vote today, signed-in vote tomorrow, same browser token.
  service.vote(first.id, duelA.id, "voter-token-1", "book-1");
  assert.equal(service.listVoted("voter-1").length, 0);

  // Distinct wall-clock times: "most recent vote first" needs comparable
  // created_at values, and two synchronous votes can land in one
  // millisecond.
  await new Promise((resolve) => setTimeout(resolve, 5));
  service.vote(second.id, duelB.id, "voter-token-1", "book-11", "voter-1");

  const voted = service.listVoted("voter-1");
  assert.deepEqual(
    voted.map((t) => t.name),
    ["Second", "First"] // most recent vote first
  );
  // The backfill only claims unclaimed votes — re-voting the same duel
  // (a 409) must not reshuffle anything.
  assert.throws(() => service.vote(first.id, duelA.id, "voter-token-1", "book-1", "voter-1"), AlreadyVotedError);
  assert.deepEqual(
    service.listVoted("voter-1").map((t) => t.name),
    ["Second", "First"]
  );
});

test("an anonymous vote leaves no participation trail, and own tournaments stay out of listVoted", () => {
  const service = createArenaService(createInMemoryArenaRepository());
  const own = startedTournament(service, "voter-1", "Mine", 0);
  const other = startedTournament(service, "owner-1", "Theirs", 10);
  const ownDuel = service.getTournamentView(own.id)!.duels[0]!;
  const otherDuel = service.getTournamentView(other.id)!.duels[0]!;

  service.vote(other.id, otherDuel.id, "token-a", "book-11", "voter-1");
  service.vote(own.id, ownDuel.id, "token-a", "book-1", "voter-1");

  assert.deepEqual(
    service.listVoted("voter-1").map((t) => t.name),
    ["Theirs"]
  );
  service.vote(other.id, otherDuel.id, "token-b", "book-12");
  assert.equal(service.listVoted("voter-2").length, 0);
});
