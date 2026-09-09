/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { seedDevSession } from "./devSession.js";

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
