// The quizzes module's Fastify plugin and composition root — mirrors
// modules/tierlists/plugin.ts: two route builders, each in its OWN
// encapsulation scope so the public one carries its rate limit.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { canonicalByKey, knownWorkIds, resolvePublicBooksByWork, resolveTitleWorks } from "../library/index.js";
import { openQuizzesDb } from "./adapters/sqlite/connection.js";
import { createSqliteQuizzesRepository } from "./adapters/sqlite/sqliteQuizzesRepository.js";
import type { QuizWorks } from "./domain/ports.js";
import { buildPublicQuizRoutes, buildQuizRoutes } from "./routes.js";
import type { EmitPlayed, EmitPublished, QuizzesPublicApi, ResolveUsernames } from "./service.js";
import { createQuizzesPublicApi, createQuizzesService } from "./service.js";

export interface QuizzesPluginOptions {
  emitPublished?: EmitPublished;
  emitPlayed?: EmitPlayed;
  resolveUsernames?: ResolveUsernames;
}

export const quizWorks: QuizWorks = { knownWorkIds, resolveTitleWorks, canonicalByKey, publicBooksByWork: resolvePublicBooksByWork };

export async function quizzesPlugin(app: FastifyInstance, opts: QuizzesPluginOptions = {}) {
  // --- composition: swap this one block to change storage technology ---
  const db = openQuizzesDb();
  const quizzesService = createQuizzesService(createSqliteQuizzesRepository(db), quizWorks, opts.emitPublished, opts.emitPlayed, opts.resolveUsernames);
  // -----------------------------------------------------------------------

  await app.register(buildQuizRoutes(quizzesService));

  // Same 30/minute public-write limit as tierlists' ballot routes: this
  // surface is unauthenticated AND writes (a play).
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicQuizRoutes(quizzesService));
  });
}

let cachedApi: QuizzesPublicApi | null = null;

export function getQuizzesPublicApi(): QuizzesPublicApi {
  if (!cachedApi) cachedApi = createQuizzesPublicApi(createQuizzesService(createSqliteQuizzesRepository(openQuizzesDb()), quizWorks));
  return cachedApi;
}

let erasingQuizzes: ReturnType<typeof createSqliteQuizzesRepository> | undefined;

export function deleteQuizzesUserData(userId: string) {
  (erasingQuizzes ??= createSqliteQuizzesRepository(openQuizzesDb())).deleteUserData(userId);
}
