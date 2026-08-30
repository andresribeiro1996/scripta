// Public interface of the library module. Everything else in
// modules/library/ is private implementation. Nothing else currently
// needs to import from this module, but the pattern is the same as
// modules/auth/index.ts for when something eventually does.

export { libraryPlugin as registerLibraryModule } from "./plugin.js";
// Startup-migration read/write steps — see migration.ts and
// backend/src/migrations/runStartupMigrations.ts for the full picture.
export { readEmbeddedMurals, clearEmbeddedMuralsField } from "./migration.js";
export type { EmbeddedMuralRow } from "./migration.js";
// Cross-module public-data resolver for murals' public
// GET /murals/shared/:token route — see publicResolver.ts's own top
// comment for the privacy boundary this enforces.
export { resolvePublicLibraryData } from "./publicResolver.js";
export type { PublicBookData, PublicHighlight, ResolvedPublicData, PublicDataRequest } from "./publicResolver.js";
