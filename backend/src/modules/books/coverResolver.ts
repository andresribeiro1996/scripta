import { isAcceptableCover } from "@scripta/shared";
import { koboCoverUrl } from "./adapters/sources/kobo.js";
import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import { SourceUnavailableError } from "./domain/errors.js";
import type { EncodedCover } from "./domain/images.js";
import { authorMatches, normalizeTitle, titleMatches } from "./domain/normalize.js";
import type { CoverCandidate, CoverSource, TitledCandidate } from "./domain/ports.js";

const CANDIDATES_PER_STEP = 3;

export interface CoverSources {
  isbndb: CoverSource | null;
  apple: CoverSource;
  openlibrary: CoverSource;
}

export type FetchCoverImage = (candidate: CoverCandidate) => Promise<EncodedCover | null>;

export interface FoundCover {
  candidate: CoverCandidate;
  image: EncodedCover;
}

export interface CoverOutcome {
  found: FoundCover | null;
  complete: boolean;
  failures: SourceUnavailableError[];
}

async function attempt<T>(step: () => Promise<T>): Promise<T | SourceUnavailableError> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SourceUnavailableError) return error;
    throw error;
  }
}

export type CoverBook = { isbn: string | null; title: string; author: string; koboImageId?: string | null; isbnOnly?: boolean };

export function coverSteps(book: CoverBook, sources: CoverSources): Array<() => Promise<CoverCandidate[]>> {
  const accept = (candidate: TitledCandidate) => titleMatches(book.title, candidate.title) && authorMatches(book.author, candidate.authors);
  const order = [sources.apple, sources.isbndb, sources.openlibrary].filter((source): source is CoverSource => source !== null);
  const steps: Array<() => Promise<CoverCandidate[]>> = [];
  const koboImageId = book.koboImageId;
  if (koboImageId) steps.push(async () => [{ source: "kobo", url: koboCoverUrl(koboImageId) }]);
  const isbn = book.isbn;
  if (isbn) steps.push(...order.map((source) => () => source.byIsbn(isbn)));
  if (!book.isbnOnly && normalizeTitle(book.title)) steps.push(...order.map((source) => () => source.byTitle(book.title, book.author, accept, isbn)));
  return steps;
}

export function offerable(candidates: CoverCandidate[], rejected: Set<string>): CoverCandidate[] {
  return candidates.filter((candidate) => !rejected.has(candidate.url)).slice(0, CANDIDATES_PER_STEP);
}

export async function findBestCover(
  book: CoverBook,
  rejected: Set<string>,
  sources: CoverSources,
  fetchImage: FetchCoverImage
): Promise<CoverOutcome> {
  let best: FoundCover | null = null;
  let complete = true;
  const failures: SourceUnavailableError[] = [];
  for (const step of coverSteps(book, sources)) {
    const candidates = await attempt(step);
    if (candidates instanceof SourceUnavailableError) {
      complete = false;
      failures.push(candidates);
      continue;
    }
    for (const candidate of offerable(candidates, rejected)) {
      const image = await attempt(() => fetchImage(candidate));
      if (image instanceof SourceUnavailableError) {
        complete = false;
        failures.push(image);
        continue;
      }
      if (!image || !isAcceptableCover(candidate.source, image.width, image.height)) continue;
      if (image.width >= MIN_GOOD_WIDTH) return { found: { candidate, image }, complete: true, failures };
      if (!best || image.width > best.image.width) best = { candidate, image };
    }
  }
  return { found: best, complete, failures };
}
