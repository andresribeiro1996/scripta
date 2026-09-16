import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openCommunityDb } from "./adapters/sqlite/connection.js";
import { createSqliteCommunityRepository } from "./adapters/sqlite/sqliteCommunityRepository.js";
import { buildCommunityRoutes, buildPublicCommunityRoutes } from "./routes.js";
import type { CommunityDeps, CommunityPublicApi } from "./service.js";
import { createCommunityPublicApi, createCommunityService } from "./service.js";

export async function communityPlugin(app: FastifyInstance, opts: Omit<CommunityDeps, "repo">) {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const service = createCommunityService({ ...opts, repo });

  await app.register(buildCommunityRoutes(service));

  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicCommunityRoutes(service));
  });
}

let cachedPublicApi: CommunityPublicApi | null = null;

export function getCommunityPublicApi(): CommunityPublicApi {
  if (!cachedPublicApi) {
    cachedPublicApi = createCommunityPublicApi(createSqliteCommunityRepository(openCommunityDb()));
  }
  return cachedPublicApi;
}
