// HTTP layer for the murals module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action, same as modules/library/routes.ts
// and modules/gallery/routes.ts: authGuard comes from auth's PUBLIC
// interface only.

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { MuralNotFoundError } from "./domain/errors.js";
import type { MuralsService } from "./service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createMuralSchema = z.object({
  name: z.string().min(1)
});

// Deliberately light-touch, same treatment modules/library/routes.ts
// gives its own opaque `data` blob: this only checks blocks is an array —
// it doesn't otherwise care what a block looks like.
const updateMuralSchema = z
  .object({
    name: z.string().min(1).optional(),
    blocks: z.array(z.unknown()).optional()
  })
  .refine((body) => body.name !== undefined || body.blocks !== undefined, {
    message: "At least one of name or blocks must be provided."
  });

const setCoverSchema = z.object({
  imageId: z.string().min(1),
  url: z.string().min(1)
});

function replyToMuralError(reply: FastifyReply, err: unknown) {
  if (err instanceof MuralNotFoundError) {
    return reply.code(404).send({ error: err.message });
  }
  throw err;
}

export function buildMuralRoutes(service: MuralsService) {
  return async function muralRoutes(app: FastifyInstance) {
    app.get("/murals", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ murals: service.listMurals(request.user.id) });
    });

    app.post("/murals", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createMuralSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "name is required and must be non-empty." });
      }
      const mural = service.createMural(request.user.id, parsed.data.name);
      return reply.code(201).send(mural);
    });

    app.get("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      try {
        return reply.send(service.getMural(request.user.id, params.data.id));
      } catch (err) {
        return replyToMuralError(reply, err);
      }
    });

    app.put("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const body = updateMuralSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request body." });
      }
      try {
        return reply.send(service.updateMural(request.user.id, params.data.id, body.data));
      } catch (err) {
        return replyToMuralError(reply, err);
      }
    });

    app.delete("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      try {
        service.deleteMural(request.user.id, params.data.id);
      } catch (err) {
        return replyToMuralError(reply, err);
      }
      return reply.code(204).send();
    });

    app.put("/murals/:id/cover", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const body = setCoverSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Expected {"imageId": string, "url": string}.' });
      }
      try {
        return reply.send(service.setCover(request.user.id, params.data.id, body.data.imageId, body.data.url));
      } catch (err) {
        return replyToMuralError(reply, err);
      }
    });

    app.delete("/murals/:id/cover", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      try {
        return reply.send(service.clearCover(request.user.id, params.data.id));
      } catch (err) {
        return replyToMuralError(reply, err);
      }
    });
  };
}
