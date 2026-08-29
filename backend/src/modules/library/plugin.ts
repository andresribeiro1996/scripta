// The library module's Fastify plugin and composition root — mirrors
// modules/auth/plugin.ts's shape exactly. This is the one place that
// knows SQLite backs the LibraryRepository port.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { createSqliteLibraryRepository } from "./adapters/sqlite/sqliteLibraryRepository.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";
import { buildLibraryRoutes, buildPublicLibraryRoutes } from "./routes.js";
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

  // No rate limit on the authenticated CRUD surface — ordinary library
  // editing/saving shouldn't be throttled, same posture as murals' own
  // authenticated routes (see modules/murals/plugin.ts).
  await app.register(buildLibraryRoutes(libraryService));

  // The public GET /library/shared/:token route gets its own scope and
  // its own rate limit — same numbers as murals' public share route
  // (modules/murals/plugin.ts) for consistency; this route previously had
  // no rate limit at all, despite being unauthenticated and hitting the
  // DB on every request.
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicLibraryRoutes(libraryService));
  });
}
