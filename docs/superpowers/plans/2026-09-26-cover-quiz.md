# Cover Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Arena game — a cover/quote/blurb quiz with link challenges, server-side grading, and score leaderboards — mirroring the existing tierlists module end to end.

**Architecture:** New `quizzes` backend module (own SQLite file, hexagonal: ports/service/routes/adapters) that stores the quiz document with a publish-time seeded question set; new `quizzes` domain in `@scripta/shared` (types, seeded draw, grading, curated pool); new web pages (dashboard tab + editor, public `/play/:code`). Web only in v1; no community-feed integration.

**Tech Stack:** Fastify 5 + zod + `node:sqlite` (backend), TypeScript, React 19 + react-query + Tailwind v4 (frontend), `tsx --test` + `node:test` + `assert/strict` (tests).

**Spec:** `docs/superpowers/specs/2026-09-26-cover-quiz-design.md`

## Global Constraints

- Rebuild shared before consumer checks: `npm run build --workspace @scripta/shared` (consumers read `dist/`).
- Backend module isolation: one module dir `backend/src/modules/quizzes/`; no imports from other modules' internals — only their `index.js` public surface (`authGuard`, `getOptionalAuthenticatedUser`, `resolvePublicLibraryData`).
- Raw SQL via `node:sqlite`, no ORM; the module owns its schema file.
- `npm test --workspace backend` names test files explicitly — every new `*.test.ts` MUST be added to that script or CI will not run it.
- Route inputs zod-validated; `authGuard` on owner routes only; public play routes rate-limited (30/min) in their own Fastify scope.
- Never weaken auth, validation, or error handling to make a test pass.
- Match the tierlists files' brief "why" comment style.
- Verify commands: `npm run typecheck --workspace <pkg>`, `npm test --workspace backend`, `npm run lint --workspace frontend`.

## File Structure

```
packages/shared/src/quizzes/
  types.ts          QuizBook/QuizQuestion/PublicQuizQuestion/QuizData/stats types
  grade.ts          gradeAnswers — score + per-question correct map
  draw.ts           hashSeed, mulberry32, eligibleTypes, generateQuizQuestions
  pool.ts           QUIZ_POOL — curated famous books (title/author/cover/quote)
  index.ts          barrel
  grade.test.ts     (Task 1)
  draw.test.ts      (Task 1)
backend/src/modules/quizzes/
  domain/types.ts   QuizRow/Quiz/PlayRow/AnswerRow
  domain/ports.ts   QuizzesRepository port
  service.ts        business logic (publish validation, seeded draw, grading)
  service.test.ts   (Task 3)
  routes.ts         owner + public route builders
  routes.test.ts    (Task 4)
  plugin.ts         composition root, rate-limit split
  index.ts          public interface
  adapters/sqlite/connection.ts
  adapters/sqlite/schema.sql
  adapters/sqlite/sqliteQuizzesRepository.ts
  adapters/sqlite/sqliteQuizzesRepository.test.ts  (Task 2)
frontend/src/
  api/quizzes.ts    typed wrappers over every route
  hooks/useQuizzes.ts, hooks/useQuizPlay.ts
  pages/QuizCreatePage.tsx, pages/QuizEditorPage.tsx, pages/PlayQuizPage.tsx
  (modify) App.tsx, pages/ArenaListPage.tsx
```

---

### Task 1: Shared `quizzes` module — types, grading, seeded draw, curated pool

**Files:**
- Create: `packages/shared/src/quizzes/types.ts`
- Create: `packages/shared/src/quizzes/grade.ts`
- Create: `packages/shared/src/quizzes/draw.ts`
- Create: `packages/shared/src/quizzes/pool.ts`
- Create: `packages/shared/src/quizzes/index.ts`
- Create: `packages/shared/src/quizzes/grade.test.ts`
- Create: `packages/shared/src/quizzes/draw.test.ts`
- Modify: `packages/shared/package.json` (exports map)
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces (used by every later task): `QUIZ_QUESTION_TYPES`, `QuizQuestionType`, `QuizBook`, `QuizQuestion`, `PublicQuizQuestion`, `QuizData`, `QuizConfig`, `SubmittedAnswer`, `QuestionStat`, `ResultPlay`, `gradeAnswers(questions, submitted): { score, correct }`, `hashSeed(string): number`, `mulberry32(number): () => number`, `eligibleTypes(book): QuizQuestionType[]`, `generateQuizQuestions(books, config, seed): QuizQuestion[]`, `QUIZ_POOL: QuizBook[]`.

- [ ] **Step 1: Write `types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing grade tests (`grade.test.ts`)**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeAnswers } from "./grade.js";
import type { QuizQuestion, SubmittedAnswer } from "./types.js";

const questions: QuizQuestion[] = [
  { id: "q0", type: "cover_title", bookKey: "b1", options: ["T1", "T2", "T3", "T4"], answerIndex: 2 },
  { id: "q1", type: "quote_title", bookKey: "b2", options: ["T1", "T2", "T3", "T4"], answerIndex: 0 }
];

test("a perfect run scores every question", () => {
  const submitted: SubmittedAnswer[] = [
    { questionId: "q0", choiceIndex: 2 },
    { questionId: "q1", choiceIndex: 0 }
  ];
  assert.deepEqual(gradeAnswers(questions, submitted), { score: 2, correct: { q0: true, q1: true } });
});

test("a miss scores only the correct answers", () => {
  const { score, correct } = gradeAnswers(questions, [
    { questionId: "q0", choiceIndex: 1 },
    { questionId: "q1", choiceIndex: 0 }
  ]);
  assert.equal(score, 1);
  assert.deepEqual(correct, { q0: false, q1: true });
});

test("answers to unknown questions are ignored; unanswered questions are false", () => {
  const { score, correct } = gradeAnswers(questions, [{ questionId: "nope", choiceIndex: 0 }]);
  assert.equal(score, 0);
  assert.deepEqual(correct, { q0: false, q1: false });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL — cannot find module `./grade.js`.

- [ ] **Step 4: Write `grade.ts`**

```ts
import type { QuizQuestion, SubmittedAnswer } from "./types.js";

export interface GradeResult {
  score: number;
  /** One entry per question in `questions` — the server's verdict on each. */
  correct: Record<string, boolean>;
}

export function gradeAnswers(questions: QuizQuestion[], submitted: SubmittedAnswer[]): GradeResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const correct: Record<string, boolean> = {};
  let score = 0;
  for (const q of questions) correct[q.id] = false;
  for (const answer of submitted) {
    const q = byId.get(answer.questionId);
    if (!q) continue;
    const right = answer.choiceIndex === q.answerIndex;
    correct[q.id] = right;
    if (right) score += 1;
  }
  return { score, correct };
}
```

- [ ] **Step 5: Write the failing draw tests (`draw.test.ts`)**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleTypes, generateQuizQuestions, hashSeed, mulberry32 } from "./draw.js";
import type { QuizBook, QuizConfig } from "./types.js";

const book = (key: string, extra: Partial<QuizBook> = {}): QuizBook => ({
  key,
  title: `Title ${key}`,
  author: "A",
  coverUrl: `https://covers.test/${key}.jpg`,
  quote: null,
  blurb: null,
  ...extra
});

const config: QuizConfig = {
  questionCount: 5,
  allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"]
};
const books = Array.from({ length: 10 }, (_, i) => book(`b${i}`));

test("same seed produces the identical set, ids included", () => {
  assert.deepEqual(generateQuizQuestions(books, config, "code123"), generateQuizQuestions(books, config, "code123"));
});

test("a different seed produces a different set", () => {
  assert.notDeepEqual(generateQuizQuestions(books, config, "aaa"), generateQuizQuestions(books, config, "bbb"));
});

test("every question has 4 distinct options whose answer slot holds the answer value", () => {
  for (const q of generateQuizQuestions(books, config, "seed")) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    const answerValue = q.type === "title_cover" ? `https://covers.test/${q.bookKey}.jpg` : `Title ${q.bookKey}`;
    assert.equal(q.options[q.answerIndex], answerValue);
  }
});

test("title_cover options are all cover URLs", () => {
  const questions = generateQuizQuestions(books, config, "seed");
  assert.ok(questions.some((q) => q.type === "title_cover"));
  for (const q of questions) {
    if (q.type !== "title_cover") continue;
    for (const option of q.options) assert.ok(option.startsWith("https://covers.test/"));
  }
});

test("allowedTypes narrow the draw", () => {
  const onlyQuote = generateQuizQuestions(books, { questionCount: 10, allowedTypes: ["quote_title"] }, "s");
  assert.equal(onlyQuote.length, 0);
});

test("stops short when too few books can supply a question", () => {
  assert.equal(generateQuizQuestions(books.slice(0, 3), config, "s").length, 0);
});

test("eligibility follows the data each type needs", () => {
  assert.deepEqual(eligibleTypes(book("x", { coverUrl: null })), []);
  assert.deepEqual(eligibleTypes(book("x")), ["cover_title", "title_cover"]);
  assert.deepEqual(eligibleTypes(book("x", { quote: "q", blurb: "b" })), ["cover_title", "title_cover", "quote_title", "blurb_title"]);
});

