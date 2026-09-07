// Pure unit tests for the /auth/google start-request validation plugin.ts's
// generateStateFunction runs before ever creating a flow — see that
// module's own comment and mobileRedirectAllowlist.test.ts for the same
// "pull the rule out as a pure function" reasoning.

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGoogleStartRequest } from "./googleStartRequest.js";

const allowlist = ["scripta://oauth-redirect"];

test("a plain web start with no PKCE and no redirect target is allowed", () => {
  const result = validateGoogleStartRequest(
    { codeChallenge: null, codeChallengeMethod: null, redirectTargetParam: null },
    allowlist
  );
  assert.deepEqual(result, { codeChallenge: null, redirectTarget: null });
});

test("a mobile start with S256 PKCE and an allowlisted redirect target is allowed", () => {
  const result = validateGoogleStartRequest(
    { codeChallenge: "abc123", codeChallengeMethod: "S256", redirectTargetParam: "scripta://oauth-redirect" },
    allowlist
  );
  assert.deepEqual(result, { codeChallenge: "abc123", redirectTarget: "scripta://oauth-redirect" });
});

test("a code_challenge without S256 as the method is rejected", () => {
  assert.throws(() =>
    validateGoogleStartRequest(
      { codeChallenge: "abc123", codeChallengeMethod: "plain", redirectTargetParam: null },
      allowlist
    )
  );
});

// BLOCKER 2(a) — PKCE must not be optional for a custom-scheme/App Link
// redirect target: without it, any other app registered for the same
// scheme can intercept the redirect and exchange the code before the
// legitimate app does (see authorizationCode.ts's own top comment).
test("a redirect target with no code_challenge at all is rejected", () => {
  assert.throws(() =>
    validateGoogleStartRequest(
      { codeChallenge: null, codeChallengeMethod: null, redirectTargetParam: "scripta://oauth-redirect" },
      allowlist
    )
  );
});

test("a redirect target with a code_challenge but the wrong method is still rejected", () => {
  assert.throws(() =>
    validateGoogleStartRequest(
      { codeChallenge: "abc123", codeChallengeMethod: "plain", redirectTargetParam: "scripta://oauth-redirect" },
      allowlist
    )
  );
});

test("a redirect target not on the allowlist is rejected even with valid PKCE", () => {
  assert.throws(() =>
    validateGoogleStartRequest(
      { codeChallenge: "abc123", codeChallengeMethod: "S256", redirectTargetParam: "evil://phish-me" },
      allowlist
    )
  );
});
