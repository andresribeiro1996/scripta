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

export function nextUtcMidnight(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function dailySpend(repo: Pick<BooksRepository, "spendTypesafe">, source: string, limit: number, now: () => number): Spend {
  return () => {
    if (!repo.spendTypesafe(utcDay(now()), source, limit)) throw new TypesafeBudgetSpentError(source);
  };
}
