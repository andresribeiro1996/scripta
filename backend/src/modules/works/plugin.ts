import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { WorkResolutionError } from "../library/index.js";
import { buildWorkRoutes } from "./routes.js";
import { createWorksService, type WorksDeps } from "./service.js";

export async function worksPlugin(app: FastifyInstance, deps: WorksDeps) {
  const service = createWorksService({
    ...deps,
    getWorkPage: (id) => {
      try {
        return deps.getWorkPage(id);
      } catch (error) {
        throw new WorkResolutionError(error);
      }
    }
  });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildWorkRoutes(service));
  });
}
