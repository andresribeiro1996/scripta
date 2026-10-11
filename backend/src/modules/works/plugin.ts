import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { WorkResolutionError } from "../library/index.js";
import { buildWorkRoutes, buildWorkStatsRoutes } from "./routes.js";
import { createWorksService, type WorksDeps } from "./service.js";
import { createBookStatsService, type BookStatsDeps } from "./stats.js";

export async function worksPlugin(app: FastifyInstance, deps: WorksDeps & Omit<BookStatsDeps, "getWorkPage">) {
  const getWorkPage: WorksDeps["getWorkPage"] = (id) => {
    try {
      return deps.getWorkPage(id);
    } catch (error) {
      throw new WorkResolutionError(error);
    }
  };
  const service = createWorksService({ ...deps, getWorkPage });
  const stats = createBookStatsService({ getWorkPage, communityRatings: deps.communityRatings, tierPlacements: deps.tierPlacements, tournamentRecord: deps.tournamentRecord });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildWorkRoutes(service));
  });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildWorkStatsRoutes(stats));
  });
}
