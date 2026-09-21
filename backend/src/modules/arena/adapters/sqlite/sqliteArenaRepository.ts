// The SQLite implementation of the ArenaRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// ArenaRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { ArenaRepository } from "../../domain/ports.js";
import type { DuelRow, SeedPreview, TournamentRow, TournamentSlotRow, VoteRow } from "../../domain/types.js";

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
  // One statement for a whole page of cards. The IN list is built per call
  // because better-sqlite3 has no array binding — the ids come from rows this
  // module just read, never from a request, and each is still a bound `?`.
  const seedPreviewStmt = (count: number) =>
    db.prepare(
      `SELECT tournament_id, slot_index, cover_url FROM tournament_slots ` +
        `WHERE tournament_id IN (${new Array(count).fill("?").join(", ")}) ` +
        `ORDER BY tournament_id ASC, slot_index ASC`
    );

  const insertDuelStmt = db.prepare(`
    INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_a_cover,
      book_b_key, book_b_title, book_b_author, book_b_cover, winner_key, status, opens_at, closes_at, settled_at)
    VALUES ($id, $tournament_id, $round_number, $duel_index, $book_a_key, $book_a_title, $book_a_author, $book_a_cover,
      $book_b_key, $book_b_title, $book_b_author, $book_b_cover, $winner_key, $status, $opens_at, $closes_at, $settled_at)
  `);
  const getDuelStmt = db.prepare(`SELECT * FROM duels WHERE id = ?`);
  const getDuelsForTournamentStmt = db.prepare(`SELECT * FROM duels WHERE tournament_id = ? ORDER BY round_number ASC, duel_index ASC`);
  const getDuelsForRoundStmt = db.prepare(`SELECT * FROM duels WHERE tournament_id = ? AND round_number = ? ORDER BY duel_index ASC`);
  // Same dynamic-IN-list idiom as seedPreviewStmt. The correlated subquery
  // picks each tournament's own highest round_number — idx_duels_tournament_round
  // (schema.sql) makes that cheap per row.
  const finalDuelsStmt = (count: number) =>
    db.prepare(
      `SELECT * FROM duels d WHERE d.tournament_id IN (${new Array(count).fill("?").join(", ")}) ` +
        `AND d.round_number = (SELECT MAX(d2.round_number) FROM duels d2 WHERE d2.tournament_id = d.tournament_id)`
    );
  const updateDuelSettlementStmt = db.prepare(`
    UPDATE duels SET status = $status, winner_key = $winner_key, settled_at = $settled_at WHERE id = $id
  `);
  const findDueStmt = db.prepare(`SELECT * FROM duels WHERE status = 'active' AND closes_at <= ?`);

  // OR IGNORE, not a plain INSERT — two votes for the same (duel_id,
  // voter_token) racing (a double-click, a retried request) would
  // otherwise throw on the UNIQUE constraint instead of just quietly
  // staying "already voted" — same reasoning modules/covers' own
  // cover_cache insert already documents. Since idx_votes_duel_user
  // (schema.sql), OR IGNORE equally absorbs the signed-in case: a second
  // token voting a duel the ACCOUNT already voted conflicts on that
  // partial unique index, so a signed-in voter can't inflate a tally by
  // minting fresh tokens.
  const insertVoteStmt = db.prepare(`
    INSERT OR IGNORE INTO votes (id, duel_id, voter_token, voter_user_id, book_key, created_at)
    VALUES ($id, $duel_id, $voter_token, $voter_user_id, $book_key, $created_at)
  `);
  // Backfill only — never overwrites an account already stamped onto a
  // vote (voter_user_id IS NULL guard), so two accounts sharing a browser
  // can't rewrite each other's history after the first claim. The NOT
  // EXISTS guard keeps the backfill clear of idx_votes_duel_user: a token
  // whose old anonymous vote shares a duel with a vote the account
  // already holds stays anonymous rather than violating the index.
  const linkVotesStmt = db.prepare(
    `UPDATE votes SET voter_user_id = $user WHERE voter_token = $token AND voter_user_id IS NULL ` +
      `AND NOT EXISTS (SELECT 1 FROM votes v2 WHERE v2.duel_id = votes.duel_id AND v2.voter_user_id = $user)`
  );
  const countVotesStmt = db.prepare(`SELECT book_key, COUNT(*) as n FROM votes WHERE duel_id = ? GROUP BY book_key`);
  // Token match OR account match: "" and NULL binds can never equal a
  // stored value, so each dimension simply doesn't constrain when absent.
  const hasVotedStmt = db.prepare(
    `SELECT 1 FROM votes WHERE duel_id = ? AND (voter_token = ? OR voter_user_id = ?) LIMIT 1`
  );
  // GROUP BY t.id with the MAX aggregate in ORDER BY — SQLite allows the
  // aggregate without selecting it. Own tournaments are excluded because
  // they already appear in the owner list; a tournament can only be voted
  // in once started, so no seeding-status filter is needed.
  const listVotedByUserStmt = db.prepare(`
    SELECT t.*, MAX(v.created_at) AS last_vote_at
    FROM votes v
    JOIN duels d ON d.id = v.duel_id
    JOIN tournaments t ON t.id = d.tournament_id
    WHERE v.voter_user_id = ? AND t.owner_user_id != ?
    GROUP BY t.id
    ORDER BY last_vote_at DESC
  `);

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

    getSeedPreviews(tournamentIds, coverLimit) {
      const previews = new Map<string, SeedPreview>();
      if (tournamentIds.length === 0) return previews;
      const rows = seedPreviewStmt(tournamentIds.length).all(...tournamentIds) as unknown as Array<
        Pick<TournamentSlotRow, "tournament_id" | "cover_url">
      >;
      for (const row of rows) {
        const preview = previews.get(row.tournament_id) ?? { covers: [], filledSlots: 0 };
        preview.filledSlots += 1;
        if (row.cover_url && preview.covers.length < coverLimit) preview.covers.push(row.cover_url);
        previews.set(row.tournament_id, preview);
      }
      return previews;
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
    getFinalDuels(tournamentIds) {
      if (tournamentIds.length === 0) return [];
      return finalDuelsStmt(tournamentIds.length).all(...tournamentIds) as unknown as DuelRow[];
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
        $voter_user_id: row.voter_user_id,
        $book_key: row.book_key,
        $created_at: row.created_at
      });
      return result.changes > 0;
    },
    linkVotesToUser(voterToken, voterUserId) {
      linkVotesStmt.run({ $token: voterToken, $user: voterUserId });
    },
    countVotesByBook(duelId) {
      const rows = countVotesStmt.all(duelId) as unknown as Array<{ book_key: string; n: number }>;
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.book_key] = row.n;
      return counts;
    },
    hasVoted(duelId, voterToken, voterUserId) {
      return hasVotedStmt.get(duelId, voterToken ?? "", voterUserId ?? null) !== undefined;
    },
    listVotedByUser(voterUserId) {
      return listVotedByUserStmt.all(voterUserId, voterUserId) as unknown as TournamentRow[];
    }
  };
}
