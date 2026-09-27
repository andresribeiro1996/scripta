// Public interface of the books module. Everything else in
// modules/books/ is private implementation — same convention as
// modules/library/index.ts and modules/gallery/index.ts.

export { booksPlugin as registerBooksModule } from "./plugin.js";
// Cross-module cache-only cover lookup: synchronous and database-only,
// with no network calls, unlike the authGuard'd GET /covers/resolve route.
export { peekCachedCoverUrl } from "./publicCoverLookup.js";
export type { PeekCachedCoverParams } from "./publicCoverLookup.js";
