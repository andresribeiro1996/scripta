import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverDevSession } from "./devSession.js";

test("development recovery signs in with a fresh session after credentials are cleared", async () => {
  let token: string | null = null;
  let logins = 0;
  const store = { getRefreshToken: async () => token };
  const signIn = async () => { token = `fresh-${++logins}`; };
  assert.equal(await recoverDevSession(store, { isDev: true, enabled: true }, signIn), true);
  assert.equal(token, "fresh-1");
  assert.equal(await recoverDevSession(store, { isDev: true, enabled: true }, signIn), false);
  assert.equal(logins, 1);
  token = null;
  assert.equal(await recoverDevSession(store, { isDev: true, enabled: true }, signIn), true);
  assert.equal(token, "fresh-2");
});

test("development recovery never replaces an existing session or runs in releases", async () => {
  for (const [isDev, enabled, token] of [[false, true, null], [true, false, null], [true, true, "existing-session"]] as const) {
    const store = { getRefreshToken: async () => token };
    assert.equal(await recoverDevSession(store, { isDev, enabled }, async () => { assert.fail("Unexpected development login"); }), false);
  }
});

test("development login failures propagate without creating a session", async () => {
  const failure = new Error("Server unavailable");
  const store = { getRefreshToken: async () => null };
  await assert.rejects(recoverDevSession(store, { isDev: true, enabled: true }, async () => { throw failure; }), failure);
  assert.equal(await store.getRefreshToken(), null);
});
