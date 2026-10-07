import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { SharedLibraryPayload, SharedMuralPayload } from "./types.js";

export function createPublicApi(request: ApiRequest) {
  return {
    fetchSharedMural(token: string): Promise<SharedMuralPayload> {
      return request<SharedMuralPayload>(apiPath`/murals/shared/${token}`, { auth: "none" });
    },
    fetchSharedLibrary(token: string): Promise<SharedLibraryPayload> {
      return request<SharedLibraryPayload>(apiPath`/library/shared/${token}`, { auth: "none" });
    },
  };
}
