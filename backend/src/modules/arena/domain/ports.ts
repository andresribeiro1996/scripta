// Ports: everything the arena domain (service.ts) needs from the
// outside world. One repository port, same "SQLite in, plain rows out"
// shape as modules/library's own LibraryRepository — unlike gallery/
// covers, arena has no separate blob store, so there's nothing to split
// a second port out for.

import type { DuelRow, TournamentRow, TournamentSlotRow, VoteRow } from "./types.js";

export interface ArenaRepository {
  insertTournament(row: TournamentRow): void;
  getTournament(id: string): TournamentRow | undefined;
  /** Ownership-checked lookup — for anything that mutates a tournament
   *  (seed, start, delete) or an owner-only action on one of its duels. */
  getOwnedTournament(id: string, ownerUserId: string): TournamentRow | undefined;
  listTournamentsByOwner(ownerUserId: string): TournamentRow[];
  listPublicTournaments(limit: number, offset: number): TournamentRow[];
  updateTournamentStatus(id: string, status: TournamentRow["status"], currentRound: number): void;
  /** Renames only — nothing else about a tournament is editable after
   *  creation. `bracket_size` in particular is structural: slots and
   *  duels are laid out from it, so changing it would mean rebuilding
   *  both, which is a different (and much larger) operation than this. */
  renameTournament(id: string, name: string): void;
  /** Cascades to this tournament's slots/duels/votes (ON DELETE CASCADE
   *  in schema.sql) — see connection.ts's PRAGMA foreign_keys = ON. */
  deleteTournament(id: string): void;

  /** Full-replace, same semantics PUT /library already uses (see that
   *  module's own routes.ts comment) — deletes every existing slot for
   *  this tournament first, then inserts the given ones. */
  replaceSlots(tournamentId: string, slots: TournamentSlotRow[]): void;
  getSlots(tournamentId: string): TournamentSlotRow[];

  insertDuels(duels: DuelRow[]): void;
  getDuel(id: string): DuelRow | undefined;
  getDuelsForTournament(tournamentId: string): DuelRow[];
  getDuelsForRound(tournamentId: string, roundNumber: number): DuelRow[];
  updateDuelSettlement(id: string, status: DuelRow["status"], winnerKey: string | null, settledAt: string | null): void;
  /** Backs the scheduler's sweep (service.ts's runScheduledSweep) —
   *  every `status = 'active'` duel whose closes_at has passed. */
  findActiveDuelsPastDeadline(nowIso: string): DuelRow[];

  /** Returns `true` if this call actually inserted the vote, `false` if
   *  this exact (duel_id, voter_token) pair already voted — see the
   *  SQLite adapter's own comment for why (INSERT OR IGNORE, same
   *  race-safe idiom modules/covers already uses for first-write-wins). */
  insertVote(row: VoteRow): boolean;
  /** `{ [book_key]: count }` — only keys with at least one vote appear. */
  countVotesByBook(duelId: string): Record<string, number>;
  hasVoted(duelId: string, voterToken: string): boolean;
}
