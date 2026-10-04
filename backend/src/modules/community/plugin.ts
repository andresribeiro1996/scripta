import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openCommunityDb } from "./adapters/sqlite/connection.js";
import { createSqliteCommunityRepository } from "./adapters/sqlite/sqliteCommunityRepository.js";
import { buildCommunityRoutes, buildPublicCommunityRoutes } from "./routes.js";
import type { CommunityDeps, CommunityPublicApi } from "./service.js";
import { createCommunityPublicApi, createCommunityService } from "./service.js";

const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function communityPlugin(app: FastifyInstance, opts: Omit<CommunityDeps, "repo" | "background">) {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const background = (task: () => Promise<void>): void => {
    task().catch((err) => app.log.error(err, "community feed backfill failed"));
  };
  const service = createCommunityService({ ...opts, repo, background });

  const archive = async () => {
    try {
      app.log.info(await service.archiveOldEvents(), "moved old community events to history");
    } catch (err) {
      app.log.error(err, "community event archive failed");
    }
  };
  void archive();
  const archiveTimer = setInterval(archive, ARCHIVE_INTERVAL_MS);
  archiveTimer.unref();
  app.addHook("onClose", (_instance, done) => {
    clearInterval(archiveTimer);
    done();
  });

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

let erasingCommunity: ReturnType<typeof createSqliteCommunityRepository> | undefined;

export function deleteCommunityUserData(userId: string) {
  (erasingCommunity ??= createSqliteCommunityRepository(openCommunityDb())).deleteUserData(userId);
}
