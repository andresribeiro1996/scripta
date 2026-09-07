// Pure unit tests — no env sandboxing needed, this module only imports
// node:crypto.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createGoogleOAuthFlow, consumeGoogleOAuthFlow } from "./googleOAuthFlow.js";

test("round-trips the PKCE challenge and redirect target through a flow id", () => {
  const flowId = createGoogleOAuthFlow({ codeChallenge: "abc123", redirectTarget: "scripta://oauth-redirect", clientState: null });
  const consumed = consumeGoogleOAuthFlow(flowId);
  assert.deepEqual(consumed, { codeChallenge: "abc123", redirectTarget: "scripta://oauth-redirect", clientState: null });
});

test("a plain web flow with no fields set round-trips nulls", () => {
  const flowId = createGoogleOAuthFlow({ codeChallenge: null, redirectTarget: null, clientState: null });
  const consumed = consumeGoogleOAuthFlow(flowId);
  assert.deepEqual(consumed, { codeChallenge: null, redirectTarget: null, clientState: null });
});

// BLOCKER 2(b) — the mobile app's own CSRF nonce (see googleSignIn.ts)
// round-trips the same way the PKCE challenge and redirect target do, so
// plugin.ts's callback can echo it back on the final redirect.
test("round-trips a mobile client's own state nonce", () => {
  const flowId = createGoogleOAuthFlow({ codeChallenge: "abc123", redirectTarget: "scripta://oauth-redirect", clientState: "nonce-1" });
  const consumed = consumeGoogleOAuthFlow(flowId);
  assert.deepEqual(consumed, { codeChallenge: "abc123", redirectTarget: "scripta://oauth-redirect", clientState: "nonce-1" });
});

test("a flow is single-use", () => {
  const flowId = createGoogleOAuthFlow({ codeChallenge: null, redirectTarget: null, clientState: null });
  consumeGoogleOAuthFlow(flowId);
  assert.equal(consumeGoogleOAuthFlow(flowId), null);
});

test("an unknown flow id degrades to null rather than throwing", () => {
  assert.equal(consumeGoogleOAuthFlow("does-not-exist"), null);
});
