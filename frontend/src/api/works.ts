import { createWorksApi } from "@scripta/shared";
import { request } from "./request";

export const { fetchWork, fetchWorkStats, fetchWorkCharacters, fetchWorkCast, fetchRecentAwards } = createWorksApi(request);
