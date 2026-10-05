import type { FastifyReply, FastifyRequest } from "fastify";

export function worksFormat(request: FastifyRequest, reply: FastifyReply): boolean {
  const vary = reply.getHeader("vary");
  reply.header("vary", vary === undefined ? "X-Scripta-Works" : `${String(vary)}, X-Scripta-Works`);
  if (request.headers["x-scripta-works"] === "1") return true;
  request.log.info({ method: request.method, route: request.routeOptions.url }, "legacy client");
  return false;
}
