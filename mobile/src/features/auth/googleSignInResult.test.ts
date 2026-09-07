/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";

const { authorizationCodeFromGoogleRedirect, GoogleSignInStateMismatchError } = await import("./googleSignInResult" + ".ts");

test("accepts the authorization code when the returned state matches", () => {
  assert.equal(authorizationCodeFromGoogleRedirect("scripta://oauth-redirect?code=code-1&state=nonce-1", "nonce-1"), "code-1");
});

test("rejects the authorization code when the returned state does not match", () => {
  assert.throws(
    () => authorizationCodeFromGoogleRedirect("scripta://oauth-redirect?code=attacker-code&state=wrong", "nonce-1"),
    GoogleSignInStateMismatchError,
  );
});
