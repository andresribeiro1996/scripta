// Mirrors frontend/src/api/library.ts's LibraryDocument — the shape the
// backend actually returns from GET/PUT /library. LibraryData itself
// comes from @scripta/shared (Task 3A); this wrapper (updatedAt +
// share state) has never been shared since it's a per-transport response
// shape, not library-domain logic.

import type { LibraryData } from "@scripta/shared";

export type { LibraryData } from "@scripta/shared";

export interface LibraryDocument {
  data: LibraryData;
  updatedAt: string;
  shareToken: string | null;
  shareUrl: string | null;
}
