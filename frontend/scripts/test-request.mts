import assert from "node:assert/strict";
import { test } from "node:test";

const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });
const { setSession } = await import("../src/auth/tokenStore.ts");
const { request } = await import("../src/api/request.ts");

type Seen = { url: string; method: string | undefined; authorization: string | null; contentType: string | null; body: unknown };

async function capture(run: () => Promise<unknown>, answer: () => Response = () => Response.json({ ok: true })) {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(url), method: init?.method, authorization: headers.get("Authorization"), contentType: headers.get("Content-Type"), body: init?.body });
    return answer();
  };
  try {
    const result = await run();
    return { seen, result };
  } finally {
    globalThis.fetch = original;
  }
}

function signIn() {
  setSession({ user: { id: "u1", email: "a@b.c", username: "a", avatarId: null }, accessToken: "access-1", refreshToken: "refresh-1" });
}

test("none sends no token even when signed in", async () => {
  signIn();
  const { seen } = await capture(() => request("/x", { auth: "none" }));
  assert.equal(seen[0]!.authorization, null);
  setSession(null);
});

test("optional and required send the token when signed in", async () => {
  signIn();
  const { seen } = await capture(async () => {
    await request("/a", { auth: "optional" });
    await request("/b", { auth: "required" });
  });
  assert.deepEqual(seen.map((s) => s.authorization), ["Bearer access-1", "Bearer access-1"]);
  setSession(null);
});

test("optional without a session sends no token", async () => {
  setSession(null);
  const { seen } = await capture(() => request("/a", { auth: "optional" }));
  assert.equal(seen[0]!.authorization, null);
});

test("a plain body is stringified with a JSON content type", async () => {
  const { seen } = await capture(() => request("/a", { method: "POST", body: { name: "N" }, auth: "none" }));
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.body, JSON.stringify({ name: "N" }));
  assert.equal(seen[0]!.contentType, "application/json");
});

test("FormData passes through untouched", async () => {
  const form = new FormData();
  form.append("image", new Blob(["x"]), "x.png");
  const { seen } = await capture(() => request("/a", { method: "POST", body: form, auth: "none" }));
  assert.equal(seen[0]!.body, form);
  assert.equal(seen[0]!.contentType, null);
});

test("no body sends no body", async () => {
  const { seen } = await capture(() => request("/a", { method: "POST", auth: "none" }));
  assert.equal(seen[0]!.body, undefined);
});

test("the parsed body is returned", async () => {
  const { result } = await capture(() => request<{ ok: boolean }>("/a", { auth: "none" }));
  assert.deepEqual(result, { ok: true });
});
