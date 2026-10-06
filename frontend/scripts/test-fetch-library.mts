import assert from "node:assert/strict";
import { test } from "node:test";

const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });
const { fetchLibrary } = await import("../src/api/library.ts");

const doc = { data: { books: [] }, updatedAt: "now", shareToken: null, shareUrl: null };

async function withFetch(handler: (url: string) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return handler(String(url)); };
  return { urls, restore: () => { globalThis.fetch = original; } };
}

test("a network TypeError on the fresh request retries the plain URL once", async () => {
  const calls = await withFetch((url) => {
    if (url.endsWith("?fresh=1")) throw new TypeError("Failed to fetch");
    return Response.json(doc);
  });
  try {
    assert.deepEqual(await fetchLibrary(), doc);
    assert.equal(calls.urls.length, 2);
    assert.ok(calls.urls[0]!.endsWith("/library?fresh=1"));
    assert.ok(calls.urls[1]!.endsWith("/library"));
  } finally { calls.restore(); }
});

test("an ApiError is not retried", async () => {
  const calls = await withFetch(() => Response.json({ error: "boom" }, { status: 500 }));
  try {
    await assert.rejects(fetchLibrary(), /boom/);
    assert.equal(calls.urls.length, 1);
  } finally { calls.restore(); }
});

test("an AbortError is not retried", async () => {
  const calls = await withFetch(() => { throw new DOMException("Aborted", "AbortError"); });
  try {
    await assert.rejects(fetchLibrary(), { name: "AbortError" });
    assert.equal(calls.urls.length, 1);
  } finally { calls.restore(); }
});
