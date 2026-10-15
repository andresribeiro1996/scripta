import { SourceUnavailableError, UnusableAnswerError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";

export class TypesafeBudgetSpentError extends Error {
  constructor(readonly source: string) {
    super(`TypeSafe budget for ${source} is spent`);
    this.name = "TypesafeBudgetSpentError";
  }
}

export type Spend = () => void;

export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export { nextUtcMidnight } from "./adapters/isbndb/isbndbGate.js";

export function dailySpend(repo: Pick<BooksRepository, "spendTypesafe">, source: string, limit: number, now: () => number): Spend {
  return () => {
    if (!repo.spendTypesafe(utcDay(now()), source, limit)) throw new TypesafeBudgetSpentError(source);
  };
}

export type FailureKind = "budget" | "key" | "book" | "outage";

export function failureKind(error: unknown): FailureKind | null {
  if (error instanceof TypesafeBudgetSpentError) return "budget";
  if (error instanceof UnusableAnswerError) return "book";
  if (!(error instanceof SourceUnavailableError)) return null;
  if (error.status === 401) return "key";
  if (error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429) return "book";
  return "outage";
}

export function runBudget(repo: Pick<BooksRepository, "spendTypesafe">, source: string, max: number, now: () => number): { spend: Spend; used: () => number } {
  let used = 0;
  return {
    spend: () => {
      if (used >= max) throw new TypesafeBudgetSpentError(source);
      used += 1;
      repo.spendTypesafe(utcDay(now()), source, Number.MAX_SAFE_INTEGER);
    },
    used: () => used
  };
}
