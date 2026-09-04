// Public-facing counterpart to hooks/useMurals.ts — backs the unauthenticated
// GET /shared/murals/:token page (pages/SharedMuralPage.tsx). Goes through
// publicFetch (api/client.ts), not apiFetch: a link recipient has no session
// at all, and this route requires none (the token itself IS the access
// control — see backend/src/modules/murals/routes.ts's own comment on
// GET /murals/shared/:token for why it's never cached).
//
// PublicBookData/PublicHighlight mirror the backend's redacted shapes
// exactly (backend/src/modules/library/publicResolver.ts) — same
// no-shared-package duplication every other cross-boundary type in this
// app already has (see that file's own top comment, or blockRefs.ts's).

import type { MuralBlock } from "../lib/murals";
import { publicFetch } from "./client";
import type { ResolvedTierlist } from "./tierlists";

export interface PublicBookData {
  title: string;
  author: string;
  isbn: string | null;
  imageId: string | null;
  coverUrl: string | null;
  readStatus: number | null;
}

export interface PublicHighlight {
  bookKey: string;
  highlightId: string;
  text: string;
  annotation: string | null;
}

export interface SharedMuralPayload {
  mural: { id: string; name: string; blocks: MuralBlock[]; coverImageUrl: string | null };
  books: PublicBookData[];
  highlights: PublicHighlight[];
  currentlyReading: PublicBookData[];
  stats: Record<string, number>;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, ResolvedTierlist>;
}

export async function fetchSharedMural(token: string): Promise<SharedMuralPayload> {
  return (await publicFetch(`/murals/shared/${token}`)) as SharedMuralPayload;
}
