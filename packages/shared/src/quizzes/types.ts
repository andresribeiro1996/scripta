export const QUIZ_QUESTION_TYPES = ["cover_title", "title_cover", "quote_title", "blurb_title"] as const;

export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

/** Publish-time snapshot of one book — same philosophy as tournament
 *  slots: editing the library later never mutates a live quiz. */
export interface QuizBook {
  key: string;
  title: string;
  author: string;
  coverUrl: string | null;
  quote: string | null;
  blurb: string | null;
}

export interface QuizQuestion {
  /** Stable within one quiz ("q0", "q1", …) — quiz_play_answers keys on
   *  it, and the seeded set is written once at publish and never redrawn. */
  id: string;
  type: QuizQuestionType;
  bookKey: string;
  /** Titles for cover/quote/blurb questions; cover URLs for title_cover. */
  options: string[];
  answerIndex: number;
}

/** The strip of QuizQuestion the public play payload sends — no answer key. */
export interface PublicQuizQuestion {
  id: string;
  type: QuizQuestionType;
  /** What the player sees: cover URL (cover_title), title (title_cover),
   *  quote, or blurb. */
  prompt: string;
  options: string[];
}

/** The quiz document stored as the quiz row's opaque `data` JSON. */
export interface QuizData {
  sourceLabel: string;
  questionCount: number;
  allowedTypes: QuizQuestionType[];
  books: QuizBook[];
  /** null until publish generates the seeded set. */
  questions: QuizQuestion[] | null;
}

export interface QuizConfig {
  questionCount: number;
  allowedTypes: QuizQuestionType[];
}

export interface SubmittedAnswer {
  questionId: string;
  choiceIndex: number;
}

/** Per-question aggregate for the owner's results view. */
export interface QuestionStat {
  questionId: string;
  answerCount: number;
  correctCount: number;
  picks: Array<{ choiceIndex: number; count: number }>;
}

/** One leaderboard row — shared shape for owner and public results. */
export interface ResultPlay {
  playId: string;
  playerName: string | null;
  score: number;
  durationMs: number;
  createdAt: string;
}
