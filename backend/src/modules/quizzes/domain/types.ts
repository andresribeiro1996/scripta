// Domain types for the quizzes module.

/** Row shape as stored — `data` is the quiz document (QuizData in
 *  @scripta/shared) as raw JSON text, kept opaque all the way down and
 *  parsed only at the service edges, same treatment as tierlists' `data`. */
export interface QuizRow {
  id: string;
  owner_user_id: string;
  name: string;
  data: string;
  /** NULL on a private quiz; a short code once published. */
  vote_code: string | null;
  /** SQLite has no BOOLEAN — 0 or 1. */
  play_open: number;
  created_at: string;
  updated_at: string;
}

/** Service-facing shape with `data` parsed. */
export interface Quiz {
  id: string;
  name: string;
  data: unknown;
  voteCode: string | null;
  playOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One person's run of a published quiz. `voter_user_id` is NULL for an
 *  anonymous player, in which case `id` (handed back once, on submit) is
 *  the only handle — same idiom as anonymous tier-list ballots. */
export interface PlayRow {
  id: string;
  quiz_id: string;
  voter_user_id: string | null;
  player_name: string | null;
  score: number;
  duration_ms: number;
  created_at: string;
  updated_at: string;
}

/** One answered question of one play. A play stores every question's
 *  answer (submission is all-or-nothing), so there are exactly
 *  question_count AnswerRows per play. */
export interface AnswerRow {
  play_id: string;
  quiz_id: string;
  question_id: string;
  choice_index: number;
  correct: number;
}
