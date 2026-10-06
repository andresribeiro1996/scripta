// The auth module's one piece of public, cross-cutting surface: a Fastify
// preHandler any module can attach to its own routes to require a valid
// access token, without needing to know anything about how tokens work.
//
//   import { authGuard } from "../../modules/auth/index.js";
//   app.get("/my-library", { preHandler: authGuard }, handler);

import { normalizeIP } from "@fastify/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "./domain/types.js";


declare module "fastify" {
  interface FastifyInstance {
    authenticateAccessToken: (token: string) => AuthenticatedUser | null;
  }
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

export async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearerToken(request);

  if (!token) {
    return reply.code(401).send({ error: "Missing Authorization: Bearer <token> header." });
  }

  const user = request.server.authenticateAccessToken?.(token);
  if (!user) {
    return reply.code(401).send({ error: "Access token is invalid or expired." });
  }

  request.user = user;
}

/** "Who is this, if anyone" — for routes that are genuinely public but
 *  behave differently for a signed-in caller (the tier list voting routes:
 *  a signed-in voter gets one ballot per account, an anonymous one gets a
 *  browser-held ballot id). Deliberately a plain function rather than a
 *  preHandler: there is nothing to order against other preHandlers, and no
 *  need to widen `request.user`'s type declaration into a lie on routes where
 *  nobody is signed in. No token is anonymous (null); a token that is present
 *  but invalid or expired throws a 401, so a client refreshes instead of
 *  silently getting the signed-out view. */
export function getOptionalAuthenticatedUser(request: FastifyRequest): AuthenticatedUser | null {
  const token = bearerToken(request);
  if (!token) return null;
  const user = request.server.authenticateAccessToken?.(token);
  if (!user) throw Object.assign(new Error("Access token is invalid or expired."), { statusCode: 401 });
  return user;
}

export function rateLimitKey(request: FastifyRequest): string {
  const token = bearerToken(request);
  const user = token ? request.server.authenticateAccessToken?.(token) : null;
  return user ? `user:${user.id}` : `ip:${normalizeIP(request.ip)}`;
}
