import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openCommunityDb } from "./adapters/sqlite/connection.js";
import { createSqliteCommunityRepository } from "./adapters/sqlite/sqliteCommunityRepository.js";
import { FEED_WINDOW_MS } from "./domain/feed.js";
import type { CommunityRepository } from "./domain/ports.js";
import { buildCommunityRoutes, buildPublicCommunityRoutes } from "./routes.js";
import type { CommunityDeps, CommunityPublicApi } from "./service.js";
import { createCommunityPublicApi, createCommunityService } from "./service.js";

const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_BATCH = 1000;

async function inBatches(step: (batch: number) => number): Promise<number> {
  let total = 0;
  for (;;) {
    const done = step(ARCHIVE_BATCH);
    total += done;
    if (done < ARCHIVE_BATCH) return total;
    await new Promise(setImmediate);
  }
}

async function archiveOldEvents(repo: CommunityRepository, now: number) {
  const cutoff = new Date(now - FEED_WINDOW_MS).toISOString();
  const moved = await inBatches((batch) => repo.moveEventsBefore(cutoff, batch));
  const purged = await inBatches((batch) => repo.purgeInboxBefore(cutoff, batch));
  return { moved, purged };
}

export async function communityPlugin(app: FastifyInstance, opts: Omit<CommunityDeps, "repo">) {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const service = createCommunityService({ ...opts, repo });

  const archive = async () => {
    try {
      app.log.info(await archiveOldEvents(repo, (opts.now ?? Date.now)()), "moved old community events to history");
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
