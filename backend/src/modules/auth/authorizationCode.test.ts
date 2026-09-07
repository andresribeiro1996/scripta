// Pure unit tests for the Task 4A authorization-code exchange primitive —
// no Fastify, no SQLite, no env sandboxing needed: this module only
// imports node:crypto and a type-only import from domain/types.ts, so it
// has no dependency on config/env.ts at all.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createAuthorizationCode, consumeAuthorizationCode } from "./authorizationCode.js";
import type { AuthenticatedUser, TokenPair } from "./domain/types.js";

const user: AuthenticatedUser = { id: "u1", email: "a@b.c", username: "andre", avatarId: null };
const tokens: TokenPair = { accessToken: "access-1", refreshToken: "refresh-1" };

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

test("a code with no PKCE challenge (plain web flow) exchanges with no verifier", () => {
  const code = createAuthorizationCode({ user, tokens, codeChallenge: null });
  const result = consumeAuthorizationCode(code, null);
  assert.deepEqual(result, { ok: true, user, tokens });
});

test("an unknown code is rejected", () => {
  const result = consumeAuthorizationCode("does-not-exist", null);
  assert.deepEqual(result, { ok: false, reason: "not_found" });
});

test("a code is single-use: a second exchange attempt fails even with the right verifier", () => {
  const verifier = "correct-verifier-1234567890123456789012345";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  const first = consumeAuthorizationCode(code, verifier);
  assert.equal(first.ok, true);

  const second = consumeAuthorizationCode(code, verifier);
  assert.deepEqual(second, { ok: false, reason: "not_found" });
});

test("an expired code is rejected even before the verifier is checked", async () => {
  const verifier = "correct-verifier-1234567890123456789012345";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) }, 10 /* ttlMs */);

  await new Promise((resolve) => setTimeout(resolve, 25));

  const result = consumeAuthorizationCode(code, verifier);
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

// "A second app receives the redirect and exchanges the code without the
// verifier" — the exact scenario the PKCE binding exists for (see this
// module's own top comment). On Android, any app registered for the same
// custom scheme can receive the redirect; without this check, "short-lived
// and single-use" doesn't help because the attacker exchanges immediately.
test("a second app cannot exchange a PKCE-bound code without the verifier", () => {
  const verifier = "legitimate-app-verifier-123456789012345678";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  const attackerAttempt = consumeAuthorizationCode(code, null);
  assert.deepEqual(attackerAttempt, { ok: false, reason: "verifier_mismatch" });
});

test("a second app supplying the wrong verifier is also rejected", () => {
  const verifier = "legitimate-app-verifier-123456789012345678";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  const attackerAttempt = consumeAuthorizationCode(code, "guessed-wrong-verifier-000000000000000");
  assert.deepEqual(attackerAttempt, { ok: false, reason: "verifier_mismatch" });
});

test("a wrong-verifier attempt burns the code — the legitimate app's later, correct exchange also fails", () => {
  // Single-use is enforced on the FIRST lookup regardless of outcome, so
  // an attacker racing the redirect can't be retried against by the
  // legitimate app either — the whole flow just fails loudly, forcing a
  // fresh sign-in, rather than silently racing to see who wins.
  const verifier = "legitimate-app-verifier-123456789012345678";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  consumeAuthorizationCode(code, "wrong");
  const legitimateAttempt = consumeAuthorizationCode(code, verifier);
  assert.deepEqual(legitimateAttempt, { ok: false, reason: "not_found" });
});

test("the correct verifier exchanges successfully", () => {
  const verifier = "legitimate-app-verifier-123456789012345678";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  const result = consumeAuthorizationCode(code, verifier);
  assert.deepEqual(result, { ok: true, user, tokens });
});
