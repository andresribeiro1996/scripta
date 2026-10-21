import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TopShelfRecapService } from "./topShelfRecapService.js";
import type { TopShelfService } from "./topShelfService.js";

const querySchema = z.object({
  period: z.enum(["month", "all"]),
  genre: z.string().max(80).optional(),
  view: z.enum(["champions", "crowned", "tiered", "highestTier", "quizzed", "risingStar", "games"]).optional(),
});

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export function buildTopShelfRoutes(service: TopShelfService, recaps: TopShelfRecapService) {
  return async function topShelfRoutes(app: FastifyInstance) {
    await app.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    app.get("/top-shelf", async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid period/genre/view." });
      reply.header("Cache-Control", "no-store");
      return reply.send(service.getTopShelf({ period: parsed.data.period, genre: parsed.data.genre || null, view: parsed.data.view }));
    });
    app.get("/top-shelf/recaps", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.send(recaps.getIndex());
    });
    app.get("/top-shelf/recaps/:month", async (request, reply) => {
      const parsed = monthSchema.safeParse((request.params as { month?: string }).month);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid month." });
      const recap = recaps.getRecap(parsed.data);
      if (!recap) return reply.code(404).send({ error: "No recap for that month." });
      reply.header("Cache-Control", "no-store");
      return reply.send(recap);
    });
  };
}
