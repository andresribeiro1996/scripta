import type { LibraryData, MuralBlock, PublicBookData, PublicHighlight, PublicReaderCard, ReaderProfile, ResolvedTierlist, ShelfTheme } from "@scripta/shared";
import type { ThemeId } from "@scripta/shared/themes";
import { apiClient } from "../../core/api";

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

export function fetchSharedLibrary(token: string): Promise<{ data: LibraryData }> {
  return apiClient.request(`/library/shared/${encodeURIComponent(token)}`);
}

export function fetchSharedMural(token: string): Promise<SharedMuralPayload> {
  return apiClient.request(`/murals/shared/${encodeURIComponent(token)}`);
}
