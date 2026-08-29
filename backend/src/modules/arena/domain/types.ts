// Domain types for the arena module.
//
// Row shapes mirror the SQLite columns exactly (see adapters/sqlite/
// schema.sql) — same snake_case-row / camelCase-service split every
// other module uses. Both books on a duel are denormalized directly
// onto the DuelRow (title/author/cover for each side) rather than
// joined from TournamentSlotRow — a duel needs to keep showing its two
// books' details on its own, with no join, for as long as it exists.

export interface TournamentRow {
  id: string;
  owner_user_id: string;
  name: string;
  bracket_size: number;
  round_duration_minutes: number;
  status: "seeding" | "active" | "completed";
  current_round: number;
  created_at: string;
  updated_at: string;
}

/** The seeded pool, one row per bracket slot. title/author/cover_url are
 *  a SNAPSHOT copied in at seed time — there's no shared Book table
 *  anywhere in this app to reference instead (modules/library's own
 *  schema treats a library document as an opaque per-account blob). */
export interface TournamentSlotRow {
  tournament_id: string;
  slot_index: number;
  book_key: string;
  title: string;
  author: string;
  cover_url: string | null;
}

export interface DuelRow {
  id: string;
  tournament_id: string;
  round_number: number;
  duel_index: number;
  book_a_key: string;
  book_a_title: string;
  book_a_author: string;
  book_a_cover: string | null;
  book_b_key: string;
  book_b_title: string;
  book_b_author: string;
  book_b_cover: string | null;
  winner_key: string | null;
  status: "active" | "tied_pending_tiebreak" | "settled";
  opens_at: string;
  closes_at: string;
  settled_at: string | null;
}

/** voter_token is a random UUID the frontend generates once per browser
 *  (see frontend/src/lib/arenaVoter.ts) — this is what makes "anyone can
 *  vote, no account needed" possible at all. */
export interface VoteRow {
  id: string;
  duel_id: string;
  voter_token: string;
  book_key: string;
  created_at: string;
}

/** A single seeded book — the shape both PUT /arenas/:id/slots and
 *  POST /arenas/:id/random-fill accept, and what tournament_slots and
 *  each side of a duel get built from. */
export interface SeedBookInput {
  key: string;
  title: string;
  author: string;
  cover: string | null;
}
