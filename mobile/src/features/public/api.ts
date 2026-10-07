import { createPublicApi } from "@scripta/shared";
import { request } from "../../core/api";

export type { PublicBookData, PublicHighlight, SharedMuralPayload } from "@scripta/shared";

export const { fetchSharedLibrary, fetchSharedMural } = createPublicApi(request);
