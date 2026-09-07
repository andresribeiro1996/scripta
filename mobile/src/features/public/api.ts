import type { LibraryData, MuralBlock, ResolvedTierlist } from "@scripta/shared";
import { apiClient } from "../../core/api";

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

export function fetchSharedLibrary(token: string): Promise<{ data: LibraryData }> {
  return apiClient.request(`/library/shared/${encodeURIComponent(token)}`);
}

export function fetchSharedMural(token: string): Promise<SharedMuralPayload> {
  return apiClient.request(`/murals/shared/${encodeURIComponent(token)}`);
}
