/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverDevSession, seedDevSession } from "./devSession.js";

function fakeTokenStore(initial: string | null = null) {
  let refreshToken = initial;
  return {
    async getRefreshToken() {
      return refreshToken;
    },
    async setRefreshToken(token: string) {
      refreshToken = token;
    },
    get current() {
      return refreshToken;
    },
  };
}

test("does nothing outside dev — a release build must never seed a session", async () => {
  const store = fakeTokenStore(null);
  await seedDevSession(store, { isDev: false, devToken: "dev-token" });
  assert.equal(store.current, null);
});

test("does nothing when no dev token is configured", async () => {
  const store = fakeTokenStore(null);
  await seedDevSession(store, { isDev: true, devToken: undefined });
  assert.equal(store.current, null);
});

test("seeds the refresh token in dev when none is stored yet", async () => {
  const store = fakeTokenStore(null);
  await seedDevSession(store, { isDev: true, devToken: "dev-token" });
  assert.equal(store.current, "dev-token");
});

test("never overwrites an already-signed-in session", async () => {
  const store = fakeTokenStore("real-user-token");
  await seedDevSession(store, { isDev: true, devToken: "dev-token" });
  assert.equal(store.current, "real-user-token");
});

test("recovery replaces a token left over from a previous fixture reset", async () => {
  const store = fakeTokenStore("token-from-before-the-reset");
  assert.equal(await recoverDevSession(store, { isDev: true, devToken: "dev-token" }), true);
  assert.equal(store.current, "dev-token");
});

test("recovery declines when the dev token is already the one that failed", async () => {
  // Retrying an identical token buys an identical failure; the problem is
  // the backend, and the caller should report it rather than loop.
  const store = fakeTokenStore("dev-token");
  assert.equal(await recoverDevSession(store, { isDev: true, devToken: "dev-token" }), false);
  assert.equal(store.current, "dev-token");
});

test("recovery never touches a release build or an unconfigured worktree", async () => {
  const release = fakeTokenStore("someones-real-token");
  assert.equal(await recoverDevSession(release, { isDev: false, devToken: "dev-token" }), false);
  assert.equal(release.current, "someones-real-token");

  const unconfigured = fakeTokenStore("someones-real-token");
  assert.equal(await recoverDevSession(unconfigured, { isDev: true, devToken: undefined }), false);
  assert.equal(unconfigured.current, "someones-real-token");
});