test("mulberry32 is deterministic and hashSeed is stable", () => {
  const a = mulberry32(hashSeed("abc"));
  const b = mulberry32(hashSeed("abc"));
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL — cannot find module `./draw.js`.

- [ ] **Step 7: Write `draw.ts`**

```ts
import type { QuizBook, QuizConfig, QuizQuestion, QuizQuestionType } from "./types.js";

/** FNV-1a — stable string hash, so the seed derives from the vote code
 *  identically everywhere the draw might ever be re-run. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — 32-bit PRNG: tiny, deterministic, good enough for shuffles. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** What a book can actually support — cover questions need a cover (and
 *  title_cover's OPTIONS are covers, so it needs one too), quote/blurb
 *  need their text. */
export function eligibleTypes(book: QuizBook): QuizQuestionType[] {
  const types: QuizQuestionType[] = [];
  if (book.coverUrl) types.push("cover_title", "title_cover");
  if (book.quote) types.push("quote_title");
  if (book.blurb) types.push("blurb_title");
  return types;
}

/** The seeded draw every player of a quiz shares: same books + config +
 *  seed → the identical question list, ids included, so re-running it
 *  never drifts from what quiz_play_answers already stores. Distractors
 *  come from the same book list; a distractor whose value would duplicate
 *  the answer (two editions of one title) is skipped. */
export function generateQuizQuestions(books: QuizBook[], config: QuizConfig, seed: string): QuizQuestion[] {
  const rand = mulberry32(hashSeed(seed));
  const withCover = books.filter((b) => b.coverUrl);
  const questions: QuizQuestion[] = [];
  for (const book of shuffle(books, rand)) {
    if (questions.length >= config.questionCount) break;
    const available = eligibleTypes(book).filter((t) => config.allowedTypes.includes(t));
    if (available.length === 0) continue;
    const type = available[Math.floor(rand() * available.length)]!;
    const coverOptions = type === "title_cover";
    const valueOf = (b: QuizBook): string => (coverOptions ? b.coverUrl ?? "" : b.title);
    const distractorPool = coverOptions ? withCover : books;
    const answerValue = valueOf(book);
    const distractors = shuffle(distractorPool.filter((b) => b.key !== book.key && valueOf(b) !== answerValue), rand).slice(0, 3);
    if (distractors.length < 3) continue;
    const ordered = shuffle([...distractors.map(valueOf), answerValue], rand);
    questions.push({ id: `q${questions.length}`, type, bookKey: book.key, options: ordered, answerIndex: ordered.indexOf(answerValue) });
  }
  return questions;
}
```

- [ ] **Step 8: Write `pool.ts` (curated common pool, 30 famous books)**

```ts
import type { QuizBook } from "./types.js";

const cover = (isbn: string): string => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;

const entry = (key: string, title: string, author: string, isbn: string, quote: string): QuizBook => ({
  key,
  title,
  author,
  coverUrl: cover(isbn),
  quote,
  blurb: null
});

/** The curated common pool: famous books most people recognize on sight,
 *  one famous opening line each — famous-lines trivia is the fun one, and
 *  these are short enough to be fair. Cover URLs are OpenLibrary's; a
 *  dead one just means CoverImage's fallback shows for that book. */
export const QUIZ_POOL: QuizBook[] = [
  entry("pool-pride-and-prejudice", "Pride and Prejudice", "Jane Austen", "9780141439518", "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife."),
  entry("pool-1984", "1984", "George Orwell", "9780451524935", "It was a bright cold day in April, and the clocks were striking thirteen."),
  entry("pool-moby-dick", "Moby-Dick", "Herman Melville", "9780142437247", "Call me Ishmael."),
  entry("pool-anna-karenina", "Anna Karenina", "Leo Tolstoy", "9780143035008", "Happy families are all alike; every unhappy family is unhappy in its own way."),
  entry("pool-tale-of-two-cities", "A Tale of Two Cities", "Charles Dickens", "9780141439600", "It was the best of times, it was the worst of times."),
  entry("pool-the-hobbit", "The Hobbit", "J. R. R. Tolkien", "9780547928227", "In a hole in the ground there lived a hobbit."),
  entry("pool-fahrenheit-451", "Fahrenheit 451", "Ray Bradbury", "9781451673319", "It was a pleasure to burn."),
  entry("pool-the-metamorphosis", "The Metamorphosis", "Franz Kafka", "9780553213690", "As Gregor Samsa awoke one morning from uneasy dreams, he found himself transformed in his bed into a gigantic insect."),
  entry("pool-peter-pan", "Peter Pan", "J. M. Barrie", "9780147501883", "All children, except one, grow up."),
  entry("pool-old-man-and-the-sea", "The Old Man and the Sea", "Ernest Hemingway", "9780684801223", "He was an old man who fished alone in a skiff in the Gulf Stream and he had gone eighty-four days now without taking a fish."),
  entry("pool-the-great-gatsby", "The Great Gatsby", "F. Scott Fitzgerald", "9780743273565", "In my younger and more vulnerable years my father gave me some advice."),
  entry("pool-the-catcher-in-the-rye", "The Catcher in the Rye", "J. D. Salinger", "9780316769488", "If you really want to hear about it, the first thing you'll probably want to know is where I was born."),
  entry("pool-to-kill-a-mockingbird", "To Kill a Mockingbird", "Harper Lee", "9780061120084", "When he was nearly thirteen, my brother Jem got his arm badly broken at the elbow."),
  entry("pool-the-little-prince", "The Little Prince", "Antoine de Saint-Exupéry", "9780156012195", "The first night, I fell asleep on the sand, a thousand miles from any habitation."),
  entry("pool-the-stranger", "The Stranger", "Albert Camus", "9780679720201", "Mother died today."),
  entry("pool-catch-22", "Catch-22", "Joseph Heller", "9780684833392", "It was love at first sight."),
  entry("pool-beloved", "Beloved", "Toni Morrison", "9781400033416", "124 was spiteful."),
  entry("pool-one-hundred-years-of-solitude", "One Hundred Years of Solitude", "Gabriel García Márquez", "9780060883287", "Many years later, as he faced the firing squad, Colonel Aureliano Buendía was to remember that distant afternoon when his father took him to discover ice."),
  entry("pool-charlottes-web", "Charlotte's Web", "E. B. White", "9780064400558", "Where's Papa going with that ax?"),
  entry("pool-mrs-dalloway", "Mrs Dalloway", "Virginia Woolf", "9780156628709", "Mrs Dalloway said she would buy the flowers herself."),
  entry("pool-a-christmas-carol", "A Christmas Carol", "Charles Dickens", "9780140439304", "Marley was dead: to begin with."),
  entry("pool-frankenstein", "Frankenstein", "Mary Shelley", "9780141439471", "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings."),
  entry("pool-dracula", "Dracula", "Bram Stoker", "9780141439846", "3 May. Bistritz. Left Munich at 8:35 P.M."),
  entry("pool-dorian-gray", "The Picture of Dorian Gray", "Oscar Wilde", "9780141439570", "The studio was filled with the rich odour of roses."),
  entry("pool-crime-and-punishment", "Crime and Punishment", "Fyodor Dostoevsky", "9780143058144", "On an exceptionally hot evening early in July a young man came out of the garret in which he lodged."),
  entry("pool-war-and-peace", "War and Peace", "Leo Tolstoy", "9781400079988", "\"Eh bien, mon prince.\""),
  entry("pool-don-quixote", "Don Quixote", "Miguel de Cervantes", "9780060934347", "In a village of La Mancha, the name of which I have no desire to call to mind."),
  entry("pool-jane-eyre", "Jane Eyre", "Charlotte Brontë", "9780141441146", "There was no possibility of taking a walk that day."),
  entry("pool-wuthering-heights", "Wuthering Heights", "Emily Brontë", "9780141439556", "1801. I have just returned from a visit to my landlord."),
  entry("pool-sherlock-holmes", "The Adventures of Sherlock Holmes", "Arthur Conan Doyle", "9780142437339", "To Sherlock Holmes she is always the woman.")
];
```

- [ ] **Step 9: Write `index.ts`, wire the exports map and root barrel**

`packages/shared/src/quizzes/index.ts`:

```ts
export * from "./types.js";
export * from "./grade.js";
export * from "./draw.js";
export * from "./pool.js";
```

`packages/shared/src/index.ts` — add after the tierlists export line:

```ts
export * from "./quizzes/index.js";
```

`packages/shared/package.json` — add to `exports` after the `"./tierlists/*"` entry:

```json
"./quizzes/*": {
  "types": "./dist/quizzes/*.d.ts",
  "default": "./dist/quizzes/*.js"
},
```

- [ ] **Step 10: Run the shared tests and build**

Run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared`
Expected: all tests PASS; build emits `dist/quizzes/*`.

- [ ] **Step 11: Commit**

```bash
git add packages/shared
git commit -m "shared: quizzes domain — types, seeded draw, grading, curated pool"
```

### Task 2: Backend module skeleton — env var, schema, connection, domain, repository

**Files:**
- Modify: `backend/src/config/env.ts` (add `QUIZZES_DB_PATH` next to `TIERLISTS_DB_PATH`, line ~96)
- Create: `backend/src/modules/quizzes/adapters/sqlite/schema.sql`
- Create: `backend/src/modules/quizzes/adapters/sqlite/connection.ts`
- Create: `backend/src/modules/quizzes/domain/types.ts`
- Create: `backend/src/modules/quizzes/domain/ports.ts`
- Create: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.ts`
- Create: `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`
- Modify: `backend/package.json` (test file list)

**Interfaces:**
- Consumes: shared `QuestionStat` type from Task 1.
- Produces: `QuizRow`, `Quiz`, `PlayRow`, `AnswerRow` (domain), `QuizzesRepository` port, `applyQuizzesMigrations(db)`, `openQuizzesDb()`, `createSqliteQuizzesRepository(db)`.

- [ ] **Step 1: Add the env var**

In `backend/src/config/env.ts`, directly after the `TIERLISTS_DB_PATH` line:

```ts
QUIZZES_DB_PATH: z.string().min(1).default("./data/quizzes.sqlite"),
```

- [ ] **Step 2: Write `schema.sql`**

```sql
-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql:
-- no real foreign key back to auth's users table; owner_user_id is an
-- opaque string auth already verified (same as tierlists/arena).

CREATE TABLE IF NOT EXISTS quizzes (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  data          TEXT NOT NULL DEFAULT '{}',
  -- NULL on a private quiz; set once when published and never rotated.
  vote_code     TEXT,
  play_open     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_quizzes_owner_user_id ON quizzes(owner_user_id);

-- Same inline-NULL treatment as tierlists: SQLite cannot ADD COLUMN with
-- a UNIQUE constraint, so the separate unique index enforces it on both
-- the fresh and migrated paths.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quizzes_vote_code ON quizzes(vote_code);

CREATE TABLE IF NOT EXISTS quiz_plays (
  id            TEXT PRIMARY KEY,
  quiz_id       TEXT NOT NULL,
  voter_user_id TEXT,
  player_name   TEXT,
  score         INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_quiz_plays_quiz ON quiz_plays(quiz_id);

-- One play per account per quiz, enforced by the database (a submitted
-- play is final — a player must not resubmit after seeing results).
-- Partial so anonymous plays (NULL voter) never collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_plays_one_per_voter
  ON quiz_plays(quiz_id, voter_user_id) WHERE voter_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quiz_play_answers (
  play_id      TEXT NOT NULL REFERENCES quiz_plays(id) ON DELETE CASCADE,
  quiz_id      TEXT NOT NULL,
  question_id  TEXT NOT NULL,
  choice_index INTEGER NOT NULL,
  correct      INTEGER NOT NULL,
  PRIMARY KEY (play_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_play_answers_quiz
  ON quiz_play_answers(quiz_id, question_id, choice_index);
```

- [ ] **Step 3: Write `connection.ts`**

```ts
// Opens (and migrates) this module's own SQLite database — mirrors
// modules/tierlists/adapters/sqlite/connection.ts. A new module with no
// legacy databases: migrations are just "run the schema".

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function applyQuizzesMigrations(db: DatabaseSync): void {
  db.exec(readFileSync(`${adapterDir}/schema.sql`, "utf8"));
}

export function openQuizzesDb(): DatabaseSync {
  mkdirSync(dirname(env.QUIZZES_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.QUIZZES_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  applyQuizzesMigrations(db);

  return db;
}
```

- [ ] **Step 4: Write `domain/types.ts`**

```ts
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
```

- [ ] **Step 5: Write `domain/ports.ts`**

```ts
// The port: everything the quizzes domain (service.ts) needs from
// persistence. Same contract shape as modules/tierlists/domain/ports.ts —
// service.ts is written against this interface only.

import type { QuestionStat } from "@scripta/shared";
import type { AnswerRow, PlayRow, QuizRow } from "./types.js";

export interface QuizzesRepository {
  listByUser(userId: string): QuizRow[];
  /** Ownership-checked lookup — undefined if no row with that id exists,
   *  or it exists but isn't owned by userId (caller-facing 404). */
  getOwned(id: string, userId: string): QuizRow | undefined;
  /** Unchecked lookup by id — backs results reads the SERVICE has already
   *  ownership-checked via getOwned. */
  getById(id: string): QuizRow | undefined;
  insert(row: QuizRow): void;
  update(id: string, userId: string, patch: { name?: string; data?: string }): QuizRow | undefined;
  delete(id: string, userId: string): boolean;

  /** Lookup by public code — NOT ownership-checked: this backs the public
   *  play routes, where the caller may have no session at all. */
  getByVoteCode(code: string): QuizRow | undefined;
  /** Publish: store the generated question set, mint the code, open play —
   *  one UPDATE, so a quiz can never be half-published. */
  publish(id: string, userId: string, data: string, code: string): QuizRow | undefined;
  setPlayOpen(id: string, userId: string, open: number): QuizRow | undefined;

  getPlayById(quizId: string, playId: string): PlayRow | undefined;
  getPlayByVoter(quizId: string, voterUserId: string): PlayRow | undefined;
  /** Insert a play and its answers in one transaction. A play is never
   *  updated — submission is final. */
  savePlay(play: PlayRow, answers: AnswerRow[]): void;
  getAnswers(playId: string): AnswerRow[];
  /** Leaderboard order: score DESC, then faster duration wins ties. */
  listPlays(quizId: string): PlayRow[];
  playCount(quizId: string): number;
  questionStats(quizId: string): QuestionStat[];
}
```

- [ ] **Step 6: Write the failing adapter test (`sqliteQuizzesRepository.test.ts`)**

```ts
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { applyQuizzesMigrations } from "./connection.js";
import { createSqliteQuizzesRepository } from "./sqliteQuizzesRepository.js";

function makeRepo() {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  return createSqliteQuizzesRepository(db);
}

type QuizRow = Parameters<ReturnType<typeof makeRepo>["insert"]>[0];

let nextId = 0;
const quizRow = (overrides: Partial<QuizRow> = {}): QuizRow => ({
  id: `quiz-${++nextId}`,
  owner_user_id: "u1",
  name: "Quiz",
  data: "{}",
  vote_code: null,
  play_open: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides
});

const playRow = (id: string, quizId: string, voter: string | null, score = 0, durationMs = 0) => ({
  id,
  quiz_id: quizId,
  voter_user_id: voter,
  player_name: null,
  score,
  duration_ms: durationMs,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
});

test("quiz rows round-trip through insert/getOwned/getById", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  assert.equal(repo.getOwned("quiz-1", "u1")?.name, "Quiz");
  assert.equal(repo.getOwned("quiz-1", "u2"), undefined);
  assert.equal(repo.getById("quiz-1")?.id, "quiz-1");
  assert.equal(repo.getByVoteCode("nope"), undefined);
});

test("update merges the patch and refuses published quizzes", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const updated = repo.update("quiz-1", "u1", { name: "Renamed", data: '{"a":1}' });
  assert.equal(updated?.name, "Renamed");
  assert.equal(JSON.parse(updated!.data).a, 1);
  repo.publish("quiz-1", "u1", "{}", "code42");
  assert.equal(repo.update("quiz-1", "u1", { name: "Nope" }), undefined);
});
```
test("publish stamps code + play_open once, and vote codes are unique", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const published = repo.publish("quiz-1", "u1", '{"questions":[]}', "code42");
  assert.equal(published?.play_open, 1);
  assert.equal(repo.publish("quiz-1", "u1", "{}", "again"), undefined);
  repo.insert(quizRow({ id: "quiz-other" }));
  assert.throws(() => repo.insert(quizRow({ id: "quiz-3", vote_code: "code42" })));
});

test("savePlay stores answers; one play per voter is enforced by the index", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const answers = [
    { play_id: "p1", quiz_id: "quiz-1", question_id: "q0", choice_index: 2, correct: 1 },
    { play_id: "p1", quiz_id: "quiz-1", question_id: "q1", choice_index: 0, correct: 0 }
  ];
  repo.savePlay(playRow("p1", "quiz-1", "u9", 1, 5000), answers);
  assert.equal(repo.getPlayByVoter("quiz-1", "u9")?.score, 1);
  assert.equal(repo.getAnswers("p1").length, 2);
  assert.equal(repo.playCount("quiz-1"), 1);
  assert.throws(() => repo.savePlay(playRow("p2", "quiz-1", "u9"), []));
});

test("listPlays orders by score DESC then duration ASC; stats aggregate", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const answer = (playId: string, q: string, choice: number, correct: number) => ({ play_id: playId, quiz_id: "quiz-1", question_id: q, choice_index: choice, correct });
  repo.savePlay(playRow("p1", "quiz-1", "u9", 1, 9000), [answer("p1", "q0", 0, 1), answer("p1", "q1", 1, 0)]);
  repo.savePlay(playRow("p2", "quiz-1", "u8", 2, 8000), [answer("p2", "q0", 0, 1), answer("p2", "q1", 2, 1)]);
  repo.savePlay(playRow("p3", "quiz-1", "u7", 2, 3000), [answer("p3", "q0", 2, 0), answer("p3", "q1", 2, 1)]);
  repo.savePlay(playRow("p4", "quiz-1", null, 2, 1000), [answer("p4", "q0", 0, 1), answer("p4", "q1", 0, 0)]);
  const plays = repo.listPlays("quiz-1").map((p) => p.id);
  assert.deepEqual(plays, ["p4", "p3", "p2", "p1"]);
  const stats = repo.questionStats("quiz-1");
  const q0 = stats.find((s) => s.questionId === "q0")!;
  assert.equal(q0.answerCount, 4);
  assert.equal(q0.correctCount, 3);
  assert.deepEqual(q0.picks, [{ choiceIndex: 0, count: 3 }, { choiceIndex: 2, count: 1 }]);
});

test("delete removes the quiz, its plays and their answers", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  repo.savePlay(playRow("p1", "quiz-1", "u9"), [{ play_id: "p1", quiz_id: "quiz-1", question_id: "q0", choice_index: 0, correct: 1 }]);
  assert.equal(repo.delete("quiz-1", "u1"), true);
  assert.equal(repo.getById("quiz-1"), undefined);
  assert.equal(repo.getAnswers("p1").length, 0);
  assert.equal(repo.delete("quiz-1", "u1"), false);
});
```

