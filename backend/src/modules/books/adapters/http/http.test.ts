import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import { createThrottle, fetchBytes, fetchJson } from "./http.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

test("fetchJson parses a body, maps 404 to null and sends headers", async () => {
  let seen: Headers | undefined;
  stub((_url, init) => {
    seen = new Headers(init?.headers);
    return Response.json({ ok: true });
  });
  assert.deepEqual(await fetchJson("isbndb", "https://api.test/a", { Authorization: "k" }), { ok: true });
  assert.equal(seen?.get("Authorization"), "k");
  stub(() => new Response("", { status: 404 }));
  assert.equal(await fetchJson("isbndb", "https://api.test/a"), null);
});

test("fetchJson reports rate limits, server errors, auth errors and network failures as unavailable", async () => {
  for (const status of [429, 500, 403]) {
    stub(() => new Response("", { status }));
    await assert.rejects(fetchJson("apple", "https://api.test/a"), SourceUnavailableError);
  }
  stub(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchJson("apple", "https://api.test/a"), SourceUnavailableError);
});

test("fetchBytes skips a missing or forbidden image but reports a server error", async () => {
  stub(() => new Response(new Uint8Array([1, 2, 3])));
  assert.deepEqual([...(await fetchBytes("apple", "https://img.test/a"))!], [1, 2, 3]);
  for (const status of [404, 403]) {
    stub(() => new Response("", { status }));
    assert.equal(await fetchBytes("apple", "https://img.test/a"), null);
  }
  stub(() => new Response("", { status: 503 }));
  await assert.rejects(fetchBytes("apple", "https://img.test/a"), SourceUnavailableError);
});

test("a body read that fails mid-stream is reported as unavailable, not a bug", async () => {
  function okWithFailingBody(makeError: () => Error) {
    return { ok: true, status: 200, json: () => Promise.reject(makeError()), arrayBuffer: () => Promise.reject(makeError()) } as unknown as Response;
  }
  const timeout = () => Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
  const reset = () => new TypeError("terminated");

  stub(() => okWithFailingBody(timeout));
  await assert.rejects(fetchJson("apple", "https://api.test/a"), SourceUnavailableError);
  stub(() => okWithFailingBody(timeout));
  await assert.rejects(fetchBytes("apple", "https://img.test/a"), SourceUnavailableError);

  stub(() => okWithFailingBody(reset));
  await assert.rejects(fetchJson("apple", "https://api.test/a"), SourceUnavailableError);
  stub(() => okWithFailingBody(reset));
  await assert.rejects(fetchBytes("apple", "https://img.test/a"), SourceUnavailableError);
});

test("the throttle spaces task starts and survives a failing task", async () => {
  let clock = 0;
  const throttle = createThrottle(1000, () => clock, async (ms) => {
    clock += ms;
  });
  const starts: number[] = [];
  await Promise.all([1, 2, 3].map(() => throttle(async () => { starts.push(clock); })));
  assert.deepEqual(starts, [0, 1000, 2000]);
  await assert.rejects(throttle(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await throttle(async () => "after"), "after");
});

test("an urgent task runs before queued normal tasks, the gap holds, and each lane is FIFO", async () => {
  let clock = 0;
  const throttle = createThrottle(1000, () => clock, async (ms) => {
    clock += ms;
  });
  const order: Array<[string, number]> = [];
  const mark = (name: string) => async () => { order.push([name, clock]); };
  await Promise.all([
    throttle(mark("n1")),
    throttle(mark("n2")),
    throttle(mark("n3")),
    throttle(mark("u1"), { urgent: true }),
    throttle(mark("u2"), { urgent: true })
  ]);
  assert.deepEqual(order, [["n1", 0], ["u1", 1000], ["u2", 2000], ["n2", 3000], ["n3", 4000]]);
});
