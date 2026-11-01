import type { FastifyReply, FastifyRequest } from "fastify";
import { localeOf, t } from "./i18n/index.js";
import { UnknownWorkError, WorkResolutionError } from "./modules/library/index.js";

export function sendWorksError(request: FastifyRequest, reply: FastifyReply, err: unknown) {
  if (err instanceof UnknownWorkError) return reply.code(400).send({ error: t(localeOf(request), err.key, err.vars) });
  if (err instanceof WorkResolutionError) return reply.code(503).send({ error: t(localeOf(request), err.key, err.vars) });
  throw err;
}
