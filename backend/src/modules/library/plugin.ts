// The library module's Fastify plugin and composition root — mirrors
// modules/auth/plugin.ts's shape exactly. This is the one place that
// knows SQLite backs the LibraryRepository port.

import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { createSqliteLibraryRepository } from "./adapters/sqlite/sqliteLibraryRepository.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";
import { buildLibraryRoutes } from "./routes.js";
import { createLibraryService } from "./service.js";

export async function libraryPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openLibraryDb();
  const libraryRepository = createSqliteLibraryRepository(db);
  // Same publicUrlFor pattern as modules/gallery/plugin.ts, but pointed at
  // the FRONTEND's own share-viewer page (not this API) — the token lands
  // in a link a person opens in their browser, not an <img src>.
  const publicUrlFor = (token: string) => `${env.FRONTEND_URL}/shared/library/${token}`;
  const libraryService = createLibraryService(libraryRepository, publicUrlFor);
  // -----------------------------------------------------------------------

  await app.register(buildLibraryRoutes(libraryService));
}
