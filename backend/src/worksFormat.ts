import type { FastifyReply, FastifyRequest } from "fastify";
import { UnknownWorkError, WorkResolutionError } from "./modules/library/index.js";

export function worksFormat(request: FastifyRequest, reply: FastifyReply): boolean {
  const vary = reply.getHeader("vary");
  reply.header("vary", vary === undefined ? "X-Scripta-Works" : `${String(vary)}, X-Scripta-Works`);
  if (request.headers["x-scripta-works"] === "1") return true;
  request.log.info({ method: request.method, route: request.routeOptions.url }, "legacy client");
  return false;
}

export function sendWorksError(reply: FastifyReply, err: unknown) {
  if (err instanceof UnknownWorkError) return reply.code(400).send({ error: err.message });
  if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
  throw err;
}
