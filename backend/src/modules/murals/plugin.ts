// The murals module's Fastify plugin and composition root — mirrors
// modules/library/plugin.ts's shape, plus modules/gallery/plugin.ts's
// pattern of registering a plugin-scoped rate limiter.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { createSqliteMuralsRepository } from "./adapters/sqlite/sqliteMuralsRepository.js";
import { openMuralsDb } from "./adapters/sqlite/connection.js";
import { buildMuralRoutes } from "./routes.js";
import { createMuralsService } from "./service.js";

export async function muralsPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openMuralsDb();
  const muralsRepository = createSqliteMuralsRepository(db);
  const muralsService = createMuralsService(muralsRepository);
  // -----------------------------------------------------------------------

  // Registered now, ahead of any route actually needing it, so it
  // already covers the public share route Task 4 adds on top of these —
  // same reasoning and same config as gallery's own rate-limit
  // registration (modules/gallery/plugin.ts).
  await app.register(fastifyRateLimit, {
    max: 30,
    timeWindow: "1 minute"
  });

  await app.register(buildMuralRoutes(muralsService));
}
