// The library module's Fastify plugin and composition root — mirrors
// modules/auth/plugin.ts's shape exactly. This is the one place that
// knows SQLite backs the LibraryRepository port.

import type { FastifyInstance } from "fastify";
import { createSqliteLibraryRepository } from "./adapters/sqlite/sqliteLibraryRepository.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";
import { buildLibraryRoutes } from "./routes.js";
import { createLibraryService } from "./service.js";

export async function libraryPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openLibraryDb();
  const libraryRepository = createSqliteLibraryRepository(db);
  const libraryService = createLibraryService(libraryRepository);
  // -----------------------------------------------------------------------

  await app.register(buildLibraryRoutes(libraryService));
}
