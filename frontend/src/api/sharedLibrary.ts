// Public-facing counterpart to api/library.ts — backs the unauthenticated
// GET /shared/library/:token page (pages/SharedLibraryPage.tsx). The
// library share's backend route (backend/src/modules/library/routes.ts's
// GET /library/shared/:token) projects each book down to a public-safe
// subset of fields before returning it (see backend/src/modules/library/
// service.ts's toPublicLibraryData/toPublicLibraryBook) — highlights and
// other private per-book data never leave the server. `name`/`groups`/
// `style` pass through unchanged. Same `{data: LibraryData}` shape
// fetchLibrary already gets back authenticated, so `LibraryData`
// (api/library.ts) is reused as-is, even though a shared book object is
// really only a subset of that type's fields at runtime — every field
// this page/BookCard.tsx actually reads is still present.

import type { LibraryData } from "./library";
import { publicFetch } from "./client";

export interface SharedLibraryPayload {
  data: LibraryData;
}

export async function fetchSharedLibrary(token: string): Promise<SharedLibraryPayload> {
  return (await publicFetch(`/library/shared/${token}`)) as SharedLibraryPayload;
}
