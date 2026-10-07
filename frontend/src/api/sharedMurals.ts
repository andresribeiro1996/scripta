import { createPublicApi } from "@scripta/shared";
import { request } from "./request";

export type { PublicBookData, PublicHighlight, SharedMuralPayload } from "@scripta/shared";

export const { fetchSharedMural } = createPublicApi(request);
