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
