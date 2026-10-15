import { canonicalIsbn } from "@scripta/shared";
import { SourcePausedError, SourceUnavailableError } from "./domain/errors.js";
import { hasCopyrightSign, retitle, retitleRepairs, textOf, type BookText } from "./domain/lossy.js";
import type { BookCatalog, BooksRepository } from "./domain/ports.js";
import type { LossyBook } from "./domain/types.js";
import type { MojibakeApplied, MojibakePlan } from "./seed/mojibakeRepair.js";

export const RETITLE_BATCH_SIZE = 25;

export interface RetitleJobDeps {
  repo: Pick<BooksRepository, "listRetitleWanted" | "clearRetitleWanted">;
  isbndb: Pick<BookCatalog, "search">;
  write: (plan: Pick<MojibakePlan, "books" | "works">) => MojibakeApplied;
  info: (details: object, message: string) => void;
  warn: (details: object, message: string) => void;
}

function applyRetitle(deps: RetitleJobDeps, book: LossyBook, next: BookText): boolean {
  const repairs = retitleRepairs(book, next, "isbndb");
  return deps.write({ books: [repairs.book], works: repairs.work ? [repairs.work] : [] }).books === 1;
}

export async function retitleWanted(deps: RetitleJobDeps, limit: number, signal?: AbortSignal): Promise<number | null> {
  for (const book of deps.repo.listRetitleWanted(limit)) {
    if (signal?.aborted) return null;
    const isbn = canonicalIsbn(book.isbn ?? "");
    if (isbn && hasCopyrightSign(book)) {
      try {
        const hit = (await deps.isbndb.search({ isbn }))[0]?.result;
        const next = hit ? retitle(book, { titles: [hit.title], authors: hit.authors }) : null;
        if (next && applyRetitle(deps, book, next)) {
          deps.info({ bookId: book.id, from: textOf(book), to: textOf(next) }, "lossy book re-titled");
          if (hasCopyrightSign(next)) deps.info({ bookId: book.id, text: textOf(next) }, "lossy book left");
        } else {
          deps.info({ bookId: book.id, text: textOf(book) }, "lossy book left");
        }
      } catch (error) {
        if (error instanceof SourcePausedError) return error.retryAt;
        if (!(error instanceof SourceUnavailableError)) throw error;
        if (error.status !== undefined && error.status !== 429 && error.status < 500) {
          deps.info({ bookId: book.id, text: textOf(book) }, "lossy book left");
        } else {
          deps.warn({ bookId: book.id, source: error.source, error: error.message }, "lossy title source unavailable");
          continue;
        }
      }
    }
    deps.repo.clearRetitleWanted(book.id);
  }
  return null;
}
