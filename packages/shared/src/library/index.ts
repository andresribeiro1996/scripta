// Library shared domain (Task 3A). Every module here is pure, DOM-free
// TypeScript consumed as compiled output by frontend (Vite), mobile
// (Metro), and backend (tsc/node) alike. Frontend's own
// frontend/src/lib/<name>.ts files re-export the matching names from
// here — see each one's own top comment for exactly what it keeps local
// (the CSS/DOM/network-bound halves that don't belong in a shared
// package).

export * from "./types.js";
export * from "./merge.js";
export * from "./bookMatch.js";
export * from "./dedupe.js";
export * from "./libraryView.js";
export * from "./groups.js";
export * from "./libraryOrder.js";
export * from "./addPipeline.js";
export * from "./libraryChange.js";
export * from "./librarySaver.js";
export * from "./libraryStyle.js";
export * from "./csv.js";
export * from "./goodreads.js";
export * from "./storygraph.js";
export * from "./covers.js";
export * from "./coverResolver.js";
export * from "./bookCovers.js";
export * from "./bookMetadata.js";
export * from "./bookSearch.js";
export * from "./bookGenres.js";
export * from "./finish.js";
export * from "./readerIdentity.js";
export * from "./saveFailure.js";
