// Composition root — mirrors modules/books/plugin.ts's shape, plus a job
// that settles duels whose timer has expired and advances the bracket.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { createJobs } from "../../jobs.js";
import { timeSync } from "../../stallLog.js";
import { openArenaDb } from "./adapters/sqlite/connection.js";
import { createSqliteArenaRepository } from "./adapters/sqlite/sqliteArenaRepository.js";
import { buildArenaRoutes, buildVoteRoute } from "./routes.js";
import type { ArenaPublicApi, EmitPublished, EmitVotedOn } from "./service.js";
import { createArenaPublicApi, createArenaService } from "./service.js";

const SWEEP_INTERVAL_MS = 30_000;

export interface ArenaPluginOptions {
  emitPublished?: EmitPublished;
  emitVotedOn?: EmitVotedOn;
}

export async function arenaPlugin(app: FastifyInstance, opts: ArenaPluginOptions = {}) {
  const db = openArenaDb();
  const repo = createSqliteArenaRepository(db);
  const service = createArenaService(repo, opts.emitPublished, opts.emitVotedOn);

  const jobs = createJobs(app.log);
  jobs.every("arena round-settlement sweep", SWEEP_INTERVAL_MS, () => timeSync(app.log, "arena-sweep", () => service.runScheduledSweep()), SWEEP_INTERVAL_MS);
  app.addHook("onClose", async () => jobs.stopAll());

  // Own scope, own (tighter) rate limit — see buildVoteRoute's own
  // comment for why this route needs to be separate from the rest.
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 20, timeWindow: "1 minute" });
    await scoped.register(buildVoteRoute(service));
  });

  await app.register(buildArenaRoutes(service));
}

let cachedApi: ArenaPublicApi | null = null;

export function getArenaPublicApi(): ArenaPublicApi {
  if (!cachedApi) {
    const service = createArenaService(createSqliteArenaRepository(openArenaDb()));
    cachedApi = createArenaPublicApi(service);
  }
  return cachedApi;
}

let erasingArena: ReturnType<typeof createSqliteArenaRepository> | undefined;

export function deleteArenaUserData(userId: string) {
  (erasingArena ??= createSqliteArenaRepository(openArenaDb())).deleteUserData(userId);
}