- [ ] **Step 7: Run to verify it fails**

Run (from `backend/`): `npx tsx --test src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Write `sqliteQuizzesRepository.ts`**

```ts
// The SQLite implementation of the QuizzesRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the port.

import type { DatabaseSync } from "node:sqlite";
import type { QuestionStat } from "@scripta/shared";
import type { QuizzesRepository } from "../../domain/ports.js";
import type { AnswerRow, PlayRow, QuizRow } from "../../domain/types.js";

export function createSqliteQuizzesRepository(db: DatabaseSync): QuizzesRepository {
  const insertStmt = db.prepare(`
    INSERT INTO quizzes (id, owner_user_id, name, data, vote_code, play_open, created_at, updated_at)
    VALUES ($id, $owner_user_id, $name, $data, $vote_code, $play_open, $created_at, $updated_at)
  `);
  const listStmt = db.prepare(`SELECT * FROM quizzes WHERE owner_user_id = ? ORDER BY created_at DESC`);
  const getOwnedStmt = db.prepare(`SELECT * FROM quizzes WHERE id = ? AND owner_user_id = ?`);
  const getByIdStmt = db.prepare(`SELECT * FROM quizzes WHERE id = ?`);
  const updateStmt = db.prepare(`UPDATE quizzes SET name = $name, data = $data, updated_at = $updated_at WHERE id = $id AND owner_user_id = $owner_user_id`);
  const deleteQuizStmt = db.prepare(`DELETE FROM quizzes WHERE id = ? AND owner_user_id = ?`);
  const deletePlaysStmt = db.prepare(`DELETE FROM quiz_plays WHERE quiz_id = ?`);
  const deleteAnswersStmt = db.prepare(`DELETE FROM quiz_play_answers WHERE quiz_id = ?`);
  const getByVoteCodeStmt = db.prepare(`SELECT * FROM quizzes WHERE vote_code = ?`);
  const publishStmt = db.prepare(`UPDATE quizzes SET data = ?, vote_code = ?, play_open = 1, updated_at = ? WHERE id = ? AND owner_user_id = ? AND vote_code IS NULL`);
  const setPlayOpenStmt = db.prepare(`UPDATE quizzes SET play_open = $play_open, updated_at = $updated_at WHERE id = $id AND owner_user_id = $owner_user_id`);
  const insertPlayStmt = db.prepare(`
    INSERT INTO quiz_plays (id, quiz_id, voter_user_id, player_name, score, duration_ms, created_at, updated_at)
    VALUES ($id, $quiz_id, $voter_user_id, $player_name, $score, $duration_ms, $created_at, $updated_at)
  `);
  const insertAnswerStmt = db.prepare(`
    INSERT INTO quiz_play_answers (play_id, quiz_id, question_id, choice_index, correct)
    VALUES ($play_id, $quiz_id, $question_id, $choice_index, $correct)
  `);
  const getPlayByIdStmt = db.prepare(`SELECT * FROM quiz_plays WHERE quiz_id = ? AND id = ?`);
  const getPlayByVoterStmt = db.prepare(`SELECT * FROM quiz_plays WHERE quiz_id = ? AND voter_user_id = ?`);
  const getAnswersStmt = db.prepare(`SELECT * FROM quiz_play_answers WHERE play_id = ? ORDER BY question_id ASC`);
  const listPlaysStmt = db.prepare(`SELECT * FROM quiz_plays WHERE quiz_id = ? ORDER BY score DESC, duration_ms ASC, created_at ASC`);
  const playCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM quiz_plays WHERE quiz_id = ?`);
  const statsStmt = db.prepare(`
    SELECT question_id, choice_index, COUNT(*) AS picks, SUM(correct) AS correct
    FROM quiz_play_answers WHERE quiz_id = ?
    GROUP BY question_id, choice_index ORDER BY question_id ASC, choice_index ASC
  `);

  const now = (): string => new Date().toISOString();

  return {
    listByUser(userId) {
      return listStmt.all(userId) as unknown as QuizRow[];
    },

    getOwned(id, userId) {
      return getOwnedStmt.get(id, userId) as QuizRow | undefined;
    },

    getById(id) {
      return getByIdStmt.get(id) as QuizRow | undefined;
    },

    insert(row) {
      insertStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $name: row.name,
        $data: row.data,
        $vote_code: row.vote_code,
        $play_open: row.play_open,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },

    update(id, userId, patch) {
      const existing = getOwnedStmt.get(id, userId) as QuizRow | undefined;
      if (!existing) return undefined;
      const merged: QuizRow = { ...existing, ...patch, updated_at: now() };
      updateStmt.run({ $id: id, $owner_user_id: userId, $name: merged.name, $data: merged.data, $updated_at: merged.updated_at });
      return merged;
    },

    delete(id, userId) {
      if (!getOwnedStmt.get(id, userId)) return false;
      db.exec("BEGIN");
      try {
        deleteAnswersStmt.run(id);
        deletePlaysStmt.run(id);
        const result = deleteQuizStmt.run(id, userId);
        db.exec("COMMIT");
        return result.changes > 0;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getByVoteCode(code) {
      return getByVoteCodeStmt.get(code) as QuizRow | undefined;
    },

    publish(id, userId, data, code) {
      const result = publishStmt.run(data, code, now(), id, userId);
      if (!result.changes) return undefined;
      return getOwnedStmt.get(id, userId) as QuizRow;
    },

    setPlayOpen(id, userId, open) {
      const existing = getOwnedStmt.get(id, userId) as QuizRow | undefined;
      if (!existing) return undefined;
      const updatedAt = now();
      setPlayOpenStmt.run({ $id: id, $owner_user_id: userId, $play_open: open, $updated_at: updatedAt });
      return { ...existing, play_open: open, updated_at: updatedAt };
    },

    getPlayById(quizId, playId) {
      return getPlayByIdStmt.get(quizId, playId) as PlayRow | undefined;
    },

    getPlayByVoter(quizId, voterUserId) {
      return getPlayByVoterStmt.get(quizId, voterUserId) as PlayRow | undefined;
    },

    savePlay(play, answers) {
      db.exec("BEGIN");
      try {
        insertPlayStmt.run({
          $id: play.id,
          $quiz_id: play.quiz_id,
          $voter_user_id: play.voter_user_id,
          $player_name: play.player_name,
          $score: play.score,
          $duration_ms: play.duration_ms,
          $created_at: play.created_at,
          $updated_at: play.updated_at
        });
        for (const answer of answers) {
          insertAnswerStmt.run({
            $play_id: answer.play_id,
            $quiz_id: answer.quiz_id,
            $question_id: answer.question_id,
            $choice_index: answer.choice_index,
            $correct: answer.correct
          });
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getAnswers(playId) {
      return getAnswersStmt.all(playId) as unknown as AnswerRow[];
    },

    listPlays(quizId) {
      return listPlaysStmt.all(quizId) as unknown as PlayRow[];
    },

    playCount(quizId) {
      return Number((playCountStmt.get(quizId) as { n: number }).n);
    },

    questionStats(quizId) {
      const rows = statsStmt.all(quizId) as unknown as Array<{ question_id: string; choice_index: number; picks: number; correct: number }>;
      const byQuestion = new Map<string, QuestionStat>();
      for (const row of rows) {
        let stat = byQuestion.get(row.question_id);
        if (!stat) {
          stat = { questionId: row.question_id, answerCount: 0, correctCount: 0, picks: [] };
          byQuestion.set(row.question_id, stat);
        }
        stat.answerCount += Number(row.picks);
        stat.correctCount += Number(row.correct);
        stat.picks.push({ choiceIndex: Number(row.choice_index), count: Number(row.picks) });
      }
      return [...byQuestion.values()];
    }
  };
}
```

- [ ] **Step 9: Run the adapter test**

Run (from `backend/`): `npx tsx --test src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 10: Register the three new test files in `backend/package.json`'s `test` script**

Insert after the tierlists entries (`src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`) in the `test` script's file list:

```
src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts src/modules/quizzes/service.test.ts src/modules/quizzes/routes.test.ts
```

(service/routes test files don't exist until Tasks 3–4; CI only runs `npm test` after all tasks land, so naming all three now is fine.)

- [ ] **Step 11: Typecheck and commit**

Run: `npm run typecheck --workspace backend`
Expected: PASS.

```bash
git add backend/src/config/env.ts backend/src/modules/quizzes backend/package.json
git commit -m "backend: quizzes module skeleton — schema, connection, repository"
```
---

### Task 3: Service — publish validation, seeded draw, grading

**Files:**
- Create: `backend/src/modules/quizzes/service.ts`
- Create: `backend/src/modules/quizzes/service.test.ts`

**Interfaces:**
- Consumes: Task 1 shared exports; Task 2 `QuizzesRepository` port + domain types.
- Produces: `createQuizzesService(repo)`, `QuizzesService`, `Player`, `PlayOutcome`, `PublishOutcome`, `PlayBoard`, `generateVoteCode()` — consumed by Task 4's routes.

- [ ] **Step 1: Write the failing service test (`service.test.ts`)**

```ts
// Exercises service.ts against a hand-written in-memory QuizzesRepository
// fake — no real SQLite, same seam as tierlists' service.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizBook } from "@scripta/shared";
import type { QuizzesRepository } from "./domain/ports.js";
import type { AnswerRow, PlayRow, QuizRow } from "./domain/types.js";
import { createQuizzesService } from "./service.js";

function createInMemoryRepo(): QuizzesRepository {
  const quizzes = new Map<string, QuizRow>();
  const plays = new Map<string, PlayRow>();
  const answers = new Map<string, AnswerRow[]>();
  return {
    listByUser: (userId) => [...quizzes.values()].filter((q) => q.owner_user_id === userId),
    getOwned: (id, userId) => {
      const q = quizzes.get(id);
      return q && q.owner_user_id === userId ? q : undefined;
    },
    getById: (id) => quizzes.get(id),
    insert: (row) => quizzes.set(row.id, { ...row }),
    update: (id, userId, patch) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
      quizzes.set(id, merged);
      return merged;
    },
    delete: (id, userId) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return false;
      quizzes.delete(id);
      return true;
    },
    getByVoteCode: (code) => [...quizzes.values()].find((q) => q.vote_code === code),
    publish: (id, userId, data, code) => {
      const row = quizzes.get(id);
      if (!row || row.owner_user_id !== userId || row.vote_code) return undefined;
      const published = { ...row, data, vote_code: code, play_open: 1 };
      quizzes.set(id, published);
      return published;
    },
    setPlayOpen: (id, userId, open) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged = { ...existing, play_open: open };
      quizzes.set(id, merged);
      return merged;
    },
    getPlayById: (quizId, playId) => {
      const p = plays.get(playId);
      return p && p.quiz_id === quizId ? p : undefined;
    },
    getPlayByVoter: (quizId, voter) => [...plays.values()].find((p) => p.quiz_id === quizId && p.voter_user_id === voter),
    savePlay: (play, rows) => {
      plays.set(play.id, { ...play });
      answers.set(play.id, [...rows]);
    },
    getAnswers: (playId) => answers.get(playId) ?? [],
    listPlays: (quizId) =>
      [...plays.values()]
        .filter((p) => p.quiz_id === quizId)
        .sort((a, b) => b.score - a.score || a.duration_ms - b.duration_ms),
    playCount: (quizId) => [...plays.values()].filter((p) => p.quiz_id === quizId).length,
    questionStats: (quizId) => {
      const byQuestion = new Map<string, { answerCount: number; correctCount: number; picks: Map<number, number> }>();
      for (const rows of answers.values()) {
        if (rows[0]?.quiz_id !== quizId) continue;
        for (const row of rows) {
          let stat = byQuestion.get(row.question_id);
          if (!stat) byQuestion.set(row.question_id, (stat = { answerCount: 0, correctCount: 0, picks: new Map() }));
          stat.answerCount += 1;
          stat.correctCount += row.correct;
          stat.picks.set(row.choice_index, (stat.picks.get(row.choice_index) ?? 0) + 1);
        }
      }
      return [...byQuestion.entries()].map(([questionId, s]) => ({
        questionId,
        answerCount: s.answerCount,
        correctCount: s.correctCount,
        picks: [...s.picks.entries()].map(([choiceIndex, count]) => ({ choiceIndex, count }))
      }));
    }
  };
}

const book = (key: string, extra: Partial<QuizBook> = {}): QuizBook => ({
  key,
  title: `Title ${key}`,
  author: "A",
  coverUrl: `https://covers.test/${key}.jpg`,
  quote: `Quote ${key}`,
  blurb: `Blurb ${key}`,
  ...extra
});

function makeService() {
  const repo = createInMemoryRepo();
  const service = createQuizzesService(repo);
  const created = service.createQuiz("u1", "My quiz", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"],
    books: Array.from({ length: 6 }, (_, i) => book(`b${i}`)),
    questions: null
  });
  return { repo, service, quizId: created.id };
}

