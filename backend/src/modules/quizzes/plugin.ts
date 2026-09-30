// The quizzes module's Fastify plugin and composition root — mirrors
// modules/tierlists/plugin.ts: two route builders, each in its OWN
// encapsulation scope so the public one carries its rate limit.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { openQuizzesDb } from "./adapters/sqlite/connection.js";
import { createSqliteQuizzesRepository } from "./adapters/sqlite/sqliteQuizzesRepository.js";
import { buildPublicQuizRoutes, buildQuizRoutes } from "./routes.js";
import { createQuizzesService } from "./service.js";

export async function quizzesPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openQuizzesDb();
  const quizzesService = createQuizzesService(createSqliteQuizzesRepository(db));
  // -----------------------------------------------------------------------

  await app.register(buildQuizRoutes(quizzesService));

  // Same 30/minute public-write limit as tierlists' ballot routes: this
  // surface is unauthenticated AND writes (a play).
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicQuizRoutes(quizzesService));
  });
}

let rekeyingQuizzes: ReturnType<typeof createSqliteQuizzesRepository> | undefined;

export function rekeyQuizzesBooks(userId: string, fromKeys: string[], toKey: string) {
  (rekeyingQuizzes ??= createSqliteQuizzesRepository(openQuizzesDb())).rekeyBooks(userId, fromKeys, toKey);
}

let erasingQuizzes: ReturnType<typeof createSqliteQuizzesRepository> | undefined;

export function deleteQuizzesUserData(userId: string) {
  (erasingQuizzes ??= createSqliteQuizzesRepository(openQuizzesDb())).deleteUserData(userId);
}
