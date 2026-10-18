import { SourcePausedError } from "../../domain/errors.js";
import type { BooksRepository } from "../../domain/ports.js";
import { nextUtcMidnight, utcDay, type Spend } from "../../typesafe.js";

export const ISBNDB_DAILY_QUOTA = 5000;
export const ISBNDB_SEARCH_RESERVE = 200;

export function createIsbndbBudget(
  repo: Pick<BooksRepository, "spendTypesafe">,
  limit: number,
  onSpent: (message: string) => void,
  now: () => number = Date.now
): Spend {
  let reportedDay = "";
  return () => {
    const at = now();
    const day = utcDay(at);
    if (!repo.spendTypesafe(day, "isbndb", limit)) {
      const retryAt = nextUtcMidnight(at);
      if (day !== reportedDay) {
        reportedDay = day;
        onSpent(`ISBNdb daily budget of ${limit} non-search calls spent for ${day}, paused until ${new Date(retryAt).toISOString()}`);
      }
      throw new SourcePausedError("isbndb", `daily budget of ${limit} non-search calls reached`, { retryAt });
    }
  };
}