test("publish generates the full seeded set, mints a code, and opens play", () => {
  const { service, quizId } = makeService();
  const outcome = service.publishQuiz("u1", quizId, []);
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.ok(outcome.quiz.voteCode);
  const data = outcome.quiz.data as { questions: Array<{ id: string; options: string[]; answerIndex: number }>; books: unknown[] };
  assert.equal(data.questions.length, 3);
  assert.equal(data.books.length, 6);
  assert.equal(outcome.quiz.playOpen, true);
});

test("publish resolves covers for shelf books that lack one", () => {
  const { service, quizId } = makeService();
  const outcome = service.publishQuiz("u1", quizId, [{ bookKey: "b0", coverUrl: "https://resolved.test/b0.jpg" }]);
  assert.ok(outcome.ok);
  const data = outcome.ok ? (outcome.quiz.data as { books: Array<{ key: string; coverUrl: string | null }> }) : null;
  assert.equal(data!.books.find((b) => b.key === "b0")!.coverUrl, "https://resolved.test/b0.jpg");
});

test("publish refuses another user's quiz and a second publish", () => {
  const { service, quizId } = makeService();
  assert.equal(service.publishQuiz("u2", quizId, []).reason, "not-found");
  assert.ok(service.publishQuiz("u1", quizId, []).ok);
  assert.equal(service.publishQuiz("u1", quizId, []).reason, "already-published");
});

test("publish rejects too few books", () => {
  const { service } = makeService();
  const few = service.createQuiz("u1", "Few", {
    sourceLabel: "",
    questionCount: 10,
    allowedTypes: ["cover_title"],
    books: Array.from({ length: 3 }, (_, i) => book(`f${i}`)),
    questions: null
  });
  const outcome = service.publishQuiz("u1", few.id, []);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.error, /at least 4 books/i);
});

test("getPlayBoard strips the answer key and carries the prompt", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const board = service.getPlayBoard(published.ok ? published.quiz.voteCode! : "");
  assert.ok(board);
  assert.equal(board!.questions.length, 3);
  for (const q of board!.questions) {
    assert.equal("answerIndex" in q, false);
    assert.ok(q.prompt.length > 0);
    assert.equal(q.options.length, 4);
  }
});

test("submitPlay grades server-side and locks one play per player", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const key = (service.getQuiz("u1", quizId)!.data as { questions: Array<{ id: string; answerIndex: number }> }).questions;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: key.find((k) => k.id === q.id)!.answerIndex }));
  const first = service.submitPlay(code, answers, 20000, "Alice", { kind: "user", userId: "u9" });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.score, board.questions.length);
  const second = service.submitPlay(code, answers, 20000, "Alice", { kind: "user", userId: "u9" });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "already-played");
});

test("submitPlay rejects wrong-shaped answers and closed quizzes", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const short = service.submitPlay(code, [{ questionId: "q0", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(short.reason, "invalid");
  const unknownQuestion = service.submitPlay(code, [{ questionId: "zz", choiceIndex: 0 }, { questionId: "q0", choiceIndex: 0 }, { questionId: "q1", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(unknownQuestion.reason, "invalid");
  service.setPlayState("u1", quizId, false);
  const closed = service.submitPlay(code, [{ questionId: "q0", choiceIndex: 0 }, { questionId: "q1", choiceIndex: 0 }, { questionId: "q2", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.reason, "closed");
});

test("anonymous players recover their play by the id handle", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
  const play = service.submitPlay(code, answers, 1000, null, { kind: "anonymous", playId: null });
  assert.ok(play.ok);
  const recovered = service.getPlay(code, { kind: "anonymous", playId: play.ok ? play.playId : null });
  assert.equal(recovered.ok, true);
  assert.equal(service.getPlay(code, { kind: "anonymous", playId: "nope" }).ok, false);
});

test("results order plays score-then-speed and include per-question stats", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
  service.submitPlay(code, answers, 9000, "Slow", { kind: "anonymous", playId: null });
  service.submitPlay(code, answers, 1000, "Fast", { kind: "anonymous", playId: null });
  const results = service.getResults("u1", quizId);
  assert.ok(results);
  assert.deepEqual(results!.plays.map((p) => p.playerName), ["Fast", "Slow"]);
  assert.ok(results!.stats.length > 0);
  assert.equal(results!.questionCount, 3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `npx tsx --test src/modules/quizzes/service.test.ts`
Expected: FAIL — `./service.js` not found.

- [ ] **Step 3: Write `service.ts`**

```ts
// Business logic for the quizzes module. Depends only on the
// QuizzesRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomBytes, randomUUID } from "node:crypto";
import { QUIZ_QUESTION_TYPES, generateQuizQuestions, gradeAnswers, type PublicQuizQuestion, type QuestionStat, type QuizBook, type QuizQuestion, type QuizQuestionType, type ResultPlay, type SubmittedAnswer } from "@scripta/shared";
import type { QuizzesRepository } from "./domain/ports.js";
import type { AnswerRow, PlayRow, Quiz, QuizRow } from "./domain/types.js";

function toQuiz(row: QuizRow): Quiz {
  const parsed = JSON.parse(row.data) as unknown;
  return {
    id: row.id,
    name: row.name,
    data: parsed,
    voteCode: row.vote_code,
    playOpen: row.play_open === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** The one place this module looks inside the opaque `data` document —
 *  parsed defensively, same stance as tierlists' readDocument. */
interface QuizDocument {
  sourceLabel: string;
  questionCount: number;
  allowedTypes: QuizQuestionType[];
  books: QuizBook[];
  questions: QuizQuestion[] | null;
}

function readDocument(quiz: Quiz): QuizDocument {
  const data = (quiz.data ?? {}) as Partial<QuizDocument>;
  return {
    sourceLabel: typeof data.sourceLabel === "string" ? data.sourceLabel : "",
    questionCount: typeof data.questionCount === "number" ? data.questionCount : 10,
    allowedTypes: Array.isArray(data.allowedTypes) ? data.allowedTypes : [...QUIZ_QUESTION_TYPES],
    books: Array.isArray(data.books) ? data.books : [],
    questions: Array.isArray(data.questions) ? data.questions : null
  };
}

// Same unambiguous alphabet as tierlists' vote codes — these get read
// aloud and typed by hand. An identifier, not a secret.
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateVoteCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export type Player = { kind: "user"; userId: string } | { kind: "anonymous"; playId: string | null };

export type PlayOutcome =
  | { ok: true; playId: string; score: number; correct: Record<string, boolean> }
  | { ok: false; reason: "not-found" | "closed" | "invalid" | "already-played" };

export type PublishOutcome =
  | { ok: true; quiz: Quiz }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "already-published"; error: string }
  | { ok: false; reason: "invalid"; error: string };

export interface PlayBoard {
  name: string;
  sourceLabel: string;
  questionCount: number;
  playOpen: boolean;
  playCount: number;
  questions: PublicQuizQuestion[];
}

export interface QuizResults {
  plays: ResultPlay[];
  stats: QuestionStat[];
  questionCount: number;
}

function toResultPlay(row: PlayRow): ResultPlay {
  return { playId: row.id, playerName: row.player_name, score: row.score, durationMs: row.duration_ms, createdAt: row.created_at };
}

function toPublicQuestion(question: QuizQuestion, bookByKey: Map<string, QuizBook>): PublicQuizQuestion {
  const book = bookByKey.get(question.bookKey);
  const prompt =
    question.type === "cover_title"
      ? book?.coverUrl ?? ""
      : question.type === "title_cover"
        ? book?.title ?? ""
        : question.type === "quote_title"
          ? book?.quote ?? ""
          : book?.blurb ?? "";
  return { id: question.id, type: question.type, prompt, options: question.options };
}

export interface QuizzesService {
  listQuizzes(userId: string): Quiz[];
  createQuiz(userId: string, name: string, data: unknown): Quiz;
  getQuiz(userId: string, id: string): Quiz | undefined;
  updateQuiz(userId: string, id: string, patch: { name?: string; data?: unknown }): Quiz | undefined;
  deleteQuiz(userId: string, id: string): boolean;
  /** `resolvedBooks` carries the public cover URLs the route resolved from
   *  the owner's library (the same resolver tierlists' open-voting uses);
   *  books that already carry one (pool picks) keep theirs. */
  publishQuiz(userId: string, id: string, resolvedBooks: Array<{ bookKey: string; coverUrl: string | null }>): PublishOutcome;
  setPlayState(userId: string, id: string, open: boolean): Quiz | undefined;
  getPlayBoard(code: string): PlayBoard | undefined;
  submitPlay(code: string, answers: SubmittedAnswer[], durationMs: number, playerName: string | null, player: Player): PlayOutcome;
  getPlay(code: string, player: Player): PlayOutcome;
  getResults(userId: string, id: string): QuizResults | undefined;
  getPublicResults(code: string): { plays: ResultPlay[]; questionCount: number } | undefined;
}

export function createQuizzesService(repo: QuizzesRepository): QuizzesService {
  return {
    listQuizzes(userId) {
      return repo.listByUser(userId).map(toQuiz);
    },

    createQuiz(userId, name, data) {
      const now = new Date().toISOString();
      const row: QuizRow = {
        id: randomUUID(),
        owner_user_id: userId,
        name,
        data: JSON.stringify(data ?? {}),
        vote_code: null,
        play_open: 0,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return toQuiz(row);
    },

    getQuiz(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toQuiz(row) : undefined;
    },

    updateQuiz(userId, id, patch) {
      if (patch.data !== undefined || patch.name !== undefined) {
        const existing = repo.getOwned(id, userId);
        // undefined covers BOTH "not yours" and "already published" — a
        // published quiz's seeded set must never drift (same 404 convention
        // as tierlists' updateTierlist).
        if (!existing || existing.vote_code !== null) return undefined;
      }
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.data !== undefined ? { data: JSON.stringify(patch.data) } : {})
      });
      return row ? toQuiz(row) : undefined;
    },

    deleteQuiz(userId, id) {
      return repo.delete(id, userId);
    },

    publishQuiz(userId, id, resolvedBooks) {
      const row = repo.getOwned(id, userId);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.vote_code !== null) return { ok: false, reason: "already-published", error: "This quiz is already published." };
      const doc = readDocument(toQuiz(row));
      if (doc.books.length < 4) return { ok: false, reason: "invalid", error: "A quiz needs at least 4 books." };
      const coverByKey = new Map(resolvedBooks.map((b) => [b.bookKey, b.coverUrl]));
      const books = doc.books.map((b) => ({ ...b, coverUrl: b.coverUrl ?? coverByKey.get(b.key) ?? null }));
      const code = generateVoteCode();
      const questions = generateQuizQuestions(books, { questionCount: doc.questionCount, allowedTypes: doc.allowedTypes }, code);
      if (questions.length !== doc.questionCount) {
        return { ok: false, reason: "invalid", error: "Not enough books have the covers, quotes, or blurbs those question types need." };
      }
      const published = repo.publish(id, userId, JSON.stringify({ ...doc, books, questions }), code);
      if (!published) return { ok: false, reason: "not-found" };
      return { ok: true, quiz: toQuiz(published) };
    },

    setPlayState(userId, id, open) {
      const row = repo.setPlayOpen(id, userId, open ? 1 : 0);
      return row ? toQuiz(row) : undefined;
    },

    getPlayBoard(code) {
      const row = repo.getByVoteCode(code);
      if (!row) return undefined;
      const doc = readDocument(toQuiz(row));
      const bookByKey = new Map(doc.books.map((b) => [b.key, b]));
      return {
        name: row.name,
        sourceLabel: doc.sourceLabel,
        questionCount: doc.questionCount,
        playOpen: row.play_open === 1,
        playCount: repo.playCount(row.id),
        questions: (doc.questions ?? []).map((q) => toPublicQuestion(q, bookByKey))
      };
    },

    submitPlay(code, answers, durationMs, playerName, player) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.play_open !== 1) return { ok: false, reason: "closed" };
      const doc = readDocument(toQuiz(row));
      const questions = doc.questions ?? [];
      if (!doc.questions) return { ok: false, reason: "invalid" };
      if (answers.length !== questions.length) return { ok: false, reason: "invalid" };
      const byId = new Map(questions.map((q) => [q.id, q]));
      const seen = new Set<string>();
      for (const answer of answers) {
        const question = byId.get(answer.questionId);
        if (!question || seen.has(answer.questionId)) return { ok: false, reason: "invalid" };
        if (answer.choiceIndex < 0 || answer.choiceIndex >= question.options.length) return { ok: false, reason: "invalid" };
        seen.add(answer.questionId);
      }

      const existing =
        player.kind === "user"
          ? repo.getPlayByVoter(row.id, player.userId)
          : player.playId
            ? repo.getPlayById(row.id, player.playId)
            : undefined;
      if (existing) return { ok: false, reason: "already-played" };

      const { score, correct } = gradeAnswers(questions, answers);
      const now = new Date().toISOString();
      const play: PlayRow = {
        id: randomUUID(),
        quiz_id: row.id,
        voter_user_id: player.kind === "user" ? player.userId : null,
        player_name: playerName,
        score,
        duration_ms: durationMs,
        created_at: now,
        updated_at: now
      };
      const answerRows: AnswerRow[] = answers.map((answer) => ({
        play_id: play.id,
        quiz_id: row.id,
        question_id: answer.questionId,
        choice_index: answer.choiceIndex,
        correct: correct[answer.questionId] ? 1 : 0
      }));
      repo.savePlay(play, answerRows);
      return { ok: true, playId: play.id, score, correct };
    },

    getPlay(code, player) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };
      const existing =
        player.kind === "user"
          ? repo.getPlayByVoter(row.id, player.userId)
          : player.playId
            ? repo.getPlayById(row.id, player.playId)
            : undefined;
      if (!existing) return { ok: false, reason: "not-found" };
      const correct: Record<string, boolean> = {};
      for (const answer of repo.getAnswers(existing.id)) correct[answer.question_id] = answer.correct === 1;
      return { ok: true, playId: existing.id, score: existing.score, correct };
    },

    getResults(userId, id) {
      if (!repo.getOwned(id, userId)) return undefined;
      const row = repo.getById(id)!;
      return {
        plays: repo.listPlays(id).map(toResultPlay),
        stats: repo.questionStats(id),
        questionCount: readDocument(toQuiz(row)).questionCount
      };
    },

    getPublicResults(code) {
      const row = repo.getByVoteCode(code);
      if (!row) return undefined;
      return { plays: repo.listPlays(row.id).map(toResultPlay), questionCount: readDocument(toQuiz(row)).questionCount };
    }
  };
}
```

- [ ] **Step 4: Run the service tests**

Run (from `backend/`): `npx tsx --test src/modules/quizzes/service.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace backend`
Expected: PASS.

```bash
git add backend/src/modules/quizzes/service.ts backend/src/modules/quizzes/service.test.ts
git commit -m "backend: quizzes service — publish validation, seeded draw, server-side grading"
```
---

### Task 4: Routes, plugin, app registration, wire-shape tests

**Files:**
- Create: `backend/src/modules/quizzes/routes.ts`
- Create: `backend/src/modules/quizzes/routes.test.ts`
- Create: `backend/src/modules/quizzes/plugin.ts`
- Create: `backend/src/modules/quizzes/index.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: Task 3's `QuizzesService`/`Player`/`PlayOutcome`; auth's `authGuard`/`getOptionalAuthenticatedUser`; library's `resolvePublicLibraryData` (public index surfaces only).
- Produces: `buildQuizRoutes(service)`, `buildPublicQuizRoutes(service)`, `quizzesPlugin`, `registerQuizzesModule`.

- [ ] **Step 1: Write the failing routes test (`routes.test.ts`)**

```ts
// Wire-shape tests for the public play surface — what a curl really gets.
// Same env-before-import discipline as tierlists' routes.test.ts.

import assert from "node:assert/strict";
import Fastify, { type InjectOptions } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "quizzes-routes-test-"));
process.env.AUTH_DB_PATH = join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratchDir, "gallery-files");
process.env.COVERS_DB_PATH = join(scratchDir, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratchDir, "covers-files");
process.env.TIERLISTS_DB_PATH = join(scratchDir, "tierlists.sqlite");
process.env.QUIZZES_DB_PATH = join(scratchDir, "quizzes.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyQuizzesMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteQuizzesRepository } = await import("./adapters/sqlite/sqliteQuizzesRepository.js");
const { createQuizzesService } = await import("./service.js");
const { buildPublicQuizRoutes } = await import("./routes.js");

type Service = ReturnType<typeof createQuizzesService>;

const book = (key: string) => ({ key, title: `Title ${key}`, author: "A", coverUrl: `https://covers.test/${key}.jpg`, quote: `Quote ${key}`, blurb: null });

/** A published 3-question quiz with its code and the owner-held answer key. */
function publishedQuiz() {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const service = createQuizzesService(createSqliteQuizzesRepository(db));
  const created = service.createQuiz("u1", "Trivia", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"],
    books: Array.from({ length: 6 }, (_, i) => book(`b${i}`)),
    questions: null
  });
  const outcome = service.publishQuiz("u1", created.id, []);
  assert.ok(outcome.ok);
  const code = outcome.ok ? outcome.quiz.voteCode! : "";
  const answerKey = (service.getQuiz("u1", created.id)!.data as { questions: Array<{ id: string; answerIndex: number }> }).questions;
  return { service, code, answerKey };
}

async function call(service: Service, options: InjectOptions, signedInAs?: string) {
  const app = Fastify();
  if (signedInAs) app.decorate("authenticateAccessToken", (token: string) => token === signedInAs ? { id: signedInAs, email: `${signedInAs}@example.test`, username: signedInAs, avatarId: null } : null);
  await app.register(buildPublicQuizRoutes(service));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, never> };
}

test("the public board never carries the answer key", async () => {
  const { service, code } = publishedQuiz();
  const { status, body } = await call(service, { method: "GET", url: `/quizzes/voting/${code}` });
  assert.equal(status, 200);
  const board = body.board as unknown as { questions: Array<Record<string, unknown>>; playOpen: boolean; questionCount: number };
  assert.equal(board.playOpen, true);
  assert.equal(board.questionCount, 3);
  for (const q of board.questions) {
    assert.equal("answerIndex" in q, false);
    assert.equal(q.options.length, 4);
    assert.ok(q.prompt);
  }
});

test("a closed quiz is a 403 on both the board and play", async () => {
  const { service, code } = publishedQuiz();
  const owned = service.listQuizzes("u1")[0]!;
  service.setPlayState("u1", owned.id, false);
  const board = await call(service, { method: "GET", url: `/quizzes/voting/${code}` });
  assert.equal(board.status, 403);
  // Well-shaped body: the 403 must come from play_open, not from zod.
  const play = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 } });
  assert.equal(play.status, 403);
});

test("a full submission is graded; wrong-shaped answers are a 400", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  const good = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 12345, playerName: "Alice" } });
  assert.equal(good.status, 200);
  assert.equal((good.body as unknown as { score: number }).score, answerKey.length);
  const bad = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 } });
  assert.equal(bad.status, 400);
});

