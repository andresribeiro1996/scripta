// Business logic for the arena module. Depends only on the
// ArenaRepository port, not on SQLite — same reasoning as every other
// module's service.ts.
//
// The core mechanic: a duel is "settled" (differing votes → a winner) or
// "tied_pending_tiebreak" (equal votes → waits for the owner) via one
// shared internal settleDuelInternal, called either by the scheduler's
// timer-driven sweep (runScheduledSweep) or the owner's early-settle
// action (settleEarly) — both converge on identical tie-handling and
// round-advancement logic, just with a different `force` flag for
// whether closes_at must already have passed.

import { randomUUID } from "node:crypto";
import {
  AlreadyVotedError,
  DuelNotFoundError,
  DuelNotTiedError,
  DuelNotVotableError,
  DuplicateBookError,
  DuplicateSlotError,
  IncompleteSeedError,
  InvalidBookError,
  InvalidBracketSizeError,
  InvalidSlotIndexError,
  NotEnoughBooksError,
  TournamentNotFoundError
} from "./domain/errors.js";
import type { ArenaRepository } from "./domain/ports.js";
import type { DuelRow, SeedBookInput, TournamentRow, TournamentSlotRow } from "./domain/types.js";

export interface TournamentSummary {
  id: string;
  name: string;
  bracketSize: number;
  roundDurationMinutes: number;
  status: TournamentRow["status"];
  currentRound: number;
  createdAt: string;
  ownerUserId: string;
}

export interface DuelSideView extends SeedBookInput {
  votes: number;
}

export interface DuelView {
  id: string;
  roundNumber: number;
  duelIndex: number;
  bookA: DuelSideView;
  bookB: DuelSideView;
  winnerKey: string | null;
  status: DuelRow["status"];
  opensAt: string;
  closesAt: string;
  hasVoted: boolean;
}

export interface TournamentView extends TournamentSummary {
  slots: Array<{ slotIndex: number } & SeedBookInput>;
  duels: DuelView[];
}

export interface ArenaService {
  createTournament(ownerUserId: string, input: { name: string; bracketSize: number; roundDurationMinutes: number }): TournamentSummary;
  listMine(ownerUserId: string): TournamentSummary[];
  listPublic(limit: number, offset: number): TournamentSummary[];
  getTournamentView(id: string, voterToken?: string): TournamentView | null;
  setSlotsManual(tournamentId: string, ownerUserId: string, entries: Array<{ slotIndex: number; book: SeedBookInput }>): void;
  randomFill(tournamentId: string, ownerUserId: string, pool: SeedBookInput[]): void;
  start(tournamentId: string, ownerUserId: string): void;
  vote(tournamentId: string, duelId: string, voterToken: string, bookKey: string): void;
  settleEarly(tournamentId: string, ownerUserId: string, duelId: string): void;
  tiebreak(tournamentId: string, ownerUserId: string, duelId: string, winnerBookKey: string): void;
  deleteTournament(tournamentId: string, ownerUserId: string): void;
  runScheduledSweep(nowIso?: string): void;
}

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

function toTournamentSummary(row: TournamentRow): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    bracketSize: row.bracket_size,
    roundDurationMinutes: row.round_duration_minutes,
    status: row.status,
    currentRound: row.current_round,
    createdAt: row.created_at,
    ownerUserId: row.owner_user_id
  };
}

function winnerBookFromDuel(d: DuelRow): SeedBookInput {
  return d.winner_key === d.book_a_key
    ? { key: d.book_a_key, title: d.book_a_title, author: d.book_a_author, cover: d.book_a_cover }
    : { key: d.book_b_key, title: d.book_b_title, author: d.book_b_author, cover: d.book_b_cover };
}

function buildDuelsForRound(
  tournamentId: string,
  roundNumber: number,
  books: SeedBookInput[],
  opensAtIso: string,
  roundDurationMinutes: number
): DuelRow[] {
  const closesAt = new Date(new Date(opensAtIso).getTime() + roundDurationMinutes * 60_000).toISOString();
  const rows: DuelRow[] = [];
  for (let i = 0; i < books.length; i += 2) {
    const a = books[i]!;
    const b = books[i + 1]!;
    rows.push({
      id: randomUUID(),
      tournament_id: tournamentId,
      round_number: roundNumber,
      duel_index: i / 2,
      book_a_key: a.key,
      book_a_title: a.title,
      book_a_author: a.author,
      book_a_cover: a.cover,
      book_b_key: b.key,
      book_b_title: b.title,
      book_b_author: b.author,
      book_b_cover: b.cover,
      winner_key: null,
      status: "active",
      opens_at: opensAtIso,
      closes_at: closesAt,
      settled_at: null
    });
  }
  return rows;
}

