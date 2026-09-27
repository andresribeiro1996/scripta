// Public interface of the books module. Everything else in
// modules/books/ is private implementation — same convention as
// modules/library/index.ts and modules/gallery/index.ts.

export { booksPlugin as registerBooksModule } from "./plugin.js";
// Cross-module cache-only cover lookup: a pure database read with no
// side effects, unlike the authGuard'd GET /covers/resolve route, which
// can create the book row and queue a background lookup — neither one
// calls a cover source directly; only the worker that later picks up a
// queued lookup does that.
export { peekCachedCoverUrl } from "./publicCoverLookup.js";
export type { PeekCachedCoverParams } from "./publicCoverLookup.js";