test("a second play by the same account is a 409", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1 } }, "u9");
  const again = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1 } }, "u9");
  assert.equal(again.status, 409);
});

test("the public leaderboard lists plays best-first and hides ids", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 9000, playerName: "Slow" } });
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1000, playerName: "Fast" } });
  const { status, body } = await call(service, { method: "GET", url: `/quizzes/voting/${code}/results` });
  assert.equal(status, 200);
  const plays = (body as unknown as { plays: Array<{ playerName: string; score: number; durationMs: number }> }).plays;
  assert.deepEqual(plays.map((p) => p.playerName), ["Fast", "Slow"]);
  for (const play of plays) {
    assert.equal("playId" in play, false);
    assert.equal("voter_user_id" in play, false);
  }
});

test("an unknown code is a 404 everywhere", async () => {
  const { service } = publishedQuiz();
  assert.equal((await call(service, { method: "GET", url: "/quizzes/voting/nosuchcode" })).status, 404);
  assert.equal((await call(service, { method: "GET", url: "/quizzes/voting/nosuchcode/results" })).status, 404);
  // Well-shaped body: the 404 must come from the service, not from zod.
  const wellShaped = { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 };
  assert.equal((await call(service, { method: "POST", url: "/quizzes/voting/nosuchcode/play", body: wellShaped })).status, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `npx tsx --test src/modules/quizzes/routes.test.ts`
Expected: FAIL — `./routes.js` not found.

- [ ] **Step 3: Write `routes.ts`**

```ts
// HTTP layer for the quizzes module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// "Not found or not owned" is a plain undefined check here, same
// convention as tierlists' routes — not a caught exception.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { resolvePublicLibraryData } from "../library/index.js";
import type { PlayOutcome, Player, QuizzesService } from "./service.js";

const idParamSchema = z.object({ id: z.string().uuid() });
const codeParamSchema = z.object({ code: z.string().min(1).max(64) });

const quizBookSchema = z.object({
  key: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300),
  // Not .url(): the resolver's cached-cover URLs may be origin-relative.
  coverUrl: z.string().min(1).max(2000).nullable().optional(),
  quote: z.string().trim().max(2000).nullable().optional(),
  blurb: z.string().trim().max(4000).nullable().optional()
});

const createQuizSchema = z.object({
  name: z.string().trim().min(1, "name is required and must be non-empty.").max(200),
  data: z.object({
    sourceLabel: z.string().trim().max(200).default(""),
    questionCount: z.number().int().min(1).max(20).default(10),
    allowedTypes: z.array(z.enum(["cover_title", "title_cover", "quote_title", "blurb_title"])).min(1).default(["cover_title", "title_cover", "quote_title", "blurb_title"]),
    books: z.array(quizBookSchema).max(500).default([])
  })
});

// Light-touch on PUT, same as tierlists: only checks data is an object.
const updateQuizSchema = z
  .object({ name: z.string().min(1).optional(), data: z.record(z.unknown()).optional() })
  .refine((body) => body.name !== undefined || body.data !== undefined, { message: "At least one of name or data must be provided." });

const playStateSchema = z.object({ open: z.boolean() });

const playSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().min(1), choiceIndex: z.number().int().min(0).max(3) })).min(1).max(20),
  durationMs: z.number().int().min(0).max(3_600_000),
  playerName: z.string().trim().max(40).optional()
});

export function buildQuizRoutes(service: QuizzesService) {
  return async function quizRoutes(app: FastifyInstance) {
    app.get("/quizzes", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ quizzes: service.listQuizzes(request.user.id) });
    });

    app.post("/quizzes", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createQuizSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      const { name, data } = parsed.data;
      const keys = data.books.map((b) => b.key);
      if (new Set(keys).size !== keys.length) return reply.code(400).send({ error: "Duplicate book." });
      const quiz = service.createQuiz(request.user.id, name, data);
      return reply.code(201).send(quiz);
    });

    app.get("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const quiz = service.getQuiz(request.user.id, params.data.id);
      if (!quiz) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send(quiz);
    });

    app.put("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const body = updateQuizSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      // undefined = not found, not owned, OR already published — a
      // published quiz's seeded set must not drift, and 404 covers all
      // three without leaking which (same convention as tierlists).
      const quiz = service.updateQuiz(request.user.id, params.data.id, body.data);
      if (!quiz) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send(quiz);
    });

    app.delete("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const deleted = service.deleteQuiz(request.user.id, params.data.id);
      if (!deleted) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.code(204).send();
    });

    app.post("/quizzes/:id/publish", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const owned = service.getQuiz(request.user.id, params.data.id);
      if (!owned) return reply.code(404).send({ error: "No quiz with that id." });
      // Same public-cover resolver tierlists' open-voting route uses: book
      // keys become redacted public book shapes, never a raw library read.
      const data = owned.data as { books?: Array<{ key: string }> };
      const resolved = resolvePublicLibraryData(request.user.id, {
        bookKeys: (data.books ?? []).map((b) => b.key),
        highlightRefs: [],
        needsCurrentlyReading: false,
        statsMetrics: []
      }).books;
      const outcome = service.publishQuiz(request.user.id, params.data.id, resolved.map((b) => ({ bookKey: b.bookKey, coverUrl: b.coverUrl })));
      if (!outcome.ok) {
        if (outcome.reason === "not-found") return reply.code(404).send({ error: "No quiz with that id." });
        if (outcome.reason === "already-published") return reply.code(409).send({ error: outcome.error });
        return reply.code(400).send({ error: outcome.error });
      }
      return reply.code(201).send({ quiz: outcome.quiz, voteCode: outcome.quiz.voteCode });
    });

    app.put("/quizzes/:id/voting", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const body = playStateSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      const quiz = service.setPlayState(request.user.id, params.data.id, body.data.open);
      if (!quiz) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send({ quiz });
    });

    app.get("/quizzes/:id/results", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      // getResults is ownership-checked inside the service; undefined here
      // can only mean "not found or not owned".
      const results = service.getResults(request.user.id, params.data.id);
      if (!results) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send(results);
    });
  };
}

/** The public, unauthenticated surface — registered in its OWN Fastify
 *  encapsulation scope by plugin.ts so it carries the tight rate limit,
 *  exactly the split tierlists makes. The code is an identifier, not a
 *  secret: play_open and the answer-key strip are what protect the game. */
export function buildPublicQuizRoutes(service: QuizzesService) {
  return async function publicQuizRoutes(app: FastifyInstance) {
    app.get("/quizzes/voting/:code", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "No quiz at that link." });
      const board = service.getPlayBoard(params.data.code);
      if (!board) return reply.code(404).send({ error: "No quiz at that link." });
      if (!board.playOpen) return reply.code(403).send({ error: "This quiz isn't open for play." });
      return reply.send({ board });
    });

    app.post("/quizzes/voting/:code/play", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const body = playSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "Invalid play." });
      }
      const outcome = service.submitPlay(params.data.code, body.data.answers, body.data.durationMs, body.data.playerName ?? null, playerFor(request, null));
      return sendPlayOutcome(reply, outcome);
    });

    // Two shapes because the caller may hold either half of what playerFor
    // needs: an anonymous player has only the play id their device stored,
    // while a signed-in one is resolved from their account and never has
    // an id to send (same split as tierlists' readBallot).
    const readPlay = async (request: FastifyRequest, reply: FastifyReply) => {
      const params = codeParamSchema.safeParse(request.params);
      const playId = (request.params as { playId?: string }).playId ?? null;
      if (!params.success) return reply.code(404).send({ error: "No quiz at that link." });
      const outcome = service.getPlay(params.data.code, playerFor(request, playId));
      return sendPlayOutcome(reply, outcome);
    };
    app.get("/quizzes/voting/:code/play", readPlay);
    app.get("/quizzes/voting/:code/play/:playId", readPlay);

    app.get("/quizzes/voting/:code/results", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "No quiz at that link." });
      const results = service.getPublicResults(params.data.code);
      if (!results) return reply.code(404).send({ error: "No quiz at that link." });
      return reply.send(results);
    });
  };
}

/** A signed-in caller always plays as their account (the DB's partial
 *  unique index is the authority on one-play-per-account); everyone else
 *  plays as the play id their browser is holding. */
function playerFor(request: FastifyRequest, playId: string | null): Player {
  const user = getOptionalAuthenticatedUser(request);
  return user ? { kind: "user", userId: user.id } : { kind: "anonymous", playId };
}

function sendPlayOutcome(reply: FastifyReply, outcome: PlayOutcome) {
  if (!outcome.ok) {
    if (outcome.reason === "not-found") return reply.code(404).send({ error: "No quiz at that link." });
    if (outcome.reason === "closed") return reply.code(403).send({ error: "This quiz isn't open for play." });
    if (outcome.reason === "already-played") return reply.code(409).send({ error: "You've already played this quiz." });
    return reply.code(400).send({ error: "Those answers don't match this quiz." });
  }
  return reply.send({ playId: outcome.playId, score: outcome.score, correct: outcome.correct });
}
```

- [ ] **Step 4: Write `plugin.ts` and `index.ts`**

`plugin.ts`:

```ts
// The quizzes module's Fastify plugin and composition root — mirrors
// modules/tierlists/plugin.ts: two route builders, each in its OWN
// encapsulation scope so the public one carries its rate limit.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openQuizzesDb } from "./adapters/sqlite/connection.js";
import { createSqliteQuizzesRepository } from "./adapters/sqlite/sqliteQuizzesRepository.js";
import { buildPublicQuizRoutes, buildQuizRoutes } from "./routes.js";
import { createQuizzesService } from "./service.js";

export async function quizzesPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openQuizzesDb();
  const quizzesService = createQuizzesService(createSqliteQuizzesRepository(db));
  // -----------------------------------------------------------------------

  await app.register(buildQuizRoutes(quizzesService));

  // Same 30/minute public-write limit as tierlists' ballot routes: this
  // surface is unauthenticated AND writes (a play).
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicQuizRoutes(quizzesService));
  });
}
```

`index.ts`:

```ts
// Public interface of the quizzes module. Everything else in
// modules/quizzes/ is private implementation — same convention as
// modules/tierlists/index.ts.

export { quizzesPlugin as registerQuizzesModule } from "./plugin.js";
```

- [ ] **Step 5: Register the module in `backend/src/app.ts`**

Add to the import block (after the tierlists import at line ~34):

```ts
import { registerQuizzesModule } from "./modules/quizzes/index.js";
```

Add after the existing `app.register(registerTierlistsModule, ...)` block (line ~151):

```ts
app.register(registerQuizzesModule);
```

- [ ] **Step 6: Run the routes test, then the whole backend suite**

Run (from `backend/`): `npx tsx --test src/modules/quizzes/routes.test.ts`
Expected: PASS (all 6 tests).

Run: `npm test --workspace backend`
Expected: PASS (existing suites + the three new files).

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck --workspace backend`
Expected: PASS.

```bash
git add backend/src/modules/quizzes backend/src/app.ts
git commit -m "backend: quizzes routes, plugin, app registration"
```
---

### Task 5: Frontend API client and hooks

**Files:**
- Create: `frontend/src/api/quizzes.ts`
- Create: `frontend/src/hooks/useQuizzes.ts`
- Create: `frontend/src/hooks/useQuizPlay.ts`

**Interfaces:**
- Consumes: backend routes from Task 4; shared types from Task 1; `apiFetch`/`publicFetch` from `api/client`; `getSession` from `auth/tokenStore`.
- Produces: `Quiz`, `PlayBoard`, `PlayResponse`, `ResultPlay`, `QuestionStat` types and the fetch/mutate functions Tasks 6–8 use.

- [ ] **Step 1: Write `api/quizzes.ts`**

```ts
// Thin apiFetch/publicFetch wrappers over the quizzes module's REST routes
// (backend's modules/quizzes/routes.ts) — same "one function per backend
// route, no client-side logic" shape as api/tierlists.ts. Quiz book and
// question types come from @scripta/shared, where the draw and grading
// logic they mirror live.

import { getSession } from "../auth/tokenStore";
import { apiFetch, publicFetch } from "./client";
import type { PublicQuizQuestion, QuestionStat, QuizData, ResultPlay } from "@scripta/shared";

export type { PublicQuizQuestion, QuestionStat, QuizData, ResultPlay };

export interface Quiz {
  id: string;
  name: string;
  data: QuizData;
  voteCode: string | null;
  playOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlayBoard {
  name: string;
  sourceLabel: string;
  questionCount: number;
  playOpen: boolean;
  playCount: number;
  questions: PublicQuizQuestion[];
}

export interface PlayResponse {
  playId: string;
  score: number;
  correct: Record<string, boolean>;
}

/** Play routes are public, but a caller WITH a session must still send its
 *  token: the backend's one-play-per-account dedupe only engages when the
 *  request identifies a user (same split as tierlistVoting's ballotFetch). */
async function playFetch(path: string, init?: RequestInit): Promise<unknown> {
  return (getSession() ? apiFetch : publicFetch)(path, init);
}

export async function fetchQuizzes(): Promise<Quiz[]> {
  const body = (await apiFetch("/quizzes")) as { quizzes: Quiz[] };
  return body.quizzes;
}

export async function fetchQuiz(id: string): Promise<Quiz> {
  return (await apiFetch(`/quizzes/${id}`)) as Quiz;
}

export async function createQuizApi(name: string, data: QuizData): Promise<Quiz> {
  return (await apiFetch("/quizzes", { method: "POST", body: JSON.stringify({ name, data }) })) as Quiz;
}

export async function updateQuizApi(id: string, patch: { name?: string; data?: QuizData }): Promise<Quiz> {
  return (await apiFetch(`/quizzes/${id}`, { method: "PUT", body: JSON.stringify(patch) })) as Quiz;
}

export async function deleteQuizApi(id: string): Promise<void> {
  await apiFetch(`/quizzes/${id}`, { method: "DELETE" });
}

export async function publishQuizApi(id: string): Promise<{ quiz: Quiz; voteCode: string }> {
  return (await apiFetch(`/quizzes/${id}/publish`, { method: "POST" })) as { quiz: Quiz; voteCode: string };
}

export async function setPlayStateApi(id: string, open: boolean): Promise<Quiz> {
  const body = (await apiFetch(`/quizzes/${id}/voting`, { method: "PUT", body: JSON.stringify({ open }) })) as { quiz: Quiz };
  return body.quiz;
}

export async function fetchQuizResultsApi(id: string): Promise<{ plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number }> {
  return (await apiFetch(`/quizzes/${id}/results`)) as { plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number };
}

export async function fetchPlayBoard(code: string): Promise<PlayBoard> {
  const body = (await publicFetch(`/quizzes/voting/${encodeURIComponent(code)}`)) as { board: PlayBoard };
  return body.board;
}

export async function submitPlayApi(
  code: string,
  body: { answers: Array<{ questionId: string; choiceIndex: number }>; durationMs: number; playerName?: string }
): Promise<PlayResponse> {
  return (await playFetch(`/quizzes/voting/${encodeURIComponent(code)}/play`, { method: "POST", body: JSON.stringify(body) })) as PlayResponse;
}

/** A null playId asks for the signed-in account's own play (the only way
 *  a signed-in player can recover it — no id is ever stored for them); an
 *  anonymous player passes the id their browser stored at submit. */
export async function fetchPlayApi(code: string, playId: string | null): Promise<PlayResponse> {
  const encodedCode = encodeURIComponent(code);
  const path = playId === null ? `/quizzes/voting/${encodedCode}/play` : `/quizzes/voting/${encodedCode}/play/${encodeURIComponent(playId)}`;
  return (await playFetch(path)) as PlayResponse;
}

export async function fetchPublicResultsApi(code: string): Promise<{ plays: ResultPlay[]; questionCount: number }> {
  return (await publicFetch(`/quizzes/voting/${encodeURIComponent(code)}/results`)) as { plays: ResultPlay[]; questionCount: number };
}
```

- [ ] **Step 2: Write `hooks/useQuizzes.ts`** (mirror `useTierlists`)

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteQuizApi, fetchQuizzes, type Quiz } from "../api/quizzes";

export function useQuizzes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["quizzes"], queryFn: fetchQuizzes });

  async function remove(id: string) {
    await deleteQuizApi(id);
    await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
  }

  return { ...query, remove };
}
```

- [ ] **Step 3: Write `hooks/useQuizPlay.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchPlayApi, fetchPlayBoard, type PlayResponse } from "../api/quizzes";

const playStorageKey = (code: string) => `quiz-play-${code}`;

export function useQuizPlay(code: string) {
  const board = useQuery({ queryKey: ["quizBoard", code], queryFn: () => fetchPlayBoard(code), retry: false });
  // Read only once the board resolved, so a bad code never touches
  // storage; a signed-in player has no stored id and passes null, which
  // the backend answers from their account.
  const playId = board.isSuccess ? localStorage.getItem(playStorageKey(code)) : null;
  const ownPlay = useQuery({
    queryKey: ["quizOwnPlay", code, playId],
    queryFn: () => fetchPlayApi(code, playId),
    enabled: board.isSuccess,
    retry: false
  });
  return { board, ownPlay, playId };
}

export function storePlayId(code: string, playId: string): void {
  localStorage.setItem(playStorageKey(code), playId);
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: PASS.

```bash
git add frontend/src/api/quizzes.ts frontend/src/hooks/useQuizzes.ts frontend/src/hooks/useQuizPlay.ts
git commit -m "frontend: quizzes api client and hooks"
```
---

### Task 6: Arena "Quizzes" tab, create page, dashboard routes

**Files:**
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Create: `frontend/src/pages/QuizCreatePage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useQuizzes`/`createQuizApi` (Task 5); `useLibrary` (existing); `bookKey`, `booksInGroup`, `eligibleTypes`, `QUIZ_POOL`, `QUIZ_QUESTION_TYPES` from `@scripta/shared`.
- Produces: routes `/dashboard/arena/quiz/new` and `/dashboard/arena/quiz/:id` (editor lands in Task 7 — add the import/route in Task 7's step to keep this task compiling standalone).

- [ ] **Step 1: Widen the Arena tab control to three tabs**

In `frontend/src/pages/ArenaListPage.tsx`:

1. Add to the imports:

```tsx
import { useQuizzes } from "../hooks/useQuizzes";
```

2. Replace the tab parse (line ~37):

```tsx
const tab = searchParams.get("tab") === "tierlists" ? "tierlists" : "tournaments";
```

with:

```tsx
const tab = searchParams.get("tab") === "tierlists" ? "tierlists" : searchParams.get("tab") === "quizzes" ? "quizzes" : "tournaments";
```

3. Widen `handleTabSwitch`'s parameter type to `"tournaments" | "tierlists" | "quizzes"` (the body already handles set/delete generically).

4. In the hook block (after `useVotedTournaments`), add:

```tsx
const { data: quizzesData, isLoading: quizzesLoading, remove: removeQuiz } = useQuizzes();
const quizzes = quizzesData ?? [];
const showQuizSkeleton = useDelayedShow(quizzesLoading);
```

5. Replace the segmented control's array and label:

```tsx
{(["tournaments", "tierlists"] as const).map((t, i) => (
```

becomes

```tsx
{(["tournaments", "tierlists", "quizzes"] as const).map((t, i) => (
```

and the label expression `{t === "tournaments" ? "Tournaments" : "Tier lists"}` becomes `{t === "tournaments" ? "Tournaments" : t === "tierlists" ? "Tier lists" : "Quizzes"}`. Widen the control for three buttons: `sm:w-72` → `sm:w-fit` with `min-w-72`.

6. Add the quizzes panel after the `{tab === "tierlists" && (...)}` block, before the closing `</div>`:

```tsx
{tab === "quizzes" && (
  <>
    {showQuizSkeleton && <SkeletonCardGrid count={3} label="Loading quizzes" tileClassName="min-h-[86px]" />}

    {!quizzesLoading && quizzes.length === 0 && (
      <EmptyState
        icon={ArenaIcon}
        title="No quizzes yet."
        body="A quiz turns your books into trivia — guess the title from a blurred cover, or the book from a famous line."
      />
    )}

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        onClick={() => navigate("/dashboard/arena/quiz/new")}
        className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
      >
        <PlusIcon />
        <span className="text-sm font-semibold">New quiz</span>
      </button>

      {quizzes.map((quiz) => (
        <div
          key={quiz.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/dashboard/arena/quiz/${quiz.id}`)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
              e.preventDefault();
              navigate(`/dashboard/arena/quiz/${quiz.id}`);
            }
          }}
          className="relative cursor-pointer rounded-xl border border-(--color-border) bg-(--color-surface) hover:border-(--color-accent)"
        >
          <div className="p-4 pr-12">
            <h3 className="font-semibold">{quiz.name}</h3>
            <p className="text-sm text-(--color-text-dim)">
              {quiz.data.books.length} books · {quiz.voteCode === null ? "Draft" : quiz.playOpen ? "Open" : "Closed"}
            </p>
          </div>
          <OptionsMenu
            title="Quiz settings"
            triggerClassName="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
            items={[{ label: "Delete", onClick: () => void handleDeleteQuiz(quiz), danger: true }]}
          />
        </div>
      ))}
    </div>
  </>
)}
```

7. Add the delete handler next to `handleDeleteTierlist` (reuse the same `confirm` hook):

```tsx
async function handleDeleteQuiz(quiz: Quiz) {
  if (!(await confirm({ title: `Delete "${quiz.name}"?`, body: "This can't be undone." }))) return;
  await removeQuiz(quiz.id);
}
```

and import the `Quiz` type: `import type { Quiz } from "../api/quizzes";`

- [ ] **Step 2: Write `QuizCreatePage.tsx`**

Mirrors `TierListCreatePage`'s wizard shape. Sources: whole shelf, one collection, or the curated pool. Quote/blurb pasting happens in the editor (Task 7), so shelf/collection books start with `quote: null`.

```tsx
// /dashboard/arena/quiz/new — two-step create: pick a source and its
// books, then set length and question types. Quotes are pasted later in
// the editor; the pool ships with famous first lines already attached.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QUIZ_POOL, QUIZ_QUESTION_TYPES, bookKey, booksInGroup, eligibleTypes, type QuizBook, type QuizData, type QuizQuestionType } from "@scripta/shared";
import { PageContainer } from "../components/PageContainer";
import { createQuizApi } from "../api/quizzes";
import { useLibrary } from "../hooks/useLibrary";

function toQuizBook(book: Record<string, unknown>): QuizBook {
  return {
    key: bookKey(book),
    title: String(book.Title ?? "Untitled"),
    author: String(book.Attribution ?? ""),
    coverUrl: typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : null,
    quote: null,
    blurb: null
  };
}

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Guess the title from a blurred cover",
  title_cover: "Guess the cover from the title",
  quote_title: "Guess the book from a quote",
  blurb_title: "Guess the book from its blurb"
};

export function QuizCreatePage() {
  const navigate = useNavigate();
  const { data: library, isLoading, isError, refetch } = useLibrary();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"shelf" | "collection" | "pool">("shelf");
  const [collectionId, setCollectionId] = useState("");
  const [poolKeys, setPoolKeys] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [allowedTypes, setAllowedTypes] = useState<QuizQuestionType[]>([...QUIZ_QUESTION_TYPES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const libraryBooks = library?.data.books ?? [];
  const collections = (library?.data.groups ?? []).filter((group) => group.type === "collection");
  const collection = collections.find((group) => group.id === collectionId);

  const books: QuizBook[] =
    source === "pool"
      ? QUIZ_POOL.filter((book) => poolKeys.includes(book.key))
      : source === "collection"
        ? collection
          ? booksInGroup(collection, libraryBooks).map(toQuizBook)
          : []
        : libraryBooks.map(toQuizBook);

  // A type is offerable only if at least one chosen book has the data it
  // needs — same eligibility rule the backend's publish enforces.
  const availableTypes = QUIZ_QUESTION_TYPES.filter((type) => books.some((book) => eligibleTypes(book).includes(type)));
  const effectiveTypes = allowedTypes.filter((type) => availableTypes.includes(type));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data: QuizData = {
        sourceLabel: source === "pool" ? "Famous books" : source === "collection" ? collection?.name ?? "Collection" : "My shelf",
        questionCount,
        allowedTypes: effectiveTypes.length > 0 ? effectiveTypes : availableTypes,
        books,
        questions: null
      };
      const created = await createQuizApi(name.trim() || "Untitled quiz", data);
      navigate(`/dashboard/arena/quiz/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create the quiz.");
      setBusy(false);
    }
  }

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-10">
        <Link to="/dashboard/arena?tab=quizzes" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">← Quizzes</Link>
        <div>
          <p className="text-sm text-(--color-text-dim)">Step {step + 1} of 2</p>
          <h1 className="text-2xl font-bold">{["Choose books", "Set up questions"][step]}</h1>
        </div>
        {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}
        {step === 0 && (
          <>
            <label className="flex flex-col gap-1 text-sm font-semibold">Quiz name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder="Untitled quiz" className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2" />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Question source</legend>
              {([
                ["shelf", "My whole shelf"],
                ["collection", "One of my collections"],
                ["pool", "Famous books (anyone can play)"]
              ] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 rounded-lg border border-(--color-border) p-3">
                  <input type="radio" checked={source === value} onChange={() => setSource(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            {source === "collection" && (
              <label className="flex flex-col gap-1 text-sm font-semibold">Collection
                <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
                  <option value="">Choose a collection…</option>
                  {collections.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
            )}
            {source === "pool" && (
              <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                {QUIZ_POOL.map((book) => {
                  const checked = poolKeys.includes(book.key);
                  return (
                    <button
                      key={book.key}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => setPoolKeys((value) => (checked ? value.filter((entry) => entry !== book.key) : [...value, book.key]))}
                      className={`flex min-h-12 w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${checked ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface)"}`}
                    >
                      <span className="truncate">{book.title} <span className="text-(--color-text-dim)">· {book.author}</span></span>
                      <span aria-hidden="true">{checked ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {source === "shelf" && (
              <p className="text-sm text-(--color-text-dim)">
                {isLoading ? "Loading books…" : isError ? <button onClick={() => void refetch()} className="text-left text-(--color-accent)">Couldn't load your library. Retry</button> : `${libraryBooks.length} books on your shelf.`}
              </p>
            )}
            <p className="text-sm text-(--color-text-dim)">{books.length} {books.length === 1 ? "book" : "books"} selected</p>
          </>
        )}
        {step === 1 && (
          <>
            <label className="flex flex-col gap-1 text-sm font-semibold">Questions
              <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
                {[5, 10, 15, 20].map((count) => (
                  <option key={count} value={count}>{count} questions</option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Question types</legend>
              {QUIZ_QUESTION_TYPES.map((type) => {
                const offered = availableTypes.includes(type);
                const checked = offered && effectiveTypes.includes(type);
                return (
                  <label key={type} className={`flex items-center gap-2 rounded-lg border p-3 ${offered ? "border-(--color-border)" : "border-(--color-border) opacity-50"}`}>
                    <input
                      type="checkbox"
                      disabled={!offered}
                      checked={checked}
                      onChange={() => setAllowedTypes((value) => (value.includes(type) ? value.filter((entry) => entry !== type) : [...value, type]))}
                    />
                    {TYPE_LABELS[type]}
                    {!offered && <span className="ml-auto text-xs text-(--color-text-dim)">no book has this data</span>}
                  </label>
                );
              })}
            </fieldset>
          </>
        )}
        <div className="flex justify-end gap-3 pt-2">
          {step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="min-h-11 rounded-lg border border-(--color-border) px-4">Back</button>}
          {step < 1 ? (
            <button
              type="button"
              disabled={books.length < BOOK_COUNT || (source === "collection" && !collection)}
              onClick={() => setStep(1)}
              className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || effectiveTypes.length === 0 || questionCount > books.length}
              onClick={() => void submit()}
              className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create quiz"}
            </button>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
```

(Optionally export `toQuizBook` and `TYPE_LABELS` from a small `lib/quizzes.ts` if the editor (Task 7) needs them again — keep them here otherwise.)

- [ ] **Step 3: Add the dashboard route in `frontend/src/App.tsx`**

In the import block:

```tsx
import { QuizCreatePage } from "./pages/QuizCreatePage";
```

Inside the authed dashboard `<Route path="/dashboard" ...>` block, next to the tierlist routes (line ~78):

```tsx
<Route path="/dashboard/arena/quiz/new" element={<QuizCreatePage />} />
```

(The editor route for `/dashboard/arena/quiz/:id` is added in Task 7 when that page exists.)

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: PASS.

```bash
git add frontend/src/pages/ArenaListPage.tsx frontend/src/pages/QuizCreatePage.tsx frontend/src/App.tsx
git commit -m "frontend: Quizzes arena tab and quiz create page"
```
---

### Task 7: Quiz editor page — books, quotes, publish, share, results

**Files:**
- Create: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/App.tsx` (import + editor route)

**Interfaces:**
- Consumes: `Quiz`/`updateQuizApi`/`publishQuizApi`/`setPlayStateApi`/`fetchQuizResultsApi` (Task 5); `useQuizzes` (Task 5); `CoverImage` (existing `components/BookCard`); react-query.
- Produces: route `/dashboard/arena/quiz/:id`.

The page has two modes split on `quiz.voteCode`:

- **Draft** (`voteCode === null`): name shown, book rows (title/author + remove), per-book quote and blurb textareas committed on blur, length/type selectors, Publish button. Publishing locks the document server-side (PUT 404s afterwards) and mints the code.
- **Published** (`voteCode !== null`): share link + copy, open/close toggle, seeded question preview (owner GET carries `answerIndex`), results section (leaderboard + per-question pick bars).

- [ ] **Step 1: Write `QuizEditorPage.tsx`**

```tsx
// /dashboard/arena/quiz/:id — the owner's quiz editor. Draft mode edits
// the document (books, quotes, blurbs, length, types) with onBlur commits;
// Publish mints the vote code and freezes the document server-side.
// Published mode is read-only plus the share/open controls and results.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QUIZ_QUESTION_TYPES, eligibleTypes, type QuizData, type QuizQuestionType } from "@scripta/shared";
import { PageContainer } from "../components/PageContainer";
import { useConfirm } from "../components/ConfirmDialog";
import { deleteQuizApi, fetchQuizResultsApi, publishQuizApi, setPlayStateApi, updateQuizApi, type Quiz } from "../api/quizzes";
import { useQuizzes } from "../hooks/useQuizzes";
import { useLibrary } from "../hooks/useLibrary";

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Blurred cover → title",
  title_cover: "Title → cover",
  quote_title: "Quote → title",
  blurb_title: "Blurb → title"
};

export function QuizEditorPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: quizzes, isLoading } = useQuizzes();
  const quiz = (quizzes ?? []).find((entry) => entry.id === id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(id: string, data: QuizData) {
    try {
      await updateQuizApi(id, { data });
      await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save.");
    }
  }

  function patchBook(quiz: Quiz, bookKey: string, patch: { quote?: string | null; blurb?: string | null }) {
    const next: QuizData = {
      ...quiz.data,
      books: quiz.data.books.map((book) => (book.key === bookKey ? { ...book, ...patch } : book))
    };
    return save(quiz.id, next);
  }

  async function publish(quiz: Quiz) {
    setBusy(true);
    setError(null);
    try {
      await publishQuizApi(quiz.id);
      await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't publish.");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageContainer><p className="px-5 py-8 text-(--color-text-dim)">Loading…</p></PageContainer>;
  if (!quiz) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Link to="/dashboard/arena?tab=quizzes" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">← Quizzes</Link>
          <p className="mt-4 text-(--color-text-dim)">No quiz with that id.</p>
        </div>
      </PageContainer>
    );
  }

  const data = quiz.data;
  const shareLink = quiz.voteCode ? `${window.location.origin}/play/${quiz.voteCode}` : null;

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-10">
        <Link to="/dashboard/arena?tab=quizzes" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">← Quizzes</Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{quiz.name}</h1>
          {quiz.voteCode === null && (
            <button
              type="button"
              onClick={() => { void confirm({ title: `Delete "${quiz.name}"?`, body: "This can't be undone." }).then(async (yes) => { if (yes) { await deleteQuizApi(quiz.id); await queryClient.invalidateQueries({ queryKey: ["quizzes"] }); window.location.href = "/dashboard/arena?tab=quizzes"; } }); }}
              className="min-h-10 rounded-lg border border-(--color-border) px-3 text-sm text-(--color-danger)"
            >
              Delete
            </button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}

        {quiz.voteCode === null && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                Questions
                <select
                  value={data.questionCount}
                  onChange={(event) => void save(quiz.id, { ...data, questionCount: Number(event.target.value) })}
                  className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
                >
                  {[5, 10, 15, 20].map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {QUIZ_QUESTION_TYPES.map((type) => {
                  const offered = data.books.some((book) => eligibleTypes(book).includes(type));
                  const checked = offered && data.allowedTypes.includes(type);
                  return (
                    <label key={type} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${offered ? "border-(--color-border)" : "border-(--color-border) opacity-50"}`}>
                      <input
                        type="checkbox"
                        disabled={!offered}
                        checked={checked}
                        onChange={() =>
                          void save(quiz.id, {
                            ...data,
                            allowedTypes: checked ? data.allowedTypes.filter((entry) => entry !== type) : [...data.allowedTypes, type]
                          })
                        }
                      />
                      {TYPE_LABELS[type]}
                    </label>
                  );
                })}
              </div>
            </div>

            {data.books.map((book) => (
              <div key={book.key} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{book.title}</h3>
                    <p className="text-sm text-(--color-text-dim)">{book.author}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void save(quiz.id, { ...data, books: data.books.filter((entry) => entry.key !== book.key) })}
                    className="min-h-9 rounded-lg border border-(--color-border) px-3 text-sm"
                  >
                    Remove
                  </button>
                </div>
                <label className="mt-2 flex flex-col gap-1 text-sm">
                  Quote (optional)
                  <textarea
                    rows={2}
                    defaultValue={book.quote ?? ""}
                    placeholder="Paste a line from this book…"
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (book.quote ?? "")) void patchBook(quiz, book.key, { quote: value || null });
                    }}
                    className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
                  />
                </label>
                <label className="mt-2 flex flex-col gap-1 text-sm">
                  Blurb (optional)
                  <textarea
                    rows={2}
                    defaultValue={book.blurb ?? ""}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (book.blurb ?? "")) void patchBook(quiz, book.key, { blurb: value || null });
                    }}
                    className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
                  />
                </label>
              </div>
            ))}

            <button
              type="button"
              disabled={busy || data.books.length < 4}
              onClick={() => void publish(quiz)}
              className="min-h-11 self-start rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Publishing…" : "Publish quiz"}
            </button>
            {data.books.length < 4 && <p className="text-sm text-(--color-text-dim)">A quiz needs at least 4 books.</p>}
          </section>
        )}

        {quiz.voteCode !== null && <PublishedSection quiz={quiz} shareLink={shareLink!} copied={copied} setCopied={setCopied} />}
      </div>
    </PageContainer>
  );
}

function PublishedSection({ quiz, shareLink, copied, setCopied }: { quiz: Quiz; shareLink: string; copied: boolean; setCopied: (value: boolean) => void }) {
  const queryClient = useQueryClient();
  const results = useQuery({ queryKey: ["quizResults", quiz.id], queryFn: () => fetchQuizResultsApi(quiz.id) });
  const ownerQuestions = quiz.data.questions ?? [];

  async function toggleOpen(open: boolean) {
    await setPlayStateApi(quiz.id, open);
    await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-(--color-surface-hover) px-3 py-2 text-sm">{shareLink}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(shareLink);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="min-h-10 rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-white"
        >
          {copied ? "Copied!" : "Copy challenge link"}
        </button>
        <button
          type="button"
          onClick={() => void toggleOpen(!quiz.playOpen)}
          className="min-h-10 rounded-lg border border-(--color-border) px-3 text-sm"
        >
          {quiz.playOpen ? "Close for play" : "Open for play"}
        </button>
      </div>

      <h2 className="text-lg font-bold">Questions ({ownerQuestions.length})</h2>
      <ol className="flex flex-col gap-2">
        {ownerQuestions.map((question, index) => (
          <li key={question.id} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm">
            <span className="text-(--color-text-dim)">{index + 1}. {TYPE_LABELS[question.type]}</span>
            <span className="ml-2 font-semibold">{String(question.options[question.answerIndex])}</span>
          </li>
        ))}
      </ol>

      <h2 className="text-lg font-bold">Results</h2>
      {results.data && results.data.plays.length === 0 && <p className="text-sm text-(--color-text-dim)">No one has played yet.</p>}
      {results.data && results.data.plays.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-(--color-text-dim)">
              <th className="py-1 pr-3 font-medium">#</th>
              <th className="py-1 pr-3 font-medium">Player</th>
              <th className="py-1 pr-3 font-medium">Score</th>
              <th className="py-1 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {results.data.plays.map((play, index) => (
              <tr key={play.playId} className="border-t border-(--color-border)">
                <td className="py-1.5 pr-3">{index + 1}</td>
                <td className="py-1.5 pr-3">{play.playerName ?? "Guest"}</td>
                <td className="py-1.5 pr-3">{play.score}/{results.data!.questionCount}</td>
                <td className="py-1.5">{(play.durationMs / 1000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {results.data && results.data.stats.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Per-question stats</h2>
          {results.data.stats.map((stat) => (
            <div key={stat.questionId} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
              <p className="text-sm font-semibold">
                {stat.questionId} · {stat.correctCount}/{stat.answerCount} correct
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {stat.picks.map((pick) => (
                  <div key={pick.choiceIndex} className="flex items-center gap-2 text-xs text-(--color-text-dim)">
                    <span className="w-6">#{pick.choiceIndex + 1}</span>
                    <span className="h-2 rounded bg-(--color-accent-soft)" style={{ width: `${Math.round((pick.count / stat.answerCount) * 100)}%` }} />
                    <span>{pick.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add the route in `frontend/src/App.tsx`**

Import:

```tsx
import { QuizEditorPage } from "./pages/QuizEditorPage";
```

Route, directly under the create route added in Task 6:

```tsx
<Route path="/dashboard/arena/quiz/:id" element={<QuizEditorPage />} />
```

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: PASS.

```bash
git add frontend/src/pages/QuizEditorPage.tsx frontend/src/App.tsx
git commit -m "frontend: quiz editor — quotes, publish, share link, results"
```
---

### Task 8: Public play page — `/play/:code`

**Files:**
- Create: `frontend/src/pages/PlayQuizPage.tsx`
- Modify: `frontend/src/App.tsx` (public route)

**Interfaces:**
- Consumes: `useQuizPlay`/`storePlayId` (Task 5); `submitPlayApi`/`fetchPublicResultsApi` (Task 5); public route pattern of `VoteTierlistPage` (outside every `RequireAuth` wrapper).

Page states, in priority order: board loading → board error (404 not-found / 403 closed) → own play exists (results view, covers returning players AND just-submitted) → play view.

- [ ] **Step 1: Write `PlayQuizPage.tsx`**

```tsx
// /play/:code — the page a challenge link recipient lands on (see
// App.tsx: OUTSIDE every RequireAuth wrapper, same treatment as
// /vote/:code). One question at a time, timer running from first render,
// submit grades server-side and locks the play. The end screen shows the
// score, the per-question verdicts, the leaderboard, and the same link
// back — that loop is the challenge.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { PublicQuizQuestion } from "@scripta/shared";
import { fetchPublicResultsApi, submitPlayApi, type PlayResponse } from "../api/quizzes";
import { storePlayId, useQuizPlay } from "../hooks/useQuizPlay";

function InfoScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 text-center">
      <p className="text-(--color-text-dim)">{message}</p>
    </div>
  );
}

function Prompt({ question }: { question: PublicQuizQuestion }) {
  if (question.type === "cover_title") {
    return <img src={question.prompt} alt="Which book is this?" className="mx-auto h-56 w-40 rounded-lg object-cover blur-md" />;
  }
  if (question.type === "title_cover") {
    return <p className="text-center text-2xl font-bold">{question.prompt}</p>;
  }
  return <p className="text-center font-serif text-lg italic leading-relaxed">“{question.prompt}”</p>;
}

function Options({ question, onPick, picked }: { question: PublicQuizQuestion; onPick: (index: number) => void; picked: number | null }) {
  if (question.type === "title_cover") {
    return (
      <div className="grid grid-cols-2 gap-3">
        {question.options.map((option, index) => (
          <button
            key={option}
            type="button"
            disabled={picked !== null}
            onClick={() => onPick(index)}
            className={`overflow-hidden rounded-xl border-2 transition-colors ${picked === index ? "border-(--color-accent)" : "border-(--color-border) hover:border-(--color-text-dim)"}`}
          >
            <img src={option} alt={`Option ${index + 1}`} className="h-44 w-full object-cover" />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {question.options.map((option, index) => (
        <button
          key={option}
          type="button"
          disabled={picked !== null}
          onClick={() => onPick(index)}
          className={`min-h-11 rounded-lg border px-4 py-2 text-left text-sm font-semibold transition-colors ${picked === index ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface) hover:border-(--color-text-dim)"}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function PlayQuizPage() {
  const { code } = useParams();
  const { board, ownPlay, playId } = useQuizPlay(code ?? "");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [playerName, setPlayerName] = useState("");
  const [submitted, setSubmitted] = useState<PlayResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (board.isPending) return <InfoScreen message="Loading…" />;
  if (board.isError) return <InfoScreen message={board.error instanceof Error ? board.error.message : "No quiz at that link."} />;
  const playBoard = board.data;
  if (!playBoard.playOpen) return <InfoScreen message="This quiz isn't open for play." />;

  const result = submitted ?? (ownPlay.data ?? null);
  const questions = playBoard.questions;

  if (result) {
    return <ResultsView code={code ?? ""} result={result} questions={questions} copied={copied} setCopied={setCopied} alreadyPlayed={submitted === null} />;
  }

  const question = questions[index];
  if (!question) return <InfoScreen message="This quiz has no questions yet." />;

  function pick(choiceIndex: number) {
    setPicked(choiceIndex);
    setAnswers((value) => ({ ...value, [question!.id]: choiceIndex }));
    window.setTimeout(() => {
      setPicked(null);
      setIndex((value) => Math.min(value + 1, questions.length - 1));
    }, 220);
  }

  async function submit() {
    if (Object.keys(answers).length !== questions.length) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const response = await submitPlayApi(code ?? "", {
        answers: questions.map((q) => ({ questionId: q.id, choiceIndex: answers[q.id] ?? 0 })),
        durationMs: Date.now() - startRef.current,
        ...(playerName.trim() ? { playerName: playerName.trim() } : {})
      });
      storePlayId(code ?? "", response.playId);
      setSubmitted(response);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : "Couldn't submit your answers.");
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = Object.keys(answers).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-5 py-8">
      <div className="flex items-center justify-between text-sm text-(--color-text-dim)">
        <span>{playBoard.name}</span>
        <span>
          {index + 1}/{questions.length} · {Math.floor(elapsed / 1000)}s
        </span>
      </div>
      <div className="h-1 rounded bg-(--color-surface-hover)">
        <div className="h-1 rounded bg-(--color-accent) transition-all" style={{ width: `${Math.round((answeredCount / questions.length) * 100)}%` }} />
      </div>

      <Prompt question={question} />
      <Options question={question} picked={picked} onPick={pick} />

      {index === questions.length - 1 && answeredCount === questions.length && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Name for the leaderboard (optional)
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              maxLength={40}
              placeholder="Guest"
              className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
            />
          </label>
          {submitError && <p role="alert" className="text-sm text-(--color-danger)">{submitError}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Scoring…" : "See my score"}
          </button>
        </div>
      )}
    </div>
  );
}

function ResultsView({
  code,
  result,
  questions,
  copied,
  setCopied,
  alreadyPlayed
}: {
  code: string;
  result: PlayResponse;
  questions: PublicQuizQuestion[];
  copied: boolean;
  setCopied: (value: boolean) => void;
  alreadyPlayed: boolean;
}) {
  const leaderboard = useQuery({ queryKey: ["quizPublicResults", code], queryFn: () => fetchPublicResultsApi(code) });
  const shareLink = `${window.location.origin}/play/${code}`;
  const score = result.score;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-5 py-8">
      <div className="text-center">
        <p className="text-sm text-(--color-text-dim)">{alreadyPlayed ? "You already played this quiz." : "Your score"}</p>
        <p className="text-5xl font-bold text-(--color-accent)">
          {score}/{questions.length}
        </p>
      </div>

      <ol className="flex flex-col gap-1.5 text-sm">
        {questions.map((question, i) => (
          <li key={question.id} className="flex items-center justify-between rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
            <span className="text-(--color-text-dim)">{i + 1}</span>
            <span aria-hidden="true">{result.correct[question.id] ? "✓" : "✗"}</span>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-(--color-surface-hover) px-3 py-2 text-sm">{shareLink}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(shareLink);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="min-h-10 shrink-0 rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-white"
        >
          {copied ? "Copied!" : "Challenge someone"}
        </button>
      </div>

      {leaderboard.data && (
        <div>
          <h2 className="mb-2 text-lg font-bold">Leaderboard</h2>
          <table className="w-full text-sm">
            <tbody>
              {leaderboard.data.plays.map((play, i) => (
                <tr key={`${play.playId}-${i}`} className={`border-t border-(--color-border) ${play.playId === result.playId ? "font-semibold text-(--color-accent)" : ""}`}>
                  <td className="py-1.5 pr-3">{i + 1}</td>
                  <td className="py-1.5 pr-3">{play.playerName ?? "Guest"}</td>
                  <td className="py-1.5 pr-3">{play.score}/{leaderboard.data!.questionCount}</td>
                  <td className="py-1.5">{(play.durationMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the public route in `frontend/src/App.tsx`**

Import:

```tsx
import { PlayQuizPage } from "./pages/PlayQuizPage";
```

Public route, next to `/vote/:code` (line ~53, OUTSIDE the authed wrapper):

```tsx
<Route path="/play/:code" element={<PlayQuizPage />} />
```

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: PASS.

```bash
git add frontend/src/pages/PlayQuizPage.tsx frontend/src/App.tsx
git commit -m "frontend: public quiz play page with challenge loop"
```
---

### Task 9: Pool data verification, docs, full verification sweep

**Files:**
- Modify (data fixes only): `packages/shared/src/quizzes/pool.ts`
- Modify: `README.md`, `backend/README.md`

**Interfaces:** none new — this task verifies and documents.

- [ ] **Step 1: Verify the pool's OpenLibrary cover URLs resolve**

For a sample of at least 10 `QUIZ_POOL` entries (must include any you're least sure of):

```bash
curl -sI -o /dev/null -w "%{http_code} %{url_effective}\n" "https://covers.openlibrary.org/b/isbn/9780141439518-M.jpg"
```

Expected: `200` (OpenLibrary serves a 1px blank image with 200 for unknown ISBNs, so also check `content-length` is larger than ~500 bytes on suspicious ones). For any dead entry, find the right ISBN via OpenLibrary search (`https://openlibrary.org/search?q=<title>`) and fix the ISBN in `pool.ts`. A dead cover is not a build failure — CoverImage's fallback renders — but at most 2 of 30 may ship dead.

- [ ] **Step 2: Update the module lists**

`README.md` line 11 lists the backend's modules — extend the games list to include quizzes. Replace:

```
book-bracket tournaments (arena), and murals
```

with:

```
book-bracket tournaments (arena), cover quizzes (quizzes), and murals
```

`backend/README.md`: add a `modules/quizzes` bullet beside `modules/tierlists`'s, one line: game module storing quiz documents + seeded question sets + locked plays/answers in its own SQLite file, anonymous link challenges via vote codes.

- [ ] **Step 3: Full verification sweep (all workspaces)**

Run, in order:

```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend && npm test --workspace backend
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
npm run typecheck --workspace mobile
```

Expected: all PASS.

- [ ] **Step 4: Manual browser walk (against `npm run dev` backend + frontend)**

1. Dashboard → Games → Quizzes tab → New quiz → pick "Famous books", check ~8 pool books, 5 questions, all four types → Create.
2. Editor shows 8 book rows; publish → challenge link appears; copy it.
3. Open `/play/<code>` in an incognito window (no session): play through — blurred cover, title→cover grid, quote, blurb questions all render; submit with a name.
4. End screen: score correct against your answers; leaderboard shows your row; "Challenge someone" copies the link.
5. Reopen the same link in the same incognito window → "You already played this quiz." state, leaderboard intact.
6. Signed-in owner view: editor shows seeded questions with answers, results table, per-question pick bars; toggle "Close for play" → the play link now shows the closed message.
7. Create a second quiz from "My shelf" with quotes pasted on two books, publish (covers resolve), play it once signed-in, confirm the account-keyed one-play lock (second submit attempt → 409 state).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/quizzes/pool.ts README.md backend/README.md
git commit -m "quizzes: verify pool covers, document the module"
```

---

## Execution notes

- Tasks 1→4 are strictly sequential (each consumes the previous task's exports). Tasks 5→8 depend only on Task 4's routes being done; 6/7/8 each leave the frontend compiling, so they can run in that order in one session.
- The dev workflow (ports, worktrees, `dev:link-deps`) is in `docs/dev-workflow.md` — read it before starting a dev server for Task 9's manual walk.
- Mobile integration is intentionally absent (spec: web only in v1). Community feed events (`quiz_published`) are intentionally absent (spec: deferred to the public-challenges phase).

