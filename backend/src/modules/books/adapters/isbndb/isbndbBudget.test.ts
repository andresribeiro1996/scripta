import assert from "node:assert/strict";
import { test } from "node:test";
import { SourcePausedError } from "../../domain/errors.js";
import { utcDay } from "../../typesafe.js";
import { createIsbndbBudget } from "./isbndbBudget.js";

function fakeRepo() {
  const calls: Array<[string, string, number]> = [];
  const counts = new Map<string, number>();
  return {
    calls,
    spendTypesafe(day: string, source: string, limit: number) {
      calls.push([day, source, limit]);
      const key = `${day}|${source}`;
      const count = counts.get(key);
      if (count === undefined) {
        counts.set(key, 1);
        return true;
      }
      if (count >= limit) return false;
      counts.set(key, count + 1);
      return true;
    }
  };
}

test("the budget lets the limit through, then pauses until the next UTC midnight", () => {
  const now = Date.parse("2026-10-18T23:00:00.000Z");
  const spend = createIsbndbBudget(fakeRepo(), 2, () => {}, () => now);
  spend();
  spend();
  assert.throws(spend, (error: unknown) => error instanceof SourcePausedError && error.source === "isbndb" && error.retryAt === Date.parse("2026-10-19T00:00:00.000Z"));
});

test("every call spends the UTC day, the isbndb source and the limit", () => {
  const now = Date.parse("2026-10-18T12:00:00.000Z");
  const repo = fakeRepo();
  const spend = createIsbndbBudget(repo, 2, () => {}, () => now);
  spend();
  spend();
  assert.throws(spend, SourcePausedError);
  assert.deepEqual(repo.calls, Array(3).fill([utcDay(now), "isbndb", 2]));
});

test("calls pass again once the UTC day changes", () => {
  let now = Date.parse("2026-10-18T23:59:59.000Z");
  const spend = createIsbndbBudget(fakeRepo(), 1, () => {}, () => now);
  spend();
  assert.throws(spend, SourcePausedError);
  now = Date.parse("2026-10-19T00:00:00.000Z");
  spend();
  assert.throws(spend, (error: unknown) => error instanceof SourcePausedError && error.retryAt === Date.parse("2026-10-20T00:00:00.000Z"));
});

test("the first refused call each UTC day reports once, and spending never does", () => {
  let now = Date.parse("2026-10-18T10:00:00.000Z");
  const messages: string[] = [];
  const spend = createIsbndbBudget(fakeRepo(), 1, (message) => messages.push(message), () => now);
  spend();
  assert.deepEqual(messages, []);
  assert.throws(spend, SourcePausedError);
  assert.throws(spend, SourcePausedError);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /ISBNdb/);
  assert.match(messages[0]!, /2026-10-18/);
  assert.match(messages[0]!, /budget of 1 non-search/);
  now = Date.parse("2026-10-19T10:00:00.000Z");
  spend();
  assert.equal(messages.length, 1);
  assert.throws(spend, SourcePausedError);
  assert.throws(spend, SourcePausedError);
  assert.equal(messages.length, 2);
  assert.match(messages[1]!, /2026-10-19/);
});
