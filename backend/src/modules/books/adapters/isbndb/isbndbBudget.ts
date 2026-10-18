import { SourcePausedError } from "../../domain/errors.js";
import type { BooksRepository } from "../../domain/ports.js";
import { nextUtcMidnight, utcDay, type Spend } from "../../typesafe.js";

export const ISBNDB_DAILY_QUOTA = 5000;
export const ISBNDB_SEARCH_RESERVE = 200;

export function createIsbndbBudget(repo: Pick<BooksRepository, "spendTypesafe">, limit: number, now: () => number = Date.now): Spend {
  return () => {
    const at = now();
    if (!repo.spendTypesafe(utcDay(at), "isbndb", limit)) {
      throw new SourcePausedError("isbndb", `daily budget of ${limit} non-search calls reached`, { retryAt: nextUtcMidnight(at) });
    }
  };
}
