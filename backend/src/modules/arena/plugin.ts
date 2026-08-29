// Composition root — mirrors modules/covers/plugin.ts's shape, plus this
// module's own addition: a background interval that settles duels whose
// timer has expired and advances the bracket. The FIRST background timer
// in this codebase (no job queue/cron exists elsewhere) — a plain
// setInterval is the simplest thing that could work at this app's scale,
// same "no new dependency for something this small" instinct as
// node:sqlite over better-sqlite3.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openArenaDb } from "./adapters/sqlite/connection.js";
import { createSqliteArenaRepository } from "./adapters/sqlite/sqliteArenaRepository.js";
import { buildArenaRoutes, buildVoteRoute } from "./routes.js";
import { createArenaService } from "./service.js";

const SWEEP_INTERVAL_MS = 30_000;

export async function arenaPlugin(app: FastifyInstance) {
  const db = openArenaDb();
  const repo = createSqliteArenaRepository(db);
  const service = createArenaService(repo);

  const sweep = setInterval(() => {
    try {
      service.runScheduledSweep();
    } catch (err) {
      app.log.error(err, "arena round-settlement sweep failed");
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref(); // don't keep the process alive just for this timer
  app.addHook("onClose", (_instance, done) => {
    clearInterval(sweep);
    done();
  });

  // Own scope, own (tighter) rate limit — see buildVoteRoute's own
  // comment for why this route needs to be separate from the rest.
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 20, timeWindow: "1 minute" });
    await scoped.register(buildVoteRoute(service));
  });

  await app.register(buildArenaRoutes(service));
}
