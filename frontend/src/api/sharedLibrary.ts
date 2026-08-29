// Public-facing counterpart to api/library.ts — backs the unauthenticated
// GET /shared/library/:token page (pages/SharedLibraryPage.tsx). Unlike the
// mural share, the library share's backend route
// (backend/src/modules/library/routes.ts's GET /library/shared/:token)
// returns the FULL, unredacted stored document — sharing a whole library is
// an all-or-nothing choice the user makes via Share/Stop sharing, not a
// per-field redaction like a mural's block-by-block reference resolution.
// Same `{data: LibraryData}` shape fetchLibrary already gets back
// authenticated, so `LibraryData` (api/library.ts) is reused as-is.

import type { LibraryData } from "./library";
import { publicFetch } from "./client";

export interface SharedLibraryPayload {
  data: LibraryData;
}

export async function fetchSharedLibrary(token: string): Promise<SharedLibraryPayload> {
  return (await publicFetch(`/library/shared/${token}`)) as SharedLibraryPayload;
}
