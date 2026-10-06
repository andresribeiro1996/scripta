// Public interface of the library module. Everything else in
// modules/library/ is private implementation. Nothing else currently
// needs to import from this module, but the pattern is the same as
// modules/auth/index.ts for when something eventually does.

export { libraryPlugin as registerLibraryModule, deleteLibraryUserData } from "./plugin.js";
export type { BookEvent, EmitBookEvents, EnqueueCovers, RekeyBooks } from "./service.js";
// Startup-migration read/write steps — see migration.ts and
// backend/src/migrations/runStartupMigrations.ts for the full picture.
export { readEmbeddedMurals, clearEmbeddedMuralsField, backfillLibraryDerived } from "./migration.js";
export type { EmbeddedMuralRow } from "./migration.js";
// Cross-module public-data resolver for murals' public
// GET /murals/shared/:token route — see publicResolver.ts's own top
// comment for the privacy boundary this enforces.
export { resolvePublicLibrary, resolvePublicLibraryData, resolvePublicBooksByWork, readerGlyphFor, sharedBookCounts, sharedBooks } from "./publicResolver.js";
export type { PublicBookData, PublicHighlight, ResolvedPublicData, PublicDataRequest } from "./publicResolver.js";
export { UnknownWorkError, WorkResolutionError, canonicalByKey, canonicalWorkIds, copyKeysForWorks, duplicateWorkMessage, firstDuplicateWork, firstKeyPerWork, keepFirstPerWork, keysForWorks, knownWorkIds, resolveEntryWorks, resolveTitleWorks, workIdsByKey } from "./works.js";
export type { WorkEntry, WorkRef } from "./works.js";
export { startWorksSweep, sweepLibraryWorks } from "./worksSweep.js";
export type { SweepBatch, WorksSweepStep } from "./worksSweep.js";
