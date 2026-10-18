import { SourcePausedError } from "../../domain/errors.js";
import type { BooksRepository } from "../../domain/ports.js";
import { nextUtcMidnight, utcDay, type Spend } from "../../typesafe.js";

export function createIsbndbBudget(repo: Pick<BooksRepository, "spendTypesafe">, limit: number, now: () => number = Date.now): Spend {
  return () => {
    const at = now();
    if (!repo.spendTypesafe(utcDay(at), "isbndb", limit)) {
      throw new SourcePausedError("isbndb", `daily budget of ${limit} non-search calls reached`, { retryAt: nextUtcMidnight(at) });
    }
  };
}
