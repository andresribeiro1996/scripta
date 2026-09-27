import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openWaitlistDb } from "./adapters/sqlite/connection.js";
import { createSqliteWaitlistRepository } from "./adapters/sqlite/sqliteWaitlistRepository.js";
import { buildWaitlistRoutes } from "./routes.js";
import { createWaitlistService } from "./service.js";

export async function waitlistPlugin(app: FastifyInstance) {
  const db = openWaitlistDb();
  const repo = createSqliteWaitlistRepository(db);
  const service = createWaitlistService(repo);

  await app.register(fastifyRateLimit, {
    max: 5,
    timeWindow: "1 minute"
  });

  await app.register(buildWaitlistRoutes(service));
}
