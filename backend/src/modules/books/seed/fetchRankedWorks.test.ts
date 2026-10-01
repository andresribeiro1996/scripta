import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { collectRanked } from "./fetchRankedWorks.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const work = (key: string, readers: number, isbn: string, language?: string[]) => ({
  key: `/works/${key}`,
  title: key,
  author_name: ["A"],
  readinglog_count: readers,
  editions: { docs: [{ title: key, isbn: [isbn], language }] }
});

function fakeOpenLibrary(byQuery: Record<string, unknown[]>) {
  const queries: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const params = new URL(String(input)).searchParams;
    const q = params.get("q") ?? "";
    queries.push(q);
    const docs = Number(params.get("offset")) === 0 ? (byQuery[q] ?? []) : [];
    return new Response(JSON.stringify({ docs }), { status: 200 });
  }) as typeof fetch;
  return queries;
}

test("asks for each Portugal ISBN prefix and merges the lists by readers", async () => {
  const queries = fakeOpenLibrary({
    "isbn:978972*": [work("OL1W", 50, "9789721111111"), work("OL3W", 10, "9789723333333")],
    "isbn:978989*": [work("OL2W", 30, "9789892222222")]
  });
  const entries = await collectRanked("por", 1, () => {});
  assert.deepEqual([...new Set(queries)], ["isbn:978972*", "isbn:978989*"]);
  assert.deepEqual(entries.map((entry) => entry.isbn), ["9789721111111", "9789892222222", "9789723333333"]);
});

test("keeps a work found under both prefixes once, with the higher readers", async () => {
  fakeOpenLibrary({
    "isbn:978972*": [work("OL1W", 40, "9789722365598")],
    "isbn:978989*": [work("OL1W", 50, "9789898765432")]
  });
  const entries = await collectRanked("por", 1, () => {});
  assert.deepEqual(entries.map((entry) => [entry.workKey, entry.isbn, entry.readers]), [["/works/OL1W", "9789898765432", 50]]);
});

test("on equal readers a work keeps its 978972 edition", async () => {
  fakeOpenLibrary({
    "isbn:978972*": [work("OL1W", 40, "9789722365598")],
    "isbn:978989*": [work("OL1W", 40, "9789898765432")]
  });
  const entries = await collectRanked("por", 1, () => {});
  assert.deepEqual(entries.map((entry) => entry.isbn), ["9789722365598"]);
});

test("keeps the language query for English", async () => {
  const queries = fakeOpenLibrary({ "language:eng": [work("OL4W", 5, "9780306406157", ["eng"])] });
  const entries = await collectRanked("eng", 1, () => {});
  assert.deepEqual([...new Set(queries)], ["language:eng"]);
  assert.equal(entries.length, 1);
});
