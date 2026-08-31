// The library module's Fastify plugin and composition root — mirrors
// modules/auth/plugin.ts's shape exactly. This is the one place that
// knows SQLite backs the LibraryRepository port.

import type { FastifyInstance } from "fastify";
import { createSqliteLibraryRepository } from "./adapters/sqlite/sqliteLibraryRepository.js";
import { openLibraryDb, takeMigrationResult } from "./adapters/sqlite/connection.js";
import { buildLibraryRoutes } from "./routes.js";
import { createLibraryService } from "./service.js";

export async function libraryPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openLibraryDb();
  const libraryRepository = createSqliteLibraryRepository(db);
  const libraryService = createLibraryService(libraryRepository);
  // -----------------------------------------------------------------------

  // The blob-to-entities migration runs inside openLibraryDb (it has to,
  // before any request can read a half-migrated library). Surfacing its
  // result here rather than in the adapter keeps console output out of
  // the storage layer — and a per-user failure has to be visible, since
  // the original blob is retained for exactly that case.
  const migration = takeMigrationResult();
  if (migration?.ran) {
    app.log.info(
      { migrated: migration.migrated, skipped: migration.skipped, failed: migration.failed.length },
      "[library] migrated blob documents to normalised entities"
    );
    for (const failure of migration.failed) {
      app.log.error(
        { userId: failure.userId, reason: failure.reason },
        "[library] could not migrate this user's document — their original row in library_documents is untouched"
      );
    }
  }

  await app.register(buildLibraryRoutes(libraryService));
}
