import type { SynopsisDecision, SynopsisReview, SynopsisReviewItem } from "@scripta/shared";
import { BookNotFoundError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { isHiddenSynopsis, SYNOPSIS_REVIEW_BELOW } from "./domain/synopsis.js";
import type { HeldWork } from "./genrePass.js";

export const SYNOPSIS_REVIEW_LIMIT = 200;
const TEXT_LIMIT = 600;

type Carrier = ReturnType<BooksRepository["synopsisCarriers"]>[number];

export function synopsisReviewWith(books: BooksRepository, held: HeldWork[], coverUrl: (imageId: string) => string): SynopsisReview {
  const flagged = books.flaggedSynopses(SYNOPSIS_REVIEW_BELOW);
  const carriers = new Map<string, Carrier[]>();
  for (const carrier of books.synopsisCarriers(flagged.map((judgment) => judgment.hash))) carriers.set(carrier.hash, [...(carriers.get(carrier.hash) ?? []), carrier]);
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const holding = new Map<string, { holders: number; finished: boolean }>();
  for (const work of held) {
    const id = canonical.get(work.workId) ?? work.workId;
    const seen = holding.get(id);
    holding.set(id, { holders: (seen?.holders ?? 0) + work.holders, finished: (seen?.finished ?? false) || work.finished });
  }
  const listed = flagged.flatMap((judgment): SynopsisReviewItem[] => {
    const own = carriers.get(judgment.hash) ?? [];
    const first = own[0];
    if (!first) return [];
    const works = [...new Set(own.flatMap((carrier) => (carrier.workId ? [carrier.workId] : [])))];
    const cover = own.find((carrier) => carrier.coverImageId)?.coverImageId ?? null;
    return [{
      hash: judgment.hash,
      title: first.title,
      author: first.author,
      coverUrl: cover ? coverUrl(cover) : null,
      editions: own.filter((carrier) => carrier.isEdition).length,
      works: works.length,
      source: first.source,
      text: first.text.slice(0, TEXT_LIMIT),
      holders: works.reduce((sum, id) => sum + (holding.get(id)?.holders ?? 0), 0),
      finished: works.some((id) => holding.get(id)?.finished ?? false),
      group: isHiddenSynopsis(judgment) ? "hidden" : "doubtful",
      model: judgment.model,
      kind: judgment.kind,
      usable: judgment.usable
    }];
  });
  listed.sort((a, b) => Number(b.finished) - Number(a.finished) || b.holders - a.holders || a.title.localeCompare(b.title));
  return { items: listed.slice(0, SYNOPSIS_REVIEW_LIMIT), total: listed.length };
}

export function reviewSynopsisWith(books: BooksRepository, hash: string, decision: SynopsisDecision, now: () => number): { hash: string } {
  if (!books.synopsisText(hash)) throw new BookNotFoundError();
  const previous = books.synopsisJudgments([hash]).get(hash);
  books.saveSynopsisJudgment(hash, { model: "manual", usable: decision === "keep" ? 1 : 0, kind: previous?.kind ?? (decision === "keep" ? "synopsis" : "fragment"), askedAt: new Date(now()).toISOString() });
  return { hash };
}
