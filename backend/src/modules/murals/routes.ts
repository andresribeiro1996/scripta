// HTTP layer for the murals module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action, same as modules/library/routes.ts
// and modules/gallery/routes.ts: authGuard comes from auth's PUBLIC
// interface only.
//
// "Not found or not owned" is a plain undefined/boolean check here, same
// convention as modules/gallery/routes.ts's DELETE /gallery/:id and
// modules/library/routes.ts's GET /library — not a caught exception (see
// domain/errors.ts for why this module doesn't use one for that case).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import type { MuralsService } from "./service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createMuralSchema = z.object({
  name: z.string().min(1, "name is required and must be non-empty.")
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

export function buildMuralRoutes(service: MuralsService) {
  return async function muralRoutes(app: FastifyInstance) {
    app.get("/murals", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ murals: service.listMurals(request.user.id) });
    });

    app.post("/murals", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createMuralSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      const mural = service.createMural(request.user.id, parsed.data.name);
      return reply.code(201).send(mural);
    });

    app.get("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const mural = service.getMural(request.user.id, params.data.id);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.put("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const body = updateMuralSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const mural = service.updateMural(request.user.id, params.data.id, body.data);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.delete("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const deleted = service.deleteMural(request.user.id, params.data.id);
      if (!deleted) {
        return reply.code(404).send({ error: "No mural with that id." });
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
      const mural = service.setCover(request.user.id, params.data.id, body.data.imageId, body.data.url);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.delete("/murals/:id/cover", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const mural = service.clearCover(request.user.id, params.data.id);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });
  };
}
