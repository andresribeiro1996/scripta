import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TopShelfService } from "./topShelfService.js";

const querySchema = z.object({
  period: z.enum(["month", "all"]),
  genre: z.string().max(80).optional(),
  view: z.enum(["champions", "crowned", "tiered", "highestTier", "quizzed", "risingStar", "games"]).optional(),
});

export function buildTopShelfRoutes(service: TopShelfService) {
  return async function topShelfRoutes(app: FastifyInstance) {
    await app.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    app.get("/top-shelf", async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid period/genre/view." });
      reply.header("Cache-Control", "no-store");
      return reply.send(service.getTopShelf({ period: parsed.data.period, genre: parsed.data.genre || null, view: parsed.data.view }));
    });
  };
}
