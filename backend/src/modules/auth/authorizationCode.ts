// Task 4A — the short-lived, single-use authorization code that stands in
// for a Google sign-in's tokens on the redirect back to the client. This
// is what replaces the old `#access_token=...&refresh_token=...` URL
// fragment (see plugin.ts): the redirect now carries only this opaque
// code, and the already-issued token pair sits here in memory until a
// POST /auth/google/exchange (routes.ts) claims it.
//
// Modeled directly on modules/socials/linkSessions.ts's consumeLinkSession
// — a plain in-memory Map, single-use, swept lazily — with one addition:
// the code can be bound to a PKCE code_challenge (RFC 7636 S256), so the
// exchange can require the SAME app instance that started the flow to
// prove it holds the matching code_verifier. Without this, on Android any
// app registered for the same custom scheme can receive the redirect and
// exchange the code before the legitimate app does — "short-lived and
// single-use" alone doesn't help, because the attacker exchanges
// immediately, not after the window closes.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser, TokenPair } from "./domain/types.js";

/** Plan requires TTL <= 60s; kept well under that so a slow network still
 *  leaves margin, not because 60s itself was measured as unsafe. */
export const AUTHORIZATION_CODE_TTL_MS = 45 * 1000;

export interface PendingAuthorizationCode {
  user: AuthenticatedUser;
  tokens: TokenPair;
  /** null means this code was minted for a flow that sent no
   *  code_challenge (today's plain desktop-web redirect) — the exchange
   *  then requires no code_verifier either. Any flow that DID send a
   *  challenge must present the matching verifier; see consumeAuthorizationCode. */
  codeChallenge: string | null;
}

interface StoredCode extends PendingAuthorizationCode {
  expiresAt: number;
}

const pendingCodes = new Map<string, StoredCode>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt <= now) pendingCodes.delete(code);
  }
}

export function createAuthorizationCode(input: PendingAuthorizationCode, ttlMs: number = AUTHORIZATION_CODE_TTL_MS): string {
  sweepExpired();
  const code = randomBytes(32).toString("base64url");
  pendingCodes.set(code, { ...input, expiresAt: Date.now() + ttlMs });
  return code;
}

export type ConsumeAuthorizationCodeResult =
  | { ok: true; user: AuthenticatedUser; tokens: TokenPair }
  | { ok: false; reason: "not_found" | "expired" | "verifier_mismatch" };

/** RFC 7636: code_challenge = BASE64URL(SHA256(ASCII(code_verifier))). */
function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Different lengths can never be equal, and timingSafeEqual throws
  // rather than returning false for mismatched lengths — nothing secret
  // is revealed by short-circuiting here since the attacker already
  // supplied both values being compared.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Single-use regardless of outcome: the code is deleted on the FIRST
 *  lookup, whether or not the verifier ends up matching. This closes the
 *  exact race the PKCE binding exists for — a second app that grabs the
 *  redirect and guesses/omits the verifier doesn't just fail harmlessly,
 *  it also burns the code so the legitimate app's later, correct exchange
 *  attempt fails too (loudly, forcing a fresh sign-in) rather than
 *  silently racing to see who exchanges first. */
export function consumeAuthorizationCode(code: string, codeVerifier: string | null): ConsumeAuthorizationCodeResult {
  // Deliberately no sweepExpired() call here: this code's own entry (if
  // any) needs to be inspected for expiry itself, below, and an eager
  // sweep would delete an expired-but-still-present entry first, turning
  // an "expired" result into an indistinguishable "not_found" one. Lazy
  // cleanup of OTHER abandoned entries still happens on every
  // createAuthorizationCode call.
  const entry = pendingCodes.get(code);
  if (!entry) return { ok: false, reason: "not_found" };
  pendingCodes.delete(code);

  if (entry.expiresAt <= Date.now()) return { ok: false, reason: "expired" };

  if (entry.codeChallenge) {
    if (!codeVerifier || !timingSafeStringEqual(s256Challenge(codeVerifier), entry.codeChallenge)) {
      return { ok: false, reason: "verifier_mismatch" };
    }
  }

  return { ok: true, user: entry.user, tokens: entry.tokens };
}

export function authorizationCodeErrorMessage(reason: "not_found" | "expired" | "verifier_mismatch"): string {
  if (reason === "verifier_mismatch") return "This sign-in could not be verified — please try again.";
  return "This sign-in code has expired or was already used — please try again.";
}
