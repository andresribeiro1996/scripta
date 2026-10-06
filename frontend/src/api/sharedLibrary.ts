import type { LibraryData } from "./library";
import { publicFetch } from "./client";

export interface SharedLibraryPayload {
  data: LibraryData;
}

export async function fetchSharedLibrary(token: string): Promise<SharedLibraryPayload> {
  return (await publicFetch(`/library/shared/${token}`)) as SharedLibraryPayload;
}
