// The auth module's one piece of public, cross-cutting surface: a Fastify
// preHandler any module can attach to its own routes to require a valid
// access token, without needing to know anything about how tokens work.
//
//   import { authGuard } from "../../modules/auth/index.js";
//   app.get("/my-library", { preHandler: authGuard }, handler);

import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "./domain/types.js";
import { getAuthenticatedUserFromAccessToken } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

export async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return reply.code(401).send({ error: "Missing Authorization: Bearer <token> header." });
  }

  const user = getAuthenticatedUserFromAccessToken(token);
  if (!user) {
    return reply.code(401).send({ error: "Access token is invalid or expired." });
  }

  request.user = user;
}

/** "Who is this, if anyone" — for routes that are genuinely public but
 *  behave differently for a signed-in caller (the tier list voting routes:
 *  a signed-in voter gets one ballot per account, an anonymous one gets a
 *  browser-held ballot id). Deliberately a plain function rather than a
 *  preHandler: it never rejects, so there is no reply to send, nothing to
 *  order against other preHandlers, and no need to widen `request.user`'s
 *  type declaration into a lie on routes where nobody is signed in. */
export function getOptionalAuthenticatedUser(request: FastifyRequest): AuthenticatedUser | null {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) return null;
  return getAuthenticatedUserFromAccessToken(token) ?? null;
}
