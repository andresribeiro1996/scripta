import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { resolvePublicReaderProfiles } from "../auth/index.js";
import { openCommunityDb } from "./adapters/sqlite/connection.js";
import { createSqliteCommunityRepository } from "./adapters/sqlite/sqliteCommunityRepository.js";
import { createRecapRepository } from "./adapters/sqlite/sqliteRecapRepository.js";
import { createSqliteEngagementRepository } from "./adapters/sqlite/sqliteEngagementRepository.js";
import { createEngagementService } from "./engagement.js";
import { buildEngagementRoutes } from "./engagementRoutes.js";
import { buildCommunityRoutes, buildDiscoverRoutes, buildPublicCommunityRoutes } from "./routes.js";
import type { CommunityDeps, CommunityPublicApi } from "./service.js";
import { createCommunityPublicApi, createCommunityService } from "./service.js";
import { buildTopShelfRoutes } from "./topShelfRoutes.js";
import { createTopShelfRecapService, type TopShelfRecapService } from "./topShelfRecapService.js";
import { createShelfGatherer, createTopShelfService, type TopShelfDeps } from "./topShelfService.js";

const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RECAP_INTERVAL_MS = 60 * 60 * 1000;

let recapService: TopShelfRecapService | null = null;

export function freezeTopShelfRecap(month: string): void {
  if (!recapService) throw new Error("Community plugin is not registered.");
  recapService.freezeMonth(month);
}

export async function communityPlugin(app: FastifyInstance, opts: Omit<CommunityDeps, "repo" | "background"> & TopShelfDeps) {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const background = (task: () => Promise<void>): void => {
    task().catch((err) => app.log.error(err, "community feed backfill failed"));
  };
  const service = createCommunityService({ ...opts, repo, background });
  const engagementRepo = createSqliteEngagementRepository(db);
  const now = opts.now ?? Date.now;
  const gatherer = createShelfGatherer({ engagementRepo, community: { ...opts, repo }, shelf: opts, now });
  const topShelf = createTopShelfService({ gatherer, community: { ...opts, repo }, shelf: opts, now });
  const recaps = createTopShelfRecapService({ repo: createRecapRepository(db), gatherer, community: { ...opts, repo }, shelf: opts, now });
  recapService = recaps;
  const engagement = createEngagementService({ repo: engagementRepo, community: service, resolveProfiles: opts.resolveProfiles });

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
  const freezeRecaps = () => {
    try {
      recaps.freezeDue();
    } catch (err) {
      app.log.error(err, "top shelf recap freeze failed");
    }
  };
  freezeRecaps();
  const recapTimer = setInterval(freezeRecaps, RECAP_INTERVAL_MS);
  recapTimer.unref();
  app.addHook("onClose", (_instance, done) => {
    clearInterval(archiveTimer);
    clearInterval(recapTimer);
    done();
  });

  await app.register(buildCommunityRoutes(service));
  await app.register(buildEngagementRoutes(engagement));
  await app.register(buildDiscoverRoutes(service));
  await app.register(buildTopShelfRoutes(topShelf, recaps));

  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicCommunityRoutes(service));
  });
}

let cachedPublicApi: CommunityPublicApi | null = null;

export function getCommunityPublicApi(): CommunityPublicApi {
  if (!cachedPublicApi) {
    cachedPublicApi = createCommunityPublicApi(createSqliteCommunityRepository(openCommunityDb()), Date.now, resolvePublicReaderProfiles);
  }
  return cachedPublicApi;
}

let erasingCommunity: ReturnType<typeof createSqliteCommunityRepository> | undefined;

export function deleteCommunityUserData(userId: string) {
  (erasingCommunity ??= createSqliteCommunityRepository(openCommunityDb())).deleteUserData(userId);
}
