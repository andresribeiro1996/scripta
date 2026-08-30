// Public interface of the covers module. Everything else in
// modules/covers/ is private implementation — same convention as
// modules/library/index.ts and modules/gallery/index.ts.

export { coversPlugin as registerCoversModule } from "./plugin.js";
// Cross-module cache-only cover lookup — see publicCoverLookup.ts's own
// top comment for why this exists and what it deliberately does NOT do
// (no network calls, unlike the authGuard'd GET /covers/resolve route).
export { peekCachedCoverUrl } from "./publicCoverLookup.js";
export type { PeekCachedCoverParams } from "./publicCoverLookup.js";
