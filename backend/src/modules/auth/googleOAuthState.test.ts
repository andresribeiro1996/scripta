// Pure unit tests for the actual CSRF check behind plugin.ts's
// checkStateFunction — see that module's own top comment for why this
// exists (@fastify/oauth2 v8 requires a real checkStateFunction whenever
// generateStateFunction is given; `() => true` would boot but defeat the
// whole point of the check).

import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidGoogleOAuthState } from "./googleOAuthState.js";

test("matching state and cookie is valid", () => {
  assert.equal(isValidGoogleOAuthState("abc123", "abc123"), true);
});

test("a mismatched state is rejected", () => {
  assert.equal(isValidGoogleOAuthState("attacker-supplied", "abc123"), false);
});

test("a missing cookie is rejected even if state is present", () => {
  assert.equal(isValidGoogleOAuthState("abc123", undefined), false);
});

test("a missing state is rejected even if the cookie is present", () => {
  assert.equal(isValidGoogleOAuthState(undefined, "abc123"), false);
});

test("both missing is rejected, not vacuously valid", () => {
  assert.equal(isValidGoogleOAuthState(undefined, undefined), false);
});

test("an empty-string cookie never validates anything, even an empty state", () => {
  assert.equal(isValidGoogleOAuthState("", ""), false);
});
