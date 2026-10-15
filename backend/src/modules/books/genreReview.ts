import type { GenreReview, GenreReviewAction, GenreReviewEvidence } from "@scripta/shared";
import { BookNotFoundError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { GENRE_REJECTION_LIMIT, GENRE_SAVE_LINE } from "./genreJudgments.js";
import { genrePassWorksWith, labelWork, type GenrePassWork, type HeldWork } from "./genrePass.js";

export const GENRE_REVIEW_LIMIT = 200;
const EXCERPT_LIMIT = 300;

type Rejection = { status: number | null; reason: string; attempts: number; lastAt: string };

function evidenceOf(rejection: Rejection | undefined, jev: GenrePassWork["jev"]): GenreReviewEvidence | null {
  if (rejection && rejection.attempts >= GENRE_REJECTION_LIMIT) return { group: "rejected", ...rejection };
  if (!jev) return null;
  if (jev.genre === null) return { group: "none", confidence: jev.confidence };
  return { group: jev.confidence < GENRE_SAVE_LINE ? "unsure" : "possible", genre: jev.genre, confidence: jev.confidence };
}

export function genreReviewWith(books: BooksRepository, held: HeldWork[], coverUrl: (imageId: string) => string): GenreReview {
  const works = genrePassWorksWith(books, held);
  const ids = works.map((work) => work.workId);
  const rejections = books.genreRejections(ids);
  const covers = books.workCoverImageIds(ids);
  const listed = works.flatMap((work) => {
    const evidence = evidenceOf(rejections.get(work.workId), work.jev);
    if (!evidence) return [];
    const cover = covers.get(work.workId);
    return [{ workId: work.workId, title: work.title, author: work.author, coverUrl: cover ? coverUrl(cover) : null, synopsis: work.synopsis?.slice(0, EXCERPT_LIMIT) ?? null, holders: work.holders, finished: work.finished, evidence }];
  });
  return { items: listed.slice(0, GENRE_REVIEW_LIMIT), total: listed.length };
}

export function reviewGenreWith(books: BooksRepository, workId: string, action: GenreReviewAction, now: () => number, requeue: (workId: string) => void): { workId: string; editions: number } {
  const canonical = books.canonicalWorkIds([workId]).get(workId);
  if (!canonical) throw new BookNotFoundError();
  if ("retry" in action) {
    books.transaction(() => {
      books.clearGenreRejection(canonical);
      books.deleteGenreJudgment(canonical);
    });
    requeue(canonical);
    return { workId: canonical, editions: 0 };
  }
  const editions = books.transaction(() => labelWork(books, canonical, action.genres, new Date(now()).toISOString()));
  return { workId: canonical, editions };
}
