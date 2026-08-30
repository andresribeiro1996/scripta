// Public interface of the murals module. Everything else in
// modules/murals/ is private implementation — same convention as
// modules/library/index.ts and modules/gallery/index.ts.

export { muralsPlugin as registerMuralsModule } from "./plugin.js";
// Startup-migration insert step — see migration.ts and
// backend/src/migrations/runStartupMigrations.ts for the full picture.
export { insertMigratedMurals } from "./migration.js";
