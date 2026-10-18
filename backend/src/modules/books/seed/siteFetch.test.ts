import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { USER_AGENT } from "../adapters/http/http.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { fetchBytes, fetchText } from "./siteFetch.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const answer = (status: number, body = "body") => {
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
};
const fail = (error: Error) => {
  globalThis.fetch = (async () => {
    throw error;
  }) as typeof fetch;
};

test("fetchText returns the status and text of an ordinary answer, a 404 included", async () => {
  answer(200);
  assert.deepEqual(await fetchText("https://shop.test/a"), { status: 200, text: "body" });
  answer(404);
  assert.deepEqual(await fetchText("https://shop.test/a"), { status: 404, text: "body" });
});

test("a 429, a 5xx, a network error and a timeout become SourceUnavailableError", async () => {
  answer(429);
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
  answer(503);
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
  fail(new TypeError("fetch failed"));
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
  fail(new DOMException("timed out", "TimeoutError"));
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
});

test("any other error propagates", async () => {
  fail(new RangeError("boom"));
  await assert.rejects(fetchText("https://shop.test/a"), RangeError);
});

test("fetchBytes returns the body of a 2xx and null otherwise", async () => {
  answer(200, "bytes");
  assert.deepEqual(await fetchBytes("https://shop.test/a.jpg"), Buffer.from("bytes"));
  answer(404);
  assert.equal(await fetchBytes("https://shop.test/a.jpg"), null);
});

test("requests carry the importer's user agent", async () => {
  const agents: Array<string | null> = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    agents.push(new Headers(init?.headers).get("User-Agent"));
    return new Response("", { status: 200 });
  }) as typeof fetch;
  await fetchText("https://shop.test/a");
  assert.deepEqual(agents, [USER_AGENT]);
});

test("a request that outlasts the given timeout becomes SourceUnavailableError", { timeout: 2000 }, async () => {
  globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    })) as typeof fetch;

  await assert.rejects(fetchText("https://shop.test/a", 5), (error) => error instanceof SourceUnavailableError && error.source === "shop.test");
  await assert.rejects(fetchBytes("https://shop.test/a.jpg", 5), SourceUnavailableError);
});
