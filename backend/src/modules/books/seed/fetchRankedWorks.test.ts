import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { collectRanked } from "./fetchRankedWorks.js";

const realFetch = globalThis.fetch;
beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

async function settled<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(120_000);
  }
  return promise;
}

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

function scriptedOpenLibrary(respond: (offset: number, attempt: number) => Response) {
  const attempts = new Map<number, number>();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const offset = Number(new URL(String(input)).searchParams.get("offset"));
    const attempt = attempts.get(offset) ?? 0;
    attempts.set(offset, attempt + 1);
    return respond(offset, attempt);
  }) as typeof fetch;
  return attempts;
}

const page = (docs: unknown[], start: number, numFound: number) => new Response(JSON.stringify({ docs, start, numFound }), { status: 200 });
const failure = () => new Response("", { status: 500 });

test("asks for each Portugal ISBN prefix and merges the lists by readers", async () => {
  const queries = fakeOpenLibrary({
    "isbn:978972*": [work("OL1W", 50, "9789721111111"), work("OL3W", 10, "9789723333333")],
    "isbn:978989*": [work("OL2W", 30, "9789892222222")]
  });
  const entries = await settled(collectRanked("por", 1, () => {}));
  assert.deepEqual([...new Set(queries)], ["isbn:978972*", "isbn:978989*"]);
  assert.deepEqual(entries.map((entry) => entry.isbn), ["9789721111111", "9789892222222", "9789723333333"]);
});

test("keeps a work found under both prefixes once, with the higher readers", async () => {
  fakeOpenLibrary({
    "isbn:978972*": [work("OL1W", 40, "9789722365598")],
    "isbn:978989*": [work("OL1W", 50, "9789898765432")]
  });
  const entries = await settled(collectRanked("por", 1, () => {}));
  assert.deepEqual(entries.map((entry) => [entry.workKey, entry.isbn, entry.readers]), [["/works/OL1W", "9789898765432", 50]]);
});

test("on equal readers a work keeps its 978972 edition", async () => {
  fakeOpenLibrary({
    "isbn:978972*": [work("OL1W", 40, "9789722365598")],
    "isbn:978989*": [work("OL1W", 40, "9789898765432")]
  });
  const entries = await settled(collectRanked("por", 1, () => {}));
  assert.deepEqual(entries.map((entry) => entry.isbn), ["9789722365598"]);
});

test("keeps the language query for English", async () => {
  const queries = fakeOpenLibrary({ "language:eng": [work("OL4W", 5, "9780306406157", ["eng"])] });
  const entries = await settled(collectRanked("eng", 1, () => {}));
  assert.deepEqual([...new Set(queries)], ["language:eng"]);
  assert.equal(entries.length, 1);
});

test("retries a page that fails five times and uses the sixth answer", async () => {
  const attempts = scriptedOpenLibrary((offset, attempt) => {
    if (offset > 0) return page([], offset, 1);
    return attempt < 5 ? failure() : page([work("OL1W", 5, "9780306406157", ["eng"])], 0, 1);
  });
  const lines: string[] = [];
  const entries = await settled(collectRanked("eng", 1, (line) => lines.push(line)));
  assert.equal(attempts.get(0), 6);
  assert.deepEqual(entries.map((entry) => entry.isbn), ["9780306406157"]);
  assert.equal(lines.filter((line) => line.startsWith("retry ")).length, 5);
});

test("gives up after six failed tries", async () => {
  const attempts = scriptedOpenLibrary(() => failure());
  await assert.rejects(settled(collectRanked("eng", 1, () => {})), /HTTP 500/);
  assert.equal(attempts.get(0), 6);
});

test("does not retry a client error", async () => {
  const attempts = scriptedOpenLibrary(() => new Response("", { status: 404 }));
  await assert.rejects(settled(collectRanked("eng", 1, () => {})), /HTTP 404/);
  assert.equal(attempts.get(0), 1);
});

test("retries an empty page while the response says more results exist", async () => {
  const attempts = scriptedOpenLibrary((offset, attempt) => {
    if (offset > 0) return page([], offset, 1);
    return attempt < 2 ? page([], 0, 5000) : page([work("OL1W", 5, "9780306406157", ["eng"])], 0, 1);
  });
  const lines: string[] = [];
  const entries = await settled(collectRanked("eng", 1, (line) => lines.push(line)));
  assert.equal(attempts.get(0), 3);
  assert.equal(entries.length, 1);
  assert.equal(lines.filter((line) => line.includes("after empty page")).length, 2);
});

test("throws when an empty page never fills", async () => {
  const attempts = scriptedOpenLibrary(() => page([], 0, 5000));
  await assert.rejects(settled(collectRanked("eng", 1, () => {})), /no results/);
  assert.equal(attempts.get(0), 6);
});

test("an empty page at the end of the results ends the list", async () => {
  const attempts = scriptedOpenLibrary((offset) => (offset === 0 ? page([work("OL1W", 5, "9780306406157", ["eng"])], 0, 1) : page([], offset, 1)));
  const entries = await settled(collectRanked("eng", 100, () => {}));
  assert.equal(entries.length, 1);
  assert.equal(attempts.get(1000), 1);
  assert.equal(attempts.size, 2);
});

test("a page whose works are all filtered out does not end the list", async () => {
  const attempts = scriptedOpenLibrary((offset) => {
    if (offset === 0) return page([work("OL1W", 5, "9780306406157", ["fre"])], 0, 2000);
    if (offset === 1000) return page([work("OL2W", 4, "9780306406164", ["eng"])], 1000, 2000);
    return page([], offset, 2000);
  });
  const entries = await settled(collectRanked("eng", 1, () => {}));
  assert.deepEqual(entries.map((entry) => entry.isbn), ["9780306406164"]);
  assert.equal(attempts.get(1000), 1);
});
