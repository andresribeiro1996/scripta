import { createPublicApi } from "@scripta/shared";
import { request } from "./request";

export type { SharedLibraryPayload } from "@scripta/shared";

export const { fetchSharedLibrary } = createPublicApi(request);
