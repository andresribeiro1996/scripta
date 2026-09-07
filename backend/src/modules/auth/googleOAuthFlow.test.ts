// Pure unit tests — no env sandboxing needed, this module only imports
// node:crypto.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createGoogleOAuthFlow, consumeGoogleOAuthFlow } from "./googleOAuthFlow.js";

test("round-trips the PKCE challenge and redirect target through a flow id", () => {
  const flowId = createGoogleOAuthFlow({ codeChallenge: "abc123", redirectTarget: "scripta://oauth-redirect" });
  const consumed = consumeGoogleOAuthFlow(flowId);
  assert.deepEqual(consumed, { codeChallenge: "abc123", redirectTarget: "scripta://oauth-redirect" });
});

test("a plain web flow with neither field set round-trips nulls", () => {
  const flowId = createGoogleOAuthFlow({ codeChallenge: null, redirectTarget: null });
  const consumed = consumeGoogleOAuthFlow(flowId);
  assert.deepEqual(consumed, { codeChallenge: null, redirectTarget: null });
});

test("a flow is single-use", () => {
  const flowId = createGoogleOAuthFlow({ codeChallenge: null, redirectTarget: null });
  consumeGoogleOAuthFlow(flowId);
  assert.equal(consumeGoogleOAuthFlow(flowId), null);
});

test("an unknown flow id degrades to null rather than throwing", () => {
  assert.equal(consumeGoogleOAuthFlow("does-not-exist"), null);
});