export function createArenaService(repo: ArenaRepository): ArenaService {
  /** Checks whether every duel in a round has settled, and if so either
   *  generates the next round (from the winners, same pairing logic as
   *  the first round) or — if that round had exactly one duel — marks
   *  the tournament completed. Called after any duel settles, whether
   *  via the scheduler's sweep, an early settle, or a tie-break. */
  function maybeAdvanceRound(tournament: TournamentRow, roundNumber: number, nowIso: string): void {
    const roundDuels = repo.getDuelsForRound(tournament.id, roundNumber);
    if (roundDuels.some((d) => d.status !== "settled")) return;

    const winners = roundDuels.sort((a, b) => a.duel_index - b.duel_index).map(winnerBookFromDuel);

    if (winners.length === 1) {
      repo.updateTournamentStatus(tournament.id, "completed", roundNumber);
      return;
    }

    const nextRoundNumber = roundNumber + 1;
    const nextDuels = buildDuelsForRound(tournament.id, nextRoundNumber, winners, nowIso, tournament.round_duration_minutes);
    repo.insertDuels(nextDuels);
    repo.updateTournamentStatus(tournament.id, "active", nextRoundNumber);
  }

  /** Shared by runScheduledSweep (force: false — only settles if
   *  closes_at has passed) and settleEarly (force: true — the owner's
   *  "settle now" action). Idempotent: a duel that's no longer `active`
   *  (already settled, or already tied-pending) is left alone, so a
   *  scheduler tick racing an owner's early settle can't double-process
   *  the same duel. */
  function settleDuelInternal(tournament: TournamentRow, duel: DuelRow, force: boolean, nowIso: string): void {
    if (duel.status !== "active") return;
    if (!force && duel.closes_at > nowIso) return;

    const counts = repo.countVotesByBook(duel.id);
    const votesA = counts[duel.book_a_key] ?? 0;
    const votesB = counts[duel.book_b_key] ?? 0;

    if (votesA === votesB) {
      repo.updateDuelSettlement(duel.id, "tied_pending_tiebreak", null, null);
      return;
    }

    const winnerKey = votesA > votesB ? duel.book_a_key : duel.book_b_key;
    repo.updateDuelSettlement(duel.id, "settled", winnerKey, nowIso);
    maybeAdvanceRound(tournament, duel.round_number, nowIso);
  }

  function toDuelView(d: DuelRow, voterToken: string | undefined): DuelView {
    const counts = repo.countVotesByBook(d.id);
    return {
      id: d.id,
      roundNumber: d.round_number,
      duelIndex: d.duel_index,
      bookA: { key: d.book_a_key, title: d.book_a_title, author: d.book_a_author, cover: d.book_a_cover, votes: counts[d.book_a_key] ?? 0 },
      bookB: { key: d.book_b_key, title: d.book_b_title, author: d.book_b_author, cover: d.book_b_cover, votes: counts[d.book_b_key] ?? 0 },
      winnerKey: d.winner_key,
      status: d.status,
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      hasVoted: voterToken ? repo.hasVoted(d.id, voterToken) : false
    };
  }

  return {
    createTournament(ownerUserId, input) {
      if (!isPowerOfTwo(input.bracketSize)) throw new InvalidBracketSizeError();
      const now = new Date().toISOString();
      const row: TournamentRow = {
        id: randomUUID(),
        owner_user_id: ownerUserId,
        name: input.name,
        bracket_size: input.bracketSize,
        round_duration_minutes: input.roundDurationMinutes,
        status: "seeding",
        current_round: 0,
        created_at: now,
        updated_at: now
      };
      repo.insertTournament(row);
      return toTournamentSummary(row);
    },

    listMine(ownerUserId) {
      return repo.listTournamentsByOwner(ownerUserId).map(toTournamentSummary);
    },

    listPublic(limit, offset) {
      return repo.listPublicTournaments(limit, offset).map(toTournamentSummary);
    },

    getTournamentView(id, voterToken) {
      const tournament = repo.getTournament(id);
      if (!tournament) return null;
      const slots = repo.getSlots(id).sort((a, b) => a.slot_index - b.slot_index);
      const duels = repo
        .getDuelsForTournament(id)
        .sort((a, b) => a.round_number - b.round_number || a.duel_index - b.duel_index);
      return {
        ...toTournamentSummary(tournament),
        slots: slots.map((s) => ({ slotIndex: s.slot_index, key: s.book_key, title: s.title, author: s.author, cover: s.cover_url })),
        duels: duels.map((d) => toDuelView(d, voterToken))
      };
    },

    setSlotsManual(tournamentId, ownerUserId, entries) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();

      const indices = new Set(entries.map((e) => e.slotIndex));
      if (indices.size !== entries.length) throw new DuplicateSlotError();
      if (entries.some((e) => e.slotIndex < 0 || e.slotIndex >= tournament.bracket_size)) {
        throw new InvalidSlotIndexError(tournament.bracket_size);
      }
      const keys = new Set(entries.map((e) => e.book.key));
      if (keys.size !== entries.length) throw new DuplicateBookError();

      // Full-replace, same semantics as PUT /library — see this module's
      // own domain/ports.ts comment on replaceSlots.
      const rows: TournamentSlotRow[] = entries.map((e) => ({
        tournament_id: tournamentId,
        slot_index: e.slotIndex,
        book_key: e.book.key,
        title: e.book.title,
        author: e.book.author,
        cover_url: e.book.cover
      }));
      repo.replaceSlots(tournamentId, rows);
    },

    randomFill(tournamentId, ownerUserId, pool) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      if (pool.length < tournament.bracket_size) throw new NotEnoughBooksError(tournament.bracket_size, pool.length);

      // Fisher-Yates.
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const chosen = shuffled.slice(0, tournament.bracket_size);
      const rows: TournamentSlotRow[] = chosen.map((book, i) => ({
        tournament_id: tournamentId,
        slot_index: i,
        book_key: book.key,
        title: book.title,
        author: book.author,
        cover_url: book.cover
      }));
      repo.replaceSlots(tournamentId, rows);
    },

    start(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const slots = repo.getSlots(tournamentId).sort((a, b) => a.slot_index - b.slot_index);
      if (slots.length !== tournament.bracket_size) throw new IncompleteSeedError(tournament.bracket_size, slots.length);

      const books: SeedBookInput[] = slots.map((s) => ({ key: s.book_key, title: s.title, author: s.author, cover: s.cover_url }));
      const nowIso = new Date().toISOString();
      const duels = buildDuelsForRound(tournamentId, 1, books, nowIso, tournament.round_duration_minutes);
      repo.insertDuels(duels);
      repo.updateTournamentStatus(tournamentId, "active", 1);
    },

    vote(tournamentId, duelId, voterToken, bookKey) {
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      if (duel.status !== "active" || new Date() >= new Date(duel.closes_at)) throw new DuelNotVotableError();
      if (bookKey !== duel.book_a_key && bookKey !== duel.book_b_key) throw new InvalidBookError();

      const inserted = repo.insertVote({
        id: randomUUID(),
        duel_id: duelId,
        voter_token: voterToken,
        book_key: bookKey,
        created_at: new Date().toISOString()
      });
      if (!inserted) throw new AlreadyVotedError();
    },

    settleEarly(tournamentId, ownerUserId, duelId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      settleDuelInternal(tournament, duel, true, new Date().toISOString());
    },

    tiebreak(tournamentId, ownerUserId, duelId, winnerBookKey) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      if (duel.status !== "tied_pending_tiebreak") throw new DuelNotTiedError();
      if (winnerBookKey !== duel.book_a_key && winnerBookKey !== duel.book_b_key) throw new InvalidBookError();

      const nowIso = new Date().toISOString();
      repo.updateDuelSettlement(duelId, "settled", winnerBookKey, nowIso);
      maybeAdvanceRound(tournament, duel.round_number, nowIso);
    },

    deleteTournament(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      repo.deleteTournament(tournamentId);
    },

    runScheduledSweep(nowIso = new Date().toISOString()) {
      for (const duel of repo.findActiveDuelsPastDeadline(nowIso)) {
        const tournament = repo.getTournament(duel.tournament_id);
        if (!tournament) continue; // shouldn't happen (ON DELETE CASCADE), but never let one bad row crash the sweep
        settleDuelInternal(tournament, duel, false, nowIso);
      }
    }
  };
}
