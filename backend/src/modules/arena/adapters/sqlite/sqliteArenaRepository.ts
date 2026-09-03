// The SQLite implementation of the ArenaRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// ArenaRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { ArenaRepository } from "../../domain/ports.js";
import type { DuelRow, TournamentRow, TournamentSlotRow, VoteRow } from "../../domain/types.js";

export function createSqliteArenaRepository(db: DatabaseSync): ArenaRepository {
  const insertTournamentStmt = db.prepare(`
    INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status, current_round, created_at, updated_at)
    VALUES ($id, $owner_user_id, $name, $bracket_size, $round_duration_minutes, $status, $current_round, $created_at, $updated_at)
  `);
  const getTournamentStmt = db.prepare(`SELECT * FROM tournaments WHERE id = ?`);
  const getOwnedTournamentStmt = db.prepare(`SELECT * FROM tournaments WHERE id = ? AND owner_user_id = ?`);
  const listByOwnerStmt = db.prepare(`SELECT * FROM tournaments WHERE owner_user_id = ? ORDER BY created_at DESC`);
  const listPublicStmt = db.prepare(`SELECT * FROM tournaments WHERE status != 'seeding' ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const updateStatusStmt = db.prepare(`
    UPDATE tournaments SET status = $status, current_round = $current_round, updated_at = $updated_at WHERE id = $id
  `);
  const renameTournamentStmt = db.prepare(`
    UPDATE tournaments SET name = $name, updated_at = $updated_at WHERE id = $id
  `);
  const deleteTournamentStmt = db.prepare(`DELETE FROM tournaments WHERE id = ?`);

  const deleteSlotsStmt = db.prepare(`DELETE FROM tournament_slots WHERE tournament_id = ?`);
  const insertSlotStmt = db.prepare(`
    INSERT INTO tournament_slots (tournament_id, slot_index, book_key, title, author, cover_url)
    VALUES ($tournament_id, $slot_index, $book_key, $title, $author, $cover_url)
  `);
  const getSlotsStmt = db.prepare(`SELECT * FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index ASC`);

  const insertDuelStmt = db.prepare(`
    INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_a_cover,
      book_b_key, book_b_title, book_b_author, book_b_cover, winner_key, status, opens_at, closes_at, settled_at)
    VALUES ($id, $tournament_id, $round_number, $duel_index, $book_a_key, $book_a_title, $book_a_author, $book_a_cover,
      $book_b_key, $book_b_title, $book_b_author, $book_b_cover, $winner_key, $status, $opens_at, $closes_at, $settled_at)
  `);
  const getDuelStmt = db.prepare(`SELECT * FROM duels WHERE id = ?`);
  const getDuelsForTournamentStmt = db.prepare(`SELECT * FROM duels WHERE tournament_id = ? ORDER BY round_number ASC, duel_index ASC`);
  const getDuelsForRoundStmt = db.prepare(`SELECT * FROM duels WHERE tournament_id = ? AND round_number = ? ORDER BY duel_index ASC`);
  const updateDuelSettlementStmt = db.prepare(`
    UPDATE duels SET status = $status, winner_key = $winner_key, settled_at = $settled_at WHERE id = $id
  `);
  const findDueStmt = db.prepare(`SELECT * FROM duels WHERE status = 'active' AND closes_at <= ?`);

  // OR IGNORE, not a plain INSERT — two votes for the same (duel_id,
  // voter_token) racing (a double-click, a retried request) would
  // otherwise throw on the UNIQUE constraint instead of just quietly
  // staying "already voted" — same reasoning modules/covers' own
  // cover_cache insert already documents.
  const insertVoteStmt = db.prepare(`
    INSERT OR IGNORE INTO votes (id, duel_id, voter_token, book_key, created_at)
    VALUES ($id, $duel_id, $voter_token, $book_key, $created_at)
  `);
  const countVotesStmt = db.prepare(`SELECT book_key, COUNT(*) as n FROM votes WHERE duel_id = ? GROUP BY book_key`);
  const hasVotedStmt = db.prepare(`SELECT 1 FROM votes WHERE duel_id = ? AND voter_token = ?`);

  return {
    insertTournament(row) {
      insertTournamentStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $name: row.name,
        $bracket_size: row.bracket_size,
        $round_duration_minutes: row.round_duration_minutes,
        $status: row.status,
        $current_round: row.current_round,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },
    getTournament(id) {
      return getTournamentStmt.get(id) as TournamentRow | undefined;
    },
    getOwnedTournament(id, ownerUserId) {
      return getOwnedTournamentStmt.get(id, ownerUserId) as TournamentRow | undefined;
    },
    listTournamentsByOwner(ownerUserId) {
      return listByOwnerStmt.all(ownerUserId) as unknown as TournamentRow[];
    },
    listPublicTournaments(limit, offset) {
      return listPublicStmt.all(limit, offset) as unknown as TournamentRow[];
    },
    updateTournamentStatus(id, status, currentRound) {
      updateStatusStmt.run({ $id: id, $status: status, $current_round: currentRound, $updated_at: new Date().toISOString() });
    },
    renameTournament(id, name) {
      renameTournamentStmt.run({ $id: id, $name: name, $updated_at: new Date().toISOString() });
    },
    deleteTournament(id) {
      deleteTournamentStmt.run(id); // ON DELETE CASCADE removes its slots/duels/votes too
    },

    replaceSlots(tournamentId, slots) {
      deleteSlotsStmt.run(tournamentId);
      for (const slot of slots) {
        insertSlotStmt.run({
          $tournament_id: slot.tournament_id,
          $slot_index: slot.slot_index,
          $book_key: slot.book_key,
          $title: slot.title,
          $author: slot.author,
          $cover_url: slot.cover_url
        });
      }
    },
    getSlots(tournamentId) {
      return getSlotsStmt.all(tournamentId) as unknown as TournamentSlotRow[];
    },

    insertDuels(duels) {
      for (const duel of duels) {
        insertDuelStmt.run({
          $id: duel.id,
          $tournament_id: duel.tournament_id,
          $round_number: duel.round_number,
          $duel_index: duel.duel_index,
          $book_a_key: duel.book_a_key,
          $book_a_title: duel.book_a_title,
          $book_a_author: duel.book_a_author,
          $book_a_cover: duel.book_a_cover,
          $book_b_key: duel.book_b_key,
          $book_b_title: duel.book_b_title,
          $book_b_author: duel.book_b_author,
          $book_b_cover: duel.book_b_cover,
          $winner_key: duel.winner_key,
          $status: duel.status,
          $opens_at: duel.opens_at,
          $closes_at: duel.closes_at,
          $settled_at: duel.settled_at
        });
      }
    },
    getDuel(id) {
      return getDuelStmt.get(id) as DuelRow | undefined;
    },
    getDuelsForTournament(tournamentId) {
      return getDuelsForTournamentStmt.all(tournamentId) as unknown as DuelRow[];
    },
    getDuelsForRound(tournamentId, roundNumber) {
      return getDuelsForRoundStmt.all(tournamentId, roundNumber) as unknown as DuelRow[];
    },
    updateDuelSettlement(id, status, winnerKey, settledAt) {
      updateDuelSettlementStmt.run({ $id: id, $status: status, $winner_key: winnerKey, $settled_at: settledAt });
    },
    findActiveDuelsPastDeadline(nowIso) {
      return findDueStmt.all(nowIso) as unknown as DuelRow[];
    },

    insertVote(row) {
      const result = insertVoteStmt.run({
        $id: row.id,
        $duel_id: row.duel_id,
        $voter_token: row.voter_token,
        $book_key: row.book_key,
        $created_at: row.created_at
      });
      return result.changes > 0;
    },
    countVotesByBook(duelId) {
      const rows = countVotesStmt.all(duelId) as unknown as Array<{ book_key: string; n: number }>;
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.book_key] = row.n;
      return counts;
    },
    hasVoted(duelId, voterToken) {
      return hasVotedStmt.get(duelId, voterToken) !== undefined;
    }
  };
}
