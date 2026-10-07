import type { ShelfTheme } from "../library/bookGenres.js";
import type { LibraryData } from "../library/index.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import type { MuralBlock, ReaderProfile } from "../murals/murals.js";
import type { ThemeId } from "../themes/index.js";
import type { ResolvedTierlist } from "../tierlists/types.js";

export interface PublicBookData {
  key: string;
  workId: string | null;
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

export interface PublicMural {
  id: string;
  name: string;
  theme: ThemeId;
  blocks: MuralBlock[];
  coverImageUrl: string | null;
}

export interface PublicLibraryData {
  collectionBooks?: Record<string, string[]>;
  books: PublicBookData[];
  highlights: PublicHighlight[];
  currentlyReading: PublicBookData[];
  stats: Record<string, number>;
  shelfTheme?: ShelfTheme;
  readerCard?: PublicReaderCard;
}

export interface MuralPublicPayload {
  mural: PublicMural;
  library: PublicLibraryData;
  profile?: ReaderProfile;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, ResolvedTierlist>;
}

export interface SharedMuralPayload extends Omit<PublicLibraryData, "collectionBooks"> {
  mural: PublicMural;
  profile?: ReaderProfile;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, ResolvedTierlist>;
}

export interface SharedLibraryPayload {
  data: LibraryData;
}
