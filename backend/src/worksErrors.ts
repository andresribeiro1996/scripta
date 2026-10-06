import type { FastifyReply } from "fastify";
import { UnknownWorkError, WorkResolutionError } from "./modules/library/index.js";

export function sendWorksError(reply: FastifyReply, err: unknown) {
  if (err instanceof UnknownWorkError) return reply.code(400).send({ error: err.message });
  if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
  throw err;
}
