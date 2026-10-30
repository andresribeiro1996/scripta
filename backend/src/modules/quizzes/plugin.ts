// The quizzes module's Fastify plugin and composition root — mirrors
// modules/tierlists/plugin.ts: two route builders, each in its OWN
// encapsulation scope so the public one carries its rate limit.

import { env } from "../../config/env.js";
import { createSqliteDailyChapterRepository } from "./adapters/sqlite/sqliteDailyChapterRepository.js";
import type { DailyChapterPeople } from "./domain/dailyChapter.js";
import { createDailyChapterService } from "./dailyChapterService.js";
import { buildDailyChapterRoutes } from "./dailyChapterRoutes.js";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { getWorkCharacters } from "../books/index.js";
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
  dailyPeople?: DailyChapterPeople;
}

export const quizWorks: QuizWorks = { knownWorkIds, resolveTitleWorks, canonicalByKey, publicBooksByWork: resolvePublicBooksByWork, charactersOf: getWorkCharacters };

export async function quizzesPlugin(app: FastifyInstance, opts: QuizzesPluginOptions = {}) {
  // --- composition: swap this one block to change storage technology ---
  const db = openQuizzesDb();
  const quizzesService = createQuizzesService(createSqliteQuizzesRepository(db), quizWorks, opts.emitPublished, opts.emitPlayed, opts.resolveUsernames);
  // -----------------------------------------------------------------------

  await app.register(buildQuizRoutes(quizzesService));
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 120, timeWindow: "1 minute" });
    await scoped.register(buildDailyChapterRoutes(createDailyChapterService(createSqliteDailyChapterRepository(db), createSqliteQuizzesRepository(db), undefined, opts.dailyPeople), (userId) => Boolean(env.ADMIN_USER_ID) && userId === env.ADMIN_USER_ID));
  });

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
