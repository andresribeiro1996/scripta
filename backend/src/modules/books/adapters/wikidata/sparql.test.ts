import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { USER_AGENT } from "../http/http.js";
import { listOf, queryAllPages, queryWikidata, WIKIDATA_PAGE_ROWS, type Binding } from "./sparql.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  }) as typeof fetch;
  return calls;
}

function recorder() {
  const sleeps: number[] = [];
  const lines: string[] = [];
  return { sleeps, lines, sleep: async (ms: number) => void sleeps.push(ms), log: (line: string) => void lines.push(line) };
}

const answer = (bindings: Binding[]) => Response.json({ results: { bindings } });

test("queryWikidata posts the query with the shared User-Agent and returns the bindings", async () => {
  const { sleeps, lines, sleep, log } = recorder();
  const calls = stub(() => answer([{ id: { value: "OL1W" } }]));
  assert.deepEqual(await queryWikidata("SELECT 1", { log, sleep }), [{ id: { value: "OL1W" } }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://query.wikidata.org/sparql");
  assert.equal(calls[0]!.init.method, "POST");
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get("User-Agent"), USER_AGENT);
  assert.equal(headers.get("Accept"), "application/sparql-results+json");
  assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
  assert.equal(new URLSearchParams(String(calls[0]!.init.body)).get("query"), "SELECT 1");
  assert.deepEqual([sleeps, lines], [[], []]);
});

test("queryWikidata retries a 429, a 5xx, a timeout and invalid JSON up to three attempts, then throws naming the last cause", async () => {
  const failures: Array<[string, () => Response | Promise<Response>, RegExp]> = [
    ["a 429", () => new Response("", { status: 429 }), /after 3 attempts: HTTP 429$/],
    ["a 5xx", () => new Response("", { status: 503 }), /after 3 attempts: HTTP 503$/],
    ["a timeout", () => Promise.reject(new DOMException("The operation timed out", "TimeoutError")), /after 3 attempts: The operation timed out$/],
    ["invalid JSON", () => new Response("<html>", { status: 200 }), /after 3 attempts: Unexpected token/]
  ];
  for (const [label, respond, message] of failures) {
    const { sleeps, lines, sleep, log } = recorder();
    const calls = stub(respond);
    await assert.rejects(queryWikidata("q", { log, sleep }), (error: Error) => message.test(error.message) && error.cause instanceof Error, label);
    assert.equal(calls.length, 3, label);
    assert.deepEqual(sleeps, [60_000, 60_000], label);
    assert.deepEqual(lines.map((line) => line.replace(/\(.*\)/, "(…)")), ["wikidata attempt 1 failed (…), retrying", "wikidata attempt 2 failed (…), retrying"], label);
  }
  const { sleeps, sleep, log } = recorder();
  const replies = [new Response("", { status: 429 }), answer([{ id: { value: "x" } }])];
  stub(() => replies.shift()!);
  assert.deepEqual(await queryWikidata("q", { log, sleep }), [{ id: { value: "x" } }]);
  assert.deepEqual(sleeps, [60_000]);
});

test("queryWikidata throws at once on a 4xx other than 429", async () => {
  const { sleeps, lines, sleep, log } = recorder();
  const calls = stub(() => new Response("", { status: 400 }));
  await assert.rejects(queryWikidata("q", { log, sleep }), /^Error: Wikidata query failed: HTTP 400$/);
  assert.equal(calls.length, 1);
  assert.deepEqual([sleeps, lines], [[], []]);
});

test("queryAllPages stops on a short page and waits between pages", async () => {
  const { sleeps, sleep, log } = recorder();
  const full = (): Binding[] => Array.from({ length: WIKIDATA_PAGE_ROWS }, () => ({}));
  const sizes = [full(), full(), [{}, {}, {}]];
  const asked: string[] = [];
  const seen: Array<[number, number]> = [];
  const all = await queryAllPages((offset) => `page ${offset}`, {
    log,
    sleep,
    query: async (text) => {
      asked.push(text);
      return sizes.shift()!;
    },
    onPage: (offset, bindings) => void seen.push([offset, bindings.length])
  });
  assert.deepEqual(asked, ["page 0", "page 3000", "page 6000"]);
  assert.deepEqual(seen, [[0, 3000], [3000, 3000], [6000, 3]]);
  assert.deepEqual(sleeps, [5000, 5000, 5000]);
  assert.equal(all.length, 6003);

  const fetched = stub(() => answer([{}]));
  assert.equal((await queryAllPages((offset) => `q${offset}`, { log, sleep })).length, 1);
  assert.equal(fetched.length, 1);
  assert.equal(new URLSearchParams(String(fetched[0]!.init.body)).get("query"), "q0");
  assert.deepEqual(sleeps.slice(3), [5000]);
});

test("queryWikidata stops when the signal aborts", async () => {
  const { sleeps, sleep, log } = recorder();
  const idle = new AbortController();
  const calls = stub(() => answer([]));
  assert.deepEqual(await queryWikidata("q", { log, sleep, signal: idle.signal }), []);
  assert.equal(calls.length, 1);

  const midRequest = new AbortController();
  let inFlight = 0;
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      inFlight++;
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
  const pending = queryWikidata("q", { log, sleep, signal: midRequest.signal });
  midRequest.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(inFlight, 1);

  const duringWait = new AbortController();
  const failing = stub(() => new Response("", { status: 500 }));
  await assert.rejects(queryWikidata("q", { log, sleep: async (ms) => { sleeps.push(ms); duringWait.abort(); }, signal: duringWait.signal }), { name: "AbortError" });
  assert.equal(failing.length, 1);

  const before = new AbortController();
  before.abort();
  const untouched = stub(() => answer([]));
  await assert.rejects(queryWikidata("q", { log, sleep, signal: before.signal }), { name: "AbortError" });
  assert.equal(untouched.length, 0);
});

test("listOf splits on | and drops blanks", () => {
  const binding: Binding = { ids: { value: " OL1W | |OL2W||978-0-575-08140-6 " }, none: { value: "" } };
  assert.deepEqual(listOf(binding, "ids"), ["OL1W", "OL2W", "978-0-575-08140-6"]);
  assert.deepEqual(listOf(binding, "none"), []);
  assert.deepEqual(listOf(binding, "missing"), []);
});
