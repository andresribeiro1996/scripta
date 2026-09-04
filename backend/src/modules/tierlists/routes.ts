// HTTP layer for the tierlists module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action, same as modules/murals/routes.ts:
// authGuard comes from auth's PUBLIC interface only.
//
// "Not found or not owned" is a plain undefined/boolean check here, same
// convention as modules/murals/routes.ts's own /murals/:id routes — not a
// caught exception (see modules/murals/domain/errors.ts's counterpart
// comment for why a module like this doesn't use one for that case).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import type { TierlistsService } from "./service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createTierlistSchema = z.object({
  name: z.string().min(1, "name is required and must be non-empty.")
});

// Deliberately light-touch, same treatment modules/murals/routes.ts gives
// its own opaque `blocks` blob: this only checks data is an object — it
// doesn't otherwise care what a tier list document looks like.
const updateTierlistSchema = z
  .object({
    name: z.string().min(1).optional(),
    data: z.record(z.unknown()).optional()
  })
  .refine((body) => body.name !== undefined || body.data !== undefined, {
    message: "At least one of name or data must be provided."
  });

export function buildTierlistRoutes(service: TierlistsService) {
  return async function tierlistRoutes(app: FastifyInstance) {
    app.get("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ tierlists: service.listTierlists(request.user.id) });
    });

    app.post("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createTierlistSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.createTierlist(request.user.id, parsed.data.name);
      return reply.code(201).send(tierlist);
    });

    app.get("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const tierlist = service.getTierlist(request.user.id, params.data.id);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send(tierlist);
    });

    app.put("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = updateTierlistSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.updateTierlist(request.user.id, params.data.id, body.data);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send(tierlist);
    });

    app.delete("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const deleted = service.deleteTierlist(request.user.id, params.data.id);
      if (!deleted) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.code(204).send();
    });
  };
}
