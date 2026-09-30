import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVER_CACHE_TTL_MS,
  COVER_BATCH_SIZE,
  COVER_POLL_GIVE_UP_MS,
  COVER_POLL_MAX_FAILED_TICKS,
  COVER_POLL_INTERVAL_MS,
  coverQueryKey,
  createCoverResolver,
  type CoverCacheEntry,
  type CoverLookupParams,
  type ResolvedCoverResponse
} from "./coverResolver.js";

const found: ResolvedCoverResponse = { url: "https://api.test/covers/cached/a/thumb", fullUrl: "https://api.test/covers/cached/a/file", pending: false };
const pending: ResolvedCoverResponse = { url: null, fullUrl: null, pending: true };
const params = { isbn: "9780141184272", title: "Orlando", author: "Virginia Woolf" };

type BatchAnswer = (lookups: CoverLookupParams[]) => ResolvedCoverResponse[];

function setup(answers: ResolvedCoverResponse[], batchAnswer: BatchAnswer = (lookups) => lookups.map(() => pending)) {
  let clock = 1_000_000;
  const queries: string[] = [];
  const batches: CoverLookupParams[][] = [];
  const sleeps: number[] = [];
  const persisted: Array<Record<string, CoverCacheEntry>> = [];
  const resolver = createCoverResolver({
    fetchResolve: async (query) => {
      queries.push(query);
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return next;
    },
    fetchResolveBatch: async (lookups) => {
      batches.push(lookups);
      return batchAnswer(lookups);
    },
    persist: (entries) => persisted.push(entries),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    }
  });
  return { resolver, queries, batches, sleeps, persisted, advance: (ms: number) => { clock += ms; } };
}

test("the query key drops imageId", () => {
  assert.equal(coverQueryKey({ ...params, imageId: "file____mnt_onboard_x" }), "isbn=9780141184272&title=Orlando&author=Virginia+Woolf");
});

test("a found cover is cached and served as thumb or full without refetching", async () => {
  const { resolver, queries } = setup([found]);
  assert.equal(resolver.peek(params), undefined);
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(await resolver.resolve(params, { size: "full" }), found.fullUrl);
  assert.equal(resolver.peek(params), found.url);
  assert.equal(resolver.peek(params, "full"), found.fullUrl);
  assert.equal(queries.length, 1);
});

test("a pending answer resolves within one tick of becoming ready", async () => {
  const { resolver, queries, batches, sleeps, persisted } = setup([pending], () => [found]);
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(queries.length, 1);
  assert.deepEqual(sleeps, [COVER_POLL_INTERVAL_MS]);
  assert.deepEqual(batches, [[{ isbn: params.isbn, title: params.title, author: params.author }]]);
  assert.equal(resolver.peek(params), found.url);
  assert.deepEqual(Object.keys(persisted.at(-1)!), [coverQueryKey(params)]);
});

test("poll: false returns null on a pending answer and caches nothing", async () => {
  const { resolver, sleeps } = setup([pending, found]);
  assert.equal(await resolver.resolve(params, { poll: false }), null);
  assert.deepEqual(sleeps, []);
  assert.equal(resolver.peek(params), undefined);
  assert.equal(await resolver.resolve(params), found.url);
});

test("every pending key goes out in one batch per tick and only unsettled keys stay", async () => {
  const titles = ["A", "B", "C"];
  let tick = 0;
  const { resolver, queries, batches, sleeps } = setup(titles.map(() => pending), (lookups) => {
    tick++;
    return lookups.map((lookup) => (lookup.title === "B" || tick > 1 ? found : pending));
  });
  const urls = await Promise.all(titles.map((title) => resolver.resolve({ title })));
  assert.deepEqual(urls, [found.url, found.url, found.url]);
  assert.equal(queries.length, 3);
  assert.deepEqual(batches.map((batch) => batch.map((lookup) => lookup.title)), [["A", "B", "C"], ["A", "C"]]);
  assert.deepEqual(sleeps, [COVER_POLL_INTERVAL_MS, COVER_POLL_INTERVAL_MS]);
});

test("a batch is chunked at the batch size", async () => {
  const total = COVER_BATCH_SIZE + 1;
  const { resolver, batches } = setup(Array.from({ length: total }, () => pending), (lookups) => lookups.map(() => found));
  await Promise.all(Array.from({ length: total }, (_, index) => resolver.resolve({ title: `Book ${index}` })));
  assert.deepEqual(batches.map((batch) => batch.length), [COVER_BATCH_SIZE, 1]);
});

test("a book that stays pending keeps being polled until it is ready", async () => {
  let calls = 0;
  const { resolver, sleeps } = setup([pending], (lookups) => lookups.map(() => (++calls < 200 ? pending : found)));
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(sleeps.length, 200);
});

