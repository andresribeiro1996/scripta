// Public interface of the murals module. Everything else in
// modules/murals/ is private implementation — same convention as
// modules/library/index.ts and modules/gallery/index.ts.

export { muralsPlugin as registerMuralsModule } from "./plugin.js";
export { getMuralsPublicApi } from "./plugin.js";
export { createMuralsPublicApi, type MuralsPublicApi } from "./publicApi.js";
export type { MuralPublicPayload } from "./domain/publicPayload.js";
// Startup-migration insert step — see migration.ts and
// backend/src/migrations/runStartupMigrations.ts for the full picture.
export { insertMigratedMurals, listHomeDesignations, dropMuralHomes } from "./migration.js";
