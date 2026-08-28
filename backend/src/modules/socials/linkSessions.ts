// Binds an OAuth connect flow back to the specific already-signed-in user
// who started it. This app is pure Bearer-token auth (see api/client.ts's
// apiFetch on the frontend) — no session cookie identifies a user — but
// starting an OAuth flow means a top-level browser navigation to the
// provider's site, which can't carry an Authorization header. So instead:
//
//   1. Frontend calls POST /socials/:provider/link-session (a normal,
//      authenticated apiFetch — Bearer header works fine here) to mint a
//      short-lived, single-use linkId tied to request.user.id.
//   2. Frontend navigates the browser to
//      GET /socials/:provider/connect?linkId=<linkId>.
//   3. That route's generateStateFunction (see plugin.ts) reads linkId
//      off the query string and hands it to @fastify/oauth2 as the OAuth
//      `state` — which the library independently round-trips through its
//      own signed cookie for CSRF protection, same as it already does
//      for plain login-flow state. This module doesn't need to reinvent
//      that half.
//   4. The provider's callback arrives with that same state (=linkId);
//      routes.ts looks the userId back up here and consumes (deletes) it.
//
// A plain in-memory Map is enough: entries live minutes, a lost server
// restart mid-flow just means the user retries "Connect", and nothing
// here needs to survive longer than that.

import { randomUUID } from "node:crypto";

const LINK_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for a redirect round trip

interface PendingLink {
  userId: string;
  provider: string;
  expiresAt: number;
}

const pendingLinks = new Map<string, PendingLink>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, link] of pendingLinks) {
    if (link.expiresAt <= now) pendingLinks.delete(id);
  }
}

export function createLinkSession(userId: string, provider: string): string {
  sweepExpired();
  const linkId = randomUUID();
  pendingLinks.set(linkId, { userId, provider, expiresAt: Date.now() + LINK_TTL_MS });
  return linkId;
}

/** Read-only check, used by generateStateFunction — does NOT consume the
 *  link, since the OAuth flow hasn't actually reached the provider yet. */
export function peekLinkSession(linkId: string, provider: string): boolean {
  sweepExpired();
  const link = pendingLinks.get(linkId);
  return !!link && link.provider === provider;
}

/** Called from the callback route once the token exchange has already
 *  succeeded — single-use, so a replayed callback request can't reuse it. */
export function consumeLinkSession(linkId: string, provider: string): string | null {
  sweepExpired();
  const link = pendingLinks.get(linkId);
  if (!link || link.provider !== provider) return null;
  pendingLinks.delete(linkId);
  return link.userId;
}