test("polling gives up after the limit without caching, and a later resolve tries again", async () => {
  const { resolver, sleeps, batches } = setup([pending, found]);
  assert.equal(await resolver.resolve(params), null);
  assert.equal(sleeps.length, COVER_POLL_GIVE_UP_MS / COVER_POLL_INTERVAL_MS);
  assert.equal(batches.length, sleeps.length);
  assert.equal(resolver.peek(params), undefined);
  assert.equal(await resolver.resolve(params), found.url);
});

test("the poll loop stops when nothing is pending and restarts for the next book", async () => {
  const { resolver, sleeps } = setup([pending, pending], (lookups) => lookups.map(() => found));
  await resolver.resolve({ title: "A" });
  await resolver.resolve({ title: "B" });
  assert.deepEqual(sleeps, [COVER_POLL_INTERVAL_MS, COVER_POLL_INTERVAL_MS]);
});

test("a failed tick leaves the key pending and the next success resolves it", async () => {
  let calls = 0;
  const { resolver, batches } = setup([pending], (lookups) => {
    if (++calls === 1) throw new Error("offline");
    return lookups.map(() => found);
  });
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(batches.length, 2);
  assert.equal(resolver.peek(params), found.url);
});

test("consecutive failed ticks reject every waiter with the last error and cache nothing", async () => {
  let calls = 0;
  const { resolver, batches } = setup([pending, pending, pending, found], (lookups) => {
    if (calls >= COVER_POLL_MAX_FAILED_TICKS) return lookups.map(() => found);
    throw new Error(`offline ${++calls}`);
  });
  const results = await Promise.allSettled([resolver.resolve({ title: "A" }), resolver.resolve({ title: "B" })]);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.match(String((result as PromiseRejectedResult).reason), /offline 3/);
  }
  assert.equal(batches.length, COVER_POLL_MAX_FAILED_TICKS);
  assert.equal(resolver.peek({ title: "A" }), undefined);
  assert.equal(await resolver.resolve({ title: "C" }), found.url);
});

test("a successful tick resets the failure count", async () => {
  const script = ["fail", "fail", "pending", "fail", "fail", "ready"];
  const { resolver, batches } = setup([pending], (lookups) => {
    const step = script.shift();
    if (step === "fail") throw new Error("offline");
    return lookups.map(() => (step === "ready" ? found : pending));
  });
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(batches.length, 6);
});

test("concurrent resolves for the same book share one request", async () => {
  const { resolver, queries } = setup([found]);
  const [a, b] = await Promise.all([resolver.resolve(params), resolver.resolve(params)]);
  assert.equal(a, found.url);
  assert.equal(b, found.url);
  assert.equal(queries.length, 1);
});

test("entries expire after the TTL", async () => {
  const { resolver, queries, advance } = setup([found, found]);
  await resolver.resolve(params);
  advance(COVER_CACHE_TTL_MS);
  assert.equal(resolver.peek(params), undefined);
  await resolver.resolve(params);
  assert.equal(queries.length, 2);
});

test("misses stay in memory; only found covers are persisted", async () => {
  const miss: ResolvedCoverResponse = { url: null, fullUrl: null, pending: false };
  const { resolver, persisted } = setup([miss, found]);
  assert.equal(await resolver.resolve({ title: "Unknown" }), null);
  assert.equal(resolver.peek({ title: "Unknown" }), null);
  await resolver.resolve(params);
  const last = persisted.at(-1)!;
  assert.deepEqual(Object.keys(last), [coverQueryKey(params)]);
});

test("hydrate keeps fresh found entries and ignores stale or empty ones", () => {
  const { resolver } = setup([]);
  resolver.hydrate({
    [coverQueryKey(params)]: { url: found.url, fullUrl: found.fullUrl, at: 1_000_000 },
    [coverQueryKey({ title: "Old" })]: { url: "https://x/old", fullUrl: null, at: 1_000_000 - COVER_CACHE_TTL_MS },
    [coverQueryKey({ title: "Empty" })]: { url: null, fullUrl: null, at: 1_000_000 }
  });
  assert.equal(resolver.peek(params), found.url);
  assert.equal(resolver.peek({ title: "Old" }), undefined);
  assert.equal(resolver.peek({ title: "Empty" }), undefined);
});

test("full falls back to the thumbnail when no full URL exists", () => {
  const { resolver } = setup([]);
  resolver.remember(params, { url: "https://x/thumb", fullUrl: null });
  assert.equal(resolver.peek(params, "full"), "https://x/thumb");
});

test("forget drops the entry", async () => {
  const { resolver } = setup([found]);
  await resolver.resolve(params);
  resolver.forget(params);
  assert.equal(resolver.peek(params), undefined);
});
