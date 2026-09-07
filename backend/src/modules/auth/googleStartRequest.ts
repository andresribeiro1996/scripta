// Validates a starting GET /auth/google request's own query params —
// pulled out of plugin.ts's generateStateFunction as a pure function so
// this rule is unit-testable without spinning up Fastify/oauth2 (same
// reasoning as mobileRedirectAllowlist.ts, which this module calls into).

import { isAllowedRedirectTarget } from "./mobileRedirectAllowlist.js";

export interface GoogleStartRequestParams {
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  redirectTargetParam: string | null;
}

export interface ValidatedGoogleStart {
  codeChallenge: string | null;
  redirectTarget: string | null;
}

/** Throws (never returns a "degraded" result) on anything invalid — same
 *  reasoning as plugin.ts's own comment on why generateStateFunction
 *  throws: this makes @fastify/oauth2 reply 500 with the message instead
 *  of starting a flow bound to a request parameter this backend never
 *  validated. */
export function validateGoogleStartRequest(params: GoogleStartRequestParams, mobileRedirectAllowlist: string[]): ValidatedGoogleStart {
  const { codeChallenge, codeChallengeMethod, redirectTargetParam } = params;

  if (codeChallenge && codeChallengeMethod !== "S256") {
    throw new Error("code_challenge_method must be S256 when code_challenge is provided.");
  }

  // BLOCKER 2(a) — PKCE is not optional for a custom-scheme/App Link
  // redirect target: without it, any other app registered for the same
  // scheme can receive the redirect and exchange the code before the
  // legitimate app does (see authorizationCode.ts's own top comment). The
  // plain desktop-web flow (no redirect_target) has no such interception
  // risk, so PKCE stays optional there.
  if (redirectTargetParam && (!codeChallenge || codeChallengeMethod !== "S256")) {
    throw new Error("redirect_target requires a PKCE code_challenge (S256).");
  }

  let redirectTarget: string | null = null;
  if (redirectTargetParam) {
    // The redirect target ALWAYS comes from this fixed, server-side list —
    // redirectTargetParam only selects which allowlisted entry to use, by
    // exact match. Anything else is rejected outright, never partially
    // trusted.
    if (!isAllowedRedirectTarget(redirectTargetParam, mobileRedirectAllowlist)) {
      throw new Error("redirect_target is not on the configured allowlist.");
    }
    redirectTarget = redirectTargetParam;
  }

  return { codeChallenge, redirectTarget };
}
