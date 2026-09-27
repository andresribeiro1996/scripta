import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import { SourceUnavailableError } from "./domain/errors.js";
import { isAcceptableCover, type EncodedCover } from "./domain/images.js";
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
}

async function attempt<T>(step: () => Promise<T>): Promise<T | SourceUnavailableError> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SourceUnavailableError) return error;
    throw error;
  }
}

export async function findBestCover(
  book: { isbn: string | null; title: string; author: string },
  rejected: Set<string>,
  sources: CoverSources,
  fetchImage: FetchCoverImage
): Promise<CoverOutcome> {
  const accept = (candidate: TitledCandidate) => titleMatches(book.title, candidate.title) && authorMatches(book.author, candidate.authors);
  const exactOrder = [sources.isbndb, sources.apple, sources.openlibrary].filter((source): source is CoverSource => source !== null);
  const titleOrder = [sources.apple, sources.isbndb, sources.openlibrary].filter((source): source is CoverSource => source !== null);
  const steps: Array<() => Promise<CoverCandidate[]>> = [];
  const isbn = book.isbn;
  if (isbn) steps.push(...exactOrder.map((source) => () => source.byIsbn(isbn)));
  if (normalizeTitle(book.title)) steps.push(...titleOrder.map((source) => () => source.byTitle(book.title, book.author, accept)));

  let best: FoundCover | null = null;
  let complete = true;
  for (const step of steps) {
    const candidates = await attempt(step);
    if (candidates instanceof SourceUnavailableError) {
      complete = false;
      continue;
    }
    for (const candidate of candidates.filter((c) => !rejected.has(c.url)).slice(0, CANDIDATES_PER_STEP)) {
      const image = await attempt(() => fetchImage(candidate));
      if (image instanceof SourceUnavailableError) {
        complete = false;
        continue;
      }
      if (!image || !isAcceptableCover(candidate.source, image.width, image.height)) continue;
      if (image.width >= MIN_GOOD_WIDTH) return { found: { candidate, image }, complete: true };
      if (!best || image.width > best.image.width) best = { candidate, image };
    }
  }
  return { found: best, complete };
}
