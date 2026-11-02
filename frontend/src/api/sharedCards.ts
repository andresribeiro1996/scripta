import { createPublicApi } from "@scripta/shared";
import { request } from "./request";

export const { fetchSharedCard } = createPublicApi(request);
