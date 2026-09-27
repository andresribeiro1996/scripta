import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVER_CACHE_TTL_MS,
  COVER_POLL_MAX_ATTEMPTS,
  coverPollDelayMs,
  coverQueryKey,
  createCoverResolver,
  type CoverCacheEntry,
  type ResolvedCoverResponse
} from "./coverResolver.js";

const found: ResolvedCoverResponse = { url: "https://api.test/covers/cached/a/thumb", fullUrl: "https://api.test/covers/cached/a/file", pending: false };
const pending: ResolvedCoverResponse = { url: null, fullUrl: null, pending: true };
const params = { isbn: "9780141184272", title: "Orlando", author: "Virginia Woolf" };

function setup(answers: ResolvedCoverResponse[]) {
  let clock = 1_000_000;
  const queries: string[] = [];
  const sleeps: number[] = [];
  const persisted: Array<Record<string, CoverCacheEntry>> = [];
  const resolver = createCoverResolver({
    fetchResolve: async (query) => {
      queries.push(query);
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return next;
    },
    persist: (entries) => persisted.push(entries),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    }
  });
  return { resolver, queries, sleeps, persisted, advance: (ms: number) => { clock += ms; } };
}

test("the query key drops imageId", () => {
  assert.equal(coverQueryKey({ ...params, imageId: "file____mnt_onboard_x" }), "isbn=9780141184272&title=Orlando&author=Virginia+Woolf");
});

test("poll delays double from 5s and cap at 5 minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(coverPollDelayMs), [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);
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

test("a pending answer is polled with growing delays until it settles", async () => {
  const { resolver, queries, sleeps } = setup([pending, pending, found]);
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(queries.length, 3);
  assert.deepEqual(sleeps, [5000, 10000]);
});

test("poll: false returns null on a pending answer and caches nothing", async () => {
  const { resolver, sleeps } = setup([pending, found]);
  assert.equal(await resolver.resolve(params, { poll: false }), null);
  assert.deepEqual(sleeps, []);
  assert.equal(resolver.peek(params), undefined);
  assert.equal(await resolver.resolve(params), found.url);
});

test("polling gives up after the maximum number of attempts", async () => {
  const { resolver, queries } = setup(Array.from({ length: COVER_POLL_MAX_ATTEMPTS }, () => pending));
  assert.equal(await resolver.resolve(params), null);
  assert.equal(queries.length, COVER_POLL_MAX_ATTEMPTS);
  assert.equal(resolver.peek(params), undefined);
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
