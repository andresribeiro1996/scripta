import type { FastifyInstance } from "fastify";
import { getOptionalAuthenticatedUser } from "../auth/index.js";
import type { WorksService } from "./service.js";
import type { BookStatsService } from "./stats.js";

export function buildWorkRoutes(service: WorksService) {
  return async function workRoutes(app: FastifyInstance) {
    app.get("/works/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const viewer = getOptionalAuthenticatedUser(request);
      const page = service.getPage(id, viewer?.id ?? null);
      reply.header("Cache-Control", "no-store");
      if (!page) return reply.code(404).send({ error: "No book with that id." });
      return reply.send(page);
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
