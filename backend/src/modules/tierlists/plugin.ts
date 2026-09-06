// The tierlists module's Fastify plugin and composition root — mirrors
// modules/murals/plugin.ts's shape: two route builders, each registered in
// its OWN Fastify encapsulation scope so each carries its own rate limit.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openTierlistsDb } from "./adapters/sqlite/connection.js";
import { createSqliteTierlistsRepository } from "./adapters/sqlite/sqliteTierlistsRepository.js";
import { buildPublicTierlistRoutes, buildTierlistRoutes } from "./routes.js";
import type { TierlistsPublicApi } from "./service.js";
import { createTierlistsPublicApi, createTierlistsService } from "./service.js";

export async function tierlistsPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openTierlistsDb();
  const tierlistsRepository = createSqliteTierlistsRepository(db);
  const tierlistsService = createTierlistsService(tierlistsRepository);
  // -----------------------------------------------------------------------

  // No rate limit on the authenticated CRUD surface — ordinary tier-list
  // editing (one PUT per drag/tier-change/rename) shouldn't be throttled,
  // same posture as modules/murals' own authenticated routes (see that
  // module's plugin.ts).
  await app.register(buildTierlistRoutes(tierlistsService));

  // The public surface is the one that needs a tight limit: it is
  // unauthenticated, it WRITES (a ballot), and a community tier list is
  // publicly listed, so its link is meant to be found. Same 30/minute as
  // the public shared-mural route.
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicTierlistRoutes(tierlistsService));
  });
}

let cachedApi: TierlistsPublicApi | null = null;

/** app.ts's handle on tierlists' cross-module public surface — what it
 *  hands to registerMuralsModule so GET /murals/shared/:token can resolve
 *  a mural's `tierlist` block references server-side. Opens its own lazy
 *  connection to TIERLISTS_DB_PATH rather than reaching for the service
 *  instance tierlistsPlugin closes over — same idiom as
 *  modules/covers/publicCoverLookup.ts: app.ts wires modules together at
 *  register() time, BEFORE Fastify has booted any plugin (plugins only
 *  run at ready()/listen() time), so the plugin's own composition result
 *  doesn't exist yet. SQLite in WAL mode supports multiple connections to
 *  one file just fine, and getTierlistData only ever reads. */
export function getTierlistsPublicApi(): TierlistsPublicApi {
  if (!cachedApi) {
    const service = createTierlistsService(createSqliteTierlistsRepository(openTierlistsDb()));
    cachedApi = createTierlistsPublicApi(service);
  }
  return cachedApi;
}
