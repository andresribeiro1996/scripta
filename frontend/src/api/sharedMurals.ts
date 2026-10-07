// Public-facing counterpart to hooks/useMurals.ts — backs the unauthenticated
// GET /shared/murals/:token page (pages/SharedMuralPage.tsx). Goes through
// publicFetch (api/client.ts), not apiFetch: a link recipient has no session
// at all, and this route requires none (the token itself IS the access
// control — see backend/src/modules/murals/routes.ts's own comment on
// GET /murals/shared/:token for why it's never cached).

import type { PublicBookData, PublicHighlight, PublicReaderCard } from "@scripta/shared";
import type { ThemeId } from "@scripta/shared/themes";
import type { MuralBlock, ReaderProfile, ShelfTheme } from "../lib/murals";
import { publicFetch } from "./client";
import type { ResolvedTierlist } from "./tierlists";

export type { PublicBookData, PublicHighlight } from "@scripta/shared";

export interface SharedMuralPayload {
  mural: { id: string; name: string; theme: ThemeId; blocks: MuralBlock[]; coverImageUrl: string | null };
  books: PublicBookData[];
  highlights: PublicHighlight[];
  currentlyReading: PublicBookData[];
  stats: Record<string, number>;
  shelfTheme?: ShelfTheme;
  readerCard?: PublicReaderCard;
  profile?: ReaderProfile;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, ResolvedTierlist>;
}

export async function fetchSharedMural(token: string): Promise<SharedMuralPayload> {
  return (await publicFetch(`/murals/shared/${token}`)) as SharedMuralPayload;
}
