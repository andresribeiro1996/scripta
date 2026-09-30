import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createR2ObjectStore } from "./r2ObjectStore.js";

const id = "0b6f9c1e-3a4d-4e5f-8a7b-1c2d3e4f5a6b";
const key = `covers/${id}.webp`;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const store = createR2ObjectStore({
  endpoint: "https://acct.r2.test",
  accessKeyId: "AKID",
  secretAccessKey: "secret",
  bucket: "atmyshelf-images",
  publicUrl: "https://images.test"
});

function stub(status: number, body = "") {
  const calls: { url: string; method: string; headers: Headers }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({ url: request.url, method: request.method, headers: request.headers });
    return new Response(body || null, { status });
  }) as typeof fetch;
  return calls;
}

test("put signs a PUT with the content type and the immutable cache header", async () => {
  const calls = stub(200);
  await store.put(key, Buffer.from("img"), "image/webp");
  assert.equal(calls[0]!.method, "PUT");
  assert.equal(calls[0]!.url, `https://acct.r2.test/atmyshelf-images/${key}`);
  assert.equal(calls[0]!.headers.get("content-type"), "image/webp");
  assert.equal(calls[0]!.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.match(calls[0]!.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256/);
});

test("put rejects on a non-2xx", async () => {
  stub(403);
  await assert.rejects(store.put(key, Buffer.from("img"), "image/webp"), /HTTP 403/);
});

test("get returns the bytes, null on 404, and rejects on other failures", async () => {
  stub(200, "img");
  assert.deepEqual(await store.get(key), Buffer.from("img"));
  stub(404);
  assert.equal(await store.get(key), null);
  stub(500);
  await assert.rejects(store.get(key), /HTTP 500/);
});

test("delete accepts 204, 200 and 404 and rejects otherwise", async () => {
  for (const status of [204, 200, 404]) {
    const calls = stub(status);
    await store.delete(key);
    assert.equal(calls[0]!.method, "DELETE");
  }
  stub(403);
  await assert.rejects(store.delete(key), /HTTP 403/);
});

test("every request carries a 15s abort signal", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout");
  const calls = stub(200);
  await store.put(key, Buffer.from("img"), "image/webp");
  await store.get(key);
  await store.delete(key);
  assert.equal(calls.length, 3);
  assert.deepEqual(timeout.mock.calls.map((call) => call.arguments[0]), [15_000, 15_000, 15_000]);
});

test("methods validate the key before any request", async () => {
  const calls = stub(200);
  await assert.rejects(store.get("covers/../x.webp"), /Invalid object key/);
  assert.equal(calls.length, 0);
});

test("urlFor joins the public URL and the key", () => {
  assert.equal(store.urlFor(key), `https://images.test/${key}`);
});
