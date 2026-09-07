// Carries a starting /auth/google request's own PKCE code_challenge and
// chosen redirect target through Google's round trip, keyed by the OAuth
// `state` value — the same "generateStateFunction stashes something,
// checkStateFunction round-trips it via @fastify/oauth2's own signed
// cookie, the callback looks it back up" shape as
// modules/socials/linkSessions.ts's link-session flow (see that file's own
// top comment for the full reasoning). The difference here: this flow
// isn't binding an OAuth connection to an already-signed-in user, it's
// binding it to the PKCE challenge (and, for a mobile caller, the
// allowlisted redirect target) the app instance that started the flow
// supplied — see plugin.ts's generateStateFunction and this module's own
// authorizationCode.ts for what happens with it once Google's callback
// arrives.
//
// A plain in-memory Map is enough for the same reason linkSessions.ts's
// is: entries live minutes, a server restart mid-flow just means the user
// retries "Sign in with Google".

import { randomUUID } from "node:crypto";

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for a redirect round trip through Google

export interface PendingGoogleOAuthFlow {
  /** RFC 7636 S256 code_challenge the app instance sent when starting the
   *  flow, or null for a plain browser redirect that sent none (today's
   *  desktop web flow — see plugin.ts's own comment on why PKCE is
   *  optional there). */
  codeChallenge: string | null;
  /** One of MOBILE_OAUTH_REDIRECT_ALLOWLIST's exact entries, already
   *  validated by plugin.ts before this flow was created — or null to
   *  fall back to the default OAUTH_SUCCESS_REDIRECT_URL (desktop web). */
  redirectTarget: string | null;
}

interface StoredFlow extends PendingGoogleOAuthFlow {
  expiresAt: number;
}

const pendingFlows = new Map<string, StoredFlow>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, flow] of pendingFlows) {
    if (flow.expiresAt <= now) pendingFlows.delete(id);
  }
}

export function createGoogleOAuthFlow(flow: PendingGoogleOAuthFlow): string {
  sweepExpired();
  const flowId = randomUUID();
  pendingFlows.set(flowId, { ...flow, expiresAt: Date.now() + FLOW_TTL_MS });
  return flowId;
}

/** Called from the callback route once Google's own redirect has arrived.
 *  Single-use: a replayed callback request (or a second app racing to hit
 *  the same callback URL — @fastify/oauth2's own state-cookie check
 *  already guards against most of that, this is defense in depth) finds
 *  nothing here the second time. Returns null for an unknown/expired
 *  state, which the callback route treats as "no PKCE, no explicit
 *  redirect target" rather than failing the whole sign-in — the flow
 *  degrades to the plain desktop-web behavior rather than 500ing on a
 *  quirk of a state value this map never saw. */
export function consumeGoogleOAuthFlow(flowId: string): PendingGoogleOAuthFlow | null {
  sweepExpired();
  const flow = pendingFlows.get(flowId);
  if (!flow) return null;
  pendingFlows.delete(flowId);
  return { codeChallenge: flow.codeChallenge, redirectTarget: flow.redirectTarget };
}
