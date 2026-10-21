// The SQLite implementation of the ArenaRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// ArenaRepository interface this fulfills.

import { normalizeWords } from "@scripta/shared";
import type { TournamentRecord } from "@scripta/shared";
import type { DatabaseSync } from "node:sqlite";
import type { ArenaRepository } from "../../domain/ports.js";
import type { CompletedVotedRow, DuelRow, SeedPreview, TournamentDiscoverRow, TournamentGameRow, TournamentRow, TournamentShelfFacts, TournamentSlotRow, VoteRow } from "../../domain/types.js";

export function createSqliteArenaRepository(db: DatabaseSync): ArenaRepository {
  const insertTournamentStmt = db.prepare(`
    INSERT INTO tournaments (id, owner_user_id, name, name_key, bracket_size, round_duration_minutes, status, current_round, created_at, updated_at)
    VALUES ($id, $owner_user_id, $name, $name_key, $bracket_size, $round_duration_minutes, $status, $current_round, $created_at, $updated_at)
  `);
  const getTournamentStmt = db.prepare(`SELECT * FROM tournaments WHERE id = ?`);
  const getOwnedTournamentStmt = db.prepare(`SELECT * FROM tournaments WHERE id = ? AND owner_user_id = ?`);
  const listByOwnerStmt = db.prepare(`SELECT * FROM tournaments WHERE owner_user_id = ? ORDER BY created_at DESC`);
  const listPublicStmt = db.prepare(`SELECT * FROM tournaments WHERE status != 'seeding' ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const discoverWindowStmt = db.prepare(`SELECT id, created_at, owner_user_id FROM tournaments WHERE status != 'seeding' ORDER BY created_at DESC LIMIT ?`);
  const discoverSearchStmt = db.prepare(
    `SELECT id, created_at, owner_user_id FROM tournaments WHERE status != 'seeding' AND name_key LIKE '%' || ? || '%' ORDER BY created_at DESC LIMIT ?`
  );
  const listPublishedByWorksStmt = db.prepare(`
    SELECT DISTINCT t.id, t.name, t.owner_user_id, t.created_at
    FROM tournament_slots s JOIN tournaments t ON t.id = s.tournament_id
    WHERE s.work_id IN (SELECT value FROM json_each(?)) AND t.status != 'seeding'
    ORDER BY t.created_at DESC LIMIT ?
  `);
  const shelfTournamentsStmt = db.prepare(`
    SELECT t.id, t.owner_user_id, t.created_at, t.status,
      (SELECT COUNT(DISTINCT COALESCE(v.voter_user_id, v.voter_token)) FROM votes v JOIN duels d ON d.id = v.duel_id
        WHERE d.tournament_id = t.id AND (v.voter_user_id IS NULL OR v.voter_user_id != t.owner_user_id)) AS voters,
      (SELECT COUNT(*) FROM votes v JOIN duels d ON d.id = v.duel_id
        WHERE d.tournament_id = t.id AND (v.voter_user_id IS NULL OR v.voter_user_id != t.owner_user_id) AND ($since IS NULL OR v.created_at >= $since)) AS votes_since
    FROM tournaments t WHERE t.status != 'seeding'
  `);
  const shelfWorksStmt = db.prepare(`
    SELECT DISTINCT s.tournament_id, s.work_id FROM tournament_slots s JOIN tournaments t ON t.id = s.tournament_id
    WHERE s.work_id IS NOT NULL AND t.status != 'seeding'
  `);
  const shelfFinalsStmt = db.prepare(`
    SELECT d.tournament_id,
      CASE d.winner_side WHEN 'a' THEN d.book_a_work_id ELSE d.book_b_work_id END AS work_id,
      d.settled_at
    FROM duels d JOIN tournaments t ON t.id = d.tournament_id AND t.status = 'completed'
    WHERE d.round_number = (SELECT MAX(d2.round_number) FROM duels d2 WHERE d2.tournament_id = d.tournament_id)
      AND d.winner_side IS NOT NULL AND d.settled_at IS NOT NULL
  `);
  const shareTournamentStmt = db.prepare(`
    SELECT 1 AS shared FROM tournament_slots a JOIN tournament_slots b ON b.tournament_id = a.tournament_id
    WHERE a.work_id IN (SELECT value FROM json_each(?)) AND b.work_id IN (SELECT value FROM json_each(?))
    LIMIT 1
  `);
  const enteredByWorksStmt = db.prepare(`
    SELECT DISTINCT t.id, t.status, t.bracket_size
    FROM tournament_slots s JOIN tournaments t ON t.id = s.tournament_id
    WHERE s.work_id IN (SELECT value FROM json_each(?)) AND t.status != 'seeding'
  `);
  const duelsOfTournamentsStmt = db.prepare(`
    SELECT d.tournament_id, d.round_number, d.winner_side, d.book_a_work_id, d.book_b_work_id
    FROM duels d
    WHERE d.tournament_id IN (SELECT value FROM json_each(?))
  `);
  const listPublicByIdsStmt = db.prepare(`SELECT * FROM tournaments WHERE status != 'seeding' AND id IN (SELECT value FROM json_each(?))`);
  const updateStatusStmt = db.prepare(`
    UPDATE tournaments SET status = $status, current_round = $current_round, updated_at = $updated_at WHERE id = $id
  `);
  const renameTournamentStmt = db.prepare(`
    UPDATE tournaments SET name = $name, name_key = $name_key, updated_at = $updated_at WHERE id = $id
  `);
  const deleteTournamentStmt = db.prepare(`DELETE FROM tournaments WHERE id = ?`);

  const deleteSlotsStmt = db.prepare(`DELETE FROM tournament_slots WHERE tournament_id = ?`);
  const insertSlotStmt = db.prepare(`
    INSERT INTO tournament_slots (tournament_id, slot_index, work_id, title, author, cover_url)
    VALUES ($tournament_id, $slot_index, $work_id, $title, $author, $cover_url)
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
    INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_work_id, book_a_title, book_a_author, book_a_cover,
      book_b_work_id, book_b_title, book_b_author, book_b_cover, winner_side, status, opens_at, closes_at, settled_at)
    VALUES ($id, $tournament_id, $round_number, $duel_index, $book_a_work_id, $book_a_title, $book_a_author, $book_a_cover,
      $book_b_work_id, $book_b_title, $book_b_author, $book_b_cover, $winner_side, $status, $opens_at, $closes_at, $settled_at)
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
    UPDATE duels SET status = $status, winner_side = $winner_side, settled_at = $settled_at WHERE id = $id
  `);
  const findDueStmt = db.prepare(`SELECT * FROM duels WHERE status = 'active' AND closes_at <= ?`);

  // OR IGNORE, not a plain INSERT — two votes for the same (duel_id,
  // voter_token) racing (a double-click, a retried request) would
  // otherwise throw on the UNIQUE constraint instead of just quietly
  // staying "already voted". Since idx_votes_duel_user (schema.sql),
  // OR IGNORE equally absorbs the signed-in case: a second
  // token voting a duel the ACCOUNT already voted conflicts on that
  // partial unique index, so a signed-in voter can't inflate a tally by
  // minting fresh tokens.
  const insertVoteStmt = db.prepare(`
    INSERT OR IGNORE INTO votes (id, duel_id, voter_token, voter_user_id, side, created_at)
    VALUES ($id, $duel_id, $voter_token, $voter_user_id, $side, $created_at)
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
  const countVotesStmt = db.prepare(`SELECT side, COUNT(*) AS n FROM votes WHERE duel_id = ? GROUP BY side`);
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
  const completedVotedSinceStmt = db.prepare(`
    SELECT t.*, f.winner_side, f.settled_at,
      f.book_a_title, f.book_a_author, f.book_a_cover, f.book_a_work_id,
      f.book_b_title, f.book_b_author, f.book_b_cover, f.book_b_work_id
    FROM tournaments t
    JOIN duels f ON f.tournament_id = t.id
      AND f.round_number = (SELECT MAX(d2.round_number) FROM duels d2 WHERE d2.tournament_id = t.id)
    WHERE t.id IN (
        SELECT d.tournament_id FROM votes v JOIN duels d ON d.id = v.duel_id WHERE v.voter_user_id = ?
      )
      AND t.owner_user_id != ? AND t.status = 'completed'
      AND f.status = 'settled' AND f.winner_side IS NOT NULL AND f.settled_at >= ?
  `);
  const votedAmongStmt = db.prepare(`
    SELECT t.id FROM tournaments t
    WHERE t.id IN (SELECT value FROM json_each(?)) AND t.owner_user_id != ?
      AND EXISTS (SELECT 1 FROM duels d JOIN votes v ON v.duel_id = d.id WHERE d.tournament_id = t.id AND v.voter_user_id = ?)
  `);
  const participationStmt = db.prepare(`
    SELECT t.id, t.name, COUNT(*) AS participants, MAX(p.first_at) AS latest_at
    FROM (
      SELECT d.tournament_id, COALESCE(v.voter_user_id, v.voter_token) AS voter, MIN(v.created_at) AS first_at, MAX(v.created_at) AS last_at
      FROM votes v
      JOIN duels d ON d.id = v.duel_id
      JOIN tournaments o ON o.id = d.tournament_id
      WHERE o.owner_user_id = ? AND (v.voter_user_id IS NULL OR v.voter_user_id != o.owner_user_id)
      GROUP BY d.tournament_id, voter
    ) p
    JOIN tournaments t ON t.id = p.tournament_id
    WHERE t.status != 'seeding'
    GROUP BY t.id
    HAVING MAX(p.last_at) >= ?
  `);
  const recentVotersStmt = db.prepare(`
    SELECT v.voter_user_id AS user_id, MIN(v.created_at) AS at
    FROM votes v JOIN duels d ON d.id = v.duel_id
    WHERE d.tournament_id = ? AND v.voter_user_id IS NOT NULL AND v.voter_user_id != ?
    GROUP BY v.voter_user_id ORDER BY at DESC LIMIT ?
  `);

  return {
    deleteUserData(userId) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM tournaments WHERE owner_user_id = ?").run(userId);
        db.prepare("UPDATE votes SET voter_user_id = NULL WHERE voter_user_id = ?").run(userId);
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
    insertTournament(row) {
      insertTournamentStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $name: row.name,
        $name_key: normalizeWords(row.name),
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
    discoverWindow(needle, limit) {
      const rows = needle ? discoverSearchStmt.all(needle, limit) : discoverWindowStmt.all(limit);
      return rows as unknown as TournamentDiscoverRow[];
    },
    worksShareATournament(aIds, bIds) {
      return shareTournamentStmt.get(JSON.stringify(aIds), JSON.stringify(bIds)) !== undefined;
    },
    listPublishedByWorks(workIds, limit) {
      if (workIds.length === 0) return [];
      return listPublishedByWorksStmt.all(JSON.stringify(workIds), limit) as unknown as TournamentGameRow[];
    },
    tournamentRecord(workIds) {
      const record: TournamentRecord = { entered: 0, titles: 0, wins: 0, losses: 0, best: null };
      if (workIds.length === 0) return record;
      const works = new Set(workIds);
      const tournaments = new Map(
        (enteredByWorksStmt.all(JSON.stringify(workIds)) as unknown as Array<{ id: string; status: string; bracket_size: number }>).map((row) => [row.id, row])
      );
      record.entered = tournaments.size;
      if (tournaments.size === 0) return record;
      const duels = duelsOfTournamentsStmt.all(JSON.stringify([...tournaments.keys()])) as unknown as Array<{
        tournament_id: string;
        round_number: number;
        winner_side: "a" | "b" | null;
        book_a_work_id: string | null;
        book_b_work_id: string | null;
      }>;
      for (const duel of duels) {
        const side = duel.book_a_work_id && works.has(duel.book_a_work_id) ? "a" : duel.book_b_work_id && works.has(duel.book_b_work_id) ? "b" : null;
        const tournament = tournaments.get(duel.tournament_id);
        if (!side || !tournament) continue;
        const duelsInRound = tournament.bracket_size / 2 ** duel.round_number;
        if (!record.best || duelsInRound < record.best.duels) record.best = { round: duel.round_number, duels: duelsInRound };
        if (duel.winner_side === null) continue;
        if (duel.winner_side !== side) record.losses += 1;
        else {
          record.wins += 1;
          if (tournament.status === "completed" && duelsInRound === 1) record.titles += 1;
        }
      }
      return record;
    },
    topShelfFacts(since) {
      const works = new Map<string, string[]>();
      for (const row of shelfWorksStmt.all() as unknown as Array<{ tournament_id: string; work_id: string }>) {
        const ids = works.get(row.tournament_id);
        if (ids) ids.push(row.work_id);
        else works.set(row.tournament_id, [row.work_id]);
      }
      const champions = new Map<string, { workId: string; settledAt: string }>();
      for (const row of shelfFinalsStmt.all() as unknown as Array<{ tournament_id: string; work_id: string | null; settled_at: string }>) {
        if (row.work_id) champions.set(row.tournament_id, { workId: row.work_id, settledAt: row.settled_at });
      }
      return (shelfTournamentsStmt.all({ since }) as unknown as Array<{ id: string; owner_user_id: string; created_at: string; voters: number; votes_since: number }>).map((row) => ({
        id: row.id,
        ownerUserId: row.owner_user_id,
        createdAt: row.created_at,
        voters: Number(row.voters),
        votesSince: Number(row.votes_since),
        workIds: works.get(row.id) ?? [],
        champion: champions.get(row.id) ?? null
      }));
    },
    listPublicByIds(ids) {
      return listPublicByIdsStmt.all(JSON.stringify(ids)) as unknown as TournamentRow[];
    },
    updateTournamentStatus(id, status, currentRound) {
      updateStatusStmt.run({ $id: id, $status: status, $current_round: currentRound, $updated_at: new Date().toISOString() });
    },
    renameTournament(id, name) {
      renameTournamentStmt.run({ $id: id, $name: name, $name_key: normalizeWords(name), $updated_at: new Date().toISOString() });
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
          $title: slot.title,
          $author: slot.author,
          $work_id: slot.work_id,
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
          $book_a_title: duel.book_a_title,
          $book_a_author: duel.book_a_author,
          $book_a_cover: duel.book_a_cover,
          $book_a_work_id: duel.book_a_work_id,
          $book_b_title: duel.book_b_title,
          $book_b_author: duel.book_b_author,
          $book_b_cover: duel.book_b_cover,
          $book_b_work_id: duel.book_b_work_id,
          $winner_side: duel.winner_side,
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
    updateDuelSettlement(id, status, winnerSide, settledAt) {
      updateDuelSettlementStmt.run({ $id: id, $status: status, $winner_side: winnerSide, $settled_at: settledAt });
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
        $side: row.side,
        $created_at: row.created_at
      });
      return result.changes > 0;
    },
    linkVotesToUser(voterToken, voterUserId) {
      linkVotesStmt.run({ $token: voterToken, $user: voterUserId });
    },
    countVotesBySide(duelId) {
      const rows = countVotesStmt.all(duelId) as unknown as Array<{ side: "a" | "b"; n: number }>;
      const counts = { a: 0, b: 0 };
      for (const row of rows) counts[row.side] = Number(row.n);
      return counts;
    },
    hasVoted(duelId, voterToken, voterUserId) {
      return hasVotedStmt.get(duelId, voterToken ?? "", voterUserId ?? null) !== undefined;
    },
    listVotedByUser(voterUserId) {
      return listVotedByUserStmt.all(voterUserId, voterUserId) as unknown as TournamentRow[];
    },
    listCompletedVotedSince(voterUserId, since) {
      return completedVotedSinceStmt.all(voterUserId, voterUserId, since) as unknown as CompletedVotedRow[];
    },
    votedAmong(voterUserId, ids) {
      return (votedAmongStmt.all(JSON.stringify(ids), voterUserId, voterUserId) as unknown as Array<{ id: string }>).map((row) => row.id);
    },
    listParticipation(ownerUserId, since) {
      const rows = participationStmt.all(ownerUserId, since) as unknown as Array<{ id: string; name: string; participants: number; latest_at: string }>;
      return rows.map((r) => ({ ...r, participants: Number(r.participants) }));
    },
    listRecentVoters(tournamentId, ownerUserId, limit) {
      return recentVotersStmt.all(tournamentId, ownerUserId, limit) as unknown as Array<{ user_id: string; at: string }>;
    }
  };
}
