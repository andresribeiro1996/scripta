// The SQLite implementation of the TierlistsRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// TierlistsRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { TierlistsRepository } from "../../domain/ports.js";
import type { TierlistRow, BallotRow, Placement } from "../../domain/types.js";

export function createSqliteTierlistsRepository(db: DatabaseSync): TierlistsRepository {
  const insertStmt = db.prepare(`
    INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, vote_code, vote_access, voting_open, source_tierlist_id, promoted_at, public_books, created_at, updated_at)
    VALUES ($id, $owner_user_id, $origin_user_id, $name, $data, $vote_code, $vote_access, $voting_open, $source_tierlist_id, $promoted_at, $public_books, $created_at, $updated_at)
  `);
  const listStmt = db.prepare(`SELECT * FROM tierlists WHERE owner_user_id = ? AND promoted_at IS NULL ORDER BY created_at DESC`);
  const getOwnedStmt = db.prepare(`SELECT * FROM tierlists WHERE id = ? AND owner_user_id = ? AND promoted_at IS NULL`);
  // Full-row SET rather than a dynamic per-field statement: update()
  // below always merges the patch onto a freshly-read row first, so every
  // column already has its final value by the time this runs.
  const updateStmt = db.prepare(`
    UPDATE tierlists
    SET name = $name, data = $data, updated_at = $updated_at
    WHERE id = $id AND owner_user_id = $owner_user_id
  `);
  const deleteStmt = db.prepare(`DELETE FROM tierlists WHERE id = ? AND owner_user_id = ? AND promoted_at IS NULL`);
  const deleteBallotsStmt = db.prepare(`DELETE FROM tierlist_ballots WHERE tierlist_id = ?`);
  const deletePlacementsForTierlistStmt = db.prepare(`DELETE FROM tierlist_ballot_placements WHERE tierlist_id = ?`);
  const getByVoteCodeStmt = db.prepare(`SELECT * FROM tierlists WHERE vote_code = ?`);
  const listPublicStmt = db.prepare(
    `SELECT * FROM tierlists WHERE vote_code IS NOT NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`
  );
  const getPublicByIdStmt = db.prepare(`SELECT * FROM tierlists WHERE id = ? AND vote_code IS NOT NULL`);
  const listPublicByUserStmt = db.prepare(
    `SELECT * FROM tierlists WHERE origin_user_id = ? AND vote_code IS NOT NULL ORDER BY created_at DESC`
  );
  // Same MAX-aggregate ordering as arena's listVotedByUser: most recently
  // voted first. Own lists are excluded because the owner's seeded ballot
  // on their own poll is not participation.
  const listVotedByUserStmt = db.prepare(`
    SELECT t.*, MAX(b.updated_at) AS last_vote_at
    FROM tierlists t
    JOIN tierlist_ballots b ON b.tierlist_id = t.id
    WHERE b.voter_user_id = ? AND t.origin_user_id != ?
    GROUP BY t.id
    ORDER BY last_vote_at DESC
  `);
  const setVotingStmt = db.prepare(`
    UPDATE tierlists SET vote_access = $vote_access, voting_open = $voting_open, updated_at = $updated_at
    WHERE id = $id AND owner_user_id = $owner_user_id
  `);
  const insertBallotStmt = db.prepare(`
    INSERT INTO tierlist_ballots (id, tierlist_id, voter_user_id, created_at, updated_at)
    VALUES ($id, $tierlist_id, $voter_user_id, $created_at, $updated_at)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `);
  const deletePlacementsStmt = db.prepare(`DELETE FROM tierlist_ballot_placements WHERE ballot_id = ?`);
  const insertPlacementStmt = db.prepare(`
    INSERT INTO tierlist_ballot_placements (ballot_id, tierlist_id, book_key, tier_id)
    VALUES ($ballot_id, $tierlist_id, $book_key, $tier_id)
  `);
  const getBallotByIdStmt = db.prepare(`SELECT * FROM tierlist_ballots WHERE tierlist_id = ? AND id = ?`);
  const getBallotByVoterStmt = db.prepare(`SELECT * FROM tierlist_ballots WHERE tierlist_id = ? AND voter_user_id = ?`);
  const getPlacementsStmt = db.prepare(
    `SELECT book_key, tier_id FROM tierlist_ballot_placements WHERE ballot_id = ? ORDER BY book_key ASC`
  );
  const histogramStmt = db.prepare(`
    SELECT book_key, tier_id, COUNT(*) AS votes
    FROM tierlist_ballot_placements WHERE tierlist_id = ?
    GROUP BY book_key, tier_id
  `);
  const ballotCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM tierlist_ballots WHERE tierlist_id = ?`);
  const ballotCountsStmt = db.prepare(`SELECT tierlist_id, COUNT(*) AS n FROM tierlist_ballots GROUP BY tierlist_id`);
  const publishStmt = db.prepare(`UPDATE tierlists SET data = ?, vote_access = ?, vote_code = ?, voting_open = 1, public_books = ?, updated_at = ? WHERE id = ? AND owner_user_id = ? AND vote_code IS NULL AND promoted_at IS NULL`);
  const promoteStmt = db.prepare(`UPDATE tierlists SET owner_user_id = '__app__', promoted_at = ?, voting_open = 0, updated_at = ? WHERE id = ? AND promoted_at IS NULL`);
  const eligibleCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM tierlist_ballots AS ballot WHERE ballot.tierlist_id = ? AND ballot.voter_user_id IS NOT NULL AND ballot.voter_user_id != ? AND EXISTS (SELECT 1 FROM tierlist_ballot_placements WHERE ballot_id = ballot.id)`);

  function saveBallotRow(ballot: BallotRow, placements: Placement[]): void {
    insertBallotStmt.run({
      $id: ballot.id,
      $tierlist_id: ballot.tierlist_id,
      $voter_user_id: ballot.voter_user_id,
      $created_at: ballot.created_at,
      $updated_at: ballot.updated_at
    });
    // Replace, never append: a re-vote that moves a book to another tier
    // must not leave its previous placement counted alongside the new one.
    deletePlacementsStmt.run(ballot.id);
    for (const placement of placements) {
      insertPlacementStmt.run({
        $ballot_id: ballot.id,
        $tierlist_id: ballot.tierlist_id,
        $book_key: placement.bookKey,
        $tier_id: placement.tierId
      });
    }
  }

  return {
    listByUser(userId) {
      return listStmt.all(userId) as unknown as TierlistRow[];
    },

    getOwned(id, userId) {
      return getOwnedStmt.get(id, userId) as TierlistRow | undefined;
    },

    insert(row) {
      insertStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $origin_user_id: row.origin_user_id,
        $name: row.name,
        $data: row.data,
        $vote_code: row.vote_code,
        $vote_access: row.vote_access,
        $voting_open: row.voting_open,
        $source_tierlist_id: row.source_tierlist_id,
        $promoted_at: row.promoted_at,
        $public_books: row.public_books,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },

    update(id, userId, patch) {
      const existing = getOwnedStmt.get(id, userId) as TierlistRow | undefined;
      if (!existing) return undefined;

      const updatedAt = new Date().toISOString();
      const merged: TierlistRow = { ...existing, ...patch, updated_at: updatedAt };
      updateStmt.run({
        $id: id,
        $owner_user_id: userId,
        $name: merged.name,
        $data: merged.data,
        $updated_at: updatedAt
      });
      return merged;
    },

    delete(id, userId) {
      if (!getOwnedStmt.get(id, userId)) return false;
      db.exec("BEGIN");
      try {
        deletePlacementsForTierlistStmt.run(id);
        deleteBallotsStmt.run(id);
        const result = deleteStmt.run(id, userId);
        db.exec("COMMIT");
        return result.changes > 0;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getByVoteCode(code) {
      return getByVoteCodeStmt.get(code) as TierlistRow | undefined;
    },

    publish(id, userId, data, access, code, publicBooks, ballot, placements) {
      db.exec("BEGIN");
      try {
        const changed = publishStmt.run(data, access, code, publicBooks, new Date().toISOString(), id, userId);
        if (!changed.changes) { db.exec("ROLLBACK"); return undefined; }
        saveBallotRow(ballot, placements);
        db.exec("COMMIT");
        return getOwnedStmt.get(id, userId) as unknown as TierlistRow;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    promote(id, at) {
      promoteStmt.run(at, at, id);
    },

    eligibleVoteCount(id, originUserId) {
      return Number((eligibleCountStmt.get(id, originUserId) as { n: number }).n);
    },

    setVoting(id, userId, patch) {
      const existing = getOwnedStmt.get(id, userId) as TierlistRow | undefined;
      if (!existing) return undefined;
      const updatedAt = new Date().toISOString();
      const merged: TierlistRow = { ...existing, ...patch, updated_at: updatedAt };
      setVotingStmt.run({
        $id: id,
        $owner_user_id: userId,
        $vote_access: merged.vote_access,
        $voting_open: merged.voting_open,
        $updated_at: updatedAt
      });
      return merged;
    },

    listPublic(limit, offset) {
      return listPublicStmt.all(limit, offset) as unknown as TierlistRow[];
    },

    getPublicById(id) {
      return getPublicByIdStmt.get(id) as TierlistRow | undefined;
    },

    listPublicByUser(ownerUserId) {
      return listPublicByUserStmt.all(ownerUserId) as unknown as TierlistRow[];
    },

    listVotedByUser(voterUserId) {
      return listVotedByUserStmt.all(voterUserId, voterUserId) as unknown as TierlistRow[];
    },

    getBallotById(tierlistId, ballotId) {
      return getBallotByIdStmt.get(tierlistId, ballotId) as BallotRow | undefined;
    },

    getBallotByVoter(tierlistId, voterUserId) {
      return getBallotByVoterStmt.get(tierlistId, voterUserId) as BallotRow | undefined;
    },

    saveBallot: saveBallotRow,

    getPlacements(ballotId) {
      const rows = getPlacementsStmt.all(ballotId) as unknown as { book_key: string; tier_id: string }[];
      return rows.map((r) => ({ bookKey: r.book_key, tierId: r.tier_id }));
    },

    histogram(tierlistId) {
      const rows = histogramStmt.all(tierlistId) as unknown as { book_key: string; tier_id: string; votes: number }[];
      return rows.map((r) => ({ bookKey: r.book_key, tierId: r.tier_id, votes: Number(r.votes) }));
    },

    ballotCount(tierlistId) {
      return Number((ballotCountStmt.get(tierlistId) as { n: number }).n);
    },

    ballotCountsByTierlist() {
      const rows = ballotCountsStmt.all() as unknown as { tierlist_id: string; n: number }[];
      return new Map(rows.map((r) => [r.tierlist_id, Number(r.n)]));
    }
  };
}
