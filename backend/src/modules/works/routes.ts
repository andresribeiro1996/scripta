import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getOptionalAuthenticatedUser } from "../auth/index.js";
import type { WorksService } from "./service.js";
import type { BookStatsService } from "./stats.js";

const charactersSchema = z.object({ workIds: z.array(z.string().min(1)).max(500) });

export function buildWorkRoutes(service: WorksService) {
  return async function workRoutes(app: FastifyInstance) {
    app.post("/works/characters", async (request, reply) => {
      getOptionalAuthenticatedUser(request);
      reply.header("Cache-Control", "no-store");
      const parsed = charactersSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {workIds} with at most 500 ids." });
      return reply.send({ characters: service.characters(parsed.data.workIds) });
    });

    app.get("/works/:id/cast", async (request, reply) => {
      const { id } = request.params as { id: string };
      getOptionalAuthenticatedUser(request);
      const cast = service.cast(id);
      reply.header("Cache-Control", "no-store");
      if (!cast) return reply.code(404).send({ error: "No book with that id." });
      return reply.send(cast);
    });

    app.get("/works/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const viewer = getOptionalAuthenticatedUser(request);
      const page = service.getPage(id, viewer?.id ?? null);
      reply.header("Cache-Control", "no-store");
      if (!page) return reply.code(404).send({ error: "No book with that id." });
      return reply.send(page);
    });

    app.get("/awards/recent", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.send(service.recentAwards());
    });
  };
}

export function buildWorkStatsRoutes(stats: BookStatsService) {
  return async function workStatsRoutes(app: FastifyInstance) {
    app.get("/works/:id/stats", async (request, reply) => {
      const { id } = request.params as { id: string };
      getOptionalAuthenticatedUser(request);
      const result = stats.getStats(id);
      reply.header("Cache-Control", "no-store");
      if (!result) return reply.code(404).send({ error: "No book with that id." });
      return reply.send(result);
    });
  };
}
