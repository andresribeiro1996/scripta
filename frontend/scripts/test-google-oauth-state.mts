import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  },
});

const { consumeGoogleOAuthState, GOOGLE_OAUTH_STATE_KEY } = await import("../src/auth/googleOAuthState.ts");

test("a matching Google OAuth state is accepted and cleared", () => {
  values.set(GOOGLE_OAUTH_STATE_KEY, "expected");
  assert.equal(consumeGoogleOAuthState("expected"), true);
  assert.equal(values.has(GOOGLE_OAUTH_STATE_KEY), false);
});

test("a mismatched Google OAuth state is rejected and cleared", () => {
  values.set(GOOGLE_OAUTH_STATE_KEY, "expected");
  assert.equal(consumeGoogleOAuthState("attacker"), false);
  assert.equal(values.has(GOOGLE_OAUTH_STATE_KEY), false);
});
