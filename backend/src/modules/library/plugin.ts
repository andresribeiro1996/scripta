// The library module's Fastify plugin and composition root — mirrors
// modules/auth/plugin.ts's shape. This is the one place that knows which
// database backs the LibraryRepository port.
//
// Two adapters, one decision: DATABASE_URL set means Postgres, otherwise
// SQLite. Nothing below this file — service.ts, domain/, routes.ts —
// knows or cares which is in use, which is the whole reason adding
// Postgres was a new folder rather than a rewrite.

import type { FastifyInstance } from "fastify";
import { usePostgresLibrary } from "../../config/env.js";
import { createSqliteLibraryRepository } from "./adapters/sqlite/sqliteLibraryRepository.js";
import { openLibraryDb, takeMigrationResult } from "./adapters/sqlite/connection.js";
import { createPgLibraryRepository } from "./adapters/postgres/pgLibraryRepository.js";
import { openLibraryPool } from "./adapters/postgres/connection.js";
import type { LibraryRepository } from "./domain/ports.js";
import { buildLibraryRoutes } from "./routes.js";
import { createLibraryService } from "./service.js";

export async function libraryPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  let libraryRepository: LibraryRepository;

  if (usePostgresLibrary) {
    const pool = await openLibraryPool();
    libraryRepository = createPgLibraryRepository(pool);
    // Closing the pool on shutdown matters more than it looks: without
    // it a rolling deploy leaves connections held until the provider
    // times them out, and a small managed Postgres has few to spare.
    app.addHook("onClose", async () => {
      await pool.end();
    });
    app.log.info("[library] using Postgres (DATABASE_URL is set)");
  } else {
    const db = await openLibraryDb();
    libraryRepository = createSqliteLibraryRepository(db);
    app.addHook("onClose", async () => {
      db.close();
    });

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
  }

  const libraryService = createLibraryService(libraryRepository);
  // -----------------------------------------------------------------------

  await app.register(buildLibraryRoutes(libraryService));
}
