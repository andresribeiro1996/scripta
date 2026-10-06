import type { QuizBookContent, QuizConfig, QuizQuestionType } from "./types.js";

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
export function eligibleTypes(book: QuizBookContent): QuizQuestionType[] {
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
export function generateQuizQuestions<B extends QuizBookContent>(
  books: B[],
  config: QuizConfig,
  seed: string
): Array<{ id: string; type: QuizQuestionType; book: B; options: string[]; answerIndex: number }> {
  const rand = mulberry32(hashSeed(seed));
  const withCover = books.filter((b) => b.coverUrl);
  const questions: Array<{ id: string; type: QuizQuestionType; book: B; options: string[]; answerIndex: number }> = [];
  for (const book of shuffle(books, rand)) {
    if (questions.length >= config.questionCount) break;
    const available = eligibleTypes(book).filter((t) => config.allowedTypes.includes(t));
    if (available.length === 0) continue;
    const type = available[Math.floor(rand() * available.length)]!;
    const coverOptions = type === "title_cover";
    const valueOf = (b: B): string => (coverOptions ? b.coverUrl ?? "" : b.title);
    const distractorPool = coverOptions ? withCover : books;
    const answerValue = valueOf(book);
    // Dedupe by displayed value, not just by book: two books may share a
    // title or cover URL, and options A,B,B,B make the answer index pick
    // an arbitrary one of the duplicates.
    const seenValues = new Set<string>([answerValue]);
    const distractors: B[] = [];
    for (const candidate of shuffle(distractorPool.filter((b) => b !== book), rand)) {
      if (distractors.length === 3) break;
      const value = valueOf(candidate);
      if (seenValues.has(value)) continue;
      seenValues.add(value);
      distractors.push(candidate);
    }
    if (distractors.length < 3) continue;
    const ordered = shuffle([...distractors.map(valueOf), answerValue], rand);
    questions.push({ id: `q${questions.length}`, type, book, options: ordered, answerIndex: ordered.indexOf(answerValue) });
  }
  return questions;
}
